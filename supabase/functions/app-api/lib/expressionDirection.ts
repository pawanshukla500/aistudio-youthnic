/**
 * Per-frame expression, gaze and body-language direction.
 *
 * Audited shoots (Nov 2026) put nearly the same expression on every face-visible frame
 * ("calm soft smile, eyes to camera"), the identity lock carried a gaze and a smile as if
 * they were face features, and the APPROVED POSE 1 anchor pulled its expression and head
 * angle into later frames. Five frames looked into the lens with one frozen smile and both
 * arms hanging. Each slot now gets its own gaze target, head angle, mouth and one natural
 * body-language cue; the shoot's expression plan only sets the mood (smile level, energy).
 * Pose 4 can take the STYLE REFERENCE person's expression, gaze, head angle and hand gesture
 * (never their face) when the analysis recorded them.
 */
import type { ExpressionEnergy, SmileLevel } from "./posePlanning.ts";

/** The reference person's look, recorded by analysis v37 (referencePose). Empty strings when absent. */
export type ReferenceLook = { expression: string; gaze: string; hands: string; cameraAngle: string };

export type FrameDirectionInput = {
  poseId: string;
  energy?: ExpressionEnergy;
  smile?: SmileLevel;
  /** The requested props occupy the hands (REQUESTED PROPS block). */
  propsInHands?: boolean;
  /** Set when this frame takes the STYLE REFERENCE person's look. */
  reference?: ReferenceLook | null;
  /** The planner's expression for this frame (posePlanning.expressions); its gaze words are dropped, the slot owns the gaze. */
  plannedMood?: string;
};

export type FrameDirection = {
  /** Short "gaze; head; mouth" text for ALLOWED DELTA and the frame lines. */
  summary: string;
  /** Uncompacted closing-tail block. */
  block: string;
};

type SlotLook = { gaze: string; head: string; smileShift: number; body: string };

// No two face-visible slots share a gaze target. Pose 1 keeps the catalog eye contact.
const SLOT_LOOKS: Record<string, SlotLook> = {
  full_front: {
    gaze: "eyes meet the lens directly, with warmth",
    head: "head straight, chin level, the smallest natural tilt",
    smileShift: 0,
    body: "weight settles on one hip; one hand rests lightly against the thigh or side seam while the other arm bends softly at the elbow",
  },
  angled: {
    gaze: "eyes look just past the lens, toward the side the body turns to",
    head: "head turns a little further than the shoulders, chin a touch lower",
    smileShift: -1,
    body: "the leading shoulder drops slightly; the near hand rests lightly at the waist while the far arm hangs loose with a soft elbow",
  },
  creative: {
    gaze: "gaze drifts away from the camera into the set, toward the light or a point beyond the frame, as if caught between moments",
    head: "chin lifted slightly, head tilted a few degrees",
    smileShift: 1,
    body: "an easy candid gesture: one hand tucks hair behind the ear or touches an earring while the other arm stays loose, weight on the back leg",
  },
  closeup: {
    // Distinct from Pose 1 (frontal eye contact) and Pose 6 (looking down at the garment).
    gaze: "eyes come back to the lens over a quarter head turn, quieter and closer than Pose 1",
    head: "head turned a quarter away from the camera, chin slightly down",
    smileShift: -1,
    body: "one hand rests softly beside or below the featured detail, fingers relaxed",
  },
  showcase: {
    gaze: "eyes glance down toward the featured garment area or over the shoulder, never straight into the lens",
    head: "head inclined toward the featured area",
    smileShift: 0,
    body: "a hand lightly guides the eye toward the featured area while the weight rests on one leg",
  },
};

const SMILE_ORDER: SmileLevel[] = ["none", "soft", "warm", "open"];

const MOUTH: Record<SmileLevel, string> = {
  none: "lips relaxed and softly closed, a quiet thoughtful look",
  soft: "a soft closed-lip smile that reaches the eyes",
  warm: "a warm, genuine smile with a natural softening around the eyes",
  open: "a relaxed open smile, as if mid-conversation, teeth natural and lightly visible",
};

// Calm shoots never go past a warm smile; lively ones may open it.
const MAX_SMILE: Record<ExpressionEnergy, SmileLevel> = {
  serene: "soft",
  calm: "warm",
  warm: "open",
  playful: "open",
  confident: "warm",
  dramatic: "soft",
};

const GARMENT_SAFE_HANDS = "Hands never cover the neckline, embroidery, print, slits or hem";

function shiftedSmile(base: SmileLevel, shift: number, energy: ExpressionEnergy): SmileLevel {
  const cap = SMILE_ORDER.indexOf(MAX_SMILE[energy]);
  const index = Math.max(0, Math.min(cap, SMILE_ORDER.indexOf(base) + shift));
  return SMILE_ORDER[index];
}

