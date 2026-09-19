import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { ACTIVE_GENERATION_JOB_STATUSES } from "../lib/profiles.ts";

const apiSource = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));
const backendSource = Deno.readTextFileSync(
  new URL("../../../../src/lib/backend.ts", import.meta.url),
);
const studioSource = Deno.readTextFileSync(
  new URL("../../../../src/features/studio/Studio.tsx", import.meta.url),
);
const migration = Deno.readTextFileSync(
  new URL("../../../migrations/20260919090000_one_active_job_per_session.sql", import.meta.url),
);

function queueGenerationSource() {
  const start = apiSource.indexOf("async function queueGeneration(");
  assert(start > 0, "queueGeneration not found");
  const rest = apiSource.slice(start);
  const end = rest.indexOf("\nasync function nextJob(");
  assert(end > 0, "end of queueGeneration not found");
  return rest.slice(0, end);
}

Deno.test("queueing a session already in flight returns that job instead of a second one", () => {
  const fn = queueGenerationSource();
  // Without this, a second call inserted another six pose rows against the same
  // session_id and generated - and billed - every pose twice.
  assertStringIncludes(fn, 'from("generation_jobs")');
  assertStringIncludes(fn, '.eq("session_id", sessionId)');
  assertStringIncludes(fn, ".in(\"status\", ACTIVE_GENERATION_JOB_STATUSES)");
  assertStringIncludes(fn, "alreadyQueued: true");
  // The short circuit has to come before the insert, or it changes nothing.
  assert(
    fn.indexOf("alreadyQueued: true") < fn.indexOf('from("session_generations").insert'),
    "the in-flight check must run before the pose rows are written",
  );
});

Deno.test("a pose set that fails to insert fails the queue call", () => {
  const fn = queueGenerationSource();
  // It used to be logged and swallowed, leaving a job with nothing to generate
  // and no way for anyone to find out.
  assertStringIncludes(fn, "Could not queue the pose set for this session");
  assertEquals(/if \(poseError\) console\.error/.test(fn), false);
});

Deno.test("the active-status set is shared by the guard and the index", () => {
  assertEquals([...ACTIVE_GENERATION_JOB_STATUSES], ["queued", "processing"]);
  for (const status of ACTIVE_GENERATION_JOB_STATUSES) {
    assertStringIncludes(migration, `'${status}'`);
  }
});

Deno.test("the index is partial, so a finished session can be run again", () => {
  assertStringIncludes(migration, "create unique index");
  assertStringIncludes(migration, "generation_jobs_one_active_per_session_idx");
  assertStringIncludes(migration, "on public.generation_jobs (session_id)");
  // Without the predicate every completed job would collide with the next run.
  assertStringIncludes(migration, "where status in ('queued', 'processing')");
});

Deno.test("the migration clears existing conflicts without deleting anything", () => {
  // A unique index cannot be built over rows that already violate it, and the
  // duplicates carry real paid history, so they are retired and never removed.
  assertStringIncludes(migration, "update public.generation_jobs");
  assertStringIncludes(migration, "duplicate_session_job");
  assertEquals(/delete\s+from/i.test(migration), false);
  // Keep the newest in-flight job per session; the older ones are the strays.
  assertStringIncludes(migration, "order by created_at desc");
  assertStringIncludes(migration, "position > 1");
  assert(
    migration.indexOf("update public.generation_jobs") < migration.indexOf("create unique index"),
    "conflicts must be resolved before the index is created",
  );
});

Deno.test("History shows the run being viewed, not every run on the session", () => {
  // session_generations is keyed on the session, so a session queued twice held
  // both runs' rows and the card rendered twelve frames for a six-pose shoot.
  assertStringIncludes(backendSource, "const rowsForThisJob = allPoseRows.filter");
  assertStringIncludes(backendSource, "generation_data).jobId");
  assertStringIncludes(backendSource, "`${jobId}:pose:`");
  // Rows predating generation_data.jobId must still render.
  assertStringIncludes(backendSource, "rowsForThisJob.length > 0 ? rowsForThisJob : allPoseRows");
});

Deno.test("a second submit says the shoot was already running", () => {
  // Reporting "submitted successfully" for a run that was already going reads
  // as a new job the operator then waits for and never sees.
  assertStringIncludes(studioSource, "result.alreadyQueued");
  assertStringIncludes(studioSource, "already generating");
});
