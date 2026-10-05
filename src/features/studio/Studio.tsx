import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Ban, Check, CheckCircle2, ChevronRight, History as HistoryIcon, Images, Loader2, Sparkles, Wand2, X } from "lucide-react";
import { api, useAction, useMutation, useQuery, type Id } from "../../lib/backend";
import { Button } from "@/components/ui/button";
import { ActionDialog } from "../../components/ui/ActionDialog";
import { useWorkspace } from "../../lib/WorkspaceContext";
import { uploadCatalogAsset } from "../../lib/catalogStorage";
import { resizeImageFile } from "../../lib/imageResizer";
import { AnalysisProfile } from "./components/AnalysisProfile";
import { OutputSettings } from "./components/OutputSettings";
import { PosePlan } from "./components/PosePlan";
import { ModelFaceReference, ProductReferences, StyleReferences } from "./components/ProductReferences";
import { sareeProfilePresentation } from "./sareeProfilePresentation";
import { promoteLegacySareeReference, remapDetectedSareeReferences } from "./sareeReferenceHandoff";
import { StylingPlanEditor } from "../../components/ui/StylingPlanEditor";
import { normalizePlan, type StylingPlan } from "../../lib/stylingPlan";
import { generationDeliveryProgress } from "../../lib/generationProgress";
import type {
  OutputOptions,
  ProductReferenceRole,
  StudioAnalysis,
  StudioPose,
  StudioReference,
} from "./types";

const basePoses: StudioPose[] = [
  { id: "full_front", title: "Full Front Product View", description: "Straight-on full-body primary listing image.", cameraAngle: "Eye-level front view", highlightedDetails: ["front construction", "complete silhouette"], primaryReference: "front", purpose: "Primary e-commerce listing image", prompt: "Straight-on full-body front view showing the complete product head to hem.", enabled: true },
  { id: "angled", title: "Professional Side / 3/4 View", description: "Three-quarter view showing depth, fit, and construction.", cameraAngle: "35-55 degree three-quarter", highlightedDetails: ["side silhouette", "fit and drape"], primaryReference: "front", purpose: "Show depth and fit", prompt: "Professional three-quarter fashion pose with the full product readable.", enabled: true },
  { id: "back", title: "Full Back View", description: "True back view grounded in the uploaded back image.", cameraAngle: "Straight-on back view", highlightedDetails: ["back neckline", "back construction"], primaryReference: "back", purpose: "Document the real back design", prompt: "Model turned fully around. Reproduce the uploaded back product image exactly.", enabled: true },
  { id: "creative", title: "Creative Gen-Z Fashion Pose", description: "A current, expressive pose that keeps the exact product readable, or a seated editorial pose if the style reference is sitting.", cameraAngle: "Product-appropriate editorial angle", highlightedDetails: ["movement", "creative direction"], primaryReference: "front", purpose: "Campaign and social-commerce storytelling", prompt: "Create a current Gen-Z fashion pose suited to this exact product without hiding or changing it. If the style reference shows a sitting pose, sit this 4th pose as well while keeping garment, bottoms, hem, and footwear visible. Rebuild the backdrop from the style reference only.", enabled: true },
  { id: "closeup", title: "Zoomed-In Product Detail Highlight", description: "A zoomed-in shot that sells the product's most important detail, with the face included only when that detail stays large and readable.", cameraAngle: "Eye-level, zoomed in to a product-detail crop or a face-to-chest/face-to-waist crop that still leaves the detail large", highlightedDetails: ["key product detail", "craftsmanship", "optional face"], primaryReference: "fabric_pattern", purpose: "Social-first product-detail shot", prompt: "Genuinely zoomed-in product-detail shot - not a repeat of the full-body hero. Lead with one sharp, large product detail. Include a beautiful, natural Gen-Z face only when that crop still leaves the detail readable; otherwise crop to the product detail and let the face be partial or omitted.", enabled: true },
  { id: "showcase", title: "Garment-Led Showcase", description: "A sixth frame chosen by the garment: a drape-led pallu frame for sarees, a head-to-toe top-and-bottom frame when the outfit includes bottom wear, a playful backdrop-matched moment for short kurtis and tops, or a full-length fall-and-fit frame.", cameraAngle: "Garment-appropriate full or three-quarter body angle", highlightedDetails: ["garment-specific selling frame"], primaryReference: "front", purpose: "Sell what a buyer of this garment actually judges", prompt: "Create the garment-led showcase frame inside the exact same studio set established in Pose 1, keeping the model identity, styling, footwear, backdrop and lighting unchanged.", enabled: true },
];

const REQUIRED_POSE_COUNT = 6;
const AUTO_ANALYZE_DELAY_MS = 900;

const defaultOptions: OutputOptions = {
  // Empty on purpose: the shoot follows the organization's configured route
  // until someone deliberately overrides it for this session.
  model: "",
  modelIdentity: "Same adult South Asian female fashion model across every pose",
  aspectRatio: "3:4",
  imageSize: "2K",
  quality: "medium",
  backgroundStyle: "Infer a premium consistent scene from the uploaded style reference",
  bottomWear: "auto",
  poseQa: false,
};

