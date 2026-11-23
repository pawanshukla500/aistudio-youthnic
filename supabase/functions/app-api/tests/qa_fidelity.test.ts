import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { normalizeAnalysis, normalizePoseAspectText, sanitizePoseDirectionForAspectRatio } from "../lib/profiles.ts";
import { buildPoseQaPrompt, canSalvageExhaustedPoseQa, hasAnatomicalDefectText, normalizePoseQaResult } from "../lib/qa.ts";

const genericCritical = [
  "garment_identity",
  "colors",
  "print_pattern",
  "pattern_geometry",
  "embroidery_geometry",
  "detail_placement",
  "absence_constraints",
  "side_construction",
  "trim_location",
  "unknown_region_invention",
  "print_embroidery_continuation",
];

Deno.test("unknown-region invention itself fails otherwise complete generic QA", () => {
  const normalized = normalizeAnalysis({
    productIdentity: {
      category: "ethnic/fusion",
      garmentEvidence: [
        { region: "front hem", state: "confirmed", visibleDecoration: "gold lace trim" },
        { region: "left side construction", state: "unknown", uncertainty: "Unproven." },
      ],
    },
  }, "ethnic/fusion");
  assertEquals(
    normalized.productIdentity.garmentEvidence.find((e) => e.region === "left side construction")?.state,
    "unknown",
  );

  const checks = Object.fromEntries(genericCritical.map((key) => [key, key === "unknown_region_invention" ? "fail" : "pass"]));
  const scores = Object.fromEntries(genericCritical.map((key) => [key, key === "unknown_region_invention" ? 40 : 100]));
  const result = normalizePoseQaResult({
    pass: true,
    score: 98,
    checks,
    scores,
    failed: ["unknown_region_invention"],
    reason: "A side slit and trim were invented in the unknown region.",
    correction: "Keep the side in plain base fabric.",
  }, { garmentFamily: "dress" });

  assertEquals(result.pass, false);
  assertEquals(result.failed, ["unknown_region_invention"]);
  assert(result.productFidelity > 90, "The test must prove the named critical gate, not an unrelated low average.");
});

Deno.test("back-pose QA treats the direct rear reference as a veto for front-only lace", () => {
  const prompt = buildPoseQaPrompt({
    poseNumber: 3,
    poseType: "back",
    poseTitle: "True back",
    poseDirection: { id: "back", title: "True back" },
    productIdentity: {
      frontConstruction: "front-lace-marker",
      garmentEvidence: [
        { region: "front hem", sourceRole: "front", state: "confirmed", visibleDecoration: "front-lace-marker" },
        { region: "back hem", sourceRole: "back", state: "confirmed_absent", visibleDecoration: "rear-plain-marker" },
      ],
    },
    creativeDirection: {},
    modelIdentity: {},
    garmentFamily: "ethnic/fusion",
    consistencyRules: [],
    hasApprovedAnchor: false,
    hasModelReference: false,
    referenceManifest: ["IMAGE 1: Back product"],
  });
  assertStringIncludes(prompt, "uploaded BACK/REAR product reference as a veto");
  assertStringIncludes(prompt, "front-only lace");
  assertStringIncludes(prompt, "rear-plain-marker");
  assertEquals(prompt.includes("front-lace-marker"), false);
});

Deno.test("a true-back front_back_design score below 90 fails, while 90-94 requires human review", () => {
  const backCritical = [...genericCritical, "front_back_design"];
  const verdict = (score: number) => ({
    pass: true,
    score: 99,
    checks: Object.fromEntries(backCritical.map((key) => [key, "pass"])),
    scores: Object.fromEntries(backCritical.map((key) => [key, key === "front_back_design" ? score : 100])),
    failed: [],
    reason: "Rear construction compared with the direct uploaded rear reference.",
    correction: "",
  });

  const rejected = normalizePoseQaResult(verdict(88), { garmentFamily: "dress", poseType: "back" });
  assertEquals(rejected.pass, false);
  assertEquals(rejected.outcome, "rejected_by_qa");
  assert(rejected.failed.includes("front_back_design"));

  const review = normalizePoseQaResult(verdict(92), { garmentFamily: "dress", poseType: "back" });
  assertEquals(review.pass, true);
  assertEquals(review.outcome, "requires_human_review");
  assertEquals(review.automaticallyVerified, false);
});

