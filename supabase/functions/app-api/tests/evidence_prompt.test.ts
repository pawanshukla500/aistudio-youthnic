import {
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import { composeGenerationPrompt } from "../lib/generationPrompt.ts";
import { normalizeAnalysis } from "../lib/profiles.ts";

Deno.test("Garment Truth Contract: Legacy placement and absence locks are preserved when garmentEvidence is populated", () => {
  const sessionData = {
    productIdentity: {
      category: "ethnic/fusion",
      garmentEvidence: [
        {
          region: "front hem",
          state: "confirmed",
          visibleDecoration: "gold lace trim",
        },
      ],
      detailPlacementMap: ["Placement Lock 1", "Placement Lock 2"],
      absenceConstraints: ["Absence Lock 1", "Absence Lock 2"],
    },
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

Deno.test("Garment Truth Contract: Generic placement and absence safeguards are preserved when legacy arrays are empty but garmentEvidence is populated", () => {
  const sessionData = {
    productIdentity: {
      category: "ethnic/fusion",
      garmentEvidence: [
        {
          region: "front hem",
          state: "confirmed",
          visibleDecoration: "gold lace trim",
        },
      ],
      detailPlacementMap: [],
      absenceConstraints: [],
    },
  };

  const poseData = {
    id: "pose_2",
    title: "Test Pose 2",
    poseNumber: 2,
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

  // Verify that the generic safeguards are printed because the legacy arrays are empty!
  assertStringIncludes(
    prompt,
    "- Preserve every visible detail only in the exact region shown by the authoritative image.",
  );
  assertStringIncludes(
    prompt,
    "- Add no button, closure, tassel/latkan, trim, embroidery, pocket, logo, jewelry or hardware unless the authoritative product image proves it exists at that location.",
  );
});

Deno.test("Saree generation prompt contains canonical normalized truth and never serializes undefined or null", () => {
  const normalized = normalizeAnalysis({
    productIdentity: { garmentFamily: "saree" },
    sareeTruth: {
      body: {
        mainFabric: "silk",
        baseColor: "olive",
        motifInventory: ["peacock", "floral"],
      },
      borders: { upperBorder: "gold woven", lowerBorder: "gold woven" },
      pallu: {
        hasDistinctPallu: true,
        startingRegion: "after the body",
        artwork: "peacock floral field",
      },
      physics: {
        weight: "medium",
        fluidity: "controlled",
        expectedFall: "structured",
      },
    },
    sareeDrapePlan: {
      baseDrapeFamily: "nivi",
      shoulderSide: "left",
      palluSpread: "open",
    },
  }, "saree");
  const prompt = composeGenerationPrompt({
    skuName: "OLIVE-SAREE-01",
    productDetails: "Preserve the exact SKU.",
    pose: {
      id: "full_front",
      title: "Full front hero",
      poseNumber: 1,
      description: "hero",
      cameraAngle: "front",
      framing: "full body",
      bodyPosition: "front",
      handPlacement: "clear of product",
      expression: "natural",
      highlightedDetails: [],
      productVisibilityRules: [],
      primaryReference: "front",
      purpose: "listing",
      consistencyNotes: "locked",
      prompt: "front hero",
      enabled: true,
    },
    session: { ...normalized, consistencyRules: [] },
    references: [],
  });

  assertStringIncludes(prompt, "SAREE TRUTH - CRITICAL:");
  assertStringIncludes(prompt, '"baseColor":"olive"');
  assertStringIncludes(prompt, '"motifInventory":["peacock","floral"]');
  assertStringIncludes(prompt, "SAREE DRAPE PLAN:");
  assertEquals(prompt.includes("SAREE TRUTH - CRITICAL:\nundefined"), false);
  assertEquals(prompt.includes("SAREE TRUTH - CRITICAL:\nnull"), false);
});
