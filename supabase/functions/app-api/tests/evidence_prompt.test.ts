import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  GenerationPromptBudgetError,
  IMAGE_PROMPT_SAFE_CHARS,
  assertGenerationPromptWithinLimit,
  compactFullPromptSafely,
  composeGenerationPrompt,
} from "../lib/generationPrompt.ts";
import { normalizeAnalysis } from "../lib/profiles.ts";
import { buildGenerationMemory, formatGenerationMemoryBrief } from "../lib/generationMemory.ts";

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

  const quarantined = composeGenerationPrompt({
    skuName: "Test SKU",
    productDetails: "Test details",
    pose: poseData as any,
    session: {
      productIdentity: {
        garmentEvidence: [
          { region: "front body", sourceRole: "front", state: "confirmed", visibleDecoration: "large maroon medallion butti" },
          { region: "front body", sourceRole: "style_reference", state: "confirmed", visibleDecoration: "small pink style-photo butti" },
        ],
      },
    },
    references: [{ role: "front" }, { role: "style_reference" }],
  });
  assertStringIncludes(quarantined, "large maroon medallion butti");
  assertEquals(quarantined.includes("small pink style-photo butti"), false);
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
  assertStringIncludes(prompt, "IMAGE 2: STYLE REFERENCE");
  assertStringIncludes(prompt, "IMAGE 3: APPROVED POSE 1");
  assertStringIncludes(prompt, "rear-plain-marker");
  assertEquals(prompt.includes("front-only-lace-marker"), false);
  assertEquals(prompt.includes("front-lace-construction-marker"), false);
  assertEquals(prompt.includes("front-lace-embroidery-marker"), false);
  assertStringIncludes(prompt, "BACK-POSE EVIDENCE VETO");
  assertStringIncludes(prompt, "BACK-POSE DUPATTA & HAIR UNOBSTRUCTED RULE");
  assertStringIncludes(prompt, "REAR PRODUCT GEOMETRY LOCK");
  assertStringIncludes(prompt, "DUPATTA / SHAWL / ACCESSORY UNOBSTRUCTED VIEW");
  assertStringIncludes(prompt, "DUPATTA REAR VISIBILITY LOCK");
  assertStringIncludes(prompt, "HAIR REAR VISIBILITY LOCK");
  assertStringIncludes(prompt, "SET & BACKDROP HARD LOCK TO APPROVED POSE 1");
  assertStringIncludes(prompt, "ZERO NEW PROPS");
  assertStringIncludes(prompt, "glances back over her shoulder");
});

Deno.test("a saree prompt drops style-photo region evidence even when analysis was not normalized", () => {
  const prompt = composeGenerationPrompt({
    skuName: "STYLE-MOTIF-SAREE",
    productDetails: "Olive silk saree",
    pose: {
      id: "full_front", title: "Front", poseNumber: 1, description: "front", cameraAngle: "front", framing: "full", bodyPosition: "standing",
      handPlacement: "relaxed", expression: "calm", highlightedDetails: [], productVisibilityRules: [], purpose: "hero", consistencyNotes: "locked", prompt: "Front hero.", enabled: true,
    } as any,
    session: {
      productIdentity: {
        garmentFamily: "saree",
        sareeTruth: {
          body: { mainFabric: "silk", baseColor: "olive" },
          regionEvidence: [
            { region: "body", sourceRole: "saree_body_detail", state: "confirmed", visibleDecoration: "product-peacock-marker" },
            { region: "body", sourceRole: "STYLE REFERENCE - SOLE AUTHORITY for the backdrop", state: "confirmed", visibleDecoration: "style-butti-marker" },
          ],
        },
        sareeDrapePlan: { shoulderSide: "left" },
      },
    },
    references: [{ role: "saree_front_drape" }, { role: "saree_body_detail" }, { role: "style_reference" }],
  });
  assertStringIncludes(prompt, "product-peacock-marker");
  assertEquals(prompt.includes("style-butti-marker"), false);
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

Deno.test("ultra-long saree session exceeding 33,000 chars raw prompt is compacted safely below 31,500 chars without error", () => {
  const session = fidelitySareeSession() as any;
  // Populate 16 extensive regional evidence items to simulate an extensive saree product analysis
  session.productIdentity.garmentEvidence = Array.from({ length: 16 }, (_, i) => ({
    region: `region-${i + 1}-detail-zone`,
    state: "confirmed",
    sourceRole: "saree_full_front",
    visibleConstruction: `Complex intricate weave construction with zari inlay for zone ${i + 1}. ` + "texture pattern warp weft ".repeat(15),
    visibleDecoration: `Rich traditional border motifs with fine metallic zari threadwork for zone ${i + 1}. ` + "peacock floral vine ".repeat(15),
    closures: "None",
    explicitlyAbsent: ["None"],
    uncertainty: "None",
  }));

  const prompt = composeGenerationPrompt({
    skuName: "ROYAL-BANARASI-SAREE-HEAVY-WORK",
    productDetails: "Traditional pure silk saree with heavy zari work across all zones.",
    pose: sareePose() as any,
    session,
    references: [
      { role: "saree_full_front" },
      { role: "saree_pallu_spread" },
      { role: "saree_body_detail" },
      { role: "saree_border_tassels" },
    ],
  });

  assertEquals(prompt.length <= IMAGE_PROMPT_SAFE_CHARS, true);
  assertEquals(prompt.length <= 31_500, true);
  assertStringIncludes(prompt, "SAREE TRUTH - CRITICAL:");
  assertStringIncludes(prompt, "SAREE DRAPE PLAN:");
  assertStringIncludes(prompt, "Product accuracy is more important than style matching.");
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

  assertStringIncludes(prompt, "LOCKED BOTTOM WEAR ARCHITECTURE, SILHOUETTE & PRINT - HIGHEST FIDELITY:");
  assertStringIncludes(prompt, "Farshi Pajama with wide flared straight legs");
  assertStringIncludes(prompt, "ABSOLUTE PROHIBITION ON SILHOUETTE SUBSTITUTION:");
  assertStringIncludes(prompt, "STRICTLY FORBIDDEN from rendering palazzo, plain wide-leg pants, a lehenga/skirt");
  assertStringIncludes(prompt, "ABSOLUTE PROHIBITION ON BOTTOM WEAR SUBSTITUTION:");
  assertStringIncludes(prompt, "FARSHI / FARSI HARD LOCK:");
  assertStringIncludes(prompt, "three waist pleats on each side");
  assertStringIncludes(prompt, "one large pleat on each side at the side-seam joint");
  assertStringIncludes(prompt, "hem panel 6 inches wide is joined");
  assertStringIncludes(prompt, "tapers 4 inches from its upper edge to its lower edge");
  assertEquals(prompt.includes("NOT tapered at ankle"), false);
  assertStringIncludes(prompt, "Never use the kurta/upper FABRIC / PATTERN DETAIL close-up as the bottom print");
});

Deno.test("composeGenerationPrompt treats a dedicated bottom reference as print authority and does not flatten farshi into palazzo", () => {
  const prompt = composeGenerationPrompt({
    skuName: "FARSHI-KURTI-SET",
    productDetails: "Kurti set with magenta farshi pajama",
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
      highlightedDetails: ["farshi volume", "gold floral"],
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
        bottomWearDetails: "Farsi / Farshi Pajama, magenta silk, bold large-scale gold floral bootas; NOT palazzo, NOT lehenga, NOT solid magenta",
      },
    },
    references: [{ role: "front" }, { role: "fabric_pattern" }, { role: "bottom" }],
    fashionKnowledge: "- Farshi pajama keeps two distinct legs and large gold florals from the bottom reference.",
  });

  assertStringIncludes(prompt, "BOTTOM WEAR / FARSHI");
  assertStringIncludes(prompt, "pixel-level authority for bottom-wear cut, volume, hem, fabric color, and print");
  assertStringIncludes(prompt, "FABRIC / PATTERN DETAIL image is the pixel-level authority for UPPER-garment");
  assertStringIncludes(prompt, "STRICTLY FORBIDDEN from rendering the bottoms as solid/undecorated color, as faint dots/speckles");
  assertStringIncludes(prompt, "FASHION KNOWLEDGE (SEEDED CUT/PRINT GUIDANCE, SUBORDINATE TO PRODUCT REFERENCES):");
  assertEquals(prompt.includes("If the bottom wear is Farshi / Farshi Pajama, palazzo, or wide-leg pants"), false);
});

