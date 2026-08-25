import { assertEquals } from "jsr:@std/assert@1";
import { generationDeliveryProgress } from "../../../../src/lib/generationProgress.ts";

Deno.test("all failed poses never appear as stored images", () => {
  assertEquals(generationDeliveryProgress({ totalPoses: 5, completedPoses: 0, failedPoses: 5 }), {
    totalPoses: 5,
    imagesStored: 0,
    failedPoses: 5,
    resolvedPoses: 5,
    deliveredPercent: 0,
    resolvedPercent: 100,
  });
});

Deno.test("partial delivery distinguishes stored images from failed work", () => {
  assertEquals(generationDeliveryProgress({ totalPoses: 5, completedPoses: 2, failedPoses: 3 }), {
    totalPoses: 5,
    imagesStored: 2,
    failedPoses: 3,
    resolvedPoses: 5,
    deliveredPercent: 40,
    resolvedPercent: 100,
  });
});

Deno.test("completed pose delivery remains 100 percent", () => {
  assertEquals(generationDeliveryProgress({ totalPoses: 5, completedPoses: 5, failedPoses: 0 }).deliveredPercent, 100);
});
