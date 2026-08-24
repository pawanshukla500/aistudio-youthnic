import { parseJsonResponse, type JsonRecord } from "./profiles.ts";

const CHECK_KEYS = [
  "model_face", "face_realism", "garment_identity", "colors", "fabric_texture", "print_pattern",
  "pattern_geometry", "embroidery_geometry", "front_back_design", "bottom_wear", "details_and_branding",
  "detail_placement", "absence_constraints", "fit_silhouette", "styling_continuity", "styling_addition",
  "pose_requirement", "unexpected_changes",
  "side_construction", "trim_location", "unknown_region_invention", "print_embroidery_continuation",
  "body_pallu_boundary", "duplicate_pallu", "drape_physics", "blouse_invention",
] as const;

// SKU-defining attributes. A garment can pass every other check and still be the
// wrong product if one of these drifts, so they carry double weight in the
// fidelity score and are gated on their own floor.
const CRITICAL_CHECKS: readonly string[] = [
  "garment_identity", "colors", "print_pattern", "pattern_geometry", "embroidery_geometry",
  "detail_placement", "absence_constraints",
  "side_construction", "trim_location", "unknown_region_invention", "print_embroidery_continuation",
  "body_pallu_boundary", "duplicate_pallu", "drape_physics", "blouse_invention",
];

// A critical attribute under this is worth surfacing, but on its own it is not
// grounds to spend another generation: a validator that cannot name the defect is
// hedging, not measuring.
const CRITICAL_SCORE_FLOOR = 85;
// This far below the reference is a claim rather than a hedge, so it fails even
// when the validator's prose says the frame is fine.
const SEVERE_SCORE_FLOOR = 60;
// Used only to mark a delivered frame as worth a visual check, never to reject.
const OVERALL_FIDELITY_FLOOR = 88;

export function buildPoseQaPrompt(args: {
  poseNumber: number; poseType: string; poseTitle: string; poseDirection: unknown;
  productIdentity: unknown; creativeDirection: unknown; modelIdentity: unknown;
  consistencyRules: string[]; hasApprovedAnchor: boolean; hasModelReference: boolean; referenceManifest: string[];
}) {
  return `You are a strict fashion e-commerce consistency validator.

Review IMAGE A (the newly generated pose) against every labeled source image that follows it.
SOURCE PRIORITY: original FRONT/BACK/FABRIC/ADDITIONAL product references are authoritative for the garment. A MANNEQUIN or DRESS-FORM shot (if present) is authoritative for worn shape, fit, proportion, drape and how the garment falls on a body - validate silhouette and drape against it. A FLAT-LAY of the garment is authoritative only for outline, construction, panel layout and garment length: cloth photographed flat shows no worn drape, so never judge fit, proportion or drape against it. Under either presentation, never fail IMAGE A for showing the garment on a live human model instead of a mannequin, dress form, hanger or flat surface, and never expect that apparatus to appear. MODEL FACE REFERENCE (if present) is authoritative for the model's rendered facial appearance and outranks every other face source, including APPROVED POSE 1. APPROVED POSE 1 controls shoot continuity (scene, lighting, styling) always, and facial appearance only when no MODEL FACE REFERENCE was supplied. In a catalog run that anchor may show a different colourway or SKU: judge set, lighting, camera and model against it, but never judge the garment against it - the product references alone decide the garment, and a garment that differs from the anchor is expected, not a defect. STYLE REFERENCE controls art direction only and must never override the product.

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
SCORING SCALE - anchor every number to these meanings, and never hand several attributes the same round number as a hedge:
- 100: indistinguishable from the reference.
- 95: the same garment; only rendering differences a photographer would accept.
- 85: one attribute a buyer comparing the listing to the delivered garment would notice.
- 70: clearly a different arrangement of the same idea - redrawn motifs, regrouped embroidery, shifted placement.
- 40: a different product in the same category.
A score below 85 on garment_identity, colors, print_pattern, pattern_geometry, embroidery_geometry, detail_placement, absence_constraints, side_construction, trim_location, unknown_region_invention, print_embroidery_continuation, body_pallu_boundary, duplicate_pallu, drape_physics, or blouse_invention asserts that something is actually wrong, so it MUST come with "fail" for that check in "checks" and the specific defect named in "correction". If you cannot name the defect, that attribute is not below 85 - score it honestly rather than defensively. Do not lower every score together to signal general uncertainty; an image you describe as matching must score as matching.

Check every field below. Perform localized comparisons of center-front closure, neckline, sleeve edges, front hem, center-back/rear hem, every decoration, bottom wear, and face. Fail any invented or moved button, tassel/latkan, closure, trim, pocket, logo, embroidery, jewelry, or hardware. For a back pose, fail unless it is a true back view matching the uploaded BACK; face_realism automatically passes for a back pose since the face is not visible. For pose 5 (the zoomed-in face & product detail highlight), fail pose_requirement if it is a full-body or wide shot that just repeats the hero framing instead of a genuine zoomed-in face-to-chest/face-to-waist crop, if the face is not sharp and clearly visible, if no real product detail is sharply highlighted in the same frame, or if the expression looks stiff or unnatural instead of a beautiful, cute, genuine Gen-Z smile or expression. Judge styling_addition against the approved styling plan in the session rules above: fail it when a listed piece is missing, when a piece appears that the plan does not list (an invented necklace, bangle, belt, bag or hair ornament), when the metal or family differs from the plan (gold where the plan says oxidised silver), when it changes between poses, or when it hides or replaces a garment detail, bottom wear or footwear from the product references. Pass it when the frame matches the plan exactly, or when no plan and no suggestion were provided and nothing was invented.

Face quality bar - fail face_realism for any of these even if everything else matches: plastic, waxy, airbrushed, or over-smoothed "beauty filter" skin instead of natural texture with visible pores; crossed, misaligned, asymmetric, glassy, or otherwise distorted/malformed eyes; unnaturally uniform, fused, extra, missing, or warped teeth; any blurring, warping, melting, or duplicated/misplaced facial features; or a mirror-symmetric "AI face" that does not read as a real photographed person. Give a specific, actionable correction for any face_realism or model_face failure (name the exact feature that is wrong).

Return STRICT JSON only:
{"pass":true,"score":100,"checks":{"model_face":"pass","face_realism":"pass","garment_identity":"pass","colors":"pass","fabric_texture":"pass","print_pattern":"pass","pattern_geometry":"pass","embroidery_geometry":"pass","front_back_design":"pass","bottom_wear":"pass","details_and_branding":"pass","detail_placement":"pass","absence_constraints":"pass","fit_silhouette":"pass","styling_continuity":"pass","styling_addition":"pass","pose_requirement":"pass","unexpected_changes":"pass","side_construction":"pass","trim_location":"pass","unknown_region_invention":"pass","print_embroidery_continuation":"pass","body_pallu_boundary":"pass","duplicate_pallu":"pass","drape_physics":"pass","blouse_invention":"pass"},"scores":{"garment_identity":100,"colors":100,"print_pattern":100,"pattern_geometry":100,"embroidery_geometry":100,"detail_placement":100,"absence_constraints":100,"fabric_texture":100,"front_back_design":100,"bottom_wear":100,"fit_silhouette":100,"model_face":100,"side_construction":100,"trim_location":100,"unknown_region_invention":100,"print_embroidery_continuation":100,"body_pallu_boundary":100,"duplicate_pallu":100,"drape_physics":100,"blouse_invention":100},"failed":[],"reason":"short verdict","correction":"Remove all vertical gold trim from the right side seam/opening. Keep the right side in plain red printed base fabric unless an original product reference proves otherwise. (Be extremely specific and preserve previous corrections)"}`;
}

