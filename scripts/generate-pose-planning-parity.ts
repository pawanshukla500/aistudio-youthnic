/**
 * Writes supabase/functions/app-api/tests/fixtures/pose_planning_parity.json: inputs plus the
 * lib/posePlanning.ts outputs that tests/pose_planning_parity.test.ts (Deno) and
 * backend/tests/test_pose_planning_parity.py (FastAPI planner mirror) both replay.
 *
 * After changing lib/posePlanning.ts, regenerate and update backend/agents/pose_plan_agents.py
 * until both suites pass:
 *   npx --yes deno run --frozen --allow-write=supabase/functions/app-api/tests/fixtures scripts/generate-pose-planning-parity.ts
 */
import {
  ADOPTABLE_SLOTS,
  MAX_REFERENCE_DIRECTIVE,
  normalizeExpressionPlan,
  normalizeReferencePose,
  normalizeReferencePosture,
  type PosePlanningContext,
  referenceAdoptionBlockReason,
  type ReferencePose,
  referenceSlotDirective,
} from "../supabase/functions/app-api/lib/posePlanning.ts";

const FIXTURE_PATH = new URL("../supabase/functions/app-api/tests/fixtures/pose_planning_parity.json", import.meta.url);

const postureInputs: unknown[] = [
  null, "", "   ", "none", "None", "no person", "N/A", "na", "empty", "no\u00a0model",
  "standing", "Standing", " SEATED ", "\ufeffkneeling\u2028", "\u001fnone",
  "sitting cross-legged", "Perched on stone steps", "sits", "kneels on one knee", "crouching low", "squatting",
  "hunkered down", "reclining on a chaise", "lying on her side", "lounging", "leaning on a pillar",
  "leans against the wall", "walking toward camera", "mid-step", "striding", "walks", "stands tall",
  "standing and leaning", "upstanding", "twirling", "dancing", "\u00e9sit", "sit\u00e9", "s\u00edtting",
  "standing ".repeat(12), 5, true, false, ["seated"], ["lean", "ing"], {},
];

const SEATED = {
  posture: "sitting on a low wooden stool",
  description: "seated upright, knees together, hands resting on the lap, head tilted slightly",
  seatOrSupport: "low wooden stool",
  distinctiveness: "generic",
  signatureDescription: "",
  attitude: "relaxed, self-assured",
  suitableForProduct: "yes",
  suitabilityReason: "kurti hem stays visible",
};

const poseInputs: unknown[] = [
  null, "seated", [1, 2], {},
  SEATED,
  { posture: "none", description: "an empty courtyard", seatOrSupport: "stone bench", attitude: "calm" },
  { posture: "Standing", distinctiveness: "Signature", signature_description: "  hand  on\u00a0hip ", suitable_for_product: "TRUE" },
  { posture: "standing", distinctiveness: "signature", signatureDescription: "", suitableForProduct: true },
  { posture: "seated", distinctiveness: "generic", signatureDescription: "chin on hand", suitableForProduct: false },
  { posture: "seated", distinctiveness: "sig-nature", signatureDescription: "chin on hand", suitableForProduct: " yes " },
  { posture: "kneeling", seatOrSupport: "none", suitableForProduct: "maybe" },
  { posture: "kneeling", seatOrSupport: "N/A", suitableForProduct: "no", suitabilityReason: "hem folds" },
  { posture: "kneeling", seatOrSupport: " - " },
  { posture: "kneeling", seat_or_support: "na" },
  { posture: "leaning", seatOrSupport: "carved teak bench ".repeat(10), description: "leaning ".repeat(80) },
  { posture: "reclining", description: 42, attitude: ["poised", "warm"], suitabilityReason: { why: "x" } },
  { posture: null, description: "standing", suitableForProduct: null, suitability_reason: "fallback key" },
  { posture: "seated", description: null, seatOrSupport: null, attitude: "a".repeat(260) },
];

const expressionInputs: unknown[] = [
  null, {}, "warm",
  { attitude: "Calm editorial poise", energy: "calm", gaze: "Soft gaze to camera", smile: "soft", rationale: "matches" },
  { energy: "Very loud", smile: "WARM" },
  { energy: "PLAYFUL", smile: "open smile" },
  { energy: "  serene  ", smile: "none" },
  { energy: "con-fident", smile: "Open" },
  { energy: 5, smile: true },
  { attitude: "   ", gaze: "\u00a0", rationale: null },
  { attitude: "x".repeat(250), gaze: "y".repeat(200), rationale: "z ".repeat(200) },
];

