import { useEffect, useState } from "react";
import { Ban, ChevronDown, ChevronUp, Download, Image as ImageIcon, Images, RefreshCcw, Search, Trash2, Loader2, Clock, AlertCircle, X, Brain } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, getJobReferenceImages, invokeAppApi, useMutation, useQuery, type Id } from "../../lib/backend";
import { useWorkspace } from "../../lib/WorkspaceContext";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { ActionDialog } from "../../components/ui/ActionDialog";
import { generationDeliveryProgress } from "../../lib/generationProgress";

type PendingHistoryAction = {
  type: "stop" | "delete" | "regenerate";
  jobId: Id<"generationJobs">;
  sku: string;
};

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "image/png" });
}

// Firebase Storage download URLs render fine in <img> tags (no CORS needed to display an
// image), but a browser fetch() of that same URL is subject to CORS — and the bucket isn't
// configured to allow this app's origin. That's why the image/ZIP downloads used to come
// back empty: every fetch() rejected and was swallowed silently. Route through the
// authenticated app-api function instead, which fetches the bytes server-side with the
// Firebase Admin credentials and hands them back as base64. Fall back to a direct fetch for
// any pose missing a storagePath (e.g. legacy rows), or if the proxy call fails.
async function fetchPoseImageBlob(jobId: string, pose: any): Promise<Blob> {
  if (pose.storagePath) {
    try {
      const result = await invokeAppApi<{ base64: string; mimeType: string }>("jobs.downloadAsset", {
        jobId,
        storagePath: pose.storagePath,
      });
      return base64ToBlob(result.base64, result.mimeType);
    } catch (err) {
      console.error("Proxied image download failed, falling back to direct fetch", err);
    }
  }
  const response = await fetch(pose.outputUrl);
  if (!response.ok) throw new Error("Image download failed");
  return response.blob();
}

function fidelityTone(score: number) {
  if (score >= 95) return "text-success";
  if (score >= 90) return "text-warning";
  return "text-danger";
}

function qaStatusLabel(status: string) {
  const labels: Record<string, string> = {
    automatically_verified: "Automatically verified",
    requires_human_review: "Requires human review",
    unverified: "Unverified because QA was unavailable",
    rejected_by_qa: "Rejected by QA",
    human_approved: "Human approved",
    human_rejected: "Human rejected",
    passed: "Automatically verified (legacy)",
    failed: "Rejected by QA (legacy)",
  };
  return labels[status] || "Requires human review";
}

function qaStatusBanner(status: string) {
  if (["automatically_verified", "human_approved", "passed"].includes(status)) return "bg-success/90 text-white";
  if (["rejected_by_qa", "human_rejected", "failed"].includes(status)) return "bg-danger/90 text-white";
  return "bg-warning/90 text-white";
}

function qaReviewOutcome(review: any) {
  const outcome = String(review?.outcome || "");
  if (outcome && outcome !== "legacy") return outcome;
  return review?.passed === true ? "automatically_verified" : review?.passed === false ? "rejected_by_qa" : "requires_human_review";
}

function statusClass(status: string) {
  if (status === "completed") return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20";
  if (status === "failed") return "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/10";
  if (status === "cancelled") return "bg-surface-container text-secondary ring-1 ring-inset ring-outline-variant/50";
  if (status === "processing") return "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-700/10";
  if (status === "queued") return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20";
  return "bg-surface-container text-secondary ring-1 ring-inset ring-outline-variant/50";
}

function hasRetainedPreviousVersion(pose: any) {
  return Boolean(pose?.hasRetainedPreviousOutput && pose?.retainedOutputUrl);
}

function visiblePoseOutputUrl(pose: any) {
  return String(pose?.outputUrl || (hasRetainedPreviousVersion(pose) ? pose.retainedOutputUrl : ""));
}

function visiblePoseStoragePath(pose: any) {
  return String(pose?.storagePath || (hasRetainedPreviousVersion(pose) ? pose.retainedStoragePath : ""));
}

function visibleQaStatus(pose: any) {
  return hasRetainedPreviousVersion(pose) ? String(pose.retainedQaStatus || "unverified") : String(pose?.qaStatus || "");
}

function visiblePoseAsset(pose: any) {
  return { ...pose, outputUrl: visiblePoseOutputUrl(pose), storagePath: visiblePoseStoragePath(pose) };
}

