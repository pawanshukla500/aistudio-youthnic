import { parseJsonResponse, type JsonRecord } from "./profiles.ts";

const CHECK_KEYS = [
  "model_face", "face_realism", "garment_identity", "colors", "fabric_texture", "print_pattern",
  "front_back_design", "bottom_wear", "details_and_branding", "detail_placement",
  "absence_constraints", "fit_silhouette", "styling_continuity", "styling_addition",
  "pose_requirement", "unexpected_changes",
] as const;

export function buildPoseQaPrompt(args: {
  poseNumber: number; poseType: string; poseTitle: string; poseDirection: unknown;
  productIdentity: unknown; creativeDirection: unknown; modelIdentity: unknown;
  consistencyRules: string[]; hasApprovedAnchor: boolean; hasModelReference: boolean; referenceManifest: string[];
}) {
  return `You are a strict fashion e-commerce consistency validator.

Review IMAGE A (the newly generated pose) against every labeled source image that follows it.
SOURCE PRIORITY: original FRONT/BACK/FABRIC/ADDITIONAL product references are authoritative for the garment. MODEL FACE REFERENCE (if present) is authoritative for the model's face/identity and outranks every other face source, including APPROVED POSE 1. APPROVED POSE 1 controls shoot continuity (scene, lighting, styling) always, and model identity only when no MODEL FACE REFERENCE was supplied. STYLE REFERENCE controls art direction only and must never override the product.

Pose ${args.poseNumber}: ${args.poseTitle} (${args.poseType})
Approved pose requirement: ${JSON.stringify(args.poseDirection)}
Product Identity Profile: ${JSON.stringify(args.productIdentity)}
Creative Direction Profile: ${JSON.stringify(args.creativeDirection)}
Model Identity Lock: ${JSON.stringify(args.modelIdentity)}
Session rules:
${args.consistencyRules.map((rule) => `- ${rule}`).join("\n")}
Reference manifest:
${args.referenceManifest.join("\n")}

${args.hasModelReference
    ? `Compare IMAGE A against the MODEL FACE REFERENCE image at the facial-feature level - face shape, eyes, eyebrows, nose, lips, jawline, skin tone and texture, and hairstyle must match that reference as closely as photographically possible; this is a strict identity match, not just "a similar model". Fail model_face for any noticeable deviation, even a subtle one.${args.hasApprovedAnchor ? " Use APPROVED POSE 1 only to confirm scene, lighting, and styling continuity - never to judge the face." : ""}`
    : args.hasApprovedAnchor
      ? "Compare IMAGE A against the APPROVED POSE 1 reference at the facial-feature level - face shape, eyes, eyebrows, nose, lips, jawline, skin tone and texture, and hairstyle must all match the same person. Also confirm body proportions, styling, backdrop, lighting, and color treatment match."
      : "This is Pose 1. It must establish one specific, photorealistic, naturally beautiful adult face and a realistic, coherent shoot anchor."}

Check every field below. Perform localized comparisons of center-front closure, neckline, sleeve edges, front hem, center-back/rear hem, every decoration, bottom wear, and face. Fail any invented or moved button, tassel/latkan, closure, trim, pocket, logo, embroidery, jewelry, or hardware. For a back pose, fail unless it is a true back view matching the uploaded BACK; face_realism automatically passes for a back pose since the face is not visible. For pose 5 (the natural zoomed-out face & vibe shot), fail if it is a tight macro crop instead of a natural, zoomed-out shot with the outfit still readable, or if the expression looks stiff or unnatural instead of a beautiful, cute, genuine Gen-Z smile or expression. If a stylist accessory suggestion was provided, fail styling_addition when it is missing, inconsistent across poses, or hides/replaces any garment detail, bottom wear, or footwear from the product references; pass styling_addition when no suggestion was provided and none was invented.

Face quality bar - fail face_realism for any of these even if everything else matches: plastic, waxy, airbrushed, or over-smoothed "beauty filter" skin instead of natural texture with visible pores; crossed, misaligned, asymmetric, glassy, or otherwise distorted/malformed eyes; unnaturally uniform, fused, extra, missing, or warped teeth; any blurring, warping, melting, or duplicated/misplaced facial features; or a mirror-symmetric "AI face" that does not read as a real photographed person. Give a specific, actionable correction for any face_realism or model_face failure (name the exact feature that is wrong).

Return STRICT JSON only:
{"pass":true,"score":100,"checks":{"model_face":"pass","face_realism":"pass","garment_identity":"pass","colors":"pass","fabric_texture":"pass","print_pattern":"pass","front_back_design":"pass","bottom_wear":"pass","details_and_branding":"pass","detail_placement":"pass","absence_constraints":"pass","fit_silhouette":"pass","styling_continuity":"pass","styling_addition":"pass","pose_requirement":"pass","unexpected_changes":"pass"},"failed":[],"reason":"short verdict","correction":"specific correction prompt if failed"}`;
}

export function normalizePoseQaResult(raw: JsonRecord) {
  const checks = raw.checks && typeof raw.checks === "object" ? raw.checks as JsonRecord : {};
  const failed = new Set<string>();
  for (const key of CHECK_KEYS) if (String(checks[key] || "").toLowerCase() === "fail") failed.add(key);
  for (const value of Array.isArray(raw.failed) ? raw.failed : []) {
    const key = String(value || "").toLowerCase().replace(/[^a-z_]/g, "");
    if ((CHECK_KEYS as readonly string[]).includes(key)) failed.add(key);
  }
  if (typeof raw.pass !== "boolean" && Object.keys(checks).length === 0) throw new Error("QA returned no structured verdict.");
  const pass = raw.pass !== false && failed.size === 0;
  return {
    pass,
    score: Math.max(0, Math.min(100, Number(raw.score) || (pass ? 100 : 0))),
    checks,
    failed: [...failed],
    reason: String(raw.reason || (pass ? "All consistency checks passed." : [...failed].join(", "))).slice(0, 500),
    correction: String(raw.correction || "").slice(0, 1000),
  };
}

export function parseQaResponse(text: string) {
  return normalizePoseQaResult(parseJsonResponse(text));
}

