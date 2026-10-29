import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildColorwayAnalysisPrompt,
  colorwayDeltaIsSafe,
  mergeVariantColorways,
  normalizeAnalysis,
} from "../lib/profiles.ts";
import { composeGenerationPrompt } from "../lib/generationPrompt.ts";

Deno.test("buildColorwayAnalysisPrompt generates lightweight targeted prompt", () => {
  const prompt = buildColorwayAnalysisPrompt({
    skuName: "SKU-RED-01",
    garmentFamily: "Dress",
    referenceManifest: [{ number: 1, role: "front" }, { number: 2, role: "back" }],
  });
  assertStringIncludes(prompt, 'garment style "Dress"');
  assertStringIncludes(prompt, "SKU: SKU-RED-01");
  assertStringIncludes(prompt, "IMAGE 1: front");
  assertStringIncludes(prompt, "mainColor");
  assertStringIncludes(prompt, "secondaryColors");
  assertStringIncludes(prompt, "accentColors");
  assertStringIncludes(prompt, "bottomWearColor");
});

Deno.test("mergeVariantColorways preserves base silhouette and updates colors", () => {
  const baseAnalysis = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "saree",
      silhouette: "traditional drape with embroidered border",
      mainColor: "royal blue",
      secondaryColors: ["gold"],
    },
    sareeTruth: {
      body: { baseColor: "royal blue" },
      borders: { borderColors: "gold" },
    },
  }, "saree");

  const colorResult = {
    mainColor: "ruby red",
    secondaryColors: ["silver"],
    accentColors: ["silver", "white"],
  };

  const merged = mergeVariantColorways(baseAnalysis, colorResult, "SKU-RED-01");

  // Preserved structural truth
  assertEquals(merged.productIdentity.garmentFamily, "saree");
  assertEquals(merged.productIdentity.silhouette, "traditional drape with embroidered border");

  // Updated colorways
  assertEquals(merged.productIdentity.mainColor, "ruby red");
  assertEquals(merged.productIdentity.secondaryColors, ["silver"]);
  assertEquals(merged.productIdentity.patternGeometry.accentColors, ["silver", "white"]);
  assertEquals(merged.productIdentity.sareeTruth?.body.baseColor, "ruby red");
  assertEquals(merged.productIdentity.sareeTruth?.borders.borderColors, "silver");
});

Deno.test("mergeVariantColorways preserves bottom wear cut and records variant bottom color", () => {
  const baseAnalysis = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "ivory white",
      bottomWearDetails: "Farshi Pajama with wide flared straight legs, front inverted box pleats, 3-inch gold hem band; NOT dhoti pants, NOT tapered",
    },
  }, "kurta_or_kurti_set");

  const colorResult = {
    mainColor: "emerald green",
    secondaryColors: ["gold"],
    bottomWearColor: "emerald green",
  };

  const merged = mergeVariantColorways(baseAnalysis, colorResult, "SKU-GRN-01");

  assertEquals(merged.productIdentity.mainColor, "emerald green");
  assertStringIncludes(merged.productIdentity.bottomWearDetails, "Farshi Pajama with wide flared straight legs");
  assertStringIncludes(merged.productIdentity.bottomWearDetails, "NOT dhoti pants");
  assertStringIncludes(merged.productIdentity.bottomWearDetails, "Variant Colorway: emerald green");
});

Deno.test("the colorway shortcut is refused unless the variant is only a recolour", () => {
  // It reuses the collection's garment truth and repaints it, so a variant that
  // differs in print or cut would be generated as the base garment in the
  // variant's colours - its own references never read for anything but colour.
  assertEquals(
    colorwayDeltaIsSafe({ structureMatchesBase: true, structureDifferences: [], mainColor: "Wine" }).safe,
    true,
  );
  const changed = colorwayDeltaIsSafe({
    structureMatchesBase: false,
    structureDifferences: ["different border width", "V neckline instead of round"],
    mainColor: "Wine",
  });
  assertEquals(changed.safe, false);
  assertEquals(changed.differences.length, 2);
});

Deno.test("an unanswered structure question fails closed", () => {
  // An older model that ignores the new field must get the full analysis, not a
  // silent reuse of another SKU's garment truth.
  assertEquals(colorwayDeltaIsSafe({ mainColor: "Wine" }).safe, false);
  assertEquals(colorwayDeltaIsSafe({}).safe, false);
  assertEquals(colorwayDeltaIsSafe({ structureMatchesBase: "yes" }).safe, false);
  // Claiming a match while listing differences is a contradiction; trust the
  // differences, because that is the answer that keeps the product truthful.
  assertEquals(
    colorwayDeltaIsSafe({ structureMatchesBase: true, structureDifferences: ["added dupatta"] }).safe,
    false,
  );
  // A string "true" is accepted: some providers quote booleans.
  assertEquals(colorwayDeltaIsSafe({ structureMatchesBase: "true" }).safe, true);
});

