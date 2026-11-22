/**
 * Reference-led pose and expression planning contract.
 *
 * Shared by analysis (profiles.ts), prompt composition (generationPrompt.ts),
 * QA (qa.ts), the Edge worker (index.ts) and the FastAPI LangGraph planner
 * (backend/agents/pose_plan_agents.py, POST /api/v1/plan).
 *
 * Only Pose 4 ("creative") adopts the STYLE REFERENCE person's posture or
 * signature style, whenever the reference shows a person and no product guard
 * blocks it. Pose 6 ("showcase") is the product-highlight close-up and never
 * adopts (a plan stored before analysis v38 may still carry a Pose 6 adoption).
 * Frames 1, 2, 3 and 5 stay catalog frames. The reference outfit, face, hair and
 * anything in the hands stay quarantined in every frame.
 */

export type JsonRecord = Record<string, unknown>;

export const POSE_PLANNING_VERSION = 1;

export const REFERENCE_POSTURES = [
  "standing",
  "seated",
  "leaning",
  "kneeling",
  "crouching",
  "reclining",
  "walking",
  "other",
  "none",
] as const;
export type ReferencePosture = typeof REFERENCE_POSTURES[number];

/** Postures that fold the legs and hide part of a long garment. */
export const LOW_POSTURES: readonly ReferencePosture[] = ["seated", "kneeling", "crouching", "reclining"];

export const ADOPTABLE_SLOTS = ["creative", "showcase"] as const;
export type AdoptableSlot = typeof ADOPTABLE_SLOTS[number];

export const EXPRESSION_ENERGIES = ["serene", "calm", "warm", "playful", "confident", "dramatic"] as const;
export type ExpressionEnergy = typeof EXPRESSION_ENERGIES[number];

export const SMILE_LEVELS = ["none", "soft", "warm", "open"] as const;
export type SmileLevel = typeof SMILE_LEVELS[number];

export type ReferencePose = {
  posture: ReferencePosture;
  /** Body position only: torso, legs, arms, head. Never clothing, face or props. */
  description: string;
  /** What the body rests on ("low wooden stool", "stone steps"), or "". */
  seatOrSupport: string;
  distinctiveness: "generic" | "signature";
  /** What makes the pose or styling unusual, or "" for a generic pose. */
  signatureDescription: string;
  /** The reference person's attitude as a style cue (never their face). */
  attitude: string;
  /** v37: how the reference is shot, and the person's expression, gaze and hand gesture (never their face or objects). "" when not recorded. */
  cameraAngle?: string;
  expression?: string;
  gaze?: string;
  hands?: string;
  suitableForProduct: "yes" | "no" | "unknown";
  suitabilityReason: string;
};

export type ExpressionPlan = {
  attitude: string;
  energy: ExpressionEnergy;
  gaze: string;
  smile: SmileLevel;
  rationale: string;
};

export type SlotPlan = {
  source: "reference" | "product";
  posture: ReferencePosture;
  directive: string;
  rationale: string;
};

export type LearnedSignal = {
  slot: AdoptableSlot;
  outcomeKey: string;
  effect: "boost" | "penalty" | "none";
};

export type PosePlanning = {
  version: typeof POSE_PLANNING_VERSION;
  referencePose: ReferencePose;
  expressionPlan: ExpressionPlan;
  slots: Record<AdoptableSlot, SlotPlan>;
  /** Planner-owned per-pose expression text, keyed by pose id. Empty = use pose.expression. */
  expressions: Record<string, string>;
  planner: "langgraph" | "local";
  /** pose_family|bottom_cut_class — the learning key prefix. */
  planKey: string;
  threadId?: string;
  learnedSignals: LearnedSignal[];
};

