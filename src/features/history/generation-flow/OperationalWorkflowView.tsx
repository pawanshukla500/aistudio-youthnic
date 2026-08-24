import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  ListChecks,
  Loader2,
  MessageSquare,
  PackageCheck,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  UserRound,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { saveAs } from "file-saver";
import { invokeAppApi } from "../../../lib/backend";

type Member = { id: string; display_name?: string; email?: string } | null;
type WorkflowStage = {
  code: string;
  groupKey: string;
  title: string;
  description: string;
  order: number;
  progressPercent: number;
  defaultNextAction: string;
  status: "completed" | "current" | "pending";
  startedAt?: string | null;
  completedAt?: string | null;
  durationSeconds?: number;
};
type AssetVersion = Record<string, any> & {
  id?: string;
  generation_id?: string;
  pose_index: number;
  version_number: number;
  preview_url?: string;
  original_url?: string;
  final_asset_url?: string;
  storage_path?: string;
  generation_status?: string;
  approval_status?: string;
  generated_at?: string;
  model?: string;
  prompt?: string;
  reviewer_comments?: string;
};
type PoseGroup = {
  poseIndex: number;
  title: string;
  current: AssetVersion | null;
  versions: AssetVersion[];
  reviews: any[];
};
type WorkflowData = Record<string, any> & {
  item: Record<string, any> & {
    id: string;
    sku_name: string;
    request_code: string;
    workflow_stage: string;
    workflow_progress: number;
    next_action?: string;
    current_step?: string;
    generation_assigned_member?: Member;
    listing_assigned_member?: Member;
  };
  batch?: Record<string, any> | null;
  generationJob?: Record<string, any> | null;
  stages: WorkflowStage[];
  poses: PoseGroup[];
  dependencies: Array<Record<string, any>>;
  activity: Array<Record<string, any>>;
  comments: Array<Record<string, any>>;
  assignments: Array<Record<string, any>>;
  actions: Array<{ type: string; label: string; enabled: boolean }>;
  progress: { percent: number; completedPoseCount: number; totalPoseCount: number; currentPose: number; currentStep: string };
  permissions: { canManage: boolean; canApprove: boolean; canList: boolean; canRegenerate: boolean };
};

type DownloadedAsset = {
  storagePath: string;
  poseIndex: number;
  title: string;
  base64?: string;
  mimeType?: string;
  error?: string;
};

const panels = [
  { id: "flow", label: "Live flow", icon: Zap },
  { id: "assets", label: "Five-pose set", icon: ImageIcon },
  { id: "activity", label: "Activity", icon: ListChecks },
  { id: "brief", label: "Creative brief", icon: FileText },
] as const;

function words(value: unknown) {
  return String(value || "").replaceAll("_", " ");
}

function memberName(member: Member | undefined) {
  return member?.display_name || member?.email || "Unassigned";
}

function dateTime(value: unknown) {
  if (!value) return "Not recorded";
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
}

function duration(seconds?: number | null) {
  if (!seconds) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", !hours ? `${remaining}s` : ""].filter(Boolean).join(" ");
}

function safeFilename(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "catalog";
}