Deno.test("missing or miniaturized bottom print fails QA even when face and kurta score high", () => {
  const prompt = buildPoseQaPrompt({
    poseNumber: 1,
    poseType: "full_front",
    poseTitle: "Hero",
    poseDirection: { id: "full_front", title: "Hero" },
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      bottomWearDetails: "Farshi pajama, magenta silk, bold large-scale gold floral bootas; NOT palazzo, NOT solid",
    },
    creativeDirection: {},
    modelIdentity: {},
    garmentFamily: "kurta_or_kurti_set",
    consistencyRules: [],
    hasApprovedAnchor: false,
    hasModelReference: false,
    referenceManifest: ["IMAGE 1: Front product", "IMAGE 2: Fabric / pattern detail", "IMAGE 3: Bottom wear / farshi"],
  });
  assertStringIncludes(prompt, "bottom_wear: when a separate bottom garment is recorded, this is SKU-critical");
  assertStringIncludes(prompt, "large-scale florals/bootas become solid color, faint dots");
  assertStringIncludes(prompt, "Farshi/farsi pajama is flattened into palazzo");
  assertStringIncludes(prompt, "never against an upper-only fabric close-up");
  assertStringIncludes(prompt, "hem panel 6 inches wide is joined");
  assertStringIncludes(prompt, "Do not fail the joined 6-inch hem panel itself");

  const keys = [...genericCritical, "bottom_wear"];
  const result = normalizePoseQaResult({
    pass: true,
    score: 97,
    checks: Object.fromEntries(keys.map((key) => [key, key === "bottom_wear" ? "fail" : "pass"])),
    scores: Object.fromEntries(keys.map((key) => [key, key === "bottom_wear" ? 40 : 98])),
    failed: ["bottom_wear"],
    reason: "Bottoms are solid magenta palazzo; gold florals missing.",
    correction: "Rebuild the farshi pajama print and volume from the bottom-wear reference.",
  }, {
    garmentFamily: "kurta_or_kurti_set",
    poseType: "full_front",
    hasBottomWear: true,
  });

  assertEquals(result.pass, false);
  assertEquals(result.outcome, "rejected_by_qa");
  assert(result.failed.includes("bottom_wear"));
  assert(result.productFidelity > 90, "A high kurta/face average must not hide a failed bottom.");
});

Deno.test("auto mode includes bottom_wear checks when bottom reference is present without bottom wear text", () => {
  const prompt = buildPoseQaPrompt({
    poseNumber: 1,
    poseType: "full_front",
    poseTitle: "Hero",
    poseDirection: { id: "full_front", title: "Hero" },
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      skuName: "KURTI-FASI-SALWAR-SET",
    },
    creativeDirection: {},
    modelIdentity: {},
    garmentFamily: "kurta_or_kurti_set",
    consistencyRules: [],
    hasApprovedAnchor: false,
    hasModelReference: false,
    bottomWearMode: "auto",
    referenceManifest: ["IMAGE 1: FRONT PRODUCT", "IMAGE 2: BOTTOM PRODUCT REFERENCE"],
  });
  assertStringIncludes(prompt, "bottom_wear: when a separate bottom garment is recorded, this is SKU-critical");
  assertStringIncludes(prompt, "When the bottom is Farshi/Farsi/Fasi, also fail bottom_wear unless the worn trousers match this structure");

  const normalized = normalizePoseQaResult({
    pass: true,
    score: 95,
    checks: Object.fromEntries([...genericCritical, "bottom_wear"].map((key) => [key, "pass"])),
    scores: Object.fromEntries([...genericCritical, "bottom_wear"].map((key) => [key, 95])),
    failed: [],
    reason: "Passed all checks",
    correction: "",
  }, {
    garmentFamily: "kurta_or_kurti_set",
    poseType: "full_front",
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      skuName: "KURTI-FASI-SALWAR-SET",
    },
    bottomWearMode: "auto",
    hasBottomReference: true,
  });
  assertEquals(normalized.pass, true);
  assertEquals(normalized.checks.bottom_wear, "pass");
});

Deno.test("close-up QA does not treat bottom_wear as critical when trousers are cropped out", () => {
  const result = normalizePoseQaResult({
    pass: true,
    score: 98,
    checks: Object.fromEntries(genericCritical.map((key) => [key, "pass"])),
    scores: Object.fromEntries(genericCritical.map((key) => [key, 98])),
    failed: [],
    reason: "Close-up matches face and kurta embroidery.",
    correction: "",
  }, {
    garmentFamily: "kurta_or_kurti_set",
    poseType: "closeup",
    hasBottomWear: true,
  });
  assertEquals(result.pass, true);
  assertEquals(result.automaticallyVerified, true);
});

Deno.test("creative editorial QA does not treat bottom_wear as critical when trousers can be cropped out", () => {
  const result = normalizePoseQaResult({
    pass: true,
    score: 98,
    checks: Object.fromEntries(genericCritical.map((key) => [key, "pass"])),
    scores: Object.fromEntries(genericCritical.map((key) => [key, 98])),
    failed: [],
    reason: "Creative three-quarter crop matches face and kurta.",
    correction: "",
  }, {
    garmentFamily: "kurta_or_kurti_set",
    poseType: "creative",
    hasBottomWear: true,
  });
  assertEquals(result.pass, true);
  assertEquals(result.automaticallyVerified, true);
});

