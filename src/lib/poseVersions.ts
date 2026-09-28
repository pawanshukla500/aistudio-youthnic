/**
 * Every delivered image of a pose, oldest first, with how long it took.
 *
 * A regeneration never overwrites or deletes the earlier output: the worker
 * uploads each delivery under a unique storage path and appends a
 * `planning_assets` row. That archive is the version history. These helpers
 * stamp timing onto it at delivery and turn it back into a per-pose timeline
 * for History, so the team can see how often a frame was regenerated, how long
 * each version took, and download any earlier version.
 *
 * Shared by the Edge Function worker and the browser, so it stays pure.
 */

type JsonMap = Record<string, unknown>;

function record(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function isoOrEmpty(value: unknown): string {
  const text = String(value || "");
  return text && Number.isFinite(Date.parse(text)) ? text : "";
}

function elapsedMs(fromIso: string, toIso: string): number {
  if (!fromIso || !toIso) return 0;
  const elapsed = Date.parse(toIso) - Date.parse(fromIso);
  return Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
}

function positiveNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** When the current generation epoch of a pose was asked for and first picked up. */
export type PoseTimingStamp = {
  epoch: number;
  requestedAt: string;
  startedAt: string;
};

/**
 * The stamp for this epoch, created on the first attempt and kept across QA or
 * provider retries so the recorded duration covers every retry, not only the
 * last one. A first attempt always starts a fresh stamp: "retry failed poses"
 * resets the attempt count without a new epoch, and must not inherit the start
 * of the run that failed hours earlier.
 *
 * A regeneration bumps the epoch and records `regenerationQueuedAt`; that is
 * when the version was requested. A first-time pose was requested with its job.
 */
export function stampPoseTiming(
  generationData: unknown,
  args: { epoch: number; attempt: number; jobCreatedAt?: unknown; now: string },
): PoseTimingStamp {
  const data = record(generationData);
  const epoch = Math.max(1, Math.round(Number(args.epoch || 1)));
  const existing = record(data.timing);
  if (Number(args.attempt) > 1 && Number(existing.epoch) === epoch && isoOrEmpty(existing.startedAt)) {
    return {
      epoch,
      requestedAt: isoOrEmpty(existing.requestedAt) || isoOrEmpty(existing.startedAt),
      startedAt: isoOrEmpty(existing.startedAt),
    };
  }
  const regenerationQueuedAt = epoch > 1 ? isoOrEmpty(data.regenerationQueuedAt) : "";
  return {
    epoch,
    requestedAt: regenerationQueuedAt || isoOrEmpty(args.jobCreatedAt) || args.now,
    startedAt: args.now,
  };
}

/** Timing recorded on the archived asset of one delivered version. */
export type VersionTiming = {
  epoch: number;
  attempts: number;
  requestedAt: string;
  startedAt: string;
  completedAt: string;
  /** Waiting in the queue before the worker picked this version up. */
  queueMs: number;
  /** First attempt started to delivery, including QA and provider retries. */
  activeMs: number;
  /** Requested to delivered: what the person waited for. */
  totalMs: number;
  /** The image provider call that produced the delivered image. */
  generationMs: number;
};

export function deliveredVersionTiming(
  stamp: PoseTimingStamp,
  args: { completedAt: string; attempt: number; generationMs: number },
): VersionTiming {
  const requestedAt = isoOrEmpty(stamp.requestedAt);
  const startedAt = isoOrEmpty(stamp.startedAt) || requestedAt;
  const completedAt = isoOrEmpty(args.completedAt);
  return {
    epoch: stamp.epoch,
    attempts: Math.max(1, Math.round(Number(args.attempt || 1))),
    requestedAt,
    startedAt,
    completedAt,
    queueMs: elapsedMs(requestedAt, startedAt),
    activeMs: elapsedMs(startedAt, completedAt),
    totalMs: elapsedMs(requestedAt, completedAt),
    generationMs: Math.round(positiveNumber(args.generationMs)),
  };
}

export type ArchivedAssetLike = {
  id?: unknown;
  image_url?: unknown;
  storage_path?: unknown;
  storage_backend?: unknown;
  created_at?: unknown;
  metadata?: unknown;
};

export type RegenerationRequestLike = {
  requestedAt?: unknown;
  instructions?: unknown;
};

export type PoseVersion = {
  id: string;
  /** 1 is the original delivery; every later number is a regeneration. */
  version: number;
  isCurrent: boolean;
  isRegeneration: boolean;
  url: string;
  storagePath: string;
  storageBackend: string;
  createdAt: string;
  qaStatus: string;
  /** Whether QA was switched on for this image; null when it was not recorded. */
  qaEnabled: boolean | null;
  quality: string;
  actualCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  attempts: number;
  instructions: string;
  requestedAt: string;
  totalMs: number;
  activeMs: number;
  generationMs: number;
  /** Timing was stamped at delivery rather than reconstructed from timestamps. */
  timingRecorded: boolean;
};

/**
 * The regeneration request a version answered: the latest request made after
 * the previous version was delivered and before this one was. Assets archived
 * before timing was stamped get their wait time from this.
 */
function answeredRequest(
  requests: { requestedAt: string; instructions: string }[],
  previousCreatedAt: string,
  createdAt: string,
) {
  const created = Date.parse(createdAt);
  const previous = previousCreatedAt ? Date.parse(previousCreatedAt) : -Infinity;
  if (!Number.isFinite(created)) return null;
  let match: { requestedAt: string; instructions: string } | null = null;
  for (const request of requests) {
    const at = Date.parse(request.requestedAt);
    if (at > previous && at <= created) match = request;
  }
  return match;
}

/**
 * All delivered versions of one pose, oldest first.
 *
 * `assets` are that pose's archived `planning_assets` rows for one job. The
 * current version is the one the pose row points at; when the pose points at
 * none of them (a legacy row, or a regeneration in flight) the newest is.
 */
export function buildPoseVersions(
  assets: ArchivedAssetLike[],
  regenerationHistory: unknown,
  currentStoragePath = "",
): PoseVersion[] {
  const requests = (Array.isArray(regenerationHistory) ? regenerationHistory : [])
    .map((entry) => record(entry))
    .map((entry) => ({ requestedAt: isoOrEmpty(entry.requestedAt), instructions: String(entry.instructions || "") }))
    .filter((entry) => entry.requestedAt)
    .sort((left, right) => Date.parse(left.requestedAt) - Date.parse(right.requestedAt));
  const ordered = [...assets]
    .filter((asset) => String(asset.image_url || asset.storage_path || ""))
    .sort((left, right) => (Date.parse(String(left.created_at || "")) || 0) - (Date.parse(String(right.created_at || "")) || 0));
  const current = String(currentStoragePath || "");
  const currentIndex = current ? ordered.findIndex((asset) => String(asset.storage_path || "") === current) : -1;
  const effectiveCurrent = currentIndex >= 0 ? currentIndex : ordered.length - 1;
  return ordered.map((asset, index) => {
    const metadata = record(asset.metadata);
    const usage = record(metadata.usage);
    const timing = record(metadata.timing);
    const createdAt = isoOrEmpty(asset.created_at);
    const previousCreatedAt = index > 0 ? isoOrEmpty(ordered[index - 1].created_at) : "";
    const recorded = Boolean(isoOrEmpty(timing.completedAt));
    const request = index > 0 ? answeredRequest(requests, previousCreatedAt, createdAt) : null;
    const requestedAt = recorded ? isoOrEmpty(timing.requestedAt) : request?.requestedAt || "";
    return {
      id: String(asset.id || asset.storage_path || `${index + 1}`),
      version: index + 1,
      isCurrent: index === effectiveCurrent,
      isRegeneration: index > 0 || Number(timing.epoch || metadata.generationEpoch || 1) > 1,
      url: String(asset.image_url || ""),
      storagePath: String(asset.storage_path || ""),
      storageBackend: String(asset.storage_backend || ""),
      createdAt,
      qaStatus: String(metadata.qaStatus || ""),
      qaEnabled: typeof metadata.qaEnabled === "boolean" ? metadata.qaEnabled : null,
      quality: String(metadata.quality || ""),
      actualCostUsd: positiveNumber(metadata.actualCostUsd),
      inputTokens: Math.round(positiveNumber(usage.input_tokens)),
      outputTokens: Math.round(positiveNumber(usage.output_tokens)),
      attempts: Math.max(1, Math.round(positiveNumber(timing.attempts || metadata.attempt) || 1)),
      instructions: String(metadata.regenerationInstructions || request?.instructions || ""),
      requestedAt,
      totalMs: recorded ? Math.round(positiveNumber(timing.totalMs)) : elapsedMs(requestedAt, createdAt),
      activeMs: recorded ? Math.round(positiveNumber(timing.activeMs)) : 0,
      generationMs: recorded ? Math.round(positiveNumber(timing.generationMs)) : 0,
      timingRecorded: recorded,
    };
  });
}

export type RegenerationSummary = {
  /** Versions delivered after the first, across every pose. */
  regenerations: number;
  regeneratedPoses: number;
  /** Requested-to-delivered time of regenerations whose wait is known. */
  totalRegenerationMs: number;
  averageRegenerationMs: number;
  regenerationCostUsd: number;
};

export function summarizeRegenerations(versionsByPose: PoseVersion[][]): RegenerationSummary {
  let regenerations = 0;
  let regeneratedPoses = 0;
  let timed = 0;
  let totalRegenerationMs = 0;
  let regenerationCostUsd = 0;
  for (const versions of versionsByPose) {
    const later = versions.filter((version) => version.version > 1);
    if (!later.length) continue;
    regeneratedPoses += 1;
    regenerations += later.length;
    for (const version of later) {
      regenerationCostUsd += version.actualCostUsd;
      if (version.totalMs > 0) {
        timed += 1;
        totalRegenerationMs += version.totalMs;
      }
    }
  }
  return {
    regenerations,
    regeneratedPoses,
    totalRegenerationMs,
    averageRegenerationMs: timed ? Math.round(totalRegenerationMs / timed) : 0,
    regenerationCostUsd: Math.round(regenerationCostUsd * 1_000_000) / 1_000_000,
  };
}

/** "48s", "2m 05s", "1h 03m"; empty for an unknown duration. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