Deno.test("composeGenerationPrompt preserves ankle-length Farshi flared cut and chevron geometric print", () => {
  const prompt = composeGenerationPrompt({
    skuName: "MOGRA-FARSHI-SET",
    productDetails: "Kurti set with Farshi bottom in chevron print",
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
      highlightedDetails: ["Farshi flare", "chevron print"],
      productVisibilityRules: ["complete bottom wear visible"],
      purpose: "hero",
      consistencyNotes: "locked",
      prompt: "Show complete farshi kurti set.",
      enabled: true,
    } as any,
    session: {
      productIdentity: {
        garmentFamily: "kurta_or_kurti_set",
        mainColor: "mustard yellow",
        bottomWearDetails: "Farshi Pajama / Farshi pants, voluminous flared two-leg cut with vertical pleats and soft gathers, ankle-length displaying gold juttis, bold dark chocolate-brown chevron zigzag print on beige ground with gold-red sequin lace trim above hem; NOT palazzo, NOT plain tubular wide-leg, NOT lehenga",
      },
    },
    references: [{ role: "front" }, { role: "fabric_pattern" }, { role: "bottom" }],
  });

  assertStringIncludes(prompt, "FARSHI / FARSI HARD LOCK:");
  assertStringIncludes(prompt, "ankle-length clearing the floor to display footwear/juttis");
  assertStringIncludes(prompt, "6-inch joined hem and its 4-inch taper");
  assertStringIncludes(prompt, "chevron/zigzag geometric patterns");
  assertStringIncludes(prompt, "gold-red sequin lace trim above hem");
  assertEquals(prompt.includes("PALAZZO HARD LOCK:"), false);
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
  assertStringIncludes(prompt, "LOCKED BOTTOM WEAR ARCHITECTURE, SILHOUETTE & PRINT - HIGHEST FIDELITY:");
  // Verify front detail does not leak
  assertEquals(prompt.includes("front-lace-should-not-leak"), false);
});

Deno.test("composeGenerationPrompt enforces style reference backdrop authority and strictly prohibits pre-shoot backgrounds", () => {
  const prompt = composeGenerationPrompt({
    skuName: "KAPOOR-KURTI-SET",
    productDetails: "Magenta kurti with cream farshi pajama",
    pose: {
      id: "full_front",
      title: "Front Hero View",
      poseNumber: 1,
      description: "Square front hero",
      cameraAngle: "eye level",
      framing: "full",
      bodyPosition: "straight",
      handPlacement: "relaxed",
      expression: "confident",
      highlightedDetails: ["neckline", "farshi cut"],
      productVisibilityRules: ["garment visible"],
      purpose: "hero",
      consistencyNotes: "locked",
      prompt: "Full front hero pose.",
      enabled: true,
    } as any,
    session: {
      productIdentity: {
        garmentFamily: "kurta_or_kurti_set",
        mainColor: "magenta",
        bottomWearDetails: "cream farshi pajama",
      },
      creativeDirection: {
        backgroundStyle: "Minimalist brutalist sandstone plinth with warm directional sunlight",
        studioEnvironment: "Warm architectural minimalist set",
      },
    },
    references: [
      { role: "model_identity" },
      { role: "front" },
      { role: "bottom" },
      { role: "back" },
      { role: "fabric_pattern" },
      { role: "style_reference" },
    ],
  });

  // Verify style reference authority
  assertStringIncludes(prompt, "STYLE REFERENCE - SOLE AUTHORITY for photoshoot backdrop, room architecture, wall color/texture, flooring, props, composition, mood, and lighting");
  assertStringIncludes(prompt, "do not copy the pose or objects in the hands");
  assertStringIncludes(prompt, "If the eyes are hidden, keep that cover and the visible face.");
  assertStringIncludes(prompt, "Photoshoot environment authority: The physical studio set, backdrop wall, architectural features, flooring, and lighting MUST be derived solely from the STYLE REFERENCE");
  // Verify pre-shoot background prohibition
  assertStringIncludes(prompt, "STRICTLY PROHIBITED: Do NOT copy, borrow, or reproduce any background walls, arches, urns, terracotta pots, plants, furniture, or outdoor locations visible behind the garment in the FRONT, BACK, BOTTOM, or other product reference photos");
  assertStringIncludes(prompt, "ABSOLUTE PROHIBITION ON PRODUCT PRE-SHOOT BACKGROUNDS");
  assertStringIncludes(prompt, "STRICT PROHIBITION ON COPYING PRE-SHOOT BACKGROUNDS");
});

