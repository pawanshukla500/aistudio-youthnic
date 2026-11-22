import { assertEquals } from "jsr:@std/assert@1";
import { livePoseNumber, regenerationQueuedStatus, visibleGenerationDetailedStatus } from "../../../../src/lib/generationStatus.ts";

Deno.test("terminal jobs never display their retained worker progress text", () => {
  for (const status of ["completed", "failed", "cancelled"]) {
    assertEquals(visibleGenerationDetailedStatus(status, "Pose 5 generating (Attempt 1)"), "");
  }
});

Deno.test("active jobs can display their current worker progress text", () => {
  assertEquals(visibleGenerationDetailedStatus("processing", "Pose 2 generating (Attempt 1)"), "Pose 2 generating (Attempt 1)");
  assertEquals(visibleGenerationDetailedStatus("queued", "Waiting for worker"), "Waiting for worker");
});

Deno.test("missing or malformed progress text is safe to render", () => {
  assertEquals(visibleGenerationDetailedStatus("processing", null), "");
  assertEquals(visibleGenerationDetailedStatus("completed", { text: "stale" }), "");
});

Deno.test("a queued re-generation names its own poses, never the last run's stage", () => {
  // Live T94 run: History read "Pose 2 generating (Attempt 1)" while Pose 1 was the one queued.
  assertEquals(regenerationQueuedStatus([1]), "Pose 1 queued for re-generation");
  assertEquals(regenerationQueuedStatus([4, 2, 2, "6"]), "Poses 2, 4, 6 queued for re-generation");
  assertEquals(regenerationQueuedStatus([0, NaN, null, -3]), "Queued for re-generation");
  assertEquals(visibleGenerationDetailedStatus("queued", regenerationQueuedStatus([1])), "Pose 1 queued for re-generation");
});

Deno.test("the row's pose number follows the worker and never runs past the pose count", () => {
  assertEquals(livePoseNumber(3, 2, 6), 3);
  // A first run the worker has not started: the next undelivered pose.
  assertEquals(livePoseNumber(0, 0, 6), 1);
  assertEquals(livePoseNumber(null, 4, 6), 5);
  // A re-generation on a finished shoot read "Pose 7"; with no pose known it shows none.
  assertEquals(livePoseNumber(0, 6, 6), 0);
  assertEquals(livePoseNumber(undefined, 7, 6), 0);
  assertEquals(livePoseNumber(1, 6, 6), 1);
});