Deno.test("the colorway prompt asks the model to check the structure first", () => {
  const prompt = buildColorwayAnalysisPrompt({
    skuName: "BT240-Totapuri-Wine",
    garmentFamily: "kurta set",
    referenceManifest: [{ number: 1, role: "front" }],
  });
  assertStringIncludes(prompt, "structureMatchesBase");
  assertStringIncludes(prompt, "structureDifferences");
  // A recolour is the case the shortcut exists for and must still be allowed.
  assertStringIncludes(prompt, "Report colour differences as a match");
});

Deno.test("mergeVariantColorways updates base color references in showcasePlan and posePlan prompts", () => {
  const baseAnalysis = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "royal blue",
      fabric: "silk",
      bottomWearDetails: "Palazzo, wide straight legs",
    },
    showcasePlan: {
      heroFeature: "royal blue silk flared palazzo border",
      featureRegion: "bottom_wear",
      shotType: "full_body_feature",
      whyItSells: "royal blue palazzo flare",
    },
  }, "kurta_or_kurti_set");

  const merged = mergeVariantColorways(baseAnalysis, {
    mainColor: "emerald green",
    secondaryColors: ["gold"],
    bottomWearColor: "emerald green",
  }, "SKU-GRN-02");

  assertStringIncludes(merged.creativeDirection.showcasePlan?.heroFeature || "", "emerald green");
  assertStringIncludes(merged.posePlan[5].prompt, "emerald green");
  assertEquals(merged.posePlan[5].prompt.toLowerCase().includes("royal blue"), false);
});

Deno.test("mergeVariantColorways replaces red as a token without corrupting embroidered or gathered", () => {
  const baseAnalysis = normalizeAnalysis({
    productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "red" },
    showcasePlan: {
      heroFeature: "red embroidered yoke with gathered red cuffs",
      featureRegion: "embroidery",
      shotType: "macro_detail",
    },
  }, "kurta set");

  const merged = mergeVariantColorways(baseAnalysis, { mainColor: "emerald" });

  assertEquals(
    merged.creativeDirection.showcasePlan?.heroFeature,
    "emerald embroidered yoke with gathered emerald cuffs",
  );
  assertStringIncludes(merged.posePlan[5].prompt, "embroidered");
  assertStringIncludes(merged.posePlan[5].prompt, "gathered");
});

Deno.test("mergeVariantColorways refreshes multiword color in every showcase and pose direction field", () => {
  const baseAnalysis = normalizeAnalysis({
    productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "royal blue", fabric: "silk" },
    showcasePlan: {
      heroFeature: "royal blue silk yoke",
      featureRegion: "neckline",
      shotType: "macro_detail",
      whyItSells: "royal blue craft",
      evidenceReference: "fabric_pattern",
      framing: "royal blue framing",
      cameraAngle: "royal blue angle",
      bodyPosition: "royal blue posture",
      handPlacement: "royal blue hand direction",
      expression: "royal blue expression",
      distinctFrom: "royal blue distinction",
      visibilityRules: ["royal blue visibility"],
    },
    posePlan: [{
      id: "showcase",
      title: "royal blue title",
      description: "royal blue silk yoke description",
      cameraAngle: "royal blue pose angle",
      framing: "royal blue pose framing",
      bodyPosition: "royal blue pose posture",
      handPlacement: "royal blue pose hands",
      expression: "royal blue pose expression",
      highlightedDetails: ["royal blue highlight"],
      productVisibilityRules: ["royal blue rule"],
      primaryReference: "fabric_pattern",
      purpose: "royal blue purpose",
      consistencyNotes: "royal blue continuity",
      prompt: "royal blue silk yoke prompt",
    }],
  }, "kurta set");

  const merged = mergeVariantColorways(baseAnalysis, { mainColor: "emerald green" });
  const plan = merged.creativeDirection.showcasePlan;
  const showcase = merged.posePlan[5];

  assertEquals(JSON.stringify(plan).toLowerCase().includes("royal blue"), false);
  assertEquals(JSON.stringify(showcase).toLowerCase().includes("royal blue"), false);
  assertStringIncludes(plan?.framing || "", "emerald green");
  assertStringIncludes(showcase.cameraAngle, "emerald green");
  assertStringIncludes(showcase.consistencyNotes, "emerald green");
  assertEquals(plan?.featureRegion, "neckline");
  assertEquals(plan?.shotType, "macro_detail");
  assertEquals(plan?.evidenceReference, "fabric_pattern");
  assertEquals(showcase.id, "showcase");
  assertEquals(showcase.primaryReference, "fabric_pattern");
});

