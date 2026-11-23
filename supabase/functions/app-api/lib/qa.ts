import {
  CLOSEUP_PRODUCT_DETAIL,
  isAboveAnkleCropFraming,
  isTightCropFraming,
  parseJsonResponse,
  resolveAspectRatioLabel,
  resolveAspectRatioOrientation,
  resolveCloseupMode,
  sanitizePoseDirectionForAspectRatio,
  stripGroundedFeetForCroppedFrame,
  type JsonRecord,
  type RequestedHandheldProps,
  withRequestedPropsAllowed,
} from "./profiles.ts";
import { identityWithoutExpression } from "./expressionDirection.ts";
import { ADOPTABLE_SLOTS, isLowPosture, normalizeReferencePosture } from "./posePlanning.ts";
import { referencePoseDirectiveText, styleIdentityQuarantineText } from "./generationPrompt.ts";
import { effectiveBottomCutClass, FARSHI_SILHOUETTE_STRUCTURE, resolveBottomWearPresentation } from "./garmentPoses.ts";
import { isDirectBackProductRole } from "./referencePolicy.ts";
import { effectiveShowcaseShot } from "./showcaseFeature.ts";

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

const QA_BOTTOM_WEAR_CRITICAL_POSES = new Set(["full_front", "angled", "back", "showcase"]);

// Listing-grade gates are intentionally attribute-level: 90-94 needs a human,
// and anything below 90 fails even when the weighted average remains high.
const AUTO_PASS_FLOOR = 95;
const RETRY_FLOOR = 90;
const SEVERE_SCORE_FLOOR = 60;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function rearOnlyQaProductIdentity(value: unknown) {
  const product = record(value);
  const evidence = Array.isArray(product.garmentEvidence) ? product.garmentEvidence : [];
  const rearEvidence = evidence.filter((entry) => {
    const row = record(entry);
    return isDirectBackProductRole(String(row.sourceRole ?? row.source_role ?? "").trim().toLowerCase());
  }).map((entry) => {
    const row = record(entry);
    return {
      region: row.region ?? "",
      state: row.state ?? "unknown",
      visibleConstruction: row.visibleConstruction ?? "",
      visibleDecoration: row.visibleDecoration ?? "",
      closures: row.closures ?? "",
      explicitlyAbsent: Array.isArray(row.explicitlyAbsent) ? row.explicitlyAbsent : [],
      uncertainty: row.uncertainty ?? "",
      sourceRole: row.sourceRole ?? row.source_role ?? "",
    };
  });
  return {
    garmentFamily: product.garmentFamily ?? "",
    category: product.category ?? "",
    rearVisualAuthority: "Only the direct uploaded BACK / SAREE REAR-BACK DRAPE image in the manifest.",
    garmentEvidence: rearEvidence,
    unprovenRearRule: "No rear lace, trim, closure, border, motif, tassel, or blouse-back construction is valid unless the direct rear product image proves it.",
  };
}

function isSareeGarmentFamily(garmentFamily = ""): boolean {
  const normalized = garmentFamily.trim().toLowerCase();
  return normalized === "saree" || normalized.startsWith("saree_");
}

function qaKeys(garmentFamily = "", poseType = "", hasBottomWear = false, showcaseTightCrop = false) {
  const isSaree = isSareeGarmentFamily(garmentFamily);
  // A front/back score matters for every pose, but it becomes an SKU-critical
  // gate only when the output claims to be the true rear. This avoids making
  // legacy/front-only QA responses fail for an attribute that is not visible,
  // while preventing an 86-88 rear mismatch from averaging through.
  const genericCriticalChecks = poseType === "back"
    ? [...GENERIC_CRITICAL_CHECKS, "front_back_design"]
    : [...GENERIC_CRITICAL_CHECKS];
  // Only head-to-toe catalog frames must fail when recorded bottoms lose print
  // or cut. Creative is a "full or three-quarter editorial crop", closeup is
  // face-to-chest/waist, and a tight showcase detail crop on an upper region
  // also omits trousers.
  if (hasBottomWear && QA_BOTTOM_WEAR_CRITICAL_POSES.has(poseType) && !showcaseTightCrop) {
    genericCriticalChecks.push("bottom_wear");
  }
  return {
    checkKeys: isSaree ? [...GENERIC_CHECK_KEYS, ...SAREE_CHECK_KEYS] : [...GENERIC_CHECK_KEYS],
    criticalChecks: isSaree ? [...genericCriticalChecks, ...SAREE_CRITICAL_CHECKS] : genericCriticalChecks,
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
    anatomicalDefectDetected: false,
  };
}

export function qaStorageDisposition(args: { qaEnabled: boolean; qaUnavailable: boolean; outcome: string }) {
  return {
    preserveOutput: true,
    qaStatus: !args.qaEnabled || args.qaUnavailable ? "unverified" : args.outcome,
  };
}

export function hasAnatomicalDefectText(text: string): boolean {
  if (!text) return false;
  const matches = text.matchAll(/\b(?:(?:three|3|extra|duplicate|phantom|floating|third|missing|detached)\s+(?:[a-z]+\s+)?(?:hands?|arms?|limbs?|wrists?)|(?:severed\s+limb)|(?:extra|fused|malformed|detached|six|6)\s+(?:[a-z]+\s+)?fingers?)\b/gi);
  for (const match of matches) {
    const idx = match.index ?? 0;
    const prefix = text.slice(Math.max(0, idx - 80), idx).toLowerCase();
    // Preserve negation across comma-separated defect lists ("No extra hands, malformed fingers, or phantom limbs"),
    // while resetting at sentence punctuation and contrast conjunctions ("but", "however", "although", "though").
    const clause = prefix.split(/[.;!?]|\b(?:but|however|although|though)\b/i).pop() ?? "";
    const cues = Array.from(
      clause.matchAll(/\b(not\s+(?:free\s+of|without)|no|zero|without|neither|never|not|free\s+of)\b/gi),
    );
    const lastCue = cues.at(-1)?.[1]?.toLowerCase() ?? "";
    if (lastCue && !/^not\s+(?:free\s+of|without)$/.test(lastCue)) {
      continue;
    }
    return true;
  }
  return false;
}

export function appendRejectedAttemptHistory<T>(existing: T[], next: T, limit = 3): T[] {
  return [...existing, next].slice(-Math.max(1, limit));
}

/**
 * A BOTTOM WEAR label, bare or after "IMAGE n:", like composeGenerationPrompt's role check.
 * The fabric label's "not bottom-wear print" is not a bottom photo.
 */
function hasBottomReferenceLabel(labels: string[]): boolean {
  return labels.some((label) => /(?:^|:\s*)bottom\b/i.test(label));
}

/**
 * The posture match QA may honour. Like promptReferenceSlots (generationPrompt.ts),
 * a Farshi shoot never honours a low posture and no shoot honours walking, so a stale
 * plan cannot excuse a seated Farshi frame or a frozen stride. The directive is caller
 * text, reduced exactly as the prompt's REFERENCE POSE MATCH block states it.
 */
function qaReferencePoseMatch(match: { posture: string; directive: string } | undefined, farshiBottom: boolean) {
  if (!match) return null;
  const posture = normalizeReferencePosture(match.posture);
  if (posture === "none" || posture === "walking" || (farshiBottom && isLowPosture(posture))) return null;
  return { posture, directive: referencePoseDirectiveText(posture, match.directive), low: isLowPosture(posture) };
}

// The pose plan's own fields (StudioPose). A stored pose row also carries run state - earlier
// QA corrections, rejected attempts with their verdicts, reference manifests - and QA that
// read it repeated its previous verdict on every retry ("sixth consecutive failure").
const QA_POSE_PLAN_FIELDS = [
  // No "expression": each frame's expression and gaze are planned per frame (expressionDirection.ts), not by the stored pose.
  "id", "title", "description", "cameraAngle", "framing", "bodyPosition", "handPlacement",
  "highlightedDetails", "productVisibilityRules", "primaryReference", "purpose", "consistencyNotes", "prompt",
  "enabled", "referencePosture", "attitude", "poseNumber",
] as const;