/** Normalized poses used for both block reasons and directives. */
const rawPoses: Record<string, unknown> = {
  none: { posture: "none" },
  generic_standing: { posture: "standing", description: "standing straight, arms relaxed", suitableForProduct: "yes" },
  signature_standing: {
    posture: "standing",
    description: "weight on one hip",
    distinctiveness: "signature",
    signatureDescription: "one hand lifting the hair off the neck",
    suitableForProduct: "yes",
  },
  seated_yes: SEATED,
  seated_no_reason: { ...SEATED, suitableForProduct: "no", suitabilityReason: "the hem would be hidden" },
  seated_no_blank: { ...SEATED, suitableForProduct: "false", suitabilityReason: "" },
  seated_unknown: { ...SEATED, suitableForProduct: "maybe" },
  seated_raised_heels: { ...SEATED, description: "seated on the stool with heels raised on the rung" },
  seated_footrest: { ...SEATED, description: "seated, feet resting flat on a footrest" },
  kneeling_yes: { posture: "kneeling", description: "kneeling on one knee, torso upright", suitableForProduct: "yes" },
  crouching_yes: { posture: "crouching", description: "low crouch, elbows on knees", suitableForProduct: "yes" },
  reclining_yes: { posture: "reclining", description: "reclining on one elbow", seatOrSupport: "chaise", suitableForProduct: "yes" },
  leaning_yes: { posture: "leaning", description: "shoulder leaning on a pillar", suitableForProduct: "yes" },
  leaning_stepping: { posture: "leaning", description: "leaning while stepping forward", suitableForProduct: "yes" },
  leaning_strides: { posture: "leaning", description: "strides into a lean against the arch", suitableForProduct: "yes" },
  leaning_foot_lifted: {
    posture: "leaning",
    description: "leaning on the wall",
    distinctiveness: "signature",
    signatureDescription: "one foot lifted back against the wall",
    suitableForProduct: "yes",
  },
  standing_mid_stride: {
    posture: "standing",
    description: "caught mid-stride, arms swinging",
    distinctiveness: "signature",
    signatureDescription: "hair flying",
    suitableForProduct: "yes",
  },
  standing_mid_step: {
    posture: "standing",
    description: "weight shifted",
    distinctiveness: "signature",
    signatureDescription: "frozen MID STEP with a lifted heel",
    suitableForProduct: "yes",
  },
  walking_yes: { posture: "walking", description: "walking toward the camera", suitableForProduct: "yes" },
  // FROZEN_STEP walk / walks / walking in a non-walking posture; walkway, sidewalk and "wal\u212aing" (Kelvin sign) adopt.
  leaning_walks: { posture: "leaning", description: "walks into a lean against the doorframe", suitableForProduct: "yes" },
  seated_signature_walking: { ...SEATED, distinctiveness: "signature", signatureDescription: "turned as if WALKING past the stool" },
  other_walk_accent: { posture: "twirling", description: "half turn out of a walk\u00e9 step", suitableForProduct: "yes" },
  leaning_walkway: { posture: "leaning", description: "leaning on the walkway railing by the sidewalk", suitableForProduct: "yes" },
  leaning_kelvin_walk: { posture: "leaning", description: "wal\u212aing shape, shoulder on the pillar", suitableForProduct: "yes" },
  other_yes: { posture: "twirling", description: "half turn with the arms out", suitableForProduct: "yes" },
  // T94-Kitkat-Kattha: a seated reference the analysis judged unsuitable now adopts Pose 4 with its camera and seat.
  t94_seated_unsuitable: {
    posture: "seated",
    description: "seated on a low bench, legs crossed, one hand bracing on the bench, head turned sideways",
    seatOrSupport: "low reddish-brown wooden bench platform",
    distinctiveness: "generic",
    cameraAngle: "eye-level slightly low, mid-full framing",
    suitableForProduct: "no",
    suitabilityReason: "seated crossed legs folds hip hem and hides trouser silhouette and back lace-up",
  },
  // T94 v38 analysis: the held cup clause is dropped so Pose 4 adopts (the planner rejects a directive naming a cup).
  t94_seated_cup: {
    posture: "seated",
    description: "seated on low wood bench/platform, torso three-quarter left, legs crossed with one knee over other, " +
      "right elbow bent holding cup up near mouth, left arm extended back resting on bench, head turned to side",
    seatOrSupport: "low dark wood bench/platform",
    distinctiveness: "generic",
    cameraAngle: "eye-level slightly three-quarter, medium full seated framing",
    suitableForProduct: "yes",
  },
  // Every clause held: the posture word stands in; the signature splits on ";" and "." too.
  held_only: {
    posture: "standing",
    description: "holding a coffee cup in both hands",
    distinctiveness: "signature",
    signatureDescription: "Phone raised for a mirror selfie; hand on hip. Sunglasses pushed up",
    suitableForProduct: "yes",
  },
  // "bottle green" is a colour and stays; the dropped bag clause leaves a lifted foot, which still grounds.
  held_bottle_green_lifted: {
    posture: "leaning",
    description: "leaning on a bottle green pillar, handbag over the forearm, one foot lifted, holding a bottle",
    suitableForProduct: "yes",
  },
  long_signature: {
    posture: "seated",
    description: "seated upright with the torso turned slightly, ".repeat(12),
    seatOrSupport: "carved teak bench ".repeat(10),
    distinctiveness: "signature",
    signatureDescription: "one elbow propped on the knee, chin resting lightly on the knuckles, ".repeat(8),
    suitableForProduct: "yes",
  },
};
const poses: Record<string, ReferencePose> = Object.fromEntries(
  Object.entries(rawPoses).map(([id, raw]) => [id, normalizeReferencePose(raw)]),
);