Deno.test("F-15 colorway merge removes stale product and pose color from the actual generation prompt", () => {
  const baseAnalysis = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "royal blue",
      fabric: "silk",
      pattern: "royal blue floral butti repeat",
      print: "royal blue and gold block print",
      frontConstruction: "royal blue silk with a gathered yoke",
      bottomWearDetails: "Royal blue Farshi Pajama with wide flared legs, three waist pleats and a 6-inch joined gold hem",
      invariantDetails: ["royal blue base with gold butti work"],
      detailPlacementMap: ["front yoke: royal blue and gold embroidery"],
      patternGeometry: {
        type: "floral",
        placementByPanel: ["royal blue butti field on the front"],
        accentColors: ["royal blue", "gold"],
      },
      embroideryGeometry: { colorsAndMaterial: "royal blue thread with gold zari" },
      garmentEvidence: [{
        region: "front yoke",
        sourceRole: "front",
        state: "confirmed",
        visibleConstruction: "royal blue silk with gathered seams",
        visibleDecoration: "royal blue thread and gold zari embroidery",
      }],
    },
    creativeDirection: {
      closeupMode: "product_detail",
      closeupHeroDetail: "royal blue and gold yoke embroidery",
      showcasePlan: {
        heroFeature: "royal blue and gold yoke embroidery",
        featureRegion: "embroidery",
        shotType: "macro_detail",
        visibilityRules: ["royal blue thread remains visible"],
      },
    },
  }, "kurta set");

  const merged = mergeVariantColorways(baseAnalysis, {
    mainColor: "emerald green",
    secondaryColors: ["gold"],
    accentColors: ["gold"],
    bottomWearColor: "emerald green",
  });

  assertEquals(merged.productIdentity.pattern, "emerald green floral butti repeat");
  assertEquals(merged.productIdentity.invariantDetails, ["emerald green base with gold butti work"]);
  assertEquals(merged.productIdentity.detailPlacementMap, ["front yoke: emerald green and gold embroidery"]);
  assertEquals(merged.productIdentity.garmentEvidence[0]?.visibleConstruction, "emerald green silk with gathered seams");
  assertEquals(merged.creativeDirection.closeupHeroDetail, "emerald green and gold yoke embroidery");
  assertEquals(
    merged.productIdentity.bottomWearDetails,
    "emerald green Farshi Pajama with wide flared legs, three waist pleats and a 6-inch joined gold hem",
  );
  assertEquals(merged.productIdentity.bottomWearDetails.includes("Variant Colorway"), false);

  const prompt = composeGenerationPrompt({
    skuName: "SKU-GREEN-01",
    productDetails: "",
    pose: { ...merged.posePlan[5], poseNumber: 6 },
    session: { ...merged, category: "kurta set" },
    references: [{ role: "front" }, { role: "bottom" }, { role: "fabric_pattern" }],
  });
  assertEquals(/royal blue/i.test(prompt), false);
  assertStringIncludes(prompt, "emerald green floral butti repeat");
  assertStringIncludes(prompt, "front yoke: emerald green and gold embroidery");
  assertStringIncludes(prompt, "emerald green Farshi Pajama with wide flared legs");
  assertStringIncludes(prompt, "6-inch joined gold hem");
  assertStringIncludes(prompt, "emerald green and gold yoke embroidery");
});