Deno.test("close-up QA requires a large product detail and can omit the face in product-detail mode", () => {
  const faceAndDetail = buildPoseQaPrompt({
    poseNumber: 5,
    poseType: "closeup",
    poseTitle: "Product highlight",
    poseDirection: { id: "closeup", title: "Product highlight" },
    productIdentity: { embroidery: "yoke lattice" },
    creativeDirection: { closeupMode: "face_and_detail", closeupHeroDetail: "square yoke embroidery lattice" },
    modelIdentity: {},
    garmentFamily: "ethnic/fusion",
    consistencyRules: [],
    hasApprovedAnchor: false,
    hasModelReference: false,
    referenceManifest: ["IMAGE 1: Front product"],
  });
  assertStringIncludes(faceAndDetail, "face-and-product-detail close-up: square yoke embroidery lattice");
  assertStringIncludes(faceAndDetail, "tiny sliver of embroidery under a beauty close-up is a fail");

  const productDetail = buildPoseQaPrompt({
    poseNumber: 5,
    poseType: "closeup",
    poseTitle: "Product highlight",
    poseDirection: { id: "closeup", title: "Product highlight", productVisibilityRules: ["face optional"] },
    productIdentity: { embroidery: "pallu border" },
    creativeDirection: { closeupMode: "product_detail", closeupHeroDetail: "pallu border artwork" },
    modelIdentity: {},
    garmentFamily: "ethnic/fusion",
    consistencyRules: [],
    hasApprovedAnchor: false,
    hasModelReference: true,
    referenceManifest: ["IMAGE 1: Front product", "IMAGE 2: Model face"],
  });
  assertStringIncludes(productDetail, "product-detail-first close-up: pallu border artwork");
  assertStringIncludes(productDetail, "Do NOT fail pose_requirement merely because the face is cropped out");
  assertStringIncludes(productDetail, "Pass model_face when no recognizable face is in frame");
  assertStringIncludes(productDetail, "apply only when a recognizable face is in frame");
  assertStringIncludes(productDetail, "pass face_realism and model_face");
});

Deno.test("QA applies the Farshi hem structure only when the bottom is Farshi", () => {
  const palazzo = buildPoseQaPrompt({
    poseNumber: 1,
    poseType: "full_front",
    poseTitle: "Hero",
    poseDirection: { id: "full_front", title: "Hero" },
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      bottomWearDetails: "Palazzo, wide straight legs; NOT farshi",
    },
    creativeDirection: {},
    modelIdentity: {},
    garmentFamily: "kurta_or_kurti_set",
    consistencyRules: [],
    hasApprovedAnchor: false,
    hasModelReference: false,
    referenceManifest: ["IMAGE 1: Front product"],
  });
  assertEquals(palazzo.includes("hem panel 6 inches wide"), false);
  assertEquals(palazzo.includes("Do not fail the joined 6-inch hem panel"), false);
});

Deno.test("Pose 6 showcase QA enforces heroFeature non-duplication and exempts bottom_wear and full face on upper macro_detail crops", () => {
  const creativeDirection = {
    closeupHeroDetail: "neckline zari yoke",
    showcasePlan: {
      heroFeature: "mirror-work bell sleeve cuff",
      featureRegion: "sleeve",
      shotType: "macro_detail",
    },
  };
  const prompt = buildPoseQaPrompt({
    poseNumber: 6,
    poseType: "showcase",
    poseTitle: "Sleeve Cuff Showcase",
    poseDirection: { id: "showcase", title: "Sleeve Cuff Showcase" },
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      bottomWearDetails: "Palazzo, wide straight legs",
    },
    creativeDirection,
    modelIdentity: {},
    garmentFamily: "kurta_or_kurti_set",
    consistencyRules: [],
    hasApprovedAnchor: true,
    hasModelReference: true,
    referenceManifest: ["IMAGE 1: Fabric / pattern detail", "IMAGE 2: Front product"],
  });

  assertStringIncludes(prompt, "For pose 6 (garment-led feature showcase: mirror-work bell sleeve cuff [sleeve / macro_detail])");
  assertStringIncludes(prompt, "This pose 6 macro_detail showcase crop may omit the face.");

  const result = normalizePoseQaResult({
    pass: true,
    score: 98,
    checks: Object.fromEntries(genericCritical.map((key) => [key, "pass"])),
    scores: Object.fromEntries(genericCritical.map((key) => [key, 98])),
    failed: [],
    reason: "Sleeve cuff macro showcase matches product reference.",
    correction: "",
  }, {
    garmentFamily: "kurta_or_kurti_set",
    poseType: "showcase",
    hasBottomWear: true,
    creativeDirection,
  });
  assertEquals(result.pass, true);
  assertEquals(result.automaticallyVerified, true);
});

Deno.test("Pose 6 macro QA applies the anatomy veto even when the face is absent", () => {
  const creativeDirection = {
    showcasePlan: {
      heroFeature: "mirror-work bell sleeve cuff",
      featureRegion: "sleeve",
      shotType: "macro_detail",
    },
  };
  const prompt = buildPoseQaPrompt({
    poseNumber: 6,
    poseType: "showcase",
    poseTitle: "Sleeve Cuff Showcase",
    poseDirection: { id: "showcase", title: "Sleeve Cuff Showcase" },
    productIdentity: { garmentFamily: "kurta_or_kurti_set" },
    creativeDirection,
    modelIdentity: {},
    garmentFamily: "kurta_or_kurti_set",
    consistencyRules: [],
    hasApprovedAnchor: true,
    hasModelReference: false,
    referenceManifest: ["IMAGE 1: Fabric / pattern detail"],
  });
  assertStringIncludes(prompt, "ANATOMICAL REALISM - apply to every pose and every crop");
  assertStringIncludes(prompt, "Fail pose_requirement for THREE HANDS, EXTRA HANDS, EXTRA ARMS");
  assertStringIncludes(prompt, "This anatomy veto is independent of face visibility");
  assertStringIncludes(prompt, "not a pose to repeat and not handheld props");

  const result = normalizePoseQaResult({
    pass: true,
    score: 98,
    checks: { pose_requirement: "fail", model_face: "pass", face_realism: "pass" },
    scores: { pose_requirement: 40, model_face: 100, face_realism: 100 },
    failed: ["pose_requirement"],
    reason: "A duplicate hand is visible beside the sleeve cuff.",
    correction: "Remove the duplicate hand and restore one continuous forearm connection.",
  }, {
    garmentFamily: "kurta_or_kurti_set",
    poseType: "showcase",
    hasBottomWear: false,
    creativeDirection,
  });
  assertEquals(result.pass, false);
  assertEquals(result.automaticallyVerified, false);
  assertEquals(result.failed.includes("pose_requirement"), true);
});

