import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { isCompleteCatalogHandoffPackage } from "../lib/catalogHandoffPackage.ts";

function poses(count: number) {
  return Array.from({ length: count }, (_, index) => ({ poseIndex: index + 1 }));
}

Deno.test("catalog handoff accepts complete legacy five-pose and current six-pose packages", () => {
  assertEquals(isCompleteCatalogHandoffPackage(poses(5)), true);
  assertEquals(isCompleteCatalogHandoffPackage(poses(6)), true);
});

Deno.test("catalog handoff rejects incomplete, duplicate, malformed, and unexpected packages", () => {
  assertEquals(isCompleteCatalogHandoffPackage(poses(4)), false);
  assertEquals(isCompleteCatalogHandoffPackage(poses(7)), false);
  assertEquals(isCompleteCatalogHandoffPackage([...poses(4), { poseIndex: 4 }]), false);
  assertEquals(isCompleteCatalogHandoffPackage([...poses(5), { poseIndex: "invalid" }]), false);
  assertEquals(isCompleteCatalogHandoffPackage([{ poseIndex: 2 }, { poseIndex: 3 }, { poseIndex: 4 }, { poseIndex: 5 }, { poseIndex: 6 }]), false);
  assertEquals(isCompleteCatalogHandoffPackage(null), false);
});

Deno.test("catalog memory cannot replace SKU-specific Pose 6 product direction", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));
  assertStringIncludes(source, "showcasePlan: skuShowcasePlan ?? null");
  assertStringIncludes(source, 'if (skuPose.id === "showcase") return skuPose;');
  assertEquals(source.includes("showcasePlan: skuShowcasePlan ?? memCreative.showcasePlan"), false);
  assertStringIncludes(source, "isCompleteCatalogHandoffPackage(row.poses)");
  assertEquals(source.includes("incomplete_five_pose_package"), false);
});