Deno.test("F-15 colorway recoloring protects identity, scene, canonical fields and reference roles", () => {
  const baseAnalysis = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      category: "royal blue canonical category",
      mainColor: "royal blue",
      pattern: "royal blue butti",
      patternGeometry: { type: "royal blue" },
      garmentEvidence: [{
        region: "front yoke",
        sourceRole: "front",
        state: "confirmed",
        visibleDecoration: "royal blue embroidery",
      }],
    },
    modelIdentity: { face: "Model with royal blue eyes" },
    creativeDirection: {
      backgroundStyle: "royal blue studio wall",
      closeupHeroDetail: "royal blue yoke",
      showcasePlan: {
        heroFeature: "royal blue yoke",
        featureRegion: "neckline",
        shotType: "macro_detail",
        evidenceReference: "fabric_pattern",
      },
    },
  }, "kurta set");

  const merged = mergeVariantColorways(baseAnalysis, { mainColor: "emerald green" });
  assertEquals(merged.modelIdentity.face, "Model with royal blue eyes");
  assertEquals(merged.creativeDirection.backgroundStyle, "royal blue studio wall");
  assertEquals(merged.productIdentity.category, "royal blue canonical category");
  assertEquals(merged.productIdentity.patternGeometry.type, "royal blue");
  assertEquals(merged.productIdentity.garmentEvidence[0]?.sourceRole, "front");
  assertEquals(merged.productIdentity.garmentEvidence[0]?.state, "confirmed");
  assertEquals(merged.productIdentity.garmentEvidence[0]?.visibleDecoration, "emerald green embroidery");
  assertEquals(merged.creativeDirection.showcasePlan?.featureRegion, "neckline");
  assertEquals(merged.creativeDirection.showcasePlan?.shotType, "macro_detail");
  assertEquals(merged.creativeDirection.showcasePlan?.evidenceReference, "fabric_pattern");
  assertEquals(merged.posePlan[5].id, "showcase");
  assertEquals(merged.posePlan[5].primaryReference, "fabric_pattern");
  assertEquals(merged.creativeDirection.closeupHeroDetail, "emerald green yoke");
});

Deno.test("F-21 contrasting bottom color replaces a leading base color in the actual prompt", () => {
  const baseAnalysis = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "royal blue",
      frontConstruction: "royal blue silk kurti",
      bottomWearDetails: "Ivory Farshi Pajama with wide flared legs, three waist pleats, large gold floral print and a 6-inch joined gold hem",
    },
  }, "kurta set");

  const merged = mergeVariantColorways(baseAnalysis, {
    mainColor: "emerald green",
    bottomWearColor: "ruby red",
  });

  assertEquals(merged.productIdentity.mainColor, "emerald green");
  assertEquals(/ivory/i.test(merged.productIdentity.bottomWearDetails), false);
  assertStringIncludes(merged.productIdentity.bottomWearDetails, "ruby red Farshi Pajama");
  assertEquals(merged.productIdentity.bottomWearDetails.includes("Variant Colorway"), false);

  const prompt = composeGenerationPrompt({
    skuName: "SKU-CONTRAST-01",
    productDetails: "",
    pose: { ...merged.posePlan[5], poseNumber: 6 },
    session: { ...merged, category: "kurta set" },
    references: [{ role: "front" }, { role: "bottom" }],
  });
  assertEquals(/ivory/i.test(prompt), false);
  assertStringIncludes(prompt, "emerald green silk kurti");
  assertStringIncludes(prompt, "ruby red Farshi Pajama");
  assertStringIncludes(prompt, "wide flared legs, three waist pleats");
  assertStringIncludes(prompt, "large gold floral print");
  assertStringIncludes(prompt, "6-inch joined gold hem");
});

Deno.test("F-21 contrasting bottom color replaces an in-fabric color phrase without broad recoloring", () => {
  const baseAnalysis = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      category: "royal blue canonical category",
      mainColor: "royal blue",
      frontConstruction: "royal blue silk kurti",
      bottomWearDetails: "Palazzo in ivory crepe with wide straight legs, botanical block print and a scalloped gold hem",
    },
    modelIdentity: { face: "Model with royal blue eyes" },
  }, "kurta set");

  const merged = mergeVariantColorways(baseAnalysis, {
    mainColor: "emerald green",
    bottomWearColor: "ruby red",
  });

  assertEquals(merged.productIdentity.bottomWearDetails, "Palazzo in ruby red crepe with wide straight legs, botanical block print and a scalloped gold hem");
  assertEquals(merged.productIdentity.category, "royal blue canonical category");
  assertEquals(merged.modelIdentity.face, "Model with royal blue eyes");

  const prompt = composeGenerationPrompt({
    skuName: "SKU-CONTRAST-02",
    productDetails: "",
    pose: { ...merged.posePlan[5], poseNumber: 6 },
    session: { ...merged, category: "kurta set" },
    references: [{ role: "front" }],
  });
  assertEquals(/ivory/i.test(prompt), false);
  assertStringIncludes(prompt, "emerald green silk kurti");
  assertStringIncludes(prompt, "Palazzo in ruby red crepe");
  assertStringIncludes(prompt, "wide straight legs, botanical block print");
  assertStringIncludes(prompt, "scalloped gold hem");
});

