import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { composeGenerationPrompt } from "../index.ts";

Deno.test("Garment Truth Contract: Legacy placement and absence locks are preserved when garmentEvidence is populated", () => {
  const sessionData = {
    productIdentity: {
      category: "ethnic/fusion",
      garmentEvidence: [
        {
          region: "front hem",
          state: "confirmed",
          visibleDecoration: "gold lace trim",
        }
      ],
      detailPlacementMap: ["Placement Lock 1", "Placement Lock 2"],
      absenceConstraints: ["Absence Lock 1", "Absence Lock 2"],
    }
  };

  const poseData = {
    id: "pose_1",
    title: "Test Pose",
    poseNumber: 1,
    description: "test",
    highlightedDetails: [],
    productVisibilityRules: [],
    purpose: "test",
    consistencyNotes: "test",
    prompt: "Test generation prompt",
  };

  const prompt = composeGenerationPrompt({
    skuName: "Test SKU",
    productDetails: "Test details",
    pose: poseData as any,
    session: sessionData,
    references: [],
  });

  // Verify that the explicitly populated garment evidence is present
  assertStringIncludes(prompt, "Region FRONT HEM: [State: confirmed]");
  
  // Verify that the legacy placement and absence locks are still preserved in the prompt!
  assertStringIncludes(prompt, "Detail placement hard locks:");
  assertStringIncludes(prompt, "- Placement Lock 1");
  assertStringIncludes(prompt, "- Placement Lock 2");
  
  assertStringIncludes(prompt, "Negative-evidence hard locks:");
  assertStringIncludes(prompt, "- Absence Lock 1");
  assertStringIncludes(prompt, "- Absence Lock 2");
});
