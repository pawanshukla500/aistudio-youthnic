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
