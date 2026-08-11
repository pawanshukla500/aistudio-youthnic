import { parseJsonResponse, type JsonRecord } from "./profiles.ts";

const CHECK_KEYS = [
  "model_face", "garment_identity", "colors", "fabric_texture", "print_pattern",
  "front_back_design", "bottom_wear", "details_and_branding", "detail_placement",
  "absence_constraints", "fit_silhouette", "styling_continuity", "pose_requirement",
  "unexpected_changes",
] as const;

export function buildPoseQaPrompt(args: {
  poseNumber: number; poseType: string; poseTitle: string; poseDirection: unknown;
  productIdentity: unknown; creativeDirection: unknown; modelIdentity: unknown;
  consistencyRules: string[]; hasApprovedAnchor: boolean; referenceManifest: string[];
}) {
  return `You are a strict fashion e-commerce consistency validator.

Review IMAGE A (the newly generated pose) against every labeled source image that follows it.
SOURCE PRIORITY: original FRONT/BACK/FABRIC/ADDITIONAL product references are authoritative. APPROVED POSE 1 is secondary and controls model identity and shoot continuity only. STYLE REFERENCE controls art direction only and must never override the product.

Pose ${args.poseNumber}: ${args.poseTitle} (${args.poseType})
Approved pose requirement: ${JSON.stringify(args.poseDirection)}
Product Identity Profile: ${JSON.stringify(args.productIdentity)}
Creative Direction Profile: ${JSON.stringify(args.creativeDirection)}
Model Identity Lock: ${JSON.stringify(args.modelIdentity)}
Session rules:
${args.consistencyRules.map((rule) => `- ${rule}`).join("\n")}
Reference manifest:
${args.referenceManifest.join("\n")}

${args.hasApprovedAnchor ? "The approved anchor must show the same recognizable person, hair, body proportions, styling, backdrop, lighting, and color treatment." : "This is Pose 1. It must establish a realistic, coherent model and shoot anchor."}

Check every field below. Perform localized comparisons of center-front closure, neckline, sleeve edges, front hem, center-back/rear hem, every decoration, bottom wear, and face. Fail any invented or moved button, tassel/latkan, closure, trim, pocket, logo, embroidery, jewelry, or hardware. For a back pose, fail unless it is a true back view matching the uploaded BACK. For a close-up, fail if the same face is not visible or hands/accessories obscure the selected detail.

Return STRICT JSON only:
{"pass":true,"score":100,"checks":{"model_face":"pass","garment_identity":"pass","colors":"pass","fabric_texture":"pass","print_pattern":"pass","front_back_design":"pass","bottom_wear":"pass","details_and_branding":"pass","detail_placement":"pass","absence_constraints":"pass","fit_silhouette":"pass","styling_continuity":"pass","pose_requirement":"pass","unexpected_changes":"pass"},"failed":[],"reason":"short verdict","correction":"specific correction prompt if failed"}`;
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

