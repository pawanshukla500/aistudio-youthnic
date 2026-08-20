import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Image as ImageIcon,
  Layers,
  Loader2,
  Play,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { getDownloadURL, ref as firebaseStorageRef, uploadBytes } from "firebase/storage";
import { api, useMutation, useQuery, type Id } from "../../lib/backend";
import { useWorkspace } from "../../lib/WorkspaceContext";
import { useFirebaseAuth } from "../../lib/FirebaseAuthContext";
import { firebaseStorage } from "../../lib/firebase";
import { getErrorMessage } from "../../lib/errors";
import { StylingPlanEditor } from "../../components/ui/StylingPlanEditor";
import { normalizePlan, type StylingPlan } from "../../lib/stylingPlan";

const CATEGORIES = ["ethnic/fusion", "western/casual", "dress", "formal", "streetwear", "activewear"];
const ASPECTS = ["3:4", "4:5", "2:3", "9:16", "1:1", "16:9"];
const dateFmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

type RoadmapEvent = Record<string, any> & { _id: string; name: string; daysUntil: number; prepDaysLeft: number; date: number; prepDeadline: number; campaignSeason?: string; brief?: string; mood?: string; colorPalette?: string[]; themes?: string[]; marketplace?: string };
type PlanningRoadmap = { events: RoadmapEvent[] };
type CatalogSummary = any;
type CatalogVariant = Record<string, any> & { outputs: Array<Record<string, any> & { status: string; poseNumber: number; title: string; url?: string }> };
type CatalogDetail = Record<string, any> & { variants: CatalogVariant[]; styleReferences: any[]; modelReference: { _id: string; url: string; filename: string } | null };

const emptyCreate = {
  name: "",
  // Studio defers the scene to the uploaded style reference; this form used to ship
  // "Premium clean fashion catalog scene", which is an instruction for a plain studio
  // backdrop and quietly overrode whatever reference the catalog had attached.
  modelDirection: "Use the uploaded model face reference exactly; keep that same model across every colourway",
  sceneDirection: "Reproduce the scene, backdrop, props and lighting from the uploaded style reference",
  category: "ethnic/fusion",
  aspectRatio: "3:4",
  imageSize: "2K",
  poseQa: true,
  campaign: "",
  eventId: "",
  skusText: "",
};

function statusLabel(status: string) {
  return status === "awaiting_styling_approval" ? "awaiting styling approval" : status;
}

function statusChip(status: string) {
  if (status === "awaiting_styling_approval") return "bg-warning-surface text-warning";
  if (status === "completed") return "bg-success-surface text-success";
  if (status === "failed") return "bg-danger-surface text-danger";
  if (["generating", "scheduled", "queued", "processing"].includes(status)) return "bg-info-surface text-info";
  if (status === "ready") return "bg-primary/10 text-primary";
  return "bg-surface-container-high text-secondary";
}

function parseVariants(text: string) {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      const parts = trimmed.split(/\s*[|,\t]\s*/);
      return { sku: parts[0].trim(), colorLabel: parts.slice(1).join(" ").trim() || undefined };
    })
    .filter((entry): entry is { sku: string; colorLabel: string | undefined } => Boolean(entry && entry.sku));
}