/** Only the pose plan fields of a pose direction; anything that is not a record passes through. */
export function posePlanFieldsForQa(pose: unknown): unknown {
  if (!pose || typeof pose !== "object" || Array.isArray(pose)) return pose;
  const source = pose as Record<string, unknown>;
  return Object.fromEntries(QA_POSE_PLAN_FIELDS.filter((key) => key in source).map((key) => [key, source[key]]));
}

const HAIR_CLAUSE = /\bhair\b/i;

/**
 * A back view's pose plan without its hair clauses ("hair forward to clear back", "hair swept
 * forward over one shoulder"). Hair there is judged only by the back-view rule - is the garment
 * back visible? - because QA kept failing visible backs against the literal clause (BT218-Cat-Rama).
 */
export function withoutHairClauses(pose: unknown): unknown {
  if (!pose || typeof pose !== "object" || Array.isArray(pose)) return pose;
  return Object.fromEntries(Object.entries(pose as Record<string, unknown>).map(([key, value]) => {
    if (Array.isArray(value)) return [key, value.filter((item) => !(typeof item === "string" && HAIR_CLAUSE.test(item)))];
    if (typeof value !== "string" || !HAIR_CLAUSE.test(value)) return [key, value];
    const kept = value.split(/(?<=[,;.])\s+/).filter((part) => !HAIR_CLAUSE.test(part));
    return [key, kept.join(" ").replace(/[,;]\s*$/, "").trim()];
  }));
}

