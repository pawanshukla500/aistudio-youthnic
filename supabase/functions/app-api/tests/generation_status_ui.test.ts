import { assertEquals } from "jsr:@std/assert@1";
import { visibleGenerationDetailedStatus } from "../../../../src/lib/generationStatus.ts";

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
