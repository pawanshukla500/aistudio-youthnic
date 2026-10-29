import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { normalizeAnalysis } from "../lib/profiles.ts";
import { buildPoseQaPrompt, normalizePoseQaResult } from "../lib/qa.ts";

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
  assertStringIncludes(prompt, "Also fail pose_requirement when the body reads as a mannequin, T-pose, stiff catalog freeze");

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

Deno.test("an explicit bottom_wear fail on a close-up does not reject the crop", () => {
  const result = normalizePoseQaResult({
    pass: true,
    score: 97,
    checks: Object.fromEntries([...genericCritical, "bottom_wear"].map((key) => [key, key === "bottom_wear" ? "fail" : "pass"])),
    scores: Object.fromEntries([...genericCritical, "bottom_wear"].map((key) => [key, key === "bottom_wear" ? 40 : 98])),
    failed: ["bottom_wear"],
    reason: "Trousers are out of the product-detail crop.",
    correction: "",
  }, {
    garmentFamily: "kurta_or_kurti_set",
    poseType: "closeup",
    hasBottomWear: true,
  });
  assertEquals(result.pass, true);
  assertEquals(result.failed.includes("bottom_wear"), false);
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