function clean(value: string, max = 200) {
  return value.replace(/\s+/g, " ").trim().replace(/[.;,\s]+$/, "").slice(0, max);
}

/** "" for the back view and any slot without a face direction. */
export function frameExpressionDirection(input: FrameDirectionInput): FrameDirection | null {
  const look = SLOT_LOOKS[input.poseId];
  if (!look) return null;
  const energy = input.energy ?? "calm";
  const mouth = MOUTH[shiftedSmile(input.smile ?? "soft", look.smileShift, energy)];
  const reference = input.reference && (input.reference.expression || input.reference.gaze) ? input.reference : null;
  const gaze = reference?.gaze ? `${clean(reference.gaze)}, as the STYLE REFERENCE person looks` : look.gaze;
  const mood = clean(withoutGazeWords(input.plannedMood ?? ""));
  const expression = reference?.expression ? `${clean(reference.expression)}, as on the STYLE REFERENCE person` : mood || mouth;
  const head = reference ? "the head angle the STYLE REFERENCE person holds" : look.head;
  const gesture = reference?.hands ? `${clean(reference.hands)}, as the STYLE REFERENCE person does` : look.body;
  const body = input.propsInHands
    ? "shoulders relaxed and slightly uneven, weight on one hip; the props stay as the REQUESTED PROPS line places them"
    : `${gesture} (a hand given a task in the hand placement line keeps it)`;
  const summary = `${gaze}; ${head}; ${expression}`;
  // Kept short: it rides in the uncompacted closing tail.
  const block = [
    `THIS FRAME'S EXPRESSION, GAZE & BODY LANGUAGE: ${summary}. Body: ${body}. ${GARMENT_SAFE_HANDS}.`,
    reference
      ? "Copy only the face itself from the identity image, never APPROVED POSE 1's expression, gaze or head tilt."
      : "Copy only the face itself from the identity image and APPROVED POSE 1, never their expression, gaze or head tilt.",
    "A candid moment, never a frozen stare, a fixed stock smile or both arms hanging straight.",
    reference?.cameraAngle ? `Camera: ${clean(reference.cameraAngle, 120)}, as the STYLE REFERENCE is shot.` : "",
  ].filter(Boolean).join(" ");
  return { summary, block };
}

const GAZE_CLAUSE = /\s*(?:,|;|\bwith\b|\band\b)?\s*(?:an?\s+)?(?:[\w-]+\s+){0,3}?(?:gaze|eyes?|eye contact|glance|look(?:ing)?)\b(?:\s+[\w-]+){0,5}/gi;

/** Expression text without its gaze clause ("soft smile, eyes to camera" -> "soft smile"). */
export function withoutGazeWords(value: string): string {
  return value.replace(GAZE_CLAUSE, "").replace(/\s{2,}/g, " ").replace(/^[\s,;]+|[\s,;]+$/g, "").trim();
}

// Gaze, smile and mood words written into the face lock as if they were features.
const GAZE_TAIL = /\s*,?\s*\b(?:glancing|looking|gazing|staring)\b(?:\s+[\w-]+){0,4}?\s+(?:sideways|away|aside|down(?:ward)?|up(?:ward)?|off[- ]camera|to(?:ward)?\s+(?:the\s+)?(?:camera|lens|side|viewer)|at\s+(?:the\s+)?(?:camera|lens|viewer))\b/gi;
const SMILE_TAIL = /\s+(?:in|with)\s+(?:an?\s+)?(?:[\w-]+\s+){0,3}?(?:smile|grin|pout|laugh)\b/gi;
const EXPRESSION_FRAGMENT = /\b(?:gaz\w*|glanc\w*|smil\w*|grin\w*|laugh\w*|expression\w*|pout\w*|shown at (?:a |an )?(?:slight )?angle)\b/i;

/** Face-lock text without gaze, smile or expression phrases; features are kept. */
export function withoutExpressionWords(value: string): string {
  const stripped = value.replace(GAZE_TAIL, "").replace(SMILE_TAIL, "");
  const kept = stripped
    .split(/(?<=[,;.])\s+/)
    .filter((part) => !EXPRESSION_FRAGMENT.test(part));
  return kept.join(" ").replace(/[,;]\s*([.;]|$)/g, "$1").replace(/\s{2,}/g, " ").trim();
}

/** modelIdentity with the expression words removed from its face description (faceRealism keeps its teeth/smile realism rules). */
export function identityWithoutExpression<T>(model: T): T {
  if (!model || typeof model !== "object" || Array.isArray(model)) return model;
  const face = (model as Record<string, unknown>).face;
  return typeof face === "string" ? { ...model, face: withoutExpressionWords(face) } as T : model;
}