async function fileHash(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function eventSceneDirection(event: RoadmapEvent) {
  return [
    event.brief,
    event.mood ? `Mood: ${event.mood}.` : "",
    event.colorPalette?.length ? `Colours: ${event.colorPalette.join(", ")}.` : "",
    event.themes?.length ? `Themes: ${event.themes.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ") || emptyCreate.sceneDirection;
}

function toDateTimeInput(value: number) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nextMorningSlot() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  return toDateTimeInput(date.getTime());
}

export function Planning() {
  const { organization, user } = useWorkspace();
  const { user: firebaseUser } = useFirebaseAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const catalogs = useQuery(api.catalog.list, { organizationId: organization._id }) as CatalogSummary[] | undefined;
  const roadmap = useQuery(api.eventIntelligence.roadmap, { organizationId: organization._id }) as PlanningRoadmap | undefined;
  const createCatalog = useMutation(api.catalog.createCatalog);
  const bulkAddVariants = useMutation(api.catalog.bulkAddVariants);
  const setVariantReferences = useMutation(api.catalog.setVariantReferences);
  const removeVariant = useMutation(api.catalog.removeVariant);
  const scheduleCatalog = useMutation(api.catalog.scheduleCatalog);
  const cancelScheduledCatalog = useMutation(api.catalog.cancelScheduledCatalog);
  const deleteCatalog = useMutation(api.catalog.delete);
  const stopCatalogGeneration = useMutation(api.catalog.stopGeneration);
  const addCatalogStyleReference = useMutation(api.catalog.addCatalogStyleReference);
  const saveCatalogStylingPlan = useMutation(api.catalog.saveStylingPlan);
  const removeCatalogStyleReference = useMutation(api.catalog.removeCatalogStyleReference);
  const retryVariant = useMutation(api.catalog.retryVariant);
  const cancelJob = useMutation(api.jobs.cancel);
  const saveReference = useMutation(api.files.saveReference);

  const [selectedId, setSelectedId] = useState<Id<"catalogs"> | null>(null);
  const selected = useQuery(api.catalog.get, selectedId ? { catalogId: selectedId } : "skip") as CatalogDetail | null | undefined;
  const selectedLoaded = selected !== undefined;
  const selectedPreferredSchedule = selected?.scheduledAt || selected?.preferredGenerationAt;
  const [focusSku, setFocusSku] = useState<Id<"catalogSkus"> | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyCreate);
  const [addText, setAddText] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const upcoming = useMemo(
    () => (roadmap?.events || []).filter((event) => event.daysUntil >= 0).slice(0, 6),
    [roadmap],
  );

  const notify = (tone: "success" | "error", text: string) => setNotice({ tone, text });

  const openCreateForEvent = (event: RoadmapEvent) => {
    setForm({
      ...emptyCreate,
      name: "",
      campaign: event.campaignSeason || event.name,
      eventId: event._id,
      sceneDirection: eventSceneDirection(event),
    });
    if (event.prepDeadline) {
      const d = new Date(event.prepDeadline);
      const pad = (n: number) => String(n).padStart(2, "0");
      setScheduleAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
    setShowCreate(true);
  };

  // Handle the deep link from the Events page (?openBulk=1&season=&eventId=&date=).
  // oxlint-disable react-hooks/exhaustive-deps
  useEffect(() => {
    if (params.get("openBulk") !== "1" || !roadmap) return;
    const eventId = params.get("eventId");
    const season = params.get("season") || "";
    const event = eventId ? (roadmap.events || []).find((entry) => entry._id === eventId) : null;
    setForm({
      ...emptyCreate,
      campaign: season || event?.campaignSeason || event?.name || "",
      eventId: event?._id || "",
      sceneDirection: event ? eventSceneDirection(event) : emptyCreate.sceneDirection,
    });
    const dateMs = Number(params.get("date") || 0);
    if (dateMs) {
      const d = new Date(dateMs);
      const pad = (n: number) => String(n).padStart(2, "0");
      setScheduleAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
    setShowCreate(true);
    const next = new URLSearchParams(params);
    ["openBulk", "season", "eventId", "date"].forEach((key) => next.delete(key));
    setParams(next, { replace: true });
  }, [roadmap, params]);
  // oxlint-enable react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedId || !selectedLoaded) return;
    setScheduleAt(selectedPreferredSchedule
      ? toDateTimeInput(selectedPreferredSchedule)
      : toDateTimeInput(Date.now() + 60 * 60 * 1000));
  }, [selectedId, selectedLoaded, selectedPreferredSchedule]);

  const uploadRef = async (role: string, file: File, sku: string, catalogId: Id<"catalogs">) => {
    if (!firebaseUser) throw new Error("Your session expired. Please sign in again.");
    const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const storagePath = ["users", firebaseUser.uid, "organizations", String(organization._id), "catalog", String(catalogId), sku.replace(/[^a-zA-Z0-9._-]+/g, "-"), role, `${crypto.randomUUID()}-${safe}`].join("/");
    const uploaded = await uploadBytes(firebaseStorageRef(firebaseStorage, storagePath), file, { contentType: file.type, customMetadata: { organizationId: String(organization._id), role } });
    const downloadUrl = await getDownloadURL(uploaded.ref);
    return saveReference({
      organizationId: organization._id,
      uploadedBy: user._id,
      catalogId,
      skuId: sku,
      role,
      storageProvider: "firebase",
      storagePath,
      downloadUrl,
      hash: await fileHash(file),
      filename: file.name,
      mimeType: file.type,
      size: file.size,
    });
  };

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("create");
    setNotice(null);
    try {
      const catalogId = await createCatalog({
        organizationId: organization._id,
        createdBy: user._id,
        name: form.name.trim(),
        modelDirection: form.modelDirection.trim(),
        sceneDirection: form.sceneDirection.trim(),
        category: form.category,
        aspectRatio: form.aspectRatio,
        imageSize: form.imageSize,
        poseQa: form.poseQa,
        campaign: form.campaign.trim() || undefined,
        eventId: form.eventId ? (form.eventId as Id<"events">) : undefined,
        preferredGenerationAt: scheduleAt ? new Date(scheduleAt).getTime() : undefined,
      });
      const variants = parseVariants(form.skusText);
      if (variants.length) await bulkAddVariants({ catalogId, variants });
      setShowCreate(false);
      setForm(emptyCreate);
      setSelectedId(catalogId);
      notify("success", `Catalog created with ${variants.length} colourway${variants.length === 1 ? "" : "s"}. Upload front/back for every colourway; Gemini preflight and the preferred automatic run will arm themselves.`);
    } catch (reason) {
      notify("error", getErrorMessage(reason, "Could not create catalog."));
    } finally {
      setBusy("");
    }
  };

  const addMore = async () => {
    if (!selectedId) return;
    const variants = parseVariants(addText);
    if (!variants.length) return;
    setBusy("add");
    try {
      await bulkAddVariants({ catalogId: selectedId, variants });
      setAddText("");
      notify("success", `Added ${variants.length} colourway${variants.length === 1 ? "" : "s"}.`);
    } catch (reason) {
      notify("error", getErrorMessage(reason, "Could not add colourways."));
    } finally {
      setBusy("");
    }
  };

  const pickImage = async (role: string, file: File | undefined, sku: string) => {
    if (!file || !selectedId || !focusSku) return;
    setBusy(`upload-${role}`);
    setNotice(null);
    try {
      const referenceId = await uploadRef(role, file, sku, selectedId);
      const key = role === "front" ? "frontReferenceId" : role === "back" ? "backReferenceId" : role === "fabric_pattern" ? "fabricPatternReferenceId" : "additionalProductReferenceId";
      await setVariantReferences({ skuId: focusSku, [key]: referenceId } as any);
      notify("success", `${role.replace("_", " ")} saved for ${sku}.`);
    } catch (reason) {
      notify("error", getErrorMessage(reason, "Upload failed."));
    } finally {
      setBusy("");
    }
  };

  const saveStylingPlan = async (stylingPlan: StylingPlan, approve: boolean) => {
    if (!selectedId) return;
    setBusy("styling-plan");
    setNotice(null);
    try {
      const result = await saveCatalogStylingPlan({ catalogId: selectedId, stylingPlan, approve });
      notify(
        "success",
        approve
          ? "Styling plan approved. Generation can start."
          : result?.approvalRevoked
            ? "Styling plan saved. It needs approval again before this catalog generates."
            : "Styling plan saved.",
      );
      return true;
    } catch (reason) {
      notify("error", getErrorMessage(reason, "Could not save the styling plan."));
      return false;
    } finally {
      setBusy("");
    }
  };

  const pickStyleReference = async (file: File | undefined) => {
    if (!file || !selectedId || !selected) return;
    setBusy("upload-style_reference");
    setNotice(null);
    try {
      const referenceId = await uploadRef("style_reference", file, `${selected.name}-shared-style`, selectedId);
      await addCatalogStyleReference({ catalogId: selectedId, referenceId });
      notify("success", "Shared photography reference uploaded. Gemini will use it only for the catalog's scene and creative direction.");
    } catch (reason) {
      notify("error", getErrorMessage(reason, "Style reference upload failed."));
    } finally {
      setBusy("");
    }
  };

  const removeStyleReference = async (referenceId: Id<"productReferences">) => {
    if (!selectedId) return;
    setBusy(`remove-style-${referenceId}`);
    try {
      await removeCatalogStyleReference({ catalogId: selectedId, referenceId });
      notify("success", "Style reference removed from this catalog.");
    } catch (reason) {
      notify("error", getErrorMessage(reason, "Could not remove the style reference."));
    } finally {
      setBusy("");
    }
  };

  // Reuses the same shared-batch-reference plumbing as the style reference above (role is the
  // only thing that differs) - this face is locked as the model's exact identity across every
  // colourway in the catalog, the same way Studio's "Model face lock" upload works.
  const pickModelReference = async (file: File | undefined) => {
    if (!file || !selectedId || !selected) return;
    setBusy("upload-model_identity");
    setNotice(null);
    try {
      // uploadRef already persists this as the batch's model_identity reference and schedules
      // preflight itself (see saveReferenceOperation) - no separate catalog-validation call needed.
      await uploadRef("model_identity", file, `${selected.name}-shared-model`, selectedId);
      notify("success", "Model face reference uploaded. Every colourway in this catalog will lock to this exact face.");
    } catch (reason) {
      notify("error", getErrorMessage(reason, "Model face reference upload failed."));
    } finally {
      setBusy("");
    }
  };

  const removeModelReference = async (referenceId: Id<"productReferences">) => {
    if (!selectedId) return;
    setBusy(`remove-model-${referenceId}`);
    try {
      await removeCatalogStyleReference({ catalogId: selectedId, referenceId });
      notify("success", "Model face reference removed from this catalog.");
    } catch (reason) {
      notify("error", getErrorMessage(reason, "Could not remove the model face reference."));
    } finally {
      setBusy("");
    }
  };

  const runSchedule = async (whenMs: number) => {
    if (!selectedId) return;
    setBusy("schedule");
    setNotice(null);
    try {
      const result = await scheduleCatalog({ catalogId: selectedId, scheduledAt: whenMs });
      notify("success", whenMs <= Date.now() + 1000 ? `Generation started for ${result.readyCount} colourways.` : `Scheduled ${result.readyCount} colourways for ${new Date(result.scheduledAt).toLocaleString("en-IN")}.`);
    } catch (reason) {
      notify("error", getErrorMessage(reason, "Could not schedule."));
    } finally {
      setBusy("");
    }
  };

  const cancelSchedule = async () => {
    if (!selectedId) return;
    setBusy("cancel-schedule");
    setNotice(null);
    try {
      await cancelScheduledCatalog({ catalogId: selectedId });
      notify("success", "Automatic generation was cancelled. The catalog is editable again.");
    } catch (reason) {
      notify("error", getErrorMessage(reason, "Could not cancel the schedule."));
    } finally {
      setBusy("");
    }
  };

  const handleDeleteCatalog = async () => {
    if (!selectedId) return;
    if (!window.confirm("Are you sure you want to delete this catalog and all its variants? This cannot be undone.")) return;
    setBusy("delete-catalog");
    setNotice(null);
    try {
      await deleteCatalog({ catalogId: selectedId });
      setSelectedId(null);
      setFocusSku(null);
      notify("success", "Catalog deleted successfully.");
    } catch (reason) {
      notify("error", getErrorMessage(reason, "Could not delete catalog."));
    } finally {
      setBusy("");
    }
  };

  const handleStopCatalogGeneration = async () => {
    if (!selectedId) return;
    if (!window.confirm("Are you sure you want to force-stop the generation of this catalog? Active generating images will be cancelled.")) return;
    setBusy("stop-catalog-generation");
    setNotice(null);
    try {
      await stopCatalogGeneration({ catalogId: selectedId });
      notify("success", "Catalog generation stopped successfully.");
    } catch (reason) {
      notify("error", getErrorMessage(reason, "Could not stop catalog generation."));
    } finally {
      setBusy("");
    }
  };

  const stopActiveGeneration = async () => {
    if (!activeVariant?.jobId || !window.confirm(`Stop generation for ${activeVariant.sku}? Completed images will remain saved.`)) return;
    setBusy("stop-generation");
    try {
      await cancelJob({ jobId: activeVariant.jobId });
      notify("success", `Generation stopped for ${activeVariant.sku}.`);
    } catch (reason) {
      notify("error", getErrorMessage(reason, "Could not stop generation."));
    } finally {
      setBusy("");
    }
  };

  const linkedEvent = selected?.eventId ? (roadmap?.events || []).find((entry) => entry._id === selected.eventId) : null;
  const focusVariant = (selected?.variants || []).find((variant) => variant._id === focusSku) || null;
  const readyCount = (selected?.variants || []).filter((variant) => variant.readinessStatus === "ready").length;
  const preflightReadyCount = (selected?.variants || []).filter((variant) => variant.readinessStatus === "ready" && variant.analysisStatus === "ready").length;
  const activeVariant = (selected?.variants || []).find((variant) => ["queued", "processing", "cancelling"].includes(variant.jobStatus))
    || (selected?.variants || []).find((variant) => variant.status === "generating")
    || null;
  const isDraftable = selected && ["draft", "completed", "failed"].includes(selected.status);
  const canEditReferences = Boolean(selected && ["draft", "completed", "failed"].includes(selected.status));
  const incompleteCount = Math.max(0, (selected?.variants.length || 0) - readyCount);

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-1 text-[11px] font-label-caps uppercase tracking-widest text-secondary">Planning</p>
          <h2 className="text-display-md text-on-surface">Catalogs & campaigns</h2>
          <p className="mt-1 text-sm text-secondary">Build a colourway catalog, upload front/back per colour, and schedule one consistent shoot.</p>
        </div>
        {!selectedId && (
          <button onClick={() => { setForm(emptyCreate); setScheduleAt(""); setShowCreate(true); }} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> New catalog</button>
        )}
      </div>

      {notice && <div className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-sm ${notice.tone === "success" ? "border-success/20 bg-success-surface text-success" : "border-danger/20 bg-danger-surface text-danger"}`}><span>{notice.text}</span><button onClick={() => setNotice(null)}><X className="h-4 w-4" /></button></div>}

      {/* Roadmap strip from Events intelligence */}
      {!selectedId && upcoming.length > 0 && (
        <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-secondary">Campaign roadmap</h3>
            <button onClick={() => navigate("/events")} className="text-xs font-semibold text-primary hover:underline">Open Events</button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {upcoming.map((event) => (
              <div key={event._id} className="min-w-[220px] shrink-0 rounded-lg border border-outline-variant/40 bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase text-info">{event.daysUntil <= 0 ? "today" : `${event.daysUntil}d`}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${event.prepDaysLeft <= 0 ? "bg-danger-surface text-danger" : event.prepDaysLeft <= 14 ? "bg-warning-surface text-warning" : "bg-surface-container-high text-secondary"}`}>{event.prepDaysLeft <= 0 ? "prep overdue" : `prep ${event.prepDaysLeft}d`}</span>
                </div>
                <p className="mt-2 text-sm font-bold text-on-surface">{event.name}</p>
                <p className="text-[11px] text-secondary">{dateFmt.format(event.date)}{event.marketplace ? ` · ${event.marketplace}` : ""}</p>
                <button onClick={() => openCreateForEvent(event)} className="mt-2 flex w-full items-center justify-center gap-1 rounded-md bg-primary/10 px-2 py-1.5 text-[11px] font-bold text-primary hover:bg-primary/20"><Sparkles className="h-3 w-3" /> Plan catalog</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Catalog list */}
      {!selectedId && (
        catalogs === undefined ? (
          <div className="rounded-xl border border-outline-variant/30 bg-white p-10 text-center text-sm text-secondary">Loading catalogs…</div>
        ) : catalogs.length ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {catalogs.map((catalog) => (
              <button key={catalog._id} onClick={() => { setSelectedId(catalog._id); setFocusSku(null); }} className="rounded-xl border border-outline-variant/40 bg-white p-5 text-left shadow-sm transition hover:-translate-y-px hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-soft-blush text-primary"><Layers className="h-5 w-5" /></div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${statusChip(catalog.status)}`}>{statusLabel(catalog.status)}</span>
                </div>
                <h3 className="mt-4 font-syne text-lg font-bold text-on-surface">{catalog.name}</h3>
                <p className="mt-1 text-xs text-secondary">{catalog.eventName ? `${catalog.eventName} · ` : ""}{catalog.variantCount} colourway{catalog.variantCount === 1 ? "" : "s"}</p>
                <div className="mt-4 flex items-center justify-between border-t border-outline-variant/30 pt-3 text-[12px]">
                  <span className="text-secondary">{catalog.readyCount}/{catalog.variantCount} ready</span>
                  <span className="font-semibold text-on-surface">{catalog.completedCount} done{catalog.failedCount ? ` · ${catalog.failedCount} failed` : ""}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-outline-variant/50 bg-white p-12 text-center text-sm text-secondary">No catalogs yet. Create one, paste your colourway SKUs, upload front/back per colour, then schedule the batch.</div>
        )
      )}

      {/* Catalog detail */}
      {selectedId && (
        <>
          <button onClick={() => { setSelectedId(null); setFocusSku(null); }} className="flex items-center gap-2 text-sm font-semibold text-secondary hover:text-primary"><ArrowLeft className="h-4 w-4" /> All catalogs</button>

          {selected === undefined ? (
            <div className="rounded-xl border border-outline-variant/30 bg-white p-10 text-center text-sm text-secondary">Loading catalog…</div>
          ) : !selected ? (
            <div className="rounded-xl border border-outline-variant/30 bg-white p-10 text-center text-sm text-secondary">Catalog not found.</div>
          ) : (
            <>
              {/* Catalog overview and workflow */}
              <section className="rounded-2xl border border-outline-variant/40 bg-white p-5 shadow-sm">
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="font-syne text-2xl font-bold text-on-surface">{selected.name}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${statusChip(selected.status)}`}>{statusLabel(selected.status)}</span>
                      {["scheduled", "queued", "processing", "generating"].includes(selected.status) && (
                        <button disabled={busy === "stop-catalog-generation"} onClick={() => void handleStopCatalogGeneration()} className="flex items-center gap-1.5 rounded-lg border border-warning/20 px-2 py-1 text-[11px] font-semibold text-warning hover:bg-warning-surface disabled:opacity-50">
                          {busy === "stop-catalog-generation" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />} Stop generation
                        </button>
                      )}
                      <button disabled={busy === "delete-catalog"} onClick={() => void handleDeleteCatalog()} className="flex items-center gap-1.5 rounded-lg border border-danger/20 px-2 py-1 text-[11px] font-semibold text-danger hover:bg-danger-surface disabled:opacity-50">
                        {busy === "delete-catalog" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Delete
                      </button>
                    </div>
                    <p className="mt-1 text-sm text-secondary">{selected.eventName ? `${selected.eventName} · ` : ""}{selected.variants.length} colourways · {readyCount} ready · {selected.completedSkus || 0} completed{selected.failedSkus ? ` · ${selected.failedSkus} failed` : ""}</p>
                    {selected.scheduledAt && selected.status === "scheduled" && <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-info"><Clock3 className="h-3.5 w-3.5" /> Automatic run: {new Date(selected.scheduledAt).toLocaleString("en-IN")} (Asia/Kolkata)</p>}
                  </div>
                  <div className="rounded-xl bg-surface-container-low px-4 py-3 text-right">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">Catalog readiness</p>
                    <p className="mt-1 font-syne text-xl font-bold text-on-surface">{readyCount}/{selected.variants.length || 0}</p>
                    <p className="text-[11px] text-secondary">colourways ready</p>
                  </div>
                </div>
                {selected.runError && (
                  <div className="mt-4 rounded-xl border border-danger/20 bg-danger-surface px-4 py-3">
                    <p className="text-xs font-bold text-danger">Previous run needs attention</p>
                    <p className="mt-1 text-xs leading-5 text-danger">{selected.runError}</p>
                    <p className="mt-1 text-[11px] text-danger/80">Review the references below, then restart the complete catalog from the schedule section.</p>
                  </div>
                )}
                <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ["1", "Creative direction", `${selected.styleReferences.length}/3 style references`, selected.styleReferences.length > 0],
                    ["2", "Product truth", `${readyCount}/${selected.variants.length} colourways ready`, readyCount > 0],
                    ["3", "Gemini analysis", `${preflightReadyCount}/${readyCount} ready products preflighted`, readyCount > 0 && preflightReadyCount === readyCount],
                    ["4", "Generate", selected.status === "completed" ? "Catalog completed" : "Hero first, then one-by-one", selected.status === "completed"],
                  ].map(([step, title, detail, done]) => (
                    <div key={String(step)} className={`rounded-xl border p-3 ${done ? "border-success/20 bg-success-surface" : "border-outline-variant/35 bg-surface-container-lowest"}`}>
                      <div className="flex items-center gap-2"><span className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold ${done ? "bg-success text-white" : "bg-surface-container-high text-secondary"}`}>{step}</span><p className="text-xs font-bold text-on-surface">{String(title)}</p></div>
                      <p className="mt-2 text-[11px] text-secondary">{String(detail)}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Shared creative direction references */}
              <section className="rounded-2xl border border-outline-variant/40 bg-white p-5 shadow-sm">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Step 1 · Creative direction</p>
                    <h3 className="mt-1 font-syne text-lg font-bold text-on-surface">Shared style / scene references</h3>
                    <p className="mt-1 max-w-2xl text-xs leading-5 text-secondary">Upload up to three references for background, composition, lighting, mood, and styling. They apply to every colourway but never replace the uploaded product.</p>
                  </div>
                  {canEditReferences && selected.styleReferences.length < 3 && (
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm">
                      {busy === "upload-style_reference" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                      Upload reference
                      <input type="file" accept="image/*" className="hidden" disabled={busy === "upload-style_reference"} onChange={(event) => { void pickStyleReference(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                    </label>
                  )}
                </div>
                {selected.styleReferences.length ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {selected.styleReferences.map((reference, index) => (
                      <div key={reference._id} className="group relative overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest">
                        <div className="aspect-[4/3]">{reference.url ? <img src={reference.url} alt={`Style reference ${index + 1}`} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><ImageIcon className="h-5 w-5 text-outline" /></div>}</div>
                        <div className="flex items-center justify-between gap-2 px-3 py-2"><p className="truncate text-[11px] font-semibold text-on-surface">Reference {index + 1}</p>{canEditReferences && <button disabled={busy === `remove-style-${reference._id}`} onClick={() => void removeStyleReference(reference._id)} className="rounded p-1 text-secondary hover:bg-danger-surface hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-outline-variant/50 bg-surface-container-lowest p-4 text-xs text-secondary"><ImageIcon className="h-5 w-5 shrink-0" /><span>No style reference yet. Generation can use the written scene direction, but a visual reference gives Gemini a clearer creative target.</span></div>
                )}
              </section>

              {/* Catalogue styling plan - one stylist decision for every colourway */}
              {selected.stylingPlan && (
                <section className="rounded-2xl border border-outline-variant/40 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Catalogue styling plan</p>
                      <h3 className="mt-1 font-syne text-lg font-bold text-on-surface">Footwear, jewellery & styling</h3>
                      <p className="mt-1 max-w-2xl text-xs leading-5 text-secondary">
                        Proposed from the first analysed colourway and the shared references. Approve it once and every SKU in this catalog is styled identically.
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${selected.awaitingStylingApproval ? "bg-warning-surface text-warning" : "bg-success-surface text-success"}`}>
                      {selected.awaitingStylingApproval ? "Awaiting approval" : "Approved"}
                    </span>
                  </div>
                  {selected.awaitingStylingApproval && (
                    <p className="mb-3 rounded-lg bg-warning-surface px-3 py-2 text-[11px] font-semibold text-warning">
                      Generation is paused for this catalog until the plan is approved.
                    </p>
                  )}
                  <StylingPlanEditor
                    plan={normalizePlan(selected.stylingPlan)}
                    proposed={selected.stylingPlanProposed ? normalizePlan(selected.stylingPlanProposed) : null}
                    title="Applies to every colourway"
                    description="Edit anything the AI proposed. Uploading a new style or model reference resets this plan and asks for approval again."
                    saving={busy === "styling-plan"}
                    saveLabel="Save changes"
                    approveLabel={selected.awaitingStylingApproval ? "Approve and start generating" : "Re-approve"}
                    disabled={!canEditReferences}
                    onSave={(plan) => saveStylingPlan(plan, false)}
                    onApprove={(plan) => saveStylingPlan(plan, true)}
                  />
                </section>
              )}

              {/* Shared model identity reference */}
              <section className="rounded-2xl border border-outline-variant/40 bg-white p-5 shadow-sm">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Optional · Model face lock</p>
                    <h3 className="mt-1 font-syne text-lg font-bold text-on-surface">Model identity reference</h3>
                    <p className="mt-1 max-w-2xl text-xs leading-5 text-secondary">Upload one clear face photo to lock every colourway in this catalog to that exact model, instead of letting the shoot design and self-lock its own face. Leave empty to keep the default behaviour.</p>
                  </div>
                  {canEditReferences && !selected.modelReference && (
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm">
                      {busy === "upload-model_identity" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                      Upload model face
                      <input type="file" accept="image/*" className="hidden" disabled={busy === "upload-model_identity"} onChange={(event) => { void pickModelReference(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                    </label>
                  )}
                </div>
                {selected.modelReference ? (() => {
                  const modelReference = selected.modelReference;
                  return (
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div key={modelReference._id} className="group relative overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest">
                        <div className="aspect-[4/3]">{modelReference.url ? <img src={modelReference.url} alt="Model face reference" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><ImageIcon className="h-5 w-5 text-outline" /></div>}</div>
                        <div className="flex items-center justify-between gap-2 px-3 py-2"><p className="truncate text-[11px] font-semibold text-on-surface">Model face</p>{canEditReferences && <button aria-label="Remove model face reference" disabled={busy === `remove-model-${modelReference._id}`} onClick={() => void removeModelReference(modelReference._id)} className="rounded p-1 text-secondary hover:bg-danger-surface hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>}</div>
                      </div>
                    </div>
                  );
                })() : (
                  <div className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-outline-variant/50 bg-surface-container-lowest p-4 text-xs text-secondary"><ImageIcon className="h-5 w-5 shrink-0" /><span>No model face reference yet. Generation will design and lock its own consistent model, the same as before.</span></div>
                )}
              </section>

              <section className="space-y-4">
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                  <div><p className="text-[10px] font-bold uppercase tracking-widest text-primary">Step 2 · Product truth</p><h3 className="mt-1 font-syne text-lg font-bold text-on-surface">Colourways and garment references</h3><p className="mt-1 text-xs text-secondary">Front and back are required for each SKU. Fabric detail and an additional product photo improve product accuracy.</p></div>
                  <p className={`text-xs font-semibold ${incompleteCount ? "text-warning" : "text-success"}`}>{incompleteCount ? `${incompleteCount} colourway${incompleteCount === 1 ? "" : "s"} still need references` : "All colourways are ready"}</p>
                </div>
                {canEditReferences && (
                  <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
                    <label className="text-sm font-semibold text-secondary">Add colourways (one per line — <span className="font-normal">SKU, colour label</span>)
                      <textarea rows={3} value={addText} onChange={(e) => setAddText(e.target.value)} placeholder={"T45-Bubbly-Pink, Pink\nT45-Bubbly-Green, Green"} className="mt-1.5 w-full rounded-lg border border-outline-variant px-3 py-2 font-mono text-[13px] text-on-surface outline-none focus:border-primary" />
                    </label>
                    <button disabled={busy === "add"} onClick={addMore} className="mt-2 flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add colourways</button>
                  </div>
                )}

                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
                {/* SKU list */}
                <div className="space-y-2">
                  {selected.variants.length === 0 && <div className="rounded-xl border border-dashed border-outline-variant/50 bg-white p-8 text-center text-sm text-secondary">No colourways yet — add some above.</div>}
                  {selected.variants.map((variant) => (
                    <button key={variant._id} onClick={() => setFocusSku(variant._id)} className={`flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition ${focusSku === variant._id ? "border-primary/40 ring-1 ring-primary/20" : "border-outline-variant/40 hover:border-outline"}`}>
                      {variant.frontUrl ? <img src={variant.frontUrl} alt="front" className="h-14 w-11 rounded-md border border-outline-variant/40 object-cover" /> : <div className="grid h-14 w-11 place-items-center rounded-md bg-surface-container text-outline-variant"><ImageIcon className="h-4 w-4" /></div>}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-sm font-bold text-on-surface">{variant.sku}</p>
                        {variant.readinessStatus === "ready" && <p className={`mt-0.5 flex items-center gap-1 text-[10px] font-semibold ${variant.analysisStatus === "ready" ? "text-success" : variant.analysisStatus === "failed" ? "text-danger" : "text-info"}`}>{variant.analysisStatus === "analyzing" && <Loader2 className="h-3 w-3 animate-spin" />}{variant.analysisStatus === "ready" ? "Gemini analysis ready" : variant.analysisStatus === "failed" ? "Analysis will retry before generation" : "Gemini preflight running"}</p>}
                        <p className="text-[11px] text-secondary">{variant.colorLabel || "—"}</p>
                      </div>
                      {variant.outputs.length > 0 && <span className="text-[11px] font-semibold text-secondary">{variant.outputs.filter((o) => o.status === "completed").length}/{variant.outputs.length}</span>}
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${statusChip(variant.readinessStatus === "ready" && variant.status === "draft" ? "ready" : variant.status)}`}>{variant.readinessStatus === "ready" && variant.status === "draft" ? "ready" : variant.status}</span>
                    </button>
                  ))}
                </div>

                {/* Inspector */}
                <aside className="rounded-xl border border-outline-variant/40 bg-white p-4 shadow-sm">
                  {!focusVariant ? (
                    <div className="grid place-items-center gap-2 py-12 text-center text-sm text-secondary"><ImageIcon className="h-6 w-6" /><span>Select a colourway to manage all product references.</span></div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between">
                        <div><p className="font-mono text-sm font-bold text-on-surface">{focusVariant.sku}</p><p className="text-[11px] text-secondary">{focusVariant.colorLabel || "—"}</p></div>
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${statusChip(focusVariant.status)}`}>{focusVariant.status}</span>
                      </div>
                      {canEditReferences && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {[
                            ["front", "Front product *", focusVariant.frontUrl],
                            ["back", "Back product *", focusVariant.backUrl],
                            ["fabric_pattern", "Fabric / pattern", focusVariant.fabricPatternUrl],
                            ["additional_product", "Additional product", focusVariant.additionalProductUrl],
                          ].map(([role, label, url]) => (
                            <label key={role as string} className="group cursor-pointer">
                              <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-container-lowest transition group-hover:border-primary/40">
                                {url ? <img src={url as string} alt={label as string} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center gap-1 px-2 text-center text-[10px] font-semibold text-secondary">{busy === `upload-${role}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <><UploadCloud className="h-4 w-4" /><span>{label}</span></>}</div>}
                                {url && <span className="absolute inset-x-2 bottom-2 rounded bg-navy-soft/75 px-2 py-1 text-center text-[9px] font-bold text-white opacity-0 transition group-hover:opacity-100">Replace {label}</span>}
                              </div>
                              <input type="file" accept="image/*" className="hidden" onChange={(event) => { void pickImage(role as string, event.target.files?.[0], focusVariant.sku); event.currentTarget.value = ""; }} />
                            </label>
                          ))}
                        </div>
                      )}
                      {canEditReferences && focusVariant.readinessStatus !== "ready" && <p className="mt-2 rounded-lg bg-warning-surface px-3 py-2 text-[11px] text-warning">{(focusVariant.readinessReasons || []).join(" ")}</p>}
                      {focusVariant.readinessStatus === "ready" && <div className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] ${focusVariant.analysisStatus === "ready" ? "bg-success-surface text-success" : focusVariant.analysisStatus === "failed" ? "bg-danger-surface text-danger" : "bg-info-surface text-info"}`}>{focusVariant.analysisStatus === "ready" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}<span>{focusVariant.analysisStatus === "ready" ? "Product identity and five-pose plan are preflighted." : focusVariant.analysisStatus === "failed" ? "Preflight failed; it will rebuild before generation." : "Gemini is analyzing the product, references, and five-pose plan automatically."}</span></div>}
                      {focusVariant.jobStatus === "queued" && focusVariant.jobError && (
                        <div className="mt-2 rounded-lg bg-info-surface px-3 py-2 text-[11px] leading-4 text-info">
                          <p className="font-bold">Automatic retry queued</p>
                          <p>{focusVariant.retryAvailableAt && focusVariant.retryAvailableAt > Date.now() ? `Next attempt at ${new Date(focusVariant.retryAvailableAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}. ` : ""}{focusVariant.jobError}</p>
                        </div>
                      )}
                      {focusVariant.outputs.length > 0 && (
                        <div className="mt-3">
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-secondary">Generated</p>
                          <div className="grid grid-cols-5 gap-1">
                            {focusVariant.outputs.map((output) => (
                              <div key={output.poseNumber} className="aspect-[3/4] overflow-hidden rounded bg-surface-container-lowest" title={`${output.title} — ${output.status}`}>
                                {output.url ? <img src={output.url} alt={output.title} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center">{output.status === "failed" ? <X className="h-3 w-3 text-danger" /> : output.status === "completed" ? <CheckCircle2 className="h-3 w-3 text-success" /> : <Loader2 className="h-3 w-3 animate-spin text-secondary" />}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="mt-3 flex items-center justify-between">
                        {focusVariant.status === "failed" && selected.hasLockedAnchor ? (
                          <button onClick={() => void retryVariant({ skuId: focusVariant._id }).then(() => notify("success", "Retry queued.")).catch((r) => notify("error", getErrorMessage(r, "Retry failed.")))} className="flex items-center gap-1 text-[11px] font-bold text-primary"><RefreshCcw className="h-3 w-3" /> Retry</button>
                        ) : focusVariant.status === "failed" ? <span className="text-[10px] text-secondary">Restart the catalog below</span> : <span />}
                        {canEditReferences && <button onClick={() => void removeVariant({ skuId: focusVariant._id }).then(() => setFocusSku(null)).catch((r) => notify("error", getErrorMessage(r, "Could not remove.")))} className="rounded p-1 text-secondary hover:bg-danger-surface hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>}
                      </div>
                    </>
                  )}
                  </aside>
                </div>
              </section>

              {/* Automatic analysis and generation schedule */}
              <section className="rounded-2xl border border-outline-variant/40 bg-white p-5 shadow-sm">
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_430px]">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Steps 3–4 · Analyze and generate</p>
                    <h3 className="mt-1 font-syne text-lg font-bold text-on-surface">Automatic catalog generation</h3>
                    <p className="mt-1 max-w-2xl text-xs leading-5 text-secondary">At the scheduled time, Gemini analyzes the hero references and locks the five-pose plan. GPT Image 2 generates the hero first, then each ready colourway one-by-one with the same approved model and scene.</p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {[
                        [Sparkles, "Gemini preflight", "Product, style, and five-pose plan"],
                        [ShieldCheck, "Consistency anchor", "Hero Pose 1 locks model and scene"],
                        [Layers, "Sequential queue", "One colourway at a time for reliability"],
                        [RefreshCcw, "Automatic recovery", "Provider and QA retries are bounded"],
                      ].map(([Icon, title, detail]) => (
                        <div key={String(title)} className="flex gap-3 rounded-xl bg-surface-container-lowest p-3"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><p className="text-xs font-bold text-on-surface">{String(title)}</p><p className="mt-0.5 text-[10px] leading-4 text-secondary">{String(detail)}</p></div></div>
                      ))}
                    </div>
                    <div className={`mt-4 rounded-xl px-4 py-3 text-xs ${readyCount ? "bg-success-surface text-success" : "bg-warning-surface text-warning"}`}>
                      {readyCount ? `${readyCount} ready colourway${readyCount === 1 ? "" : "s"} will be included.${incompleteCount ? ` ${incompleteCount} incomplete colourway${incompleteCount === 1 ? " is" : "s are"} excluded until front and back are uploaded.` : ""}` : "Upload front and back product images for at least one colourway before scheduling."}
                    </div>
                  </div>

                  <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
                    {selected.status === "scheduled" ? (
                      <div>
                        <div className="flex items-center gap-2 text-info"><CalendarClock className="h-5 w-5" /><p className="text-sm font-bold">Automatic run scheduled</p></div>
                        <p className="mt-3 font-syne text-xl font-bold text-on-surface">{selected.scheduledAt ? new Date(selected.scheduledAt).toLocaleDateString("en-IN", { dateStyle: "long" }) : "Scheduled"}</p>
                        <p className="mt-1 text-sm text-secondary">{selected.scheduledAt ? new Date(selected.scheduledAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""} · Asia/Kolkata</p>
                        <label className="mt-4 block text-xs font-bold text-on-surface">Change run time<input type="datetime-local" value={scheduleAt} min={toDateTimeInput(Date.now())} onChange={(event) => setScheduleAt(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-outline-variant bg-white px-3 text-sm font-normal outline-none focus:border-primary" /></label>
                        <button disabled={busy === "schedule" || !scheduleAt} onClick={() => void runSchedule(new Date(scheduleAt).getTime())} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === "schedule" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} Save new time</button>
                        <button disabled={busy === "cancel-schedule"} onClick={() => void cancelSchedule()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-danger/30 px-4 py-2.5 text-sm font-semibold text-danger disabled:opacity-50">{busy === "cancel-schedule" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Cancel schedule</button>
                      </div>
                    ) : selected.status === "generating" ? (
                      <div className="py-5 text-center">
                        <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" />
                        <p className="mt-3 text-sm font-bold text-on-surface">Catalog generation is running</p>
                        {activeVariant ? (
                          <div className="mt-2 rounded-lg bg-white px-3 py-2 text-left text-xs leading-5 text-secondary">
                            <p><span className="font-bold text-on-surface">{activeVariant.sku}</span> · {activeVariant.jobStatus === "queued" ? "waiting for worker" : activeVariant.jobStatus === "cancelling" ? "cancelling" : `pose ${Math.max(1, activeVariant.jobCurrentPose || 1)} of ${activeVariant.jobTotalPoses || 5}`}</p>
                            <p>{activeVariant.jobCompletedPoses || 0}/{activeVariant.jobTotalPoses || 5} poses stored</p>
                            {activeVariant.jobStatus === "queued" && activeVariant.jobError && <p className="mt-1 text-info">Automatic retry{activeVariant.retryAvailableAt && activeVariant.retryAvailableAt > Date.now() ? ` at ${new Date(activeVariant.retryAvailableAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}: {activeVariant.jobError}</p>}
                          </div>
                        ) : null}
                        {activeVariant?.jobId && <button disabled={busy === "stop-generation"} onClick={() => void stopActiveGeneration()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-warning/30 bg-white px-4 py-2.5 text-sm font-semibold text-warning disabled:opacity-50">{busy === "stop-generation" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Stop active generation</button>}
                        <p className="mt-2 text-xs leading-5 text-secondary">The durable queue continues in the background. You can safely leave this page and follow stored results in History.</p>
                      </div>
                    ) : isDraftable ? (
                      <div>
                        <label className="text-xs font-bold text-on-surface">Generation date and time
                          <input type="datetime-local" value={scheduleAt} min={toDateTimeInput(Date.now())} onChange={(event) => setScheduleAt(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-outline-variant bg-white px-3 text-sm text-on-surface outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
                        </label>
                        <div className="mt-2 flex items-center justify-between text-[10px] text-secondary"><span>Timezone: Asia/Kolkata</span><button type="button" onClick={() => setScheduleAt(nextMorningSlot())} className="font-bold text-primary hover:underline">Tomorrow · 10:00 AM</button></div>
                        {linkedEvent?.prepDeadline && <button disabled={!readyCount || busy === "schedule"} onClick={() => void runSchedule(linkedEvent.prepDeadline)} className="mt-3 w-full rounded-lg border border-outline-variant bg-white px-3 py-2 text-xs font-semibold text-secondary disabled:opacity-50">Use event prep deadline · {new Date(linkedEvent.prepDeadline).toLocaleString("en-IN")}</button>}
                        <button disabled={busy === "schedule" || !readyCount || !scheduleAt} onClick={() => void runSchedule(new Date(scheduleAt).getTime())} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50">{busy === "schedule" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} Schedule automatic generation</button>
                        <div className="my-3 flex items-center gap-3 text-[10px] uppercase tracking-wider text-outline"><span className="h-px flex-1 bg-outline-variant/50" />or<span className="h-px flex-1 bg-outline-variant/50" /></div>
                        <button disabled={busy === "schedule" || !readyCount} onClick={() => void runSchedule(Date.now())} className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-white px-4 py-2.5 text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50">{busy === "schedule" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {selected.status === "failed" ? "Restart complete catalog now" : "Generate ready colourways now"}</button>
                      </div>
                    ) : (
                      <div className="py-5 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-success" /><p className="mt-3 text-sm font-bold text-on-surface">Catalog workflow complete</p></div>
                    )}
                  </div>
                </div>
              </section>

              {/* Trail of Generations & Session IDs */}
              <section className="mt-6 rounded-2xl border border-outline-variant/40 bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Proper Trail</p>
                  <h3 className="mt-1 font-syne text-lg font-bold text-on-surface">Variants &amp; Session History</h3>
                  <p className="mt-1 text-xs leading-5 text-secondary">
                    Below are all the colourways in this catalog. Copy the <b>Session ID</b> to look up the exact generation trail, status, and logs in the History tab.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-secondary">
                    <thead className="bg-surface-container-lowest text-xs uppercase text-on-surface">
                      <tr>
                        <th className="px-4 py-3 font-semibold">SKU</th>
                        <th className="px-4 py-3 font-semibold">Colour Label</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold">Session ID (jobId)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/30">
                      {selected.variants.map((variant) => (
                        <tr key={variant._id} className="hover:bg-surface-container-lowest/50">
                          <td className="px-4 py-3 font-medium text-on-surface">{variant.sku}</td>
                          <td className="px-4 py-3">{variant.colorLabel || "-"}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusChip(variant.status)}`}>
                              {variant.status}
                            </span>
                            {variant.jobStatus && variant.jobStatus !== "idle" && (
                              <span className="ml-2 text-[10px] uppercase text-info">({variant.jobStatus})</span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px]">
                            {variant.jobId ? (
                              <div className="flex items-center gap-2">
                                {variant.jobId}
                                <button
                                  onClick={() => { navigator.clipboard.writeText(variant.jobId); notify("success", "Session ID copied to clipboard!"); }}
                                  className="text-primary hover:underline"
                                >
                                  Copy
                                </button>
                              </div>
                            ) : (
                              "Not started"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-soft/45 p-4">
          <form onSubmit={submitCreate} className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div><p className="text-[11px] font-bold uppercase tracking-widest text-primary">New catalog</p><h3 className="font-syne text-xl font-bold">Colourway batch &amp; shared look</h3></div>
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-md p-2 text-secondary hover:bg-surface-container"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-secondary sm:col-span-2">Catalog name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. T45-Bubbly" className="mt-1.5 h-10 w-full rounded-lg border border-outline-variant px-3 text-on-surface outline-none focus:border-primary" /></label>
              <label className="text-sm font-semibold text-secondary sm:col-span-2">Campaign / season<input value={form.campaign} onChange={(e) => setForm({ ...form, campaign: e.target.value })} placeholder="e.g. Diwali 2026" className="mt-1.5 h-10 w-full rounded-lg border border-outline-variant px-3 text-on-surface outline-none focus:border-primary" /></label>
              <label className="text-sm font-semibold text-secondary sm:col-span-2">Model direction (same across every colour)<input value={form.modelDirection} onChange={(e) => setForm({ ...form, modelDirection: e.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-outline-variant px-3 text-on-surface outline-none focus:border-primary" /></label>
              <label className="text-sm font-semibold text-secondary sm:col-span-2">Backdrop / scene direction<textarea rows={2} value={form.sceneDirection} onChange={(e) => setForm({ ...form, sceneDirection: e.target.value })} className="mt-1.5 w-full rounded-lg border border-outline-variant px-3 py-2 text-sm text-on-surface outline-none focus:border-primary" /></label>
              <label className="text-sm font-semibold text-secondary">Category<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-outline-variant px-3 text-on-surface">{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              <label className="text-sm font-semibold text-secondary">Aspect ratio<select value={form.aspectRatio} onChange={(e) => setForm({ ...form, aspectRatio: e.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-outline-variant px-3 text-on-surface">{ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
              <label className="text-sm font-semibold text-secondary sm:col-span-2">Preferred generation date and time <span className="font-normal">(schedule after references are ready)</span><input type="datetime-local" value={scheduleAt} min={toDateTimeInput(Date.now())} onChange={(event) => setScheduleAt(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-outline-variant px-3 text-on-surface outline-none focus:border-primary" /><span className="mt-1 block text-[10px] font-normal text-secondary">Asia/Kolkata timezone</span></label>
              <label className="text-sm font-semibold text-secondary sm:col-span-2">Colourway SKUs (one per line — <span className="font-normal">SKU, colour label</span>)<textarea rows={4} value={form.skusText} onChange={(e) => setForm({ ...form, skusText: e.target.value })} placeholder={"T45-Bubbly-Pink, Pink\nT45-Bubbly-Green, Green\nT45-Bubbly-Red, Red"} className="mt-1.5 w-full rounded-lg border border-outline-variant px-3 py-2 font-mono text-[13px] text-on-surface outline-none focus:border-primary" /></label>
              <label className="flex items-center gap-2 text-sm font-semibold text-secondary sm:col-span-2"><input type="checkbox" checked={form.poseQa} onChange={(e) => setForm({ ...form, poseQa: e.target.checked })} className="accent-primary" /> Run Gemini consistency QA on every pose (recommended)</label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold">Cancel</button>
              <button disabled={busy === "create"} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === "create" && <Loader2 className="h-4 w-4 animate-spin" />}Create catalog</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