Deno.test("buildPoseQaPrompt normalizes upstream square framing for 3:4 portrait while keeping square neckline craft and subtle style-reference earrings/bindi", () => {
  const prompt = buildPoseQaPrompt({
    poseNumber: 1,
    poseType: "full_front",
    poseTitle: "Front Hero",
    poseDirection: {
      id: "full_front",
      framing: "Square, unobstructed head to toe.",
      bodyPosition: "Square to camera.",
      prompt: "Photorealistic square head-to-toe fashion photograph showcasing the square neckline yoke.",
    },
    productIdentity: { garmentFamily: "saree_ethnic", mainColor: "teal" },
    creativeDirection: {},
    modelIdentity: {},
    garmentFamily: "saree_ethnic",
    consistencyRules: [],
    hasApprovedAnchor: false,
    hasModelReference: false,
    referenceManifest: [
      "IMAGE 1: SAREE FRONT DRAPE",
      "IMAGE 2: STYLE REFERENCE - backdrop, wall, floor, set dressing, mood and lighting only; never copy clothing or pose",
    ],
    aspectRatio: "3:4",
  });

  assertStringIncludes(prompt, "Requested Output Aspect Ratio: 3:4 (vertical portrait canvas");
  assertStringIncludes(prompt, "Straight-on, unobstructed head to toe.");
  assertStringIncludes(prompt, "Straight-on toward camera.");
  assertStringIncludes(prompt, "3:4 portrait head-to-toe");
  assertStringIncludes(prompt, "square neckline yoke");
  assertEquals(prompt.includes("Square, unobstructed"), false);
  assertStringIncludes(prompt, "Do NOT fail absence_constraints or details_and_branding for stylist-worn personal accessories");
  assertStringIncludes(prompt, "subtle personal accents consistent with the STYLE REFERENCE (such as small stud/minimal earrings, a small forehead bindi");

  assertEquals(normalizePoseAspectText("Square, unobstructed head to toe.", "1:1"), "Square, unobstructed head to toe.");
  const unchanged1x1 = sanitizePoseDirectionForAspectRatio({ framing: "Square, unobstructed" }, "1:1");
  assertEquals(unchanged1x1.framing, "Square, unobstructed");
});

Deno.test("saree 25-check QA only flags flat-cluster escalation when at least 18 critical scores cluster below 95", () => {
  const sareeChecksList = [
    "garment_identity", "colors", "pattern_geometry", "print_pattern", "embroidery_geometry",
    "detail_placement", "side_construction", "trim_location", "unknown_region_invention",
    "print_embroidery_continuation", "front_back_design", "absence_constraints", "bottom_wear",
    "body_pallu_boundary", "duplicate_pallu", "drape_physics", "blouse_invention",
    "saree_body_color", "saree_weave_geometry", "saree_motif_inventory", "saree_motif_scale",
    "saree_motif_placement", "saree_pallu_artwork", "saree_border_geometry", "saree_tassels",
    "saree_blouse_construction", "saree_transparency_shine", "saree_drape_physics", "face_realism", "model_face",
  ];
  const normalPassScores: Record<string, number> = {};
  sareeChecksList.forEach((key, idx) => {
    normalPassScores[key] = idx < 12 ? 94 : 96;
  });
  const normalResult = normalizePoseQaResult({
    pass: true,
    score: 95,
    checks: Object.fromEntries(sareeChecksList.map((k) => [k, "pass"])),
    scores: normalPassScores,
    failed: [],
    reason: "Accurate teal ikat saree.",
    correction: "",
  }, { garmentFamily: "saree", poseType: "full_front" });
  assertEquals(normalResult.requiresIndependentRecheck, false);

  const flatScores = Object.fromEntries(sareeChecksList.map((k) => [k, 93]));
  const flatResult = normalizePoseQaResult({
    pass: true,
    score: 93,
    checks: Object.fromEntries(sareeChecksList.map((k) => [k, "pass"])),
    scores: flatScores,
    failed: [],
    reason: "Hedged flat scores.",
    correction: "",
  }, { garmentFamily: "saree", poseType: "full_front" });
  assertEquals(flatResult.requiresIndependentRecheck, true);
});