export function buildPoseQaPrompt(args: {
  poseNumber: number; poseType: string; poseTitle: string; poseDirection: unknown;
  productIdentity: unknown; creativeDirection: unknown; modelIdentity: unknown;
  garmentFamily: string; consistencyRules: string[]; hasApprovedAnchor: boolean; hasModelReference: boolean; referenceManifest: string[];
  bottomWearMode?: unknown; aspectRatio?: string; useStyleAsModelFace?: boolean;
  /** Set only for a Pose 4 / Pose 6 whose stored pose plan copies the STYLE REFERENCE posture. */
  referencePoseMatch?: { posture: string; directive: string };
  /**
   * isFarshiGeneration for the job (generationPrompt.ts), so QA's Farshi rules match the
   * prompt's. Omitted, Farshi is detected from productIdentity and the manifest alone.
   */
  farshi?: boolean;
  /** Props the product notes ask for (requestedHandheldProps); they must appear, not fail. */
  requestedProps?: RequestedHandheldProps;
}) {
  const planFields = posePlanFieldsForQa(args.poseDirection);
  const poseDirection = args.poseType === "back" ? withoutHairClauses(planFields) : planFields;
  // QA must judge the shoot as it was configured. A top-only shoot has no
  // coordinated bottom to match, so bottom-wear fidelity is not a gate there.
  const productRecord = record(args.productIdentity);
  const hasBottomReference = hasBottomReferenceLabel(args.referenceManifest);
  const bottomWear = resolveBottomWearPresentation({
    mode: args.bottomWearMode,
    productIdentity: args.productIdentity,
    skuName: String(productRecord.skuName ?? productRecord.sku_name ?? ""),
    productDetails: String(productRecord.productDetails ?? productRecord.product_details ?? ""),
    hasBottomReference,
  });
  const hasBottomWear = bottomWear.includesBottomWear;
  const farshiBottom = args.farshi ?? (hasBottomWear &&
    effectiveBottomCutClass(bottomWear.cutClass, hasBottomReference, {
      skuName: String(productRecord.skuName ?? productRecord.sku_name ?? ""),
      productDetails: String(productRecord.productDetails ?? productRecord.product_details ?? ""),
      details: bottomWear.details,
    }) === "farshi");
  const referenceMatch = qaReferencePoseMatch(args.referencePoseMatch, farshiBottom);
  const farshiStructureCheck = farshiBottom
    ? ` When the bottom is Farshi/Farsi/Fasi, also fail bottom_wear unless the worn trousers match this structure: ${FARSHI_SILHOUETTE_STRUCTURE} Fail a wide-open palazzo hem and fail a gathered salwar poncha. Do not fail the joined 6-inch hem panel itself.`
    : "";
  const hasStyleReference = args.referenceManifest.some((line) => line.includes("STYLE REFERENCE"));
  const useStyleFaceIdentity = !args.hasModelReference && hasStyleReference && Boolean(args.useStyleAsModelFace);
  const showcaseShot = effectiveShowcaseShot(record(args.creativeDirection), { includesBottomWear: hasBottomWear });
  const showcaseTightCrop = args.poseType === "showcase" && Boolean(
    showcaseShot &&
      (showcaseShot.shotType === "macro_detail" || showcaseShot.shotType === "half_body_detail") &&
      showcaseShot.plan.featureRegion !== "bottom_wear",
  );
  // A product-highlight close-up (analysis v38+) may crop the face out, like a macro crop.
  const productHighlight = args.poseType === "showcase" && Boolean(showcaseShot?.plan.productHighlight);
  const macroShowcase = args.poseType === "showcase" && (showcaseShot?.shotType === "macro_detail" || productHighlight);
  const { checkKeys, isSaree } = qaKeys(args.garmentFamily, args.poseType, hasBottomWear, showcaseTightCrop);
  const qaProductIdentity = args.poseType === "back" ? rearOnlyQaProductIdentity(args.productIdentity) : args.productIdentity;
  const exampleChecks = Object.fromEntries(checkKeys.map((key) => [key, "pass"]));
  const exampleScores = Object.fromEntries(checkKeys.map((key) => [key, 100]));
  const closeupMode = args.poseType === "closeup"
    ? resolveCloseupMode({
      pose: record(poseDirection),
      creative: record(args.creativeDirection),
    })
    : "";
  const closeupHeroDetail = String(record(args.creativeDirection).closeupHeroDetail || record(args.creativeDirection).closeup_hero_detail || "").trim();
  const productDetailCloseup = closeupMode === CLOSEUP_PRODUCT_DETAIL;
  const pose5Rule = args.poseType === "closeup"
    ? productDetailCloseup
      ? `For pose 5 (product-detail-first close-up${closeupHeroDetail ? `: ${closeupHeroDetail}` : ""}), fail pose_requirement if it is a full-body or wide shot that repeats the hero framing, if it is a face-only beauty crop that hides the selling detail, or if the named/key product detail is not large, sharp, and catalog-readable. Crucially, verify that the highlighted detail belongs to the PRIMARY UPLOADED PRODUCT GARMENT (e.g. kurti butti work, yoke embroidery, neckline craft); fail pose_requirement if the crop focuses on a secondary accessory like a dupatta when the primary garment has butti work or craftsmanship to showcase. Do NOT fail pose_requirement merely because the face is cropped out or only partially visible. If no recognizable face is in frame, pass face_realism. If a full or clearly readable face is in frame, apply the face quality bar. A cropped forehead/cheek at the edge of a detail crop is not a face_realism failure.`
      : `For pose 5 (face-and-product-detail close-up${closeupHeroDetail ? `: ${closeupHeroDetail}` : ""}), fail pose_requirement if it is a full-body or wide shot that just repeats the hero framing instead of a genuine zoomed-in face-to-chest/face-to-waist crop, if the face is not sharp and clearly visible, if the product detail is not LARGE and sharply highlighted in the same frame (a tiny sliver of embroidery under a beauty close-up is a fail), if the crop focuses on a secondary accessory like a dupatta instead of the primary garment's signature craftsmanship (e.g. kurti butti work or yoke embroidery), or if the expression is a frozen wide grin, a plastic smile, or a distorted face. A calm closed-mouth expression is acceptable.`
    : "";
  const pose6Rule = args.poseType === "showcase"
    ? productHighlight && showcaseShot
      ? `For pose 6 (product-highlight detail close-up: ${showcaseShot.plan.heroFeature} [${showcaseShot.plan.featureRegion}]), fail pose_requirement if it is a full-body or three-quarter frame instead of a tight close-up of that feature, if the feature is not large, sharp and unobstructed, if it shows Pose 5's subject${closeupHeroDetail ? ` (${closeupHeroDetail})` : ""} instead, or if any closure, trim, motif or seam of the feature differs from the product photos${showcaseShot.plan.featureRegion === "back_detail" ? " (the BACK PRODUCT image decides this back detail)" : ""}. Do NOT fail pose_requirement, model_face, or face_realism merely because the face is cropped out or only partially visible in this close-up.`
      : showcaseShot
      ? `For pose 6 (garment-led feature showcase: ${showcaseShot.plan.heroFeature} [${showcaseShot.plan.featureRegion} / ${showcaseShot.shotType}]), fail pose_requirement if the named hero feature (${showcaseShot.plan.heroFeature}) is not prominently, sharply, and aesthetically showcased, if the frame merely repeats Pose 1's static flat-frontal hero stance without angle/stance/framing divergence, or if it duplicates Pose 5's tight close-up crop${closeupHeroDetail ? ` on ${closeupHeroDetail}` : ""}.${macroShowcase ? " Do NOT fail pose_requirement, model_face, or face_realism merely because the face is cropped out or only partially visible in this macro_detail showcase crop." : ""}`
      : "For pose 6 (garment-led showcase), fail pose_requirement if it merely repeats Pose 1's static flat-frontal hero stance instead of presenting a distinct, aesthetic editorial angle/stance that highlights the garment's signature drape, silhouette, or set coordination."
    : "";
  // Live BT218-Cat-Rama run: hair that ended above a fully visible back neckline still failed
  // pose_requirement at 40% three times, because the plan says "swept forward over one shoulder".
  // The requirement is a readable garment back, however the hair achieves it.
  const backHairRule = args.poseType === "back"
    ? "For pose 3 (back view), judge hair placement by its purpose: pass it when the back neckline and the upper back panel are clearly visible, whether the hair is swept forward over a shoulder, up in a bun or ponytail, or ends above the neckline. Fail pose_requirement for hair only when it lies over the back neckline, the upper back or a rear detail. This overrides any hairstyle wording in the pose or styling plan (such as \"swept forward over one shoulder\"): a different way of keeping the back visible is not a failure. In this back view, never fail model_face because the hair was moved forward, tied or put up to clear the garment back: judge the hair there by colour and texture only."
    : "";
  // The Pose 2 prompt asks for a 35 to 45 degree turn (generationPrompt CURRENT FRAME POSE 2). The live
  // T94-Kitkat-Kattha run once delivered about 25 to 30 degrees and nothing here tested the turn itself.
  // The bounds sit about 5 to 10 degrees outside the planned range: a still image cannot be read more finely.
  const pose2Rule = args.poseType === "angled"
    ? "For pose 2 (turning three-quarter view), fail pose_requirement when the turn is outside the planned range on either side: the torso and hips face the camera square-on like Pose 1 or are turned less than about 30 degrees (both shoulders and both sides of the neckline still read at near-equal width), or they are turned more than about 55 degrees (the far shoulder is hidden or the front of the garment is mostly turned away), up to and including a full 90-degree profile. Pass a turn of roughly 35 to 45 degrees: the far shoulder and the far side of the neckline read clearly narrower than the near side yet both stay visible, and the side seam or side silhouette shows. The head may turn back toward the camera. State the turn you estimate in degrees in the reason."
    : "";
  const resolvedAspectRatio = resolveAspectRatioLabel(args.aspectRatio);
  const resolvedOrientation = resolveAspectRatioOrientation(resolvedAspectRatio);
  const orientationDescriptor = resolvedOrientation === "portrait" ? "vertical portrait" : resolvedOrientation;
  const qaPoseDirection = sanitizePoseDirectionForAspectRatio(poseDirection, resolvedAspectRatio);
  const isCroppedAboveAnklesPose = args.poseType === "closeup" ||
    showcaseTightCrop ||
    isAboveAnkleCropFraming(qaPoseDirection);
  const sanitizedQaPoseDirection = isCroppedAboveAnklesPose && qaPoseDirection && typeof qaPoseDirection === "object"
    ? (() => {
      const next = { ...(qaPoseDirection as Record<string, unknown>) };
      for (const key of ["bodyPosition", "description", "prompt"] as const) {
        if (typeof next[key] === "string" && next[key]) {
          next[key] = stripGroundedFeetForCroppedFrame(String(next[key])) || next[key];
        }
      }
      if (Array.isArray(next.productVisibilityRules)) {
        next.productVisibilityRules = next.productVisibilityRules
          .map((rule) =>
            typeof rule === "string" ? stripGroundedFeetForCroppedFrame(rule) : rule
          )
          .filter((rule) => !(typeof rule === "string" && rule.trim().length === 0));
      }
      return next;
    })()
    : qaPoseDirection;
  const requestedProps = args.requestedProps;
  const hasStyleReferenceLabel = args.referenceManifest.some((line) => /STYLE REFERENCE/i.test(line));
  const requestedPropsRule = requestedProps?.groups.length
    ? args.poseType === "closeup"
      ? `REQUESTED PROPS: the product notes ask for ${requestedProps.labels.join(" and ")} ("${requestedProps.note}"), but this Pose 5 craft crop keeps props out of frame. Fail pose_requirement only when a prop hides the craft detail.`
      : `REQUESTED PROPS: the product notes ask for ${requestedProps.labels.join(" and ")} ("${requestedProps.note}")${hasStyleReferenceLabel ? ", carried over from the STYLE REFERENCE" : ""}. Fail pose_requirement when a requested prop is missing${args.poseType === "back" ? " (in this back view a prop the body hides from behind is acceptable)" : args.poseType === "showcase" ? " (a tight detail crop that leaves the props out of frame is acceptable)" : ""}, ${hasStyleReferenceLabel ? "does not match the STYLE REFERENCE object" : "does not match what the notes describe"}${args.hasApprovedAnchor ? " or differs from the one APPROVED POSE 1 carries (when it shows one)" : ""} (a bag or drink taken from a product photo fails unless the product notes say it is sold with the product), is held by a hand not joined to a visible forearm, or covers the neckline, embroidery or print, side slits, hem or bottom-wear construction. Do not fail it for carrying the requested props.`
    : "";
  const prompt = `You are a strict fashion e-commerce consistency validator.

Review IMAGE A (the newly generated pose) against every labeled source image that follows it.
SOURCE PRIORITY: original region-labeled product references are authoritative for the garment and always outrank APPROVED POSE 1. For a saree, compare body/weave only with BODY/WEAVE and full-drape references, pallu only with FULLY SPREAD PALLU, borders/tassels only with BORDER/TASSELS, and blouse construction only with the matching BLOUSE reference. Never use APPROVED POSE 1 as saree product evidence. Legacy FRONT/BACK/FABRIC/ADDITIONAL product references remain valid for their proven regions. A MANNEQUIN or DRESS-FORM shot (if present) is authoritative for worn shape, fit, proportion, drape and how the garment falls on a body - validate silhouette and drape against it. A FLAT-LAY is authoritative only for outline, construction, panel layout and garment length. MODEL FACE REFERENCE outranks every other face source, including the STYLE REFERENCE face and any face in a product photo. APPROVED POSE 1 controls only model/styling/scene continuity and never garment identity. STYLE REFERENCE is the backdrop, wall, floor, set dressing, and lighting for every pose, including a back view. ${referenceMatch ? "The clothing and handheld props in the STYLE REFERENCE must be ignored; this frame intentionally matches its posture (see REFERENCE POSE MATCH below)." : "The clothing, posture, and handheld props in the STYLE REFERENCE must be ignored."} When a MODEL FACE REFERENCE is present, its face outranks the style-reference face: fail model_face if the generated face matches the style-reference person or a product-photo face instead. ${useStyleFaceIdentity ? "Because the user uploaded the same photo as both MODEL FACE REFERENCE and STYLE REFERENCE, the STYLE REFERENCE face is the model identity, including if the eyes are hidden: fail model_face if the generated person is different." : "When no MODEL FACE REFERENCE was uploaded, STYLE REFERENCE supplies ONLY the room, architecture, floor, and light — NEVER the person's face. Pose 1 establishes the fresh model face matching Model Identity Lock, and APPROVED POSE 1 locks that face across Poses 2-6. Never fail Pose 1 model_face because its face differs from the STYLE REFERENCE."} Fail styling_continuity when the visible backdrop matches a product-photo background instead of the STYLE REFERENCE.

Pose ${args.poseNumber}: ${args.poseTitle} (${args.poseType})
Requested Output Aspect Ratio: ${resolvedAspectRatio} (${orientationDescriptor} canvas - evaluate full-body framing in ${resolvedAspectRatio} ${resolvedOrientation} orientation; ${resolvedOrientation === "square" ? "evaluate 1:1 square framing directly" : `never fail pose_requirement or fit_silhouette merely because ${resolvedAspectRatio} is ${resolvedOrientation} rather than 1:1 square, or because a directional note used 'square' to mean straight-on to camera`}).
Approved pose requirement: ${JSON.stringify(sanitizedQaPoseDirection)}
Product Identity Profile: ${JSON.stringify(qaProductIdentity)}
Creative Direction Profile: ${JSON.stringify(args.creativeDirection)}
Model Identity Lock: ${JSON.stringify(identityWithoutExpression(args.modelIdentity))}
Session rules:
${args.consistencyRules.map((rule) => `- ${rule}`).join("\n")}
Reference manifest:
${args.referenceManifest.join("\n")}

This is a visual continuity review of rendered catalogue imagery. Judge only whether depicted appearance attributes look consistent between images - never identify, name, recognize, or infer personal attributes of any individual.

${args.hasModelReference
    ? args.poseType === "closeup"
      ? `Compare IMAGE A against the MODEL FACE REFERENCE on visual appearance attributes - face shape, eye shape and colour, eyebrow shape, nose shape, lip shape, jawline, skin tone and texture, and hairstyle must look consistent with that reference rather than merely similar. Fail model_face for any clear deviation or identity drift.${args.hasApprovedAnchor ? " Use APPROVED POSE 1 only to confirm scene, lighting, and styling continuity - never to judge the face." : ""}`
      : `Compare IMAGE A against the MODEL FACE REFERENCE on overall identity and recognisable facial proportions (face shape, jawline, eye and brow configuration, nose, lips, skin tone, and hairstyle): they must depict the SAME person, allowing normal camera-distance softening or lighting shifts on a full-body catalog frame. Fail model_face when the generated person looks like a different individual, has altered features, or matches the STYLE REFERENCE / product-photo person instead.${args.hasApprovedAnchor ? " Use APPROVED POSE 1 only to confirm scene, lighting, and styling continuity - never to judge the face." : ""}`
    : useStyleFaceIdentity
      ? `Compare IMAGE A against the STYLE REFERENCE face (uploaded identically in both Face Lock and Style Ref). The visible jaw, nose, lips, skin, and hair must be that same person. If the eyes are hidden in that photo, do not fail only because the generated eyes are visible, but fail model_face when the person is different. Ignore that image's clothing.${args.hasApprovedAnchor ? " APPROVED POSE 1 is scene continuity only." : ""}`
      : args.hasApprovedAnchor
        ? "Compare IMAGE A against the APPROVED POSE 1 reference on visual appearance attributes - face shape, eye shape and colour, eyebrow shape, nose shape, lip shape, jawline, skin tone and texture, and hairstyle must look consistent across the set. Also confirm body proportions, styling, backdrop, lighting, and colour treatment match."
        : "This is Pose 1 with no MODEL FACE REFERENCE uploaded. Cast one specific, photorealistic, naturally attractive adult face matching Model Identity Lock (do NOT compare Pose 1's face against STYLE REFERENCE — STYLE REFERENCE is room/lighting only). Pass model_face as long as Pose 1 shows a believable cohesive model face, and evaluate skin/eye/tooth naturalness strictly under face_realism."}
