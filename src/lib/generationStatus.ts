/**
 * `job_data.detailedStatus` is an in-flight progress snapshot. The worker
 * intentionally keeps it in the row for audit/debugging after completion, so
 * consumers must never use it to replace a terminal job status.
 */
const ACTIVE_GENERATION_STATUSES = new Set([
  "pending",
  "queued",
  "processing",
  "generating",
  "running",
]);

export function visibleGenerationDetailedStatus(status: unknown, detailedStatus: unknown): string {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (!ACTIVE_GENERATION_STATUSES.has(normalizedStatus)) return "";
  return typeof detailedStatus === "string" ? detailedStatus.trim() : "";
}

/**
 * The stage a job carries while a re-generation waits for the worker. It replaces the last run's
 * stage ("Pose 2 generating"), which History otherwise showed for the pose queued now.
 */
export function regenerationQueuedStatus(poseNumbers: readonly unknown[]): string {
  const numbers = [...new Set(poseNumbers.map(Number).filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
  if (!numbers.length) return "Queued for re-generation";
  return numbers.length === 1
    ? `Pose ${numbers[0]} queued for re-generation`
    : `Poses ${numbers.join(", ")} queued for re-generation`;
}

/**
 * The pose number a working job shows: the worker's current pose, else the next undelivered one.
 * 0 (show none) when every pose is already delivered, i.e. a re-generation the worker has not
 * reached yet: "delivered + 1" read "Pose 7" on a finished six-pose shoot.
 */
export function livePoseNumber(currentPose: unknown, resolvedPoses: unknown, totalPoses: unknown): number {
  const current = Math.floor(Number(currentPose) || 0);
  if (current > 0) return current;
  const resolved = Math.max(0, Math.floor(Number(resolvedPoses) || 0));
  const total = Math.max(0, Math.floor(Number(totalPoses) || 0));
  return total > 0 && resolved >= total ? 0 : resolved + 1;
}