Deno.test("composeGenerationPrompt enforces seated editorial pose for Pose 4 when demanded", () => {
  // Test case 1: user notes demand sitting pose
  const promptWithSittingNotes = composeGenerationPrompt({
    skuName: "EDITORIAL-SITTING-SET",
    productDetails: "Kurti set with sit pose required on wooden bench",
    pose: {
      id: "creative",
      title: "Playful Editorial Swirl",
      poseNumber: 4,
      description: "Creative fashion pose",
      cameraAngle: "editorial",
      framing: "full",
      bodyPosition: "creative movement",
      handPlacement: "expressive",
      expression: "chic",
      highlightedDetails: ["movement", "drape"],
      productVisibilityRules: ["all visible"],
      purpose: "editorial",
      consistencyNotes: "locked",
      prompt: "Creative pose showing garment flow.",
      enabled: true,
    } as any,
    session: {
      productIdentity: {
        garmentFamily: "kurta_or_kurti_set",
        mainColor: "fuchsia",
        bottomWearDetails: "farshi pajama",
      },
      creativeDirection: {
        backgroundStyle: "Minimalist studio with sleek bench",
      },
    },
    references: [{ role: "front" }, { role: "style_reference" }],
  });

  assertStringIncludes(promptWithSittingNotes, "POSE CATEGORY RULES (SITTING):");
  assertStringIncludes(promptWithSittingNotes, "SEATED / SITTING EDITORIAL POSE:");
  assertStringIncludes(promptWithSittingNotes, "SEATED EDITORIAL POSE REQUIREMENT (POSE 4):");
  assertStringIncludes(promptWithSittingNotes, "Elegant seated editorial pose on a minimal studio bench");

  // Test case 2: sitting is NOT demanded -> keeps dynamic/playful editorial movement
  const promptWithoutSitting = composeGenerationPrompt({
    skuName: "DYNAMIC-MOVEMENT-SET",
    productDetails: "Kurti set with wide farshi pants",
    pose: {
      id: "creative",
      title: "Playful Editorial Swirl",
      poseNumber: 4,
      description: "Dynamic walking motion and swirl",
      cameraAngle: "editorial",
      framing: "full",
      bodyPosition: "controlled walking movement",
      handPlacement: "expressive",
      expression: "chic",
      highlightedDetails: ["swirl", "drape"],
      productVisibilityRules: ["all visible"],
      purpose: "editorial",
      consistencyNotes: "locked",
      prompt: "Playful walking motion and garment swirl.",
      enabled: true,
    } as any,
    session: {
      productIdentity: {
        garmentFamily: "kurta_or_kurti_set",
        mainColor: "fuchsia",
        bottomWearDetails: "farshi pajama",
      },
      creativeDirection: {
        backgroundStyle: "Clean architectural studio",
      },
    },
    references: [{ role: "front" }, { role: "style_reference" }],
  });

  assertStringIncludes(promptWithoutSitting, "POSE CATEGORY RULES (DYNAMIC):");
  assertStringIncludes(promptWithoutSitting, "NATURAL EDITORIAL POSE: A relaxed catalog stance");
  assertStringIncludes(promptWithoutSitting, "Do not freeze a walking stride");
  assertStringIncludes(promptWithoutSitting, "STYLE REFERENCE SITTING OVERRIDE (POSE 4):");
  assertEquals(promptWithoutSitting.includes("SEATED EDITORIAL POSE REQUIREMENT (POSE 4):"), false);
});

Deno.test("composeGenerationPrompt seats pose 4 from seatedPoseRequired even when pose text is walking", () => {
  const prompt = composeGenerationPrompt({
    skuName: "SEATED-FLAG-SET",
    productDetails: "Kurti set with wide farshi pants",
    pose: {
      id: "creative",
      title: "Playful Editorial Swirl",
      poseNumber: 4,
      description: "Dynamic walking motion and swirl",
      cameraAngle: "editorial",
      framing: "full",
      bodyPosition: "controlled walking movement",
      handPlacement: "expressive",
      expression: "chic",
      highlightedDetails: ["swirl", "drape"],
      productVisibilityRules: ["all visible"],
      purpose: "editorial",
      consistencyNotes: "locked",
      prompt: "Playful walking motion and garment swirl.",
      enabled: true,
    } as any,
    session: {
      productIdentity: {
        garmentFamily: "kurta_or_kurti_set",
        mainColor: "fuchsia",
        bottomWearDetails: "farshi pajama",
      },
      creativeDirection: {
        backgroundStyle: "Clean architectural studio",
        seatedPoseRequired: "yes",
        seatedPoseReason: "style reference model is seated on a stone plinth",
      },
    },
    references: [{ role: "front" }, { role: "style_reference" }],
  });

  assertStringIncludes(prompt, "POSE CATEGORY RULES (SITTING):");
  assertStringIncludes(prompt, "SEATED EDITORIAL POSE REQUIREMENT (POSE 4):");
  assertStringIncludes(prompt, "Elegant seated editorial pose on a minimal studio bench");
});

