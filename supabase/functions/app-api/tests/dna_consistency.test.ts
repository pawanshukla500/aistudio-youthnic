import { assert, assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import {
  buildDnaConsistencyPrompt,
  DNA_ATTRIBUTE_PASS_FLOOR,
  DNA_ATTRIBUTES,
  DNA_CONSISTENCY_VERSION,
  dnaConsistencyFromQaScores,
  dnaCorrectionText,
  dnaHoldsForReview,
  normalizeDnaConsistencyResult,
  repeatsLastDnaFailure,
  unavailableDnaConsistency,
} from "../lib/qa.ts";
import {
  DEFAULT_ESTIMATED_DNA_CHECK_COST_PER_POSE_USD,
  DEFAULT_ESTIMATED_QA_COST_PER_POSE_USD,
  estimateJobCostUsd,
} from "../lib/providerCost.ts";
import { roleLabel } from "../lib/referencePolicy.ts";

Deno.test("DNA prompt compares IMAGE A with labeled product references and quarantines the style reference", () => {
  const prompt = buildDnaConsistencyPrompt({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "teal",
      secondaryColors: ["gold", "ivory"],
      embroidery: "mirror-work yoke",
      garmentEvidence: [{ region: "never-sent-marker" }],
    },
    skuName: "TEAL-KURTI",
    pose: { id: "creative", title: "Seated editorial" },
    referenceLabels: ["FRONT PRODUCT", "STYLE REFERENCE - room only"],
  });
  assertStringIncludes(prompt, "IMAGE A is the generated image (Seated editorial [creative])");
  assertStringIncludes(prompt, "IMAGE 1: FRONT PRODUCT\nIMAGE 2: STYLE REFERENCE - room only");
  assertStringIncludes(prompt, "The STYLE REFERENCE, MODEL FACE REFERENCE and APPROVED POSE 1 are not product evidence");
  assertStringIncludes(prompt, '"secondaryColors":"gold, ivory"');
  assertStringIncludes(prompt, "Set logoApplicable false when the product references show none.");
  for (const attribute of DNA_ATTRIBUTES) assertStringIncludes(prompt, `- ${attribute}:`);
  assertStringIncludes(prompt, '"verdict":"pass"|"fail"');
  assertEquals(prompt.includes("never-sent-marker"), false);
  assert(prompt.length < 2_500, `DNA prompt should stay short (${prompt.length})`);
});

Deno.test("DNA prompt drops bottom wear for a top-only shoot but not for a set or a saree", () => {
  const args = {
    productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "teal", bottomWearDetails: "printed palazzo" },
    skuName: "TEAL-KURTI",
    pose: { id: "angled", title: "Angled" },
    referenceLabels: ["FRONT PRODUCT"],
  };
  const set = buildDnaConsistencyPrompt(args);
  assertStringIncludes(set, '"bottomWearDetails":"printed palazzo"');
  assertStringIncludes(set, "- shape: silhouette, cut, length, fit, neckline, sleeves, bottom-wear structure.");
  assertEquals(set.includes("top-only"), false);

  const topOnly = buildDnaConsistencyPrompt({ ...args, bottomWearMode: "top_only" });
  assertEquals(topOnly.includes("printed palazzo"), false);
  assertStringIncludes(topOnly, "- shape: silhouette, cut, length, fit, neckline, sleeves.");
  assertStringIncludes(topOnly, "This shoot is top-only: ignore the bottom garment.");

  const saree = buildDnaConsistencyPrompt({ ...args, productIdentity: { garmentFamily: "saree", mainColor: "red" } });
  assertEquals(saree.includes("bottom-wear structure"), false);
  assertEquals(saree.includes("top-only"), false);

  // The fabric label's "not bottom-wear print" is not a bottom photo; the BOTTOM WEAR label is.
  const top = { ...args, productIdentity: { garmentFamily: "western_or_casual", category: "western top", mainColor: "white" } };
  assertStringIncludes(buildDnaConsistencyPrompt({ ...top, referenceLabels: [roleLabel("front"), roleLabel("fabric_pattern")] }), "This shoot is top-only");
  assertEquals(buildDnaConsistencyPrompt({ ...top, referenceLabels: [roleLabel("front"), roleLabel("bottom")] }).includes("top-only"), false);
});

