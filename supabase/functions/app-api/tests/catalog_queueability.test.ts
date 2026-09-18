import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { canQueueGeneration, type CatalogWorkItem } from "../../../../src/features/planning/catalog-production/types.ts";
import { assertCatalogRequestEvidenceReady, humanProductLearningGuidance, poseIndexesFromRows } from "../catalogProduction.ts";

function workItem(overrides: Partial<CatalogWorkItem> = {}): CatalogWorkItem {
  return {
    id: "item-1",
    request_code: "SKU-1",
    request_date: "2026-08-25T00:00:00.000Z",
    created_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:00.000Z",
    sku_name: "Olive saree",
    priority: "normal",
    work_type: "catalog_colourway_5_pose",
    status: "in_progress",
    generation_status: "ready",
    qc_status: "not_started",
    listing_status: "not_required",
    planning_request_id: "request-1",
    workflow_stage: "ready_for_generation",
    ...overrides,
  };
}

Deno.test("Catalog Auto-Start excludes SKUs awaiting reference assets", () => {
  assertEquals(canQueueGeneration(workItem({ workflow_stage: "reference_assets_pending" })), false);
  assertEquals(canQueueGeneration(workItem({ workflow_stage: "planning" })), false);
});

Deno.test("Catalog Auto-Start retains validated generation-ready SKUs", () => {
  assertEquals(canQueueGeneration(workItem()), true);
});

Deno.test("Catalog bulk API rejects a linked request that has not passed evidence validation", () => {
  assertThrows(
    () => assertCatalogRequestEvidenceReady({ validation_status: "pending" }, "Olive saree"),
    Error,
    "awaiting validated product evidence",
  );
  assertCatalogRequestEvidenceReady({ validation_status: "ready" }, "Olive saree");
});

Deno.test("product learning guards are bounded without truncating the permanent human audit", () => {
  const guidance = humanProductLearningGuidance("x".repeat(4_000));
  assertEquals(Array.from(guidance).length, 1_200);
  assertEquals(guidance.startsWith("Human QC for this exact product reference set:"), true);
});

Deno.test("a work item's own rows decide how many poses final approval requires", () => {
  // A six-pose shoot is not approvable while its showcase frame is missing.
  assertEquals(
    poseIndexesFromRows(
      [{ pose_index: 1 }, { pose_index: 2 }, { pose_index: 3 }, { pose_index: 4 }, { pose_index: 5 }, { pose_index: 6 }],
      [{ pose_index: 1 }, { pose_index: 2 }],
    ),
    [1, 2, 3, 4, 5, 6],
  );
  // A shoot queued before the sixth frame existed stays approvable at five.
  assertEquals(
    poseIndexesFromRows([{ pose_index: 1 }, { pose_index: 2 }, { pose_index: 3 }, { pose_index: 4 }, { pose_index: 5 }], []),
    [1, 2, 3, 4, 5],
  );
  // Asset versions count even when the plan rows were pruned.
  assertEquals(poseIndexesFromRows([], [{ pose_index: 6 }, { pose_index: 1 }]), [1, 6]);
  // With nothing recorded, the current plan length is the only sane fallback.
  assertEquals(poseIndexesFromRows(null, undefined), [1, 2, 3, 4, 5, 6]);
  // Junk never widens or narrows the gate.
  assertEquals(poseIndexesFromRows([{ pose_index: 0 }, { pose_index: "x" }, { pose_index: 2 }], []), [2]);
});
