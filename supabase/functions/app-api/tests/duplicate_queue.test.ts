import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { ACTIVE_GENERATION_JOB_STATUSES } from "../lib/profiles.ts";
import { colorwayCheckReferences, MAX_COLORWAY_CHECK_REFERENCES } from "../lib/referencePolicy.ts";

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
  // session_id and generated - and billed - every pose twice. The sequence that
  // follows the check is executed in generation_runs.test.ts; this pins that the
  // check runs, and runs first.
  assertStringIncludes(fn, ".in(\"status\", ACTIVE_GENERATION_JOB_STATUSES)");
  assertStringIncludes(fn, "queueReuseResponse(activeJob)");
  assert(
    fn.indexOf("queueReuseResponse(activeJob)") < fn.indexOf("claimGenerationRun("),
    "the in-flight check must run before anything is written",
  );
});

Deno.test("the queue path writes through the sequence that is under test", () => {
  const fn = queueGenerationSource();
  // Inlining either insert again would put the money path back outside the
  // reach of a test.
  assertStringIncludes(fn, "claimGenerationRun({");
  assertStringIncludes(fn, "insertJob: () => service.from(\"generation_jobs\").insert(jobRow)");
  assertStringIncludes(fn, "insertPoses: () => service.from(\"session_generations\").insert(poseRows)");
  assertEquals(/if \(poseError\) console\.error/.test(fn), false);
});

Deno.test("the active-status set is shared by the guard and the index", () => {
  // "cancelling" is in flight: the worker still claims such a job until it
  // reaches finalizeCancelledJob, so a replacement would spend alongside it.
  assertEquals([...ACTIVE_GENERATION_JOB_STATUSES], ["queued", "processing", "cancelling"]);
  for (const status of ACTIVE_GENERATION_JOB_STATUSES) {
    assertStringIncludes(migration, `'${status}'`);
  }
});

Deno.test("the index is partial, so a finished session can be run again", () => {
  assertStringIncludes(migration, "create unique index");
  assertStringIncludes(migration, "generation_jobs_one_active_per_session_idx");
  assertStringIncludes(migration, "on public.generation_jobs (session_id)");
  // Without the predicate every completed job would collide with the next run.
  assertStringIncludes(migration, "where status in ('queued', 'processing', 'cancelling')");
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
  assertStringIncludes(backendSource, "scopePoseRowsToJob");
});

Deno.test("a second submit says the shoot was already running", () => {
  // Reporting "submitted successfully" for a run that was already going reads
  // as a new job the operator then waits for and never sees.
  assertStringIncludes(studioSource, "result.alreadyQueued");
  assertStringIncludes(studioSource, "already generating");
});

Deno.test("a lost queue race returns the winning job, not a constraint error", () => {
  // Two submits can both clear the in-flight check and race to the insert. The
  // index refuses the loser, which is right; surfacing a raw 23505 is not.
  const fn = queueGenerationSource();
  // Resolved inside claimGenerationRun, which generation_runs.test.ts drives
  // through the won, lost and unrelated-failure cases.
  assertStringIncludes(fn, "if (raceWinner) {");
  assertStringIncludes(fn, "return raceWinner;");
});

Deno.test("the migration retires a superseded job's waiting poses too", () => {
  // The worker claims the next queued pose by session alone, so leaving them
  // would let the surviving job generate and bill the retired job's frames.
  assertStringIncludes(migration, "update public.session_generations");
  assertStringIncludes(migration, "superseded_generation_jobs");
  // Only rows still waiting: a completed pose keeps its paid output.
  assertStringIncludes(migration, "poses.status in ('queued', 'processing')");
  assert(
    migration.indexOf("update public.session_generations") < migration.indexOf("create unique index"),
    "pose rows must be retired before the index is created",
  );
});

Deno.test("a job with no rows of its own shows none, not another run's", () => {
  // The fallback exists for rows written before generation_data.jobId. A new
  // job whose rows have not landed yet must not borrow the previous run's.
  // The rule itself is executed against real rows in generation_runs.test.ts;
  // this only pins that the query layer uses it.
  assertStringIncludes(backendSource, "scopePoseRowsToJob(posesResult.data || [], jobId)");
});

Deno.test("the colorway check looks at every product reference, not just the front", () => {
  // A variant differing only in its back, bottom wear or dupatta passed the
  // structure check unseen while the shortcut reused the base garment's truth.
  const references = [
    { role: "front" },
    { role: "back" },
    { role: "bottom" },
    { role: "fabric_pattern" },
    { role: "style" },
    { role: "model" },
  ];
  const picked = colorwayCheckReferences(references).map((entry) => entry.role);
  assertEquals(picked, ["front", "back", "bottom", "fabric_pattern"]);
  // Style and model references cannot carry a garment difference, so they stay
  // out and this remains cheaper than a full analysis.
  assertEquals(picked.includes("style"), false);
  assertEquals(picked.includes("model"), false);
});

Deno.test("the colorway check stays bounded and never sends nothing", () => {
  const many = Array.from({ length: 12 }, () => ({ role: "additional_product" }));
  assertEquals(colorwayCheckReferences(many).length, MAX_COLORWAY_CHECK_REFERENCES);
  // With no recognised product role, fall back to what there is rather than
  // skipping the check entirely.
  assertEquals(colorwayCheckReferences([{ role: "style" }]).length, 1);
  assertEquals(colorwayCheckReferences([]).length, 0);
});

Deno.test("both colorway sites send every loaded reference to the model", () => {
  // A manifest naming one image while several were loaded would tell the model
  // to ignore the rest.
  const sites = apiSource.match(/const manifest = loadedRefs\.map\(/g);
  assertEquals(sites?.length, 2);
  assertEquals((apiSource.match(/loadedRefs\.flatMap\(/g) || []).length, 2);
  assertEquals(apiSource.includes("loadedRefs[0].base64"), false);
});