Deno.test("canSalvageExhaustedPoseQa rescues borderline high-fidelity frames while strictly vetoing anatomy, identity, back, and bottom defects", () => {
  const baseQa = {
    productFidelity: 93,
    scores: {
      pose_requirement: 85,
      fit_silhouette: 86,
      absence_constraints: 78,
      styling_addition: 80,
      garment_identity: 98,
      pattern_geometry: 95,
      saree_body_color: 96,
      face_realism: 94,
    },
    failed: ["pose_requirement", "absence_constraints", "styling_addition"],
    severe: [] as string[],
    reason: "Portrait orientation differed from requested square wording and subtle stud earrings appeared.",
    correction: "",
  };
  assertEquals(canSalvageExhaustedPoseQa(baseQa, { garmentFamily: "saree_ethnic", poseType: "full_front" }), true);

  assertEquals(
    canSalvageExhaustedPoseQa({ ...baseQa, reason: "Three hands visible on waist." }, { garmentFamily: "saree_ethnic", poseType: "full_front" }),
    false,
  );
  assertEquals(
    canSalvageExhaustedPoseQa({ ...baseQa, failed: ["garment_identity"] }, { garmentFamily: "saree_ethnic", poseType: "full_front" }),
    false,
  );
  assertEquals(
    canSalvageExhaustedPoseQa({ ...baseQa, failed: ["blouse_invention"] }, { garmentFamily: "saree_ethnic", poseType: "full_front" }),
    false,
  );
  assertEquals(
    canSalvageExhaustedPoseQa({ ...baseQa, failed: ["duplicate_pallu"] }, { garmentFamily: "saree_ethnic", poseType: "full_front" }),
    false,
  );
  assertEquals(
    canSalvageExhaustedPoseQa(
      { ...baseQa, scores: { ...baseQa.scores, front_back_design: 72 } },
      { garmentFamily: "saree_ethnic", poseType: "back" },
    ),
    false,
  );
  assertEquals(
    canSalvageExhaustedPoseQa(
      { ...baseQa, scores: { ...baseQa.scores, bottom_wear: 70 } },
      { garmentFamily: "kurta_or_kurti_set", poseType: "full_front", hasBottomWear: true },
    ),
    false,
  );
  assertEquals(
    canSalvageExhaustedPoseQa({ ...baseQa, productFidelity: 84 }, { garmentFamily: "saree_ethnic", poseType: "full_front" }),
    false,
  );
});

Deno.test("normalizePoseQaResult retains structured anatomy defect flag beyond 500-char reason truncation so salvage rejects it", () => {
  const longReason = `${"A".repeat(560)} An extra third hand appears near the pleats.`;
  const normalized = normalizePoseQaResult({
    pass: false,
    score: 96,
    checks: {
      ...Object.fromEntries(genericCritical.map((k) => [k, "pass"])),
      pose_requirement: "pass",
    },
    scores: {
      ...Object.fromEntries(genericCritical.map((k) => [k, 98])),
      pose_requirement: 85,
    },
    failed: [],
    reason: longReason,
    correction: "",
  }, { garmentFamily: "kurta_or_kurti_set", poseType: "full_front" });

  assertEquals(normalized.anatomicalDefectDetected, true);
  assertEquals(normalized.scores.pose_requirement, 40);
  assertEquals(hasAnatomicalDefectText(normalized.reason), false);
  assertEquals(
    canSalvageExhaustedPoseQa(normalized, { garmentFamily: "kurta_or_kurti_set", poseType: "full_front" }),
    false,
  );
});

Deno.test("landscape 16:9 ratio uses landscape orientation in normalizePoseAspectText and buildPoseQaPrompt instead of portrait", () => {
  const qaPrompt16x9 = buildPoseQaPrompt({
    poseNumber: 1,
    poseType: "full_front",
    poseTitle: "Wide Editorial",
    poseDirection: {
      id: "full_front",
      framing: "Square, unobstructed head to toe.",
      prompt: "Photorealistic square head-to-toe shot.",
    },
    productIdentity: { garmentFamily: "kurta_or_kurti_set" },
    creativeDirection: {},
    modelIdentity: {},
    garmentFamily: "kurta_or_kurti_set",
    consistencyRules: [],
    hasApprovedAnchor: false,
    hasModelReference: false,
    referenceManifest: ["IMAGE 1: FRONT"],
    aspectRatio: "16:9",
  });

  assertStringIncludes(qaPrompt16x9, "Requested Output Aspect Ratio: 16:9 (landscape canvas - evaluate full-body framing in 16:9 landscape orientation");
  assertStringIncludes(qaPrompt16x9, "16:9 landscape head-to-toe");
  assertEquals(qaPrompt16x9.includes("16:9 portrait"), false);
  assertEquals(qaPrompt16x9.includes("vertical portrait"), false);
});