${args.hasApprovedAnchor ? "SET CONTINUITY: styling_continuity also covers the set. Fail it when the part of the set IMAGE A actually shows - backdrop wall colour or finish, floor, set dressing, light direction or colour grade - contradicts APPROVED POSE 1. A back view, close-up or seated frame is the same room from another camera position, never a different wall, backdrop or location. Judge only what the framing shows: a tight crop that hides the floor or props is not a failure." : ""}
${productDetailCloseup ? "This pose 5 crop may omit the face. Pass model_face when no recognizable face is in frame rather than failing for a missing beauty close-up. If a readable face is present, still compare it to the identity lock." : ""}${macroShowcase ? "This pose 6 macro_detail showcase crop may omit the face. Pass model_face and face_realism when no recognizable face is in frame rather than failing for a missing beauty close-up. If a readable face is present, still compare it to the identity lock." : ""}

PRODUCT FIDELITY - the failure mode that matters most here is a garment that reads as the same style but is not the same SKU. Judge it against the product references, not against your sense of what such a garment usually looks like:
- garment_identity: compare strictly with uploaded product references. Fail if the model is dressed in the outfit/clothing shown in the STYLE REFERENCE or MODEL FACE image instead of our uploaded product references, or if that garment was blended or copied onto the model, including a blend that keeps the product colour but copies the reference photo's butti, embroidery, sleeves, or neckline. The uploaded product's design, cut, prints, and colors must stay exactly as uploaded.
- pattern_geometry: compare motif shape, motif scale relative to the body, spacing, orientation, repeat interval and density PANEL BY PANEL. Upper-garment motifs against the FABRIC / PATTERN DETAIL and FRONT references. Bottom-wear motifs against FRONT, BACK, MANNEQUIN, ADDITIONAL, and BOTTOM WEAR / FARSHI references where the trousers/skirt are visible - never against an upper-only fabric close-up. Fail it when motifs are enlarged, simplified, redrawn, reduced to fewer larger shapes, re-angled, made denser or sparser, or when accent colours inside the print are missing - even when the print type and colour family are right. A perfect kurta with missing or miniaturized bottom print is still a fail.
- print_pattern: fail when a recorded bottom print is replaced by solid color, faint dots/speckles, or a different motif family, even if the upper garment matches.
- embroidery_geometry: compare the internal construction - lattice or motif structure, the count and rhythm of repeated units, borders, coverage area relative to the garment, and the relationship to neckline, tie, drawstring and tassel. Fail it when the embroidery is a different arrangement of the same craft, when unit count or shape changes, or when its coverage grows or shrinks.
- bottom_wear: when a separate bottom garment is recorded, this is SKU-critical on full_front, angled, and back. Creative three-quarter editorial crops and close-ups stay non-critical because they often omit trousers. Compare cut, volume, two-leg vs skirt structure, pleating, hem, fabric color, AND print/motif scale against the bottom-visible product references. Fail if Farshi/farsi pajama is flattened into palazzo (or farshi/farsi/fasi salwar replaced with palazzo), plain wide-leg, lehenga/skirt, dhoti, tulip, or ankle-cuffed salwar. Fail if two distinct trouser legs merge into a single circular skirt flare. Fail if large-scale florals/bootas become solid color, faint dots, speckles, or micro-print, or if bold chevron/zigzag prints are miniaturized, blurred, or replaced by plain solid color. A high face/kurta score cannot rescue a wrong bottom.${farshiStructureCheck}
- side_construction: verify side seams, slits, and closures strictly against the references. Fail if a side slit, opening, or side trim is invented where it wasn't explicitly proven.
- trim_location: verify that trim (lace, border, piping) only appears exactly where proven. Fail if, for example, hem trim extends vertically up a side seam.
- unknown_region_invention: fail if any explicitly "unknown" or unproven region contains invented product-defining construction or decoration. UNKNOWN DOES NOT MEAN INFER. Unknown means plain base fabric without unproven decoration.
- print_embroidery_continuation: fail if embroidery or print is mirrored or extended into unproven regions (e.g. extending front neckline embroidery down the back, or mirroring it).
- front_back_design: for a back pose, treat the uploaded BACK/REAR product reference as a veto. Fail if a front-only lace, border, closure, neckline detail, print, embroidery or hem treatment appears on the rear without direct confirmed back evidence, even when the rest of the image is visually convincing.
- body_pallu_boundary: for sarees, fail if pallu motifs bleed into the saree body, or vice versa.
- duplicate_pallu: for sarees, fail if multiple loose cloth panels are invented (a saree has exactly one pallu).
- drape_physics: for sarees, fail if heavy fabric floats like weightless chiffon, or if the drape does not behave like the specified fabric.
- blouse_invention: for sarees, fail if an ornate or decorated stitched blouse back/front (embroidery, prints, contrasts, dori ties, keyholes, cutouts, or borders) is invented when only an unstitched piece or blouseless mannequin wrap was shown; a plain, undecorated modest solid matching/tonal basic blouse paired cleanly over an otherwise blouseless mannequin wrap is acceptable so long as Pose 1 and rear Pose 4 preserve that same plain modest solid construction without invented back ornamentation.
${isSaree ? `SAREE LISTING-GRADE CHECKS - compare each named field directly with the ORIGINAL region-specific product evidence, never with APPROVED POSE 1:
- saree_body_color: exact base and secondary colours, including colour treatment under the same lighting.
- saree_weave_geometry: exact weave/lattice family, unit geometry, scale and repeat (compare across BOTH full-drape product images AND any close-up fabric swatches; on wide full-body or knees-up frames allow normal camera-distance softening plus authentic chest/pallu-transition motif shifts visible on the full-drape product reference).
- saree_motif_inventory: every peacock, floral and other motif present or confirmed absent.
- saree_motif_scale: motif size relative to the body and border (allowing normal camera-distance softening on wide full-body or knees-up frames so long as macro scale matches the full-drape product reference).
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

Check every field below. Perform localized comparisons of center-front closure, neckline, sleeve edges, front hem, center-back/rear hem, every decoration, bottom wear, and face when a recognizable face is in frame. Fail any invented or moved garment construction/surface detail (button, tassel/latkan, closure, trim, pocket, logo, embroidery, garment-sewn beadwork/jewelry, or hardware) under absence_constraints or details_and_branding. Do NOT fail absence_constraints or details_and_branding for stylist-worn personal accessories (earrings, bangles, bindi, footwear); evaluate wearer accessories strictly under styling_addition and styling_continuity below. For a back pose, fail unless it is a true back view matching the uploaded BACK; face_realism automatically passes for a back pose since the face is not visible. On a true back pose, do NOT fail pose_requirement, styling_addition, or styling_continuity for natural short or nape-length hair sitting cleanly above an unobstructed rear blouse neckline, cutout, tie/dori, back embroidery, and pallu—only fail back hair placement when hair actually drapes across and conceals rear construction details. ${pose5Rule}${pose6Rule ? `${pose5Rule ? " " : ""}${pose6Rule}` : ""}${backHairRule ? ` ${backHairRule}` : ""}${pose2Rule ? ` ${pose2Rule}` : ""} Judge styling_addition against the approved styling plan in the session rules above: fail it when a listed primary piece is missing, when a prominent unapproved accessory appears that the plan does not list and the STYLE REFERENCE does not show (such as an invented heavy necklace, belt, bag, nose ring, maang tikka or statement hair ornament), when the footwear category/heel height or metal family clearly contradicts the plan (sneaker or tall heel where flat jutti is specified, or oxidised silver where gold is specified), when accessories or footwear change noticeably between poses, or when it hides or replaces a garment detail, bottom wear or footwear from the product references. ${hasStyleReference ? "When a STYLE REFERENCE is present and the model wears subtle personal accents consistent with the STYLE REFERENCE (such as small stud/minimal earrings, a small forehead bindi, or slight bangle count variation within the approved colour/metal family) that do not obscure any garment neckline/embroidery/border, do NOT fail styling_addition, absence_constraints, details_and_branding, or unexpected_changes merely for those subtle style-reference accents. " : ""}When footwear is a stylist addition rather than an uploaded product photo, do NOT fail styling_addition or unexpected_changes merely for minor embroidery density variations within the approved footwear family, colour, and silhouette. Do NOT fail styling_addition, styling_continuity, unexpected_changes, or pose_requirement merely because approved footwear is naturally hidden underneath a floor-length saree, lehenga, gown, or anarkali hem, or lies outside an approved knees-up/half-body/detail crop—only fail footwear when visible footwear contradicts the approved plan or changes noticeably where shoes are shown. Pass it when the frame aligns with the plan at category, colour/metal, and silhouette level, or when no plan and no suggestion were provided and nothing was invented.

Fail pose_requirement when the body is frozen in a walking stride, one foot is lifted mid-step, or the legs are split wide enough to open a joined hem. A planted three-quarter turn is valid.${isCroppedAboveAnklesPose ? " ABOVE-ANKLE CROP EXEMPTION: Because the planned framing or category intentionally crops above the ankles (e.g., knees-up, three-quarter, waist-up, or detail crop), do NOT fail pose_requirement, bottom_wear, styling_addition, or unexpected_changes merely because feet, lower pleats, or footwear lie below the crop edge." : ""}
${referenceMatch
    ? `REFERENCE POSE MATCH: this frame intentionally matches the STYLE REFERENCE person's ${referenceMatch.posture} posture (${useStyleFaceIdentity ? styleIdentityQuarantineText(referenceMatch.directive) : referenceMatch.directive}). Do not fail pose_requirement for matching that posture, its support, or its signature styling.${referenceMatch.low ? ` LOW-POSTURE EXEMPTION: folds and compression of the garment and bottom wear caused by the ${referenceMatch.posture} posture are expected. Judge the bottom wear's cut, print and colour, not its drape length, and do not fail bottom_wear or fit_silhouette for that posture-driven compression.` : ""} Still fail garment_identity when the reference clothing is copied, ${useStyleFaceIdentity ? "" : "model_face when the reference face is copied, "}and pose_requirement when handheld objects (coffee cups, mugs, bottles, tote bags, handbags, sunglasses, phones) are copied from the STYLE REFERENCE, the MODEL FACE photo, or APPROVED POSE 1. Fail pose_requirement when this frame repeats Pose 1's static flat-frontal standing stance and framing.`
    : "Fail pose_requirement when the stance, foreground pillar-leaning placement, or handheld objects (coffee cups, mugs, bottles, tote bags, handbags, sunglasses, phones) are copied from the STYLE REFERENCE, the MODEL FACE photo, or APPROVED POSE 1. Those images supply the room and/or face, not a pose to repeat and not handheld props. Fail pose_requirement when Pose 2, Pose 4, or Pose 6 repeats Pose 1's static flat-frontal standing stance and framing without clear physical pose divergence."}