Deno.test("DNA prompt for the back view uses rear-only facts and does not expect front-only details", () => {
  const args = {
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      category: "kurti",
      mainColor: "teal",
      neckline: "front-neckline-marker",
      embroidery: "front-yoke-marker",
      logos: "front-logo-marker",
      garmentEvidence: [
        { region: "front yoke", sourceRole: "front", visibleDecoration: "front-evidence-marker" },
        { region: "back yoke", sourceRole: "back", visibleConstruction: "keyhole with loop button", explicitlyAbsent: ["embroidery"] },
      ],
    },
    skuName: "TEAL-KURTI",
    referenceLabels: [roleLabel("front"), roleLabel("back")],
  };
  const back = buildDnaConsistencyPrompt({ ...args, pose: { id: "back", title: "Back view" } });
  for (const marker of ["front-neckline-marker", "front-yoke-marker", "front-logo-marker", "front-evidence-marker", "[object Object]"]) {
    assertEquals(back.includes(marker), false, marker);
  }
  assertStringIncludes(back, "region: back yoke; state: unknown; visibleConstruction: keyhole with loop button; explicitlyAbsent: embroidery");
  assertStringIncludes(back, '"category":"kurti"');
  assertStringIncludes(back, "This is a BACK view: judge only what a rear view can show.");
  assertStringIncludes(back, "Front-only details (front embroidery or print, neckline, front placket or opening, front logos) are not expected");
  assert(back.length < 2_500, `DNA back prompt should stay short (${back.length})`);

  const angled = buildDnaConsistencyPrompt({ ...args, pose: { id: "angled", title: "Angled" } });
  assertStringIncludes(angled, '"embroidery":"front-yoke-marker"');
  assertEquals(angled.includes("BACK view"), false);
  assertEquals(angled.includes("keyhole"), false);
});

Deno.test("DNA prompt exempts posture compression only for an adopted low Pose 4/6 posture", () => {
  const args = {
    productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "teal", bottomWearDetails: "printed palazzo" },
    skuName: "TEAL-KURTI",
    referenceLabels: [roleLabel("front"), roleLabel("bottom")],
  };
  for (const [id, posture] of [["creative", "seated"], ["showcase", "Kneeling on one knee"], ["creative", "crouching"], ["showcase", "reclining"]]) {
    const prompt = buildDnaConsistencyPrompt({ ...args, pose: { id, title: id }, referencePosture: posture });
    assertStringIncludes(prompt, "LOW-POSTURE EXEMPTION: this frame intentionally uses a ");
    assertStringIncludes(prompt, "folds and compression of the garment and bottom wear caused by it are expected");
    assertStringIncludes(prompt, "Score shape on the cut and silhouette of the visible garment, and the bottom wear on its cut, print and colour, not its drape length");
  }
  assertStringIncludes(buildDnaConsistencyPrompt({ ...args, pose: { id: "creative", title: "c" }, referencePosture: "sitting on a stool" }), "uses a seated posture");

  const topOnly = buildDnaConsistencyPrompt({ ...args, bottomWearMode: "top_only", pose: { id: "creative", title: "c" }, referencePosture: "seated" });
  assertStringIncludes(topOnly, "folds and compression of the garment caused by it are expected. Score shape on the cut and silhouette of the visible garment; do not fail shape");

  for (const [id, posture] of [["creative", "standing"], ["showcase", "leaning"], ["creative", "walking"], ["creative", undefined], ["back", "seated"], ["full_front", "kneeling"]]) {
    const prompt = buildDnaConsistencyPrompt({ ...args, pose: { id: id!, title: "t" }, referencePosture: posture });
    assertEquals(prompt.includes("LOW-POSTURE"), false, `${id}/${posture}`);
  }
});