Deno.test("hasAnatomicalDefectText detects positive defect mentions and respects negative phrases", () => {
  // Happy path: no defects mentioned
  assertEquals(hasAnatomicalDefectText("Model looks natural with relaxed arms."), false);
  // Edge case: negated defect phrases
  assertEquals(hasAnatomicalDefectText("Zero extra hands detected, clean natural two hands."), false);
  assertEquals(hasAnatomicalDefectText("No floating hand or duplicate wrist present."), false);
  assertEquals(hasAnatomicalDefectText("Image is free of extra limbs and malformed fingers."), false);
  // Failure modes: positive defect mentions
  assertEquals(hasAnatomicalDefectText("Three hands visible resting on waist and hip."), true);
  assertEquals(hasAnatomicalDefectText("An extra hand appears holding the dupatta."), true);
  assertEquals(hasAnatomicalDefectText("A floating hand is resting on the pleats."), true);
  assertEquals(hasAnatomicalDefectText("Six fingers detected on right hand."), true);
  assertEquals(hasAnatomicalDefectText("No extra limbs on the left, but extra hands appear near the waist."), true);
  assertEquals(hasAnatomicalDefectText("Model has no extra fingers but a third hand appears near the drape."), true);
  assertEquals(hasAnatomicalDefectText("Hand area is not free of duplicate wrists."), true);
  assertEquals(hasAnatomicalDefectText("No extra hands, malformed fingers, or phantom limbs."), false);
  assertEquals(hasAnatomicalDefectText("The image is not without flaws and has no extra hands."), false);
  assertEquals(hasAnatomicalDefectText("Zero extra limbs, silhouette is accurate."), false);
});

Deno.test("normalizePoseQaResult vetoes image when reason describes anatomical duplication despite pass=true", () => {
  const result = normalizePoseQaResult({
    pass: true,
    score: 98,
    checks: Object.fromEntries(genericCritical.map((key) => [key, "pass"])),
    scores: Object.fromEntries(genericCritical.map((key) => [key, 98])),
    failed: [],
    reason: "Fabric and embroidery match reference, but three hands are visible on the model's waist.",
    correction: "Ensure model has strictly two arms and two hands.",
  }, {
    garmentFamily: "kurta_or_kurti_set",
    poseType: "full_front",
  });

  assertEquals(result.pass, false);
  assertEquals(result.outcome, "rejected_by_qa");
  assertEquals(result.failed.includes("pose_requirement"), true);
  assertEquals(result.scores.pose_requirement, 0);
  assertStringIncludes(result.reason, "pose_requirement");
});

Deno.test("buildPoseQaPrompt allows minor embroidery variation on stylist-added footwear and camera-distance softening on full-body frames", () => {
  const prompt = buildPoseQaPrompt({
    poseNumber: 1,
    poseType: "full_front",
    poseTitle: "Hero Front",
    poseDirection: { id: "full_front", title: "Hero Front" },
    productIdentity: { garmentFamily: "kurta_or_kurti_set" },
    creativeDirection: {},
    modelIdentity: {},
    garmentFamily: "kurta_or_kurti_set",
    consistencyRules: [],
    hasApprovedAnchor: false,
    hasModelReference: true,
    referenceManifest: ["IMAGE 1: MODEL FACE REFERENCE", "IMAGE 2: FRONT PRODUCT"],
  });
  assertStringIncludes(prompt, "allowing normal camera-distance softening");
  assertStringIncludes(prompt, "do NOT fail styling_addition or unexpected_changes merely for minor embroidery density variations");
  assertStringIncludes(prompt, "within the approved footwear family");
});

Deno.test("buildPoseQaPrompt adds floor-length footwear, above-ankle crop, back hair, and wide saree weave calibration", () => {
  const croppedPose4Qa = buildPoseQaPrompt({
    poseNumber: 4,
    poseType: "creative",
    poseTitle: "Editorial Contrapposto",
    poseDirection: {
      id: "creative",
      title: "Editorial Contrapposto",
      framing: "Portrait, approximately knees-up with room for shoulder fall.",
      bodyPosition: "Stand in gentle contrapposto with feet grounded and close.",
    },
    productIdentity: { garmentFamily: "saree", mainColor: "deep pink" },
    creativeDirection: {},
    modelIdentity: {},
    garmentFamily: "saree",
    consistencyRules: [],
    hasApprovedAnchor: true,
    hasModelReference: false,
    referenceManifest: [
      "IMAGE 1: SAREE FRONT FULL DRAPE PRODUCT",
      "IMAGE 2: SAREE BODY WEAVE MACRO",
      "IMAGE 3: STYLE REFERENCE",
      "IMAGE 4: APPROVED POSE 1",
    ],
  });
  assertStringIncludes(croppedPose4Qa, "ABOVE-ANKLE CROP EXEMPTION:");
  assertStringIncludes(croppedPose4Qa, "hidden underneath a floor-length saree");
  assertStringIncludes(croppedPose4Qa, "compare across BOTH full-drape product images AND any close-up fabric swatches");
  assertEquals(/feet grounded/i.test(croppedPose4Qa), false);

  const backQa = buildPoseQaPrompt({
    poseNumber: 3,
    poseType: "back",
    poseTitle: "True Back View",
    poseDirection: { id: "back", title: "True Back View", framing: "Full body rear view." },
    productIdentity: { garmentFamily: "saree", mainColor: "deep pink" },
    creativeDirection: {},
    modelIdentity: {},
    garmentFamily: "saree",
    consistencyRules: [],
    hasApprovedAnchor: true,
    hasModelReference: false,
    referenceManifest: ["IMAGE 1: SAREE REAR-BACK DRAPE PRODUCT", "IMAGE 2: STYLE REFERENCE"],
  });
  assertStringIncludes(backQa, "On a true back pose, do NOT fail pose_requirement");
  assertStringIncludes(backQa, "nape-length hair sitting cleanly above an unobstructed rear blouse neckline");
});

