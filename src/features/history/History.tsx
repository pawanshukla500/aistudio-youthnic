import { useEffect, useRef, useState } from "react";
import {
  Ban,
  ChevronDown,
  ChevronUp,
  Download,
  Image as ImageIcon,
  Images,
  RefreshCcw,
  Search,
  Trash2,
  Loader2,
  Clock,
  AlertCircle,
  X,
  Brain,
  Check,
  ThumbsDown,
  Undo2,
  Columns2,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Layers,
  Eye,
  Sparkles,
  ShieldCheck,
  Maximize2,
  CheckCircle2,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, getJobReferenceImages, invokeAppApi, useMutation, useQuery, type Id } from "../../lib/backend";
import { useWorkspace } from "../../lib/WorkspaceContext";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { ActionDialog } from "../../components/ui/ActionDialog";
import { generationDeliveryProgress } from "../../lib/generationProgress";
import { formatDuration, type PoseVersion } from "../../lib/poseVersions";

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
async function fetchPoseImageBlob(jobId: string, pose: any): Promise<{ blob?: Blob; base64?: string; mimeType?: string }> {
  if (pose.storagePath) {
    try {
      const result = await invokeAppApi<{ base64: string; mimeType: string }>("jobs.downloadAsset", {
        jobId,
        storagePath: pose.storagePath,
      });
      return { base64: result.base64, mimeType: result.mimeType };
    } catch (err) {
      console.error("Proxied image download failed, falling back to direct fetch", err);
    }
  }
  const response = await fetch(pose.outputUrl);
  if (!response.ok) throw new Error("Image download failed");
  return { blob: await response.blob() };
}

