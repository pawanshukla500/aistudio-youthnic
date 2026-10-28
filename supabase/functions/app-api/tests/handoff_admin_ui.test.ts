import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const handoffSource = Deno.readTextFileSync(
  new URL("../../../../src/features/planning/catalog-production/HandoffAdmin.tsx", import.meta.url),
).replace(/\r\n/g, "\n");

Deno.test("handoff badges count API poses without inventing a fallback", () => {
  assertStringIncludes(
    handoffSource,
    "{Array.isArray(row.poses) ? row.poses.length : 0} poses",
  );
  assertEquals(handoffSource.includes("row.poseCount"), false);
});