export type PosePlanningContext = {
  /** GarmentPoseFamily from detectGarmentPoseFamily. */
  poseFamily: string;
  /** effectiveBottomCutClass, or "none" for sarees and top-only shoots. */
  bottomCutClass: string;
  showcaseFeatureRegion?: string;
  showcaseShotType?: string;
  /** The notes demand a seated Pose 4 (isSeatedEditorialPoseDemanded): only a seated reference may then adopt it. */
  sitRequested?: boolean;
  /** Normalized creativeDirection.closeupMode; the planner's Pose 5 expression follows it. */
  closeupMode?: string;
};

const MAX_TEXT = 420;
/** A walk, frozen stride or lifted foot in the reference body description (never copied as written). */
const FROZEN_STEP =
  /\bwalk(?:s|ed|ing)?\b|\bstrode\b|\bmid[- ]?(?:stride|step)\b|\bstrid(?:e|es|ing)\b|\b(?:lifted|raised) (?:foot|feet|heels?)\b|\b(?:foot|feet|heels?) (?:lifted|raised)\b/i;
/** Something held in the reference hands (pose_plan_agents.py HELD_OBJECT); "bottle green" is a colour. */
const HELD_OBJECT =
  /\b(?:(?:cup|mug|coffee|phone|bag|handbag|purse|sunglasses|umbrella|bouquet|flower)s?|bottles?(?!\s*green))\b/i;

/**
 * Anything in the reference hands is never copied, so a clause naming it ("right elbow bent holding cup up
 * near mouth") is dropped before it reaches the directive; the planner would otherwise reject the slot.
 */
export function withoutHeldObjects(value: string): string {
  if (!HELD_OBJECT.test(value)) return value;
  return value.split(/\s*[,;.]\s*/).filter((clause) => clause && !HELD_OBJECT.test(clause)).join(", ");
}
/** Replaces a walk or lifted foot in an adopted posture; free of the stride words every prompt scrub removes. */
const GROUNDED_SHIFT =
  "Ground the reference movement as a natural weight shift: both feet on the floor, one slightly ahead of the other with the weight easing onto it, the body turned the way the reference person moves.";
const QUARANTINE_SENTENCE =
  "Copy only the body position and attitude, never the reference clothing, face, hair or anything in the hands (jewellery follows the styling plan). Keep the uploaded garment's front design, print, colours and construction exactly as the product photos show; a folded posture may let the hem rest naturally but never hides the print or changes the garment.";

function text(value: unknown, max = MAX_TEXT): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function pick(raw: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) if (raw[key] !== undefined && raw[key] !== null) return raw[key];
  return undefined;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = text(value, 40).toLowerCase().replace(/[\s-]+/g, "_");
  return (allowed as readonly string[]).includes(normalized) ? normalized as T : fallback;
}

export function normalizeReferencePosture(value: unknown): ReferencePosture {
  const raw = text(value, 80).toLowerCase();
  if (!raw || /^(none|no person|no model|n\/a|na|empty)$/.test(raw)) return "none";
  if ((REFERENCE_POSTURES as readonly string[]).includes(raw)) return raw as ReferencePosture;
  if (/\b(sit|sits|sitting|seated|perched)\b/.test(raw)) return "seated";
  if (/\b(kneel|kneels|kneeling)\b/.test(raw)) return "kneeling";
  if (/\b(crouch|crouching|squat|squatting|hunker)/.test(raw)) return "crouching";
  if (/\b(reclin|lying|lies|lounging|lounge)/.test(raw)) return "reclining";
  if (/\b(lean|leans|leaning)\b/.test(raw)) return "leaning";
  if (/\b(walk|walking|stride|striding|mid-step)\b/.test(raw)) return "walking";
  if (/\b(stand|stands|standing)\b/.test(raw)) return "standing";
  return "other";
}

export function isLowPosture(posture: ReferencePosture): boolean {
  return LOW_POSTURES.includes(posture);
}

/** The posture an adopted slot renders: a walking reference becomes a grounded standing weight shift. */
export function slotPosture(posture: ReferencePosture): ReferencePosture {
  return posture === "walking" ? "standing" : posture;
}

