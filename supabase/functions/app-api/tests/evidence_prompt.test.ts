import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  GenerationPromptBudgetError,
  IMAGE_PROMPT_SAFE_CHARS,
  assertGenerationPromptWithinLimit,
  composeGenerationPrompt,
} from "../lib/generationPrompt.ts";
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

Deno.test("a true-back prompt uses only the direct rear image and never leaks a front-only lace claim", () => {
  const prompt = composeGenerationPrompt({
    skuName: "BACK-EVIDENCE-SKU",
    productDetails: "Preserve the exact garment.",
    pose: {
      id: "back",
      title: "True back",
      poseNumber: 3,
      description: "Show the true rear.",
      cameraAngle: "straight back",
      framing: "full body",
      bodyPosition: "facing away",
      handPlacement: "clear",
      expression: "not visible",
      highlightedDetails: [],
      productVisibilityRules: [],
      purpose: "document rear",
      consistencyNotes: "rear only",
      prompt: "Render the real rear construction.",
    } as any,
    session: {
      productIdentity: {
        garmentFamily: "dress",
        frontConstruction: "front-lace-construction-marker",
        embroidery: "front-lace-embroidery-marker",
        detailPlacementMap: ["Front hem: front-only-lace-marker", "Back hem: rear-only-hem-marker"],
        garmentEvidence: [
          { region: "front hem", sourceRole: "front", state: "confirmed", visibleDecoration: "front-only-lace-marker" },
          { region: "back hem", sourceRole: "back", state: "confirmed_absent", visibleDecoration: "rear-plain-marker", explicitlyAbsent: ["rear-lace-absent-marker"] },
        ],
      },
    },
    references: [{ role: "front" }, { role: "back" }, { role: "fabric_pattern" }, { role: "style_reference" }, { role: "approved_pose" }],
  });

  assertStringIncludes(prompt, "IMAGE 1: BACK PRODUCT");
  assertStringIncludes(prompt, "IMAGE 2: APPROVED POSE 1");
  assertStringIncludes(prompt, "rear-plain-marker");
  assertEquals(prompt.includes("front-only-lace-marker"), false);
  assertEquals(prompt.includes("front-lace-construction-marker"), false);
  assertEquals(prompt.includes("front-lace-embroidery-marker"), false);
  assertStringIncludes(prompt, "BACK-POSE EVIDENCE VETO");
  assertStringIncludes(prompt, "REAR PRODUCT GEOMETRY LOCK");
  assertStringIncludes(prompt, "DUPATTA / SHAWL / ACCESSORY UNOBSTRUCTED VIEW");
  assertStringIncludes(prompt, "DUPATTA REAR VISIBILITY LOCK");
  assertStringIncludes(prompt, "SET & BACKDROP HARD LOCK TO APPROVED POSE 1");
  assertStringIncludes(prompt, "ZERO NEW PROPS");
  assertStringIncludes(prompt, "glances back over her shoulder");
});

