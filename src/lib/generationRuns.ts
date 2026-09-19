/**
 * Which generation run a pose row belongs to, and what a repeat submit returns.
 *
 * These decisions used to live inline in the query layer and the Edge Function,
 * where the only way to check them was to read the source. They are pure, so
 * they belong somewhere a test can execute them against real rows.
 */

export type PoseRowLike = {
  generation_id?: unknown;
  generation_data?: unknown;
};

function jobIdOf(row: PoseRowLike): string {
  const data = row.generation_data;
  const record = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  return String(record.jobId || "");
}

/** The studio path also encodes the job id in `generation_id`. */
function generationIdNamesJob(row: PoseRowLike, jobId: string): boolean {
  return String(row.generation_id || "").startsWith(`${jobId}:pose:`);
}

function rowNamesAnyJob(row: PoseRowLike): boolean {
  return Boolean(jobIdOf(row)) || String(row.generation_id || "").includes(":pose:");
}

/**
 * The pose rows belonging to one run.
 *
 * session_generations is keyed on the session, not the job, so a session that
 * was queued twice holds both runs' rows and History rendered all of them -
 * twelve frames for a six-pose shoot.
 *
 * The fallback to the whole set is strictly for rows written before a job id
 * was recorded. It must not fire merely because this job matched nothing, which
 * is also true of a job whose rows have not been written yet: that job would
 * then borrow the previous run's frames.
 */
export function scopePoseRowsToJob<T extends PoseRowLike>(rows: T[], jobId: string): T[] {
  const mine = rows.filter((row) => jobIdOf(row) === jobId || generationIdNamesJob(row, jobId));
  if (mine.length > 0) return mine;
  return rows.some(rowNamesAnyJob) ? [] : rows;
}

export type ActiveJobLike = {
  job_id?: unknown;
  provider?: unknown;
  model?: unknown;
};

export type QueueReuseResponse = {
  success: true;
  jobId: string;
  provider: string;
  model: string;
  alreadyQueued: true;
};

/**
 * What a submit returns when the session is already generating.
 *
 * Both the in-flight check and the lost-race branch answer with this, so a
 * repeat submit looks the same however it was caught.
 */
export function queueReuseResponse(job: ActiveJobLike): QueueReuseResponse {
  return {
    success: true,
    jobId: String(job.job_id || ""),
    provider: String(job.provider || ""),
    model: String(job.model || ""),
    alreadyQueued: true,
  };
}

/**
 * Whether an insert failed because another request won the race.
 *
 * Only the unique violation may be answered with the winning run; any other
 * failure is a real error and must surface.
 */
export function isDuplicateJobInsert(error: { code?: unknown } | null | undefined): boolean {
  return String(error?.code || "") === "23505";
}

/**
 * The three writes the claim sequence performs, supplied by the caller.
 *
 * Passing operations rather than a client keeps the decisions here - which are
 * what decide whether a submit spends money twice - executable in a test,
 * without this module having to describe Supabase's query builder.
 */
export type RunClaimOps = {
  insertJob(): PromiseLike<{ error: { code?: unknown; message?: string } | null }>;
  insertPoses(): PromiseLike<{ error: { message?: string } | null }>;
  findActiveRun(): PromiseLike<ActiveJobLike | null>;
};

/**
 * Write the job and its pose rows, or hand back the run that beat us to it.
 *
 * Returns the reuse response when another request won the race, and null when
 * this call created the run. A pose set that fails to insert throws: a job with
 * nothing to generate is worse than no job, and it used to be logged and
 * swallowed.
 */
export async function claimGenerationRun(ops: RunClaimOps): Promise<QueueReuseResponse | null> {
  const { error: jobError } = await ops.insertJob();
  if (jobError) {
    if (isDuplicateJobInsert(jobError)) {
      const winner = await ops.findActiveRun();
      if (winner) return queueReuseResponse(winner);
    }
    throw new Error(String(jobError.message || "Could not create the generation job."));
  }
  const { error: poseError } = await ops.insertPoses();
  if (poseError) {
    throw new Error(`Could not queue the pose set for this session: ${poseError.message}`);
  }
  return null;
}