${requestedPropsRule}
ANATOMICAL REALISM - apply to every pose and every crop, including true back views and faceless macro/detail frames. Inspect every visible arm, forearm, wrist, hand, finger, and other limb. Fail pose_requirement for THREE HANDS, EXTRA HANDS, EXTRA ARMS, DUPLICATE OR PHANTOM LIMBS, duplicate wrists, malformed or extra fingers, hands poking impossibly through phantom slits in solid saree pallus/pleats/dupattas/kurta panels, floating hands resting on waist/hip/drape without a continuous anatomical forearm connection, awkward unnatural forearm clawing/pinching, fingers covering chest/yoke embroidery in closeup/hero shots, or stiff splayed mannequin-like plastic arms/fingers. Do not fail merely because a limb is naturally occluded or outside the crop. This anatomy veto is independent of face visibility and still applies when model_face and face_realism pass automatically.

Face quality bar - apply only when a recognizable face is in frame. model_face judges identity only (face structure, eyes, brows, nose, lips, skin, hair): never fail it because the expression, gaze direction or head angle differs from the identity photo or APPROVED POSE 1 - each frame has its own planned look. Fail face_realism for a frozen mannequin stare or a fixed stock smile. For a true back pose or a product-detail-first close-up with no recognizable face, pass face_realism and model_face; do not fail for a missing face. When a face is visible (including a clearly readable partial face or a back-pose over-shoulder glance), fail face_realism for any of these even if everything else matches: plastic, waxy, airbrushed, or over-smoothed "beauty filter" skin instead of natural texture with visible pores; crossed, misaligned, asymmetric, glassy, or otherwise distorted/malformed eyes; unnaturally uniform, fused, extra, missing, or warped teeth; any blurring, warping, melting, or duplicated/misplaced facial features; or a mirror-symmetric "AI face" that does not read as a real photographed person. Also fail face_realism when the frame as a whole reads as generated rather than photographed: a glossy CGI or 3D-render finish, HDR glow, or a pasted-on subject with halo edges. Give a specific, actionable correction for any face_realism or model_face failure (name the exact feature that is wrong).