Deno.test("composeGenerationPrompt locks style-reference jewellery and dual-mode pose 5", () => {
  const jewelleryPrompt = composeGenerationPrompt({
    skuName: "ORNAMENT-SET",
    productDetails: "Ivory kurta",
    pose: {
      id: "full_front",
      title: "Front Hero View",
      poseNumber: 1,
      description: "Square front hero",
      cameraAngle: "eye level",
      framing: "full",
      bodyPosition: "straight",
      handPlacement: "relaxed",
      expression: "confident",
      highlightedDetails: ["neckline"],
      productVisibilityRules: ["garment visible"],
      purpose: "hero",
      consistencyNotes: "locked",
      prompt: "Full front hero pose.",
      enabled: true,
    } as any,
    session: {
      productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "ivory" },
      stylingPlan: {
        footwear: "nude block heels",
        jewellery: "oxidised silver jhumkas and one matching cuff",
        ornaments: "none",
        makeup: "natural",
        hair: "low bun",
        stylingNotes: "keep yoke clear",
        themeInterpretation: "style-reference temple silver",
      },
    },
    references: [{ role: "front" }, { role: "style_reference" }],
  });
  assertStringIncludes(jewelleryPrompt, "JEWELLERY & ORNAMENT LOCK");
  assertStringIncludes(jewelleryPrompt, "oxidised silver jhumkas and one matching cuff");
  assertStringIncludes(jewelleryPrompt, "never invent a competing jewellery story");

  const faceAndDetail = composeGenerationPrompt({
    skuName: "CLOSEUP-FACE-SET",
    productDetails: "Ivory kurta",
    pose: {
      id: "closeup",
      title: "Zoomed-In Product Detail Highlight",
      poseNumber: 5,
      description: "Face and neckline",
      cameraAngle: "eye level",
      framing: "face-to-chest",
      bodyPosition: "upper body",
      handPlacement: "away",
      expression: "soft smile",
      highlightedDetails: ["neckline embroidery"],
      productVisibilityRules: ["face and detail visible"],
      purpose: "detail",
      consistencyNotes: "locked",
      prompt: "Face-to-chest crop with neckline embroidery.",
      enabled: true,
    } as any,
    session: {
      productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "ivory" },
      creativeDirection: { closeupMode: "face_and_detail", closeupHeroDetail: "square yoke embroidery lattice" },
    },
    references: [{ role: "front" }, { role: "fabric_pattern" }],
  });
  assertStringIncludes(faceAndDetail, "POSE 5 HARD RULE (FACE + PRODUCT DETAIL)");
  assertStringIncludes(faceAndDetail, "square yoke embroidery lattice");
  assertEquals(faceAndDetail.includes("PRODUCT DETAIL PRIMARY"), false);

  const productDetail = composeGenerationPrompt({
    skuName: "CLOSEUP-DETAIL-SET",
    productDetails: "Ivory kurta",
    pose: {
      id: "closeup",
      title: "Zoomed-In Product Detail Highlight",
      poseNumber: 5,
      description: "Macro embroidery crop, face optional",
      cameraAngle: "eye level",
      framing: "product detail crop",
      bodyPosition: "detail crop",
      handPlacement: "away",
      expression: "optional",
      highlightedDetails: ["pallu border artwork"],
      productVisibilityRules: ["product-detail-first crop", "face optional"],
      purpose: "detail",
      consistencyNotes: "locked",
      prompt: "Product-detail-first crop of pallu border artwork.",
      enabled: true,
    } as any,
    session: {
      productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "ivory" },
      creativeDirection: { closeupMode: "product_detail", closeupHeroDetail: "pallu border artwork" },
    },
    references: [{ role: "front" }, { role: "fabric_pattern" }],
  });
  assertStringIncludes(productDetail, "POSE 5 HARD RULE (PRODUCT DETAIL PRIMARY)");
  assertStringIncludes(productDetail, "This frame is a PRODUCT-DETAIL close-up");
  assertStringIncludes(productDetail, "pallu border artwork");
  assertEquals(productDetail.includes("FACE + PRODUCT DETAIL"), false);

  const withoutStyleImage = composeGenerationPrompt({
    skuName: "NO-STYLE-SET",
    productDetails: "Ivory kurta",
    pose: {
      id: "full_front",
      title: "Front Hero View",
      poseNumber: 1,
      description: "Square front hero",
      cameraAngle: "eye level",
      framing: "full",
      bodyPosition: "straight",
      handPlacement: "relaxed",
      expression: "confident",
      highlightedDetails: ["neckline"],
      productVisibilityRules: ["garment visible"],
      purpose: "hero",
      consistencyNotes: "locked",
      prompt: "Full front hero pose.",
      enabled: true,
    } as any,
    session: {
      productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "ivory" },
    },
    references: [{ role: "front" }],
  });
  assertStringIncludes(withoutStyleImage, "No STYLE REFERENCE image is in this manifest");
  assertEquals(withoutStyleImage.includes("If the STYLE REFERENCE image in this manifest shows jewellery"), false);

  const memoryPrompt = composeGenerationPrompt({
    skuName: "MEMORY-SET",
    productDetails: "Ivory kurta",
    pose: {
      id: "angled",
      title: "Angled",
      poseNumber: 2,
      description: "Three-quarter",
      cameraAngle: "eye level",
      framing: "full",
      bodyPosition: "angled",
      handPlacement: "relaxed",
      expression: "confident",
      highlightedDetails: ["neckline"],
      productVisibilityRules: ["garment visible"],
      purpose: "angle",
      consistencyNotes: "locked",
      prompt: "Angled coverage pose.",
      enabled: true,
    } as any,
    session: {
      productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "ivory" },
    },
    references: [{ role: "front" }, { role: "style_reference" }, { role: "approved_pose" }],
    generationMemory: "- Product images (SKU/garment truth only): front, back.\n- Style reference (photoshoot set, backdrop, lighting, jewellery taste only): style_reference.",
  });
  assertStringIncludes(memoryPrompt, "GENERATION MEMORY (DO NOT FORGET)");
  assertStringIncludes(memoryPrompt, "Product images (SKU/garment truth only): front, back");
  assertStringIncludes(memoryPrompt, "Style reference remains set/backdrop authority");

  const padded = productDetail.replace(
    "Create ONE real-camera fashion e-commerce photograph",
    `${"OVERFLOW ".repeat(4_000)}Create ONE real-camera fashion e-commerce photograph`,
  );
  assertEquals(padded.length > IMAGE_PROMPT_SAFE_CHARS, true);
  const compacted = compactFullPromptSafely(padded);
  assertEquals(compacted.length <= IMAGE_PROMPT_SAFE_CHARS, true);
  assertStringIncludes(compacted, "POSE 5 HARD RULE (PRODUCT DETAIL PRIMARY)");
});

