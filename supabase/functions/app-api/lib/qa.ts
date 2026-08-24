import { parseJsonResponse, type JsonRecord } from "./profiles.ts";

const GENERIC_CHECK_KEYS = [
  "model_face", "face_realism", "garment_identity", "colors", "fabric_texture", "print_pattern",
  "pattern_geometry", "embroidery_geometry", "front_back_design", "bottom_wear", "details_and_branding",
  "detail_placement", "absence_constraints", "fit_silhouette", "styling_continuity", "styling_addition",
  "pose_requirement", "unexpected_changes",
  "side_construction", "trim_location", "unknown_region_invention", "print_embroidery_continuation",
] as const;

const SAREE_CHECK_KEYS = [
  "saree_body_color", "saree_weave_geometry", "saree_motif_inventory", "saree_motif_scale",
  "saree_motif_placement", "saree_pallu_artwork", "saree_border_geometry", "saree_tassels",
  "saree_blouse_construction", "saree_transparency_shine", "saree_drape_physics",
  "body_pallu_boundary", "duplicate_pallu", "blouse_invention",
] as const;

// SKU-defining attributes. A garment can pass every other check and still be the
// wrong product if one of these drifts, so they carry double weight in the
// fidelity score and are gated on their own floor.
const GENERIC_CRITICAL_CHECKS: readonly string[] = [
  "garment_identity", "colors", "print_pattern", "pattern_geometry", "embroidery_geometry",
  "detail_placement", "absence_constraints",
  "side_construction", "trim_location", "unknown_region_invention", "print_embroidery_continuation",
];

const SAREE_CRITICAL_CHECKS: readonly string[] = [...SAREE_CHECK_KEYS];

// Listing-grade gates are intentionally attribute-level: 90-94 needs a human,
// and anything below 90 fails even when the weighted average remains high.
const AUTO_PASS_FLOOR = 95;
const RETRY_FLOOR = 90;
const SEVERE_SCORE_FLOOR = 60;

function qaKeys(garmentFamily = "") {
  const isSaree = garmentFamily.toLowerCase() === "saree";
  return {
    checkKeys: isSaree ? [...GENERIC_CHECK_KEYS, ...SAREE_CHECK_KEYS] : [...GENERIC_CHECK_KEYS],
    criticalChecks: isSaree ? [...GENERIC_CRITICAL_CHECKS, ...SAREE_CRITICAL_CHECKS] : [...GENERIC_CRITICAL_CHECKS],
    isSaree,
  };
}

export function unavailableQaResult(reason: string) {
  return {
    pass: true,
    score: 0,
    productFidelity: 0,
    scores: {} as Record<string, number>,
    weakest: [] as string[],
    lowConfidence: [] as string[],
    reviewRecommended: true,
    checks: {} as JsonRecord,
    failed: [] as string[],
    reason,
    correction: "",
    automaticallyVerified: false,
    outcome: "unverified",
    requiresIndependentRecheck: false,
  };
}

export function qaStorageDisposition(args: { qaEnabled: boolean; qaUnavailable: boolean; outcome: string }) {
  return {
    preserveOutput: true,
    qaStatus: !args.qaEnabled || args.qaUnavailable ? "unverified" : args.outcome,
  };
}

export function appendRejectedAttemptHistory<T>(existing: T[], next: T, limit = 3): T[] {
  return [...existing, next].slice(-Math.max(1, limit));
}

