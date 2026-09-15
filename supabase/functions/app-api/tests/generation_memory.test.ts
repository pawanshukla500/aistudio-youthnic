import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildGenerationMemory,
  classifyReferenceRole,
  extractLearnedPromptPatterns,
  foldPromptPatternDuplicates,
  formatGenerationMemoryBrief,
  nextPromptPatternCounts,
  planPromptPatternWrite,
  resetGenerationMemoryForClone,
} from "../lib/generationMemory.ts";

Deno.test("reference roles distinguish product truth from style and identity", () => {
  assertEquals(classifyReferenceRole("front"), "product");
  assertEquals(classifyReferenceRole("saree_pallu_spread"), "product");
  assertEquals(classifyReferenceRole("style_reference"), "style");
  assertEquals(classifyReferenceRole("model_identity"), "model");
  assertEquals(classifyReferenceRole("approved_pose"), "approved");
});

Deno.test("generation memory labels product vs style and keeps approved outputs and corrections", () => {
  const memory = buildGenerationMemory({
    references: [
      { role: "front" },
      { role: "back" },
      { role: "style_reference" },
      { role: "model_identity" },
    ],
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "ivory",
      invariantDetails: "gold yoke embroidery",
      absenceConstraints: ["no rear lace"],
    },
    creativeDirection: { seatedPoseRequired: "yes", closeupMode: "product_detail", closeupHeroDetail: "yoke embroidery" },
    generatedAssets: [{ poseIndex: 1, url: "https://assets.example/pose1.jpg", qaStatus: "automatically_verified" }],
    approvedAssets: [{ poseIndex: 1, url: "https://assets.example/pose1.jpg", qaStatus: "automatically_verified" }],
    corrections: [{ poseIndex: 2, text: "Do not copy the product-photo courtyard." }],
    referenceFingerprint: "refs-1",
  });

  assertEquals(memory.productRoles, ["front", "back"]);
  assertEquals(memory.styleRoles, ["style_reference"]);
  assertEquals(memory.modelRoles, ["model_identity"]);
  assertEquals(memory.approvedAssets[0]?.poseIndex, 1);
  assertEquals(memory.corrections[0]?.text.includes("courtyard"), true);

  const brief = formatGenerationMemoryBrief({
    references: [{ role: "front" }, { role: "style_reference" }, { role: "approved_pose" }],
    memory,
  });
  assertStringIncludes(brief, "Product images (SKU/garment truth only): front");
  assertStringIncludes(brief, "Style reference");
  assertStringIncludes(brief, "style_reference");
  assertStringIncludes(brief, "Previous approved output");
  assertStringIncludes(brief, "Do not copy the product-photo courtyard.");
  assertEquals(brief.includes("gold yoke embroidery"), true);
});

Deno.test("clone memory keeps labeled references but drops prior generated outputs", () => {
  const cloned = resetGenerationMemoryForClone(buildGenerationMemory({
    references: [{ role: "front" }, { role: "style_reference" }],
    generatedAssets: [{ poseIndex: 1, url: "https://assets.example/old.jpg" }],
    corrections: [{ poseIndex: 1, text: "old correction" }],
  }));
  assertEquals(cloned.productRoles, ["front"]);
  assertEquals(cloned.styleRoles, ["style_reference"]);
  assertEquals(cloned.generatedAssets, []);
  assertEquals(cloned.corrections, []);
});