Deno.test("composeGenerationPrompt enforces 6-pose variation, reference image scope, locked details, and natural expressions", () => {
  // Test Pose 2: Mandatory 3/4 turn
  const pose2Prompt = composeGenerationPrompt({
    skuName: "KURTA-SET-01",
    productDetails: "Purple floral printed kurta with patiala salwar",
    pose: {
      id: "angled",
      title: "Three-Quarter Sleeve and Fall View",
      poseNumber: 2,
      description: "Model standing at three-quarter angle",
      cameraAngle: "eye level",
      framing: "full body",
      bodyPosition: "35 degree angle",
      handPlacement: "one hand near collar",
      expression: "natural soft smile",
      highlightedDetails: ["side silhouette", "sleeve"],
      productVisibilityRules: ["garment visible"],
      purpose: "angle",
      consistencyNotes: "locked",
      prompt: "Show angled view.",
      enabled: true,
    } as any,
    session: {
      productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "purple" },
      creativeDirection: { seatedPoseRequired: "no" },
    },
    references: [{ role: "front" }, { role: "style_reference" }],
  });

  // 1. 6-Pose Variation Directive
  assertStringIncludes(pose2Prompt, "6-POSE PLAN VARIATION DIRECTIVE");
  assertStringIncludes(pose2Prompt, "CURRENT FRAME (POSE 2 - MANDATORY 3/4 TURN)");
  assertStringIncludes(pose2Prompt, "Torso and hips MUST physically rotate 35 to 45 degrees");
  assertStringIncludes(pose2Prompt, "Both feet stay planted and close");
  assertStringIncludes(pose2Prompt, "never a walking stride or a lifted foot");
  assertStringIncludes(pose2Prompt, "DO NOT render a flat frontal standing pose or repeat Pose 1");

  // 2. Reference Image Scope & Product Integrity
  assertStringIncludes(pose2Prompt, "REFERENCE IMAGE SCOPE & PRODUCT INTEGRITY:");
  assertStringIncludes(pose2Prompt, "the STYLE REFERENCE is the only source for the photoshoot backdrop, wall, floor, props, lighting, and camera mood on all six poses");
  assertStringIncludes(pose2Prompt, "SET ONLY: the direction below is backdrop, light, and camera. It does not set the pose, the garment, or handheld props.");
  assertStringIncludes(pose2Prompt, "the STYLE REFERENCE face, hair, skin tone, and body proportions are the model identity for all six poses");
  assertStringIncludes(pose2Prompt, "The product must NOT be redesigned, altered, recolored, or restyled based on what the reference image shows");
  assertStringIncludes(pose2Prompt, "If this written profile disagrees with the product photos on motif, neckline, sleeves, or hem, the photos win.");

  // 3. Locked Details Across All Six Images
  assertStringIncludes(pose2Prompt, "LOCKED DETAILS ACROSS ALL SIX IMAGES (AVOID CONSISTENCY MISTAKES):");
  assertStringIncludes(pose2Prompt, "Background / Backdrop: Exact same physical room, wall finish, flooring, lighting, shadows, and props across all 6 frames");
  assertStringIncludes(pose2Prompt, "Footwear: The exact same footwear (pair, style, heel, color, finish) across all 6 frames");
  assertStringIncludes(pose2Prompt, "Ornaments & Jewellery: Identical jewellery pieces, metal type, count, and placement across all 6 frames");
  assertStringIncludes(pose2Prompt, "Product Layout & Product Design: Garment construction, cuts, seams, trims, embroidery geometry, pattern repeat, and bottom-wear architecture remain locked across all 6 frames");

  // 4. Natural & Realistic Expressions
  assertStringIncludes(pose2Prompt, "Natural, realistic expressions and smiles:");
  assertStringIncludes(pose2Prompt, "strictly avoid forced, wide, exaggerated, frozen, or artificial 'stock-photo' smiles");

  // 5. Negative rules
  assertStringIncludes(pose2Prompt, "Never render duplicate or identical frontal standing poses across different pose slots");
  assertStringIncludes(pose2Prompt, "Never render artificial, forced, stiff, or frozen stock catalog smiles");
  assertStringIncludes(pose2Prompt, "Never redesign the product or copy garment details from the style reference");

  // Test Pose 4: Walking stride
  const pose4Prompt = composeGenerationPrompt({
    skuName: "KURTA-SET-01",
    productDetails: "Purple floral printed kurta with patiala salwar",
    pose: {
      id: "creative",
      title: "Playful Courtyard Step",
      poseNumber: 4,
      description: "Mid-stride walk",
      cameraAngle: "eye level",
      framing: "full body",
      bodyPosition: "walking",
      handPlacement: "natural swing",
      expression: "warm natural glance",
      highlightedDetails: ["flare"],
      productVisibilityRules: ["garment visible"],
      purpose: "movement",
      consistencyNotes: "locked",
      prompt: "Show walking motion.",
      enabled: true,
    } as any,
    session: {
      productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "purple" },
      creativeDirection: { seatedPoseRequired: "no" },
    },
    references: [{ role: "front" }],
  });
  assertStringIncludes(pose4Prompt, "CURRENT FRAME (POSE 4 - NATURAL EDITORIAL STANCE)");
  assertStringIncludes(pose4Prompt, "NEVER a frozen mid-step, a spin, a wide leg split");
  assertStringIncludes(pose4Prompt, "Natural editorial stance. Both feet stay planted and close.");
  assertEquals(pose4Prompt.includes("Show walking motion."), false);
  assertEquals(pose4Prompt.includes("Mid-stride walk"), false);

  const walkingPose2 = composeGenerationPrompt({
    skuName: "KURTA-SET-01",
    productDetails: "Purple floral printed kurta with patiala salwar",
    pose: {
      id: "angled",
      title: "Three-Quarter Sleeve and Fall View",
      poseNumber: 2,
      description: "Mid-step walk toward camera",
      cameraAngle: "eye level",
      framing: "full body",
      bodyPosition: "walking stride, one foot lifted",
      handPlacement: "one hand near collar",
      expression: "natural soft smile",
      highlightedDetails: ["side silhouette", "sleeve"],
      productVisibilityRules: ["garment visible"],
      purpose: "angle",
      consistencyNotes: "locked",
      prompt: "Walk forward and show the side.",
      enabled: true,
    } as any,
    session: {
      productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "purple" },
      creativeDirection: { seatedPoseRequired: "no" },
    },
    references: [{ role: "front" }, { role: "style_reference" }],
  });
  assertStringIncludes(walkingPose2, "POSE CATEGORY RULES (ANGLED):");
  assertStringIncludes(walkingPose2, "not a 90-degree profile");
  assertEquals(walkingPose2.includes("exactly 90 degrees"), false);
  assertEquals(walkingPose2.includes("staggered stance"), false);
  assertStringIncludes(walkingPose2, "Torso and hips turn 35 to 45 degrees. Both feet stay planted and close.");
  assertEquals(walkingPose2.includes("Walk forward"), false);
  assertEquals(walkingPose2.includes("one foot lifted"), false);
  assertEquals(walkingPose2.includes("Mid-step walk toward camera"), false);

  const plannerPose2 = composeGenerationPrompt({
    skuName: "KURTA-SET-01",
    productDetails: "Purple floral printed kurta with patiala salwar",
    pose: {
      id: "angled",
      title: "Professional Side / 3/4 View",
      poseNumber: 2,
      description: "A professional three-quarter or side view that reveals depth, drape, fit, and side construction.",
      cameraAngle: "Eye-level 35-50 degree three-quarter view",
      framing: "full body",
      bodyPosition: "Rotate torso and hips together 35 to 45 degrees into an intentional three-quarter angle, both feet planted and close",
      handPlacement: "away from the side seam",
      expression: "natural glance",
      highlightedDetails: ["side silhouette"],
      productVisibilityRules: ["garment visible"],
      purpose: "depth",
      consistencyNotes: "locked",
      prompt: "Create an intentional 35-to-45 degree three-quarter fashion pose with both feet planted and close so a joined hem stays closed. Reveal side silhouette.",
      enabled: true,
    } as any,
    session: {
      productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "purple", bottomWearDetails: "farshi pajama" },
      creativeDirection: { seatedPoseRequired: "no" },
    },
    references: [{ role: "front" }, { role: "style_reference" }],
  });
  assertStringIncludes(plannerPose2, "POSE CATEGORY RULES (ANGLED):");
  assertStringIncludes(plannerPose2, "Both feet stay planted and close");
  assertEquals(plannerPose2.includes("exactly 90 degrees"), false);
  assertEquals(plannerPose2.includes("staggered stance"), false);

  const plannerPose4 = composeGenerationPrompt({
    skuName: "KURTA-SET-01",
    productDetails: "Purple floral printed kurta with farshi pajama",
    pose: {
      id: "creative",
      title: "Natural Editorial Pose",
      poseNumber: 4,
      description: "A natural editorial pose that follows the selected creative direction.",
      cameraAngle: "editorial",
      framing: "full body",
      bodyPosition: "Relaxed editorial stance: contrapposto or a soft three-quarter lean, both feet grounded and close; never a frozen walking stride",
      handPlacement: "relaxed",
      expression: "calm",
      highlightedDetails: ["silhouette"],
      productVisibilityRules: ["garment visible"],
      purpose: "editorial",
      consistencyNotes: "locked",
      prompt: "Create a natural editorial catalog frame with a soft three-quarter lean and both feet grounded and close. Never a frozen walking stride or a wide leg split.",
      enabled: true,
    } as any,
    session: {
      productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "purple", bottomWearDetails: "farshi pajama" },
      creativeDirection: { seatedPoseRequired: "no" },
    },
    references: [{ role: "front" }, { role: "style_reference" }],
  });
  assertStringIncludes(plannerPose4, "POSE CATEGORY RULES (DYNAMIC):");
  assertStringIncludes(plannerPose4, "NATURAL EDITORIAL POSE:");
  assertEquals(plannerPose4.includes("exactly 90 degrees"), false);
  assertEquals(plannerPose4.includes("staggered stance"), false);

  // Test Pose 6: Feature showcase
  const pose6Prompt = composeGenerationPrompt({
    skuName: "KURTA-SET-01",
    productDetails: "Purple floral printed kurta with patiala salwar",
    pose: {
      id: "showcase",
      title: "Patiala Volume Feature",
      poseNumber: 6,
      description: "Feature showcase",
      cameraAngle: "low angle",
      framing: "wide full body",
      bodyPosition: "feet separated",
      handPlacement: "relaxed",
      expression: "calm poise",
      highlightedDetails: ["bottom volume"],
      productVisibilityRules: ["garment visible"],
      purpose: "showcase",
      consistencyNotes: "locked",
      prompt: "Show volume.",
      enabled: true,
    } as any,
    session: {
      productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "purple" },
      creativeDirection: { seatedPoseRequired: "no" },
    },
    references: [{ role: "front" }],
  });
  assertStringIncludes(pose6Prompt, "CURRENT FRAME (POSE 6 - SIGNATURE FEATURE SHOWCASE)");
  assertStringIncludes(pose6Prompt, "Framing, angle, and physical stance MUST visibly diverge from Pose 1");
  assertStringIncludes(pose6Prompt, "Same model face, same uploaded product, and the same style-reference backdrop as the other five frames.");
  assertStringIncludes(pose6Prompt, "Planted weight shift. Both feet stay close.");
  assertEquals(pose6Prompt.includes("feet separated"), false);

  const propPose = composeGenerationPrompt({
    skuName: "KURTA-SET-01",
    productDetails: "Purple floral printed kurta with patiala salwar",
    pose: {
      id: "full_front",
      title: "Front Hero View",
      poseNumber: 1,
      description: "Square front hero",
      cameraAngle: "eye level",
      framing: "full",
      bodyPosition: "standing",
      handPlacement: "One hand holding a sparkler",
      expression: "Playful wink with a sparkler",
      highlightedDetails: ["neckline"],
      productVisibilityRules: ["garment visible"],
      purpose: "hero",
      consistencyNotes: "locked",
      prompt: "Full front hero pose.",
      enabled: true,
    } as any,
    session: {
      productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "purple" },
      creativeDirection: { seatedPoseRequired: "no" },
    },
    references: [{ role: "front" }, { role: "style_reference" }],
  });
  assertEquals(propPose.includes("sparkler"), false);
  assertStringIncludes(propPose, "holding nothing copied from the style or model photo");
  assertStringIncludes(propPose, "Calm natural expression.");

  const creativeLeak = composeGenerationPrompt({
    skuName: "MANGO-MEHENDI",
    productDetails: "Olive embroidered kurta",
    pose: {
      id: "showcase",
      title: "Hem feature",
      poseNumber: 6,
      description: "Feature showcase",
      cameraAngle: "low angle",
      framing: "full body",
      bodyPosition: "soft weight shift",
      handPlacement: "hands relaxed",
      expression: "calm poise",
      highlightedDetails: ["gold hem"],
      productVisibilityRules: ["hem visible"],
      purpose: "showcase",
      consistencyNotes: "locked",
      prompt: "Show the gold hem.",
      enabled: true,
    } as any,
    session: {
      productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "olive" },
      stylingPlan: {
        footwear: "juttis",
        jewellery: "gold jhumkas",
        ornaments: "gold jhumkas. One hand holds a sparkler.",
        makeup: "natural",
        hair: "side braid",
        stylingNotes: "keep the yoke clear",
      },
      creativeDirection: {
        backgroundStyle: "Green festive wall, red patchwork chair, and a walking-distance rug",
        propUsage: "Two handheld sparklers",
        suggestedAccessories: "A small potli. Also two sparklers.",
        showcasePlan: {
          heroFeature: "gold hem embroidery",
          featureRegion: "hem_border",
          shotType: "full_body_feature",
          whyItSells: "the hem craft is the signature",
          bodyPosition: "frozen walking stride with feet separated",
          handPlacement: "one hand holding a sparkler",
          expression: "wink while holding a sparkler",
          distinctFrom: "not the style photo walking pose",
          visibilityRules: ["hem fully visible", "sparkler stays in frame"],
        },
      },
    },
    references: [{ role: "front" }, { role: "style_reference" }],
  });
  assertEquals(creativeLeak.includes("sparkler"), false);
  assertEquals(creativeLeak.includes("feet separated"), false);
  assertEquals(creativeLeak.includes("style photo walking pose"), false);
  assertEquals(creativeLeak.includes("frozen walking stride with feet separated"), false);
  assertStringIncludes(creativeLeak, "walking-distance rug");
  assertStringIncludes(creativeLeak, "Set props only. Do not copy objects held in the style or model photo.");
  assertStringIncludes(creativeLeak, "Planted weight shift. Both feet stay close.");
  assertStringIncludes(creativeLeak, "holding nothing copied from the style or model photo");
  assertStringIncludes(creativeLeak, "Calm natural expression.");
  assertStringIncludes(creativeLeak, "gold hem embroidery");
  assertStringIncludes(creativeLeak, "hem fully visible");
  assertStringIncludes(creativeLeak, "gold jhumkas");
  assertStringIncludes(creativeLeak, "A small potli.");
  assertStringIncludes(creativeLeak, "keep the yoke clear");
  assertStringIncludes(creativeLeak, "If the eyes are hidden, keep that cover and the visible face.");
  assertStringIncludes(creativeLeak, "Do not invent an uncovered face.");
});

