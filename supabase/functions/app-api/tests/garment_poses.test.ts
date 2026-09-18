import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  classifyBottomCut,
  detectGarmentPoseFamily,
  hasBottomWearInAnalysis,
  normalizeBottomWearMode,
  resolveBottomWearPresentation,
} from "../lib/garmentPoses.ts";
import { getPoseSlots, REQUIRED_POSE_IDS, normalizeAnalysis } from "../lib/profiles.ts";
import { composeGenerationPrompt } from "../lib/generationPrompt.ts";

function pose(id: string, poseNumber: number) {
  return {
    id,
    title: `Pose ${poseNumber}`,
    poseNumber,
    description: "test",
    cameraAngle: "eye level",
    framing: "3:4",
    bodyPosition: "standing",
    handPlacement: "relaxed",
    expression: "warm",
    highlightedDetails: [],
    productVisibilityRules: [],
    primaryReference: "front",
    purpose: "test",
    consistencyNotes: "locked",
    prompt: "Generate the frame.",
    enabled: true,
  };
}

Deno.test("a Bengali saree is detected from its weave and drape vocabulary", () => {
  assertEquals(
    detectGarmentPoseFamily({
      productIdentity: { garmentFamily: "saree", fabric: "Tant cotton", pattern: "lal paar red border" },
      category: "saree",
    }),
    "saree_bengali",
  );
  assertEquals(
    detectGarmentPoseFamily({ productIdentity: { garmentFamily: "saree" }, category: "saree" }),
    "saree_ethnic",
  );
  assertEquals(
    detectGarmentPoseFamily({
      productIdentity: { garmentFamily: "saree" },
      category: "saree",
      productDetails: "Jamdani weave from Bengal, aatpoure drape",
    }),
    "saree_bengali",
  );
});

Deno.test("kurta family splits on recorded bottom wear and recorded length", () => {
  assertEquals(
    detectGarmentPoseFamily({
      productIdentity: {
        garmentFamily: "kurta_or_kurti_set",
        bottomWearDetails: "Palazzo, wide straight legs, plain turned hem",
      },
    }),
    "kurta_set",
  );
  assertEquals(
    detectGarmentPoseFamily({
      productIdentity: { garmentFamily: "kurta_or_kurti_set", length: "ankle-length straight", bottomWearDetails: "none - standalone garment" },
    }),
    "long_kurti",
  );
  assertEquals(
    detectGarmentPoseFamily({
      productIdentity: { garmentFamily: "kurta_or_kurti_set", length: "cropped waist-length", bottomWearDetails: "none - standalone garment" },
    }),
    "short_kurti_top",
  );
  assertEquals(
    detectGarmentPoseFamily({ productIdentity: { garmentFamily: "western_or_casual", category: "crop top" } }),
    "short_kurti_top",
  );
});

Deno.test("a co-ord set follows the rest of the garment, not the word itself", () => {
  // An ethnic co-ord is a kurta-family set; a western one must not be.
  assertEquals(
    detectGarmentPoseFamily({
      productIdentity: { garmentFamily: "other", category: "co-ord set", bottomWearDetails: "none - standalone garment", length: "ankle-length" },
    }),
    "long_kurti",
  );
  assertEquals(
    detectGarmentPoseFamily({
      productIdentity: { garmentFamily: "western_or_casual", category: "western co-ord set", bottomWearDetails: "none - standalone garment" },
    }),
    "western_casual",
  );
});

Deno.test("bottom-wear classification reads the positive half of the specification", () => {
  assertEquals(classifyBottomCut("Farshi Pajama, extreme volume; NOT palazzo, NOT lehenga"), "farshi");
  assertEquals(classifyBottomCut("Palazzo, wide straight legs; NOT farshi"), "palazzo");
  assertEquals(classifyBottomCut("Gharara with ruched knee joint"), "sharara_gharara");
  assertEquals(classifyBottomCut("Churidar with ankle churis"), "salwar_churidar");
  assertEquals(classifyBottomCut("Cigarette pants, tailored straight"), "straight_trouser");
  assertEquals(classifyBottomCut("none - standalone garment"), "none");
  assert(hasBottomWearInAnalysis({ bottomWearDetails: "Palazzo in ivory crepe" }));
  assert(!hasBottomWearInAnalysis({ bottomWearDetails: "none - standalone garment" }));
});

