import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const viewerSource = Deno.readTextFileSync(
  new URL("../../../../src/features/planning/catalog-production/AssetViewerModal.tsx", import.meta.url),
).replace(/\r\n/g, "\n");

Deno.test("asset viewer labels the actual pose count without a five-pose fallback", () => {
  assertStringIncludes(viewerSource, "{completed.length} of {poses.length} poses complete");
  assertStringIncludes(viewerSource, 'Pose outputs{poses.length ? ` (${poses.length})` : ""}');
  assertEquals(viewerSource.includes("poses.length || 5"), false);
  assertEquals(viewerSource.includes("Pose 1–5 outputs"), false);
});

Deno.test("asset viewer still renders and downloads every scoped pose", () => {
  assertStringIncludes(viewerSource, "{poses.map((pose) => (");
  assertStringIncludes(viewerSource, "fetchAssets(completed)");
  assertStringIncludes(viewerSource, "selected.map((pose) => pose.pose_index)");
});
