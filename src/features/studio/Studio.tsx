import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, CheckCircle2, Images, Loader2, Sparkles } from "lucide-react";
import { api, useAction, useMutation, useQuery, type Id } from "../../lib/backend";
import { Button } from "../../components/ui/Button";
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
  { id: "creative", title: "Creative Gen-Z Fashion Pose", description: "A current, expressive pose that keeps the exact product readable.", cameraAngle: "Product-appropriate editorial angle", highlightedDetails: ["movement", "creative direction"], primaryReference: "front", purpose: "Campaign and social-commerce storytelling", prompt: "Create a current Gen-Z fashion pose suited to this exact product without hiding or changing it.", enabled: true },
  { id: "closeup", title: "Zoomed-In Face & Product Highlight", description: "A zoomed-in shot pairing a beautiful, natural face with a sharp highlight of the product's most important detail.", cameraAngle: "Eye-level, zoomed in to a face-to-chest or face-to-waist crop", highlightedDetails: ["natural expression", "face", "key product detail"], primaryReference: "fabric_pattern", purpose: "Social-first beauty-and-product shot", prompt: "Genuinely zoomed-in face-to-chest or face-to-waist shot - not a repeat of the full-body hero - with a beautiful, cute, Gen-Z-style face and a genuine, natural expression alongside one sharp product detail.", enabled: true },
];

const REQUIRED_POSE_COUNT = 5;
const AUTO_ANALYZE_DELAY_MS = 900;

const defaultOptions: OutputOptions = {
  model: "gpt-image-2",
  modelIdentity: "Same adult South Asian female fashion model across every pose",
  aspectRatio: "3:4",
  imageSize: "2K",
  quality: "medium",
  backgroundStyle: "Infer a premium consistent scene from the uploaded style reference",
  poseQa: true,
};