export function buildPoseQaPrompt(args: {
  poseNumber: number; poseType: string; poseTitle: string; poseDirection: unknown;
  productIdentity: unknown; creativeDirection: unknown; modelIdentity: unknown;
  garmentFamily: string; consistencyRules: string[]; hasApprovedAnchor: boolean; hasModelReference: boolean; referenceManifest: string[];
}) {
  const { checkKeys, isSaree } = qaKeys(args.garmentFamily);
  const exampleChecks = Object.fromEntries(checkKeys.map((key) => [key, "pass"]));
  const exampleScores = Object.fromEntries(checkKeys.map((key) => [key, 100]));
  return `You are a strict fashion e-commerce consistency validator.

Review IMAGE A (the newly generated pose) against every labeled source image that follows it.
SOURCE PRIORITY: original region-labeled product references are authoritative for the garment and always outrank APPROVED POSE 1. For a saree, compare body/weave only with BODY/WEAVE and full-drape references, pallu only with FULLY SPREAD PALLU, borders/tassels only with BORDER/TASSELS, and blouse construction only with the matching BLOUSE reference. Never use APPROVED POSE 1 as saree product evidence. Legacy FRONT/BACK/FABRIC/ADDITIONAL product references remain valid for their proven regions. A MANNEQUIN or DRESS-FORM shot (if present) is authoritative for worn shape, fit, proportion, drape and how the garment falls on a body - validate silhouette and drape against it. A FLAT-LAY is authoritative only for outline, construction, panel layout and garment length. MODEL FACE REFERENCE outranks every other face source. APPROVED POSE 1 controls only model/styling/scene continuity and never garment identity. STYLE REFERENCE controls art direction only.

Pose ${args.poseNumber}: ${args.poseTitle} (${args.poseType})
Approved pose requirement: ${JSON.stringify(args.poseDirection)}
Product Identity Profile: ${JSON.stringify(args.productIdentity)}
Creative Direction Profile: ${JSON.stringify(args.creativeDirection)}
Model Identity Lock: ${JSON.stringify(args.modelIdentity)}
Session rules:
${args.consistencyRules.map((rule) => `- ${rule}`).join("\n")}
Reference manifest:
${args.referenceManifest.join("\n")}

This is a visual continuity review of rendered catalogue imagery. Judge only whether depicted appearance attributes look consistent between images - never identify, name, recognize, or infer personal attributes of any individual.

${args.hasModelReference
    ? `Compare IMAGE A against the MODEL FACE REFERENCE on visual appearance attributes - face shape, eye shape and colour, eyebrow shape, nose shape, lip shape, jawline, skin tone and texture, and hairstyle must look consistent with that reference rather than merely similar. Fail model_face for any noticeable visual deviation, even a subtle one.${args.hasApprovedAnchor ? " Use APPROVED POSE 1 only to confirm scene, lighting, and styling continuity - never to judge the face." : ""}`
    : args.hasApprovedAnchor
      ? "Compare IMAGE A against the APPROVED POSE 1 reference on visual appearance attributes - face shape, eye shape and colour, eyebrow shape, nose shape, lip shape, jawline, skin tone and texture, and hairstyle must look consistent across the set. Also confirm body proportions, styling, backdrop, lighting, and colour treatment match."
      : "This is Pose 1. It must establish one specific, photorealistic, naturally beautiful adult face and a realistic, coherent shoot anchor."}

PRODUCT FIDELITY - the failure mode that matters most here is a garment that reads as the same style but is not the same SKU. Judge it against the product references, not against your sense of what such a garment usually looks like:
- pattern_geometry: compare motif shape, motif scale relative to the body, spacing, orientation, repeat interval and density against the FABRIC / PATTERN DETAIL and FRONT references, panel by panel. Fail it when motifs are enlarged, simplified, redrawn, reduced to fewer larger shapes, re-angled, made denser or sparser, or when accent colours inside the print are missing - even when the print type and colour family are right.
- embroidery_geometry: compare the internal construction - lattice or motif structure, the count and rhythm of repeated units, borders, coverage area relative to the garment, and the relationship to neckline, tie, drawstring and tassel. Fail it when the embroidery is a different arrangement of the same craft, when unit count or shape changes, or when its coverage grows or shrinks.
- side_construction: verify side seams, slits, and closures strictly against the references. Fail if a side slit, opening, or side trim is invented where it wasn't explicitly proven.
- trim_location: verify that trim (lace, border, piping) only appears exactly where proven. Fail if, for example, hem trim extends vertically up a side seam.
- unknown_region_invention: fail if any explicitly "unknown" or unproven region contains invented product-defining construction or decoration. UNKNOWN DOES NOT MEAN INFER. Unknown means plain base fabric without unproven decoration.
- print_embroidery_continuation: fail if embroidery or print is mirrored or extended into unproven regions (e.g. extending front neckline embroidery down the back, or mirroring it).
- body_pallu_boundary: for sarees, fail if pallu motifs bleed into the saree body, or vice versa.
- duplicate_pallu: for sarees, fail if multiple loose cloth panels are invented (a saree has exactly one pallu).
- drape_physics: for sarees, fail if heavy fabric floats like weightless chiffon, or if the drape does not behave like the specified fabric.
- blouse_invention: for sarees, fail if a stitched blouse back is invented when only an unstitched piece was shown.
${isSaree ? `SAREE LISTING-GRADE CHECKS - compare each named field directly with the ORIGINAL region-specific product evidence, never with APPROVED POSE 1:
- saree_body_color: exact base and secondary colours, including colour treatment under the same lighting.
- saree_weave_geometry: exact weave/lattice family, unit geometry, scale and repeat.
- saree_motif_inventory: every peacock, floral and other motif present or confirmed absent.
- saree_motif_scale: motif size relative to the body and border.
- saree_motif_placement: orientation, repeat, density and region placement across body, pleats, pallu and borders.
- saree_pallu_artwork: pallu start boundary, artwork, motif inventory, orientation and density.
- saree_border_geometry: separate upper/lower widths, colours, construction, motif geometry and continuity.
- saree_tassels: colour, construction, count/rhythm and spacing; do not invent tassels when unproven.
- saree_blouse_construction: colour, fabric, front/back construction, neckline, sleeves, ties and closures; respect unstitched-piece evidence.
- saree_transparency_shine: translucency, surface shine and interaction with lighting.
- saree_drape_physics: weight, stiffness, fluidity, crease behaviour and expected fall.
All saree-only checks above are required for this image.` : "Do not return saree-only checks for this non-saree garment."}
SCORING SCALE - anchor every number to these meanings, and never hand several attributes the same round number as a hedge:
- 100: indistinguishable from the reference.
- 95: the same garment; only rendering differences a photographer would accept.
- 90: one attribute requires a human comparison and cannot be called automatically verified.
- 70: clearly a different arrangement of the same idea - redrawn motifs, regrouped embroidery, shifted placement.
- 40: a different product in the same category.
Only 95-100 is eligible for automatic verification. A critical score of 90-94 requires human review. A critical score below 90 fails automatic QA and requires a specific correction. A named critical failure always fails even when the average is high. Do not hand many critical fields nearly identical hedged scores; inspect each region independently.

Check every field below. Perform localized comparisons of center-front closure, neckline, sleeve edges, front hem, center-back/rear hem, every decoration, bottom wear, and face. Fail any invented or moved button, tassel/latkan, closure, trim, pocket, logo, embroidery, jewelry, or hardware. For a back pose, fail unless it is a true back view matching the uploaded BACK; face_realism automatically passes for a back pose since the face is not visible. For pose 5 (the zoomed-in face & product detail highlight), fail pose_requirement if it is a full-body or wide shot that just repeats the hero framing instead of a genuine zoomed-in face-to-chest/face-to-waist crop, if the face is not sharp and clearly visible, if no real product detail is sharply highlighted in the same frame, or if the expression looks stiff or unnatural instead of a beautiful, cute, genuine Gen-Z smile or expression. Judge styling_addition against the approved styling plan in the session rules above: fail it when a listed piece is missing, when a piece appears that the plan does not list (an invented necklace, bangle, belt, bag or hair ornament), when the metal or family differs from the plan (gold where the plan says oxidised silver), when it changes between poses, or when it hides or replaces a garment detail, bottom wear or footwear from the product references. Pass it when the frame matches the plan exactly, or when no plan and no suggestion were provided and nothing was invented.

Face quality bar - fail face_realism for any of these even if everything else matches: plastic, waxy, airbrushed, or over-smoothed "beauty filter" skin instead of natural texture with visible pores; crossed, misaligned, asymmetric, glassy, or otherwise distorted/malformed eyes; unnaturally uniform, fused, extra, missing, or warped teeth; any blurring, warping, melting, or duplicated/misplaced facial features; or a mirror-symmetric "AI face" that does not read as a real photographed person. Give a specific, actionable correction for any face_realism or model_face failure (name the exact feature that is wrong).

Return STRICT JSON only:
${JSON.stringify({ pass: true, score: 100, checks: exampleChecks, scores: exampleScores, failed: [], reason: "short evidence-based verdict", correction: "specific correction for every failed field" })}`;
}