function JobDetails({ jobId }: { jobId: Id<"generationJobs"> }) {
  const { data: job, error: _jobError } = useQuery(api.jobs.get, { jobId });
  const workspace = useWorkspace();
  const { user } = workspace;
  const regeneratePose = useMutation(api.generation.regeneratePose);
  const rerunQa = useMutation(api.jobs.rerunQa);
  const [regeneratingId, setRegeneratingId] = useState<Id<"generationPoses"> | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [selectedPose, setSelectedPose] = useState<any | null>(null);
  const [regenerateTarget, setRegenerateTarget] = useState<any | null>(null);
  const [extraInstructions, setExtraInstructions] = useState("");
  const [regenerateError, setRegenerateError] = useState("");
  const [showReferences, setShowReferences] = useState(false);
  const [references, setReferences] = useState<any[] | null>(null);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [referencesError, setReferencesError] = useState("");
  const [selectedReference, setSelectedReference] = useState<any | null>(null);
  const [downloadingPoseId, setDownloadingPoseId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [rerunningQaId, setRerunningQaId] = useState<string | null>(null);
  const [qaRerunNotice, setQaRerunNotice] = useState("");

  const runLatestQa = async (pose: any) => {
    setRerunningQaId(pose._id);
    setQaRerunNotice("");
    try {
      const result = await rerunQa({ poseId: pose._id });
      setQaRerunNotice(result.success
        ? `${qaStatusLabel(result.outcome)} · AI QA estimate ${result.score}%`
        : `QA remained unavailable. The image and previous QA history were preserved.`);
    } catch (reason) {
      setQaRerunNotice(reason instanceof Error ? reason.message : "Could not re-run QA.");
    } finally {
      setRerunningQaId(null);
    }
  };

  // Fetched only when the user opts in — never on expand/render — so browsing History
  // doesn't cost extra Firebase Storage requests for images nobody asked to see.
  const toggleReferences = async () => {
    if (showReferences) { setShowReferences(false); return; }
    setShowReferences(true);
    if (references || referencesLoading) return;
    setReferencesLoading(true);
    setReferencesError("");
    try {
      setReferences(await getJobReferenceImages(jobId));
    } catch (reason) {
      setReferencesError(reason instanceof Error ? reason.message : "Could not load reference images.");
    } finally {
      setReferencesLoading(false);
    }
  };

  const submitRegeneration = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!regenerateTarget) return;
    setRegeneratingId(regenerateTarget._id);
    setRegenerateError("");
    try {
      await regeneratePose({ poseId: regenerateTarget._id, requestedBy: user._id, poseQa: true, extraInstructions: extraInstructions.trim() });
      setRegenerateTarget(null);
      setExtraInstructions("");
      setSelectedPose(null);
    } catch (reason) {
      setRegenerateError(reason instanceof Error ? reason.message : "Could not queue this regeneration.");
    } finally { setRegeneratingId(null); }
  };

  // Attempts rejected by consistency QA are archived server-side instead of being
  // thrown away, so the shoot owner can see what the model actually produced.
  const rejectedOf = (pose: any): any[] => (Array.isArray(pose?.rejectedAttempts) ? pose.rejectedAttempts : []);
  const latestRejected = (pose: any) => rejectedOf(pose).at(-1) || null;

  const downloadArchived = async (pose: any, attempt: any) => {
    setDownloadError("");
    setDownloadingPoseId(`${pose._id}:${attempt.attempt}`);
    try {
      const blob = await fetchPoseImageBlob(jobId, { storagePath: attempt.storagePath, outputUrl: attempt.url });
      const extension = blob.type === "image/webp" ? "webp" : blob.type === "image/jpeg" ? "jpg" : "png";
      saveAs(blob, `${job?.skuId || "Youthnic"}_${pose.poseNumber}_attempt${attempt.attempt}_qa-rejected.${extension}`);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Could not download this image.");
    } finally {
      setDownloadingPoseId(null);
    }
  };

  const downloadPose = async (pose: any) => {
    const asset = visiblePoseAsset(pose);
    if (!asset.outputUrl) return;
    setDownloadError("");
    setDownloadingPoseId(pose._id);
    try {
      const blob = await fetchPoseImageBlob(jobId, asset);
      const extension = blob.type === "image/webp" ? "webp" : blob.type === "image/jpeg" ? "jpg" : "png";
      const version = hasRetainedPreviousVersion(pose) ? "_prior-retained-version" : "";
      saveAs(blob, `${job?.skuId || "Youthnic"}_${pose.poseNumber}_${String(pose.title || "pose").replace(/[^a-z0-9]+/gi, "_").toLowerCase()}${version}.${extension}`);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Could not download this image.");
    } finally {
      setDownloadingPoseId(null);
    }
  };
  
  const downloadZip = async () => {
    if (!job) return;
    try {
      setIsZipping(true);
      const zip = new JSZip();

      const storedPoses = job.poses.filter((pose: any) => Boolean(visiblePoseOutputUrl(pose)));
      if (storedPoses.length === 0) return;

      const folder = zip.folder(`Youthnic_${job.skuId || "Generation"}`);
      if (!folder) return;

      // One batched call fetches every pose's bytes in a single round trip (the server fetches
      // them from Firebase in parallel, sharing one auth token) instead of one function call per
      // image — that per-image round-tripping was what made "Download ZIP" slow. Anything missing
      // from the batch (a storagePath-less legacy pose, or a partial batch failure) still falls
      // back to the single-image path below.
      const storagePaths = [...new Set(storedPoses.map((pose: any) => visiblePoseStoragePath(pose)).filter(Boolean))];
      const blobByStoragePath = new Map<string, Blob>();
      if (storagePaths.length) {
        try {
          const result = await invokeAppApi<{ assets: Array<{ storagePath: string; base64?: string; mimeType?: string; error?: string }> }>(
            "jobs.downloadAssets",
            { jobId, storagePaths },
          );
          for (const asset of result.assets) {
            if (asset.base64) blobByStoragePath.set(asset.storagePath, base64ToBlob(asset.base64, asset.mimeType || "image/png"));
          }
        } catch (err) {
          console.error("Batched ZIP download failed, falling back to per-image downloads", err);
        }
      }

      const promises = storedPoses.map(async (pose: any, i: number) => {
        try {
          const asset = visiblePoseAsset(pose);
          const blob = blobByStoragePath.get(asset.storagePath) ?? await fetchPoseImageBlob(jobId, asset);

          // Determine extension from content type or fallback to jpg
          let ext = "jpg";
          if (blob.type === "image/png") ext = "png";
          else if (blob.type === "image/webp") ext = "webp";

          const safeTitle = String(pose.title || "pose").replace(/[^a-z0-9]/gi, '_').toLowerCase();
          const filename = `${i + 1}_${safeTitle}.${ext}`;
          folder.file(filename, blob);
        } catch (err) {
          console.error("Failed to fetch image for ZIP", err);
        }
      });

      await Promise.all(promises);
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `Youthnic_${job.skuId || "Generation"}.zip`);
    } catch (err) {
      console.error("Error generating zip", err);
    } finally {
      setIsZipping(false);
    }
  };
  
  if (job === undefined) {
    return <div className="p-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  
  if (job === null) {
    return <div className="p-10 text-center text-sm text-secondary">Job not found.</div>;
  }

  const promptBudgetPose = job.poses.find((pose: any) => /invalid 'prompt': string too long|safe image-generation prompt/i.test(String(pose.error || "")));
  const visibleError = promptBudgetPose
    ? `Pose ${promptBudgetPose.poseNumber || 1} was blocked before image generation: ${promptBudgetPose.error}`
    : job.errorMessage;
  const selectedOutputUrl = selectedPose ? visiblePoseOutputUrl(selectedPose) : "";
  const selectedRetainedPrevious = selectedPose ? hasRetainedPreviousVersion(selectedPose) : false;
  const selectedQaStatus = selectedPose ? visibleQaStatus(selectedPose) : "";

  return (
    <div className="border-t border-outline-variant/30 bg-surface-container-lowest/50 p-6">
      <div className="mb-6 flex flex-wrap gap-4 text-xs text-secondary bg-white rounded-xl p-4 border border-outline-variant/40 shadow-sm">
        <span className="flex items-center gap-1.5"><b className="text-on-surface">Aspect Ratio:</b> {job.aspectRatio || '3:4'}</span>
        <span className="w-px h-4 bg-outline-variant/50 hidden sm:block"></span>
        <span className="flex items-center gap-1.5"><b className="text-on-surface">Resolution:</b> {job.imageSize || '1024x1024'}</span>
        <span className="w-px h-4 bg-outline-variant/50 hidden sm:block"></span>
        <span className="flex items-center gap-1.5"><b className="text-on-surface">Quality:</b> {job.quality || 'medium'}</span>
        <span className="w-px h-4 bg-outline-variant/50 hidden sm:block"></span>
        <span className="flex items-center gap-1.5"><b className="text-on-surface">Estimated:</b> ${Number(job.estimatedCost || 0).toFixed(2)}</span>
        <span className="w-px h-4 bg-outline-variant/50 hidden sm:block"></span>
        <span className="flex items-center gap-1.5"><b className="text-on-surface">Actual so far:</b> ${Number(job.actualCost || 0).toFixed(4)}</span>
        
        {visibleError && (
          <>
             <span className="w-px h-4 bg-outline-variant/50 hidden sm:block"></span>
             <span className="text-danger flex items-center gap-1.5 bg-danger/5 px-2 py-0.5 rounded text-danger"><AlertCircle className="h-3 w-3" /> <b className="font-bold">Error:</b> {visibleError}</span>
          </>
        )}
        
        <div className="flex-1 flex justify-end gap-2">
          <button
            onClick={() => void toggleReferences()}
            disabled={referencesLoading}
            className="flex items-center gap-2 rounded-lg bg-surface-container px-3 py-1.5 text-xs font-bold text-on-surface transition-colors hover:bg-surface-container-high disabled:opacity-50"
          >
            {referencesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Images className="h-3.5 w-3.5" />}
            {referencesLoading ? "Loading..." : showReferences ? "Hide references" : "View references"}
          </button>
          <button
            onClick={downloadZip}
            disabled={isZipping || !job.poses.some((pose: any) => Boolean(visiblePoseOutputUrl(pose)))}
            className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
          >
            {isZipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {isZipping ? "Zipping..." : "Download ZIP"}
          </button>
        </div>
      </div>

      {showReferences && (
        <div className="mb-6 rounded-xl border border-outline-variant/40 bg-white p-4 shadow-sm">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-secondary">Attached product & reference images</p>
          {referencesError && <p className="flex items-center gap-2 text-sm text-danger"><AlertCircle className="h-4 w-4" /> {referencesError}</p>}
          {!referencesError && references && references.length === 0 && (
            <p className="text-sm text-secondary">No reference images were stored for this generation.</p>
          )}
          {!referencesError && references && references.length > 0 && (
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
              {references.map((reference) => (
                <button
                  key={reference._id}
                  type="button"
                  onClick={() => setSelectedReference(reference)}
                  className="group text-left"
                >
                  <div className="aspect-square overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-container-lowest shadow-sm transition-all group-hover:border-primary/40 group-hover:shadow-md">
                    <img src={reference.url} alt={reference.label} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                  </div>
                  <p className="mt-1.5 truncate text-[10px] font-semibold text-secondary">{reference.label}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
        {job.poses.map((pose: any) => {
          const outputUrl = visiblePoseOutputUrl(pose);
          const retainedPrevious = hasRetainedPreviousVersion(pose);
          const qaStatus = visibleQaStatus(pose);
          return (
            <div key={pose._id} className={`group ${outputUrl || latestRejected(pose) ? "cursor-zoom-in" : "cursor-default"}`} onClick={() => (outputUrl || latestRejected(pose)) && setSelectedPose(pose)}>
              <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-outline-variant/40 bg-white shadow-sm transition-all duration-300 hover:shadow-md hover:border-primary/40 group-hover:-translate-y-1">
                {outputUrl ? (
                  <img src={outputUrl} alt={retainedPrevious ? `${pose.title} — retained prior version` : pose.title} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                ) : latestRejected(pose) ? (
                  <>
                    <img src={latestRejected(pose).url} alt={`${pose.title} — rejected attempt`} loading="lazy" decoding="async" className="h-full w-full object-cover opacity-70 grayscale transition-transform duration-500 group-hover:scale-105" />
                    <span className="absolute inset-x-0 bottom-0 bg-danger/90 px-2 py-1 text-center text-[9px] font-bold uppercase tracking-wider text-white">
                      QA rejected · attempt {latestRejected(pose).attempt}
                    </span>
                  </>
                ) : (
                  <div className="grid h-full place-items-center bg-surface-container-lowest">
                    {pose.status === "processing" ? (
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        <span className="text-[10px] text-primary font-medium tracking-wide uppercase">Generating</span>
                      </div>
                    ) : (
                      <ImageIcon className="h-8 w-8 text-outline-variant/50" />
                    )}
                  </div>
                )}
                <span className={`absolute left-2.5 top-2.5 rounded-md px-2 py-1 text-[9px] font-bold uppercase shadow-sm backdrop-blur-md ${statusClass(pose.status)}`}>
                  {retainedPrevious ? "Retry failed" : pose.status}
                </span>
                {retainedPrevious ? (
                  <span className="absolute inset-x-0 bottom-0 bg-slate-800/90 px-2 py-1 text-center text-[9px] font-bold uppercase tracking-wider text-white">
                    Prior version retained · {qaStatusLabel(qaStatus)}
                  </span>
                ) : (
                  /* Delivered without an automatic verdict — it must never be mistaken
                     for a consistency-approved frame. */
                  ["unverified", "requires_human_review", "rejected_by_qa", "human_approved", "human_rejected"].includes(qaStatus) && outputUrl && (
                    <span className={`absolute inset-x-0 bottom-0 px-2 py-1 text-center text-[9px] font-bold uppercase tracking-wider ${qaStatusBanner(qaStatus)}`}>
                      {qaStatusLabel(qaStatus)}
                    </span>
                  )
                )}
                {/* A pose rejected by QA never produced an image, so it must stay
                    retryable from here — otherwise a failed shoot is a dead end. */}
                {(pose.status === "failed" || (pose.status === "completed" && outputUrl)) && pose.completedAt && Date.now() - pose.completedAt < 86400000 && !["queued", "processing"].includes(job.status) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRegenerateError("");
                      setExtraInstructions("");
                      setRegenerateTarget(pose);
                    }}
                    disabled={regeneratingId === pose._id}
                    title="Regenerate this pose — available for 24 hours after generation"
                    className={`absolute right-2.5 top-2.5 z-10 flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-[10px] font-bold text-primary shadow-sm backdrop-blur transition-opacity hover:bg-white disabled:opacity-100 ${outputUrl ? "opacity-0 group-hover:opacity-100" : "opacity-100"}`}
                  >
                    {regeneratingId === pose._id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
                    Regenerate
                  </button>
                )}
                {outputUrl && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void downloadPose(pose);
                    }}
                    disabled={downloadingPoseId === pose._id}
                    title={retainedPrevious ? "Download retained prior version" : "Download this image"}
                    className="absolute right-2.5 bottom-2.5 z-10 flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-[10px] font-bold text-primary opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 hover:bg-white disabled:opacity-100"
                  >
                    {downloadingPoseId === pose._id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                    Download
                  </button>
                )}
              </div>
              <h4 className="mt-3 text-xs font-semibold text-on-surface">{pose.poseNumber}. {pose.title}</h4>
              {retainedPrevious && <p className="mt-1 text-[10px] font-bold text-secondary">Current regeneration failed before replacement; prior paid output remains available.</p>}
              {!retainedPrevious && outputUrl && pose.productFidelity > 0 && (
                <p className={`mt-1 text-[10px] font-bold ${fidelityTone(pose.productFidelity)}`}>
                  AI QA estimate {pose.productFidelity}% · {qaStatusLabel(qaStatus)}
                </p>
              )}
              {outputUrl && (
                <div className="mt-1.5 space-y-0.5 text-[10px] text-secondary">
                  <p>{pose.usageReported ? `${pose.inputTokens.toLocaleString()} input · ${pose.outputTokens.toLocaleString()} output tokens` : "Provider token usage not returned"}</p>
                  <p className="font-semibold text-on-surface">${Number(pose.actualCost || 0).toFixed(4)} actual</p>
                </div>
              )}
              {pose.error && <p className="mt-1.5 line-clamp-2 text-[10px] text-danger bg-danger/10 border border-danger/20 p-2 rounded-md">{pose.error}</p>}
            </div>
          );
        })}
      </div>

      {selectedPose && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-navy-soft/80 p-4" onClick={() => setSelectedPose(null)}>
          <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-outline-variant/40 px-5 py-4">
              <div><p className="text-[10px] font-bold uppercase tracking-widest text-primary">Pose {selectedPose.poseNumber}</p><h3 className="font-syne text-lg font-bold text-on-surface">{selectedPose.title}</h3></div>
              <button onClick={() => setSelectedPose(null)} className="rounded-lg p-2 text-secondary hover:bg-surface-container"><X className="h-5 w-5" /></button>
            </div>
              <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="grid min-h-0 place-items-center overflow-auto bg-neutral-950 p-4"><img src={selectedOutputUrl || latestRejected(selectedPose)?.url} alt={selectedPose.title} decoding="async" className="max-h-[76vh] max-w-full object-contain" /></div>
                <aside className="space-y-4 overflow-auto p-5 text-sm">
                  {selectedRetainedPrevious && (
                    <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-warning-dark">Prior version retained</p>
                      <p className="mt-1.5 text-[11px] leading-4 text-secondary">The current regeneration failed before a replacement was delivered. This is the earlier paid output, kept for review and download; it is not a successful retry.</p>
                      <p className="mt-2 text-[10px] font-bold text-on-surface">Previous QA state: {qaStatusLabel(selectedQaStatus)}</p>
                    </div>
                  )}
                  {!selectedRetainedPrevious && !selectedPose.outputUrl && latestRejected(selectedPose) && (
                    <div className="rounded-xl border border-danger/20 bg-danger-surface p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-danger">Not delivered</p>
                    <p className="mt-1.5 text-[11px] leading-4 text-secondary">Consistency QA rejected this frame, so it was never added to the set. It is kept here because it was already generated and paid for — check it against the product before using it.</p>
                  </div>
                )}
                  {(selectedQaStatus || selectedPose.productFidelity > 0 || Object.keys(selectedPose.fidelityScores || {}).length > 0) && (
                  <div className="rounded-xl bg-surface-container-lowest p-4">
                    <div className="flex items-baseline justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-secondary">AI QA estimate</p>
                      <p className={`font-syne text-lg font-bold ${fidelityTone(selectedPose.productFidelity)}`}>{selectedPose.productFidelity}%</p>
                    </div>
                    {selectedQaStatus === "human_approved" ? (
                      <p className="mt-1 text-[10px] leading-4 text-success">Human approved. The percentage remains the recorded AI estimate; the approval is the verified decision.</p>
                    ) : selectedQaStatus === "unverified" ? (
                      <p className="mt-1 text-[10px] leading-4 text-warning">Automatic QA could not run for this frame, so it was delivered unverified. Check it against the product references yourself.</p>
                    ) : selectedQaStatus === "requires_human_review" || selectedPose.fidelityReviewRecommended ? (
                      <p className="mt-1 text-[10px] leading-4 text-warning">This estimate is 90–94 or otherwise uncertain. It requires human review and is not verified.</p>
                    ) : selectedQaStatus === "rejected_by_qa" || selectedQaStatus === "failed" ? (
                      <p className="mt-1 text-[10px] leading-4 text-danger">Automatic QA rejected this frame. The paid output remains available for review.</p>
                    ) : null}
                    {Object.keys(selectedPose.fidelityScores || {}).length > 0 && (
                      <dl className="mt-3 space-y-1.5">
                        {Object.entries(selectedPose.fidelityScores as Record<string, number>)
                          .sort((left, right) => left[1] - right[1])
                          .map(([key, score]) => (
                            <div key={key} className="flex items-center gap-2 text-[11px]">
                              <dt className="w-32 shrink-0 truncate text-secondary" title={key}>{key.replace(/_/g, " ")}</dt>
                              <dd className="flex flex-1 items-center gap-2">
                                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-container-high">
                                  <span className={`block h-full rounded-full ${score >= 95 ? "bg-success" : score >= 90 ? "bg-warning" : "bg-danger"}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
                                </span>
                                <span className="w-9 shrink-0 text-right font-bold text-on-surface">{score}%</span>
                              </dd>
                            </div>
                          ))}
                      </dl>
                    )}
                    {selectedPose.qaReason && <p className="mt-3 text-[10px] leading-4 text-secondary">{selectedPose.qaReason}</p>}
                    {Array.isArray(selectedPose.qaHistory) && selectedPose.qaHistory.length > 0 && (
                      <div className="mt-3 border-t border-outline-variant/40 pt-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-secondary">QA audit history</p>
                        <div className="mt-2 space-y-2">
                          {selectedPose.qaHistory.map((review: any) => (
                            <div key={review.id} className="rounded-lg border border-outline-variant/40 bg-white p-2 text-[10px] leading-4">
                              <p className="font-bold text-on-surface">{qaStatusLabel(qaReviewOutcome(review))}{String(review.reviewer_type || "").startsWith("human_") ? "" : ` · ${Number(review.score || 0)}%`}</p>
                              <p className="text-secondary">{review.qa_version || "legacy"} · {review.created_at ? new Date(review.created_at).toLocaleString() : "time unavailable"}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="rounded-xl bg-surface-container-lowest p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-secondary">OpenAI usage</p>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div><dt className="text-secondary">Input</dt><dd className="font-bold">{selectedPose.inputTokens.toLocaleString()}</dd></div>
                    <div><dt className="text-secondary">Output</dt><dd className="font-bold">{selectedPose.outputTokens.toLocaleString()}</dd></div>
                    <div><dt className="text-secondary">Image input</dt><dd className="font-bold">{selectedPose.inputImageTokens.toLocaleString()}</dd></div>
                    <div><dt className="text-secondary">Text input</dt><dd className="font-bold">{selectedPose.inputTextTokens.toLocaleString()}</dd></div>
                    <div><dt className="text-secondary">Total</dt><dd className="font-bold">{selectedPose.totalTokens.toLocaleString()}</dd></div>
                    <div><dt className="text-secondary">Actual cost</dt><dd className="font-bold">${Number(selectedPose.actualCost || 0).toFixed(4)}</dd></div>
                  </dl>
                  {!selectedPose.usageReported && <p className="mt-3 text-[10px] leading-4 text-warning">This provider response did not include token usage, so no token cost was invented.</p>}
                </div>
                {selectedPose.completedAt && Date.now() - selectedPose.completedAt < 86400000 && !["queued", "processing"].includes(job.status) && <button onClick={() => { setRegenerateError(""); setExtraInstructions(""); setRegenerateTarget(selectedPose); }} className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-soft-blush px-4 py-3 font-semibold text-primary hover:bg-primary/15"><RefreshCcw className="h-4 w-4" /> Regenerate with instructions</button>}
                {selectedOutputUrl && (
                  <button onClick={() => void downloadPose(selectedPose)} disabled={downloadingPoseId === selectedPose._id} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-dark disabled:opacity-50">
                    {downloadingPoseId === selectedPose._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {downloadingPoseId === selectedPose._id ? "Downloading…" : selectedRetainedPrevious ? "Download retained prior version" : "Download image"}
                  </button>
                )}
                {workspace.isAdmin && selectedPose.outputUrl && (
                  <button onClick={() => void runLatestQa(selectedPose)} disabled={rerunningQaId === selectedPose._id} className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-white px-4 py-3 font-semibold text-primary hover:bg-primary/5 disabled:opacity-50">
                    {rerunningQaId === selectedPose._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
                    Re-run latest QA
                  </button>
                )}
                {qaRerunNotice && <p className="rounded-lg bg-surface-container px-3 py-2 text-[10px] leading-4 text-secondary">{qaRerunNotice}</p>}
                {rejectedOf(selectedPose).length > 0 && (
                  <div className="rounded-xl border border-outline-variant/40 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-secondary">QA-rejected attempts</p>
                    <div className="mt-3 space-y-3">
                      {rejectedOf(selectedPose).map((attempt: any) => (
                        <div key={attempt.storagePath} className="flex gap-3">
                          <img src={attempt.url} alt={`Attempt ${attempt.attempt}`} loading="lazy" decoding="async" className="h-20 w-16 shrink-0 rounded-md border border-outline-variant/40 object-cover" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold text-on-surface">Attempt {attempt.attempt} · score {Number(attempt.score || 0)}</p>
                            <p className="mt-0.5 line-clamp-3 text-[10px] leading-4 text-secondary" title={attempt.reason}>{attempt.reason}</p>
                            <button
                              onClick={() => void downloadArchived(selectedPose, attempt)}
                              disabled={downloadingPoseId === `${selectedPose._id}:${attempt.attempt}`}
                              className="mt-1.5 flex items-center gap-1.5 rounded-md border border-outline-variant px-2 py-1 text-[10px] font-bold text-secondary hover:bg-surface-container disabled:opacity-50"
                            >
                              {downloadingPoseId === `${selectedPose._id}:${attempt.attempt}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                              Download
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </aside>
            </div>
          </div>
        </div>
      )}
      {selectedReference && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-navy-soft/80 p-4" onClick={() => setSelectedReference(null)}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-outline-variant/40 px-5 py-4">
              <div><p className="text-[10px] font-bold uppercase tracking-widest text-primary">Reference</p><h3 className="font-syne text-lg font-bold text-on-surface">{selectedReference.label}</h3></div>
              <button onClick={() => setSelectedReference(null)} className="rounded-lg p-2 text-secondary hover:bg-surface-container"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-neutral-950 p-4">
              <img src={selectedReference.url} alt={selectedReference.label} decoding="async" className="max-h-[76vh] max-w-full object-contain" />
            </div>
          </div>
        </div>
      )}
      {regenerateTarget && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-navy-soft/75 p-4" onClick={() => !regeneratingId && setRegenerateTarget(null)}>
          <form onSubmit={submitRegeneration} onClick={(event) => event.stopPropagation()} className="w-full max-w-xl rounded-3xl bg-white p-7 shadow-2xl">
            <div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Pose {regenerateTarget.poseNumber}</p><h3 className="mt-2 font-syne text-2xl font-bold text-on-surface">Regenerate {regenerateTarget.title}</h3><p className="mt-1 text-sm leading-6 text-secondary">Add a precise correction. Original front, back, fabric, product identity, model, and scene remain authoritative.</p></div><button type="button" disabled={Boolean(regeneratingId)} onClick={() => setRegenerateTarget(null)} className="rounded-lg p-2 text-secondary hover:bg-surface-container disabled:opacity-40"><X className="h-5 w-5" /></button></div>
            {regenerateTarget.poseNumber === 1 && (
              <p className="mt-4 rounded-xl border border-warning/30 bg-warning/5 p-3 text-xs leading-5 text-warning-dark">
                <AlertCircle className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom" />
                Pose 1 is the face and shoot anchor for this whole set — poses 2–5 were generated to match it. Regenerating it can change the model's face; if it does, regenerate the other poses afterward so every image still shows the same person.
              </p>
            )}
            <label className="mt-6 block text-xs font-bold uppercase tracking-wider text-secondary">Extra instructions<textarea autoFocus maxLength={1000} rows={5} value={extraInstructions} onChange={(event) => setExtraInstructions(event.target.value)} placeholder="Example: Back side should not have hanging/latkan elements. Preserve the plain uploaded back construction exactly." className="mt-2 w-full resize-y rounded-xl border border-outline-variant p-3 text-sm font-normal normal-case leading-6 tracking-normal text-on-surface outline-none focus:border-primary" /></label>
            <div className="mt-2 flex justify-between text-[10px] text-secondary"><span>Leave blank to retry with the existing locked shoot plan.</span><span>{extraInstructions.length}/1000</span></div>
            {regenerateError && <p className="mt-4 rounded-xl border border-danger/20 bg-danger-surface p-3 text-sm text-danger">{regenerateError}</p>}
            <div className="mt-6 flex justify-end gap-3"><button type="button" disabled={Boolean(regeneratingId)} onClick={() => setRegenerateTarget(null)} className="rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-bold text-secondary">Cancel</button><button disabled={Boolean(regeneratingId)} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{regeneratingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}{regeneratingId ? "Queueing…" : "Regenerate pose"}</button></div>
          </form>
        </div>
      )}
      {downloadError && (
        <div className="fixed bottom-6 right-6 z-[120] flex items-center gap-3 rounded-xl border border-danger/20 bg-white px-5 py-4 text-sm text-danger shadow-xl">
          <AlertCircle className="h-5 w-5" />
          <span className="font-medium">{downloadError}</span>
          <button onClick={() => setDownloadError("")} className="ml-4 text-xs font-bold uppercase tracking-widest text-secondary hover:text-on-surface">Dismiss</button>
        </div>
      )}
    </div>
  );
}

export function History() {
  const { organization } = useWorkspace();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const cancelJob = useMutation(api.jobs.cancel);
  const removeJob = useMutation(api.jobs.remove);
  const regenerateSession = useMutation(api.jobs.regenerateSession);

  const pageSize = 10;
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // History is an archive, so it must open on stored generations rather than
  // the empty active queue. Active is still available as an explicit filter.
  const [status, setStatus] = useState("");
  const [sourceType, setSourceType] = useState(() => {
    const source = params.get("source");
    return source === "studio" || source === "catalog" ? source : "";
  });
  const [expanded, setExpanded] = useState<Id<"generationJobs"> | null>(null);
  const [error, setError] = useState("");
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingHistoryAction | null>(null);
  const { data: jobsPage, error: _jobsPageError } = useQuery(api.jobs.list, {
    organizationId: organization._id,
    page,
    pageSize,
    search,
    status,
    sourceType,
  }) as { data: { items: any[]; page: number; pageSize: number; total: number; totalPages: number } | undefined, error: any };
  const jobs = jobsPage?.items;

  useEffect(() => {
    const source = params.get("source");
    const nextSource = source === "studio" || source === "catalog" ? source : "";
    setSourceType(nextSource);
    setPage(1);
    setExpanded(null);
  }, [params]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
      setExpanded(null);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (jobsPage && page > jobsPage.totalPages) setPage(Math.max(1, jobsPage.totalPages));
  }, [jobsPage, page]);

  const stopGeneration = async (jobId: string) => {
    setBusyJobId(jobId);
    try { await cancelJob({ jobId }); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not stop generation."); } finally { setBusyJobId(null); }
  };

  const deleteGeneration = async (jobId: string) => {
    setBusyJobId(jobId);
    try { await removeJob({ jobId }); if (expanded === jobId) setExpanded(null); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete generation."); } finally { setBusyJobId(null); }
  };

  const regenerateFailedSession = async (jobId: string) => {
    setBusyJobId(jobId);
    try { await regenerateSession({ jobId }); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not regenerate this session."); } finally { setBusyJobId(null); }
  };

  const actionDialog = pendingAction?.type === "stop"
    ? { title: `Stop ${pendingAction.sku}?`, description: "All remaining poses will be cancelled. Images that already completed remain saved in this generation history.", confirmLabel: "Stop generation", tone: "danger" as const }
    : pendingAction?.type === "delete"
      ? { title: `Delete ${pendingAction.sku}?`, description: "This permanently removes the generation record and its stored generated images. This action cannot be undone.", confirmLabel: "Delete generation", tone: "danger" as const }
      : pendingAction?.type === "regenerate"
        ? { title: `Retry failed poses for ${pendingAction.sku}?`, description: "Every pose that did not complete will be attempted again. Poses already completed remain unchanged.", confirmLabel: "Retry failed poses", tone: "primary" as const }
        : null;

  const confirmPendingAction = async () => {
    const action = pendingAction;
    if (!action) return;
    if (action.type === "stop") await stopGeneration(action.jobId);
    else if (action.type === "delete") await deleteGeneration(action.jobId);
    else await regenerateFailedSession(action.jobId);
    setPendingAction(null);
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
         <div>
            <p className="mb-1 text-[11px] font-label-caps uppercase tracking-widest text-primary font-bold">Generation archive</p>
            <h2 className="text-display-md text-on-surface font-black tracking-tight">History</h2>
         </div>
         <div className="flex gap-3">
            <div className="relative">
               <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
               <input 
                  value={searchInput} 
                  onChange={(event) => setSearchInput(event.target.value)} 
                  placeholder="Search SKU or prompt…" 
                  className="h-10 w-64 rounded-xl border border-outline-variant bg-white pl-10 pr-4 text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-sm" 
               />
            </div>
            <select 
               value={sourceType} 
               onChange={(event) => { setSourceType(event.target.value); setPage(1); setExpanded(null); }} 
               className="h-10 rounded-xl border border-outline-variant bg-white px-4 text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-sm cursor-pointer"
            >
               <option value="">All Sources</option>
               <option value="studio">Studio</option>
               <option value="catalog">Catalog Production</option>
            </select>
            <select 
               value={status} 
               onChange={(event) => { setStatus(event.target.value); setPage(1); setExpanded(null); }} 
               className="h-10 rounded-xl border border-outline-variant bg-white px-4 text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-sm cursor-pointer"
            >
               <option value="">All generations</option>
               <option value="active">Active generations</option>
               <option value="queued">Queued</option>
               <option value="processing">Processing</option>
               <option value="completed">Completed</option>
               <option value="failed">Failed</option>
               <option value="cancelled">Cancelled</option>
            </select>
         </div>
      </div>

      <div className="flex flex-col overflow-hidden rounded-2xl border border-outline-variant/40 bg-white shadow-sm">
        {jobs === undefined && (
           <div className="flex flex-col items-center justify-center py-20 text-secondary">
              <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary/50" />
              <span className="text-sm font-medium">Loading history...</span>
           </div>
        )}
        
        {(jobs || []).map((job: any) => { 
           const open = expanded === job._id; 
            const delivery = generationDeliveryProgress({
              ...job,
              completedPoses: Math.max(Number(job.completedPoses || 0), Number(job.storedPoseCount || 0)),
            });
           const progress = delivery.deliveredPercent;
           
           return (
             <article key={job._id} className="group relative border-b border-outline-variant/30 bg-white last:border-b-0 transition-colors duration-200 hover:bg-surface-container-lowest">
               <div 
                 onClick={() => setExpanded(open ? null : job._id)}
                 className={`flex cursor-pointer items-center gap-4 p-4 lg:grid lg:grid-cols-[minmax(0,1fr)_160px_160px_auto] ${open ? 'bg-surface-container-lowest' : ''}`}
               >
                 
                 {/* COL 1: Image & Details */}
                 <div className="flex min-w-0 items-center gap-4">
                    <div className="flex-shrink-0 h-10 w-10 overflow-hidden rounded-lg bg-surface-container shadow-inner ring-1 ring-inset ring-black/5">
                       {job.thumbnailUrl ? (
                          <img src={job.thumbnailUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                       ) : (
                          <ImageIcon className="m-2.5 h-5 w-5 text-secondary/40" />
                       )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-mono text-xs font-semibold text-on-surface">{job.skuId}</h3>
                        <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${statusClass(job.status)}`}>
                          {job.status === "queued" && <Clock className="h-2.5 w-2.5" />}
                          {job.status === "processing" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                          {job.detailedStatus || job.status}
                        </span>
                      </div>
                      <p className="truncate text-sm text-secondary">{job.skuName || 'Untitled product'}</p>
                    </div>
                 </div>

                 {/* COL 2: Progress */}
                 <div className="hidden lg:block">
                    <div className="mb-1 flex items-center justify-between text-xs font-medium text-secondary">
                      <span>{job.status === "processing" ? `Pose ${Math.max(1, job.currentPose || delivery.resolvedPoses + 1)} · ` : ""}{delivery.imagesStored} / {delivery.totalPoses} images stored{delivery.failedPoses ? ` · ${delivery.failedPoses} failed` : ""}</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest shadow-inner">
                      <div className={`h-full rounded-full transition-all duration-500 ${job.status === "failed" ? "bg-red-500" : job.status === "completed" ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${progress}%` }} />
                    </div>
                 </div>

                 {/* COL 3: User & Time */}
                 <div className="hidden flex-col text-xs text-secondary lg:flex">
                    <span className="truncate font-medium text-on-surface" title={job.creatorEmail}>{job.creatorName}</span>
                    <span>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(job.createdAt)}</span>
                 </div>

                 {/* COL 4: Actions */}
                 <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 lg:pl-4">
                   {['queued', 'processing'].includes(job.status) && (
                      <button disabled={busyJobId === job._id} title="Stop generation" onClick={(e) => { e.stopPropagation(); setPendingAction({ type: "stop", jobId: job._id, sku: job.skuName || job.skuId }); }} className="rounded-md p-1.5 text-secondary hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                         {busyJobId === job._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                      </button>
                   )}
                   {job.status === "failed" && (
                      <button disabled={busyJobId === job._id} title="Regenerate failed poses" onClick={(e) => { e.stopPropagation(); setPendingAction({ type: "regenerate", jobId: job._id, sku: job.skuName || job.skuId }); }} className="rounded-md p-1.5 text-secondary hover:bg-primary/10 hover:text-primary disabled:opacity-50">
                         {busyJobId === job._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                      </button>
                   )}
                   {!['queued', 'processing'].includes(job.status) && (
                      <button disabled={busyJobId === job._id} title="Delete generation" onClick={(e) => { e.stopPropagation(); setPendingAction({ type: "delete", jobId: job._id, sku: job.skuName || job.skuId }); }} className="rounded-md p-1.5 text-secondary hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                         {busyJobId === job._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                   )}
                   <button onClick={(e) => { e.stopPropagation(); navigate(`/history/flow/${job._id}`); }} title="View Generation Flow" className="rounded-md p-1.5 text-secondary hover:bg-primary/10 hover:text-primary">
                      <Brain className="h-4 w-4" />
                   </button>
                   <button title="Toggle details" className={`rounded-md p-1.5 transition-colors ${open ? 'bg-primary/10 text-primary' : 'text-secondary hover:bg-surface-container hover:text-on-surface'}`}>
                      {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                   </button>
                 </div>
               </div>
               
               {open && (
                  <div className="border-t border-outline-variant/30 bg-surface-container-lowest/50 p-6">
                    <JobDetails jobId={job._id} />
                  </div>
               )}
             </article>
           );
        })}
        
        {jobs !== undefined && jobs.length === 0 && (
           <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-container">
                 <RefreshCcw className="h-5 w-5 text-secondary" />
              </div>
              <p className="text-sm font-semibold text-on-surface">No generations match this view</p>
              <p className="mt-1 text-xs text-secondary">Try adjusting your filters or search query.</p>
           </div>
        )}
      </div>

      {jobsPage && jobsPage.total > 0 && (
        <div className="flex flex-col items-center justify-between gap-4 rounded-2xl border border-outline-variant/40 bg-white px-5 py-4 shadow-sm sm:flex-row">
          <p className="text-sm text-secondary">
            Showing <span className="font-semibold text-on-surface">{(jobsPage.page - 1) * jobsPage.pageSize + 1}–{Math.min(jobsPage.page * jobsPage.pageSize, jobsPage.total)}</span> of <span className="font-semibold text-on-surface">{jobsPage.total}</span> generations
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => { setPage((value) => Math.max(1, value - 1)); setExpanded(null); }}
              className="rounded-lg border border-outline-variant px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            {Array.from({ length: jobsPage.totalPages }, (_, index) => index + 1)
              .filter((value) => value === 1 || value === jobsPage.totalPages || Math.abs(value - page) <= 1)
              .map((value, index, visiblePages) => (
                <div key={value} className="flex items-center gap-2">
                  {index > 0 && value - visiblePages[index - 1] > 1 && <span className="px-1 text-secondary">…</span>}
                  <button
                    type="button"
                    onClick={() => { setPage(value); setExpanded(null); }}
                    className={`h-9 min-w-9 rounded-lg px-3 text-xs font-bold transition-colors ${value === page ? "bg-primary text-white shadow-sm" : "border border-outline-variant text-on-surface hover:border-primary hover:text-primary"}`}
                  >
                    {value}
                  </button>
                </div>
              ))}
            <button
              type="button"
              disabled={page >= jobsPage.totalPages}
              onClick={() => { setPage((value) => Math.min(jobsPage.totalPages, value + 1)); setExpanded(null); }}
              className="rounded-lg border border-outline-variant px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
      
      <ActionDialog
        open={Boolean(pendingAction && actionDialog)}
        title={actionDialog?.title || "Confirm generation action"}
        description={actionDialog?.description || "Confirm this generation action."}
        confirmLabel={actionDialog?.confirmLabel || "Confirm"}
        tone={actionDialog?.tone || "danger"}
        busy={Boolean(busyJobId)}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void confirmPendingAction()}
      />

      {error && (
         <div className="fixed bottom-6 right-6 rounded-xl border border-danger/20 bg-white px-5 py-4 text-sm text-danger shadow-xl flex items-center gap-3 z-50 animate-in slide-in-from-bottom-5">
            <AlertCircle className="h-5 w-5" />
            <span className="font-medium">{error}</span>
            <button onClick={() => setError("")} className="ml-4 text-secondary hover:text-on-surface text-xs font-bold uppercase tracking-widest">Dismiss</button>
         </div>
      )}
    </div>
  );
}