async function fileHash(file: File) {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function makeReference(role: StudioReference["role"], file: File): StudioReference {
  return { id: crypto.randomUUID(), role, file, previewUrl: URL.createObjectURL(file) };
}

function validateFile(file: File) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
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
  // User-editable corrections layered onto the AI's own "Scene direction"/"Garment summary"
  // read-out in AnalysisProfile. Empty means "use whatever Gemini derived" (shown as a fallback
  // display value below); once the member types something, it's sent back as an extra director's
  // note on the next analysis and is never silently overwritten by a fresh analysis result, the
  // same way productDetails already behaves.
  const [sceneDirectionNote, setSceneDirectionNote] = useState("");
  const [garmentSummaryNote, setGarmentSummaryNote] = useState("");
  const [options, setOptions] = useState(defaultOptions);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [submittedJobId, setSubmittedJobId] = useState<Id<"generationJobs"> | null>(null);
  const [skuId, setSkuId] = useState("");
  const [skuName, setSkuName] = useState("");
  const [productDetails, setProductDetails] = useState("");
  const [category, setCategory] = useState("ethnic/fusion");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string; jobId?: Id<"generationJobs"> } | null>(null);
  const analysisRequestRef = useRef(0);
  const uploadPromisesRef = useRef(new Map<string, Promise<StudioReference>>());
  const autoAnalyzeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: submittedJob, error: _submittedJobError } = useQuery(api.jobs.get, submittedJobId ? { jobId: submittedJobId } : "skip");
  const { data: queuePosition, error: _queuePositionError } = useQuery(api.jobs.getQueuePosition, submittedJobId && submittedJob?.status === "queued" ? { jobId: submittedJobId } : "skip");

  const allReferences = useMemo(
    () => [...Object.values(productReferences).filter(Boolean), ...(modelReference ? [modelReference] : []), ...styleReferences] as StudioReference[],
    [modelReference, productReferences, styleReferences],
  );
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
  // What AnalysisProfile actually shows: the member's own edit if they've made one, else the AI's
  // derived read-out of the last analysis. Kept here (not inside AnalysisProfile) so the same
  // values can both render and feed the next analysis request below.
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
      setNotice({ tone: "success", text: "Photoshoot cancellation requested. Completed images remain saved.", jobId: submittedJobId });
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
        name: reference.file.name,
        size: reference.file.size,
        modified: reference.file.lastModified,
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
      // This is an explicit member decision, not an AI inference. Generic evidence
      // is reclassified to one proven region; it is not silently used as both.
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
      // Resize to 1920x1920 to keep high fidelity for generation, while vastly reducing
      // file size. This speeds up upload and prevents 504 timeouts on the analysis Edge Function.
      const resizedFile = await resizeImageFile(reference.file, 1920);
      const uploaded = await uploadCatalogAsset({
        organizationId: String(organization._id),
        scope: "references",
        ownerKey: effectiveSkuId,
        role: reference.role,
        file: resizedFile,
      });
      return {
        ...reference,
        uploadedId: reference.id,
        storageBackend: uploaded.storageBackend,
        storagePath: uploaded.storagePath,
        downloadUrl: uploaded.downloadUrl,
        hash: await fileHash(reference.file),
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
      // Fold the member's Scene direction / Garment summary edits into the same director's-note
      // params the rest of this form already sends - buildCombinedAnalysisPrompt treats them as
      // "requested scene direction" / "user product notes", so Gemini re-derives both the product
      // identity and the five-pose plan around the correction. Because these strings also flow
      // into the backend's cache key (productHash), repeating an edit you've already sent (or
      // reverting one) hits the existing 30-day analysis cache instead of a fresh Gemini call.
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
        setNotice({ tone: "success", text: "Product identity, creative direction, and the five-pose shoot plan are ready." });
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

  // Saved onto the session rather than re-running analysis: styling is not a
  // product fact, so the analysis fingerprint stays valid and queueing still works.
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

  // The serialized key intentionally owns this effect. Including runAnalysis would
  // retrigger it when uploaded IDs are attached to otherwise unchanged references.
  // oxlint-disable react-hooks/exhaustive-deps
  useEffect(() => {
    analysisRequestRef.current += 1;
    setAnalysisSourceKey((current) => current === analysisInputKey ? current : null);
    if (!requiredReady) {
      setAnalyzing(false);
      return;
    }
    autoAnalyzeTimerRef.current = setTimeout(() => {
      void runAnalysis(analysisInputKey, true);
    }, AUTO_ANALYZE_DELAY_MS);
    return () => {
      if (autoAnalyzeTimerRef.current) clearTimeout(autoAnalyzeTimerRef.current);
    };
  }, [analysisInputKey, requiredReady]);
  // oxlint-enable react-hooks/exhaustive-deps

  const handleGenerate = async () => {
    setNotice(null);
    if (!analysis || !analysisIsCurrent || analyzing) {
      setNotice({ tone: "error", text: "Wait for Gemini analysis and the current five-pose plan to finish before generating." });
      return;
    }
    if (enabledPoseCount !== REQUIRED_POSE_COUNT) {
      setNotice({ tone: "error", text: "All five required poses must be ready before generation." });
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
        poseQa: options.poseQa,
        referenceIds: analysis.referenceIds || allReferences.map((reference) => reference.uploadedId).filter(Boolean) as Id<"productReferences">[],
        poses,
      });
      setProductReferences({});
      setStyleReferences([]);
      setModelReference(null);
      setPoses(basePoses);
      setAnalysis(null);
      setAnalysisSourceKey(null);
      setSkuId("");
      setSkuName("");
      setProductDetails("");
      setCategory("ethnic/fusion");
      setOptions(defaultOptions);
      setSubmittedJobId(result.jobId);
      setNotice({ tone: "success", text: "Generation submitted successfully. Studio is ready for your next product.", jobId: result.jobId });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not queue generation." });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl pb-16">
      {/* Header Row */}
      <header className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Studio</span>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="secondary" className="bg-surface-container-low hover:bg-surface-container" onClick={() => document.getElementById("product-reference-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            {isSareeCategory ? "Add saree evidence" : "Add front + back photos"}
          </Button>
          <Link to="/history" className="inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold text-tertiary transition-colors hover:bg-tertiary-container hover:text-on-tertiary-container">
            <Images className="mr-2 h-4 w-4" /> History
          </Link>
          <Button 
            onClick={handleGenerate} 
            disabled={generating || !generationReady} 
            className="bg-gradient-to-r from-pink-400 to-rose-400 text-white hover:from-pink-500 hover:to-rose-500 shadow-sm border-none"
          >
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Generate
          </Button>
        </div>
      </header>

      {notice && (
        <div className={`mb-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 text-sm ${notice.tone === "success" ? "border-success/20 bg-success-surface text-success" : "border-danger/20 bg-danger-surface text-danger"}`}>
          <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> {notice.text}</span>
          {notice.jobId && <Link to="/history" className="font-bold underline">Track in history</Link>}
        </div>
      )}

      {submittedJobId && (
        <div className="mb-8 rounded-xl border border-primary/20 bg-primary/5 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {submittedJob ? (
              <>
                <div className="h-10 w-10 overflow-hidden rounded-md bg-surface-container flex-shrink-0">
                  {submittedJob.thumbnailUrl ? (
                    <img src={submittedJob.thumbnailUrl} alt="Thumbnail" className="h-full w-full object-cover" />
                  ) : (
                    <Images className="h-5 w-5 m-2.5 text-secondary" />
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-on-surface">Submission: {submittedJob.skuName || submittedJob.skuId}</h3>
                  <p className="text-xs text-secondary mt-0.5">
                    {submittedJob.status === "completed" ? "Generation complete." : 
                     submittedJob.status === "failed" ? "Generation failed." : 
                     submittedJob.status === "queued" ? ((queuePosition || 1) === 1 ? "Queued — next task" : `Queued — ${(queuePosition || 1) - 1} task${(queuePosition || 1) - 1 === 1 ? "" : "s"} ahead`) :
                     `Processing... ${submittedJob.completedPoses} / ${submittedJob.totalPoses} poses complete.`}
                  </p>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm font-medium">Fetching submission status...</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {submittedJob && ["queued", "processing"].includes(submittedJob.status) && <button disabled={stopping} onClick={() => setStopDialogOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-warning/30 bg-white px-3 py-2 text-xs font-semibold text-warning disabled:opacity-50">{stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Stop</button>}
            <Link to="/history" className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-primary underline">View in History</Link>
          </div>
          </div>
          {submittedJob && (
            <div className="mt-4">
              {(() => {
                const delivery = generationDeliveryProgress(submittedJob);
                return <><div className="mb-1.5 flex justify-between text-[11px] font-semibold text-secondary"><span>{submittedJob.status === "processing" ? `Pose ${Math.max(1, submittedJob.currentPose || delivery.resolvedPoses + 1)} is generating · ` : ""}{delivery.imagesStored}/{delivery.totalPoses} images stored{delivery.failedPoses ? ` · ${delivery.failedPoses} failed` : ""}</span><span>{delivery.deliveredPercent}% delivered</span></div><div className="h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${delivery.deliveredPercent}%` }} /></div></>;
              })()}
              {submittedJob.poses?.length > 0 && <div className="mt-3 grid grid-cols-5 gap-2">{submittedJob.poses.map((pose: any) => <div key={pose._id} className="relative aspect-[3/4] overflow-hidden rounded-lg border border-outline-variant/40 bg-white">{pose.outputUrl ? <img src={pose.outputUrl} alt={pose.title} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center">{pose.status === "processing" ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <Images className="h-4 w-4 text-outline" />}</div>}<span className="absolute inset-x-1 bottom-1 truncate rounded bg-navy-soft/70 px-1 py-0.5 text-center text-[8px] font-semibold text-white">{pose.poseNumber}. {pose.status}</span></div>)}</div>}
            </div>
          )}
        </div>
      )}

      {/* Top: product photos (upper-left) + SKU details & settings (right) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* LEFT: Product photos */}
        <div className="lg:col-span-5">
          <section id="product-reference-section" className="scroll-mt-6 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-base font-bold text-on-surface">Product photos</h2>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                {isSareeCategory
                  ? "Required: full saree front, rear/back drape, fully spread pallu, and body fabric/pattern detail. Border/tassel and blouse references are strongly recommended."
                  : "Front and back are required. Fabric / pattern detail and an additional product photo are optional — all four are treated as the same product. Style reference only guides scene, mood, and lighting."}
              </p>
            </div>
            <ProductReferences
              references={productReferences}
              onChange={changeProductReference}
              saree={isSareeCategory}
              onPromoteLegacyReference={isSareeCategory ? promoteLegacyReference : undefined}
            />
            <div className="mt-4 border-t border-outline-variant/30 pt-4">
              <h3 className="mb-2 text-sm font-bold text-on-surface">Model face lock</h3>
              <ModelFaceReference reference={modelReference || undefined} onFile={changeModelReference} onRemove={() => changeModelReference(null)} />
            </div>
            <div className="mt-4 border-t border-outline-variant/30 pt-4">
              <StyleReferences references={styleReferences} onAdd={addStyleReferences} onReplace={replaceStyleReference} onRemove={removeStyleReference} />
            </div>
          </section>
        </div>

        {/* RIGHT: SKU details, then output settings & scene styling */}
        <div className="space-y-4 lg:col-span-7">
          <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-base font-bold text-on-surface">SKU details</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-secondary">
                SKU code (optional)
                <input value={skuId} onChange={(event) => updateText(setSkuId, event.target.value)} placeholder="e.g. YTH-KUR-2041" className="mt-1.5 h-10 w-full rounded-lg border border-outline-variant bg-white px-3 font-mono text-sm text-on-surface outline-none focus:border-primary" />
              </label>
              <label className="block text-xs font-semibold text-secondary">
                Product name (optional)
                <input value={skuName} onChange={(event) => updateText(setSkuName, event.target.value)} placeholder="e.g. Indigo printed kaftan set" className="mt-1.5 h-10 w-full rounded-lg border border-outline-variant bg-white px-3 text-sm text-on-surface outline-none focus:border-primary" />
              </label>
              <label className="block text-xs font-semibold text-secondary sm:col-span-2">
                Product details
                <textarea value={productDetails} onChange={(event) => updateText(setProductDetails, event.target.value)} rows={3} placeholder="Preserve the garment exactly from the uploaded references. Keep color, print, fabric, trims, neckline, sleeves..." className="mt-1.5 w-full rounded-lg border border-outline-variant bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary resize-none" />
              </label>
              <label className="block text-xs font-semibold text-secondary sm:col-span-2">
                Category
                <select value={category} onChange={(event) => updateText(setCategory, event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-outline-variant bg-white px-3 text-sm text-on-surface outline-none focus:border-primary">
                  <option value="ethnic/fusion">Ethnic / fusion</option>
                  <option value="saree">Saree</option>
                  <option value="western/casual">Western / casual</option>
                  <option value="dress">Dress</option>
                  <option value="formal">Formal</option>
                  <option value="streetwear">Streetwear</option>
                  <option value="activewear">Activewear</option>
                </select>
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-sm">
            <OutputSettings value={options} onChange={updateOptions} />
          </section>

          <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-sm transition-all overflow-hidden">
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
          </section>

          {/* Hidden while the analysis is stale: analysis.sessionId still points at
              the previous references, so a save would land on a session the next
              auto-analysis replaces, losing the edit silently. */}
          {analysis && analysisIsCurrent && (
            <StylingPlanEditor
              plan={normalizePlan(analysis.stylingPlan)}
              title="Footwear, jewellery & styling"
              description="Proposed from your product photos and the style reference. Edit anything before you generate - these exact pieces are locked into all five frames."
              saving={savingStylingPlan}
              saveLabel="Save for this shoot"
              onSave={handleSaveStylingPlan}
            />
          )}
        </div>
      </div>

      {/* Bottom: five-pose plan, horizontal, full width */}
      <section className="mt-6 rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-sm transition-all overflow-hidden">
         <PosePlan poses={poses} onChange={setPoses} enabledCount={enabledPoseCount} ready={analysisIsCurrent} stale={analysisIsStale} />
      </section>

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