Deno.test("the bottom-wear option overrides what the analysis recorded", () => {
  const product = { bottomWearDetails: "Farshi Pajama, magenta silk, large gold bootas" };
  assertEquals(normalizeBottomWearMode("Top Only"), "top_only");
  assertEquals(normalizeBottomWearMode(""), "auto");
  assertEquals(normalizeBottomWearMode("nonsense"), "auto");

  const auto = resolveBottomWearPresentation({ productIdentity: product });
  assertEquals(auto.includesBottomWear, true);
  assertEquals(auto.cutClass, "farshi");
  assertEquals(auto.source, "analysis");

  const topOnly = resolveBottomWearPresentation({ mode: "top_only", productIdentity: product });
  assertEquals(topOnly.includesBottomWear, false);
  assertEquals(topOnly.recordedInAnalysis, true);
  assertEquals(topOnly.details, "");

  const forced = resolveBottomWearPresentation({ mode: "included", productIdentity: { bottomWearDetails: "unknown" } });
  assertEquals(forced.includesBottomWear, true);
});

Deno.test("the pose plan is six ordered frames and the sixth adapts to the garment", () => {
  assertEquals(REQUIRED_POSE_IDS.length, 6);
  assertEquals([...REQUIRED_POSE_IDS], ["full_front", "angled", "back", "creative", "closeup", "showcase"]);

  const saree = getPoseSlots({ productIdentity: { garmentFamily: "saree", fabric: "garad silk" }, category: "saree" });
  assertEquals(saree.length, 6);
  assertEquals(saree[5].id, "showcase");
  assertStringIncludes(saree[5].title, "Pallu");

  const set = getPoseSlots({
    productIdentity: { garmentFamily: "kurta_or_kurti_set", bottomWearDetails: "Palazzo, wide straight legs" },
  });
  assertStringIncludes(set[5].title, "Top & Bottom");

  const top = getPoseSlots({
    productIdentity: { garmentFamily: "kurta_or_kurti_set", length: "cropped", bottomWearDetails: "none - standalone garment" },
  });
  assertStringIncludes(top[5].title, "Playful");
});

Deno.test("normalizeAnalysis always returns the ordered six-pose plan", () => {
  const normalized = normalizeAnalysis({
    productIdentity: { garmentFamily: "kurta_or_kurti_set", bottomWearDetails: "Palazzo, wide legs" },
    posePlan: [{ id: "full_front", title: "Hero" }],
  }, "ethnic/fusion");
  assertEquals(normalized.posePlan.map((entry) => entry.id), [...REQUIRED_POSE_IDS]);
  assertEquals(normalized.posePlan[0].title, "Hero");
});

Deno.test("a saree prompt carries pallu placement grammar and no bottom-wear block", () => {
  const prompt = composeGenerationPrompt({
    skuName: "BENGAL-TANT-01",
    productDetails: "Bengali tant saree with red lal paar border",
    pose: pose("showcase", 6) as never,
    session: {
      category: "saree",
      productIdentity: {
        garmentFamily: "saree",
        fabric: "Tant cotton",
        sareeTruth: { body: { baseColor: "ivory" } },
        sareeDrapePlan: { baseDrapeFamily: "aatpoure", shoulderSide: "left" },
      },
    },
    references: [{ role: "saree_front_drape" }, { role: "saree_pallu_spread" }],
  });
  assertStringIncludes(prompt, "GARMENT POSE GRAMMAR (SAREE BENGALI)");
  assertStringIncludes(prompt, "PALLU (AANCHAL) PLACEMENT");
  assertStringIncludes(prompt, "SHOWCASE FRAME HARD RULE (DRAPE-LED)");
  assertEquals(prompt.includes("LOCKED BOTTOM WEAR ARCHITECTURE"), false);
  assertEquals(prompt.includes("TOP-ONLY PRODUCT"), false);
});

