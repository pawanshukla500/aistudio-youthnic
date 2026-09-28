/**
 * One set for the whole shoot.
 *
 * Every frame of a six-pose catalog shoot is the same room, light and colour
 * grade; only the pose, camera angle and framing move. The scene used to reach
 * the image model three ways - Gemini's creativeDirection JSON, a free-text
 * backdrop inside every pose prompt, and the reference images - and whichever
 * one a frame leaned on won. A back view, which never gets the style reference,
 * could land on a different wall.
 *
 * The scene lock is a single short block, built from the shared creative
 * direction, that every pose receives verbatim and near the top of the prompt,
 * where prompt compaction does not reach.
 */

type JsonRecord = Record<string, unknown>;

const LINE_LIMIT = 280;

// Studio's "Auto from references" value. It is an instruction to follow the
// analysis, not a scene of its own, so it must never replace the concrete set
// the analysis described.
export const AUTO_BACKGROUND_STYLE = "Infer a premium consistent scene from the uploaded style reference";

function text(value: unknown, limit = LINE_LIMIT): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1).trimEnd()}…` : normalized;
}

export function isAutoBackgroundStyle(value: unknown): boolean {
  const requested = text(value, 400).toLowerCase();
  return !requested || requested === AUTO_BACKGROUND_STYLE.toLowerCase() || /^(auto\b|infer\b)/.test(requested);
}

/**
 * The creative direction a Studio job runs with. An explicit background choice
 * replaces the analysed set; "Auto" (or nothing) keeps it.
 */
export function applyRequestedBackground(creativeDirection: unknown, backgroundStyle: unknown): JsonRecord {
  const creative = creativeDirection && typeof creativeDirection === "object" && !Array.isArray(creativeDirection)
    ? { ...creativeDirection as JsonRecord }
    : {};
  if (isAutoBackgroundStyle(backgroundStyle)) return creative;
  const requested = text(backgroundStyle, 400);
  return { ...creative, scene: requested, backgroundStyle: requested, studioEnvironment: requested };
}

/**
 * The scene lock for one frame. The set lines are identical for every pose of
 * a shoot; only the closing anchor line depends on what this frame was sent.
 */
export function sceneLockBlock(args: {
  creativeDirection: unknown;
  poseNumber: number;
  hasApprovedAnchor: boolean;
  hasStyleReference: boolean;
}): string {
  const creative = args.creativeDirection && typeof args.creativeDirection === "object" && !Array.isArray(args.creativeDirection)
    ? args.creativeDirection as JsonRecord
    : {};
  const seen = new Set<string>();
  const distinct = (...values: unknown[]) => values
    .map((value) => text(value))
    .filter((value) => {
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  // Studio's "Auto" sentence names no set, so it never stands in for one.
  const set = distinct(...[creative.backgroundStyle, creative.studioEnvironment, creative.scene].filter((value) => !isAutoBackgroundStyle(value)));
  const props = distinct(creative.propUsage);
  const light = distinct(creative.lighting, creative.shadowStyle);
  const grade = distinct(creative.colorTreatment);
  const continuity = distinct(creative.setContinuity);
  const lines = [
    set.length ? `- Set and backdrop: ${set.join("; ")}` : "",
    props.length ? `- Props and furniture: ${props.join("; ")}. Nothing is added or removed between frames.` : "- Props and furniture: exactly those of the established set. Nothing is added or removed between frames.",
    light.length ? `- Light: ${light.join("; ")}` : "",
    grade.length ? `- Colour grade: ${grade.join("; ")}` : "",
    continuity.length ? `- Continuity: ${continuity.join("; ")}` : "",
  ].filter(Boolean);
  const anchor = args.hasApprovedAnchor
    ? "- APPROVED POSE 1 in the manifest is this set as photographed. Match its wall colour and finish, floor, props, light direction and colour grade exactly."
    : args.poseNumber === 1
      ? `- This frame establishes the set for all six frames: build exactly the set above${args.hasStyleReference ? " as the STYLE REFERENCE shows it" : ""}.`
      : `- Build exactly the set above${args.hasStyleReference ? " as the STYLE REFERENCE shows it" : ""}; every other frame of this shoot uses the same one.`;
  return `SCENE LOCK - THE SAME SET IN ALL SIX FRAMES (only pose, camera angle and framing change):
${lines.join("\n")}
${anchor}
- A back view, close-up, seated or showcase frame is the same room seen from another camera position. It never moves to a different wall, backdrop or location from the rest of the shoot.
- Any set, background or lighting wording in the pose text below is superseded by this lock.`;
}