/** `scrub` removes handheld-prop clauses (profiles.ts sanitizeHeldObjectText). */
export function normalizeReferencePose(
  rawValue: unknown,
  scrub: (value: string) => string = (value) => value,
): ReferencePose & Required<Pick<ReferencePose, "cameraAngle" | "expression" | "gaze" | "hands">> {
  const raw = record(rawValue);
  const posture = normalizeReferencePosture(pick(raw, "posture"));
  const signatureDescription = scrub(text(pick(raw, "signatureDescription", "signature_description")));
  const distinctiveness = oneOf(pick(raw, "distinctiveness"), ["generic", "signature"] as const, "generic");
  const suitable = text(pick(raw, "suitableForProduct", "suitable_for_product"), 20).toLowerCase();
  return {
    posture,
    description: posture === "none" ? "" : scrub(text(pick(raw, "description"))),
    seatOrSupport: /^(none|n\/a|na|-)?$/i.test(text(pick(raw, "seatOrSupport", "seat_or_support"), 120))
      ? ""
      : scrub(text(pick(raw, "seatOrSupport", "seat_or_support"), 120)),
    // A signature with nothing written down cannot be reproduced.
    distinctiveness: distinctiveness === "signature" && signatureDescription ? "signature" : "generic",
    signatureDescription: distinctiveness === "signature" ? signatureDescription : "",
    attitude: text(pick(raw, "attitude"), 200),
    cameraAngle: posture === "none" ? "" : scrub(text(pick(raw, "cameraAngle", "camera_angle"), 160)),
    expression: posture === "none" ? "" : scrub(text(pick(raw, "expression"), 160)),
    gaze: posture === "none" ? "" : scrub(text(pick(raw, "gaze"), 160)),
    hands: posture === "none" ? "" : scrub(text(pick(raw, "hands", "handGesture", "hand_gesture"), 160)),
    suitableForProduct: suitable === "yes" || suitable === "true" ? "yes" : suitable === "no" || suitable === "false" ? "no" : "unknown",
    suitabilityReason: text(pick(raw, "suitabilityReason", "suitability_reason"), 240),
  };
}

const DEFAULT_EXPRESSION_PLAN: ExpressionPlan = {
  attitude: "Natural, quietly confident catalog poise",
  energy: "calm",
  gaze: "Soft, direct gaze to camera",
  smile: "soft",
  rationale: "",
};

export function normalizeExpressionPlan(rawValue: unknown): ExpressionPlan {
  const raw = record(rawValue);
  return {
    attitude: text(pick(raw, "attitude"), 200) || DEFAULT_EXPRESSION_PLAN.attitude,
    energy: oneOf(pick(raw, "energy"), EXPRESSION_ENERGIES, DEFAULT_EXPRESSION_PLAN.energy),
    gaze: text(pick(raw, "gaze"), 160) || DEFAULT_EXPRESSION_PLAN.gaze,
    smile: oneOf(pick(raw, "smile"), SMILE_LEVELS, DEFAULT_EXPRESSION_PLAN.smile),
    rationale: text(pick(raw, "rationale"), 300),
  };
}

const SMILE_TEXT: Record<SmileLevel, string> = {
  none: "neutral closed-lip mouth",
  soft: "soft closed-lip smile",
  warm: "warm natural smile",
  open: "relaxed open smile",
};

/** One prompt line describing the planned expression and attitude. */
export function expressionAttitudeLine(plan: ExpressionPlan): string {
  // No gaze: one gaze for the whole shoot made every frame look into the lens the same way.
  return `Attitude: ${plan.attitude}. Energy: ${plan.energy}. Mouth: ${SMILE_TEXT[plan.smile]} at most, never a forced or toothy grin.`;
}

/**
 * Hard guards. Returns "" when the slot may copy the reference posture, or the
 * reason it must stay product-led. The LangGraph planner applies the same
 * guards (backend/agents/pose_plan_agents.py) before its learned scoring.
 *
 * Pose 4 adopts whenever the reference shows a person: the analysis's soft
 * suitability verdict and a generic stance no longer block it (Poses 1-3
 * already cover the full silhouette and the back), and a walk or lifted foot is
 * grounded by the directive. Only an explicit sit request and the construction
 * guards that protect product truth remain. Pose 6 is the product highlight.
 */