Deno.test("composeGenerationPrompt enforces anatomical integrity and eliminates extra hands", () => {
  const prompt = composeGenerationPrompt({
    skuName: "GREEN-BANARASI-SAREE",
    productDetails: "Bottle green banarasi saree with gold zari butti and heavy pallu",
    pose: {
      id: "full_front",
      title: "Hero Front Saree Pose",
      poseNumber: 1,
      description: "Full front standing pose holding pallu edge",
      cameraAngle: "eye level",
      framing: "full length",
      bodyPosition: "tall elegant posture",
      handPlacement: "left hand holds pallu edge, right hand at side",
      expression: "gentle smile",
      highlightedDetails: ["pallu zari", "body butti"],
      productVisibilityRules: ["pallu visible", "pleats visible"],
      purpose: "hero catalog shot",
      consistencyNotes: "establish identity",
      prompt: "Model standing wearing green saree.",
      enabled: true,
    } as any,
    session: {
      productIdentity: {
        garmentFamily: "saree",
        mainColor: "bottle green",
        sareeTruth: {},
        sareeDrapePlan: {},
      },
      creativeDirection: {
        backgroundStyle: "Terracotta studio with warm spotlight",
      },
    },
    references: [
      { role: "front" },
      { role: "style_reference" },
    ],
  });

  // Verify anatomical integrity directive in prompt
  assertStringIncludes(prompt, "STRICT HUMAN ANATOMY & NATURAL LIMB INTEGRITY (ZERO TOLERANCE FOR EXTRA LIMBS):");
  assertStringIncludes(prompt, "EXACTLY TWO ARMS AND TWO HANDS: The model must have strictly and exactly TWO arms and TWO hands in total.");
  assertStringIncludes(prompt, "It is STRICTLY FORBIDDEN to render a third hand, extra hand, extra arm, duplicate wrist, floating hand, or phantom limb");
  assertStringIncludes(prompt, "COORDINATED HAND PLACEMENT: When one hand is holding, touching, or adjusting the garment/pallu/dupatta, the other hand must be naturally placed");
  assertStringIncludes(prompt, "NO THIRD HAND may appear resting on the waist, navel, or pleats");
  assertStringIncludes(prompt, "STRICT ANATOMICAL RULE: NEVER render three hands, extra arms, duplicate hands, floating hands, phantom limbs, or extra body parts.");
});