Deno.test("a kurta set showcase frame demands top and bottom in one frame", () => {
  const prompt = composeGenerationPrompt({
    skuName: "KURTA-SET-01",
    productDetails: "Kurta set with palazzo",
    pose: pose("showcase", 6) as never,
    session: {
      productIdentity: {
        garmentFamily: "kurta_or_kurti_set",
        bottomWearDetails: "Palazzo, wide straight legs, plain turned hem; NOT farshi",
      },
    },
    references: [{ role: "front" }, { role: "back" }],
  });
  assertStringIncludes(prompt, "GARMENT POSE GRAMMAR (KURTA SET)");
  assertStringIncludes(prompt, "SHOWCASE FRAME HARD RULE (COMPLETE SET)");
  assertStringIncludes(prompt, "LOCKED BOTTOM WEAR ARCHITECTURE");
  assertStringIncludes(prompt, "PALAZZO HARD LOCK");
  // Only the guard for the recorded cut is sent.
  assertEquals(prompt.includes("FARSHI / FARSI HARD LOCK"), false);
  assertEquals(prompt.includes("SHARARA / GHARARA HARD LOCK"), false);
});

Deno.test("a top-only shoot never invents matching bottom wear", () => {
  const session = {
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      length: "cropped waist-length",
      bottomWearDetails: "Palazzo, wide straight legs, matching print",
    },
    bottomWearMode: "top_only",
  };
  const prompt = composeGenerationPrompt({
    skuName: "SHORT-KURTI-01",
    productDetails: "Short kurti",
    pose: pose("showcase", 6) as never,
    session,
    references: [{ role: "front" }, { role: "back" }],
  });
  assertStringIncludes(prompt, "TOP-ONLY PRODUCT - DO NOT INVENT A MATCHING SET:");
  assertStringIncludes(prompt, "The shoot was configured as TOP ONLY.");
  assertStringIncludes(prompt, "ABSOLUTE PROHIBITION ON INVENTING A MATCHING SET");
  assertEquals(prompt.includes("LOCKED BOTTOM WEAR ARCHITECTURE"), false);
  assertEquals(prompt.includes("ABSOLUTE PROHIBITION ON BOTTOM WEAR SUBSTITUTION"), false);
  // The locked-product snapshot must not still carry the recorded bottom-wear
  // specification, or it would contradict the top-only instruction.
  assertEquals(prompt.includes("bottomWearDetails"), false);
  assertEquals(prompt.includes("matching print"), false);
});

Deno.test("a top-only true-back frame also drops the recorded bottom-wear specification", () => {
  const prompt = composeGenerationPrompt({
    skuName: "SHORT-KURTI-01",
    productDetails: "Short kurti",
    pose: pose("back", 3) as never,
    session: {
      productIdentity: {
        garmentFamily: "kurta_or_kurti_set",
        bottomWearDetails: "Palazzo, wide straight legs, matching print",
        garmentEvidence: [{ region: "back body", state: "confirmed", sourceRole: "back", visibleConstruction: "plain panel" }],
      },
      bottomWearMode: "top_only",
    },
    references: [{ role: "back" }],
  });
  assertEquals(prompt.includes("bottomWearDetails"), false);
  assertStringIncludes(prompt, "TOP-ONLY PRODUCT - DO NOT INVENT A MATCHING SET:");
});

