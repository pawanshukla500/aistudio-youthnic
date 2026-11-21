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
  /** Who sets the body: the slot's standing cue, a seated frame, or the REFERENCE POSE MATCH block. */
  bodyOwner?: "slot" | "seated" | "reference";
  /** The face source the prompt actually attaches, e.g. "the MODEL FACE REFERENCE" or "the modelIdentity description". */
  faceSource?: string;
  hasApprovedAnchor?: boolean;
  /** The STYLE REFERENCE person is not the identity, so their face must never be copied. */
  styleFaceForbidden?: boolean;
};

export type FrameDirection = {
  /** Short "gaze; head; mouth" text. */
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

const SEATED_BODY = "an easy seated gesture: one hand rests lightly on the knee or the seat edge while the other touches the hair or an earring, shoulders relaxed";
const REFERENCE_BODY = "the body exactly as the REFERENCE POSE MATCH block sets it";

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

// A reference crop ("knees-up") must not override this frame's framing.
const CROP_WORDS = /\b(?:knees?-up|waist-up|chest-up|thigh-up|hip-up|close[- ]?up|crop(?:ped)?|tight|half[- ]body|bust|head[- ]and[- ]shoulders)\b,?/gi;

function shiftedSmile(base: SmileLevel, shift: number, energy: ExpressionEnergy): SmileLevel {
  const cap = SMILE_ORDER.indexOf(MAX_SMILE[energy]);
  const index = Math.max(0, Math.min(cap, SMILE_ORDER.indexOf(base) + shift));
  return SMILE_ORDER[index];
}

function clean(value: string, max = 200) {
  return value.replace(/\s+/g, " ").trim().replace(/^[,;\s]+|[.;,\s]+$/g, "").slice(0, max);
}

function identitySentence(input: FrameDirectionInput, reference: boolean): string {
  const source = input.faceSource || "the identity image";
  const anchor = input.hasApprovedAnchor && source !== "APPROVED POSE 1";
  const from = `Copy only the face itself from ${source}${anchor ? " and APPROVED POSE 1" : ""}`;
  const never = reference
    ? input.hasApprovedAnchor ? ", never APPROVED POSE 1's expression, gaze or head tilt" : ""
    : ", never their expression, gaze or head tilt";
  const style = reference && input.styleFaceForbidden ? " Take only the look from the STYLE REFERENCE person, never their face." : "";
  return `${from}${never}.${style}`;
}

/** null for the back view and any slot without a face direction. */
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
  const owner = input.bodyOwner ?? "slot";
  const gesture = input.reference?.hands
    ? `${clean(input.reference.hands)}, as the STYLE REFERENCE person does`
    : owner === "reference" ? REFERENCE_BODY : owner === "seated" ? SEATED_BODY : look.body;
  const body = input.propsInHands
    ? `shoulders relaxed and slightly uneven${owner === "slot" ? ", weight on one hip" : ""}; the props stay as the REQUESTED PROPS line places them`
    : `${gesture} (a hand given a task in the hand placement line keeps it)`;
  const camera = clean((input.reference?.cameraAngle ?? "").replace(CROP_WORDS, ""), 120);
  const summary = `${gaze}; ${head}; ${expression}`;
  // Kept short: it rides in the uncompacted closing tail.
  const block = [
    `THIS FRAME'S EXPRESSION, GAZE & BODY LANGUAGE: ${summary}. Body: ${body}. ${GARMENT_SAFE_HANDS}.`,
    identitySentence(input, Boolean(reference)),
    "A candid moment, never a frozen stare, a fixed stock smile or both arms hanging straight.",
    camera ? `Camera: ${camera}, as the STYLE REFERENCE is shot, within this frame's ALLOWED DELTA framing.` : "",
  ].filter(Boolean).join(" ");
  return { summary, block };
}

const GAZE_WORD = /\b(?:gaz\w*|eyes?|eye contact|glanc\w*|look\w*|stare\w*|staring|facing)\b/i;
const LENS_TAIL = /\s*\b(?:toward(?:s)?|into|at|to|facing)\s+(?:the\s+)?(?:lens|camera|viewer)\b.*$/i;

/** Expression text without its gaze clauses ("soft smile, eyes to camera" -> "soft smile"); the mouth is kept. */
export function withoutGazeWords(value: string): string {
  return value
    .split(/[,;]/)
    .map((clause) =>
      clause
        .split(/\s+(?:with|and)\s+/i)
        .map((part) => part.replace(LENS_TAIL, ""))
        .filter((part) => part.trim() && !GAZE_WORD.test(part))
        .join(" and ")
        .trim()
    )
    .filter(Boolean)
    .join(", ")
    .replace(/[.\s]+$/, "")
    .trim();
}

// Gaze and smile phrases written into the face lock as if they were features. Only the
// phrase goes; a fragment is dropped whole only when it names no facial feature.
const GAZE_TAIL = /\s*,?\s*\b(?:glancing|looking|gazing|staring)\b(?:\s+[\w-]+){0,4}?\s+(?:sideways|away|aside|down(?:ward)?|up(?:ward)?|off[- ]camera|to(?:ward)?\s+(?:the\s+)?(?:camera|lens|side|viewer)|at\s+(?:the\s+)?(?:camera|lens|viewer))\b/gi;
const PHRASE_TAIL = /\s+(?:(?:that\s+)?curv(?:e|es|ing)\s+into|in|with|and)\s+(?:an?\s+)?(?:[\w-]+\s+){0,3}?(?:smile|grin|gaze|glance|expression)\b/gi;
const EXPRESSION_ONLY = /\b(?:gaz\w*|glanc\w*|smil\w*|grin\w*|expression\w*)\b/i;
const FACE_FEATURE = /\b(?:eyes?|eyebrows?|brows?|nose|lips?|mouth|jaw\w*|cheeks?|cheekbones?|chin|lashes|teeth|forehead)\b/i;
const ALWAYS_DROP = /\bshown at (?:a |an )?(?:slight )?angle\b/i;

/** Face-lock text without gaze, smile or expression phrases; features are kept. Unchanged when nothing would be left. */
export function withoutExpressionWords(value: string): string {
  const stripped = value.replace(GAZE_TAIL, "").replace(PHRASE_TAIL, "");
  const kept = stripped
    .split(/(?<=[,;.])\s+/)
    .filter((part) => !ALWAYS_DROP.test(part) && !(EXPRESSION_ONLY.test(part) && !FACE_FEATURE.test(part)));
  const result = kept.join(" ").replace(/[,;]\s*([.;]|$)/g, "$1").replace(/\s{2,}/g, " ").trim();
  return result || value;
}

/** modelIdentity with the expression words removed from its face description (faceRealism keeps its teeth/smile realism rules). */
export function identityWithoutExpression<T>(model: T): T {
  if (!model || typeof model !== "object" || Array.isArray(model)) return model;
  const face = (model as Record<string, unknown>).face;
  return typeof face === "string" ? { ...model, face: withoutExpressionWords(face) } as T : model;
}