Deno.test("composeGenerationPrompt enforces absolute quarantine of style reference clothing", () => {
  const prompt = composeGenerationPrompt({
    skuName: "ROYAL-KURTI-SET",
    productDetails: "Navy blue silk kurti with delicate gold butti work and matching trousers",
    pose: {
      id: "angled",
      title: "Three-Quarter Angle",
      poseNumber: 2,
      description: "35 degree angle turn",
      cameraAngle: "slight low",
      framing: "three quarter",
      bodyPosition: "turned 40 degrees",
      handPlacement: "one hand relaxed at side",
      expression: "composed editorial",
      highlightedDetails: ["kurti butti work", "side slit"],
      productVisibilityRules: ["kurti visible", "trousers visible"],
      purpose: "side angle shot",
      consistencyNotes: "locked scene",
      prompt: "Model turned at angle showing side construction.",
      enabled: true,
    } as any,
    session: {
      productIdentity: {
        garmentFamily: "kurta_or_kurti_set",
        mainColor: "navy blue",
      },
      creativeDirection: {
        backgroundStyle: "Minimal modern interior with arched doorway",
      },
    },
    references: [
      { role: "front" },
      { role: "style_reference" },
    ],
  });

  // Verify critical product integrity rule in EDIT GOAL
  assertStringIncludes(prompt, "CRITICAL PRODUCT INTEGRITY RULE: The product clothing (garment, fabric, colors, prints, embroidery, neckline, sleeves, and bottom wear) must be taken EXCLUSIVELY and EXACTLY from the UPLOADED PRODUCT reference images.");
  assertStringIncludes(prompt, "The clothing/outfit worn by the person in the STYLE REFERENCE image is strictly ignored and 100% DISCARDED.");
  assertStringIncludes(prompt, "Absolutely DO NOT copy, transfer, or blend the style reference image's garment onto the model.");
  assertStringIncludes(prompt, "Dress the model ONLY in the uploaded product.");

  // Verify scope directive
  assertStringIncludes(prompt, "ABSOLUTE PROHIBITION ON COPYING THE STYLE REFERENCE GARMENT: The clothing, outfit, saree, dress, fabric, color, embroidery, or prints shown on the person in the STYLE REFERENCE image MUST BE 100% DISCARDED.");
  assertStringIncludes(prompt, "STRICT PRODUCT ISOLATION RULE: Never copy, transfer, or borrow the clothing, saree, dress, colors, prints, or embroidery from the STYLE REFERENCE image. Dress the model ONLY in the uploaded product.");
});

Deno.test("composeGenerationPrompt ensures Pose 5 highlights primary garment butti/craft and forbids dupatta hijack", () => {
  const prompt = composeGenerationPrompt({
    skuName: "EMBROIDERED-KURTI-SET",
    productDetails: "Cream kurti with intricate floral butti work, matching pants, and plain red dupatta",
    pose: {
      id: "closeup",
      title: "Kurti Butti Craftsmanship Detail",
      poseNumber: 5,
      description: "Zoomed in macro shot of kurti butti work",
      cameraAngle: "straight on macro",
      framing: "tight detail",
      bodyPosition: "slight turn",
      handPlacement: "away from chest",
      expression: "gentle smile",
      highlightedDetails: ["kurti butti work", "neckline craft"],
      productVisibilityRules: ["butti work catalog readable"],
      purpose: "macro craftsmanship sell",
      consistencyNotes: "locked identity",
      prompt: "Macro close up of kurti butti work embroidery.",
      enabled: true,
    } as any,
    session: {
      productIdentity: {
        garmentFamily: "kurta_or_kurti_set",
        mainColor: "cream",
      },
      creativeDirection: {
        closeupMode: "product_detail",
        closeupHeroDetail: "intricate floral butti work on kurti body",
      },
    },
    references: [
      { role: "front" },
      { role: "fabric_pattern" },
    ],
  });

  assertStringIncludes(prompt, "POSE 5 PRIMARY PRODUCT FOCUS: Pose 5 MUST highlight the PRIMARY UPLOADED PRODUCT GARMENT's key signature details (such as kurti butti work, yoke/chest embroidery, neckline craft, handwork, or weave).");
  assertStringIncludes(prompt, "It is STRICTLY FORBIDDEN to focus on or fill the frame with a secondary accessory like a dupatta, stole, or scarf when the primary garment has butti work, embroidery, or craftsmanship to showcase.");
  assertStringIncludes(prompt, "Highlight the core product!");
  assertStringIncludes(prompt, "CURRENT FRAME (POSE 5 - ZOOMED-IN DETAIL): Genuinely zoomed in on product craftsmanship and selling details.");
  assertStringIncludes(prompt, "must NEVER focus on a secondary accessory like a dupatta or stole");
});