Deno.test("a standalone top gets playful, set-matched showcase direction without an invented bottom", () => {
  const prompt = composeGenerationPrompt({
    skuName: "TOP-01",
    productDetails: "Crop top",
    pose: pose("showcase", 6) as never,
    session: {
      productIdentity: {
        garmentFamily: "western_or_casual",
        category: "top",
        length: "cropped",
        bottomWearDetails: "none - standalone garment",
      },
    },
    references: [{ role: "front" }, { role: "back" }, { role: "style_reference" }],
  });
  assertStringIncludes(prompt, "GARMENT POSE GRAMMAR (SHORT KURTI TOP)");
  assertStringIncludes(prompt, "MATCH THE POSE TO THE SET");
  assertStringIncludes(prompt, "SHOWCASE FRAME HARD RULE (PLAYFUL, SET-MATCHED)");
  assertStringIncludes(prompt, "The product references prove no bottom garment ships with this SKU.");
});

Deno.test("a top-only kurta set never gets a complete-set showcase rule", () => {
  const prompt = composeGenerationPrompt({
    skuName: "KURTA-SET-01",
    productDetails: "Kurta set with palazzo",
    pose: pose("showcase", 6) as never,
    session: {
      productIdentity: {
        garmentFamily: "kurta_or_kurti_set",
        bottomWearDetails: "Palazzo, wide straight legs; NOT farshi",
      },
      // The analysis wrote a complete-set brief before the shoot was configured.
      creativeDirection: { showcaseIntent: "set_full_length" },
      bottomWearMode: "top_only",
    },
    references: [{ role: "front" }],
  });
  assertEquals(prompt.includes("SHOWCASE FRAME HARD RULE (COMPLETE SET)"), false);
  assertStringIncludes(prompt, "SHOWCASE FRAME HARD RULE (TRUE FALL AND LENGTH)");
  assertStringIncludes(prompt, "THIS SECTION OUTRANKS THE POSE BRIEF");
});

Deno.test("a saree recognised only by category still gets no bottom-wear block", () => {
  // garmentFamily never resolved past the broad category, so the exact match is
  // false while the pose taxonomy still reads this as a saree.
  const prompt = composeGenerationPrompt({
    skuName: "SAREE-01",
    productDetails: "Traditional silk saree",
    pose: pose("full_front", 1) as never,
    session: {
      category: "saree",
      productIdentity: { garmentFamily: "unknown", category: "saree", bottomWearDetails: "none - standalone garment" },
    },
    references: [{ role: "front" }, { role: "back" }],
  });
  assertStringIncludes(prompt, "GARMENT POSE GRAMMAR (SAREE ETHNIC)");
  assertEquals(prompt.includes("TOP-ONLY PRODUCT"), false);
  assertEquals(prompt.includes("ABSOLUTE PROHIBITION ON INVENTING A MATCHING SET"), false);
  assertEquals(prompt.includes("LOCKED BOTTOM WEAR ARCHITECTURE"), false);
});

Deno.test("an explicit top-only mode also rewrites the stored sixth-frame brief", () => {
  const productIdentity = {
    garmentFamily: "kurta_or_kurti_set",
    bottomWearDetails: "Palazzo, wide straight legs, matching print",
  };
  const withBottoms = getPoseSlots({ productIdentity });
  assertStringIncludes(withBottoms[5].title, "Top & Bottom");

  const topOnly = getPoseSlots({ productIdentity, bottomWearMode: "top_only" });
  assertEquals(topOnly[5].title.includes("Top & Bottom"), false);
  assertEquals(
    topOnly[5].productVisibilityRules.some((rule) => rule.includes("waistband")),
    false,
  );
});

Deno.test("an explicit recorded showcase intent outranks the inferred one", () => {
  const prompt = composeGenerationPrompt({
    skuName: "KURTI-01",
    productDetails: "Long kurti",
    pose: pose("showcase", 6) as never,
    session: {
      productIdentity: { garmentFamily: "kurta_or_kurti_set", length: "ankle-length", bottomWearDetails: "none - standalone garment" },
      creativeDirection: { showcaseIntent: "playful_backdrop" },
    },
    references: [{ role: "front" }],
  });
  assertStringIncludes(prompt, "SHOWCASE FRAME HARD RULE (PLAYFUL, SET-MATCHED)");
});