export function normalizePoseQaResult(raw: JsonRecord) {
  const checks = raw.checks && typeof raw.checks === "object" ? raw.checks as JsonRecord : {};
  const rawScores = raw.scores && typeof raw.scores === "object" ? raw.scores as JsonRecord : {};
  const failed = new Set<string>();
  for (const key of CHECK_KEYS) if (String(checks[key] || "").toLowerCase() === "fail") failed.add(key);
  for (const value of Array.isArray(raw.failed) ? raw.failed : []) {
    const key = String(value || "").toLowerCase().replace(/[^a-z_]/g, "");
    if ((CHECK_KEYS as readonly string[]).includes(key)) failed.add(key);
  }
  if (typeof raw.pass !== "boolean" && Object.keys(checks).length === 0) throw new Error("QA returned no structured verdict.");

  // A per-attribute score is only trustworthy when the validator actually
  // returned one; otherwise it is derived from that attribute's verdict so an
  // older or terser response still produces a usable fidelity figure.
  const scores: Record<string, number> = {};
  for (const key of CHECK_KEYS) {
    const reported = Number(rawScores[key]);
    const verdict = String(checks[key] || "").toLowerCase();
    if (Number.isFinite(reported)) scores[key] = Math.max(0, Math.min(100, Math.round(reported)));
    else if (verdict === "fail") scores[key] = 0;
    else if (verdict === "pass") scores[key] = 100;
    else if (CRITICAL_CHECKS.includes(key)) {
      // A verdict that says nothing about an SKU-defining attribute is not
      // evidence that the attribute is right. Silence here used to average away:
      // one non-critical score could carry the whole frame to a passing figure.
      scores[key] = 0;
      failed.add(key);
    }
  }
  const weighted = Object.entries(scores).map(([key, score]) => ({ score, weight: CRITICAL_CHECKS.includes(key) ? 2 : 1 }));
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const productFidelity = totalWeight
    ? Math.round(weighted.reduce((sum, entry) => sum + entry.score * entry.weight, 0) / totalWeight)
    : Math.max(0, Math.min(100, Number(raw.score) || 0));

  // Any critical check scoring below CRITICAL_SCORE_FLOOR (85) causes the check
  // to fail and triggers the retry path, preventing drift. Severe scores (below
  // SEVERE_SCORE_FLOOR) remain separately classified to prioritize failure messages.
  const severe: string[] = [];
  const lowConfidence: string[] = [];
  for (const [key, score] of Object.entries(scores)) {
    if (!CRITICAL_CHECKS.includes(key) || score >= CRITICAL_SCORE_FLOOR) continue;
    failed.add(key);
    if (score < SEVERE_SCORE_FLOOR) {
      severe.push(key);
    } else {
      lowConfidence.push(`${key} ${score}%`);
    }
  }
  const weakest = Object.entries(scores).sort((left, right) => left[1] - right[1]).slice(0, 3)
    .filter(([, score]) => score < 100)
    .map(([key, score]) => `${key} ${score}%`);
  const pass = raw.pass !== false && failed.size === 0;
  const reviewRecommended = pass && (lowConfidence.length > 0 || productFidelity < OVERALL_FIDELITY_FLOOR);
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
      reviewRecommended ? "Delivered, but fidelity is not exact - worth a visual check against the product references." : "",
    ].filter(Boolean).join(" ").slice(0, 500),
    correction: String(raw.correction || "").slice(0, 1000),
  };
}

export function parseQaResponse(text: string) {
  return normalizePoseQaResult(parseJsonResponse(text));
}