function fidelityTone(score: number) {
  if (score >= 95) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (score >= 90) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-red-700 bg-red-50 border-red-200";
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

// "unverified" covers both a validator that was switched off for the job and
// one that could not return a verdict. Only the second is "unavailable".
function visibleQaLabel(status: string, poseQaEnabled: boolean) {
  if (status === "unverified" && !poseQaEnabled) return "Not QA-checked · QA off";
  return qaStatusLabel(status);
}

function formatModelName(model?: string | null): string {
  if (!model) return "Default Model";
  const map: Record<string, string> = {
    "muse-spark-1.2-contributor": "Meta Muse Spark 1.2",
    "muse-spark-1.3-contributor": "Meta Muse Spark 1.3",
    "muse-spark-1.3": "Meta Muse Spark 1.3",
    "muse-spark-1.2": "Meta Muse Spark 1.2",
    "gpt-5.6-luna": "GPT 5.6 Luna",
    "gpt-5.6-terra": "GPT 5.6 Terra",
    "gpt-5.6-sol": "GPT 5.6 Sol",
    "gemini-3.8-flash": "Gemini 3.8 Flash",
    "gemini-3.6-flash": "Gemini 3.6 Flash",
    "qwen3.8-max": "Qwen 3.8 Max",
    "gpt-image-2.5-flare-2026-09-08": "GPT Image 2.5 Flare",
    "gpt-image-2.5-flare": "GPT Image 2.5 Flare",
    "gpt-image-2.5-sunburst": "GPT Image 2.5 Sunburst",
    "gpt-image-2": "GPT Image 2",
    "reve-2.1-image": "Reve 2.1 Image",
  };
  return map[model] || model.split("-").map((s) => (s ? s[0].toUpperCase() + s.slice(1) : "")).join(" ");
}

function poseVersions(pose: any): PoseVersion[] {
  return Array.isArray(pose?.versions) ? pose.versions : [];
}

// Whether QA was on for the image the card shows. A retained prior image
// keeps its own setting; the pose's QA payload belongs to the failed retry.
function shownQaEnabled(pose: any, jobPoseQa: boolean): boolean {
  if (hasRetainedPreviousVersion(pose)) {
    return poseVersions(pose).find((version) => version.isCurrent)?.qaEnabled ?? jobPoseQa;
  }
  return pose?.qaEnabled ?? jobPoseQa;
}

// A regeneration is timed from the moment someone asked for it. A first
// delivery is timed from when the worker started it: its request time is the
// job's, which would count the wait behind every earlier pose.
function versionHeadlineMs(version: PoseVersion) {
  return version.isRegeneration ? version.totalMs : version.activeMs;
}

function versionTimingDetail(version: PoseVersion) {
  if (!version.timingRecorded) return version.totalMs ? "Reconstructed from the regeneration request time" : "Timing was not recorded for this version";
  return [
    version.isRegeneration && version.totalMs ? `Requested→delivered ${formatDuration(version.totalMs)}` : "",
    `Waiting ${formatDuration(version.totalMs - version.activeMs) || "0s"}`,
    `Working ${formatDuration(version.activeMs) || "0s"}`,
    version.generationMs ? `Image model ${formatDuration(version.generationMs)}` : "",
    version.attempts > 1 ? `${version.attempts} attempts` : "",
  ].filter(Boolean).join(" · ");
}

function qaStatusBanner(status: string) {
  if (["automatically_verified", "human_approved", "passed"].includes(status)) return "bg-emerald-600/90 text-white backdrop-blur-md";
  if (["rejected_by_qa", "human_rejected", "failed"].includes(status)) return "bg-red-600/90 text-white backdrop-blur-md";
  return "bg-amber-500/90 text-white backdrop-blur-md";
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
  if (status === "processing") return "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20";
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

const ACTIVE_JOB_STATUSES = ["queued", "processing", "cancelling"];

// Mirrors the per-pose Regenerate button on the job grid: a failed pose or a
// delivered image, within 24 hours, while the job itself is idle.
function canRegeneratePose(pose: any, jobStatus: string) {
  return (
    (pose.status === "failed" || (pose.status === "completed" && Boolean(visiblePoseOutputUrl(pose)))) &&
    Boolean(pose.completedAt) &&
    Date.now() - pose.completedAt < 86400000 &&
    !ACTIVE_JOB_STATUSES.includes(jobStatus)
  );
}

function approvalBadge(status: string) {
  if (status === "approved") return { label: "Approved", className: "bg-emerald-600/95 text-white" };
  if (status === "rejected") return { label: "Rejected", className: "bg-red-600/95 text-white" };
  return null;
}

type BatchEntry = {
  poseId: string;
  poseNumber: number;
  title: string;
  state: "waiting" | "submitting" | "submitted" | "failed" | "skipped";
  instructions: string;
  poseQa: boolean;
  error?: string;
};

function JobDetails({ jobId }: { jobId: Id<"generationJobs"> }) {
  const navigate = useNavigate();
  const { data: job, error: _jobError } = useQuery(api.jobs.get, { jobId });
  const workspace = useWorkspace();
  const { user } = workspace;
  const regeneratePose = useMutation(api.generation.regeneratePose);
  const rerunQa = useMutation(api.jobs.rerunQa);
  const approvePose = useMutation(api.jobs.approve);
  const canApprove = workspace.isAdmin || workspace.permissions.includes("planning.manage");
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<{ poseId: string; message: string } | null>(null);
  const [compareWithPrevious, setCompareWithPrevious] = useState(false);
  // An earlier version opened from the pose preview's version history.
  const [viewedVersion, setViewedVersion] = useState<{ poseId: string; versionId: string } | null>(null);
  const [batchSelection, setBatchSelection] = useState<string[]>([]);
  const [batchNote, setBatchNote] = useState("");
  const [batchPoseQa, setBatchPoseQa] = useState(false);
  const [batchEntries, setBatchEntries] = useState<BatchEntry[]>([]);
  // The server refuses a pose regeneration while the job is queued/processing,
  // and each regeneration re-queues the whole job, so a batch has to go one
  // pose at a time: submit, wait for the job to settle, then submit the next.
  const batchWaitRef = useRef<{ poseId: string; previousCompletedAt: number; sawActive: boolean } | null>(null);
  const batchSubmittingRef = useRef(false);
  const [regeneratingId, setRegeneratingId] = useState<Id<"generationPoses"> | null>(null);
  const [zipping, setZipping] = useState<"" | "all" | "approved">("");
  const [selectedPoseSnapshot, setSelectedPose] = useState<any | null>(null);
  // Read the open pose from the live job so QA re-runs and retries show up in
  // the preview; the snapshot only covers a pose that has since disappeared.
  const selectedPose = selectedPoseSnapshot
    ? (job?.poses?.find((pose: any) => pose._id === selectedPoseSnapshot._id) ?? selectedPoseSnapshot)
    : null;
  const [regenerateTarget, setRegenerateTarget] = useState<any | null>(null);
  const [extraInstructions, setExtraInstructions] = useState("");
  const [regeneratePoseQa, setRegeneratePoseQa] = useState(false);
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
  const [isCloning, setIsCloning] = useState(false);
  const [showModelRoutingModal, setShowModelRoutingModal] = useState(false);

  const cloneJob = async () => {
    if (!job) return;
    try {
      setIsCloning(true);
      const result = await invokeAppApi<{ sessionId: string }>("jobs.clone", { jobId });
      if (result.sessionId) {
        navigate(`/studio?session=${result.sessionId}`);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not clone session.");
    } finally {
      setIsCloning(false);
    }
  };

  const runLatestQa = async (pose: any) => {
    setRerunningQaId(pose._id);
    setQaRerunNotice("");
    try {
      const result = await rerunQa({ poseId: pose._id });
      setQaRerunNotice(
        result.success
          ? `${qaStatusLabel(result.outcome)} · AI QA estimate ${result.score}%`
          : `QA remained unavailable. The image and previous QA history were preserved.`
      );
    } catch (reason) {
      setQaRerunNotice(reason instanceof Error ? reason.message : "Could not re-run QA.");
    } finally {
      setRerunningQaId(null);
    }
  };

  // Fetched only when the user opts in — never on expand/render — so browsing History
  // doesn't cost extra Firebase Storage requests for images nobody asked to see.
  const toggleReferences = async () => {
    if (showReferences) {
      setShowReferences(false);
      return;
    }
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
      await regeneratePose({
        poseId: regenerateTarget._id,
        requestedBy: user._id,
        poseQa: regeneratePoseQa,
        extraInstructions: extraInstructions.trim(),
      });
      setRegenerateTarget(null);
      setExtraInstructions("");
      setRegeneratePoseQa(false);
      setSelectedPose(null);
    } catch (reason) {
      setRegenerateError(reason instanceof Error ? reason.message : "Could not queue this regeneration.");
    } finally {
      setRegeneratingId(null);
    }
  };

  // Attempts rejected by consistency QA are archived server-side instead of being
  // thrown away, so the shoot owner can see what the model actually produced.
  const rejectedOf = (pose: any): any[] => (Array.isArray(pose?.rejectedAttempts) ? pose.rejectedAttempts : []);
  const latestRejected = (pose: any) => rejectedOf(pose).at(-1) || null;

  const downloadArchived = async (pose: any, attempt: any) => {
    setDownloadError("");
    setDownloadingPoseId(`${pose._id}:${attempt.storagePath}`);
    try {
      const assetData = await fetchPoseImageBlob(jobId, { storagePath: attempt.storagePath, outputUrl: attempt.url });
      const dlBlob = assetData.blob || base64ToBlob(assetData.base64!, assetData.mimeType || "image/png");
      const extension = dlBlob.type === "image/webp" ? "webp" : dlBlob.type === "image/jpeg" ? "jpg" : "png";
      const round = Number(attempt.generationEpoch) > 1 ? `_round${attempt.generationEpoch}` : "";
      saveAs(dlBlob, `${job?.skuId || "Youthnic"}_${pose.poseNumber}${round}_attempt${attempt.attempt}_qa-rejected.${extension}`);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Could not download this image.");
    } finally {
      setDownloadingPoseId(null);
    }
  };

  const downloadVersion = async (pose: any, version: PoseVersion) => {
    setDownloadError("");
    setDownloadingPoseId(`${pose._id}:v${version.version}`);
    try {
      const assetData = await fetchPoseImageBlob(jobId, { storagePath: version.storagePath, outputUrl: version.url });
      const dlBlob = assetData.blob || base64ToBlob(assetData.base64!, assetData.mimeType || "image/png");
      const extension = dlBlob.type === "image/webp" ? "webp" : dlBlob.type === "image/jpeg" ? "jpg" : "png";
      saveAs(
        dlBlob,
        `${job?.skuId || "Youthnic"}_${pose.poseNumber}_${String(pose.title || "pose")
          .replace(/[^a-z0-9]+/gi, "_")
          .toLowerCase()}_v${version.version}.${extension}`
      );
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Could not download this version.");
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
      const assetData = await fetchPoseImageBlob(jobId, asset);
      const dlBlob = assetData.blob || base64ToBlob(assetData.base64!, assetData.mimeType || "image/png");
      const extension = dlBlob.type === "image/webp" ? "webp" : dlBlob.type === "image/jpeg" ? "jpg" : "png";
      const version = hasRetainedPreviousVersion(pose) ? "_prior-retained-version" : "";
      saveAs(
        dlBlob,
        `${job?.skuId || "Youthnic"}_${pose.poseNumber}_${String(pose.title || "pose")
          .replace(/[^a-z0-9]+/gi, "_")
          .toLowerCase()}${version}.${extension}`
      );
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Could not download this image.");
    } finally {
      setDownloadingPoseId(null);
    }
  };

  const downloadZip = async (approvedOnly = false) => {
    if (!job) return;
    try {
      setZipping(approvedOnly ? "approved" : "all");
      setDownloadError("");
      const zip = new JSZip();

      const storedPoses = job.poses.filter(
        (pose: any) => Boolean(visiblePoseOutputUrl(pose)) && (!approvedOnly || pose.approvalStatus === "approved")
      );
      if (storedPoses.length === 0) return;

      const archiveName = `Youthnic_${job.skuId || "Generation"}${approvedOnly ? "_approved" : ""}`;
      const folder = zip.folder(archiveName);
      if (!folder) return;

      // One batched call fetches every pose's bytes in a single round trip (the server fetches
      // them from Firebase in parallel, sharing one auth token) instead of one function call per
      // image — that per-image round-tripping was what made "Download ZIP" slow.
      const storagePaths = [...new Set(storedPoses.map((pose: any) => visiblePoseStoragePath(pose)).filter(Boolean))];
      const assetByStoragePath = new Map<string, { base64: string; mimeType: string }>();
      if (storagePaths.length) {
        try {
          const result = await invokeAppApi<{
            assets: Array<{ storagePath: string; base64?: string; mimeType?: string; error?: string }>;
          }>("jobs.downloadAssets", { jobId, storagePaths });
          for (const asset of result.assets) {
            if (asset.base64) assetByStoragePath.set(asset.storagePath, { base64: asset.base64, mimeType: asset.mimeType || "image/png" });
          }
        } catch (err) {
          console.error("Batched ZIP download failed, falling back to per-image downloads", err);
        }
      }

      const missingPoses: number[] = [];
      const promises = storedPoses.map(async (pose: any, i: number) => {
        try {
          const asset = visiblePoseAsset(pose);
          const cachedAsset = assetByStoragePath.get(asset.storagePath);
          const safeTitle = String(pose.title || "pose").replace(/[^a-z0-9]/gi, "_").toLowerCase();
          const poseNumber = Number(pose.poseNumber) || i + 1;

          if (cachedAsset) {
            let ext = "jpg";
            if (cachedAsset.mimeType === "image/png") ext = "png";
            else if (cachedAsset.mimeType === "image/webp") ext = "webp";
            const filename = `${poseNumber}_${safeTitle}.${ext}`;
            folder.file(filename, cachedAsset.base64, { base64: true });
            return;
          }

          const assetData = await fetchPoseImageBlob(jobId, asset);
          let ext = "jpg";
          const mimeType = assetData.mimeType || (assetData.blob && assetData.blob.type) || "image/jpeg";
          if (mimeType === "image/png") ext = "png";
          else if (mimeType === "image/webp") ext = "webp";

          const filename = `${poseNumber}_${safeTitle}.${ext}`;
          if (assetData.base64) {
            folder.file(filename, assetData.base64, { base64: true });
          } else if (assetData.blob) {
            folder.file(filename, assetData.blob);
          } else {
            throw new Error("No image data returned");
          }
        } catch (err) {
          console.error("Failed to fetch image for ZIP", err);
          missingPoses.push(Number(pose.poseNumber) || i + 1);
        }
      });

      await Promise.all(promises);
      if (missingPoses.length === storedPoses.length) throw new Error("None of the images could be downloaded.");
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `${archiveName}.zip`);
      if (missingPoses.length) {
        setDownloadError(
          `ZIP saved, but ${missingPoses.length} of ${storedPoses.length} images could not be downloaded: pose ${missingPoses
            .sort((a, b) => a - b)
            .join(", ")}. Try the ZIP again or download them individually.`
        );
      }
    } catch (err) {
      console.error("Error generating zip", err);
      setDownloadError(err instanceof Error ? `ZIP download failed: ${err.message}` : "ZIP download failed.");
    } finally {
      setZipping("");
    }
  };

  const setApproval = async (pose: any, status: "approved" | "rejected" | "pending") => {
    if (!pose?.generationId) return;
    setApprovingId(pose._id);
    setApprovalError(null);
    try {
      await approvePose({ generationId: pose.generationId, status });
    } catch (reason) {
      setApprovalError({ poseId: pose._id, message: reason instanceof Error ? reason.message : "Could not update the approval." });
    } finally {
      setApprovingId(null);
    }
  };

  const navigablePoses: any[] = (job?.poses || []).filter((pose: any) => Boolean(visiblePoseOutputUrl(pose) || latestRejected(pose)));
  const selectedNavIndex = selectedPose ? navigablePoses.findIndex((pose) => pose._id === selectedPose._id) : -1;
  const previousNavPose = selectedNavIndex > 0 ? navigablePoses[selectedNavIndex - 1] : null;
  const nextNavPose = selectedNavIndex >= 0 && selectedNavIndex < navigablePoses.length - 1 ? navigablePoses[selectedNavIndex + 1] : null;

  // Keyboard handler is refreshed every render so it always sees the live pose,
  // while the window listener itself is only attached while the preview is open.
  const previewKeyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    previewKeyHandler.current = (event: KeyboardEvent) => {
      if (!selectedPose || regenerateTarget) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable))
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedPose(null);
      } else if (event.key === "ArrowLeft" && previousNavPose) {
        event.preventDefault();
        setSelectedPose(previousNavPose);
      } else if (event.key === "ArrowRight" && nextNavPose) {
        event.preventDefault();
        setSelectedPose(nextNavPose);
      } else if (
        (event.key === "d" || event.key === "D") &&
        visiblePoseOutputUrl(selectedPose) &&
        downloadingPoseId !== selectedPose._id
      ) {
        event.preventDefault();
        void downloadPose(selectedPose);
      }
    };
  });
  const previewOpen = Boolean(selectedPoseSnapshot);
  useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => previewKeyHandler.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewOpen]);

  const batchRunning = batchEntries.some((entry) => entry.state === "waiting" || entry.state === "submitting");
  useEffect(() => {
    if (!job || batchSubmittingRef.current) return;
    const jobActive = ACTIVE_JOB_STATUSES.includes(job.status);
    const wait = batchWaitRef.current;
    if (wait) {
      if (jobActive) {
        wait.sawActive = true;
        return;
      }
      // A poll from before the submission can still report the job as idle;
      // only move on once the server has visibly picked the previous pose up.
      const waitedPose = job.poses.find((pose: any) => pose._id === wait.poseId);
      if (!wait.sawActive && waitedPose && waitedPose.completedAt === wait.previousCompletedAt) return;
      batchWaitRef.current = null;
    }
    if (jobActive) return;
    const next = batchEntries.find((entry) => entry.state === "waiting");
    if (!next) return;
    const pose = job.poses.find((entry: any) => entry._id === next.poseId);
    const markEntry = (patch: Partial<BatchEntry>) =>
      setBatchEntries((entries) => entries.map((entry) => (entry.poseId === next.poseId ? { ...entry, ...patch } : entry)));
    batchSubmittingRef.current = true;
    markEntry({ state: "submitting" });
    void regeneratePose({
      poseId: next.poseId,
      requestedBy: user._id,
      poseQa: next.poseQa,
      extraInstructions: next.instructions,
    })
      .then(() => {
        batchWaitRef.current = { poseId: next.poseId, previousCompletedAt: Number(pose?.completedAt || 0), sawActive: false };
        batchSubmittingRef.current = false;
        markEntry({ state: "submitted" });
      })
      .catch((reason) => {
        batchSubmittingRef.current = false;
        markEntry({ state: "failed", error: reason instanceof Error ? reason.message : "Could not queue this regeneration." });
      });
  }, [job, batchEntries, regeneratePose, user._id]);

  const startBatchRegeneration = () => {
    if (!job) return;
    const eligible = job.poses
      .filter((pose: any) => batchSelection.includes(pose._id) && canRegeneratePose(pose, job.status))
      .sort((left: any, right: any) => left.poseNumber - right.poseNumber);
    if (!eligible.length) return;
    batchWaitRef.current = null;
    setBatchEntries(
      eligible.map((pose: any) => ({
        poseId: pose._id,
        poseNumber: pose.poseNumber,
        title: pose.title,
        state: "waiting" as const,
        instructions: batchNote.trim(),
        poseQa: batchPoseQa,
      }))
    );
    setBatchSelection([]);
  };

  const stopBatchRegeneration = () => {
    setBatchEntries((entries) =>
      entries.map((entry) => (entry.state === "waiting" ? { ...entry, state: "skipped", error: "Stopped before it was queued." } : entry))
    );
  };

  if (job === undefined) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  if (job === null) {
    return <div className="p-10 text-center text-sm font-medium text-secondary">Job record not found.</div>;
  }

  const promptBudgetPose = job.poses.find((pose: any) =>
    /invalid 'prompt': string too long|safe image-generation prompt/i.test(String(pose.error || ""))
  );
  const visibleError = promptBudgetPose
    ? `Pose ${promptBudgetPose.poseNumber || 1} was blocked before image generation: ${promptBudgetPose.error}`
    : job.errorMessage;
  const selectedOutputUrl = selectedPose ? visiblePoseOutputUrl(selectedPose) : "";
  const selectedRetainedPrevious = selectedPose ? hasRetainedPreviousVersion(selectedPose) : false;
  const selectedQaStatus = selectedPose ? visibleQaStatus(selectedPose) : "";
  const approvedPoseCount = job.poses.filter(
    (pose: any) => pose.approvalStatus === "approved" && Boolean(visiblePoseOutputUrl(pose))
  ).length;
  const selectedCanBeReviewed = Boolean(selectedPose?.generationId && selectedPose.status === "completed" && selectedPose.outputUrl);
  const selectedPreviousUrl = selectedPose && !selectedRetainedPrevious ? String(selectedPose.previousVersionUrl || "") : "";
  const selectedVersions = selectedPose ? poseVersions(selectedPose) : [];
  const selectedViewedVersion =
    viewedVersion && selectedPose && viewedVersion.poseId === selectedPose._id
      ? selectedVersions.find((version) => version.id === viewedVersion.versionId && !version.isCurrent) || null
      : null;
  const showCompare = Boolean(compareWithPrevious && selectedPreviousUrl && selectedOutputUrl && !selectedViewedVersion);
  const regenerationSummary = job.regenerationSummary || {
    regenerations: 0,
    regeneratedPoses: 0,
    averageRegenerationMs: 0,
    totalRegenerationMs: 0,
    regenerationCostUsd: 0,
  };
  const jobIsActive = ACTIVE_JOB_STATUSES.includes(job.status);
  const batchEligiblePoses = job.poses.filter((pose: any) => canRegeneratePose(pose, job.status));
  const batchSelectedCount = batchEligiblePoses.filter((pose: any) => batchSelection.includes(pose._id)).length;
  const batchSelectable = !jobIsActive && !batchRunning && batchEligiblePoses.length > 0;
  const toggleBatchPose = (poseId: string) =>
    setBatchSelection((current) => (current.includes(poseId) ? current.filter((id) => id !== poseId) : [...current, poseId]));

  return (
    <div className="space-y-6">
      {/* SPECS & ACTIONS RIBBON */}
      <div className="flex flex-col gap-4 rounded-2xl border border-outline-variant/40 bg-surface-container-lowest/90 p-5 shadow-sm backdrop-blur-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2.5 text-xs text-secondary">
          <div className="flex items-center gap-1.5 rounded-lg border border-outline-variant/50 bg-white px-2.5 py-1.5 font-medium shadow-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-secondary">Aspect</span>
            <span className="font-mono font-bold text-on-surface">{job.aspectRatio || "3:4"}</span>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-outline-variant/50 bg-white px-2.5 py-1.5 font-medium shadow-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-secondary">Size</span>
            <span className="font-mono font-bold text-on-surface">{job.imageSize || "1024x1024"}</span>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-outline-variant/50 bg-white px-2.5 py-1.5 font-medium shadow-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-secondary">Tier</span>
            <span className="font-bold capitalize text-primary">{job.quality || "medium"}</span>
          </div>

          <div
            className="flex items-center gap-1.5 rounded-lg border border-primary/25 bg-soft-blush px-2.5 py-1.5 font-medium shadow-xs"
            title={`Vision Analysis Engine: ${job.analysisModel || "Meta Muse Spark 1.2 Contributor"}`}
          >
            <Brain className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-secondary">Analysis</span>
            <span className="font-bold text-primary truncate max-w-[130px]">
              {formatModelName(job.analysisModel || "muse-spark-1.2-contributor")}
            </span>
          </div>

          <div
            className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 px-2.5 py-1.5 font-medium shadow-xs"
            title={`Image Generation Engine: ${job.generationModel || job.model || "GPT Image 2.5 Flare"}`}
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-secondary">Image Gen</span>
            <span className="font-bold text-indigo-700 truncate max-w-[130px]">
              {formatModelName(job.generationModel || job.model || "gpt-image-2.5-flare-2026-09-08")}
            </span>
          </div>

          <div className="flex flex-col justify-center rounded-lg border border-outline-variant/50 bg-white px-3 py-1 text-[11px] shadow-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-secondary">Cost so far</span>
              <span className="font-mono font-bold text-on-surface">${Number(job.actualCost || 0).toFixed(4)}</span>
              <span className="text-[10px] text-secondary">(${Number(job.estimatedCost || 0).toFixed(2)} est)</span>
            </div>
            {job.costBreakdown && (
              <span className="text-[9px] text-secondary/80">
                Analysis ${Number(job.costBreakdown.analysisUsd || 0).toFixed(4)} · Images ${Number(job.costBreakdown.generationUsd || 0).toFixed(4)}
                {job.costBreakdown.qaEnabled || job.costBreakdown.qaRan
                  ? ` · QA ${job.costBreakdown.qaRan ? `$${Number(job.costBreakdown.qaUsd || 0).toFixed(4)}` : "off"}`
                  : " · QA off"}
              </span>
            )}
          </div>

          {regenerationSummary.regenerations > 0 && (
            <div
              className="flex items-center gap-1.5 rounded-lg border border-primary/20 bg-soft-blush px-2.5 py-1.5 text-[11px] font-semibold text-primary shadow-xs"
              title="Versions retained in history"
            >
              <Layers className="h-3.5 w-3.5" />
              <span>
                {regenerationSummary.regenerations} retry in {regenerationSummary.regeneratedPoses} pose{regenerationSummary.regeneratedPoses === 1 ? "" : "s"}
              </span>
              <span className="font-mono text-[10px] font-bold text-primary/80">
                (${Number(regenerationSummary.regenerationCostUsd || 0).toFixed(4)})
              </span>
            </div>
          )}

          {visibleError && (
            <div className="flex items-center gap-1.5 rounded-lg border border-danger/20 bg-danger/5 px-2.5 py-1.5 text-[11px] font-medium text-danger">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span className="line-clamp-1">{visibleError}</span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowModelRoutingModal(true)}
            className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2 text-xs font-bold text-primary shadow-xs transition-all hover:bg-primary/10 hover:border-primary/50 active:scale-95"
            title="Inspect vision analysis and image generation models, routing, and mode details"
          >
            <Brain className="h-3.5 w-3.5 text-primary" />
            Pipeline Modes
          </button>

          <button
            onClick={() => void toggleReferences()}
            disabled={referencesLoading}
            className="flex items-center gap-1.5 rounded-xl border border-outline-variant/60 bg-white px-3.5 py-2 text-xs font-bold text-on-surface shadow-xs transition-all hover:border-primary/40 hover:bg-surface-container-low active:scale-95 disabled:opacity-50"
          >
            {referencesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Images className="h-3.5 w-3.5 text-secondary" />}
            {referencesLoading ? "Loading..." : showReferences ? "Hide references" : "View references"}
          </button>

          <button
            onClick={() => void cloneJob()}
            disabled={isCloning}
            className="flex items-center gap-1.5 rounded-xl border border-outline-variant/60 bg-white px-3.5 py-2 text-xs font-bold text-on-surface shadow-xs transition-all hover:border-primary/40 hover:bg-surface-container-low active:scale-95 disabled:opacity-50"
          >
            {isCloning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5 text-secondary" />}
            {isCloning ? "Cloning..." : "Clone Session"}
          </button>

          <button
            onClick={() => void downloadZip()}
            disabled={Boolean(zipping) || !job.poses.some((pose: any) => Boolean(visiblePoseOutputUrl(pose)))}
            className="flex items-center gap-1.5 rounded-xl bg-primary/10 px-3.5 py-2 text-xs font-bold text-primary shadow-xs transition-all hover:bg-primary/20 active:scale-95 disabled:opacity-50"
          >
            {zipping === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {zipping === "all" ? "Packaging ZIP..." : "Download ZIP"}
          </button>

          <button
            onClick={() => void downloadZip(true)}
            disabled={Boolean(zipping) || approvedPoseCount === 0}
            title={approvedPoseCount === 0 ? "No poses have been approved yet" : `Download the ${approvedPoseCount} approved images`}
            className="flex items-center gap-1.5 rounded-xl border border-emerald-600/30 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-800 shadow-xs transition-all hover:bg-emerald-100 active:scale-95 disabled:opacity-40"
          >
            {zipping === "approved" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />}
            {zipping === "approved" ? "Packaging..." : `Approved (${approvedPoseCount})`}
          </button>
        </div>
      </div>

      {/* PRODUCT & REFERENCE IMAGES DRAWER */}
      {showReferences && (
        <div className="overflow-hidden rounded-2xl border border-outline-variant/40 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">
              Attached Product & Style References
            </p>
            <span className="text-[11px] text-secondary">Click any reference to inspect full-size</span>
          </div>

          {referencesError && (
            <p className="flex items-center gap-2 rounded-xl bg-danger/5 p-3 text-sm text-danger">
              <AlertCircle className="h-4 w-4" /> {referencesError}
            </p>
          )}

          {!referencesError && references && references.length === 0 && (
            <p className="py-6 text-center text-xs text-secondary">No reference images were stored for this generation.</p>
          )}

          {!referencesError && references && references.length > 0 && (
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4 lg:grid-cols-6">
              {references.map((reference) => (
                <button
                  key={reference._id}
                  type="button"
                  onClick={() => setSelectedReference(reference)}
                  className="group relative flex flex-col overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-1.5 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-surface-container">
                    <img
                      src={reference.url}
                      alt={reference.label}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-navy-soft/0 transition-colors group-hover:bg-navy-soft/20 flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <Maximize2 className="h-5 w-5 text-white drop-shadow" />
                    </div>
                  </div>
                  <p className="mt-1.5 truncate px-0.5 text-[11px] font-semibold text-on-surface">{reference.label}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* BATCH REGENERATION PANEL */}
      {batchSelectable && (
        <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-soft-blush/60 via-white to-soft-blush/30 p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white shadow-xs">
                <ListChecks className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-on-surface">Batch Regeneration Studio</p>
                <span className="text-[11px] text-secondary">
                  {batchSelectedCount
                    ? `${batchSelectedCount} of ${batchEligiblePoses.length} eligible poses selected`
                    : "Check multiple pose cards below to regenerate them in sequence with a shared director's note."}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setBatchSelection(batchEligiblePoses.map((pose: any) => pose._id))}
                className="rounded-lg border border-outline-variant/70 bg-white px-3 py-1.5 text-xs font-bold text-on-surface shadow-xs transition-colors hover:border-primary/40 hover:bg-surface-container"
              >
                Select all ({batchEligiblePoses.length})
              </button>
              {batchSelectedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setBatchSelection([])}
                  className="rounded-lg border border-outline-variant/70 bg-white px-3 py-1.5 text-xs font-bold text-secondary shadow-xs transition-colors hover:bg-surface-container"
                >
                  Clear selection
                </button>
              )}
            </div>
          </div>

          {batchSelectedCount > 0 && (
            <div className="mt-4 space-y-3 pt-3 border-t border-primary/10">
              <textarea
                maxLength={1000}
                rows={3}
                value={batchNote}
                onChange={(event) => setBatchNote(event.target.value)}
                placeholder="Shared correction for every selected pose. (e.g., 'Ensure fabric drape falls naturally over the shoulder and remove excess jewelry. Keep original background and model identity unchanged.')"
                className="w-full resize-y rounded-xl border border-outline-variant/80 bg-white p-3.5 text-xs leading-relaxed text-on-surface shadow-inner outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs font-semibold text-on-surface cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={batchPoseQa}
                    onChange={(event) => setBatchPoseQa(event.target.checked)}
                    className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary accent-primary"
                  />
                  <span>Run Gemini consistency QA on newly generated frames</span>
                </label>
                <span className="font-mono text-[10px] text-secondary">{batchNote.length}/1000</span>
              </div>

              {batchEligiblePoses.some((pose: any) => pose.poseNumber === 1 && batchSelection.includes(pose._id)) && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 shadow-xs">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <p className="leading-snug">
                    <strong className="font-bold">Pose 1 is the Anchor Frame:</strong> Regenerating Pose 1 will generate a newly anchored model face and silhouette. If Pose 1 shifts, subsequent poses may also require regeneration to match.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <p className="text-[11px] text-secondary">
                  Poses queue sequentially to guarantee strict model identity. Keep this window open until complete.
                </p>
                <button
                  type="button"
                  onClick={startBatchRegeneration}
                  className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-white shadow-md transition-all hover:bg-primary-dark hover:shadow-lg active:scale-95"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Regenerate {batchSelectedCount} Pose{batchSelectedCount === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* BATCH PROGRESS STATUS */}
      {batchEntries.length > 0 && (
        <div className="rounded-2xl border border-outline-variant/40 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-bold text-on-surface">
              {batchRunning ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              )}
              <span>Batch Queue {batchRunning ? "In Progress" : "Complete"}</span>
              <span className="font-normal text-secondary">
                · {batchEntries.filter((entry) => entry.state === "submitted").length} queued
                {batchEntries.some((entry) => entry.state === "failed") &&
                  ` · ${batchEntries.filter((entry) => entry.state === "failed").length} failed`}
              </span>
            </div>
            {batchRunning ? (
              <button
                type="button"
                onClick={stopBatchRegeneration}
                className="rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-bold text-secondary hover:bg-surface-container"
              >
                Stop after current
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setBatchEntries([])}
                className="rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-bold text-secondary hover:bg-surface-container"
              >
                Dismiss
              </button>
            )}
          </div>
          <ul className="mt-3 divide-y divide-outline-variant/20 rounded-xl border border-outline-variant/30 bg-surface-container-lowest/50">
            {batchEntries.map((entry) => {
              const livePose = job.poses.find((pose: any) => pose._id === entry.poseId);
              const label =
                entry.state === "waiting"
                  ? "Waiting for previous pose to settle"
                  : entry.state === "submitting"
                  ? "Submitting to worker…"
                  : entry.state === "skipped"
                  ? entry.error || "Skipped"
                  : entry.state === "failed"
                  ? `Failed: ${entry.error || "Could not queue"}`
                  : `Queued · worker status: ${livePose?.status || "unknown"}`;
              return (
                <li
                  key={entry.poseId}
                  className={`flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 text-xs ${
                    entry.state === "failed" ? "bg-red-50 text-red-800" : "text-secondary"
                  }`}
                >
                  <span className="font-bold text-on-surface">
                    Pose {entry.poseNumber}. {entry.title}
                  </span>
                  <span className="font-medium text-[11px]">{label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 3:4 POSE GALLERY GRID */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {job.poses.map((pose: any) => {
          const outputUrl = visiblePoseOutputUrl(pose);
          const retainedPrevious = hasRetainedPreviousVersion(pose);
          const qaStatus = visibleQaStatus(pose);
          const approval = approvalBadge(pose.approvalStatus);
          const batchEligible = batchSelectable && canRegeneratePose(pose, job.status);
          const versions = poseVersions(pose);
          const currentVersion = versions.find((version) => version.isCurrent) || null;

          return (
            <div
              key={pose._id}
              className={`group flex flex-col ${outputUrl || latestRejected(pose) ? "cursor-zoom-in" : "cursor-default"}`}
              onClick={() => (outputUrl || latestRejected(pose)) && setSelectedPose(pose)}
            >
              {/* IMAGE TILE (3:4) */}
              <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-sm transition-all duration-300 group-hover:-translate-y-1 group-hover:border-primary/50 group-hover:shadow-lg">
                {outputUrl ? (
                  <img
                    src={outputUrl}
                    alt={retainedPrevious ? `${pose.title} — retained prior version` : pose.title}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : latestRejected(pose) ? (
                  <>
                    <img
                      src={latestRejected(pose).url}
                      alt={`${pose.title} — rejected attempt`}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover opacity-70 grayscale transition-transform duration-500 group-hover:scale-105"
                    />
                    <span className="absolute inset-x-0 bottom-0 bg-red-600/90 px-2 py-1 text-center text-[9px] font-bold uppercase tracking-wider text-white backdrop-blur-xs">
                      QA rejected · attempt {latestRejected(pose).attempt}
                    </span>
                  </>
                ) : (
                  <div className="grid h-full place-items-center bg-surface-container-lowest">
                    {pose.status === "processing" ? (
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Generating</span>
                      </div>
                    ) : (
                      <ImageIcon className="h-8 w-8 text-outline-variant/50" />
                    )}
                  </div>
                )}

                {/* STATUS BADGE (Top Left) */}
                <span
                  className={`absolute left-2.5 top-2.5 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase shadow-xs backdrop-blur-md ${statusClass(
                    pose.status
                  )}`}
                >
                  {retainedPrevious ? "Retry failed" : pose.status}
                </span>

                {/* APPROVAL BADGE (Top Left, Below Status) */}
                {approval && outputUrl && (
                  <span
                    className={`absolute left-2.5 top-8 flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase shadow-xs ${approval.className}`}
                  >
                    {pose.approvalStatus === "approved" ? <Check className="h-2.5 w-2.5" /> : <ThumbsDown className="h-2.5 w-2.5" />}
                    {approval.label}
                  </span>
                )}

                {/* QA VERDICT BANNER (Bottom) */}
                {retainedPrevious ? (
                  <span className="absolute inset-x-0 bottom-0 bg-slate-900/90 px-2 py-1 text-center text-[9px] font-bold uppercase tracking-wider text-white backdrop-blur-xs">
                    Prior version retained · {visibleQaLabel(qaStatus, shownQaEnabled(pose, Boolean(job.poseQa)))}
                  </span>
                ) : (
                  ["unverified", "requires_human_review", "rejected_by_qa", "human_approved", "human_rejected"].includes(qaStatus) &&
                  outputUrl && (
                    <span className={`absolute inset-x-0 bottom-0 px-2 py-1 text-center text-[9px] font-bold uppercase tracking-wider ${qaStatusBanner(qaStatus)}`}>
                      {visibleQaLabel(qaStatus, shownQaEnabled(pose, Boolean(job.poseQa)))}
                    </span>
                  )
                )}

                {/* HOVER QUICK ACTIONS (Top Right) */}
                <div className="absolute right-2 top-2 z-10 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {canRegeneratePose(pose, job.status) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRegenerateError("");
                        setExtraInstructions("");
                        setRegenerateTarget(pose);
                      }}
                      disabled={regeneratingId === pose._id}
                      title="Regenerate this pose"
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/95 text-primary shadow-md backdrop-blur-sm transition-transform hover:scale-105 active:scale-95"
                    >
                      {regeneratingId === pose._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                    </button>
                  )}

                  {outputUrl && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void downloadPose(pose);
                      }}
                      disabled={downloadingPoseId === pose._id}
                      title={retainedPrevious ? "Download retained prior version" : "Download high-res image"}
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/95 text-primary shadow-md backdrop-blur-sm transition-transform hover:scale-105 active:scale-95"
                    >
                      {downloadingPoseId === pose._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              </div>

              {/* POSE CARD FOOTER */}
              <div className="mt-2.5 flex items-start gap-2">
                {batchEligible && (
                  <input
                    type="checkbox"
                    checked={batchSelection.includes(pose._id)}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => toggleBatchPose(pose._id)}
                    aria-label={`Select pose ${pose.poseNumber} for batch regeneration`}
                    title="Select for batch regeneration"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-outline-variant accent-primary cursor-pointer"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="truncate font-manrope text-xs font-bold text-on-surface">
                    {pose.poseNumber}. {pose.title}
                  </h4>
                </div>
              </div>

              {/* FIDELITY ESTIMATE PILL */}
              {!retainedPrevious && outputUrl && pose.productFidelity > 0 && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span
                    className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold ${fidelityTone(
                      pose.productFidelity
                    )}`}
                  >
                    <ShieldCheck className="h-2.5 w-2.5" />
                    {pose.productFidelity}% fidelity
                  </span>
                </div>
              )}

              {/* TIMING & COST SUB-INFO */}
              {outputUrl && (
                <div className="mt-1.5 space-y-0.5 text-[10px] text-secondary">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-on-surface">${Number(pose.actualCost || 0).toFixed(4)}</span>
                    {currentVersion && formatDuration(versionHeadlineMs(currentVersion)) && (
                      <span className="text-[9px]">{formatDuration(versionHeadlineMs(currentVersion))}</span>
                    )}
                  </div>
                  {versions.length > 1 && (
                    <p className="flex items-center gap-1 text-[9px] font-semibold text-primary">
                      <Layers className="h-2.5 w-2.5" /> v{currentVersion?.version || versions.length} of {versions.length}
                    </p>
                  )}
                </div>
              )}

              {pose.error && (
                <p className="mt-1.5 line-clamp-2 rounded-lg border border-danger/20 bg-danger/10 p-1.5 text-[10px] leading-tight text-danger">
                  {pose.error}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* SELECTED POSE LIGHTBOX / ATELIER INSPECTOR */}
      {selectedPose && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-navy-soft/85 p-3 sm:p-6 backdrop-blur-md"
          onClick={() => setSelectedPose(null)}
        >
          <div
            className="flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/10"
            onClick={(event) => event.stopPropagation()}
          >
            {/* LIGHTBOX HEADER */}
            <div className="flex items-center justify-between border-b border-outline-variant/40 bg-surface-container-lowest px-6 py-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
                  Pose {selectedPose.poseNumber}
                  {selectedNavIndex >= 0 ? ` · Frame ${selectedNavIndex + 1} of ${navigablePoses.length}` : ""}
                </p>
                <h3 className="font-manrope text-xl font-bold text-on-surface">{selectedPose.title}</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="mr-2 hidden rounded-lg bg-surface-container px-2 py-1 text-[10px] font-mono text-secondary md:inline">
                  ← / → browse · D download · Esc close
                </span>
                {selectedPreviousUrl && selectedOutputUrl && (
                  <button
                    onClick={() => setCompareWithPrevious((current) => !current)}
                    className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all ${
                      compareWithPrevious
                        ? "border-primary bg-soft-blush text-primary shadow-xs"
                        : "border-outline-variant/70 text-secondary hover:bg-surface-container"
                    }`}
                  >
                    <Columns2 className="h-3.5 w-3.5" />
                    {compareWithPrevious ? "Hide comparison" : "Compare with previous"}
                  </button>
                )}
                <button
                  onClick={() => previousNavPose && setSelectedPose(previousNavPose)}
                  disabled={!previousNavPose}
                  title="Previous frame (←)"
                  className="rounded-xl border border-outline-variant/60 p-2 text-secondary hover:bg-surface-container disabled:opacity-30"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  onClick={() => nextNavPose && setSelectedPose(nextNavPose)}
                  disabled={!nextNavPose}
                  title="Next frame (→)"
                  className="rounded-xl border border-outline-variant/60 p-2 text-secondary hover:bg-surface-container disabled:opacity-30"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setSelectedPose(null)}
                  title="Close (Esc)"
                  className="rounded-xl border border-outline-variant/60 p-2 text-secondary hover:bg-surface-container"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* LIGHTBOX BODY (SPLIT CANVAS & INSPECTOR) */}
            <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
              {/* IMAGE CANVAS */}
              {showCompare ? (
                <div className="grid min-h-0 grid-cols-2 gap-4 overflow-auto bg-neutral-950 p-6">
                  <figure className="flex min-h-0 flex-col items-center justify-center gap-2.5">
                    <figcaption className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/90">
                      Previous Version
                    </figcaption>
                    <img
                      src={selectedPreviousUrl}
                      alt={`${selectedPose.title} — previous version`}
                      decoding="async"
                      className="max-h-[72vh] max-w-full rounded-lg object-contain shadow-2xl"
                    />
                  </figure>
                  <figure className="flex min-h-0 flex-col items-center justify-center gap-2.5">
                    <figcaption className="rounded-full bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                      Current Version
                    </figcaption>
                    <img
                      src={selectedOutputUrl}
                      alt={`${selectedPose.title} — current version`}
                      decoding="async"
                      className="max-h-[72vh] max-w-full rounded-lg object-contain shadow-2xl"
                    />
                  </figure>
                </div>
              ) : selectedViewedVersion ? (
                <div className="relative grid min-h-0 place-items-center overflow-auto bg-neutral-950 p-6">
                  <span className="absolute left-6 top-6 rounded-full bg-white/20 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur-md">
                    Version {selectedViewedVersion.version} of {selectedVersions.length} · Archived
                  </span>
                  <img
                    src={selectedViewedVersion.url}
                    alt={`${selectedPose.title} — version ${selectedViewedVersion.version}`}
                    decoding="async"
                    className="max-h-[76vh] max-w-full rounded-lg object-contain shadow-2xl"
                  />
                </div>
              ) : (
                <div className="grid min-h-0 place-items-center overflow-auto bg-neutral-950 p-6">
                  <img
                    src={selectedOutputUrl || latestRejected(selectedPose)?.url}
                    alt={selectedPose.title}
                    decoding="async"
                    className="max-h-[76vh] max-w-full rounded-lg object-contain shadow-2xl"
                  />
                </div>
              )}

              {/* INSPECTOR ASIDE */}
              <aside className="space-y-4 overflow-y-auto border-l border-outline-variant/30 bg-white p-5 text-sm">
                {selectedViewedVersion && (
                  <div className="rounded-2xl border border-primary/30 bg-soft-blush p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                      Viewing version {selectedViewedVersion.version} (Archived)
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-secondary">
                      Showing earlier rendered output. Switch back to current to review latest QA verdict or submit approvals.
                    </p>
                    <button
                      type="button"
                      onClick={() => setViewedVersion(null)}
                      className="mt-2.5 rounded-lg border border-primary/40 bg-white px-3 py-1.5 text-xs font-bold text-primary shadow-xs hover:bg-primary/5"
                    >
                      Back to current version
                    </button>
                  </div>
                )}

                {/* REVIEW DECISION CARD */}
                {!selectedViewedVersion && selectedCanBeReviewed && (canApprove || selectedPose.approvalStatus !== "pending") && (
                  <div
                    className={`rounded-2xl border p-4 shadow-xs ${
                      selectedPose.approvalStatus === "approved"
                        ? "border-emerald-600/30 bg-emerald-50/70"
                        : selectedPose.approvalStatus === "rejected"
                        ? "border-red-600/30 bg-red-50/70"
                        : "border-outline-variant/50 bg-surface-container-lowest"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-secondary">Review Decision</p>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold capitalize ${
                          selectedPose.approvalStatus === "approved"
                            ? "bg-emerald-600 text-white"
                            : selectedPose.approvalStatus === "rejected"
                            ? "bg-red-600 text-white"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {selectedPose.approvalStatus === "pending" ? "Pending review" : selectedPose.approvalStatus}
                      </span>
                    </div>

                    {canApprove &&
                      (selectedPose.approvalStatus === "pending" ? (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            onClick={() => void setApproval(selectedPose, "approved")}
                            disabled={approvingId === selectedPose._id}
                            className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                          >
                            {approvingId === selectedPose._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            Approve
                          </button>
                          <button
                            onClick={() => void setApproval(selectedPose, "rejected")}
                            disabled={approvingId === selectedPose._id}
                            className="flex items-center justify-center gap-1.5 rounded-xl border border-red-600/30 bg-white px-3 py-2 text-xs font-bold text-red-700 shadow-xs hover:bg-red-50 active:scale-95 disabled:opacity-50"
                          >
                            {approvingId === selectedPose._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsDown className="h-3.5 w-3.5" />}
                            Reject
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => void setApproval(selectedPose, "pending")}
                          disabled={approvingId === selectedPose._id}
                          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-outline-variant bg-white px-3 py-2 text-xs font-bold text-secondary shadow-xs hover:bg-surface-container active:scale-95 disabled:opacity-50"
                        >
                          {approvingId === selectedPose._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                          Reset to pending review
                        </button>
                      ))}

                    {approvalError && approvalError.poseId === selectedPose._id && (
                      <p className="mt-2 text-[10px] leading-tight text-danger">{approvalError.message}</p>
                    )}
                  </div>
                )}

                {/* AI QA & CONSISTENCY ESTIMATE */}
                {(selectedQaStatus || selectedPose.productFidelity > 0 || Object.keys(selectedPose.fidelityScores || {}).length > 0) && (
                  <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-4 shadow-xs">
                    <div className="flex items-baseline justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-secondary">Gemini Vision QA Score</p>
                      <p className={`font-mono text-xl font-bold ${fidelityTone(selectedPose.productFidelity)}`}>
                        {selectedPose.productFidelity}%
                      </p>
                    </div>

                    {selectedQaStatus === "human_approved" ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-emerald-700">
                        Human approved. The percentage remains the recorded AI estimate; human review verified the output.
                      </p>
                    ) : selectedQaStatus === "unverified" ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
                        {shownQaEnabled(selectedPose, Boolean(job.poseQa))
                          ? "Automatic QA was unavailable during shoot delivery."
                          : "Automatic QA was disabled for this run."}{" "}
                        Verify drape, patterns, and back authority manually.
                      </p>
                    ) : selectedQaStatus === "requires_human_review" || selectedPose.fidelityReviewRecommended ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
                        Score falls in the 90–94% tolerance zone. Human inspection recommended before catalog export.
                      </p>
                    ) : selectedQaStatus === "rejected_by_qa" || selectedQaStatus === "failed" ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-red-700">
                        Automatic QA rejected this frame due to detected inconsistencies against source references.
                      </p>
                    ) : null}

                    {/* METRIC PROGRESS BARS */}
                    {Object.keys(selectedPose.fidelityScores || {}).length > 0 && (
                      <dl className="mt-3.5 space-y-2 border-t border-outline-variant/30 pt-3">
                        {Object.entries(selectedPose.fidelityScores as Record<string, number>)
                          .sort((left, right) => left[1] - right[1])
                          .map(([key, score]) => (
                            <div key={key} className="flex items-center gap-2 text-[11px]">
                              <dt className="w-28 shrink-0 truncate capitalize text-secondary" title={key}>
                                {key.replace(/_/g, " ")}
                              </dt>
                              <dd className="flex flex-1 items-center gap-2">
                                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-container-high">
                                  <span
                                    className={`block h-full rounded-full ${
                                      score >= 95 ? "bg-emerald-500" : score >= 90 ? "bg-amber-500" : "bg-red-500"
                                    }`}
                                    style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                                  />
                                </span>
                                <span className="font-mono w-8 shrink-0 text-right text-[10px] font-bold text-on-surface">
                                  {score}%
                                </span>
                              </dd>
                            </div>
                          ))}
                      </dl>
                    )}

                    {selectedPose.qaReason && (
                      <p className="mt-3 rounded-lg bg-surface-container-low p-2 text-[10px] leading-relaxed text-secondary">
                        {selectedPose.qaReason}
                      </p>
                    )}

                    {Array.isArray(selectedPose.qaHistory) && selectedPose.qaHistory.length > 0 && (
                      <div className="mt-3 border-t border-outline-variant/30 pt-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-secondary">QA Audit History</p>
                        <div className="mt-2 space-y-1.5">
                          {selectedPose.qaHistory.map((review: any) => (
                            <div key={review.id} className="rounded-lg border border-outline-variant/30 bg-white p-2 text-[10px] leading-snug">
                              <p className="font-bold text-on-surface">
                                {qaStatusLabel(qaReviewOutcome(review))}
                                {String(review.reviewer_type || "").startsWith("human_") ? "" : ` · ${Number(review.score || 0)}%`}
                              </p>
                              <p className="text-secondary text-[9px]">
                                {review.qa_version || "legacy"} · {review.created_at ? new Date(review.created_at).toLocaleString("en-IN") : "time n/a"}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* VERSION HISTORY */}
                {selectedVersions.length > 0 && (
                  <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-4 shadow-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-secondary">
                        <Layers className="h-3 w-3 text-primary" /> Version History
                      </p>
                      <span className="font-mono text-[10px] text-secondary">
                        {selectedVersions.length} kept · {selectedVersions.length - 1} retry
                      </span>
                    </div>

                    <ol className="mt-3 space-y-2.5">
                      {[...selectedVersions].reverse().map((version) => {
                        const viewing = selectedViewedVersion ? selectedViewedVersion.id === version.id : version.isCurrent;
                        const headline = formatDuration(versionHeadlineMs(version));
                        const downloadKey = `${selectedPose._id}:v${version.version}`;

                        return (
                          <li
                            key={version.id}
                            className={`flex gap-3 rounded-xl p-2 transition-colors ${
                              viewing ? "bg-soft-blush ring-1 ring-primary/40" : "bg-white border border-outline-variant/30"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setViewedVersion(version.isCurrent ? null : { poseId: selectedPose._id, versionId: version.id })
                              }
                              title={version.isCurrent ? "Show current version" : `Inspect v${version.version}`}
                              className="shrink-0 group overflow-hidden rounded-lg border border-outline-variant/40"
                            >
                              <img
                                src={version.url}
                                alt={`v${version.version}`}
                                loading="lazy"
                                decoding="async"
                                className="h-16 w-12 object-cover transition-transform group-hover:scale-105"
                              />
                            </button>
                            <div className="min-w-0 flex-1 text-[10px] leading-snug text-secondary">
                              <p className="flex items-center gap-1.5 font-manrope text-[11px] font-bold text-on-surface">
                                Version {version.version}
                                {version.isCurrent && (
                                  <span className="rounded-full bg-primary px-1.5 py-0.2 text-[8px] font-bold uppercase text-white">
                                    Current
                                  </span>
                                )}
                              </p>
                              <p>{version.createdAt ? new Date(version.createdAt).toLocaleString("en-IN") : "Time n/a"}</p>
                              {headline && (
                                <p className="font-medium text-on-surface/80" title={versionTimingDetail(version)}>
                                  {version.isRegeneration ? "Regenerated in" : "Generated in"} {headline}
                                </p>
                              )}
                              <div className="mt-2 flex gap-1.5">
                                {!version.isCurrent && !viewing && (
                                  <button
                                    type="button"
                                    onClick={() => setViewedVersion({ poseId: selectedPose._id, versionId: version.id })}
                                    className="flex items-center gap-1 rounded-md border border-outline-variant bg-white px-2 py-0.5 font-bold text-secondary hover:bg-surface-container"
                                  >
                                    <Eye className="h-3 w-3" /> View
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => void downloadVersion(selectedPose, version)}
                                  disabled={downloadingPoseId === downloadKey}
                                  className="flex items-center gap-1 rounded-md border border-outline-variant bg-white px-2 py-0.5 font-bold text-secondary hover:bg-surface-container disabled:opacity-50"
                                >
                                  {downloadingPoseId === downloadKey ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Download className="h-3 w-3" />
                                  )}
                                  Download
                                </button>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}

                {/* PRIMARY ACTIONS */}
                <div className="space-y-2 pt-2">
                  {selectedPose.completedAt &&
                    Date.now() - selectedPose.completedAt < 86400000 &&
                    !["queued", "processing", "cancelling"].includes(job.status) && (
                      <button
                        onClick={() => {
                          setRegenerateError("");
                          setExtraInstructions("");
                          setRegeneratePoseQa(false);
                          setRegenerateTarget(selectedPose);
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-soft-blush px-4 py-3 font-bold text-primary shadow-xs transition-colors hover:bg-primary/15"
                      >
                        <RefreshCcw className="h-4 w-4" /> Regenerate with instructions
                      </button>
                    )}

                  {selectedOutputUrl && (
                    <button
                      onClick={() => void downloadPose(selectedPose)}
                      disabled={downloadingPoseId === selectedPose._id}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-white shadow-md transition-all hover:bg-primary-dark hover:shadow-lg active:scale-95 disabled:opacity-50"
                    >
                      {downloadingPoseId === selectedPose._id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      {downloadingPoseId === selectedPose._id
                        ? "Preparing Asset…"
                        : selectedRetainedPrevious
                        ? "Download retained prior version"
                        : "Download High-Res Image"}
                    </button>
                  )}

                  {workspace.isAdmin && selectedPose.outputUrl && !selectedViewedVersion && (
                    <button
                      onClick={() => void runLatestQa(selectedPose)}
                      disabled={rerunningQaId === selectedPose._id}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-outline-variant bg-white px-4 py-2.5 text-xs font-bold text-secondary shadow-xs hover:border-primary/40 hover:text-primary disabled:opacity-50"
                    >
                      {rerunningQaId === selectedPose._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
                      Re-run QA Model
                    </button>
                  )}

                  {qaRerunNotice && (
                    <p className="rounded-xl bg-surface-container p-2.5 text-[11px] leading-tight text-secondary">
                      {qaRerunNotice}
                    </p>
                  )}
                </div>

                {/* ARCHIVED REJECTED ATTEMPTS */}
                {rejectedOf(selectedPose).length > 0 && (
                  <div className="rounded-2xl border border-outline-variant/40 bg-white p-4 shadow-xs">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-secondary">QA-Rejected Retries</p>
                    <div className="mt-3 space-y-2.5">
                      {rejectedOf(selectedPose).map((attempt: any) => (
                        <div key={attempt.storagePath} className="flex gap-2.5 rounded-lg border border-outline-variant/30 p-2">
                          <img
                            src={attempt.url}
                            alt={`Attempt ${attempt.attempt}`}
                            loading="lazy"
                            decoding="async"
                            className="h-14 w-11 shrink-0 rounded object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-bold text-on-surface">
                              Attempt {attempt.attempt} · score {Number(attempt.score || 0)}%
                            </p>
                            <p className="mt-0.5 line-clamp-2 text-[9px] text-secondary">{attempt.reason}</p>
                            <button
                              onClick={() => void downloadArchived(selectedPose, attempt)}
                              disabled={downloadingPoseId === `${selectedPose._id}:${attempt.storagePath}`}
                              className="mt-1 flex items-center gap-1 text-[9px] font-bold text-primary hover:underline disabled:opacity-50"
                            >
                              Download rejected output
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

      {/* SINGLE POSE REGENERATE MODAL */}
      {regenerateTarget && (
        <div
          className="fixed inset-0 z-[110] grid place-items-center bg-navy-soft/85 p-4 backdrop-blur-md"
          onClick={() => !regeneratingId && setRegenerateTarget(null)}
        >
          <form
            onSubmit={submitRegeneration}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-xl rounded-3xl bg-white p-7 shadow-2xl ring-1 ring-black/10"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                  Pose {regenerateTarget.poseNumber}
                </p>
                <h3 className="mt-1 font-manrope text-2xl font-bold text-on-surface">Regenerate {regenerateTarget.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-secondary">
                  Specify targeted corrections. Original garment silhouette, fabric texture, model identity, and camera setup remain locked.
                </p>
              </div>
              <button
                type="button"
                disabled={Boolean(regeneratingId)}
                onClick={() => setRegenerateTarget(null)}
                className="rounded-xl border border-outline-variant/60 p-2 text-secondary hover:bg-surface-container disabled:opacity-40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {regenerateTarget.poseNumber === 1 && (
              <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900 shadow-xs">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <p className="leading-snug">
                  <strong className="font-bold">Pose 1 is the Face & Shoot Anchor:</strong> Modifying Pose 1 alters the model facial structure and lighting setup for subsequent poses. Regenerate poses 2–6 afterward if you update Pose 1.
                </p>
              </div>
            )}

            <label className="mt-5 block text-xs font-bold uppercase tracking-wider text-secondary">
              Correction instructions
              <textarea
                autoFocus
                maxLength={1000}
                rows={4}
                value={extraInstructions}
                onChange={(event) => setExtraInstructions(event.target.value)}
                placeholder="Example: Back side should have no hanging latkan elements. Preserve clean zari border along the pallu edge exactly as in reference."
                className="mt-2 w-full resize-y rounded-xl border border-outline-variant p-3.5 text-xs font-normal normal-case leading-relaxed text-on-surface outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <div className="mt-1.5 flex justify-between text-[10px] text-secondary">
              <span>Leave blank to re-render with existing locked shoot plan.</span>
              <span className="font-mono">{extraInstructions.length}/1000</span>
            </div>

            <label className="mt-4 flex items-center gap-2 text-xs font-semibold text-on-surface cursor-pointer select-none">
              <input
                type="checkbox"
                checked={regeneratePoseQa}
                onChange={(event) => setRegeneratePoseQa(event.target.checked)}
                className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary accent-primary"
              />
              <span>Run consistency QA on regenerated frame</span>
            </label>

            {regenerateError && (
              <p className="mt-4 rounded-xl border border-danger/20 bg-danger/10 p-3 text-xs text-danger">{regenerateError}</p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={Boolean(regeneratingId)}
                onClick={() => setRegenerateTarget(null)}
                className="rounded-xl border border-outline-variant px-4 py-2.5 text-xs font-bold text-secondary hover:bg-surface-container"
              >
                Cancel
              </button>
              <button
                disabled={Boolean(regeneratingId)}
                className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-primary-dark active:scale-95 disabled:opacity-50"
              >
                {regeneratingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                {regeneratingId ? "Queueing…" : "Regenerate Pose"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* REFERENCE DETAIL MODAL */}
      {selectedReference && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-navy-soft/85 p-4 backdrop-blur-md"
          onClick={() => setSelectedReference(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/10"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-outline-variant/40 px-6 py-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Reference Asset</p>
                <h3 className="font-manrope text-lg font-bold tracking-tight text-on-surface">{selectedReference.label}</h3>
              </div>
              <button
                onClick={() => setSelectedReference(null)}
                className="rounded-xl border border-outline-variant/60 p-2 text-secondary hover:bg-surface-container"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-neutral-950 p-6">
              <img
                src={selectedReference.url}
                alt={selectedReference.label}
                decoding="async"
                className="max-h-[76vh] max-w-full rounded-lg object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {/* MODEL ROUTING & PIPELINE MODES MODAL */}
      {showModelRoutingModal && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-navy-soft/85 p-4 backdrop-blur-md"
          onClick={() => setShowModelRoutingModal(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/10"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-outline-variant/40 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Brain className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-manrope text-base font-bold tracking-tight text-on-surface">
                    AI Pipeline Modes & Model Execution
                  </h3>
                  <p className="text-[11px] text-secondary">
                    SKU: <span className="font-mono font-bold text-on-surface">{job.skuId}</span> · {job.skuName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowModelRoutingModal(false)}
                className="rounded-xl border border-outline-variant/60 p-2 text-secondary hover:bg-surface-container"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto p-6 text-xs">
              {/* STAGE 1: PRODUCT TRUTH & VISION ANALYSIS */}
              <div className="rounded-2xl border border-primary/20 bg-soft-blush/40 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-primary">
                    <Brain className="h-4 w-4 text-primary" />
                    Stage 1 · Product Truth Vision & 6-Pose Planning
                  </span>
                  <span className="rounded-full bg-success-surface px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success">
                    Active Mode
                  </span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-outline-variant/30 bg-white p-3">
                    <span className="block text-[10px] font-bold uppercase text-secondary">Vision Analysis Model</span>
                    <span className="mt-0.5 block font-mono text-xs font-bold text-on-surface">
                      {job.analysisModel || "muse-spark-1.2-contributor"}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-semibold text-primary">
                      {formatModelName(job.analysisModel || "muse-spark-1.2-contributor")}
                    </span>
                  </div>
                  <div className="rounded-xl border border-outline-variant/30 bg-white p-3">
                    <span className="block text-[10px] font-bold uppercase text-secondary">Provider & Reasoning</span>
                    <span className="mt-0.5 block font-mono text-xs font-bold text-on-surface">
                      {job.analysisProvider ? `${job.analysisProvider[0].toUpperCase()}${job.analysisProvider.slice(1)}` : "Meta Muse Spark"}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-secondary">
                      Thinking Effort: <strong className="text-on-surface">{job.analysisThinking || "Low (Fast analysis)"}</strong>
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-primary/10 pt-3 text-[11px] text-secondary">
                  <span>
                    Cost: <strong className="text-on-surface">${Number(job.costBreakdown?.analysisUsd || 0).toFixed(4)}</strong>
                  </span>
                  {job.analysisLatencyMs && (
                    <span>
                      Latency: <strong className="text-on-surface">{job.analysisLatencyMs} ms</strong>
                    </span>
                  )}
                  <span className="rounded-md bg-white px-2 py-0.5 text-[10px] text-secondary border border-outline-variant/30">
                    Fallback: OpenAI GPT 5.6 Luna enabled
                  </span>
                </div>
              </div>

              {/* STAGE 2: MULTI-POSE IMAGE GENERATION */}
              <div className="rounded-2xl border border-indigo-200/80 bg-indigo-50/30 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                    <Sparkles className="h-4 w-4 text-indigo-600" />
                    Stage 2 · Multi-Pose Photorealistic Generation
                  </span>
                  <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                    Engine
                  </span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-outline-variant/30 bg-white p-3">
                    <span className="block text-[10px] font-bold uppercase text-secondary">Generation Model</span>
                    <span className="mt-0.5 block font-mono text-xs font-bold text-on-surface">
                      {job.generationModel || job.model || "gpt-image-2.5-flare-2026-09-08"}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-semibold text-indigo-700">
                      {formatModelName(job.generationModel || job.model || "gpt-image-2.5-flare-2026-09-08")}
                    </span>
                  </div>
                  <div className="rounded-xl border border-outline-variant/30 bg-white p-3">
                    <span className="block text-[10px] font-bold uppercase text-secondary">Specs & Format</span>
                    <span className="mt-0.5 block text-xs font-bold text-on-surface">
                      Aspect {job.aspectRatio || "3:4"} · {job.imageSize || "1024x1024"}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-secondary">
                      Quality: <strong className="capitalize text-on-surface">{job.quality || "medium"}</strong> · Provider: OpenAI
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-indigo-100 pt-3 text-[11px] text-secondary">
                  <span>
                    Delivered: <strong className="text-on-surface">{job.completedPoses} / {job.totalPoses} poses</strong>
                  </span>
                  <span>
                    Cost: <strong className="text-on-surface">${Number(job.costBreakdown?.generationUsd || 0).toFixed(4)}</strong>
                  </span>
                </div>
              </div>

              {/* STAGE 3: CONSISTENCY QA */}
              <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-secondary">
                    <ShieldCheck className="h-4 w-4 text-secondary" />
                    Stage 3 · Consistency Quality Assurance
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${job.poseQa ? "bg-success-surface text-success" : "bg-surface-container text-secondary"}`}>
                    {job.poseQa ? "Enabled" : "Off"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-secondary">
                  <span>
                    Status: {job.costBreakdown?.qaRan ? "Automated validation executed" : job.poseQa ? "Configured for poses" : "QA not requested for this shoot"}
                  </span>
                  <span>
                    QA Cost: <strong className="text-on-surface">${Number(job.costBreakdown?.qaUsd || 0).toFixed(4)}</strong>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end border-t border-outline-variant/30 bg-surface-container-low px-6 py-3.5">
              <button
                onClick={() => setShowModelRoutingModal(false)}
                className="rounded-xl bg-primary px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-primary-dark"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {downloadError && (
        <div className="fixed bottom-6 right-6 z-[120] flex items-center gap-3 rounded-2xl border border-danger/30 bg-white px-5 py-4 text-xs text-danger shadow-2xl">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="font-semibold">{downloadError}</span>
          <button
            onClick={() => setDownloadError("")}
            className="ml-3 text-[10px] font-bold uppercase tracking-widest text-secondary hover:text-on-surface"
          >
            Dismiss
          </button>
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
  // History opens on stored generations rather than empty active queue.
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
  }) as {
    data: { items: any[]; page: number; pageSize: number; total: number; totalPages: number } | undefined;
    error: any;
  };
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
    try {
      await cancelJob({ jobId });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not stop generation.");
    } finally {
      setBusyJobId(null);
    }
  };

  const deleteGeneration = async (jobId: string) => {
    setBusyJobId(jobId);
    try {
      await removeJob({ jobId });
      if (expanded === jobId) setExpanded(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete generation.");
    } finally {
      setBusyJobId(null);
    }
  };

  const regenerateFailedSession = async (jobId: string) => {
    setBusyJobId(jobId);
    try {
      await regenerateSession({ jobId });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not regenerate this session.");
    } finally {
      setBusyJobId(null);
    }
  };

  const actionDialog =
    pendingAction?.type === "stop"
      ? {
          title: `Stop ${pendingAction.sku}?`,
          description: "All remaining poses will be cancelled. Images that already completed remain saved in this generation history.",
          confirmLabel: "Stop generation",
          tone: "danger" as const,
        }
      : pendingAction?.type === "delete"
      ? {
          title: `Delete ${pendingAction.sku}?`,
          description: "This permanently removes the generation record and its stored generated images. This action cannot be undone.",
          confirmLabel: "Delete generation",
          tone: "danger" as const,
        }
      : pendingAction?.type === "regenerate"
      ? {
          title: `Retry failed poses for ${pendingAction.sku}?`,
          description: "Every pose that did not complete will be attempted again. Poses already completed remain unchanged.",
          confirmLabel: "Retry failed poses",
          tone: "primary" as const,
        }
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
    <div className="mx-auto max-w-[1400px] space-y-6 pb-12">
      {/* EDITORIAL ATELIER HEADER */}
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end border-b border-outline-variant/30 pb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-soft-blush px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              <Sparkles className="h-3 w-3" /> Youthnic Atelier Archive
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
              <ShieldCheck className="h-3 w-3" /> 2–3 Year Cloud Retention
            </span>
            {jobsPage?.total !== undefined && (
              <span className="font-mono text-xs text-secondary">({jobsPage.total} shoots)</span>
            )}
          </div>
          <h1 className="font-manrope text-2xl sm:text-[28px] font-bold tracking-tight text-on-surface">
            History & Productions
          </h1>
          <p className="mt-1 text-xs text-secondary">
            Inspect model fidelity scores, audit 6-pose collections, download high-res assets, and manage batch regenerations.
          </p>
        </div>

        {/* SEARCH & FILTERS TOOLBAR */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search SKU or prompt…"
              className="h-10 w-60 rounded-xl border border-outline-variant/70 bg-white pl-9 pr-8 text-xs font-medium text-on-surface shadow-xs outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-secondary hover:text-on-surface"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="relative">
            <select
              value={sourceType}
              onChange={(event) => {
                setSourceType(event.target.value);
                setPage(1);
                setExpanded(null);
              }}
              className="h-10 appearance-none rounded-xl border border-outline-variant/70 bg-white pl-3.5 pr-8 text-xs font-semibold text-on-surface shadow-xs outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 cursor-pointer"
            >
              <option value="">All Sources</option>
              <option value="studio">Studio</option>
              <option value="catalog">Catalog Production</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary" />
          </div>

          <div className="relative">
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
                setExpanded(null);
              }}
              className="h-10 appearance-none rounded-xl border border-outline-variant/70 bg-white pl-3.5 pr-8 text-xs font-semibold text-on-surface shadow-xs outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 cursor-pointer"
            >
              <option value="">All Statuses</option>
              <option value="active">Active Productions</option>
              <option value="queued">Queued</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary" />
          </div>
        </div>
      </div>

      {/* JOBS ARCHIVE ACCORDION TABLE */}
      <div className="flex flex-col overflow-hidden rounded-3xl border border-outline-variant/40 bg-white shadow-sm ring-1 ring-black/5">
        {jobs === undefined && (
          <div className="flex flex-col items-center justify-center py-24 text-secondary">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
            <span className="font-manrope text-xs font-bold uppercase tracking-wider text-secondary">
              Synchronizing Archive…
            </span>
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
            <article
              key={job._id}
              className={`group relative border-b border-outline-variant/20 last:border-b-0 transition-colors duration-200 ${
                open ? "bg-surface-container-lowest" : "bg-white hover:bg-surface-container-lowest/60"
              }`}
            >
              {/* ACCORDION HEADER ROW */}
              <div
                onClick={() => setExpanded(open ? null : job._id)}
                className="flex cursor-pointer items-center gap-4 p-4 lg:grid lg:grid-cols-[minmax(0,1.2fr)_180px_180px_auto]"
              >
                {/* COL 1: SKU & Thumbnail */}
                <div className="flex min-w-0 items-center gap-3.5">
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-surface-container border border-outline-variant/40 shadow-xs">
                    {job.thumbnailUrl ? (
                      <img
                        src={job.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <ImageIcon className="m-3.5 h-5 w-5 text-secondary/40" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-bold text-on-surface bg-surface-container-low px-2 py-0.5 rounded-md border border-outline-variant/40">
                        {job.skuId}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${statusClass(
                          job.status
                        )}`}
                      >
                        {job.status === "queued" && <Clock className="h-2.5 w-2.5" />}
                        {job.status === "processing" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                        {job.detailedStatus || job.status}
                      </span>
                      {job.analysisModel && (
                        <span
                          className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-1.5 py-0.5 text-[9px] font-semibold text-purple-700 border border-purple-200/60"
                          title={`Vision Analysis: ${job.analysisModel}`}
                        >
                          <Brain className="h-2.5 w-2.5 text-purple-500" />
                          {formatModelName(job.analysisModel)}
                        </span>
                      )}
                      {job.generationModel && (
                        <span
                          className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-700 border border-indigo-200/60"
                          title={`Image Generation: ${job.generationModel}`}
                        >
                          <Sparkles className="h-2.5 w-2.5 text-indigo-500" />
                          {formatModelName(job.generationModel)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs font-semibold text-secondary">
                      {job.skuName || "Untitled Studio Production"}
                    </p>
                  </div>
                </div>

                {/* COL 2: Delivery Progress */}
                <div className="hidden lg:block">
                  <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-secondary">
                    <span>
                      {job.status === "processing" ? `Pose ${Math.max(1, job.currentPose || delivery.resolvedPoses + 1)} · ` : ""}
                      {delivery.imagesStored} / {delivery.totalPoses} images
                    </span>
                    <span className="font-mono font-bold text-on-surface">{progress}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        job.status === "failed"
                          ? "bg-red-500"
                          : job.status === "completed"
                          ? "bg-emerald-500"
                          : "bg-primary"
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {/* COL 3: Creator & Date */}
                <div className="hidden flex-col text-xs text-secondary lg:flex">
                  <span className="truncate font-semibold text-on-surface" title={job.creatorEmail}>
                    {job.creatorName}
                  </span>
                  <span className="text-[10px] text-secondary">
                    {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(job.createdAt)}
                  </span>
                </div>

                {/* COL 4: Actions & Expand Chevron */}
                <div className="flex items-center justify-end gap-1.5 lg:pl-3">
                  {["queued", "processing"].includes(job.status) && (
                    <button
                      disabled={busyJobId === job._id}
                      title="Stop generation"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingAction({ type: "stop", jobId: job._id, sku: job.skuName || job.skuId });
                      }}
                      className="rounded-lg p-2 text-secondary hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    >
                      {busyJobId === job._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                    </button>
                  )}

                  {job.status === "failed" && (
                    <button
                      disabled={busyJobId === job._id}
                      title="Regenerate failed poses"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingAction({ type: "regenerate", jobId: job._id, sku: job.skuName || job.skuId });
                      }}
                      className="rounded-lg p-2 text-secondary hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                    >
                      {busyJobId === job._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                    </button>
                  )}

                  {!["queued", "processing", "cancelling"].includes(job.status) && (
                    <button
                      disabled={busyJobId === job._id}
                      title="Delete generation"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingAction({ type: "delete", jobId: job._id, sku: job.skuName || job.skuId });
                      }}
                      className="rounded-lg p-2 text-secondary hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    >
                      {busyJobId === job._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/history/flow/${job._id}`);
                    }}
                    title="View Generation Flow"
                    className="rounded-lg p-2 text-secondary hover:bg-primary/10 hover:text-primary"
                  >
                    <Brain className="h-4 w-4" />
                  </button>

                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-xl transition-all ${
                      open ? "bg-primary text-white shadow-xs" : "text-secondary group-hover:bg-surface-container"
                    }`}
                  >
                    {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>
              </div>

              {/* EXPANDED JOB DETAILS */}
              {open && (
                <div className="border-t border-outline-variant/30 bg-surface-container-lowest/40 p-6">
                  <JobDetails jobId={job._id} />
                </div>
              )}
            </article>
          );
        })}

        {jobs !== undefined && jobs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-container text-secondary">
              <RefreshCcw className="h-6 w-6" />
            </div>
            <p className="font-manrope text-base font-bold text-on-surface">No productions found</p>
            <p className="mt-1 text-xs text-secondary">Try adjusting your filters, source selector, or search term.</p>
          </div>
        )}
      </div>

      {/* PAGINATION TOOLBAR */}
      {jobsPage && jobsPage.total > 0 && (
        <div className="flex flex-col items-center justify-between gap-4 rounded-2xl border border-outline-variant/40 bg-white px-5 py-4 shadow-sm sm:flex-row">
          <p className="text-xs font-medium text-secondary">
            Showing{" "}
            <span className="font-bold text-on-surface">
              {(jobsPage.page - 1) * jobsPage.pageSize + 1}–{Math.min(jobsPage.page * jobsPage.pageSize, jobsPage.total)}
            </span>{" "}
            of <span className="font-bold text-on-surface">{jobsPage.total}</span> generations
          </p>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => {
                setPage((value) => Math.max(1, value - 1));
                setExpanded(null);
              }}
              className="rounded-xl border border-outline-variant/70 px-3 py-1.5 text-xs font-semibold text-on-surface shadow-xs transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>

            {Array.from({ length: jobsPage.totalPages }, (_, index) => index + 1)
              .filter((value) => value === 1 || value === jobsPage.totalPages || Math.abs(value - page) <= 1)
              .map((value, index, visiblePages) => (
                <div key={value} className="flex items-center gap-1.5">
                  {index > 0 && value - visiblePages[index - 1] > 1 && <span className="px-1 text-xs text-secondary">…</span>}
                  <button
                    type="button"
                    onClick={() => {
                      setPage(value);
                      setExpanded(null);
                    }}
                    className={`h-8 min-w-8 rounded-xl px-2.5 text-xs font-bold transition-all ${
                      value === page
                        ? "bg-primary text-white shadow-xs"
                        : "border border-outline-variant/70 text-on-surface hover:border-primary hover:text-primary"
                    }`}
                  >
                    {value}
                  </button>
                </div>
              ))}

            <button
              type="button"
              disabled={page >= jobsPage.totalPages}
              onClick={() => {
                setPage((value) => Math.min(jobsPage.totalPages, value + 1));
                setExpanded(null);
              }}
              className="rounded-xl border border-outline-variant/70 px-3 py-1.5 text-xs font-semibold text-on-surface shadow-xs transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ACTION CONFIRMATION DIALOG */}
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
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border border-danger/30 bg-white px-5 py-4 text-xs text-danger shadow-2xl animate-in slide-in-from-bottom-5">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="font-semibold">{error}</span>
          <button
            onClick={() => setError("")}
            className="ml-3 text-[10px] font-bold uppercase tracking-widest text-secondary hover:text-on-surface"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
