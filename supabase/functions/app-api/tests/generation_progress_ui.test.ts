import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { generationDeliveryProgress } from "../../../../src/lib/generationProgress.ts";

const dashboardSource = Deno.readTextFileSync(
  new URL("../../../../src/lib/useSupabaseDashboard.ts", import.meta.url),
).replace(/\r\n/g, "\n");

Deno.test("both dashboard job queries fetch the authoritative pose counters", () => {
  const selection = '.select("job_id,status,sku_name,job_data,created_at,total_poses,completed_poses,failed_poses,actual_cost_usd,total_tokens,batch_id")';
  assertEquals(dashboardSource.split(selection).length - 1, 2);
});

Deno.test("dashboard pose counters prefer database values and retain legacy compatibility", () => {
  assertStringIncludes(dashboardSource, "numberFrom(row.total_poses, numberFrom(data.totalPoses, 6))");
  assertStringIncludes(dashboardSource, "numberFrom(row.completed_poses, numberFrom(data.completedPoses))");
  assertStringIncludes(dashboardSource, "numberFrom(row.failed_poses, numberFrom(data.failedPoses))");
  assertEquals(dashboardSource.includes("numberFrom(data.totalPoses, 5)"), false);
});

Deno.test("learning rows preserve positive pose counts and default only missing or zero counts to six", () => {
  assertStringIncludes(dashboardSource, "const poseCount = numberFrom(row.pose_count)");
  assertStringIncludes(dashboardSource, "totalPoses: poseCount > 0 ? poseCount : 6");
  assertEquals(dashboardSource.includes("totalPoses: Math.max(6, poseCount)"), false);
});

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