Deno.test("a saree true-back prompt cannot carry a hallucinated front-derived blouse or border into the rear", () => {
  const prompt = composeGenerationPrompt({
    skuName: "REAR-ONLY-SAREE",
    productDetails: "front note says lace-marker but it is not a rear authority",
    pose: {
      id: "back", title: "True back", poseNumber: 3, description: "rear", cameraAngle: "back", framing: "full body", bodyPosition: "away",
      handPlacement: "clear", expression: "not visible", highlightedDetails: [], productVisibilityRules: [], purpose: "rear", consistencyNotes: "rear", prompt: "show the rear", enabled: true,
    } as any,
    session: {
      productIdentity: {
        garmentFamily: "saree",
        frontConstruction: "front-construction-marker",
        sareeTruth: {
          borders: { lowerBorder: "hallucinated-border-marker" },
          blouse: { backConstruction: "hallucinated-lace-marker" },
        },
        sareeDrapePlan: { frontPleatTreatment: "front-pleat-marker" },
        garmentEvidence: [
          { region: "front blouse", sourceRole: "saree_front_drape", state: "confirmed", visibleDecoration: "front-lace-marker" },
          { region: "rear blouse", sourceRole: "saree_back_drape", state: "confirmed_absent", visibleDecoration: "rear-plain-marker", explicitlyAbsent: ["lace"] },
        ],
      },
    },
    references: [{ role: "saree_front_drape" }, { role: "saree_back_drape" }, { role: "saree_pallu_spread" }, { role: "saree_border_tassels" }, { role: "saree_blouse_back_piece" }],
  });

  assertStringIncludes(prompt, "SAREE REAR TRUTH - DIRECT EVIDENCE ONLY");
  assertStringIncludes(prompt, "IMAGE 1: SAREE REAR / BACK DRAPE");
  assertStringIncludes(prompt, "rear-plain-marker");
  for (const marker of ["hallucinated-border-marker", "hallucinated-lace-marker", "front-pleat-marker", "front-construction-marker", "front-lace-marker"]) {
    assertEquals(prompt.includes(marker), false, `${marker} must not enter a true-back prompt.`);
  }
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

function sareePose() {
  return {
    id: "full_front",
    title: "Full front hero",
    poseNumber: 1,
    description: "Show the complete product without hiding any product-critical detail.",
    cameraAngle: "eye-level front",
    framing: "full body",
    bodyPosition: "front-facing",
    handPlacement: "hands clear of the pallu and borders",
    expression: "natural",
    highlightedDetails: ["body weave", "pallu", "upper and lower borders"],
    productVisibilityRules: ["show the body field", "keep the pallu edge visible"],
    primaryReference: "saree_full_front",
    purpose: "listing hero",
    consistencyNotes: "Keep the exact same saree, model, scene and lighting across the set.",
    prompt: "Create the primary front listing image for this exact saree.",
    enabled: true,
  };
}

function fidelitySareeSession() {
  const fill = (label: string, size = 320) => `${label}: ${"detail ".repeat(size / 7)}`;
  return {
    productIdentity: {
      garmentFamily: "saree",
      category: "ethnic/fusion",
      mainColor: "olive-product-core-marker",
      fabric: "silk blend",
      patternGeometry: { type: "diamond lattice", placement: fill("geometry", 1000) },
      embroideryGeometry: { geometry: "peacock floral embroidery", placement: fill("embroidery", 600) },
      garmentEvidence: [
        { region: "pallu", state: "confirmed", visibleConstruction: fill("pallu evidence", 800), visibleDecoration: "pallu-evidence-marker", closures: "", explicitlyAbsent: [], uncertainty: "" },
        { region: "rear blouse", state: "unknown", visibleConstruction: "", visibleDecoration: "", closures: "", explicitlyAbsent: ["unproven tassels"], uncertainty: "rear-blouse-unknown-marker" },
        { region: "lower border", state: "confirmed_absent", visibleConstruction: "", visibleDecoration: "", closures: "", explicitlyAbsent: ["lower-border-absent-marker"], uncertainty: "" },
      ],
      detailPlacementMap: ["placement-marker: peacocks remain on the body field"],
      absenceConstraints: ["absence-marker: do not invent rear blouse embroidery"],
      sareeTruth: {
        body: {
          mainFabric: "silk-body-fabric-marker", weave: "diamond-lattice-weave-marker", weaveGeometry: "diagonal diamond lattice", texture: "fine woven texture", transparency: "semi-sheer", shine: "soft sheen", baseColor: "olive-body-color-marker", secondaryColors: ["antique gold", "coral"], pattern: "peacock and floral", motifInventory: ["body-peacock-marker", "body-floral-marker"], motifScale: "small", motifOrientation: "upright", motifRepeat: "regular", motifDensity: "dense", motifPlacement: "body field", embellishment: "zari accents", bodyOrientation: "upright",
        },
        borders: {
          upperBorder: "upper-border-marker", lowerBorder: "lower-border-marker", borderWidth: "narrow", upperBorderWidth: "2 cm", lowerBorderWidth: "5 cm", borderColors: "antique-gold-border-color-marker", construction: "woven border", motifGeometry: "linear floral", edgeTreatment: "finished", continuityRules: "continuous edge", tasselColor: "tassel-color-marker", tasselConstruction: "hand-knotted-tassel-marker", tasselSpacing: "evenly spaced",
        },
        pallu: {
          hasDistinctPallu: true, startingRegion: "pallu-start-marker", baseColor: "olive", motifInventory: ["pallu-peacock-marker", "pallu-floral-marker"], motifScale: "medium", motifOrientation: "upright", motifRepeat: "dense", motifDensity: "dense", borders: "gold edge", artwork: "pallu-artwork-marker", zari: "fine zari", embroidery: "floral embroidery", tassels: "tassel edge", edgeTreatment: "finished", visualOrientation: "vertical", evidenceReferences: "fully spread pallu", uncertainty: "",
        },
        pleatZone: { patternBehavior: "body lattice remains continuous", borderBehavior: "lower border stays visible", embellishmentBehavior: "no extra embellishment", hasSpecialPanel: false },
        blouse: { hasBlouse: true, color: "blouse-color-marker", fabric: "blouse-fabric-marker", frontConstruction: "blouse-front-construction-marker", backConstruction: "blouse-back-construction-marker", neckline: "v-neck", sleeves: "short", ties: "back ties", closure: "hook", embroidery: "matching", border: "none", pattern: "solid", fit: "fitted", isUnstitchedPiece: false },
        physics: { weight: "medium", stiffness: "soft", fluidity: "fluidity-marker", transparency: "semi-sheer", shine: "soft", creaseBehavior: "soft folds", expectedFall: "expected-fall-marker" },
        regionEvidence: [
          { region: "body", state: "confirmed", visibleConstruction: "woven body", visibleDecoration: "body motif", closures: "", explicitlyAbsent: [], uncertainty: "" },
          { region: "rear blouse", state: "unknown", visibleConstruction: "", visibleDecoration: "", closures: "", explicitlyAbsent: ["unproven decoration"], uncertainty: "unknown-rear-marker" },
        ],
      },
      sareeDrapePlan: {
        baseDrapeFamily: "nivi-drape-marker", shoulderSide: "left", waistTuck: "secure", frontPleatTreatment: "even", palluShoulderPlacement: "left shoulder", openOrPleatedPallu: "open", palluSpread: "pallu-spread-marker", palluFallDirection: "downward", palluVisibleLength: "full", handInteraction: "clear", movementAmount: "minimal", pinningBehavior: "pinned", borderVisibility: "visible", blouseVisibility: "front visible", coverageConstraints: "do not hide motifs", poseSpecificDrapeState: "front hero",
      },
      // These duplicate keys mimic a verbose normalized production session. The
      // projected product core must omit them because their dedicated blocks keep
      // the same facts exactly once.
      legacyVerboseCopy: fill("non-authoritative", 12000),
    },
    creativeDirection: { backgroundStyle: fill("scene", 1200), lighting: fill("lighting", 800), colorTreatment: "neutral" },
    modelIdentity: { face: fill("model", 900), hair: "locked" },
    stylingPlan: { footwear: "sandals", jewellery: "earrings", ornaments: "none", makeup: "natural", hair: "low bun", stylingNotes: fill("styling", 600), themeInterpretation: "catalog" },
    consistencyRules: Array.from({ length: 20 }, (_, index) => fill(`rule-${index}`, 700)),
  };
}

Deno.test("saree prompt projects truth once, protects every critical section, and stays below the provider budget", () => {
  const prompt = composeGenerationPrompt({
    skuName: "OLIVE-FIDELITY-01",
    productDetails: `notes-marker ${"note ".repeat(12_000)}`,
    pose: sareePose() as any,
    session: fidelitySareeSession() as any,
    references: [{ role: "saree_full_front" }, { role: "saree_pallu_spread" }],
    correction: `correction-marker ${"retry ".repeat(12_000)}`,
    learnings: `learning-marker ${"history ".repeat(12_000)}`,
  });

  assertEquals(prompt.length <= IMAGE_PROMPT_SAFE_CHARS, true);
  assertEquals(IMAGE_PROMPT_SAFE_CHARS, 31_500);
  for (const marker of [
    "olive-body-color-marker", "diamond-lattice-weave-marker", "body-peacock-marker", "pallu-artwork-marker",
    "upper-border-marker", "tassel-color-marker", "blouse-front-construction-marker", "expected-fall-marker",
    "nivi-drape-marker", "confirmed_absent", "unknown-rear-marker",
  ]) assertStringIncludes(prompt, marker);
  assertEquals(prompt.split("olive-body-color-marker").length - 1, 1);
  assertEquals(prompt.split("nivi-drape-marker").length - 1, 1);
  assertEquals(prompt.split("correction-marker").length - 1, 1);
  assertEquals(prompt.includes("legacyVerboseCopy"), false);
});

Deno.test("emoji-heavy optional text is capped by JavaScript prompt length", () => {
  const prompt = composeGenerationPrompt({
    skuName: `EMOJI-${"🦚".repeat(20_000)}`,
    productDetails: "🦚".repeat(20_000),
    pose: { ...sareePose(), prompt: "🦚".repeat(20_000) } as any,
    session: fidelitySareeSession() as any,
    references: [],
    correction: "🦚".repeat(20_000),
    learnings: "🦚".repeat(20_000),
  });

  assertEquals(prompt.length <= IMAGE_PROMPT_SAFE_CHARS, true);
});

Deno.test("the former 30,282-character false preflight block is accepted below the provider-safe budget", () => {
  const prompt = "x".repeat(30_282);
  assertEquals(assertGenerationPromptWithinLimit(prompt), prompt);
  assertThrows(
    () => assertGenerationPromptWithinLimit("x".repeat(31_501)),
    GenerationPromptBudgetError,
  );
});

Deno.test("oversized canonical saree truth is blocked locally before a provider request", () => {
  const session = fidelitySareeSession() as any;
  session.productIdentity.sareeTruth.body.baseColor = `olive ${"detail ".repeat(2_000)}`;
  const error = assertThrows(
    () => composeGenerationPrompt({
      skuName: "OVERSIZED-SAREE",
      productDetails: "",
      pose: sareePose() as any,
      session,
      references: [],
    }),
    GenerationPromptBudgetError,
  );
  assertEquals(error.code, "prompt_budget_exceeded");
});

Deno.test("composeGenerationPrompt locks bottom wear architecture and strictly prohibits dhoti/salwar substitution", () => {
  const prompt = composeGenerationPrompt({
    skuName: "FARSHI-KURTI-SET",
    productDetails: "Kurti set with fuchsia Farshi bottom",
    pose: {
      id: "full_front",
      title: "Hero Stance",
      poseNumber: 1,
      description: "Full body hero",
      cameraAngle: "straight",
      framing: "full",
      bodyPosition: "standing",
      handPlacement: "sides",
      expression: "confident",
      highlightedDetails: ["Farshi pleats", "hem band"],
      productVisibilityRules: ["complete bottom wear visible"],
      purpose: "hero",
      consistencyNotes: "locked",
      prompt: "Show complete farshi kurti set.",
      enabled: true,
    } as any,
    session: {
      productIdentity: {
        garmentFamily: "kurta_or_kurti_set",
        mainColor: "ivory white",
        bottomWearDetails: "Farshi Pajama with wide flared straight legs, front inverted box pleats, 3-inch gold hem band; NOT dhoti pants, NOT tapered at ankle",
      },
    },
    references: [{ role: "front" }],
  });

  assertStringIncludes(prompt, "LOCKED BOTTOM WEAR ARCHITECTURE & SILHOUETTE - HIGHEST FIDELITY:");
  assertStringIncludes(prompt, "Farshi Pajama with wide flared straight legs");
  assertStringIncludes(prompt, "ABSOLUTE PROHIBITION ON SILHOUETTE SUBSTITUTION:");
  assertStringIncludes(prompt, "STRICTLY FORBIDDEN from rendering dhoti pants, tulip pants, harem pants, Afghani salwars");
  assertStringIncludes(prompt, "ABSOLUTE PROHIBITION ON BOTTOM WEAR SUBSTITUTION:");
});

Deno.test("true-back pose preserves bottom wear architecture without leaking front decoration", () => {
  const prompt = composeGenerationPrompt({
    skuName: "FARSHI-KURTI-SET-BACK",
    productDetails: "Back view of Kurti set",
    pose: {
      id: "back",
      title: "Full Back View",
      poseNumber: 3,
      description: "Rear view",
      cameraAngle: "back",
      framing: "full",
      bodyPosition: "away",
      handPlacement: "sides",
      expression: "away",
      highlightedDetails: ["rear kurti", "bottom wear from back"],
      productVisibilityRules: ["dupatta draped forward", "bottom wear visible"],
      purpose: "rear",
      consistencyNotes: "locked",
      prompt: "Show rear view.",
      enabled: true,
    } as any,
    session: {
      productIdentity: {
        garmentFamily: "kurta_or_kurti_set",
        frontConstruction: "front-lace-should-not-leak",
        bottomWearDetails: "Farshi Pajama with wide flared straight legs, front inverted box pleats, 3-inch gold hem band",
        garmentEvidence: [
          { region: "back hem", sourceRole: "back", state: "confirmed", visibleDecoration: "plain hem" },
        ],
      },
    },
    references: [{ role: "back" }],
  });

  // Verify bottom wear details survive in rear product core and bottom wear section
  assertStringIncludes(prompt, "Farshi Pajama with wide flared straight legs");
  assertStringIncludes(prompt, "LOCKED BOTTOM WEAR ARCHITECTURE & SILHOUETTE - HIGHEST FIDELITY:");
  // Verify front detail does not leak
  assertEquals(prompt.includes("front-lace-should-not-leak"), false);
});
