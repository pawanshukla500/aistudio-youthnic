import { assertEquals } from "jsr:@std/assert@1";
import {
  isDuplicateJobInsert,
  queueReuseResponse,
  scopePoseRowsToJob,
} from "../../../../src/lib/generationRuns.ts";

function row(jobId: string, poseIndex: number, viaGenerationData = true) {
  return {
    pose_index: poseIndex,
    generation_id: `${jobId}:pose:${poseIndex}`,
    generation_data: viaGenerationData ? { jobId, poseNumber: poseIndex } : {},
  };
}

Deno.test("a session queued twice shows six frames per run, not twelve", () => {
  // The reported shoot: two runs against one session, every pose rendered twice.
  const first = [1, 2, 3, 4, 5, 6].map((index) => row("job_first", index));
  const second = [1, 2, 3, 4, 5, 6].map((index) => row("job_second", index));
  const all = [...first, ...second];
  assertEquals(all.length, 12);

  const firstRun = scopePoseRowsToJob(all, "job_first");
  assertEquals(firstRun.length, 6);
  assertEquals(firstRun.map((entry) => entry.pose_index), [1, 2, 3, 4, 5, 6]);
  assertEquals(firstRun.every((entry) => entry.generation_data.jobId === "job_first"), true);

  const secondRun = scopePoseRowsToJob(all, "job_second");
  assertEquals(secondRun.length, 6);
  assertEquals(secondRun.every((entry) => entry.generation_data.jobId === "job_second"), true);
});

Deno.test("a row is claimed by its generation_id when generation_data has no job", () => {
  // The studio path encodes the job id in both, so one missing marker is enough.
  const rows = [row("job_a", 1, false), row("job_b", 1, false)];
  assertEquals(scopePoseRowsToJob(rows, "job_a").length, 1);
  assertEquals(scopePoseRowsToJob(rows, "job_a")[0].generation_id, "job_a:pose:1");
});

Deno.test("rows written before job ids were recorded still render", () => {
  // The one case the fallback exists for: nothing in the session names a job.
  const legacy = [
    { pose_index: 1, generation_id: "legacy-1", generation_data: {} },
    { pose_index: 2, generation_id: "legacy-2", generation_data: {} },
  ];
  assertEquals(scopePoseRowsToJob(legacy, "job_new").length, 2);
});

Deno.test("a job whose rows have not landed shows none, not the previous run's", () => {
  // There is a window between the job insert and the pose insert. Falling back
  // there would hand the new card the earlier run's frames.
  const existing = [1, 2, 3].map((index) => row("job_first", index));
  assertEquals(scopePoseRowsToJob(existing, "job_second"), []);
});

Deno.test("an empty session is empty for any job", () => {
  assertEquals(scopePoseRowsToJob([], "job_any"), []);
});

Deno.test("a repeat submit answers identically however it was caught", () => {
  // The in-flight check and the lost race must not report differently.
  const job = { job_id: "job_running", provider: "openai", model: "gpt-image-2" };
  const response = queueReuseResponse(job);
  assertEquals(response, {
    success: true,
    jobId: "job_running",
    provider: "openai",
    model: "gpt-image-2",
    alreadyQueued: true,
  });
  // A row missing provider or model still yields a usable response rather than
  // "undefined" reaching the Studio.
  assertEquals(queueReuseResponse({ job_id: "job_bare" }).provider, "");
  assertEquals(queueReuseResponse({ job_id: "job_bare" }).model, "");
  assertEquals(queueReuseResponse({ job_id: "job_bare" }).alreadyQueued, true);
});

Deno.test("only a unique violation is answered with the winning run", () => {
  assertEquals(isDuplicateJobInsert({ code: "23505" }), true);
  // Everything else is a real failure and has to surface.
  assertEquals(isDuplicateJobInsert({ code: "23503" }), false);
  assertEquals(isDuplicateJobInsert({ code: "42P01" }), false);
  assertEquals(isDuplicateJobInsert({}), false);
  assertEquals(isDuplicateJobInsert(null), false);
  assertEquals(isDuplicateJobInsert(undefined), false);
});