Deno.test("learned prompt patterns stay generic and fail closed without a category", () => {
  assertEquals(extractLearnedPromptPatterns({
    hasStyleReference: true,
    poses: [{ poseIndex: 1, poseType: "full_front", status: "completed" }],
  }), []);

  const learned = extractLearnedPromptPatterns({
    category: "ethnic/fusion",
    hasStyleReference: true,
    seatedPoseRequired: "yes",
    closeupMode: "product_detail",
    poses: [
      { poseIndex: 1, poseType: "full_front", status: "completed" },
      { poseIndex: 4, poseType: "creative", status: "completed" },
      { poseIndex: 5, poseType: "closeup", status: "failed" },
    ],
  });
  const titles = learned.map((pattern) => pattern.title);
  assertEquals(titles.includes("style-reference-backdrop-lock"), true);
  assertEquals(titles.includes("seated-pose-4-lock"), true);
  assertEquals(titles.includes("pose1-continuity-lock"), true);
  assertEquals(learned.find((pattern) => pattern.title === "closeup-product-detail-lock")?.outcome, "failure");
  assertEquals(learned.every((pattern) => !/ivory|gold yoke|SKU/i.test(pattern.patternText)), true);

  const skippedSeat = extractLearnedPromptPatterns({
    category: "ethnic/fusion",
    seatedPoseRequired: "no",
    poses: [{ poseIndex: 4, poseType: "creative", status: "completed" }],
  });
  assertEquals(skippedSeat.some((pattern) => pattern.title === "seated-pose-4-lock"), false);
});

Deno.test("prompt pattern counts increment without treating failure as a first insert", () => {
  const firstSuccess = nextPromptPatternCounts(null, "success", 80);
  assertEquals(firstSuccess.successCount, 1);
  assertEquals(firstSuccess.failureCount, 0);
  assertEquals(firstSuccess.avgQuality, 80);

  const nextFailure = nextPromptPatternCounts({
    success_count: 2,
    failure_count: 0,
    avg_quality: 80,
  }, "failure");
  assertEquals(nextFailure.successCount, 2);
  assertEquals(nextFailure.failureCount, 1);
  assertEquals(nextFailure.avgQuality, 80);
});

Deno.test("approved-asset snapshots replace omitted poses and empty lists clear them", () => {
  const existing = buildGenerationMemory({
    approvedAssets: [
      { poseIndex: 1, url: "https://assets.example/old-1.jpg" },
      { poseIndex: 2, url: "https://assets.example/old-2.jpg" },
    ],
  });
  const replaced = buildGenerationMemory({
    existing,
    approvedAssets: [{ poseIndex: 1, url: "https://assets.example/new-1.jpg" }],
  });
  assertEquals(replaced.approvedAssets.map((asset) => `${asset.poseIndex}:${asset.url}`), [
    "1:https://assets.example/new-1.jpg",
  ]);

  const cleared = buildGenerationMemory({ existing, approvedAssets: [] });
  assertEquals(cleared.approvedAssets, []);

  const kept = buildGenerationMemory({ existing, corrections: [{ poseIndex: 3, text: "fix backdrop" }] });
  assertEquals(kept.approvedAssets.map((asset) => asset.poseIndex), [1, 2]);

  const upserted = buildGenerationMemory({
    existing,
    upsertApprovedAssets: [{ poseIndex: 3, url: "https://assets.example/new-3.jpg" }],
  });
  assertEquals(upserted.approvedAssets.map((asset) => asset.poseIndex), [1, 2, 3]);

  const revoked = buildGenerationMemory({
    existing,
    revokeApprovedPoseIndexes: [2],
  });
  assertEquals(revoked.approvedAssets.map((asset) => asset.poseIndex), [1]);
});

Deno.test("prompt pattern writes retry against the oldest row and fold duplicates", () => {
  const update = planPromptPatternWrite([
    { id: "newer", success_count: 9, created_at: "2026-09-15T12:00:00.000Z" },
    { id: "oldest", success_count: 3, failure_count: 1, created_at: "2026-09-15T10:00:00.000Z" },
  ], "success", 70);
  assertEquals(update.action, "update");
  if (update.action === "update") {
    assertEquals(update.id, "oldest");
    assertEquals(update.expectedSuccessCount, 3);
    assertEquals(update.expectedFailureCount, 1);
    assertEquals(update.next.successCount, 4);
  }

  assertEquals(planPromptPatternWrite([], "failure").action, "skip");
  assertEquals(planPromptPatternWrite([], "success").action, "insert");

  const folded = foldPromptPatternDuplicates([
    { id: "b", created_at: "2026-09-15T11:00:00.000Z" },
    { id: "a", created_at: "2026-09-15T10:00:00.000Z" },
  ]);
  assertEquals(folded.keepId, "a");
  assertEquals(folded.deleteIds, ["b"]);
});