Return STRICT JSON only:
${JSON.stringify({ pass: true, score: 100, checks: exampleChecks, scores: exampleScores, failed: [], reason: "short evidence-based verdict", correction: "specific correction for every failed field" })}`;
  // A craft crop keeps props out of frame, so its QA keeps the general no-props rules.
  return requestedProps && args.poseType !== "closeup" ? withRequestedPropsAllowed(prompt, requestedProps) : prompt;
}

const SALVAGE_TOLERABLE_BORDERLINE_CHECKS = new Set([
  "pose_requirement",
  "fit_silhouette",
  "absence_constraints",
  "details_and_branding",
  "styling_addition",
  "unexpected_changes",
  "styling_continuity",
]);
const WIDE_SAREE_PATTERN_SOFTENING_CHECKS = new Set([
  "saree_weave_geometry",
  "saree_motif_scale",
  "print_pattern",
  "pattern_geometry",
]);
const SAREE_CORE_LOCK_CHECKS = [
  "saree_body_color",
  "saree_motif_inventory",
  "saree_pallu_artwork",
  "saree_border_geometry",
  "saree_blouse_construction",
] as const;
const SALVAGE_HARD_FAIL_KEYS = new Set([
  "garment_identity",
  "duplicate_pallu",
  "blouse_invention",
  "body_pallu_boundary",
  "face_realism",
  "model_face",
]);

/**
 * Determine whether a pose that exhausted all QA retries still depicts an
 * authentic, anatomically sound product match that should be preserved for
 * human QC ("requires_human_review") instead of discarding the entire shoot.
 */
export function canSalvageExhaustedPoseQa(
  qa: {
    productFidelity?: number;
    scores?: Record<string, number>;
    failed?: string[];
    severe?: string[];
    reason?: string;
    correction?: string;
    anatomicalDefectDetected?: boolean;
  },
  options: {
    garmentFamily?: string;
    poseType?: string;
    hasBottomWear?: boolean;
    creativeDirection?: unknown;
    poseDirection?: unknown;
    isTightShowcaseCrop?: boolean;
  } = {},
): boolean {
  if (!qa || typeof qa !== "object") return false;
  if (qa.anatomicalDefectDetected === true) return false;
  const textFeedback = `${String(qa.reason || "")} ${String(qa.correction || "")}`;
  if (hasAnatomicalDefectText(textFeedback)) return false;
  const scores = qa.scores && typeof qa.scores === "object" ? qa.scores : {};
  const failed = Array.isArray(qa.failed) ? qa.failed : [];
  const severe = Array.isArray(qa.severe) ? qa.severe : [];
  if (severe.length > 0) return false;
  if (Number(qa.productFidelity ?? 0) < 88) return false;
  if (Number(scores.pose_requirement ?? 100) <= SEVERE_SCORE_FLOOR) return false;
  if (options.poseType === "back" && (failed.includes("front_back_design") || Number(scores.front_back_design ?? 100) < 85)) {
    return false;
  }
  if (failed.some((key) => SALVAGE_HARD_FAIL_KEYS.has(key))) return false;
  const isSareeFamily = isSareeGarmentFamily(String(options.garmentFamily || ""));
  if (isSareeFamily && failed.includes("bottom_wear")) return false;
  if (options.hasBottomWear && Number(scores.bottom_wear ?? 100) < 85) return false;
  const showcaseShot = options.poseType === "showcase"
    ? effectiveShowcaseShot(record(options.creativeDirection), { includesBottomWear: Boolean(options.hasBottomWear) })
    : null;
  const rawShowcaseShotType = String(
    showcaseShot?.shotType ??
      record(options.creativeDirection).showcaseShotType ??
      record(options.creativeDirection).shotType ??
      "",
  ).trim().toLowerCase();
  const isTightDetailShowcase = options.poseType === "showcase" && (
    options.isTightShowcaseCrop === true ||
    rawShowcaseShotType === "macro_detail" ||
    rawShowcaseShotType === "half_body_detail"
  );
  const isTightFramingCrop = isTightCropFraming(options.poseDirection) ||
    isTightCropFraming(options.creativeDirection);
  // On wide/editorial saree frames (never Pose 5 close-ups or tight Pose 6 detail crops),
  // camera distance slightly softens small lattice repeats even when color, motifs, pallu,
  // and borders match at >= 92%; allow those pattern fields down to 80% for human QC.
  const canAllowWideSareePatternSoftening = isSareeFamily &&
    options.poseType !== "closeup" &&
    !isTightDetailShowcase &&
    !isTightFramingCrop &&
    Number(qa.productFidelity ?? 0) >= 92 &&
    Number(scores.garment_identity ?? 100) >= 92 &&
    Number(scores.colors ?? 100) >= 92 &&
    !failed.includes("colors") &&
    SAREE_CORE_LOCK_CHECKS.every((key) => {
      const score = scores[key];
      return typeof score === "number" && Number.isFinite(score) && score >= 92 && !failed.includes(key);
    });
  for (const [key, value] of Object.entries(scores)) {
    const floor = SALVAGE_TOLERABLE_BORDERLINE_CHECKS.has(key)
      ? 75
      : (canAllowWideSareePatternSoftening && WIDE_SAREE_PATTERN_SOFTENING_CHECKS.has(key))
        ? 80
        : 85;
    if (Number(value) < floor) return false;
  }
  return true;
}

export function normalizePoseQaResult(raw: JsonRecord, options: { garmentFamily?: string; poseType?: string; hasBottomWear?: boolean; productIdentity?: unknown; bottomWearMode?: unknown; creativeDirection?: unknown; hasBottomReference?: boolean } = {}) {
  const productRecord = record(options.productIdentity);
  const hasBottomWear = options.hasBottomWear ??
    resolveBottomWearPresentation({
      mode: options.bottomWearMode,
      productIdentity: options.productIdentity,
      skuName: String(productRecord.skuName ?? productRecord.sku_name ?? ""),
      productDetails: String(productRecord.productDetails ?? productRecord.product_details ?? ""),
      hasBottomReference: options.hasBottomReference,
    }).includesBottomWear;
  const showcaseShot = effectiveShowcaseShot(record(options.creativeDirection), { includesBottomWear: hasBottomWear });
  const showcaseTightCrop = options.poseType === "showcase" && Boolean(
    showcaseShot &&
      (showcaseShot.shotType === "macro_detail" || showcaseShot.shotType === "half_body_detail") &&
      showcaseShot.plan.featureRegion !== "bottom_wear",
  );
  const { checkKeys, criticalChecks } = qaKeys(options.garmentFamily, options.poseType, hasBottomWear, showcaseTightCrop);
  const checks = raw.checks && typeof raw.checks === "object" ? raw.checks as JsonRecord : {};
  const rawScores = raw.scores && typeof raw.scores === "object" ? raw.scores as JsonRecord : {};
  const failed = new Set<string>();
  for (const key of checkKeys) if (String(checks[key] || "").toLowerCase() === "fail") failed.add(key);
  for (const value of Array.isArray(raw.failed) ? raw.failed : []) {
    const key = String(value || "").toLowerCase().replace(/[^a-z_]/g, "");
    if (checkKeys.includes(key as never)) failed.add(key);
  }
  const textFeedback = `${String(raw.reason || "")} ${String(raw.correction || "")}`;
  const hasAnatomyDefect = hasAnatomicalDefectText(textFeedback);
  if (hasAnatomyDefect) {
    failed.add("pose_requirement");
    checks["pose_requirement"] = "fail";
  }
  if (typeof raw.pass !== "boolean" && Object.keys(checks).length === 0) throw new Error("QA returned no structured verdict.");

  // A per-attribute score is only trustworthy when the validator actually
  // returned one; otherwise it is derived from that attribute's verdict so an
  // older or terser response still produces a usable fidelity figure.
  const scores: Record<string, number> = {};
  for (const key of checkKeys) {
    const rawVal = rawScores[key];
    const hasNumeric = typeof rawVal === "number" || (typeof rawVal === "string" && rawVal.trim() !== "");
    const reported = hasNumeric ? Number(rawVal) : Number.NaN;
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
  if (hasAnatomyDefect) {
    scores["pose_requirement"] = Math.min(scores["pose_requirement"] ?? 40, 40);
  }
  const weighted = Object.entries(scores).map(([key, score]) => ({ score, weight: criticalChecks.includes(key) ? 2 : 1 }));
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const productFidelity = totalWeight
    ? Math.round(weighted.reduce((sum, entry) => sum + entry.score * entry.weight, 0) / totalWeight)
    : Math.max(0, Math.min(100, Number(raw.score) || 0));

  const severe: string[] = [];
  const lowConfidence: string[] = [];
  for (const [key, score] of Object.entries(scores)) {
    if (!criticalChecks.includes(key) && key !== "pose_requirement") continue;
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
  const flatClusterMin = sortedCriticalScores.length <= 14
    ? 6
    : Math.ceil(sortedCriticalScores.length * 0.72);
  const belowAutoPassCritical = sortedCriticalScores.filter((score) => score < AUTO_PASS_FLOOR);
  const suspiciousFlatScores = belowAutoPassCritical.some((floor, index) => {
    let end = index;
    while (end < belowAutoPassCritical.length && belowAutoPassCritical[end] - floor <= 2) end += 1;
    return end - index >= flatClusterMin;
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
    anatomicalDefectDetected: hasAnatomyDefect,
  };
}

export function parseQaResponse(text: string, options: { garmentFamily?: string; poseType?: string; hasBottomWear?: boolean; productIdentity?: unknown; bottomWearMode?: unknown; creativeDirection?: unknown; hasBottomReference?: boolean } = {}) {
  return normalizePoseQaResult(parseJsonResponse(text), options);
}

// Product DNA consistency: a short, always-on garment check run on every pose
// before it is accepted. Full pose QA (opt-in) scores the same attributes, so
// its verdict is derived from those scores instead of a second call.
export const DNA_CONSISTENCY_VERSION = "dna-consistency-v1";
export const DNA_ATTRIBUTES = ["shape", "color", "material", "logo", "details"] as const;
export type DnaAttribute = typeof DNA_ATTRIBUTES[number];
export const DNA_ATTRIBUTE_PASS_FLOOR = 85;

export type DnaConsistencyResult = {
  version: typeof DNA_CONSISTENCY_VERSION;
  pass: boolean;
  unavailable: boolean;
  scores: Record<DnaAttribute, number | null>;
  failed: DnaAttribute[];
  /** Mean of the applicable (non-null) attribute scores. */
  score: number | null;
  correction: string;
  source: "dna_check" | "pose_qa" | "unavailable";
  reason: string;
};

const DNA_ATTRIBUTE_LABELS: Record<DnaAttribute, string> = {
  shape: "shape/silhouette",
  color: "colour",
  material: "material/fabric texture",
  logo: "logo/branding/labels",
  details: "details (embroidery, print, trims, placement)",
};

const DNA_PRODUCT_FACT_KEYS = [
  "garmentFamily", "category", "mainColor", "secondaryColors", "fabric", "texture", "pattern", "print",
  "embroidery", "logos", "silhouette", "fit", "length", "neckline", "sleeveType", "bottomWearDetails", "invariantDetails",
];

// Pose 3 is checked against rearOnlyQaProductIdentity, as full QA is: front-only facts would fail a correct back.
const DNA_REAR_FACT_KEYS = ["garmentFamily", "category", "garmentEvidence", "unprovenRearRule"];

/** Compact fact text: arrays joined, objects as "key: value" pairs with empty fields dropped. */
function dnaFactText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(dnaFactText).filter(Boolean).join(value.some((entry) => entry && typeof entry === "object") ? " | " : ", ");
  }
  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, entry]) => [key, dnaFactText(entry)])
      .filter(([, text]) => text).map(([key, text]) => `${key}: ${text}`).join("; ");
  }
  return String(value ?? "");
}

export function buildDnaConsistencyPrompt(args: {
  productIdentity: unknown;
  skuName: string;
  pose: { id: string; title: string };
  /** Labels of the images sent after IMAGE A, in order (IMAGE 1, IMAGE 2, ...). */
  referenceLabels: string[];
  /** The job's bottom-wear mode, resolved exactly as buildPoseQaPrompt does. */
  bottomWearMode?: unknown;
  /** The honoured adopted STYLE REFERENCE posture of a Pose 4 / Pose 6, passed by the worker. */
  referencePosture?: string;
}): string {
  const product = record(args.productIdentity);
  const back = args.pose.id === "back";
  const posture = (ADOPTABLE_SLOTS as readonly string[]).includes(args.pose.id) ? normalizeReferencePosture(args.referencePosture) : "none";
  // A top-only shoot renders plain neutral bottoms, so bottom wear is not product DNA there.
  const hasBottomWear = resolveBottomWearPresentation({
    mode: args.bottomWearMode,
    productIdentity: product,
    skuName: args.skuName,
    productDetails: String(product.productDetails ?? product.product_details ?? ""),
    hasBottomReference: hasBottomReferenceLabel(args.referenceLabels),
  }).includesBottomWear;
  const topOnly = !hasBottomWear && !isSareeGarmentFamily(String(product.garmentFamily ?? ""));
  const factSource: JsonRecord = back ? rearOnlyQaProductIdentity(product) : product;
  const facts = Object.fromEntries((back ? DNA_REAR_FACT_KEYS : DNA_PRODUCT_FACT_KEYS).flatMap((key) => {
    if (key === "bottomWearDetails" && !hasBottomWear) return [];
    const text = dnaFactText(factSource[key]).replace(/\s+/g, " ").trim().slice(0, key === "garmentEvidence" ? 500 : 160);
    return text ? [[key, text]] : [];
  }));
  const rearView = back
    ? " This is a BACK view: judge only what a rear view can show. Front-only details (front embroidery or print, neckline, front placket or opening, front logos) are not expected and are not failures; a rear detail counts only when a BACK product image proves it. Set logoApplicable false when the product shows no logo on its back."
    : "";
  // Mirrors buildPoseQaPrompt's LOW-POSTURE EXEMPTION.
  const lowPosture = isLowPosture(posture)
    ? ` LOW-POSTURE EXEMPTION: this frame intentionally uses a ${posture} posture, so folds and compression of the garment${hasBottomWear ? " and bottom wear" : ""} caused by it are expected. Score shape on the cut and silhouette of the visible garment${hasBottomWear ? ", and the bottom wear on its cut, print and colour, not its drape length" : ""}; do not fail shape for that posture-driven compression.`
    : "";
  return `You are a strict product-DNA checker for a fashion catalog (${String(args.skuName || "this SKU").slice(0, 120)}).