export function referenceAdoptionBlockReason(slot: AdoptableSlot, pose: ReferencePose, ctx: PosePlanningContext): string {
  if (pose.posture === "none") return "The style reference shows no person to match.";
  if (slot === "showcase") return "Pose 6 is the product-highlight close-up, so it never copies the reference posture.";
  if (ctx.sitRequested && pose.posture !== "seated") {
    return "Your notes ask Pose 4 to sit, so it follows that request instead of the reference posture.";
  }
  if (isLowPosture(pose.posture) && ctx.bottomCutClass === "farshi") {
    return "Farshi two-leg volume and the 4-inch upper-hem taper need a standing frame.";
  }
  if (pose.posture === "reclining" && ctx.poseFamily.startsWith("saree")) {
    return "A reclining pose breaks the saree pleats and pallu fall.";
  }
  return "";
}

/**
 * Stored and planner directives keep at most this many characters (normalizeSlotPlan, storedPosePlanning).
 * The fixed seat, camera, quarantine and family sentences take ~800; 1200 leaves room for a full body description.
 */
export const MAX_REFERENCE_DIRECTIVE = 1200;

/** A cut free-text field ends on a whole word ("crossed at the ankles", never "crossed at the a"). */
function clipWords(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd();
}

export function referenceSlotDirective(slot: AdoptableSlot, pose: ReferencePose): string {
  // Held objects are dropped. A walk or lifted foot is never copied as written: that text is dropped and the slot grounds it.
  const walking = pose.posture === "walking";
  const rawSignature = pose.distinctiveness === "signature" ? pose.signatureDescription : "";
  // The step check reads the unfiltered text: "bag in hand with one foot lifted" still grounds.
  const frozenDescription = FROZEN_STEP.test(pose.description);
  const frozenSignature = FROZEN_STEP.test(rawSignature);
  const description = walking || frozenDescription ? "" : withoutHeldObjects(pose.description);
  const signature = walking || frozenSignature ? "" : withoutHeldObjects(rawSignature);
  const grounded = walking || frozenDescription || frozenSignature;
  const camera = slot === "creative" ? pose.cameraAngle ?? "" : "";
  const compose = (descriptionText: string, signatureText: string) => {
    const parts = [
      walking
        ? "Match the STYLE REFERENCE person's direction of movement in a grounded standing pose."
        : `Match the STYLE REFERENCE person's ${pose.posture} posture: ${descriptionText || pose.posture}.`,
    ];
    if (grounded) parts.push(GROUNDED_SHIFT);
    if (pose.seatOrSupport) parts.push(`Rest on the ${pose.seatOrSupport}, which must already belong to the locked set.`);
    if (signature) parts.push(`Reproduce the signature pose: ${signatureText}.`);
    if (camera) parts.push(`Camera and framing as the STYLE REFERENCE is shot: ${camera}.`);
    if (slot === "showcase") {
      parts.push("Use a complementary variation of that posture with a different camera angle and framing from Pose 4, framed for the showcase hero feature.");
    }
    parts.push(QUARANTINE_SENTENCE);
    return parts.join(" ");
  };
  const directive = compose(description, signature);
  if (directive.length <= MAX_REFERENCE_DIRECTIVE) return directive;
  // Same budget as bounded_reference_directive (backend/agents/pose_plan_agents.py): the
  // free-text description and signature share what is left, so the fixed seat, camera,
  // showcase and quarantine sentences survive and a re-normalized directive is unchanged.
  const budget = Math.max(0, MAX_REFERENCE_DIRECTIVE - (directive.length - description.length - signature.length));
  const signatureLength = Math.min(signature.length, Math.max(Math.floor(budget / 2), budget - description.length));
  return compose(
    clipWords(description, budget - signatureLength).trimEnd(),
    clipWords(signature, signatureLength).trimEnd(),
  ).slice(0, MAX_REFERENCE_DIRECTIVE);
}