function extension(mimeType = "image/png") {
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

function base64Blob(base64: string, mimeType: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

function stageTone(stage: WorkflowStage) {
  if (stage.status === "current") {
    return stage.code === "blocked_failed" || stage.code === "regeneration_required"
      ? "border-red-300 bg-red-50 text-red-800 shadow-red-100"
      : "border-primary/40 bg-white text-on-surface shadow-primary/10";
  }
  if (stage.status === "completed") return "border-emerald-200 bg-emerald-50/70 text-emerald-900 shadow-emerald-50";
  return "border-outline-variant/35 bg-white/60 text-secondary shadow-transparent";
}

function dependencyTone(status: string) {
  if (status === "complete") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === "failed" || status === "missing") return "bg-red-50 text-red-700 ring-red-200";
  if (status === "in_progress" || status === "ready") return "bg-blue-50 text-blue-700 ring-blue-200";
  return "bg-amber-50 text-amber-700 ring-amber-200";
}

export function OperationalWorkflowView({ data, onRefresh, onBack }: { data: WorkflowData; onRefresh: () => Promise<void>; onBack?: () => void }) {
  const navigate = useNavigate();
  const [panel, setPanel] = useState<(typeof panels)[number]["id"]>("flow");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [comment, setComment] = useState("");
  const [expandedPose, setExpandedPose] = useState<number | null>(null);
  const [editingBrief, setEditingBrief] = useState(false);
  const [briefDraft, setBriefDraft] = useState({
    priority: data.item.priority || "normal",
    deadlineAt: data.item.deadline_at ? String(data.item.deadline_at).slice(0, 16) : "",
    marketplaces: (data.item.marketplaces || []).join(", "),
    campaignSeason: data.item.campaign_season || "",
    specialInstructions: data.item.special_instructions || "",
    remarks: data.item.remarks || "",
    blockedReason: data.item.blocked_reason || "",
    lookAndMood: data.creativeDirection?.look_and_mood || "",
    modelDirection: data.creativeDirection?.model_direction || "",
    stylingRequirements: data.creativeDirection?.styling_requirements || "",
    backgroundBackdrop: data.creativeDirection?.background_backdrop || "",
    lighting: data.creativeDirection?.lighting || "",
    composition: data.creativeDirection?.composition || "",
    marketplaceRequirements: data.creativeDirection?.marketplace_requirements || "",
  });
  const item = data.item;
  const currentStage = data.stages.find((stage) => stage.status === "current");
  const activeAction = data.actions.find((action) => action.enabled);
  const completedPoses = data.poses.filter((pose) => pose.current?.generation_status === "completed").length;
  const startedAt = item.generation_started_at || item.request_date || item.created_at;
  const elapsedSeconds = startedAt ? Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000)) : 0;

  const stageGroups = useMemo(() => {
    const groups = new Map<string, WorkflowStage[]>();
    for (const stage of data.stages) groups.set(stage.groupKey, [...(groups.get(stage.groupKey) || []), stage]);
    return [...groups.entries()];
  }, [data.stages]);

  useEffect(() => {
    if (editingBrief) return;
    setBriefDraft({
      priority: data.item.priority || "normal",
      deadlineAt: data.item.deadline_at ? String(data.item.deadline_at).slice(0, 16) : "",
      marketplaces: (data.item.marketplaces || []).join(", "),
      campaignSeason: data.item.campaign_season || "",
      specialInstructions: data.item.special_instructions || "",
      remarks: data.item.remarks || "",
      blockedReason: data.item.blocked_reason || "",
      lookAndMood: data.creativeDirection?.look_and_mood || "",
      modelDirection: data.creativeDirection?.model_direction || "",
      stylingRequirements: data.creativeDirection?.styling_requirements || "",
      backgroundBackdrop: data.creativeDirection?.background_backdrop || "",
      lighting: data.creativeDirection?.lighting || "",
      composition: data.creativeDirection?.composition || "",
      marketplaceRequirements: data.creativeDirection?.marketplace_requirements || "",
    });
  }, [data.creativeDirection, data.item, editingBrief]);

  const run = async (key: string, task: () => Promise<unknown>, success: string) => {
    setBusy(key);
    setNotice(null);
    try {
      await task();
      await onRefresh();
      setNotice({ tone: "success", text: success });
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      setBusy("");
    }
  };

  const runWorkflowAction = async (type: string) => {
    if (type === "approve") {
      const comments = window.prompt("Optional approval comments for the Listing Team:", "") ?? null;
      if (comments === null) return;
      return run("approve", () => invokeAppApi("catalogProduction.reviewQc", { workItemId: item.id, decision: "passed", comments }), "Five-pose set approved and the Listing Team package is ready.");
    }
    if (type === "reject") {
      const comments = window.prompt("Describe exactly what must change before re-generation:", "");
      if (!comments?.trim()) return;
      return run("reject", () => invokeAppApi("catalogProduction.reviewQc", { workItemId: item.id, decision: "rejected", comments }), "Re-generation guidance recorded.");
    }
    if (type === "retry_generation") {
      if (!window.confirm(`Retry generation for ${item.sku_name}? Existing approved state will reopen.`)) return;
      return run("retry", () => invokeAppApi("catalogProduction.bulkGenerate", { workItemIds: [item.id] }), "Generation retry queued.");
    }
    if (type === "send_handoff") {
      if (!window.confirm("Send one consolidated approval handoff for every ready SKU now?")) return;
      return run("handoff", () => invokeAppApi("catalogProduction.handoffs.send", {}), "Approved packages sent to the Listing Team.");
    }
    if (type === "start_listing") return run("listing-start", () => invokeAppApi("catalogProduction.startListing", { workItemId: item.id }), "Listing work started.");
    if (type === "complete_listing") return run("listing-done", () => invokeAppApi("catalogProduction.markListingDone", { workItemId: item.id }), "Marketplace listing marked complete.");
  };

  const regeneratePose = async (pose: PoseGroup) => {
    const poseId = pose.current?.generation_id || pose.current?.generationId;
    if (!poseId) return setNotice({ tone: "error", text: "This pose has no generation record to retry." });
    const instructions = window.prompt(`What should change in Pose ${pose.poseIndex}?`, pose.current?.reviewer_comments || "");
    if (instructions === null) return;
    await run(`pose:${pose.poseIndex}`, () => invokeAppApi("catalogProduction.regeneratePose", {
      workItemId: item.id,
      poseId,
      extraInstructions: instructions,
    }), `Pose ${pose.poseIndex} re-generation queued.`);
  };

  const addComment = async () => {
    const body = comment.trim();
    if (!body) return;
    await run("comment", () => invokeAppApi("catalogProduction.comment", { workItemId: item.id, body }), "Comment added.");
    setComment("");
  };

  const saveBrief = async () => {
    const saved = await run("brief", () => invokeAppApi("catalogProduction.update", {
      workItemId: item.id,
      priority: briefDraft.priority,
      deadlineAt: briefDraft.deadlineAt ? new Date(briefDraft.deadlineAt).toISOString() : null,
      marketplaces: briefDraft.marketplaces.split(/[,\n]/).map((value: string) => value.trim()).filter(Boolean),
      campaignSeason: briefDraft.campaignSeason,
      specialInstructions: briefDraft.specialInstructions,
      remarks: briefDraft.remarks,
      blockedReason: briefDraft.blockedReason,
      creativeDirection: {
        lookAndMood: briefDraft.lookAndMood,
        modelDirection: briefDraft.modelDirection,
        stylingRequirements: briefDraft.stylingRequirements,
        poses: data.creativeDirection?.pose_direction || [],
        backgroundBackdrop: briefDraft.backgroundBackdrop,
        lighting: briefDraft.lighting,
        composition: briefDraft.composition,
        marketplaceRequirements: briefDraft.marketplaceRequirements,
      },
    }), "Production details and creative direction saved.");
    if (saved) setEditingBrief(false);
  };

  const fetchAssets = async (poses: PoseGroup[]) => invokeAppApi<{ assets: DownloadedAsset[] }>("catalogProduction.downloadAssets", {
    workItemId: item.id,
    poseIndexes: poses.map((pose) => pose.poseIndex),
    storagePaths: poses.map((pose) => pose.current?.storage_path).filter(Boolean),
  });

  const downloadPose = async (pose: PoseGroup) => {
    setBusy(`download:${pose.poseIndex}`);
    setNotice(null);
    try {
      const result = await fetchAssets([pose]);
      const asset = result.assets.find((entry) => entry.poseIndex === pose.poseIndex) || result.assets[0];
      if (!asset?.base64) throw new Error(asset?.error || "The original asset could not be downloaded.");
      const mimeType = asset.mimeType || "image/png";
      saveAs(base64Blob(asset.base64, mimeType), `${safeFilename(item.sku_name)}-pose-${pose.poseIndex}-v${pose.current?.version_number || 1}.${extension(mimeType)}`);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy("");
    }
  };

  const downloadAll = async () => {
    const available = data.poses.filter((pose) => pose.current?.generation_status === "completed");
    if (!available.length) return;
    setBusy("download-all");
    setNotice(null);
    try {
      const [{ default: JSZip }, result] = await Promise.all([import("jszip"), fetchAssets(available)]);
      const zip = new JSZip();
      for (const asset of result.assets) {
        if (asset.base64) zip.file(`pose-${asset.poseIndex}.${extension(asset.mimeType)}`, asset.base64, { base64: true });
      }
      saveAs(await zip.generateAsync({ type: "blob" }), `${safeFilename(item.sku_name)}-approved-five-pose-set.zip`);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="min-h-full overflow-hidden rounded-[28px] border border-outline-variant/35 bg-[#f7f7fc] shadow-[0_24px_80px_rgba(29,34,61,0.08)]">
      <header className="relative overflow-hidden bg-[#182033] px-5 py-5 text-white sm:px-7 lg:px-8">
        <div className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-primary/35 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-28 w-72 rounded-full bg-teal-400/10 blur-3xl" />
        <div className="relative">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <button onClick={() => onBack ? onBack() : navigate(-1)} className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:bg-white/10 hover:text-white">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white/55">
                <span>{item.request_code}</span><span className="h-1 w-1 rounded-full bg-white/25" /><span>{data.batch?.name || "Standalone requirement"}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[10px] tracking-[0.12em] text-emerald-200"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" /> Live</span>
              </div>
              <h1 className="mt-3 font-syne text-2xl font-bold tracking-tight sm:text-3xl">{item.sku_name}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/65">
                <span className="inline-flex items-center gap-1.5"><PackageCheck className="h-3.5 w-3.5" /> {currentStage?.title || words(item.workflow_stage)}</span>
                <span className="inline-flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" /> {memberName(item.generation_assigned_member)}</span>
                <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> Active {duration(elapsedSeconds)}</span>
                {item.deadline_at && <span className="inline-flex items-center gap-1.5 text-amber-200"><CalendarClock className="h-3.5 w-3.5" /> Due {dateTime(item.deadline_at)}</span>}
              </div>
            </div>
            <div className="w-full rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-sm xl:w-[390px]">
              <div className="flex items-center justify-between gap-4"><p className="text-xs font-bold uppercase tracking-[0.15em] text-white/55">Workflow progress</p><p className="font-syne text-2xl font-bold">{data.progress.percent}%</p></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-pink-400 via-rose-400 to-amber-300 transition-all duration-700" style={{ width: `${Math.max(2, data.progress.percent)}%` }} /></div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-white/60"><span>{completedPoses}/5 poses generated</span><span>{item.next_action || currentStage?.defaultNextAction}</span></div>
              {activeAction && <button disabled={Boolean(busy)} onClick={() => void runWorkflowAction(activeAction.type)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#182033] transition hover:bg-white/90 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}{activeAction.label}</button>}
            </div>
          </div>
          <nav className="mt-6 flex gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-black/10 p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {panels.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setPanel(id)} className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition ${panel === id ? "bg-white text-[#182033] shadow" : "text-white/65 hover:bg-white/10 hover:text-white"}`}><Icon className="h-3.5 w-3.5" />{label}</button>)}
          </nav>
        </div>
      </header>

      {notice && <div className={`mx-4 mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm sm:mx-6 ${notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{notice.tone === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}<span className="flex-1">{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Dismiss"><X className="h-4 w-4" /></button></div>}

      {panel === "flow" && (
        <main className="space-y-6 p-4 sm:p-6 lg:p-8">
          <section>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Operational workflow</p><h2 className="mt-1 font-syne text-xl font-bold text-on-surface">Every stage, owner, dependency and next action</h2></div><p className="text-xs text-secondary">Updated from database activity records</p></div>
            <div className="space-y-5">
              {stageGroups.map(([group, stages]) => (
                <div key={group} className="grid gap-3 lg:grid-cols-[110px_minmax(0,1fr)]">
                  <div className="pt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-secondary">{words(group)}</div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {stages.map((stage) => (
                      <article key={stage.code} className={`relative min-h-36 rounded-2xl border p-4 shadow-lg transition ${stageTone(stage)}`}>
                        {stage.status === "current" && <span className="absolute right-4 top-4 h-2.5 w-2.5 animate-pulse rounded-full bg-primary ring-4 ring-primary/10" />}
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/5">{stage.status === "completed" ? <Check className="h-4 w-4 text-emerald-600" /> : stage.status === "current" ? <Zap className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4 text-outline" />}</div>
                        <p className="mt-3 text-sm font-bold">{stage.title}</p>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-4 opacity-70">{stage.description}</p>
                        <div className="mt-3 flex items-center justify-between text-[10px] font-semibold opacity-65"><span>{stage.status === "current" ? `Started ${dateTime(stage.startedAt)}` : stage.status === "completed" ? "Completed" : "Waiting"}</span><span>{duration(stage.durationSeconds)}</span></div>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,.7fr)]">
            <div className="rounded-2xl border border-outline-variant/35 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Live processing</p><h3 className="mt-1 text-base font-bold text-on-surface">Current execution state</h3></div><Sparkles className="h-5 w-5 text-primary" /></div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Current step", data.progress.currentStep || item.next_action || "Waiting", Zap],
                  ["Pose progress", `${data.progress.completedPoseCount}/${data.progress.totalPoseCount}`, ImageIcon],
                  ["Generation owner", memberName(item.generation_assigned_member), UserRound],
                  ["Listing owner", memberName(item.listing_assigned_member), PackageCheck],
                ].map(([label, value, Icon]) => <div key={String(label)} className="rounded-xl bg-surface-container/55 p-3"><Icon className="h-4 w-4 text-primary" /><p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-secondary">{String(label)}</p><p className="mt-1 truncate text-sm font-bold text-on-surface">{String(value)}</p></div>)}
              </div>
              {item.blocked_reason && <div className="mt-4 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"><XCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="text-sm font-bold">Workflow blocked</p><p className="mt-1 text-xs leading-5">{item.blocked_reason}</p></div></div>}
              <div className="mt-5 flex flex-wrap gap-2">
                {data.actions.map((action) => <button key={action.type} disabled={!action.enabled || Boolean(busy)} onClick={() => void runWorkflowAction(action.type)} className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${action.type === "reject" || action.type === "retry_generation" ? "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100" : "bg-primary text-white hover:bg-primary/90"}`}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : action.type.includes("retry") || action.type === "reject" ? <RotateCcw className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{action.label}</button>)}
                {!data.actions.length && <span className="text-xs text-secondary">No action is required at this stage.</span>}
              </div>
            </div>
            <aside className="rounded-2xl border border-outline-variant/35 bg-white p-5 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Dependencies</p>
              <div className="mt-3 space-y-2.5">{data.dependencies.map((dependency) => <div key={dependency.key} className="flex items-center gap-3 rounded-xl border border-outline-variant/25 p-3"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 ${dependencyTone(dependency.status)}`}>{dependency.status === "complete" ? <Check className="h-4 w-4" /> : dependency.status === "failed" || dependency.status === "missing" ? <X className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-on-surface">{dependency.label}</p><p className="mt-0.5 text-[10px] capitalize text-secondary">{dependency.detail || words(dependency.status)}</p></div></div>)}</div>
            </aside>
          </section>
        </main>
      )}

      {panel === "assets" && (
        <main className="p-4 sm:p-6 lg:p-8">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Approved asset package</p><h2 className="mt-1 font-syne text-xl font-bold text-on-surface">Five-pose output set</h2><p className="mt-1 text-xs text-secondary">Every version, prompt, generation time, approval and reviewer note stays attached to this SKU.</p></div><button onClick={() => void downloadAll()} disabled={!completedPoses || Boolean(busy)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">{busy === "download-all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download five-pose ZIP</button></div>
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {data.poses.map((pose) => {
              const asset = pose.current;
              const open = expandedPose === pose.poseIndex;
              const hasDownloadSource = Boolean(asset && (asset.final_asset_url || asset.original_url || asset.preview_url || asset.storage_path || (asset.generation_id && item.catalog_session_id)));
              const canRegeneratePose = Boolean(asset?.generation_id && item.catalog_session_id);
              return <article key={pose.poseIndex} className="overflow-hidden rounded-2xl border border-outline-variant/35 bg-white shadow-sm">
                <div className="grid min-h-64 sm:grid-cols-[190px_minmax(0,1fr)]">
                  <div className="relative bg-[#e9eaf3]">{asset?.preview_url ? <img src={asset.preview_url} alt={`${item.sku_name} pose ${pose.poseIndex}`} className="h-full min-h-64 w-full object-cover" /> : <div className="grid h-full min-h-64 place-items-center text-center text-xs text-secondary"><ImageIcon className="h-7 w-7" /><span>No preview</span></div>}<span className="absolute left-3 top-3 rounded-full bg-[#182033]/85 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur">Pose {pose.poseIndex}</span></div>
                  <div className="flex min-w-0 flex-col p-4">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-on-surface">{pose.title}</p><p className="mt-1 text-[11px] text-secondary">{asset ? `Version ${asset.version_number} · ${dateTime(asset.generated_at)}` : "Awaiting generation"}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold capitalize ${asset?.approval_status === "approved" ? "bg-emerald-50 text-emerald-700" : asset?.approval_status === "rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{words(asset?.approval_status || asset?.generation_status || "not_started")}</span></div>
                    <div className="mt-4 space-y-2 text-[11px]"><p className="flex justify-between gap-3"><span className="text-secondary">Model</span><span className="truncate font-semibold text-on-surface">{asset?.model || data.generationJob?.model || "Not recorded"}</span></p><p className="flex justify-between gap-3"><span className="text-secondary">Versions</span><span className="font-semibold text-on-surface">{pose.versions.length || (asset ? 1 : 0)}</span></p><p className="flex justify-between gap-3"><span className="text-secondary">Review</span><span className="truncate font-semibold text-on-surface">{asset?.reviewer_comments || (asset ? "No reviewer comment" : "Not ready for review")}</span></p></div>
                    <div className="mt-auto flex flex-wrap gap-2 pt-4">{asset?.preview_url && <a href={asset.final_asset_url || asset.original_url || asset.preview_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-outline-variant px-2.5 py-1.5 text-[11px] font-bold text-secondary"><ExternalLink className="h-3 w-3" /> Open</a>}<button disabled={!hasDownloadSource || Boolean(busy)} onClick={() => void downloadPose(pose)} className="inline-flex items-center gap-1 rounded-lg border border-primary px-2.5 py-1.5 text-[11px] font-bold text-primary disabled:opacity-40">{busy === `download:${pose.poseIndex}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Original</button>{data.permissions.canRegenerate && <button disabled={!canRegeneratePose || Boolean(busy)} onClick={() => void regeneratePose(pose)} className="inline-flex items-center gap-1 rounded-lg bg-surface-container px-2.5 py-1.5 text-[11px] font-bold text-secondary disabled:opacity-40"><RefreshCw className="h-3 w-3" /> Re-generate</button>}</div>
                  </div>
                </div>
                <button onClick={() => setExpandedPose(open ? null : pose.poseIndex)} className="flex w-full items-center justify-between border-t border-outline-variant/25 px-4 py-3 text-xs font-bold text-secondary"><span>Prompt, metadata and version history</span><ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} /></button>
                {open && <div className="space-y-4 border-t border-outline-variant/25 bg-surface-container/25 p-4"><div><p className="text-[10px] font-bold uppercase tracking-wide text-secondary">Prompt</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-on-surface">{asset?.prompt || "Prompt was not recorded."}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-secondary">Version history</p><div className="mt-2 space-y-2">{(pose.versions.length ? pose.versions : asset ? [asset] : []).map((version) => <div key={version.id || `${pose.poseIndex}:${version.version_number}`} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-[11px]"><span className="font-bold text-on-surface">v{version.version_number}</span><span className="text-secondary">{dateTime(version.generated_at)}</span><span className="capitalize text-secondary">{words(version.approval_status)}</span></div>)}</div></div></div>}
              </article>;
            })}
          </div>
        </main>
      )}

      {panel === "activity" && (
        <main className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-8">
          <section className="rounded-2xl border border-outline-variant/35 bg-white p-5 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Audit trail</p><h2 className="mt-1 font-syne text-xl font-bold text-on-surface">Complete SKU activity</h2><div className="mt-5 space-y-1">{data.activity.map((event, index) => <div key={event.id} className="relative flex gap-3 pb-5"><div className="relative z-10 mt-1 h-3 w-3 shrink-0 rounded-full bg-primary ring-4 ring-primary/10" />{index < data.activity.length - 1 && <div className="absolute bottom-0 left-[5px] top-4 w-px bg-outline-variant/50" />}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold capitalize text-on-surface">{words(event.event_type)}</p><time className="text-[10px] text-secondary">{dateTime(event.created_at)}</time></div><p className="mt-1 text-xs leading-5 text-secondary">{event.message || [event.from_status, event.to_status].filter(Boolean).map(words).join(" → ") || "Activity recorded"}</p><p className="mt-1 text-[10px] text-secondary">{memberName(event.actor)} · {event.source}</p></div></div>)}{!data.activity.length && <p className="py-10 text-center text-sm text-secondary">No activity has been recorded yet.</p>}</div></section>
          <aside className="h-fit rounded-2xl border border-outline-variant/35 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" /><h3 className="text-sm font-bold text-on-surface">Comments</h3></div><textarea value={comment} maxLength={4000} onChange={(event) => setComment(event.target.value)} rows={3} placeholder="Add an instruction, blocker, review note, or listing update…" className="mt-4 w-full rounded-xl border border-outline-variant bg-surface-container/20 px-3 py-2.5 text-sm text-on-surface outline-none focus:border-primary" /><button onClick={() => void addComment()} disabled={!comment.trim() || Boolean(busy)} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">{busy === "comment" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />} Add comment</button><div className="mt-5 space-y-3">{data.comments.map((entry) => <div key={entry.id} className="rounded-xl bg-surface-container/55 p-3"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-bold text-on-surface">{memberName(entry.author)}</p><span className="text-[9px] text-secondary">{dateTime(entry.created_at)}</span></div><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-secondary">{entry.body}</p></div>)}{!data.comments.length && <p className="py-5 text-center text-xs text-secondary">No comments yet.</p>}</div></aside>
        </main>
      )}

      {panel === "brief" && (
        <main className="grid gap-5 p-4 sm:p-6 xl:grid-cols-2 lg:p-8">
          <section className="rounded-2xl border border-outline-variant/35 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Structured creative direction</p><h2 className="mt-1 font-syne text-xl font-bold text-on-surface">Visual brief</h2></div>{data.permissions.canManage && !editingBrief && <button onClick={() => setEditingBrief(true)} className="inline-flex items-center gap-2 rounded-lg border border-outline-variant px-3 py-2 text-xs font-bold text-secondary hover:border-primary hover:text-primary"><Pencil className="h-3.5 w-3.5" /> Edit</button>}</div>
            {editingBrief ? <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="text-[10px] font-bold uppercase tracking-wide text-secondary">Priority<select value={briefDraft.priority} onChange={(event) => setBriefDraft({ ...briefDraft, priority: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-outline-variant px-3 text-sm font-normal normal-case tracking-normal text-on-surface"><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
              <label className="text-[10px] font-bold uppercase tracking-wide text-secondary">Deadline<input type="datetime-local" value={briefDraft.deadlineAt} onChange={(event) => setBriefDraft({ ...briefDraft, deadlineAt: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-outline-variant px-3 text-sm font-normal normal-case tracking-normal text-on-surface" /></label>
              <label className="text-[10px] font-bold uppercase tracking-wide text-secondary">Campaign<input value={briefDraft.campaignSeason} onChange={(event) => setBriefDraft({ ...briefDraft, campaignSeason: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-outline-variant px-3 text-sm font-normal normal-case tracking-normal text-on-surface" /></label>
              <label className="text-[10px] font-bold uppercase tracking-wide text-secondary">Marketplaces<input value={briefDraft.marketplaces} onChange={(event) => setBriefDraft({ ...briefDraft, marketplaces: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-outline-variant px-3 text-sm font-normal normal-case tracking-normal text-on-surface" /></label>
              {[
                ["Look & mood", "lookAndMood"], ["Model direction", "modelDirection"], ["Styling", "stylingRequirements"], ["Background", "backgroundBackdrop"], ["Lighting", "lighting"], ["Composition", "composition"], ["Marketplace requirements", "marketplaceRequirements"], ["Special instructions", "specialInstructions"], ["Important remarks", "remarks"], ["Blocked reason", "blockedReason"],
              ].map(([label, key]) => <label key={key} className="text-[10px] font-bold uppercase tracking-wide text-secondary"><span>{label}</span><textarea rows={2} value={String(briefDraft[key as keyof typeof briefDraft])} onChange={(event) => setBriefDraft({ ...briefDraft, [key]: event.target.value })} className="mt-1 w-full rounded-xl border border-outline-variant px-3 py-2 text-sm font-normal normal-case tracking-normal text-on-surface" /></label>)}
              <div className="flex gap-2 sm:col-span-2"><button onClick={() => void saveBrief()} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">{busy === "brief" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save brief</button><button onClick={() => setEditingBrief(false)} className="rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-bold text-secondary">Cancel</button></div>
            </div> : <div className="mt-5 grid gap-3 sm:grid-cols-2">{[
              ["Look & mood", data.creativeDirection?.look_and_mood], ["Model direction", data.creativeDirection?.model_direction], ["Styling", data.creativeDirection?.styling_requirements], ["Background", data.creativeDirection?.background_backdrop], ["Lighting", data.creativeDirection?.lighting], ["Composition", data.creativeDirection?.composition], ["Marketplace", data.creativeDirection?.marketplace_requirements], ["Special instructions", item.special_instructions],
            ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-surface-container/45 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-secondary">{String(label)}</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-on-surface">{String(value || "Not specified")}</p></div>)}</div>}
          </section>
          <section className="rounded-2xl border border-outline-variant/35 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Link2 className="h-4 w-4 text-primary" /><h3 className="text-sm font-bold text-on-surface">References and production facts</h3></div><div className="mt-4 space-y-2">{(data.references || []).map((reference: any) => <a key={reference.id} href={reference.image_url || undefined} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-outline-variant/25 p-3 transition hover:border-primary/40"><ImageIcon className="h-4 w-4 text-primary" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold capitalize text-on-surface">{words(reference.asset_role)}</p><p className="mt-0.5 truncate text-[10px] text-secondary">{reference.storage_path || reference.image_url}</p></div>{reference.image_url && <ExternalLink className="h-3.5 w-3.5 text-secondary" />}</a>)}{!data.references?.length && <p className="rounded-xl border-2 border-dashed border-outline-variant/40 py-8 text-center text-xs text-secondary">No reference metadata is attached.</p>}</div><div className="mt-5 grid grid-cols-2 gap-3 text-xs"><div className="rounded-xl bg-surface-container/45 p-3"><p className="text-secondary">Campaign</p><p className="mt-1 font-bold text-on-surface">{item.campaign_season || data.batch?.campaign_season || "Not set"}</p></div><div className="rounded-xl bg-surface-container/45 p-3"><p className="text-secondary">Marketplaces</p><p className="mt-1 font-bold text-on-surface">{item.marketplaces?.join(", ") || item.portal || "Not set"}</p></div><div className="rounded-xl bg-surface-container/45 p-3"><p className="text-secondary">Model</p><p className="mt-1 font-bold text-on-surface">{data.generationJob?.model || "Not started"}</p></div><div className="rounded-xl bg-surface-container/45 p-3"><p className="text-secondary">Cost</p><p className="mt-1 font-bold text-on-surface">${Number(data.generationJob?.actual_cost_usd || 0).toFixed(3)}</p></div></div></section>
        </main>
      )}
    </div>
  );
}