Deno.test("DNA normalizer applies the 85 floor, skips a non-applicable logo and filters raw.failed", () => {
  const passing = normalizeDnaConsistencyResult({
    scores: { shape: 96, color: "92", material: 88, logo: 10, details: DNA_ATTRIBUTE_PASS_FLOOR },
    logoApplicable: false,
    failed: ["logo", "nonsense"],
    verdict: "fail",
  });
  assertEquals(passing.version, DNA_CONSISTENCY_VERSION);
  assertEquals(passing.pass, true);
  assertEquals(passing.unavailable, false);
  assertEquals(passing.source, "dna_check");
  assertEquals(passing.scores.logo, null);
  assertEquals(passing.failed, []);
  assertEquals(passing.score, Math.round((96 + 92 + 88 + 85) / 4));

  const failing = normalizeDnaConsistencyResult({
    scores: { shape: 84, color: 99, material: 90, logo: 95, details: 91 },
    logoApplicable: true,
    failed: ["DETAILS", "color "],
    correction: "Restore the mirror-work spacing.",
  });
  assertEquals(failing.pass, false);
  assertEquals(failing.failed, ["shape", "color", "details"]);
  assertStringIncludes(failing.reason, "shape 84");
  assertEquals(failing.correction, "Restore the mirror-work spacing.");

  // A missing attribute is unscored, not failed.
  const partial = normalizeDnaConsistencyResult({ scores: { color: 97 } });
  assertEquals(partial.pass, true);
  assertEquals(partial.scores.shape, null);
  assertEquals(partial.score, 97);
});

Deno.test("DNA normalizer reads top-level scores, loose logoApplicable values and a 0-1 scale", () => {
  const topLevel = normalizeDnaConsistencyResult({ shape: 91, color: "96", material: 88, details: 90, verdict: "pass" });
  assertEquals(topLevel.scores, { shape: 91, color: 96, material: 88, logo: null, details: 90 });
  assertEquals(topLevel.pass, true);
  // "scores" wins when it has entries.
  assertEquals(normalizeDnaConsistencyResult({ scores: { shape: 99 }, shape: 10 }).scores.shape, 99);

  for (const logoApplicable of ["no", "No", "false", 0, "0", false]) {
    const result = normalizeDnaConsistencyResult({ scores: { shape: 95, logo: 20 }, logoApplicable, failed: ["logo"] });
    assertEquals(result.scores.logo, null, String(logoApplicable));
    assertEquals(result.pass, true, String(logoApplicable));
  }
  assertEquals(normalizeDnaConsistencyResult({ scores: { shape: 95, logo: 20 }, logoApplicable: "yes" }).failed, ["logo"]);

  const fractional = normalizeDnaConsistencyResult({ scores: { shape: 0.97, color: "0.9", material: 0.84, logo: 1, details: 0.96 } });
  assertEquals(fractional.scores, { shape: 97, color: 90, material: 84, logo: 100, details: 96 });
  assertEquals(fractional.failed, ["material"]);
  // One score above 1 means the response already uses 0-100.
  assertEquals(normalizeDnaConsistencyResult({ scores: { shape: 1, color: 92 } }).scores, { shape: 1, color: 92, material: null, logo: null, details: null });
  // A non-applicable logo does not decide the scale.
  assertEquals(normalizeDnaConsistencyResult({ scores: { shape: 0.9, logo: 95 }, logoApplicable: "no" }).scores.shape, 90);
});

Deno.test("DNA normalizer throws on a response with no numeric scores", () => {
  assertThrows(() => normalizeDnaConsistencyResult({ verdict: "pass" }), Error, "no attribute scores");
  assertThrows(() => normalizeDnaConsistencyResult({ scores: { shape: "great", color: "" } }));
  assertThrows(() => normalizeDnaConsistencyResult(null));
  // A fail verdict that names no valid attribute is still unusable.
  assertThrows(() => normalizeDnaConsistencyResult({ verdict: "fail" }), Error, "no attribute scores");
  assertThrows(() => normalizeDnaConsistencyResult({ verdict: "fail", failed: ["fit", ""] }), Error, "no attribute scores");
  assertThrows(() => normalizeDnaConsistencyResult({ verdict: "fail", failed: ["logo"], logo_applicable: false }), Error, "no attribute scores");
  assertThrows(() => normalizeDnaConsistencyResult({ scores: { shape: "%" } }), Error, "no attribute scores");
});