IMAGE A is the generated image (${String(args.pose.title || args.pose.id).slice(0, 120)} [${args.pose.id}]). The labeled images after it:
${args.referenceLabels.map((label, index) => `IMAGE ${index + 1}: ${label}`).join("\n")}
Compare ONLY the garment worn in IMAGE A with the PRODUCT references. The STYLE REFERENCE, MODEL FACE REFERENCE and APPROVED POSE 1 are not product evidence: ignore their clothing. Ignore pose, face, background and lighting. A part hidden by the pose or crop is not a failure.${topOnly ? " This shoot is top-only: ignore the bottom garment." : ""}${rearView}${lowPosture}
Product facts (the product images win on any conflict): ${JSON.stringify(facts)}
Score each attribute 0-100 (100 identical, 85 lowest acceptable, below 85 fails):
- shape: silhouette, cut, length, fit, neckline, sleeves${hasBottomWear ? ", bottom-wear structure" : ""}.
- color: base and accent colours.
- material: fabric type, texture, sheen, transparency.
- logo: logos, branding, labels. Set logoApplicable false when the product references show none.
- details: embroidery, print/motif geometry and scale, trims, borders, closures and their placement.
Return STRICT JSON only: {"scores":{"shape":<0-100>,"color":<0-100>,"material":<0-100>,"logo":<0-100>,"details":<0-100>},"logoApplicable":true|false,"failed":["<attribute>"],"verdict":"pass"|"fail","correction":"one specific fix per failed attribute"}`;
}

function dnaNumber(value: unknown): number | null {
  // "92%" and "92" are both 92.
  const text = typeof value === "string" ? value.trim().replace(/\s*%$/, "") : value;
  if (typeof text !== "number" && !(typeof text === "string" && text !== "")) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function dnaScore(value: unknown): number | null {
  const parsed = dnaNumber(value);
  return parsed === null ? null : Math.max(0, Math.min(100, Math.round(parsed)));
}

function finishDnaResult(
  scores: Record<DnaAttribute, number | null>,
  flagged: Iterable<DnaAttribute>,
  source: DnaConsistencyResult["source"],
  correction: string,
): DnaConsistencyResult {
  const failed = new Set<DnaAttribute>(flagged);
  for (const attribute of DNA_ATTRIBUTES) {
    const score = scores[attribute];
    if (score !== null && score < DNA_ATTRIBUTE_PASS_FLOOR) failed.add(attribute);
  }
  const applicable = DNA_ATTRIBUTES.map((attribute) => scores[attribute]).filter((score): score is number => score !== null);
  const score = applicable.length ? Math.round(applicable.reduce((sum, value) => sum + value, 0) / applicable.length) : null;
  const ordered = DNA_ATTRIBUTES.filter((attribute) => failed.has(attribute));
  return {
    version: DNA_CONSISTENCY_VERSION,
    pass: ordered.length === 0,
    unavailable: false,
    scores,
    failed: ordered,
    score,
    correction: correction.slice(0, 600),
    source,
    reason: ordered.length
      ? `Product DNA mismatch: ${ordered.map((attribute) => `${attribute} ${scores[attribute] ?? "flagged"}`).join(", ")}.`
      : `Product DNA consistent${score === null ? "" : ` (${score}%)`}.`,
  };
}

/**
 * Throws on a response with neither a numeric attribute score nor a valid failed attribute
 * so the caller can mark the check unavailable. A failed list without scores is a FAIL.
 */
export function normalizeDnaConsistencyResult(raw: unknown): DnaConsistencyResult {
  const data = record(raw);
  // Some models put the attribute scores at the top level instead of under "scores".
  const rawScores = Object.keys(record(data.scores)).length ? record(data.scores) : data;
  const logoFlag = data.logoApplicable ?? data.logo_applicable;
  const logoApplicable = logoFlag !== false &&
    !["false", "no", "0"].includes(String(logoFlag ?? "").trim().toLowerCase());
  const numbers = DNA_ATTRIBUTES.map((attribute) => attribute === "logo" && !logoApplicable ? null : dnaNumber(rawScores[attribute]));
  const provided = numbers.filter((value): value is number => value !== null);
  // A 0-1 answer is rescaled to 0-100 only when it has a real fraction: all-1 scores are
  // 1/100 on the prompt's scale and must fail, not become perfect.
  const scale = provided.length && provided.every((value) => value <= 1) && provided.some((value) => value > 0 && value < 1) ? 100 : 1;
  const scores = Object.fromEntries(DNA_ATTRIBUTES.map((attribute, index) => {
    const value = numbers[index];
    return [attribute, value === null ? null : dnaScore(value * scale)];
  })) as Record<DnaAttribute, number | null>;
  // Accept "color, details" strings and the British "colour" the prompt itself uses.
  const flagged = (Array.isArray(data.failed) ? data.failed : typeof data.failed === "string" ? data.failed.split(",") : [])
    .map((value) => String(value ?? "").trim().toLowerCase().replace(/^colour$/, "color"))
    .filter((value): value is DnaAttribute => (DNA_ATTRIBUTES as readonly string[]).includes(value))
    .filter((attribute) => attribute !== "logo" || logoApplicable);
  if (!flagged.length && DNA_ATTRIBUTES.every((attribute) => scores[attribute] === null)) {
    throw new Error("DNA consistency check returned no attribute scores.");
  }
  // A pass needs shape, color, material and details scored (logo is optional: a product
  // without one may get no logo score); a partial reply is incomplete, so the caller marks
  // the check unavailable instead of passing it.
  const unscored = DNA_ATTRIBUTES.filter((attribute) => attribute !== "logo" && scores[attribute] === null);
  if (!flagged.length && unscored.length) {
    throw new Error(`DNA consistency check did not score ${unscored.join(", ")}.`);
  }
  return finishDnaResult(scores, flagged, "dna_check", String(data.correction ?? ""));
}

const DNA_QA_CHECKS: Record<DnaAttribute, readonly string[]> = {
  shape: ["fit_silhouette", "garment_identity", "saree_blouse_construction"],
  color: ["colors", "saree_body_color"],
  material: ["fabric_texture", "saree_transparency_shine"],
  logo: ["details_and_branding"],
  details: [
    "embroidery_geometry", "print_pattern", "pattern_geometry", "detail_placement", "trim_location",
    "saree_weave_geometry", "saree_motif_inventory", "saree_motif_scale", "saree_motif_placement",
    "saree_pallu_artwork", "saree_border_geometry", "saree_tassels",
  ],
};

/** DNA verdict from full pose-QA check scores (each attribute is the minimum of its present checks). */
export function dnaConsistencyFromQaScores(scores: Record<string, number>): DnaConsistencyResult {
  const derived = Object.fromEntries(DNA_ATTRIBUTES.map((attribute) => {
    const present = DNA_QA_CHECKS[attribute].map((key) => dnaScore(scores?.[key])).filter((score): score is number => score !== null);
    return [attribute, present.length ? Math.min(...present) : null];
  })) as Record<DnaAttribute, number | null>;
  if (DNA_ATTRIBUTES.every((attribute) => derived[attribute] === null)) {
    return unavailableDnaConsistency("Pose QA returned no product DNA scores.");
  }
  return finishDnaResult(derived, [], "pose_qa", "");
}

/** An infrastructure failure of the check never blocks delivery. */
export function unavailableDnaConsistency(reason: string): DnaConsistencyResult {
  return {
    version: DNA_CONSISTENCY_VERSION,
    pass: true,
    unavailable: true,
    scores: { shape: null, color: null, material: null, logo: null, details: null },
    failed: [],
    score: null,
    correction: "",
    source: "unavailable",
    reason: String(reason || "DNA consistency check unavailable.").slice(0, 300),
  };
}

/**
 * A frame the DNA gate kept only for human review (a failed verdict, never an unavailable
 * one). Until a human approves it, it is not a Pose 1 anchor or an approved memory asset.
 */
export function dnaHoldsForReview(qaStatus: unknown, dna: unknown): boolean {
  if (String(qaStatus || "") === "human_approved") return false;
  const verdict = record(dna);
  return verdict.pass === false && verdict.unavailable !== true;
}

/**
 * The repeated-defect stop: this attempt's DNA failure names exactly the attribute set the
 * previous attempt of the same version failed (`previous` = generation_data.lastDnaFailed).
 */
export function repeatsLastDnaFailure(
  previous: unknown,
  current: { failed: readonly string[] },
  at: { generationEpoch: number; attempt: number },
): boolean {
  const mark = record(previous);
  const failed = Array.isArray(mark.failed) ? mark.failed.map(String) : [];
  return current.failed.length > 0 && Number(mark.generationEpoch) === at.generationEpoch &&
    Number(mark.attempt) === at.attempt - 1 && failed.length === current.failed.length &&
    current.failed.every((attribute) => failed.includes(attribute));
}

/** Retry correction for a failed check; "" when nothing failed. */
export function dnaCorrectionText(result: DnaConsistencyResult): string {
  if (result.pass || !result.failed.length) return "";
  const named = result.failed
    .map((attribute) => `${DNA_ATTRIBUTE_LABELS[attribute]}${result.scores[attribute] === null ? "" : ` (${result.scores[attribute]})`}`)
    .join(", ");
  return `PRODUCT DNA CORRECTION: the previous image drifted from the uploaded product on ${named}. Copy ${result.failed.length > 1 ? "these" : "this"} exactly from the product references and keep everything that was correct.${result.correction ? ` ${result.correction}` : ""}`.slice(0, 600);
}