const pose = (overrides: Partial<ReferencePose>): ReferencePose => ({ ...poses.seated_yes, ...overrides });
/** Un-normalized ReferencePose objects; the overflow_* ones push referenceSlotDirective past MAX_REFERENCE_DIRECTIVE. */
const directivePoses: Record<string, ReferencePose> = {
  overflow_description: pose({ description: "torso turned, shoulders soft ".repeat(30) }),
  overflow_signature: pose({ distinctiveness: "signature", signatureDescription: "elbow on knee ".repeat(60) }),
  overflow_both: pose({
    description: "head tilted toward the light ".repeat(20),
    distinctiveness: "signature",
    signatureDescription: "fingers laced at the knee ".repeat(22),
  }),
  overflow_double_spaces: pose({ description: "a  ".repeat(250) }),
  overflow_nbsp: pose({ description: "ab\u00a0".repeat(250) }),
  overflow_unit_separator: pose({ description: "ab\u001f".repeat(250) }),
  overflow_empty_description: pose({ description: "", distinctiveness: "signature", signatureDescription: "lean ".repeat(160) }),
  overflow_generic_ignores_signature: pose({ description: "calm ".repeat(160), signatureDescription: "ignored ".repeat(50) }),
  overflow_huge_seat: pose({ seatOrSupport: "bench ".repeat(160), description: "upright ".repeat(30) }),
  no_seat_short: pose({ seatOrSupport: "", description: "" }),
};
/** Normalized poses whose directive text differs in shape (block-only variants are skipped). */
const DIRECTIVE_POSE_IDS = [
  "none", "generic_standing", "signature_standing", "seated_yes", "reclining_yes", "other_yes", "long_signature",
  // A walk or lifted foot is grounded, never copied; Pose 4 carries the reference camera.
  "walking_yes", "leaning_foot_lifted", "standing_mid_stride", "seated_raised_heels", "t94_seated_unsuitable",
  // Clauses naming a held object never reach the directive.
  "t94_seated_cup", "held_only", "held_bottle_green_lifted",
];

