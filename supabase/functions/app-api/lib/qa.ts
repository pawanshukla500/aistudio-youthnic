import { parseJsonResponse, type JsonRecord } from "./profiles.ts";

const CHECK_KEYS = [
  "model_face", "face_realism", "garment_identity", "colors", "fabric_texture", "print_pattern",
  "pattern_geometry", "embroidery_geometry", "front_back_design", "bottom_wear", "details_and_branding",
  "detail_placement", "absence_constraints", "fit_silhouette", "styling_continuity", "styling_addition",
  "pose_requirement", "unexpected_changes",
] as const;

// SKU-defining attributes. A garment can pass every other check and still be the
// wrong product if one of these drifts, so they carry double weight in the
// fidelity score and are gated on their own floor.
const CRITICAL_CHECKS: readonly string[] = [
  "garment_identity", "colors", "print_pattern", "pattern_geometry", "embroidery_geometry",
  "detail_placement", "absence_constraints",
];

// A generation model reinterprets prints and embroidery confidently enough that a
// boolean verdict misses it. These floors turn "looks like the same kind of
// garment" into a measurable failure that the existing retry path can act on.
const CRITICAL_SCORE_FLOOR = 85;
const OVERALL_FIDELITY_FLOOR = 88;

export function buildPoseQaPrompt(args: {
  poseNumber: number; poseType: string; poseTitle: string; poseDirection: unknown;
  productIdentity: unknown; creativeDirection: unknown; modelIdentity: unknown;
  consistencyRules: string[]; hasApprovedAnchor: boolean; hasModelReference: boolean; referenceManifest: string[];
}) {
  return `You are a strict fashion e-commerce consistency validator.

Review IMAGE A (the newly generated pose) against every labeled source image that follows it.
SOURCE PRIORITY: original FRONT/BACK/FABRIC/ADDITIONAL product references are authoritative for the garment. A MANNEQUIN or DRESS-FORM shot (if present) is authoritative for worn shape, fit, proportion, drape and how the garment falls on a body - validate silhouette and drape against it. A FLAT-LAY of the garment is authoritative only for outline, construction, panel layout and garment length: cloth photographed flat shows no worn drape, so never judge fit, proportion or drape against it. Under either presentation, never fail IMAGE A for showing the garment on a live human model instead of a mannequin, dress form, hanger or flat surface, and never expect that apparatus to appear. MODEL FACE REFERENCE (if present) is authoritative for the model's rendered facial appearance and outranks every other face source, including APPROVED POSE 1. APPROVED POSE 1 controls shoot continuity (scene, lighting, styling) always, and facial appearance only when no MODEL FACE REFERENCE was supplied. STYLE REFERENCE controls art direction only and must never override the product.

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
Score every check from 0 to 100 in "scores", where 100 is indistinguishable from the reference and below 85 means a buyer comparing the listing to the delivered garment would notice. Score honestly: a plausible, attractive reinterpretation scores low.

Check every field below. Perform localized comparisons of center-front closure, neckline, sleeve edges, front hem, center-back/rear hem, every decoration, bottom wear, and face. Fail any invented or moved button, tassel/latkan, closure, trim, pocket, logo, embroidery, jewelry, or hardware. For a back pose, fail unless it is a true back view matching the uploaded BACK; face_realism automatically passes for a back pose since the face is not visible. For pose 5 (the zoomed-in face & product detail highlight), fail pose_requirement if it is a full-body or wide shot that just repeats the hero framing instead of a genuine zoomed-in face-to-chest/face-to-waist crop, if the face is not sharp and clearly visible, if no real product detail is sharply highlighted in the same frame, or if the expression looks stiff or unnatural instead of a beautiful, cute, genuine Gen-Z smile or expression. If a stylist accessory suggestion was provided, fail styling_addition when it is missing, inconsistent across poses, or hides/replaces any garment detail, bottom wear, or footwear from the product references; pass styling_addition when no suggestion was provided and none was invented.

Face quality bar - fail face_realism for any of these even if everything else matches: plastic, waxy, airbrushed, or over-smoothed "beauty filter" skin instead of natural texture with visible pores; crossed, misaligned, asymmetric, glassy, or otherwise distorted/malformed eyes; unnaturally uniform, fused, extra, missing, or warped teeth; any blurring, warping, melting, or duplicated/misplaced facial features; or a mirror-symmetric "AI face" that does not read as a real photographed person. Give a specific, actionable correction for any face_realism or model_face failure (name the exact feature that is wrong).

Return STRICT JSON only:
{"pass":true,"score":100,"checks":{"model_face":"pass","face_realism":"pass","garment_identity":"pass","colors":"pass","fabric_texture":"pass","print_pattern":"pass","pattern_geometry":"pass","embroidery_geometry":"pass","front_back_design":"pass","bottom_wear":"pass","details_and_branding":"pass","detail_placement":"pass","absence_constraints":"pass","fit_silhouette":"pass","styling_continuity":"pass","styling_addition":"pass","pose_requirement":"pass","unexpected_changes":"pass"},"scores":{"garment_identity":100,"colors":100,"print_pattern":100,"pattern_geometry":100,"embroidery_geometry":100,"detail_placement":100,"absence_constraints":100,"fabric_texture":100,"front_back_design":100,"bottom_wear":100,"fit_silhouette":100,"model_face":100},"failed":[],"reason":"short verdict","correction":"specific correction prompt if failed"}`;
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

  // Anything under the floor is a rejection even when the validator called it a
  // pass: "attractive reinterpretation of the same style" is exactly the verdict
  // that used to ship as a finished catalogue image.
  const belowFloor = Object.entries(scores)
    .filter(([key, score]) => CRITICAL_CHECKS.includes(key) && score < CRITICAL_SCORE_FLOOR)
    .map(([key]) => key);
  for (const key of belowFloor) failed.add(key);
  const weakest = Object.entries(scores).sort((left, right) => left[1] - right[1]).slice(0, 3)
    .filter(([, score]) => score < 100)
    .map(([key, score]) => `${key} ${score}%`);
  const pass = raw.pass !== false && failed.size === 0 && productFidelity >= OVERALL_FIDELITY_FLOOR;
  const shortfall = !pass && !belowFloor.length && productFidelity < OVERALL_FIDELITY_FLOOR
    ? `Product fidelity ${productFidelity}% is below the ${OVERALL_FIDELITY_FLOOR}% floor.`
    : "";

  return {
    pass,
    score: productFidelity,
    productFidelity,
    scores,
    weakest,
    checks,
    failed: [...failed],
    reason: [
      String(raw.reason || (pass ? "All consistency checks passed." : [...failed].join(", "))),
      shortfall,
      weakest.length ? `Lowest matches: ${weakest.join(", ")}.` : "",
    ].filter(Boolean).join(" ").slice(0, 500),
    correction: String(raw.correction || "").slice(0, 1000),
  };
}

export function parseQaResponse(text: string) {
  return normalizePoseQaResult(parseJsonResponse(text));
}

