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