const contexts: Record<string, PosePlanningContext> = {
  empty: { poseFamily: "", bottomCutClass: "" },
  kurti_plain: { poseFamily: "long_kurti", bottomCutClass: "straight" },
  kurti_neckline: { poseFamily: "long_kurti", bottomCutClass: "straight", showcaseFeatureRegion: "neckline", showcaseShotType: "full_body_feature" },
  farshi_neckline: { poseFamily: "long_kurti", bottomCutClass: "farshi", showcaseFeatureRegion: "neckline", showcaseShotType: "full_body_feature" },
  farshi_bottom: { poseFamily: "kurta_set", bottomCutClass: "farshi", showcaseFeatureRegion: "bottom_wear", showcaseShotType: "full_body_feature" },
  saree_bengali_pallu: { poseFamily: "saree_bengali", bottomCutClass: "none", showcaseFeatureRegion: "pallu", showcaseShotType: "drape_feature" },
  saree_ethnic_drape: { poseFamily: "saree_ethnic", bottomCutClass: "none", showcaseFeatureRegion: "drape", showcaseShotType: "full_body_feature" },
  lehenga_set: { poseFamily: "lehenga", bottomCutClass: "none", showcaseFeatureRegion: "complete_set", showcaseShotType: "full_body_feature" },
  western_print: { poseFamily: "western_casual", bottomCutClass: "none", showcaseFeatureRegion: "print", showcaseShotType: "full_body_feature" },
  shot_macro: { poseFamily: "long_kurti", bottomCutClass: "straight", showcaseFeatureRegion: "embroidery", showcaseShotType: "macro_detail" },
  shot_half_body: { poseFamily: "long_kurti", bottomCutClass: "straight", showcaseFeatureRegion: "upper_garment", showcaseShotType: "half_body_detail" },
  shot_movement: { poseFamily: "lehenga", bottomCutClass: "none", showcaseFeatureRegion: "dupatta", showcaseShotType: "movement_feature" },
  shot_drape: { poseFamily: "long_kurti", bottomCutClass: "straight", showcaseFeatureRegion: "dupatta", showcaseShotType: "drape_feature" },
  region_bottom_wear: { poseFamily: "long_kurti", bottomCutClass: "straight", showcaseFeatureRegion: "bottom_wear", showcaseShotType: "full_body_feature" },
  region_hem_border: { poseFamily: "long_kurti", bottomCutClass: "straight", showcaseFeatureRegion: "hem_border", showcaseShotType: "full_body_feature" },
  region_silhouette: { poseFamily: "dress", bottomCutClass: "none", showcaseFeatureRegion: "silhouette", showcaseShotType: "full_body_feature" },
  region_complete_set: { poseFamily: "kurta_set", bottomCutClass: "palazzo", showcaseFeatureRegion: "complete_set", showcaseShotType: "full_body_feature" },
  region_sleeve: { poseFamily: "short_kurti_top", bottomCutClass: "none", showcaseFeatureRegion: "sleeve", showcaseShotType: "full_body_feature" },
  // An explicit sit request keeps a non-seated reference out of Pose 4; Pose 6 never adopts.
  sit_requested: { poseFamily: "long_kurti", bottomCutClass: "straight", showcaseFeatureRegion: "neckline", showcaseShotType: "full_body_feature", sitRequested: true },
  sit_requested_farshi: { poseFamily: "kurta_set", bottomCutClass: "farshi", showcaseFeatureRegion: "neckline", showcaseShotType: "full_body_feature", sitRequested: true },
  sit_requested_macro: { poseFamily: "saree_ethnic", bottomCutClass: "none", showcaseFeatureRegion: "embroidery", showcaseShotType: "macro_detail", sitRequested: true },
  sit_not_requested: { poseFamily: "long_kurti", bottomCutClass: "straight", showcaseFeatureRegion: "neckline", showcaseShotType: "full_body_feature", sitRequested: false },
};

const fixture = {
  about: "Generated by scripts/generate-pose-planning-parity.ts from supabase/functions/app-api/lib/posePlanning.ts. Do not edit by hand.",
  maxReferenceDirective: MAX_REFERENCE_DIRECTIVE,
  normalizeReferencePosture: postureInputs.map((input) => ({ input, output: normalizeReferencePosture(input) })),
  normalizeReferencePose: poseInputs.map((input) => ({ input, output: normalizeReferencePose(input) })),
  normalizeExpressionPlan: expressionInputs.map((input) => ({ input, output: normalizeExpressionPlan(input) })),
  poses,
  directivePoses,
  contexts,
  /** One row per slot and pose: outputs[ctxId] = the block reason ("" = may adopt). */
  referenceAdoptionBlockReason: ADOPTABLE_SLOTS.flatMap((slot) =>
    Object.keys(poses).map((poseId) => ({
      slot,
      pose: poseId,
      outputs: Object.fromEntries(
        Object.keys(contexts).map((ctxId) => [ctxId, referenceAdoptionBlockReason(slot, poses[poseId], contexts[ctxId])]),
      ),
    }))
  ),
  referenceSlotDirective: ADOPTABLE_SLOTS.flatMap((slot) =>
    [...DIRECTIVE_POSE_IDS, ...Object.keys(directivePoses)].map((poseId) => ({
      slot,
      pose: poseId,
      output: referenceSlotDirective(slot, poses[poseId] ?? directivePoses[poseId]),
    }))
  ),
};

/** ASCII-only JSON (invisible whitespace stays visible as \uXXXX), one case per line. */
function json(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function format(value: Record<string, unknown>): string {
  const entries = Object.entries(value).map(([key, entry]) => {
    if (Array.isArray(entry)) return `  ${json(key)}: [\n${entry.map((item) => `    ${json(item)}`).join(",\n")}\n  ]`;
    if (entry && typeof entry === "object") {
      return `  ${json(key)}: {\n${Object.entries(entry).map(([id, item]) => `    ${json(id)}: ${json(item)}`).join(",\n")}\n  }`;
    }
    return `  ${json(key)}: ${json(entry)}`;
  });
  return `{\n${entries.join(",\n")}\n}\n`;
}

if (import.meta.main) {
  await Deno.mkdir(new URL(".", FIXTURE_PATH), { recursive: true });
  await Deno.writeTextFile(FIXTURE_PATH, format(fixture));
  console.log(
    `Wrote ${FIXTURE_PATH.pathname}: ${fixture.referenceAdoptionBlockReason.length * Object.keys(contexts).length} ` +
      `block-reason and ${fixture.referenceSlotDirective.length} directive cases.`,
  );
}