Deno.test("canSalvageExhaustedPoseQa tolerates >= 80 wide-saree pattern softening only at >= 92 core fidelity and rejects low-fidelity or closeup deficits", () => {
  const highFidelityWideSaree = {
    productFidelity: 93,
    scores: {
      garment_identity: 94,
      colors: 94,
      saree_body_color: 95,
      saree_motif_inventory: 95,
      saree_pallu_artwork: 95,
      saree_border_geometry: 95,
      saree_blouse_construction: 94,
      saree_weave_geometry: 81,
      saree_motif_scale: 80,
      print_pattern: 82,
      pattern_geometry: 82,
      pose_requirement: 82,
      styling_addition: 86,
      face_realism: 96,
      model_face: 95,
    },
    failed: ["saree_weave_geometry", "saree_motif_scale", "print_pattern", "pattern_geometry", "pose_requirement"],
    severe: [] as string[],
    reason: "Wide knees-up saree frame shows subtle distance softening on lattice weave.",
    correction: "",
  };

  assertEquals(canSalvageExhaustedPoseQa(highFidelityWideSaree, { garmentFamily: "saree", poseType: "creative" }), true);
  assertEquals(canSalvageExhaustedPoseQa(highFidelityWideSaree, { garmentFamily: "saree", poseType: "closeup" }), false);
  assertEquals(
    canSalvageExhaustedPoseQa(
      { ...highFidelityWideSaree, scores: { ...highFidelityWideSaree.scores, saree_motif_inventory: 88 } },
      { garmentFamily: "saree", poseType: "creative" },
    ),
    false,
  );
  assertEquals(
    canSalvageExhaustedPoseQa(
      { ...highFidelityWideSaree, scores: { ...highFidelityWideSaree.scores, saree_weave_geometry: 78 } },
      { garmentFamily: "saree", poseType: "creative" },
    ),
    false,
  );
});


Deno.test("buildPoseQaPrompt activates saree checks for saree_* families and strips grounded-feet clauses from cropped productVisibilityRules", () => {
  const sareeQaPrompt = buildPoseQaPrompt({
    poseNumber: 4,
    poseType: "creative",
    poseTitle: "Pose 4",
    poseDirection: {
      id: "creative",
      title: "Creative Pose",
      framing: "Three-quarter knees-up editorial crop",
      bodyPosition: "Relaxed asymmetrical stance with both feet grounded on studio stone",
      description: "Three-quarter knees-up frame.",
      productVisibilityRules: [
        "Keep pallu border and weaves sharp",
        "Both feet stay grounded and close",
      ],
      prompt: "Frame knees-up with both feet planted.",
    },
    productIdentity: { garmentFamily: "saree_bengali" },
    creativeDirection: {},
    modelIdentity: {},
    garmentFamily: "saree_bengali",
    consistencyRules: [],
    hasApprovedAnchor: true,
    hasModelReference: false,
    referenceManifest: ["1. FRONT PRODUCT REFERENCE"],
  });
  assertStringIncludes(sareeQaPrompt, "saree_pallu_artwork");
  assertStringIncludes(sareeQaPrompt, "saree_border_geometry");
  assertStringIncludes(sareeQaPrompt, "Keep pallu border and weaves sharp");
  assertEquals(/both feet stay grounded/i.test(sareeQaPrompt), false);
  assertEquals(/with both feet grounded/i.test(sareeQaPrompt), false);
});

Deno.test("canSalvageExhaustedPoseQa requires explicit saree core lock scores on saree_* and disables wide-saree pattern softening on tight showcase and waist-up frames", () => {
  const missingCoreSaree = {
    productFidelity: 95,
    scores: {
      garment_identity: 95,
      colors: 95,
      saree_body_color: 95,
      pattern_geometry: 81,
    },
    failed: ["pattern_geometry"],
    severe: [],
    reason: "Minor weave softness only.",
    correction: "Sharpen lattice repeat.",
    anatomicalDefectDetected: false,
  };
  assertEquals(
    canSalvageExhaustedPoseQa(missingCoreSaree, { garmentFamily: "saree_bengali", poseType: "creative" }),
    false,
  );

  const completeCoreSaree = {
    ...missingCoreSaree,
    scores: {
      garment_identity: 96,
      colors: 95,
      saree_body_color: 96,
      saree_motif_inventory: 94,
      saree_pallu_artwork: 93,
      saree_border_geometry: 95,
      saree_blouse_construction: 94,
      pattern_geometry: 81,
    },
  };
  assertEquals(
    canSalvageExhaustedPoseQa(completeCoreSaree, {
      garmentFamily: "saree_ethnic",
      poseType: "showcase",
      creativeDirection: {
        showcasePlan: { heroFeature: "pallu zari motif", featureRegion: "pallu", shotType: "macro_detail" },
      },
      poseDirection: { framing: "Tight macro detail crop" },
    }),
    false,
  );
  assertEquals(
    canSalvageExhaustedPoseQa(completeCoreSaree, {
      garmentFamily: "saree_ethnic",
      poseType: "showcase",
      creativeDirection: {
        showcasePlan: { heroFeature: "bodice border work", featureRegion: "neckline", shotType: "half_body_detail" },
      },
      poseDirection: { framing: "Half-body detail crop" },
    }),
    false,
  );
  assertEquals(
    canSalvageExhaustedPoseQa(completeCoreSaree, {
      garmentFamily: "saree",
      poseType: "creative",
      poseDirection: { framing: "Waist-up editorial crop", description: "Waist-up portrait" },
    }),
    false,
  );
  assertEquals(
    canSalvageExhaustedPoseQa(completeCoreSaree, {
      garmentFamily: "saree_ethnic",
      poseType: "showcase",
      creativeDirection: {
        showcasePlan: { heroFeature: "full saree fall", featureRegion: "pallu", shotType: "full_body_feature" },
      },
      poseDirection: {
        framing: "Full-length wide editorial shot, never a waist-up crop",
        description: "Wide studio walk",
      },
    }),
    true,
  );
});