Deno.test("F-22 bottom recoloring preserves same-colored upper garment craftsmanship", () => {
  const baseAnalysis = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "royal blue",
      embroidery: "ivory thread on the upper yoke",
      bottomWearDetails: "Ivory Farshi Pajama with wide flared legs and a joined gold hem",
    },
    creativeDirection: {
      closeupMode: "product_detail",
      closeupHeroDetail: "ivory thread upper-yoke embroidery",
      showcasePlan: {
        heroFeature: "ivory thread upper-yoke embroidery",
        featureRegion: "embroidery",
        shotType: "macro_detail",
        visibilityRules: ["ivory upper-yoke thread stays sharp beside the ivory Farshi silhouette"],
      },
    },
  }, "kurta set");

  const merged = mergeVariantColorways(baseAnalysis, {
    mainColor: "emerald green",
    bottomWearColor: "ruby red",
  });
  assertStringIncludes(merged.productIdentity.embroidery, "ivory thread on the upper yoke");
  assertStringIncludes(merged.creativeDirection.closeupHeroDetail, "ivory thread upper-yoke embroidery");
  assertStringIncludes(merged.creativeDirection.showcasePlan?.heroFeature || "", "ivory thread upper-yoke embroidery");
  assertStringIncludes(merged.creativeDirection.showcasePlan?.visibilityRules[0] || "", "ruby red Farshi silhouette");
  assertStringIncludes(merged.productIdentity.bottomWearDetails, "ruby red Farshi Pajama");

  const prompt = composeGenerationPrompt({
    skuName: "SKU-CONTRAST-03",
    productDetails: "",
    pose: { ...merged.posePlan[5], poseNumber: 6 },
    session: { ...merged, category: "kurta set" },
    references: [{ role: "front" }, { role: "bottom" }, { role: "fabric_pattern" }],
  });
  assertStringIncludes(prompt, "ivory thread upper-yoke embroidery");
  assertStringIncludes(prompt, "ruby red Farshi Pajama");
  assertEquals(/ruby red thread upper-yoke/i.test(prompt), false);
});

Deno.test("CodeAnt Major: shared base color still permits a contrasting bottom in showcase directions", () => {
  const baseAnalysis = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "royal blue",
      bottomWearDetails: "Royal blue Farshi Pajama with wide flared legs",
    },
    creativeDirection: {
      showcasePlan: {
        heroFeature: "royal blue silk kurti with royal blue Farshi Pajama",
        featureRegion: "complete_set",
        shotType: "full_body_feature",
      },
    },
  }, "kurta set");

  const merged = mergeVariantColorways(baseAnalysis, {
    mainColor: "emerald green",
    bottomWearColor: "ruby red",
  });
  assertStringIncludes(merged.productIdentity.bottomWearDetails, "ruby red Farshi Pajama");
  assertEquals(
    merged.creativeDirection.showcasePlan?.heroFeature,
    "emerald green silk kurti with ruby red Farshi Pajama",
  );
  assertEquals(merged.creativeDirection.showcasePlan?.heroFeature.includes("emerald green Farshi"), false);
});

Deno.test("CodeAnt Major: shared in-fabric base color permits a contrasting bottom without touching the upper", () => {
  const baseAnalysis = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "royal blue",
      bottomWearDetails: "Palazzo in royal blue crepe with wide straight legs",
    },
    creativeDirection: {
      showcasePlan: {
        heroFeature: "royal blue kurti with palazzo in royal blue crepe",
        featureRegion: "complete_set",
        shotType: "full_body_feature",
      },
    },
  }, "kurta set");

  const merged = mergeVariantColorways(baseAnalysis, {
    mainColor: "emerald green",
    bottomWearColor: "ruby red",
  });
  assertEquals(
    merged.creativeDirection.showcasePlan?.heroFeature,
    "emerald green kurti with palazzo in ruby red crepe",
  );
  assertStringIncludes(merged.productIdentity.bottomWearDetails, "Palazzo in ruby red crepe");
});

Deno.test("CodeAnt nitpick: a border-only new color cannot suppress the dominant bottom variant suffix", () => {
  const baseAnalysis = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "royal blue",
      bottomWearDetails: "Farshi Pajama with ivory fabric and a ruby red border",
    },
  }, "kurta set");

  const merged = mergeVariantColorways(baseAnalysis, {
    mainColor: "emerald green",
    bottomWearColor: "ruby red",
  });
  assertEquals(
    merged.productIdentity.bottomWearDetails,
    "Farshi Pajama with ivory fabric and a ruby red border (Variant Colorway: ruby red)",
  );

  const remerged = mergeVariantColorways(merged, {
    mainColor: "emerald green",
    bottomWearColor: "ruby red",
  });
  assertEquals(remerged.productIdentity.bottomWearDetails.match(/Variant Colorway:/g)?.length, 1);
});