async function fileHash(file: File) {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

const PRODUCT_SLOT_NAMES: Record<ProductReferenceRole, string> = {
  front: "Front",
  back: "Back",
  fabric_pattern: "Fabric / Pattern Detail",
  bottom: "Bottom Wear / Farshi",
  mannequin: "Mannequin / Flat-lay",
  additional_product: "Additional Product Photo",
  saree_front_drape: "Full saree front",
  saree_back_drape: "Rear / back drape",
  saree_body_detail: "Body fabric / pattern",
  saree_pallu_spread: "Pallu spread",
  saree_border_tassels: "Border / tassels",
  saree_blouse_front: "Blouse front",
  saree_blouse_back_piece: "Blouse back / piece",
};

const SESSION_SUBMISSIONS_KEY = "youthnic.studio.sessionSubmissions";
const MAX_SESSION_SUBMISSIONS = 12;

function readSessionSubmissions(): string[] {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(SESSION_SUBMISSIONS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && Boolean(value)).slice(0, MAX_SESSION_SUBMISSIONS) : [];
  } catch {
    return [];
  }
}

function writeSessionSubmissions(jobIds: string[]) {
  try {
    window.sessionStorage.setItem(SESSION_SUBMISSIONS_KEY, JSON.stringify(jobIds));
  } catch {
    // Private windows or blocked storage: the tray still works for this page view.
  }
}

function submissionStatusLabel(job: any) {
  if (job.status === "completed") return "Complete";
  if (job.status === "failed") return "Failed";
  if (job.status === "cancelling") return "Stopping…";
  if (job.status === "cancelled") return "Stopped";
  if (job.status === "queued") return "Queued";
  if (job.status === "processing") return "Generating";
  return String(job.status || "Unknown");
}