Deno.test("DNA normalizer fails an explicit failed list without scores instead of marking it unavailable", () => {
  const failed = normalizeDnaConsistencyResult({ verdict: "fail", failed: ["Color", "details", "nonsense"], correction: "Restore the teal." });
  assertEquals(failed.pass, false);
  assertEquals(failed.unavailable, false);
  assertEquals(failed.source, "dna_check");
  assertEquals(failed.failed, ["color", "details"]);
  assertEquals(failed.scores, { shape: null, color: null, material: null, logo: null, details: null });
  assertEquals(failed.score, null);
  assertStringIncludes(failed.reason, "color flagged, details flagged");
  assertStringIncludes(dnaCorrectionText(failed), "colour, details (embroidery, print, trims, placement). Copy these exactly");
  assertEquals(normalizeDnaConsistencyResult({ failed: ["shape"] }).failed, ["shape"]);
});

Deno.test("DNA normalizer reads percent strings and snake_case logo_applicable", () => {
  const percent = normalizeDnaConsistencyResult({ scores: { shape: "92%", color: " 88 % ", material: "90", logo: 100, details: "84%" } });
  assertEquals(percent.scores, { shape: 92, color: 88, material: 90, logo: 100, details: 84 });
  assertEquals(percent.failed, ["details"]);

  for (const logo_applicable of [false, "false", "no"]) {
    const result = normalizeDnaConsistencyResult({ scores: { shape: 95, logo: 20 }, logo_applicable, failed: ["logo"] });
    assertEquals(result.scores.logo, null, String(logo_applicable));
    assertEquals(result.pass, true, String(logo_applicable));
  }
  assertEquals(normalizeDnaConsistencyResult({ scores: { shape: 95, logo: 20 }, logo_applicable: true }).failed, ["logo"]);
  // camelCase wins when both are present.
  assertEquals(normalizeDnaConsistencyResult({ scores: { shape: 95, logo: 20 }, logoApplicable: true, logo_applicable: false }).failed, ["logo"]);
});

Deno.test("full pose QA scores map onto the DNA attributes", () => {
  const derived = dnaConsistencyFromQaScores({
    garment_identity: 97,
    fit_silhouette: 91,
    colors: 98,
    fabric_texture: 96,
    embroidery_geometry: 95,
    pattern_geometry: 82,
    model_face: 40,
  });
  assertEquals(derived.source, "pose_qa");
  assertEquals(derived.scores, { shape: 91, color: 98, material: 96, logo: null, details: 82 });
  assertEquals(derived.failed, ["details"]);
  assertEquals(derived.pass, false);

  const saree = dnaConsistencyFromQaScores({ saree_body_color: 93, colors: 99, saree_pallu_artwork: 90, details_and_branding: 96 });
  assertEquals(saree.scores.color, 93);
  assertEquals(saree.scores.details, 90);
  assertEquals(saree.scores.logo, 96);
  assertEquals(saree.pass, true);

  const empty = dnaConsistencyFromQaScores({});
  assertEquals(empty.unavailable, true);
  assertEquals(empty.pass, true);
});

Deno.test("an unavailable DNA check never blocks delivery", () => {
  const result = unavailableDnaConsistency("provider timeout");
  assertEquals(result.pass, true);
  assertEquals(result.unavailable, true);
  assertEquals(result.source, "unavailable");
  assertEquals(result.score, null);
  assertEquals(result.failed, []);
  assertEquals(Object.values(result.scores).every((score) => score === null), true);
  assertEquals(result.reason, "provider timeout");
  assertEquals(dnaCorrectionText(result), "");
});

Deno.test("DNA correction names each failed attribute with its score", () => {
  const failing = normalizeDnaConsistencyResult({
    scores: { shape: 70, color: 99, material: 90, logo: 95, details: 60 },
    correction: "Re-space the mirror work.",
  });
  const text = dnaCorrectionText(failing);
  assertStringIncludes(text, "PRODUCT DNA CORRECTION: the previous image drifted from the uploaded product on shape/silhouette (70), details (embroidery, print, trims, placement) (60).");
  assertStringIncludes(text, "Re-space the mirror work.");
  assert(text.length <= 600);
  assertEquals(dnaCorrectionText(normalizeDnaConsistencyResult({ scores: { shape: 99 } })), "");
});