function productSlotPlan(reason: string): SlotPlan {
  return { source: "product", posture: "standing", directive: "", rationale: reason };
}

function referenceSlotPlan(slot: AdoptableSlot, pose: ReferencePose, rationale = ""): SlotPlan {
  const matched = pose.distinctiveness === "signature"
    ? "signature style"
    : pose.posture === "walking" ? "movement as a grounded weight shift" : `${pose.posture} posture`;
  return {
    source: "reference",
    posture: slotPosture(pose.posture),
    directive: referenceSlotDirective(slot, pose),
    rationale: rationale || `Matches the style reference ${matched}.`,
  };
}

export function posePlanKey(ctx: PosePlanningContext): string {
  return `${ctx.poseFamily || "other"}|${ctx.bottomCutClass || "none"}`;
}

export function posePlanOutcomeKey(args: {
  poseFamily: string;
  bottomCutClass: string;
  slot: AdoptableSlot;
  source: SlotPlan["source"];
  posture: ReferencePosture;
  distinctiveness: ReferencePose["distinctiveness"];
}): string {
  return [args.poseFamily || "other", args.bottomCutClass || "none", args.slot, args.source, args.posture, args.distinctiveness].join("|");
}

/** The deterministic plan used when the LangGraph planner is unavailable. */
export function localPosePlanningDecision(
  referencePose: ReferencePose,
  expressionPlan: ExpressionPlan,
  ctx: PosePlanningContext,
): PosePlanning {
  const slot = (id: AdoptableSlot) => {
    const blocked = referenceAdoptionBlockReason(id, referencePose, ctx);
    return blocked ? productSlotPlan(blocked) : referenceSlotPlan(id, referencePose);
  };
  return {
    version: POSE_PLANNING_VERSION,
    referencePose,
    expressionPlan,
    slots: { creative: slot("creative"), showcase: slot("showcase") },
    expressions: {},
    planner: "local",
    planKey: posePlanKey(ctx),
    learnedSignals: [],
  };
}

function normalizeSlotPlan(value: unknown, slot: AdoptableSlot, pose: ReferencePose, ctx: PosePlanningContext): SlotPlan {
  const raw = record(value);
  if (text(raw.source, 20).toLowerCase() !== "reference") {
    return productSlotPlan(text(raw.rationale, 300) || "Product-led pose.");
  }
  // A stored or planner-supplied adoption still has to clear the hard guards.
  const blocked = referenceAdoptionBlockReason(slot, pose, ctx);
  if (blocked) return productSlotPlan(blocked);
  return {
    source: "reference",
    posture: slotPosture(pose.posture),
    directive: text(raw.directive, MAX_REFERENCE_DIRECTIVE) || referenceSlotDirective(slot, pose),
    rationale: text(raw.rationale, 300) || referenceSlotPlan(slot, pose).rationale,
  };
}

function normalizeExpressions(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record(value))) {
    const cleaned = text(entry, 300);
    if (cleaned) out[key] = cleaned;
  }
  return out;
}

function normalizeSignals(value: unknown): LearnedSignal[] {
  return (Array.isArray(value) ? value : []).map(record).flatMap((raw) => {
    const slot = text(raw.slot, 20) as AdoptableSlot;
    if (!(ADOPTABLE_SLOTS as readonly string[]).includes(slot)) return [];
    const effect = oneOf(raw.effect, ["boost", "penalty", "none"] as const, "none");
    return [{ slot, outcomeKey: text(raw.outcomeKey ?? raw.outcome_key, 200), effect }];
  }).slice(0, 8);
}

/**
 * Idempotent: accepts raw analysis fields ({ referencePose, expressionPlan }),
 * a stored PosePlanning, or a stored PosePlanning that predates a guard change.
 * Slot adoptions are always re-checked against the hard guards.
 */