function SessionSubmissionRow({ jobId, latest, onRemove }: { jobId: string; latest: boolean; onRemove: () => void }) {
  const [finished, setFinished] = useState(false);
  const { data: job, error } = useQuery(api.jobs.get, { jobId }, { poll: !finished });
  const delivery = job ? generationDeliveryProgress(job) : null;
  const terminal = Boolean(job && ["completed", "failed", "cancelled"].includes(job.status));

  useEffect(() => { if (job !== undefined) setFinished(terminal || job === null); }, [terminal, job]);

  return (
    <li className="flex items-center gap-3 rounded-xl border border-outline-variant/40 bg-white p-2.5 shadow-xs transition hover:border-primary/30">
      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-surface-container border border-outline-variant/30">
        {job?.thumbnailUrl ? (
          <img src={job.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Images className="m-3 h-4 w-4 text-secondary/50" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-xs font-bold text-on-surface">
            {job ? job.skuName || job.skuId || "Untitled SKU" : job === null ? "Deleted submission" : "Loading…"}
          </p>
          {latest && (
            <span className="rounded-full bg-soft-blush px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary border border-primary/20">
              Latest
            </span>
          )}
        </div>
        {job && delivery ? (
          <div className="mt-1 flex items-center gap-2.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-container">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  job.status === "failed" ? "bg-danger" : job.status === "completed" ? "bg-emerald-500" : "bg-primary"
                }`}
                style={{ width: `${delivery.deliveredPercent}%` }}
              />
            </div>
            <span
              className={`shrink-0 text-[10px] font-bold ${
                job.status === "failed" ? "text-danger" : job.status === "completed" ? "text-emerald-700" : "text-secondary"
              }`}
            >
              {submissionStatusLabel(job)} · {delivery.imagesStored}/{delivery.totalPoses}
              {delivery.failedPoses ? ` · ${delivery.failedPoses} failed` : ""}
            </span>
          </div>
        ) : job === null ? (
          <p className="mt-0.5 text-[10px] text-secondary">No longer in History.</p>
        ) : error && job === undefined ? (
          <p className="mt-0.5 truncate text-[10px] text-danger">Could not load status: {error.message}</p>
        ) : (
          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-secondary">
            <Loader2 className="h-3 w-3 animate-spin text-primary" /> Fetching status…
          </p>
        )}
      </div>
      {job && !terminal && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
      <Link to="/history" className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold text-primary hover:bg-primary/5">
        View
      </Link>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove from this list"
        title="Remove from this list (the job keeps running)"
        className="shrink-0 rounded-lg p-1.5 text-secondary hover:bg-surface-container hover:text-on-surface"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function makeReference(role: StudioReference["role"], file: File): StudioReference {
  return { id: crypto.randomUUID(), role, file, previewUrl: URL.createObjectURL(file) };
}

function validateFile(file: File) {
  const allowedMimes = ["image/png", "image/jpeg", "image/webp", "image/jpg"];
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const allowedExts = [".png", ".jpg", ".jpeg", ".webp"];
  if (!allowedMimes.includes(file.type.toLowerCase()) && !allowedExts.includes(extension)) {
    return `${file.name} must be PNG, JPEG, or WebP.`;
  }
  if (file.size > 20 * 1024 * 1024) return `${file.name} is larger than 20 MB.`;
  return "";
}

export function Studio() {
  const { organization, user } = useWorkspace();
  const analyzeReferences = useAction(api.analysis.analyzeReferences);
  const updateStylingPlan = useMutation(api.styling.updateSessionPlan);
  const queueSku = useMutation(api.generation.queueSku);
  const cancelJob = useMutation(api.jobs.cancel);

  const [productReferences, setProductReferences] = useState<Partial<Record<ProductReferenceRole, StudioReference>>>({});
  const [styleReferences, setStyleReferences] = useState<StudioReference[]>([]);
  const [modelReference, setModelReference] = useState<StudioReference | null>(null);
  const [poses, setPoses] = useState(basePoses);
  const [analysis, setAnalysis] = useState<StudioAnalysis | null>(null);
  const [savingStylingPlan, setSavingStylingPlan] = useState(false);
  const [analysisSourceKey, setAnalysisSourceKey] = useState<string | null>(null);
  const [sceneDirectionNote, setSceneDirectionNote] = useState("");
  const [garmentSummaryNote, setGarmentSummaryNote] = useState("");
  const [options, setOptions] = useState(defaultOptions);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [sessionJobIds, setSessionJobIds] = useState<string[]>(readSessionSubmissions);
  const [submittedJobId, setSubmittedJobId] = useState<Id<"generationJobs"> | null>(() => sessionJobIds[0] || null);
  const [referenceHashes, setReferenceHashes] = useState<Record<string, string>>({});
  const hashingReferenceIdsRef = useRef(new Set<string>());
  const [skuId, setSkuId] = useState("");
  const [skuName, setSkuName] = useState("");
  const [productDetails, setProductDetails] = useState("");
  const [category, setCategory] = useState("ethnic/fusion");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string; jobId?: Id<"generationJobs"> } | null>(null);
  const analysisRequestRef = useRef(0);
  const uploadPromisesRef = useRef(new Map<string, Promise<StudioReference>>());
  const autoAnalyzeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: submittedJob, error: submittedJobError } = useQuery(api.jobs.get, submittedJobId ? { jobId: submittedJobId } : "skip");
  const { data: queuePosition, error: _queuePositionError } = useQuery(api.jobs.getQueuePosition, submittedJobId && submittedJob?.status === "queued" ? { jobId: submittedJobId } : "skip");
  const { data: effectiveRouting, error: effectiveRoutingError } = useQuery(api.ai.getEffectiveRouting, organization?._id ? { organizationId: organization._id } : "skip");

  const orgModel = (effectiveRouting as any)?.imageGeneration?.model as OutputOptions["model"] | undefined;
  const orgModelLabel = (effectiveRouting as any)?.imageGeneration?.displayLabel as string | undefined;
  const orgModelOptions = ((effectiveRouting as any)?.imageGeneration?.allowedModels || []) as Array<{ id: OutputOptions["model"]; label: string }>;
  const routingStatus: "loading" | "ready" | "error" = effectiveRouting
    ? "ready"
    : effectiveRoutingError
      ? "error"
      : "loading";

  useEffect(() => { writeSessionSubmissions(sessionJobIds); }, [sessionJobIds]);

  useEffect(() => {
    const pending = Object.values(productReferences).filter((reference): reference is StudioReference =>
      Boolean(reference && !referenceHashes[reference.id] && !hashingReferenceIdsRef.current.has(reference.id)));
    for (const reference of pending) {
      hashingReferenceIdsRef.current.add(reference.id);
      void fileHash(reference.file)
        .then((hash) => setReferenceHashes((current) => ({ ...current, [reference.id]: hash })))
        .catch(() => undefined)
        .finally(() => hashingReferenceIdsRef.current.delete(reference.id));
    }
  }, [productReferences, referenceHashes]);

  const duplicateProductSlots = useMemo(() => {
    const rolesByHash = new Map<string, ProductReferenceRole[]>();
    for (const [role, reference] of Object.entries(productReferences) as Array<[ProductReferenceRole, StudioReference | undefined]>) {
      const hash = reference ? referenceHashes[reference.id] : "";
      if (!hash) continue;
      rolesByHash.set(hash, [...(rolesByHash.get(hash) || []), role]);
    }
    return [...rolesByHash.values()].filter((roles) => roles.length > 1);
  }, [productReferences, referenceHashes]);

  const allReferences = useMemo(
    () => [...Object.values(productReferences).filter(Boolean), ...(modelReference ? [modelReference] : []), ...styleReferences] as StudioReference[],
    [modelReference, productReferences, styleReferences],
  );

  // Revoke active blob preview URLs on unmount to free browser memory
  const allReferencesRef = useRef(allReferences);
  allReferencesRef.current = allReferences;
  useEffect(() => {
    return () => {
      allReferencesRef.current.forEach((reference) => {
        if (reference.previewUrl && reference.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(reference.previewUrl);
        }
      });
    };
  }, []);
  const isSareeCategory = category === "saree";
  const requiredReady = isSareeCategory
    ? Boolean(
      (productReferences.saree_front_drape || productReferences.front) &&
      (productReferences.saree_back_drape || productReferences.back) &&
      productReferences.saree_pallu_spread &&
      (productReferences.saree_body_detail || productReferences.fabric_pattern),
    )
    : Boolean(productReferences.front && productReferences.back);
  const effectiveSkuId = skuId.trim() || `studio-${(productReferences.saree_front_drape || productReferences.front)?.id.slice(0, 8) || "draft"}`;
  const effectiveSkuName = skuName.trim() || skuId.trim() || "Untitled studio product";

  const derivedSceneDirection = useMemo(() => analysis ? [
    analysis.creativeDirection.backgroundStyle,
    analysis.creativeDirection.studioEnvironment,
    analysis.creativeDirection.lighting,
    analysis.creativeDirection.mood,
  ].filter(Boolean).join(" · ") : "", [analysis]);
  const derivedGarmentSummary = useMemo(() => analysis ? [
    analysis.productIdentity.category,
    analysis.productIdentity.mainColor,
    analysis.productIdentity.fabric,
    ...(analysis.productIdentity.invariantDetails || []),
  ].filter(Boolean).join(", ") : "", [analysis]);
  const sceneDirectionValue = sceneDirectionNote || derivedSceneDirection;
  const garmentSummaryValue = garmentSummaryNote || derivedGarmentSummary;

  const stopSubmittedJob = async () => {
    if (!submittedJobId) return;
    setStopping(true);
    try {
      await cancelJob({ jobId: submittedJobId });
      setNotice({ tone: "success", text: "Photoshoot cancellation requested. Completed images remain saved in History.", jobId: submittedJobId });
      setStopDialogOpen(false);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not stop this photoshoot." });
    } finally {
      setStopping(false);
    }
  };

  const analysisInputKey = useMemo(
    () => JSON.stringify({
      references: allReferences.map((reference) => ({
        id: reference.id,
        role: reference.role,
      })),
      skuId: effectiveSkuId,
      skuName: effectiveSkuName,
      productDetails: productDetails.trim(),
      category,
      modelDirection: options.modelIdentity,
      sceneDirection: options.backgroundStyle,
      sceneDirectionNote: sceneDirectionNote.trim(),
      garmentSummaryNote: garmentSummaryNote.trim(),
    }),
    [allReferences, category, effectiveSkuId, effectiveSkuName, options.backgroundStyle, options.modelIdentity, productDetails, sceneDirectionNote, garmentSummaryNote],
  );

  const latestAnalysisKeyRef = useRef(analysisInputKey);
  latestAnalysisKeyRef.current = analysisInputKey;
  const analysisIsCurrent = Boolean(analysis && analysisSourceKey === analysisInputKey);
  const analysisIsStale = Boolean(analysis && !analysisIsCurrent);
  const enabledPoseCount = useMemo(() => poses.filter((pose) => pose.enabled && pose.prompt.trim()).length, [poses]);
  const sareeAnalysisReady = !analysis || !sareeProfilePresentation(analysis.productIdentity).incomplete;
  const generationReady = requiredReady && analysisIsCurrent && !analyzing && enabledPoseCount === REQUIRED_POSE_COUNT && sareeAnalysisReady;

  const markAnalysisStale = () => {
    analysisRequestRef.current += 1;
    setAnalysisSourceKey(null);
  };

  const updateText = (setter: (value: string) => void, value: string) => {
    setter(value);
    markAnalysisStale();
    setNotice(null);
  };

  const updateOptions = (next: OutputOptions) => {
    if (
      next.modelIdentity !== options.modelIdentity ||
      next.backgroundStyle !== options.backgroundStyle
    ) {
      markAnalysisStale();
    }
    setOptions(next);
  };

  const changeProductReference = (role: ProductReferenceRole, file: File | null) => {
    if (file) {
      const error = validateFile(file);
      if (error) {
        setNotice({ tone: "error", text: error });
        return;
      }
    }
    setProductReferences((current) => {
      const next = { ...current };
      if (next[role]) URL.revokeObjectURL(next[role]!.previewUrl);
      if (file) next[role] = makeReference(role, file);
      else delete next[role];
      return next;
    });
    markAnalysisStale();
    setNotice(null);
  };

  const promoteLegacyReference = (
    sourceRole: ProductReferenceRole,
    targetRole: "saree_pallu_spread" | "saree_body_detail",
  ) => {
    setProductReferences((current) => {
      return promoteLegacySareeReference(current, sourceRole, targetRole, crypto.randomUUID());
    });
    markAnalysisStale();
    setNotice({ tone: "success", text: targetRole === "saree_pallu_spread" ? "Pallu evidence mapped. Gemini will reanalyse the complete saree reference set." : "Body-detail evidence mapped. Gemini will reanalyse the complete saree reference set." });
  };

  const promoteDetectedSareeReferences = () => {
    setProductReferences(remapDetectedSareeReferences);
  };

  const changeModelReference = (file: File | null) => {
    if (file) {
      const error = validateFile(file);
      if (error) {
        setNotice({ tone: "error", text: error });
        return;
      }
    }
    setModelReference((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return file ? makeReference("model_identity", file) : null;
    });
    markAnalysisStale();
    setNotice(null);
  };

  const addStyleReferences = (files: File[]) => {
    const accepted = files.slice(0, Math.max(0, 3 - styleReferences.length));
    const error = accepted.map(validateFile).find(Boolean);
    if (error) {
      setNotice({ tone: "error", text: error });
      return;
    }
    setStyleReferences((current) => [...current, ...accepted.map((file) => makeReference("style_reference", file))].slice(0, 3));
    markAnalysisStale();
    setNotice(null);
  };

  const removeStyleReference = (id: string) => {
    setStyleReferences((current) => {
      const removed = current.find((reference) => reference.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((reference) => reference.id !== id);
    });
    markAnalysisStale();
  };

  const replaceStyleReference = (id: string, file: File) => {
    const error = validateFile(file);
    if (error) {
      setNotice({ tone: "error", text: error });
      return;
    }
    setStyleReferences((current) => current.map((reference) => {
      if (reference.id !== id) return reference;
      URL.revokeObjectURL(reference.previewUrl);
      return makeReference("style_reference", file);
    }));
    markAnalysisStale();
    setNotice(null);
  };

  const uploadReference = async (reference: StudioReference) => {
    if (reference.uploadedId) return reference;
    const inFlight = uploadPromisesRef.current.get(reference.id);
    if (inFlight) return inFlight;
    const promise = (async () => {
      const resizedFile = await resizeImageFile(reference.file);
      const uploaded = await uploadCatalogAsset({
        organizationId: String(organization._id),
        scope: "references",
        ownerKey: effectiveSkuId,
        role: reference.role,
        file: resizedFile,
      });
      return {
        ...reference,
        file: resizedFile,
        uploadedId: reference.id,
        storageBackend: uploaded.storageBackend,
        storagePath: uploaded.storagePath,
        downloadUrl: uploaded.downloadUrl,
        hash: await fileHash(resizedFile),
      };
    })();
    uploadPromisesRef.current.set(reference.id, promise);
    try {
      return await promise;
    } finally {
      uploadPromisesRef.current.delete(reference.id);
    }
  };

  const runAnalysis = async (sourceKey: string, automatic: boolean, forceRefresh = false) => {
    if (!requiredReady) {
      if (!automatic) setNotice({ tone: "error", text: isSareeCategory ? "Upload the required full front, rear drape, pallu spread, and body-detail saree references first." : "Upload the required front and back product images first." });
      return;
    }
    const requestId = ++analysisRequestRef.current;
    setNotice(null);
    setAnalyzing(true);
    try {
      const uploaded = await Promise.all(allReferences.map(uploadReference));
      const uploadedById = new Map(uploaded.map((reference) => [reference.id, reference]));
      setProductReferences((current) => Object.fromEntries(Object.entries(current).map(([role, reference]) => [role, reference ? uploadedById.get(reference.id) || reference : reference])) as Partial<Record<ProductReferenceRole, StudioReference>>);
      setStyleReferences((current) => current.map((reference) => uploadedById.get(reference.id) || reference));
      setModelReference((current) => current ? uploadedById.get(current.id) || current : current);

      const result = await analyzeReferences({
        organizationId: organization._id,
        createdBy: user._id,
        skuId: effectiveSkuId,
        skuName: effectiveSkuName,
        productDetails: [productDetails.trim(), garmentSummaryNote.trim()].filter(Boolean).join(". "),
        category,
        modelDirection: options.modelIdentity,
        sceneDirection: [options.backgroundStyle, sceneDirectionNote.trim()].filter(Boolean).join(". "),
        references: uploaded.map((reference) => ({
          id: reference.id,
          role: reference.role,
          downloadUrl: reference.downloadUrl,
          storagePath: reference.storagePath,
          storageBackend: reference.storageBackend,
          hash: reference.hash,
          filename: reference.file.name,
          mimeType: reference.file.type,
          size: reference.file.size,
        })),
        forceRefresh,
      }) as StudioAnalysis;
      if (analysisRequestRef.current !== requestId || latestAnalysisKeyRef.current !== sourceKey) return;
      setAnalysis(result);
      setPoses(result.posePlan);
      const detectedSaree = result.productIdentity.garmentFamily?.trim().toLowerCase() === "saree";
      if (detectedSaree && !isSareeCategory) {
        promoteDetectedSareeReferences();
        setCategory("saree");
        setAnalysisSourceKey(null);
        const missingEvidence = result.sareeEvidenceIssues?.join(", ") || "fully spread pallu";
        setNotice({ tone: "success", text: `Saree detected. Front and rear references were preserved; now confirm or upload: ${missingEvidence}. Gemini will reanalyse before generation.` });
      } else {
        setAnalysisSourceKey(sourceKey);
        setNotice({ tone: "success", text: "Authoritative product identity, creative direction, and the six-pose shoot plan are ready." });
      }
    } catch (error) {
      if (analysisRequestRef.current === requestId) {
        setAnalysisSourceKey(null);
        setNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not analyze the references." });
      }
    } finally {
      if (analysisRequestRef.current === requestId) setAnalyzing(false);
    }
  };

  const handleAnalyze = () => {
    if (autoAnalyzeTimerRef.current) clearTimeout(autoAnalyzeTimerRef.current);
    void runAnalysis(analysisInputKey, false, Boolean(analysis));
  };

  const handleSaveStylingPlan = async (plan: StylingPlan) => {
    if (!analysis?.sessionId) return false;
    setSavingStylingPlan(true);
    try {
      const result = await updateStylingPlan({ sessionId: analysis.sessionId, stylingPlan: plan });
      setAnalysis((current) => (current ? { ...current, stylingPlan: result.stylingPlan } : current));
      setNotice({ tone: "success", text: "Styling plan saved for this shoot." });
      return true;
    } catch (reason) {
      setNotice({ tone: "error", text: reason instanceof Error ? reason.message : "Could not save the styling plan." });
      return false;
    } finally {
      setSavingStylingPlan(false);
    }
  };

  const handleImprovePosePlan = () => {
    if (autoAnalyzeTimerRef.current) clearTimeout(autoAnalyzeTimerRef.current);
    void runAnalysis(analysisInputKey, false, true);
  };

  const runAnalysisRef = useRef(runAnalysis);
  runAnalysisRef.current = runAnalysis;

  useEffect(() => {
    analysisRequestRef.current += 1;
    setAnalysisSourceKey((current) => current === analysisInputKey ? current : null);
    if (!requiredReady) {
      setAnalyzing(false);
      return;
    }
    autoAnalyzeTimerRef.current = setTimeout(() => {
      void runAnalysisRef.current(analysisInputKey, true);
    }, AUTO_ANALYZE_DELAY_MS);
    return () => {
      if (autoAnalyzeTimerRef.current) clearTimeout(autoAnalyzeTimerRef.current);
    };
  }, [analysisInputKey, requiredReady]);

  const handleGenerate = async () => {
    setNotice(null);
    if (!analysis || !analysisIsCurrent || analyzing) {
      setNotice({ tone: "error", text: "Wait for Gemini vision analysis and the 6-pose plan to complete before generating." });
      return;
    }
    if (enabledPoseCount !== REQUIRED_POSE_COUNT) {
      setNotice({ tone: "error", text: `All ${REQUIRED_POSE_COUNT} required poses must be enabled before generation.` });
      return;
    }
    setGenerating(true);
    try {
      const result = await queueSku({
        organizationId: organization._id,
        createdBy: user._id,
        generationSessionId: analysis.sessionId,
        analysisFingerprint: analysis.analysisFingerprint,
        skuId: effectiveSkuId,
        skuName: effectiveSkuName,
        productDetails: productDetails.trim(),
        categoryStr: category,
        model: options.model,
        aspectRatio: options.aspectRatio,
        imageSize: options.imageSize,
        quality: options.quality,
        backgroundStyle: options.backgroundStyle,
        modelIdentity: options.modelIdentity,
        bottomWear: options.bottomWear,
        poseQa: options.poseQa,
        referenceIds: analysis.referenceIds || allReferences.map((reference) => reference.uploadedId).filter(Boolean) as Id<"productReferences">[],
        poses,
      });
      allReferences.forEach((reference) => URL.revokeObjectURL(reference.previewUrl));
      setProductReferences({});
      setStyleReferences([]);
      setModelReference(null);
      setSceneDirectionNote("");
      setGarmentSummaryNote("");
      setPoses(basePoses);
      setAnalysis(null);
      setAnalysisSourceKey(null);
      setSkuId("");
      setSkuName("");
      setProductDetails("");
      setCategory("ethnic/fusion");
      setOptions(defaultOptions);
      setSubmittedJobId(result.jobId);
      setSessionJobIds((current) => [String(result.jobId), ...current.filter((id) => id !== String(result.jobId))].slice(0, MAX_SESSION_SUBMISSIONS));
      setNotice({
        tone: "success",
        text: result.alreadyQueued
          ? "This shoot was already generating, so we reopened that run instead of starting a second one. Studio is ready for your next product."
          : "Generation submitted successfully. Studio is ready for your next product.",
        jobId: result.jobId,
      });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not queue generation." });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl pb-16">
      {/* Studio Header Bar */}
      <header className="mb-6 flex flex-col justify-between gap-4 rounded-3xl border border-outline-variant/40 bg-white p-5 shadow-xs sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-soft-blush text-primary">
              <Wand2 className="h-4 w-4" />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Studio Generation Atelier</span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700 border border-emerald-200">
              6-Pose Engine Active
            </span>
          </div>
          <h1 className="mt-1 font-manrope text-2xl sm:text-[28px] font-bold tracking-tight text-on-surface">
            Catalog Photoshoot Production
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            className="rounded-xl border border-outline-variant/60 bg-surface-container-low px-4 text-xs font-bold text-on-surface hover:bg-surface-container"
            onClick={() => document.getElementById("product-reference-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            {isSareeCategory ? "Upload Saree Evidence" : "Upload Front + Back Photos"}
          </Button>

          <Link
            to="/history"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-outline-variant/60 bg-white px-4 text-xs font-bold text-secondary transition hover:border-primary hover:text-primary shadow-xs"
          >
            <HistoryIcon className="mr-2 h-4 w-4 text-primary" />
            <span>History Archive</span>
          </Link>

          <button
            onClick={handleGenerate}
            disabled={generating || !generationReady}
            className="group relative flex h-11 items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-primary via-[#b81059] to-[#be185d] px-6 text-sm font-bold text-white shadow-lg shadow-primary/25 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-primary/35 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Queueing Shoot…</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 transition-transform group-hover:scale-110" />
                <span>Generate Shoot (6 Poses)</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Production Stepper Indicator */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { step: "1", title: "Product References", ready: requiredReady, desc: requiredReady ? "Evidence Ready" : "Front & Back Required" },
          { step: "2", title: "SKU & Output Engine", ready: Boolean(effectiveSkuId), desc: options.imageSize + " · " + options.aspectRatio },
          { step: "3", title: "Vision Ground Truth", ready: analysisIsCurrent, desc: analyzing ? "Analyzing…" : analysisIsCurrent ? "Locked" : "Pending Analysis" },
          { step: "4", title: "6-Pose Catalog Set", ready: enabledPoseCount === REQUIRED_POSE_COUNT, desc: `${enabledPoseCount}/${REQUIRED_POSE_COUNT} Poses Validated` },
        ].map((s) => (
          <div
            key={s.step}
            className={`flex items-center gap-3 rounded-2xl border p-3 shadow-xs transition-all ${
              s.ready
                ? "border-emerald-600/30 bg-emerald-50/50"
                : "border-outline-variant/40 bg-white"
            }`}
          >
            <div
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-xs font-bold ${
                s.ready ? "bg-emerald-600 text-white" : "bg-surface-container text-secondary"
              }`}
            >
              {s.ready ? <Check className="h-4 w-4" /> : s.step}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-on-surface">{s.title}</p>
              <p className="truncate text-[10px] text-secondary font-medium">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Notice Banner */}
      {notice && (
        <div
          className={`mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4 text-xs font-semibold shadow-xs animate-in fade-in ${
            notice.tone === "success"
              ? "border-emerald-600/20 bg-emerald-50 text-emerald-900"
              : "border-danger/20 bg-danger-surface text-danger"
          }`}
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{notice.text}</span>
          </span>
          {notice.jobId && (
            <Link to="/history" className="flex items-center gap-1 font-bold underline hover:opacity-80">
              <span>Track in History</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}

      {/* Session Submissions Tray */}
      {sessionJobIds.length > 0 && (
        <section className="mb-6 rounded-2xl border border-outline-variant/40 bg-white p-4 shadow-xs">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-secondary">
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span>Active Browser Session Shoots ({sessionJobIds.length})</span>
            </p>
            <Link to="/history" className="text-xs font-bold text-primary hover:underline">
              Open Full History Archive →
            </Link>
          </div>
          <ul className="max-h-64 space-y-2 overflow-auto">
            {sessionJobIds.map((jobId, index) => (
              <SessionSubmissionRow
                key={jobId}
                jobId={jobId}
                latest={index === 0}
                onRemove={() => setSessionJobIds((current) => current.filter((id) => id !== jobId))}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Submitted Job Live Progress Monitor */}
      {submittedJobId && (
        <div className="mb-8 rounded-2xl border border-primary/25 bg-gradient-to-r from-soft-blush/60 via-white to-soft-blush/30 p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {submittedJob ? (
                <>
                  <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl border border-primary/20 bg-white shadow-xs">
                    {submittedJob.thumbnailUrl ? (
                      <img src={submittedJob.thumbnailUrl} alt="Thumbnail" className="h-full w-full object-cover" />
                    ) : (
                      <Images className="m-3.5 h-5 w-5 text-secondary" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-on-surface">
                        {submittedJob.skuName || submittedJob.skuId}
                      </h3>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                        {submissionStatusLabel(submittedJob)}
                      </span>
                    </div>
                    <p className="text-xs text-secondary mt-0.5">
                      {submittedJob.status === "completed"
                        ? "Photoshoot delivered successfully. All 6 frames ready for download."
                        : submittedJob.status === "failed"
                          ? "Photoshoot encountered an issue. Poses can be retried individually."
                          : submittedJob.status === "cancelling"
                            ? "Stopping… finishing active image model generation."
                            : submittedJob.status === "cancelled"
                              ? `Stopped — ${submittedJob.completedPoses} image${submittedJob.completedPoses === 1 ? "" : "s"} safely preserved in History.`
                              : submittedJob.status === "queued"
                                ? ((queuePosition || 1) === 1 ? "Queued — next in line for generation" : `Queued — ${(queuePosition || 1) - 1} task ahead`)
                                : `Generating poses: ${submittedJob.completedPoses} of ${submittedJob.totalPoses} complete.`}
                    </p>
                  </div>
                </>
              ) : submittedJob === null || (submittedJobError && submittedJob === undefined) ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-danger">
                    {submittedJob === null ? "This submission no longer exists in History." : `Could not load submission status: ${submittedJobError?.message}`}
                  </span>
                  <button onClick={() => setSubmittedJobId(null)} className="rounded-lg border border-outline-variant bg-white px-3 py-1.5 text-xs font-semibold text-secondary">
                    Dismiss
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm font-medium">Connecting to generation worker…</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              {submittedJob && ["queued", "processing"].includes(submittedJob.status) && (
                <button
                  disabled={stopping}
                  onClick={() => setStopDialogOpen(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-warning/30 bg-white px-3.5 py-2 text-xs font-semibold text-warning transition hover:bg-warning-surface disabled:opacity-50"
                >
                  {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                  <span>Stop Shoot</span>
                </button>
              )}
              <Link
                to="/history"
                className="flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-bold text-primary shadow-xs border border-primary/20 transition hover:bg-primary/5"
              >
                <span>Open in History</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {submittedJob && (
            <div className="mt-4">
              {(() => {
                const delivery = generationDeliveryProgress(submittedJob);
                return (
                  <>
                    <div className="mb-1.5 flex justify-between text-[11px] font-semibold text-secondary">
                      <span>
                        {submittedJob.status === "processing"
                          ? `Pose ${Math.max(1, submittedJob.currentPose || delivery.resolvedPoses + 1)} is generating · `
                          : ""}
                        {delivery.imagesStored}/{delivery.totalPoses} images stored
                        {delivery.failedPoses ? ` · ${delivery.failedPoses} failed` : ""}
                      </span>
                      <span className="font-bold text-primary">{delivery.deliveredPercent}% complete</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-white shadow-inner">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-primary-container transition-all duration-500"
                        style={{ width: `${delivery.deliveredPercent}%` }}
                      />
                    </div>
                  </>
                );
              })()}

              {submittedJob.poses?.length > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-2.5 sm:grid-cols-6">
                  {submittedJob.poses.map((pose: any) => (
                    <div
                      key={pose._id}
                      className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-outline-variant/40 bg-white shadow-xs"
                    >
                      {pose.outputUrl ? (
                        <img src={pose.outputUrl} alt={pose.title} className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full place-items-center bg-surface-container-low">
                          {pose.status === "processing" ? (
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                          ) : (
                            <Images className="h-5 w-5 text-secondary/40" />
                          )}
                        </div>
                      )}
                      <span className="absolute inset-x-1 bottom-1 truncate rounded-md bg-navy-soft/80 px-1.5 py-0.5 text-center text-[8px] font-bold uppercase tracking-wider text-white backdrop-blur-xs">
                        {pose.poseNumber}. {pose.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Studio 2-Column Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left Column: Product Photos & References (5 cols) */}
        <div className="lg:col-span-5">
          <section id="product-reference-section" className="scroll-mt-6 rounded-2xl border border-outline-variant/40 bg-white p-5 sm:p-6 shadow-xs">
            <div className="mb-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Ground Truth Assets</span>
              <h2 className="text-base font-bold text-on-surface">Product Photos</h2>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                {isSareeCategory
                  ? "Required: full saree front, rear/back drape, fully spread pallu, and body fabric detail. Border/tassels and blouse are recommended."
                  : "Front and back photos are required. Fabric close-up and additional angles are optional — all are locked into the same garment identity."}
              </p>
            </div>

            {duplicateProductSlots.length > 0 && (
              <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div>
                  {duplicateProductSlots.map((roles) => (
                    <p key={roles.join(":")}>
                      <b>Duplicate photo:</b> {roles.map((role) => `"${PRODUCT_SLOT_NAMES[role] || role}"`).join(" and ")} share the identical file.
                    </p>
                  ))}
                  <p className="mt-1 text-[11px] text-amber-800">
                    Each slot should show a distinct angle so the model learns front, back, and detail construction accurately.
                  </p>
                </div>
              </div>
            )}

            <ProductReferences
              references={productReferences}
              onChange={changeProductReference}
              saree={isSareeCategory}
              onPromoteLegacyReference={isSareeCategory ? promoteLegacyReference : undefined}
            />

            <div className="mt-5 border-t border-outline-variant/30 pt-4">
              <ModelFaceReference
                reference={modelReference || undefined}
                onFile={changeModelReference}
                onRemove={() => changeModelReference(null)}
              />
            </div>

            <div className="mt-5 border-t border-outline-variant/30 pt-4">
              <StyleReferences
                references={styleReferences}
                onAdd={addStyleReferences}
                onReplace={replaceStyleReference}
                onRemove={removeStyleReference}
              />
            </div>
          </section>
        </div>

        {/* Right Column: SKU Details, Output Settings, Scene Analysis (7 cols) */}
        <div className="space-y-5 lg:col-span-7">
          {/* SKU Details Card */}
          <section className="rounded-2xl border border-outline-variant/40 bg-white p-5 sm:p-6 shadow-xs">
            <div className="mb-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Catalog Metadata</span>
              <h2 className="text-base font-bold text-on-surface">SKU Details</h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-secondary">
                  SKU Code (Optional)
                </label>
                <input
                  value={skuId}
                  onChange={(event) => updateText(setSkuId, event.target.value)}
                  placeholder="e.g. YTH-KUR-2041"
                  className="mt-1.5 h-11 w-full rounded-xl border border-outline-variant/70 bg-white px-3.5 font-mono text-sm text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-secondary">
                  Product Name (Optional)
                </label>
                <input
                  value={skuName}
                  onChange={(event) => updateText(setSkuName, event.target.value)}
                  placeholder="e.g. Indigo printed kaftan set"
                  className="mt-1.5 h-11 w-full rounded-xl border border-outline-variant/70 bg-white px-3.5 text-sm text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-secondary">
                  Garment Category
                </label>
                <select
                  value={category}
                  onChange={(event) => updateText(setCategory, event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-outline-variant/70 bg-white px-3.5 text-sm text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 cursor-pointer"
                >
                  <option value="ethnic/fusion">Ethnic / fusion (Kurtis, Anarkalis, Sets)</option>
                  <option value="saree">Saree (Specialized 6-zone drape pipeline)</option>
                  <option value="western/casual">Western / casual</option>
                  <option value="dress">Dress</option>
                  <option value="formal">Formal</option>
                  <option value="streetwear">Streetwear</option>
                  <option value="activewear">Activewear</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-secondary">
                  Garment Truth & Construction Notes
                </label>
                <textarea
                  value={productDetails}
                  onChange={(event) => updateText(setProductDetails, event.target.value)}
                  rows={2}
                  placeholder="Preserve the garment exactly from uploaded references: neckline, sleeves, embroidery, fabric drape, color tone, hem finish…"
                  className="mt-1.5 w-full resize-y rounded-xl border border-outline-variant/70 bg-white p-3 text-xs leading-relaxed text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
              </div>
            </div>
          </section>

          {/* Output Engine Settings */}
          <OutputSettings
            value={options}
            onChange={updateOptions}
            orgModel={orgModel}
            orgModelLabel={orgModelLabel}
            orgModelOptions={orgModelOptions}
            routingStatus={routingStatus}
            routingError={effectiveRoutingError?.message}
          />

          {/* Scene & Styling Profile */}
          <AnalysisProfile
            analysis={analysis}
            analyzing={analyzing}
            ready={requiredReady}
            stale={analysisIsStale}
            current={analysisIsCurrent}
            onAnalyze={handleAnalyze}
            onImprovePosePlan={handleImprovePosePlan}
            sceneDirection={sceneDirectionValue}
            onSceneDirectionChange={(value) => updateText(setSceneDirectionNote, value)}
            garmentSummary={garmentSummaryValue}
            onGarmentSummaryChange={(value) => updateText(setGarmentSummaryNote, value)}
          />

          {/* Styling Plan Editor */}
          {analysis && analysisIsCurrent && (
            <StylingPlanEditor
              plan={normalizePlan(analysis.stylingPlan)}
              title="Footwear, jewellery & styling"
              description="Proposed from your product photos and the style reference. Edit anything before you generate - these exact pieces are locked into every frame."
              saving={savingStylingPlan}
              saveLabel="Save for this shoot"
              onSave={handleSaveStylingPlan}
            />
          )}
        </div>
      </div>

      {/* Bottom: 6-Pose Fashion Catalog Plan */}
      <section className="mt-8">
        <PosePlan
          poses={poses}
          onChange={setPoses}
          enabledCount={enabledPoseCount}
          ready={analysisIsCurrent}
          stale={analysisIsStale}
        />
      </section>

      {/* Stop Photoshoot Dialog */}
      <ActionDialog
        open={stopDialogOpen}
        title={`Stop ${submittedJob?.skuName || submittedJob?.skuId || "this photoshoot"}?`}
        description="The queued or active generation job will be cancelled. Every image already completed remains saved in History."
        confirmLabel="Stop photoshoot"
        tone="danger"
        busy={stopping}
        onCancel={() => setStopDialogOpen(false)}
        onConfirm={() => void stopSubmittedJob()}
      />
    </div>
  );
}