Deno.test("buildPoseQaPrompt quarantines style-reference face on Pose 1 unless useStyleAsModelFace is true and enforces realistic hand/blouse rules", () => {
  const freshPose1 = buildPoseQaPrompt({
    poseNumber: 1,
    poseType: "full_front",
    poseTitle: "Front Hero Stance",
    poseDirection: { id: "full_front", title: "Front Hero Stance" },
    productIdentity: { garmentFamily: "saree_ethnic", mainColor: "sky blue" },
    creativeDirection: {},
    modelIdentity: { ethnicity: "South Asian woman", expressionMood: "calm natural editorial confidence" },
    garmentFamily: "saree_ethnic",
    consistencyRules: [],
    hasApprovedAnchor: false,
    hasModelReference: false,
    useStyleAsModelFace: false,
    referenceManifest: [
      "IMAGE 1: SAREE FRONT DRAPE",
      "IMAGE 2: STYLE REFERENCE (photoshoot room/lighting/mood ONLY — ignore its outfit, face, and pose)",
    ],
  });
  assertStringIncludes(freshPose1, "Never fail Pose 1 model_face because its face differs from the STYLE REFERENCE");
  assertEquals(freshPose1.includes("Compare IMAGE A against the STYLE REFERENCE face"), false);
  assertStringIncludes(freshPose1, "hands poking impossibly through phantom slits");
  assertStringIncludes(freshPose1, "stiff splayed mannequin-like plastic arms/fingers");
  assertStringIncludes(freshPose1, "plain, undecorated modest solid matching/tonal basic blouse");

  const collapsedPose1 = buildPoseQaPrompt({
    poseNumber: 1,
    poseType: "full_front",
    poseTitle: "Front Hero Stance",
    poseDirection: { id: "full_front", title: "Front Hero Stance" },
    productIdentity: { garmentFamily: "saree_ethnic", mainColor: "sky blue" },
    creativeDirection: {},
    modelIdentity: {},
    garmentFamily: "saree_ethnic",
    consistencyRules: [],
    hasApprovedAnchor: false,
    hasModelReference: false,
    useStyleAsModelFace: true,
    referenceManifest: [
      "IMAGE 1: SAREE FRONT DRAPE",
      "IMAGE 2: STYLE REFERENCE & MODEL FACE REFERENCE (copied identically in both slots)",
    ],
  });
  assertStringIncludes(collapsedPose1, "Compare IMAGE A against the STYLE REFERENCE face (uploaded identically in both Face Lock and Style Ref)");
});

Deno.test("Pose 2 QA tests the three-quarter turn itself; no other pose carries that rule", () => {
  const qaFor = (poseNumber: number, poseType: string, title: string) =>
    buildPoseQaPrompt({
      poseNumber,
      poseType,
      poseTitle: title,
      poseDirection: { id: poseType, title, bodyPosition: "Torso and hips turn 35 to 45 degrees. Both feet stay planted and close." },
      productIdentity: { garmentFamily: "short_kurti_top", mainColor: "rust" },
      creativeDirection: {},
      modelIdentity: {},
      garmentFamily: "kurta_or_kurti_set",
      consistencyRules: [],
      hasApprovedAnchor: true,
      hasModelReference: false,
      referenceManifest: ["IMAGE 1: FRONT PRODUCT", "IMAGE 2: BACK PRODUCT"],
    });
  // Live T94-Kitkat-Kattha run: a Pose 2 turned about 25 to 30 degrees passed, because QA never tested the turn.
  const angled = qaFor(2, "angled", "Turning 3/4 View");
  assertStringIncludes(angled, "For pose 2 (turning three-quarter view), fail pose_requirement when the turn is outside the planned range on either side: the torso and hips face the camera square-on like Pose 1 or are turned less than about 30 degrees");
  // Both sides are bounded: a 60 degree turn is out of range too (CodeAnt on #201).
  assertStringIncludes(angled, "or they are turned more than about 55 degrees (the far shoulder is hidden or the front of the garment is mostly turned away), up to and including a full 90-degree profile");
  assertStringIncludes(angled, "Pass a turn of roughly 35 to 45 degrees");
  assertStringIncludes(angled, "State the turn you estimate in degrees in the reason.");
  for (const [number, type, title] of [[1, "full_front", "Full Front View"], [3, "back", "Back View"], [4, "creative", "Signature Reference Pose"]] as const) {
    assertEquals(qaFor(number, type, title).includes("For pose 2 (turning three-quarter view)"), false, type);
  }
});
