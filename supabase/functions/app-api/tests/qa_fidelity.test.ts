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