Deno.test("job estimate adds the DNA check only when full pose QA is off", () => {
  const withoutQa = estimateJobCostUsd({ posesCount: 6, imageModel: "gpt-image-2", quality: "high", poseQa: false, analysisCostUsd: 0 });
  const withQa = estimateJobCostUsd({ posesCount: 6, imageModel: "gpt-image-2", quality: "high", poseQa: true, analysisCostUsd: 0 });
  assertEquals(DEFAULT_ESTIMATED_DNA_CHECK_COST_PER_POSE_USD, 0.004);
  assertEquals(withoutQa, Math.round((6 * 0.28 + 6 * DEFAULT_ESTIMATED_DNA_CHECK_COST_PER_POSE_USD) * 1e6) / 1e6);
  assertEquals(withQa, Math.round((6 * 0.28 + 6 * DEFAULT_ESTIMATED_QA_COST_PER_POSE_USD) * 1e6) / 1e6);
});

Deno.test("DNA normalizer accepts a comma-separated failed string and the British spelling", () => {
  const result = normalizeDnaConsistencyResult({ failed: "colour, details", verdict: "fail" });
  assertEquals(result.pass, false);
  assertEquals(result.failed, ["color", "details"]);
});

Deno.test("a DNA-failed frame kept for review is never an approved Pose 1 anchor until a human approves it", () => {
  const failed = normalizeDnaConsistencyResult({ scores: { shape: 70, color: 99, material: 95, logo: 95, details: 95 } });
  // With pose QA off the frame ships as requires_human_review, which canUsePoseOneAnchor alone allows.
  assertEquals(dnaHoldsForReview("requires_human_review", failed), true);
  assertEquals(dnaHoldsForReview("unverified", failed), true);
  assertEquals(dnaHoldsForReview("human_approved", failed), false);
  // A passing, unavailable or missing verdict (legacy rows) never holds a frame.
  assertEquals(dnaHoldsForReview("requires_human_review", normalizeDnaConsistencyResult({ scores: { shape: 99 } })), false);
  assertEquals(dnaHoldsForReview("requires_human_review", unavailableDnaConsistency("timeout")), false);
  assertEquals(dnaHoldsForReview("unverified", undefined), false);
});

Deno.test("the DNA early stop fires on the same failed attribute set from the previous attempt, whatever the scores", () => {
  const first = normalizeDnaConsistencyResult({ scores: { shape: 70, color: 99, material: 95, logo: 95, details: 60 }, correction: "Re-space the mirror work." });
  const second = normalizeDnaConsistencyResult({ scores: { shape: 78, color: 99, material: 95, logo: 95, details: 72 }, correction: "Shorten the hem." });
  // The correction texts differ (scores and free text), so a text comparison never matched.
  assertEquals(dnaCorrectionText(first).includes(dnaCorrectionText(second)), false);
  const mark = { generationEpoch: 2, attempt: 1, failed: first.failed };
  assertEquals(repeatsLastDnaFailure(mark, second, { generationEpoch: 2, attempt: 2 }), true);
  // A different set, another version, a non-adjacent attempt or no mark never stops early.
  const colourOnly = normalizeDnaConsistencyResult({ scores: { shape: 95, color: 60, material: 95, logo: 95, details: 95 } });
  assertEquals(repeatsLastDnaFailure(mark, colourOnly, { generationEpoch: 2, attempt: 2 }), false);
  assertEquals(repeatsLastDnaFailure({ ...mark, failed: ["shape"] }, second, { generationEpoch: 2, attempt: 2 }), false);
  assertEquals(repeatsLastDnaFailure(mark, second, { generationEpoch: 3, attempt: 2 }), false);
  assertEquals(repeatsLastDnaFailure(mark, second, { generationEpoch: 2, attempt: 3 }), false);
  assertEquals(repeatsLastDnaFailure(null, second, { generationEpoch: 2, attempt: 2 }), false);
  assertEquals(repeatsLastDnaFailure(mark, { failed: [] }, { generationEpoch: 2, attempt: 2 }), false);
});
