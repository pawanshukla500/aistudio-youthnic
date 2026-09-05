import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  appendRejectedAttemptHistory,
  buildPoseQaPrompt,
  normalizePoseQaResult,
  qaStorageDisposition,
  unavailableQaResult,
} from "../lib/qa.ts";

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

const sareeCritical = [
  "saree_body_color",
  "saree_weave_geometry",
  "saree_motif_inventory",
  "saree_motif_scale",
  "saree_motif_placement",
  "saree_pallu_artwork",
  "saree_border_geometry",
  "saree_tassels",
  "saree_blouse_construction",
  "saree_transparency_shine",
  "saree_drape_physics",
  "body_pallu_boundary",
  "duplicate_pallu",
  "blouse_invention",
];

function completeVerdict(overrides: Record<string, number> = {}, failed: string[] = []) {
  const keys = [...genericCritical, ...sareeCritical];
  return {
    pass: true,
    score: 100,
    checks: Object.fromEntries(keys.map((key) => [key, failed.includes(key) ? "fail" : "pass"])),
    scores: Object.fromEntries(keys.map((key) => [key, overrides[key] ?? 100])),
    failed,
    reason: failed.length ? "A named SKU-critical mismatch is visible." : "Compared every region with its original reference.",
    correction: failed.length ? "Rebuild the failed region from its authoritative original product image." : "",
  };
}

Deno.test("saree colour, weave, and motif scores of 86-88 fail automatic QA", () => {
  const result = normalizePoseQaResult(completeVerdict({
    saree_body_color: 86,
    saree_weave_geometry: 87,
    saree_motif_placement: 88,
  }), { garmentFamily: "saree" });

  assertEquals(result.pass, false);
  assertEquals(result.outcome, "rejected_by_qa");
  assert(result.failed.includes("saree_body_color"));
  assert(result.failed.includes("saree_weave_geometry"));
  assert(result.failed.includes("saree_motif_placement"));
});

Deno.test("one critical saree mismatch cannot pass through averaging", () => {
  const result = normalizePoseQaResult(
    completeVerdict({ saree_pallu_artwork: 40 }),
    { garmentFamily: "saree" },
  );

  assertEquals(result.pass, false);
  assertEquals(result.failed, ["saree_pallu_artwork"]);
  assert(result.productFidelity > 90, "The high average must not hide the single failed field.");
});

Deno.test("critical saree scores from 90-94 require human review and are not verified", () => {
  const result = normalizePoseQaResult(
    completeVerdict({ saree_body_color: 92 }),
    { garmentFamily: "saree" },
  );

  assertEquals(result.pass, true);
  assertEquals(result.automaticallyVerified, false);
  assertEquals(result.reviewRecommended, true);
  assertEquals(result.outcome, "requires_human_review");
});

Deno.test("suspicious near-flat critical scores force an independent stronger review", () => {
  const hedgedScores = Object.fromEntries(
    [...genericCritical, ...sareeCritical].map((key, index) => [key, 92 + index % 2]),
  );
  const result = normalizePoseQaResult(completeVerdict(hedgedScores), { garmentFamily: "saree" });

  assertEquals(result.pass, true);
  assertEquals(result.automaticallyVerified, false);
  assertEquals(result.requiresIndependentRecheck, true);
  assertStringIncludes(result.reason, "independent high-quality recheck");
});

Deno.test("a named duplicate-pallu failure rejects an otherwise perfect saree", () => {
  const result = normalizePoseQaResult(
    completeVerdict({ duplicate_pallu: 100 }, ["duplicate_pallu"]),
    { garmentFamily: "saree" },
  );

  assertEquals(result.pass, false);
  assert(result.failed.includes("duplicate_pallu"));
});

Deno.test("non-saree products do not require saree-only checks", () => {
  const checks = Object.fromEntries(genericCritical.map((key) => [key, "pass"]));
  const scores = Object.fromEntries(genericCritical.map((key) => [key, 100]));
  const result = normalizePoseQaResult({ pass: true, score: 100, checks, scores, failed: [] }, { garmentFamily: "dress" });

  assertEquals(result.pass, true);
  assertEquals(result.automaticallyVerified, true);
  assertEquals(result.outcome, "automatically_verified");
  assertEquals(Object.keys(result.scores).some((key) => key.startsWith("saree_")), false);
});

Deno.test("QA provider failure preserves the paid output as unverified", () => {
  const result = unavailableQaResult("Gemini unavailable");
  const storage = qaStorageDisposition({ qaEnabled: true, qaUnavailable: true, outcome: result.outcome });

  assertEquals(result.automaticallyVerified, false);
  assertEquals(result.outcome, "unverified");
  assertEquals(storage, { preserveOutput: true, qaStatus: "unverified" });
});

Deno.test("disabled QA preserves output as unverified without running reviewer", () => {
  const result = unavailableQaResult("Automatic QA was disabled.");
  const storage = qaStorageDisposition({ qaEnabled: false, qaUnavailable: false, outcome: result.outcome });

  assertEquals(result.automaticallyVerified, false);
  assertEquals(result.outcome, "unverified");
  assertEquals(storage, { preserveOutput: true, qaStatus: "unverified" });
});

Deno.test("rejected attempts append without removing earlier paid outputs", () => {
  const history = appendRejectedAttemptHistory(
    [{ attempt: 1, storagePath: "rejected/one.jpg" }],
    { attempt: 2, storagePath: "rejected/two.jpg" },
    3,
  );

  assertEquals(history.map((entry) => entry.storagePath), ["rejected/one.jpg", "rejected/two.jpg"]);
});

Deno.test("saree QA prompt requires original region evidence instead of Pose 1 garment evidence", () => {
  const prompt = buildPoseQaPrompt({
    poseNumber: 2,
    poseType: "angled",
    poseTitle: "Three-quarter",
    poseDirection: {},
    productIdentity: { garmentFamily: "saree", sareeTruth: {} },
    creativeDirection: {},
    modelIdentity: {},
    garmentFamily: "saree",
    consistencyRules: [],
    hasApprovedAnchor: true,
    hasModelReference: false,
    referenceManifest: [
      "IMAGE 1: SAREE BODY / WEAVE CLOSE-UP",
      "IMAGE 2: FULLY SPREAD PALLU",
      "IMAGE 3: APPROVED POSE 1",
    ],
  });

  assertStringIncludes(prompt, "Never use APPROVED POSE 1 as saree product evidence");
  for (const key of sareeCritical.slice(0, 11)) assertStringIncludes(prompt, key);
});
