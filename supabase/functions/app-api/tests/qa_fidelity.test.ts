import { assertEquals } from "jsr:@std/assert@1";
import { normalizeAnalysis } from "../lib/profiles.ts";
import { normalizePoseQaResult } from "../lib/qa.ts";

Deno.test("Garment Evidence Architecture: Unknown region side-lace invention should fail QA", () => {
  // 1. Simulate an analysis where the hem is confirmed to have gold lace, but side is unknown.
  const rawAnalysis = {
    productIdentity: {
      category: "ethnic/fusion",
      garmentEvidence: [
        {
          region: "front hem",
          state: "confirmed",
          visibleDecoration: "gold lace trim",
        },
        {
          region: "left side construction",
          state: "unknown",
          uncertainty: "Left side cannot be seen in references. Unproven.",
        }
      ]
    }
  };

  const normalized = normalizeAnalysis(rawAnalysis, "ethnic/fusion");
  const leftSideEvidence = normalized.productIdentity.garmentEvidence.find((e: any) => e.region === "left side construction");
  
  // Verify that the architecture preserves the "unknown" state constraint
  assertEquals(leftSideEvidence?.state, "unknown");

  // 2. Simulate QA response where the generator invented a side slit and continued the gold lace trim.
  const rawQaResponse = {
    pass: false,
    score: 80,
    checks: {
      garment_identity: "pass",
      colors: "pass",
      detail_placement: "pass",
      side_construction: "fail",
      trim_location: "fail",
      unknown_region_invention: "fail"
    },
    scores: {
      side_construction: 50,
      trim_location: 60,
      unknown_region_invention: 40
    },
    failed: ["side_construction", "trim_location", "unknown_region_invention"],
    reason: "Invented side slit with gold lace",
    correction: "Remove vertical gold lace trim from the side. Keep side plain base fabric."
  };

  const qaResult = normalizePoseQaResult(rawQaResponse);
  
  // 3. Assert the critical checks pull the score down and successfully fail the pose
  assertEquals(qaResult.pass, false);
  assertEquals(qaResult.failed.includes("unknown_region_invention"), true);
  assertEquals(qaResult.failed.includes("trim_location"), true);
  assertEquals(qaResult.failed.includes("side_construction"), true);
});