export function normalizePosePlanning(
  rawValue: unknown,
  ctx: PosePlanningContext,
  scrub?: (value: string) => string,
): PosePlanning {
  const raw = record(rawValue);
  const referencePose = normalizeReferencePose(raw.referencePose ?? raw.reference_pose, scrub);
  const expressionPlan = normalizeExpressionPlan(raw.expressionPlan ?? raw.expression_plan);
  const slots = record(raw.slots);
  if (!Object.keys(slots).length) return localPosePlanningDecision(referencePose, expressionPlan, ctx);
  return {
    version: POSE_PLANNING_VERSION,
    referencePose,
    expressionPlan,
    slots: {
      creative: normalizeSlotPlan(slots.creative, "creative", referencePose, ctx),
      showcase: normalizeSlotPlan(slots.showcase, "showcase", referencePose, ctx),
    },
    expressions: normalizeExpressions(raw.expressions),
    planner: raw.planner === "langgraph" ? "langgraph" : "local",
    planKey: posePlanKey(ctx),
    threadId: text(raw.threadId ?? raw.thread_id, 200) || undefined,
    learnedSignals: normalizeSignals(raw.learnedSignals ?? raw.learned_signals),
  };
}

/** Request body for FastAPI POST /api/v1/plan. */
export function posePlanningGraphPayload(args: {
  organizationId: string;
  threadKey: string;
  ctx: PosePlanningContext;
  garmentFamily: string;
  category: string;
  local: PosePlanning;
  poseExpressions: Record<string, string>;
}): JsonRecord {
  return {
    organization_id: args.organizationId,
    thread_key: args.threadKey,
    pose_family: args.ctx.poseFamily,
    bottom_cut_class: args.ctx.bottomCutClass,
    garment_family: args.garmentFamily,
    category: args.category,
    showcase_feature_region: args.ctx.showcaseFeatureRegion ?? "",
    showcase_shot_type: args.ctx.showcaseShotType ?? "",
    sit_requested: Boolean(args.ctx.sitRequested),
    closeup_mode: args.ctx.closeupMode ?? "",
    reference_pose: args.local.referencePose,
    expression_plan: args.local.expressionPlan,
    pose_expressions: args.poseExpressions,
    local_plan: { slots: args.local.slots },
  };
}

/**
 * Applies a /api/v1/plan response over the local plan. Anything malformed falls
 * back to the local decision; adoptions are re-checked against the hard guards.
 */
export function mergeGraphPosePlanning(local: PosePlanning, response: unknown, ctx: PosePlanningContext): PosePlanning {
  const raw = record(response);
  if (!Object.keys(record(raw.slots)).length) return local;
  const merged = normalizePosePlanning({
    referencePose: local.referencePose,
    expressionPlan: local.expressionPlan,
    slots: raw.slots,
    expressions: raw.expressions,
    planner: "langgraph",
    threadId: raw.thread_id ?? raw.threadId,
    learnedSignals: raw.learned_signals ?? raw.learnedSignals,
  }, ctx);
  return merged;
}

/** Reads session_data.posePlanning without re-deriving anything. */
export function storedPosePlanning(session: unknown): PosePlanning | null {
  const raw = record(record(session).posePlanning);
  const slots = record(raw.slots);
  if (raw.version !== POSE_PLANNING_VERSION || !Object.keys(slots).length) return null;
  const referencePose = normalizeReferencePose(raw.referencePose);
  const slot = (id: AdoptableSlot): SlotPlan => {
    const entry = record(slots[id]);
    return entry.source === "reference" && referencePose.posture !== "none"
      ? {
        source: "reference",
        posture: slotPosture(referencePose.posture),
        directive: text(entry.directive, MAX_REFERENCE_DIRECTIVE) || referenceSlotDirective(id, referencePose),
        rationale: text(entry.rationale, 300),
      }
      : productSlotPlan(text(entry.rationale, 300));
  };
  return {
    version: POSE_PLANNING_VERSION,
    referencePose,
    expressionPlan: normalizeExpressionPlan(raw.expressionPlan),
    slots: { creative: slot("creative"), showcase: slot("showcase") },
    expressions: normalizeExpressions(raw.expressions),
    planner: raw.planner === "langgraph" ? "langgraph" : "local",
    planKey: text(raw.planKey, 200),
    threadId: text(raw.threadId, 200) || undefined,
    learnedSignals: normalizeSignals(raw.learnedSignals),
  };
}