Deno.test("Pose 6 hard rule and aesthetic photoshoot direction survive prompt compaction and macro_detail omits mandatory full-face lock", () => {
  const showcasePrompt = composeGenerationPrompt({
    skuName: "EMERALD-KURTA-SET",
    productDetails: "Emerald green silk kurta set with mirror-work bell sleeves",
    pose: {
      id: "showcase",
      title: "Feature Focus: mirror-work bell sleeve cuff",
      poseNumber: 6,
      description: "Editorial macro showcase of mirror-work bell sleeve cuff",
      cameraAngle: "grazing macro angle",
      framing: "tight cuff detail",
      bodyPosition: "arm poised cleanly",
      handPlacement: "two hands relaxed, cuff unobstructed",
      expression: "optional",
      highlightedDetails: ["mirror-work bell sleeve cuff"],
      productVisibilityRules: ["cuff must fill frame"],
      primaryReference: "fabric_pattern",
      purpose: "sell sleeve craftsmanship",
      consistencyNotes: "locked set",
      prompt: "Create a catalog frame built around mirror-work bell sleeve cuff.",
      enabled: true,
    } as any,
    session: {
      productIdentity: {
        garmentFamily: "kurta_or_kurti_set",
        mainColor: "emerald green",
      },
      creativeDirection: {
        closeupMode: "face_and_detail",
        closeupHeroDetail: "neckline zari yoke",
        showcasePlan: {
          heroFeature: "mirror-work bell sleeve cuff",
          featureRegion: "sleeve",
          shotType: "macro_detail",
          whyItSells: "signature handwork on cuff",
          evidenceReference: "fabric_pattern",
          distinctFrom: "Pose 1 is full hero and Pose 5 is neckline yoke",
          visibilityRules: ["cuff mirror work unbroken"],
        },
      },
    },
    references: [{ role: "front" }, { role: "fabric_pattern" }],
  });

  assertStringIncludes(showcasePrompt, "POSE 6 HARD RULE (AESTHETIC FEATURE SHOWCASE & DETAIL LOCK):");
  assertStringIncludes(showcasePrompt, "SHOWCASE AESTHETIC PHOTOSHOOT & DETAIL FIDELITY:");
  assertStringIncludes(showcasePrompt, "EDITORIAL PHOTOSHOOT EXECUTION:");
  assertEquals(showcasePrompt.includes("Never render a plastic, waxy, over-smoothed, mirror-symmetric, or otherwise synthetic \"AI face\"."), false);

  const padded = showcasePrompt.replace(
    "Create ONE real-camera fashion e-commerce photograph",
    `${"OVERFLOW ".repeat(4_000)}Create ONE real-camera fashion e-commerce photograph`,
  );
  assertEquals(padded.length > IMAGE_PROMPT_SAFE_CHARS, true);
  const compacted = compactFullPromptSafely(padded);
  assertEquals(compacted.length <= IMAGE_PROMPT_SAFE_CHARS, true);
  assertStringIncludes(compacted, "POSE 6 HARD RULE (AESTHETIC FEATURE SHOWCASE & DETAIL LOCK):");
  assertStringIncludes(compacted, "SHOWCASE FRAME SUBJECT: mirror-work bell sleeve cuff");
});

Deno.test("a compacted pose block keeps the current frame and seated rules, and drops a walking prompt", () => {
  const productIdentity = {
    garmentFamily: "kurta_or_kurti_set",
    category: "ethnic set",
    mainColor: "peach",
    secondaryColors: ["maroon", "pink"],
    fabric: "cotton silk",
    pattern: "large maroon medallion butti",
    print: "large maroon medallion butti scattered on a peach ground",
    neckline: "round neck with embroidered yoke",
    sleeveType: "three-quarter sleeves",
    length: "knee length",
    fit: "relaxed",
    silhouette: "straight kurta",
    bottomWearDetails: "pink floral farshi pajama with a 6-inch joined hem and a 4-inch taper, waist pleats and side-joint pleats",
    footwearDetails: "jutti",
    embroidery: "maroon medallion butti and yoke embroidery",
    detailPlacementMap: ["large maroon medallion butti across the kurta body", "yoke embroidery at the neckline"],
    garmentEvidence: [
      {
        region: "body",
        state: "confirmed",
        sourceRole: "front",
        visibleConstruction: "peach kurta with large maroon medallion butti",
        visibleDecoration: "large maroon medallion butti",
        closures: "none",
        explicitlyAbsent: [],
        uncertainty: "none",
      },
    ],
  };
  const creativeDirection = {
    backgroundStyle: "floral wall, cane bench, basket",
    seatedPoseRequired: "yes",
    seatedPoseReason: "style reference includes a cane bench",
  };
  const liveRefs = [
    { role: "front" },
    { role: "back" },
    { role: "bottom" },
    { role: "fabric_pattern" },
    { role: "style_reference" },
    { role: "approved_pose" },
  ];
  const generationMemory = formatGenerationMemoryBrief({
    references: liveRefs,
    memory: buildGenerationMemory({
      references: [...liveRefs, { role: "model_identity" }],
      productIdentity,
      creativeDirection,
      bottomWearMode: "farshi",
      approvedAssets: [{ poseIndex: 1, storagePath: "pose-1.jpg", role: "approved_pose" }],
    }),
  });
  const session = { productIdentity, creativeDirection };
  const pose2 = composeGenerationPrompt({
    skuName: "NISHI-PEACH",
    productDetails: "Peach kurta with large maroon medallion butti and pink floral farshi pajama",
    pose: {
      id: "angled",
      title: "Three-quarter turn",
      poseNumber: 2,
      description: "Walk forward and show the side silhouette",
      cameraAngle: "eye level",
      framing: "full body",
      bodyPosition: "walking stride, one foot lifted",
      handPlacement: "relaxed",
      expression: "calm",
      highlightedDetails: ["medallion butti", "yoke"],
      productVisibilityRules: ["full garment visible", "joined hem closed"],
      purpose: "catalog",
      consistencyNotes: "locked set",
      prompt: "Walk forward and show the side.",
      enabled: true,
    } as any,
    session,
    references: liveRefs,
    generationMemory,
  });
  assertEquals(pose2.length <= IMAGE_PROMPT_SAFE_CHARS, true);
  assertEquals(pose2.includes("[truncated]"), true);
  assertStringIncludes(pose2, "CURRENT FRAME (POSE 2 - MANDATORY 3/4 TURN): Torso and hips MUST physically rotate 35 to 45 degrees. Both feet stay planted and close; never a walking stride or a lifted foot.");
  assertEquals(pose2.includes("Walk forward"), false);
  assertEquals(pose2.includes("one foot lifted"), false);

  const pose4 = composeGenerationPrompt({
    skuName: "NISHI-PEACH",
    productDetails: "Peach kurta with large maroon medallion butti and pink floral farshi pajama",
    pose: {
      id: "creative",
      title: "Editorial",
      poseNumber: 4,
      description: "Dynamic walking motion and swirl",
      cameraAngle: "eye level",
      framing: "full body",
      bodyPosition: "controlled walking movement",
      handPlacement: "relaxed",
      expression: "calm",
      highlightedDetails: ["medallion butti", "yoke"],
      productVisibilityRules: ["full garment visible", "joined hem closed"],
      purpose: "catalog",
      consistencyNotes: "locked set",
      prompt: "Playful walking motion and garment swirl.",
      enabled: true,
    } as any,
    session,
    references: liveRefs,
    generationMemory,
  });
  assertEquals(pose4.length <= IMAGE_PROMPT_SAFE_CHARS, true);
  assertStringIncludes(pose4, "CURRENT FRAME (POSE 4 - SEATED EDITORIAL)");
  assertStringIncludes(pose4, "SEATED EDITORIAL POSE REQUIREMENT (POSE 4):");
  assertStringIncludes(pose4, "POSE CATEGORY RULES (SITTING):");
  assertEquals(pose4.includes("Playful walking motion"), false);
});