export function normalizePoseQaResult(raw: JsonRecord, options: { garmentFamily?: string } = {}) {
  const { checkKeys, criticalChecks } = qaKeys(options.garmentFamily);
  const checks = raw.checks && typeof raw.checks === "object" ? raw.checks as JsonRecord : {};
  const rawScores = raw.scores && typeof raw.scores === "object" ? raw.scores as JsonRecord : {};
  const failed = new Set<string>();
  for (const key of checkKeys) if (String(checks[key] || "").toLowerCase() === "fail") failed.add(key);
  for (const value of Array.isArray(raw.failed) ? raw.failed : []) {
    const key = String(value || "").toLowerCase().replace(/[^a-z_]/g, "");
    if (checkKeys.includes(key as never)) failed.add(key);
  }
  if (typeof raw.pass !== "boolean" && Object.keys(checks).length === 0) throw new Error("QA returned no structured verdict.");

  // A per-attribute score is only trustworthy when the validator actually
  // returned one; otherwise it is derived from that attribute's verdict so an
  // older or terser response still produces a usable fidelity figure.
  const scores: Record<string, number> = {};
  for (const key of checkKeys) {
    const reported = Number(rawScores[key]);
    const verdict = String(checks[key] || "").toLowerCase();
    if (Number.isFinite(reported)) scores[key] = Math.max(0, Math.min(100, Math.round(reported)));
    else if (verdict === "fail") scores[key] = 0;
    else if (verdict === "pass") scores[key] = 100;
    else if (criticalChecks.includes(key)) {
      // A verdict that says nothing about an SKU-defining attribute is not
      // evidence that the attribute is right. Silence here used to average away:
      // one non-critical score could carry the whole frame to a passing figure.
      scores[key] = 0;
      failed.add(key);
    }
  }
  const weighted = Object.entries(scores).map(([key, score]) => ({ score, weight: criticalChecks.includes(key) ? 2 : 1 }));
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const productFidelity = totalWeight
    ? Math.round(weighted.reduce((sum, entry) => sum + entry.score * entry.weight, 0) / totalWeight)
    : Math.max(0, Math.min(100, Number(raw.score) || 0));

  const severe: string[] = [];
  const lowConfidence: string[] = [];
  for (const [key, score] of Object.entries(scores)) {
    if (!criticalChecks.includes(key)) continue;
    if (score < RETRY_FLOOR) {
      failed.add(key);
    }
    if (score < SEVERE_SCORE_FLOOR) {
      severe.push(key);
    } else if (score < AUTO_PASS_FLOOR) {
      lowConfidence.push(`${key} ${score}%`);
    }
  }
  const reportedCriticalScores = criticalChecks
    .map((key) => Number(rawScores[key]))
    .filter((score) => Number.isFinite(score));
  const sortedCriticalScores = [...reportedCriticalScores].sort((left, right) => left - right);
  const suspiciousFlatScores = sortedCriticalScores.some((floor, index) => {
    if (floor >= AUTO_PASS_FLOOR) return false;
    let end = index;
    while (end < sortedCriticalScores.length && sortedCriticalScores[end] - floor <= 2) end += 1;
    return end - index >= 6;
  });
  const weakest = Object.entries(scores).sort((left, right) => left[1] - right[1]).slice(0, 3)
    .filter(([, score]) => score < 100)
    .map(([key, score]) => `${key} ${score}%`);
  const pass = raw.pass !== false && failed.size === 0;
  const automaticallyVerified = pass && lowConfidence.length === 0 && !suspiciousFlatScores;
  const reviewRecommended = pass && !automaticallyVerified;
  const outcome = !pass ? "rejected_by_qa" : automaticallyVerified ? "automatically_verified" : "requires_human_review";
  // The deciding rule leads the message. Concatenating the validator's prose first
  // produced "Consistency QA failed: Image A successfully aligns with ...".
  const cause = failed.size
    ? severe.length
      ? `Critical attributes far below the product references: ${severe.join(", ")}.`
      : `Failed checks: ${[...failed].join(", ")}.`
    : "";

  return {
    pass,
    score: productFidelity,
    productFidelity,
    scores,
    weakest,
    lowConfidence,
    reviewRecommended,
    checks,
    failed: [...failed],
    reason: [
      cause,
      String(raw.reason || (pass ? "All consistency checks passed." : "")),
      weakest.length ? `Lowest matches: ${weakest.join(", ")}.` : "",
      suspiciousFlatScores ? "Critical scores were suspiciously near-flat; require an independent high-quality recheck." : "",
      reviewRecommended ? "This AI QA estimate requires human review and is not automatically verified." : "",
    ].filter(Boolean).join(" ").slice(0, 500),
    correction: String(raw.correction || "").slice(0, 1000),
    automaticallyVerified,
    outcome,
    requiresIndependentRecheck: suspiciousFlatScores,
  };
}

export function parseQaResponse(text: string, options: { garmentFamily?: string } = {}) {
  return normalizePoseQaResult(parseJsonResponse(text), options);
}