/** The slot plan when this pose copies the reference posture, else null. */
export function slotReferencePlan(session: unknown, poseId: string): SlotPlan | null {
  if (!(ADOPTABLE_SLOTS as readonly string[]).includes(poseId)) return null;
  const planning = storedPosePlanning(session);
  const slot = planning?.slots[poseId as AdoptableSlot];
  return slot?.source === "reference" ? slot : null;
}

/** True when the stored plan seats (or kneels/crouches/reclines) this pose. */
export function isReferenceLowPostureSlot(session: unknown, poseId: string): boolean {
  const slot = slotReferencePlan(session, poseId);
  return Boolean(slot && isLowPosture(slot.posture));
}

export function plannedPoseExpression(session: unknown, poseId: string): string {
  return storedPosePlanning(session)?.expressions[poseId] ?? "";
}

/**
 * Cached text summary of a STYLE REFERENCE, reused so a later analysis with the
 * same style image can omit that image. Room, camera and mood only: never the
 * reference person's clothing, face, hair or anything in the hands.
 */
export type StyleReferenceProfile = {
  version: 1;
  creativeDirection: JsonRecord;
  referencePose: ReferencePose;
  stylingTaste: string;
};

/**
 * creativeDirection fields that describe the style reference's room, light, camera and mood.
 * Framing, composition and propUsage are planned per product, so a cached profile never carries them.
 */
export const STYLE_PROFILE_CREATIVE_FIELDS = [
  "backgroundStyle",
  "studioEnvironment",
  "lighting",
  "cameraPerspective",
  "mood",
  "colorTreatment",
  "photographyStyle",
  "shadowStyle",
  "editorialCommercialFeel",
  "lensAndCamera",
  "setContinuity",
] as const;

const UNKNOWN_TEXT = /^(not visible in the supplied references|unknown|none|n\/a|-)$/i;

function knownText(value: unknown, max: number): string {
  const cleaned = text(value, max);
  return UNKNOWN_TEXT.test(cleaned) ? "" : cleaned;
}

/** Builds the cacheable profile from a normalized analysis, or null when it has no room description. */
export function styleReferenceProfileFromAnalysis(normalized: unknown): StyleReferenceProfile | null {
  const analysis = record(normalized);
  const creative = record(analysis.creativeDirection);
  const creativeDirection: JsonRecord = {};
  for (const field of STYLE_PROFILE_CREATIVE_FIELDS) {
    const value = knownText(creative[field], 400);
    if (value) creativeDirection[field] = value;
  }
  if (!Object.keys(creativeDirection).length) return null;
  const styling = record(analysis.stylingPlan);
  const theme = knownText(styling.themeInterpretation, 240);
  const jewellery = knownText(styling.jewellery, 240);
  const modelStyling = knownText(creative.modelStyling, 200);
  return {
    version: 1,
    creativeDirection,
    referencePose: normalizeReferencePose(record(analysis.posePlanning).referencePose ?? analysis.referencePose),
    stylingTaste: text([
      theme ? `Theme: ${theme}.` : "",
      jewellery ? `Jewellery taste: ${jewellery}.` : "",
      modelStyling ? `Model styling: ${modelStyling}.` : "",
    ].filter(Boolean).join(" "), 700),
  };
}

export function isStyleReferenceProfile(value: unknown): value is StyleReferenceProfile {
  const raw = record(value);
  const pose = record(raw.referencePose);
  return raw.version === 1 &&
    Object.keys(record(raw.creativeDirection)).length > 0 &&
    (REFERENCE_POSTURES as readonly string[]).includes(String(pose.posture)) &&
    typeof raw.stylingTaste === "string";
}
