/**
 * The sixth frame's subject, and the feedback loop that improves how it is chosen.
 *
 * Frames 1-5 are fixed catalog coverage. The sixth exists to sell whatever makes
 * THIS product worth buying, which differs per SKU: a sequin yoke on one kurti,
 * the flare and border of a farshi on the next, a dupatta's pallu on a third.
 * A fixed formula turned it into a second hero shot, so the choice belongs to
 * the vision analysis, and this module carries that choice plus the record of
 * how earlier choices were received.
 *
 * Imports nothing from profiles.ts or generationPrompt.ts: both depend on it.
 */

type JsonRecord = Record<string, unknown>;

/** The garment component the sixth frame is built around. */
export const SHOWCASE_FEATURE_REGIONS = [
  "neckline",
  "embroidery",
  "print",
  "sleeve",
  "upper_garment",
  "bottom_wear",
  "hem_border",
  "dupatta",
  "pallu",
  "drape",
  "blouse",
  "silhouette",
  "complete_set",
  "other",
] as const;
export type ShowcaseFeatureRegion = typeof SHOWCASE_FEATURE_REGIONS[number];

/** How tightly that component is framed. */
export const SHOWCASE_SHOT_TYPES = [
  "macro_detail",
  "half_body_detail",
  "full_body_feature",
  "drape_feature",
  "movement_feature",
] as const;
export type ShowcaseShotType = typeof SHOWCASE_SHOT_TYPES[number];

/** Shot types that crop in far enough to collide with the pose 5 close-up. */
const TIGHT_SHOT_TYPES: readonly ShowcaseShotType[] = ["macro_detail", "half_body_detail"];

export type ShowcasePlan = {
  heroFeature: string;
  featureRegion: ShowcaseFeatureRegion;
  shotType: ShowcaseShotType;
  whyItSells: string;
  evidenceReference: string;
  framing: string;
  cameraAngle: string;
  bodyPosition: string;
  handPlacement: string;
  expression: string;
  distinctFrom: string;
  visibilityRules: string[];
};

export const MAX_SHOWCASE_FEEDBACK_ROWS = 3;
export const MAX_SHOWCASE_FEEDBACK_CHARS = 620;

export type ShowcaseOutcome = "selected" | "rejected" | "regenerated" | "qa_failed";

export type ShowcaseFeatureOutcomeRow = {
  [key: string]: unknown;
  id?: unknown;
  organization_id?: unknown;
  product_category?: unknown;
  garment_family?: unknown;
  feature_region?: unknown;
  shot_type?: unknown;
  selected_count?: unknown;
  rejected_count?: unknown;
  regenerated_count?: unknown;
  qa_failed_count?: unknown;
  avg_quality?: unknown;
  created_at?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function comparable(value: unknown) {
  return text(value).toLocaleLowerCase();
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

const CONTROL_CHARACTERS = new RegExp("[\\u0000-\\u001f\\u007f]+", "g");

function bounded(value: unknown, maxChars: number) {
  const normalized = text(value).replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  const suffix = " [truncated]";
  if (maxChars <= suffix.length) return normalized.slice(0, maxChars).trimEnd();
  return `${normalized.slice(0, Math.max(0, maxChars - suffix.length)).trimEnd()}${suffix}`;
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export function normalizeShowcaseFeatureRegion(value: unknown): ShowcaseFeatureRegion | "" {
  const normalized = comparable(value).replace(/[\s-]+/g, "_");
  return (SHOWCASE_FEATURE_REGIONS as readonly string[]).includes(normalized)
    ? normalized as ShowcaseFeatureRegion
    : "";
}

export function normalizeShowcaseShotType(value: unknown): ShowcaseShotType | "" {
  const normalized = comparable(value).replace(/[\s-]+/g, "_");
  return (SHOWCASE_SHOT_TYPES as readonly string[]).includes(normalized)
    ? normalized as ShowcaseShotType
    : "";
}

function defaultShotTypeFor(region: ShowcaseFeatureRegion): ShowcaseShotType {
  if (["neckline", "embroidery", "sleeve", "hem_border"].includes(region)) return "macro_detail";
  if (["pallu", "dupatta", "drape"].includes(region)) return "drape_feature";
  if (["bottom_wear", "silhouette", "complete_set"].includes(region)) return "full_body_feature";
  return "half_body_detail";
}

/**
 * A plan is usable only when the analysis actually named a feature and a region.
 * Everything else can be filled from the garment; the subject cannot, and
 * guessing it is exactly the fixed-formula behaviour this replaces.
 */
export function normalizeShowcasePlan(value: unknown): ShowcasePlan | null {
  const raw = objectValue(value);
  const heroFeature = bounded(raw.heroFeature ?? raw.hero_feature, 240);
  const featureRegion = normalizeShowcaseFeatureRegion(raw.featureRegion ?? raw.feature_region);
  if (!heroFeature || !featureRegion) return null;
  const shotType = normalizeShowcaseShotType(raw.shotType ?? raw.shot_type) ||
    defaultShotTypeFor(featureRegion);
  const rules = raw.visibilityRules ?? raw.visibility_rules;
  return {
    heroFeature,
    featureRegion,
    shotType,
    whyItSells: bounded(raw.whyItSells ?? raw.why_it_sells, 220),
    evidenceReference: bounded(raw.evidenceReference ?? raw.evidence_reference, 120),
    framing: bounded(raw.framing, 320),
    cameraAngle: bounded(raw.cameraAngle ?? raw.camera_angle, 220),
    bodyPosition: bounded(raw.bodyPosition ?? raw.body_position, 320),
    handPlacement: bounded(raw.handPlacement ?? raw.hand_placement, 260),
    expression: bounded(raw.expression, 220),
    distinctFrom: bounded(raw.distinctFrom ?? raw.distinct_from, 240),
    visibilityRules: (Array.isArray(rules) ? rules : [])
      .map((entry) => bounded(entry, 200))
      .filter(Boolean)
      .slice(0, 8),
  };
}

/**
 * Pose 5 already sells one detail in a tight crop. When the analysis picks the
 * same subject at the same distance for pose 6, widen it rather than shipping
 * two versions of one frame - the sixth frame's whole job is added coverage.
 */
export function resolveShowcaseShotType(
  plan: ShowcasePlan,
  closeup: { heroDetail?: string },
): { shotType: ShowcaseShotType; widenedFromCloseup: boolean } {
  if (!TIGHT_SHOT_TYPES.includes(plan.shotType)) {
    return { shotType: plan.shotType, widenedFromCloseup: false };
  }
  const heroDetail = comparable(closeup.heroDetail);
  if (!heroDetail) return { shotType: plan.shotType, widenedFromCloseup: false };
  const region = plan.featureRegion.replace(/_/g, " ");
  const collides = heroDetail.includes(region) ||
    comparable(plan.heroFeature).split(/\s+/)
      .filter((word) => word.length > 4)
      .some((word) => heroDetail.includes(word));
  if (!collides) return { shotType: plan.shotType, widenedFromCloseup: false };
  return {
    shotType: ["pallu", "dupatta", "drape"].includes(plan.featureRegion) ? "drape_feature" : "full_body_feature",
    widenedFromCloseup: true,
  };
}

/**
 * The frame this shoot will actually produce, resolved from a creativeDirection.
 *
 * Every consumer must agree on this: the pose slot writes it into the brief, the
 * generation prompt writes the matching hard rule, the shoot memory records it,
 * and the feedback row is keyed by it. Resolving it separately per consumer is
 * how a widened frame ends up scored as the tight one that was never generated.
 */
export function effectiveShowcaseShot(creativeDirection: unknown): {
  plan: ShowcasePlan;
  shotType: ShowcaseShotType;
  widenedFromCloseup: boolean;
} | null {
  const creative = objectValue(creativeDirection);
  const plan = normalizeShowcasePlan(creative.showcasePlan ?? creative.showcase_plan);
  if (!plan) return null;
  const heroDetail = text(creative.closeupHeroDetail ?? creative.closeup_hero_detail);
  const resolved = resolveShowcaseShotType(plan, { heroDetail });
  return { plan, shotType: resolved.shotType, widenedFromCloseup: resolved.widenedFromCloseup };
}

export function showcaseShotDirection(shotType: ShowcaseShotType) {
  return {
    macro_detail:
      "Fill the frame with the named feature so its construction, stitch, motif scale and material read at catalog resolution. The face may be partial at the edge or absent entirely. Never a full-body or hero repeat.",
    half_body_detail:
      "Crop to the body section the feature lives on - roughly head-to-waist or chest-to-hip - so the feature is large and sharp while its placement on the garment stays legible. Tighter than the hero frame, wider than a macro crop.",
    full_body_feature:
      "Frame head-to-toe, but compose and pose for the named feature rather than for a second hero shot: angle, stance and weight shift must be chosen so that feature reads at its best, and it must be unmistakably the subject of the frame.",
    drape_feature:
      "Frame so the draped panel is the subject: held, spread or falling clear of the body and opened flat enough that its artwork, border and full length read end to end, with no arm, hair or prop crossing it.",
    movement_feature:
      "Use controlled movement - a turn, a step, a swing - so the feature's fall, flare, weight or fluidity is visible in motion. The garment must stay readable and uncrumpled throughout.",
  }[shotType];
}

/** The key a feedback row is scored against. */
export function showcaseOutcomeKey(plan: Pick<ShowcasePlan, "featureRegion" | "shotType">) {
  return `${plan.featureRegion}:${plan.shotType}`;
}

function netScore(row: ShowcaseFeatureOutcomeRow) {
  // A regeneration is a softer negative than an outright rejection: the operator
  // wanted this subject shot differently, not a different subject.
  return integer(row.selected_count) * 2 -
    integer(row.rejected_count) * 2 -
    integer(row.regenerated_count) -
    integer(row.qa_failed_count);
}

function quality(row: ShowcaseFeatureOutcomeRow) {
  const value = Number(row.avg_quality);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Bounded, fail-closed guidance for the analysis prompt.
 *
 * This is house taste learned from operators, never product truth: it reports
 * which subjects and framings this team kept and which they threw away, and the
 * prompt that receives it says the current product references still decide.
 */
export function selectShowcaseFeedbackGuidance(
  rows: readonly ShowcaseFeatureOutcomeRow[] | null | undefined,
  args: { organizationId: string; productCategory?: string; garmentFamily?: string },
): { ids: string[]; guidance: string } {
  const organizationId = text(args.organizationId);
  const productCategory = comparable(args.productCategory);
  const garmentFamily = comparable(args.garmentFamily);
  if (!organizationId || !productCategory || !Array.isArray(rows)) return { ids: [], guidance: "" };


  const eligible = rows.filter((row) => {
    const owner = text(row.organization_id);
    if (owner && owner !== organizationId) return false;
    if (comparable(row.product_category) !== productCategory) return false;
    // Strict: a row recorded under one family never advises another, and a
    // caller that does not yet know the family (the analysis has not run) sees
    // only category-wide rows rather than inheriting whichever family wrote last.
    if (comparable(row.garment_family) !== garmentFamily) return false;
    if (!normalizeShowcaseFeatureRegion(row.feature_region)) return false;
    if (!normalizeShowcaseShotType(row.shot_type)) return false;
    // Only rows carrying real feedback say anything.
    return integer(row.selected_count) + integer(row.rejected_count) +
      integer(row.regenerated_count) + integer(row.qa_failed_count) > 0;
  }).sort((left, right) => {
    const delta = Math.abs(netScore(right)) - Math.abs(netScore(left));
    if (delta) return delta;
    const byQuality = quality(right) - quality(left);
    if (byQuality) return byQuality;
    return text(left.id).localeCompare(text(right.id));
  });

  const selected: Array<{ id: string; line: string }> = [];
  let used = 0;
  for (const row of eligible) {
    if (selected.length >= MAX_SHOWCASE_FEEDBACK_ROWS) break;
    const id = text(row.id) || `${comparable(row.feature_region)}:${comparable(row.shot_type)}`;
    if (!id || selected.some((entry) => entry.id === id)) continue;
    const score = netScore(row);
    const reworked = integer(row.rejected_count) + integer(row.regenerated_count) +
      integer(row.qa_failed_count);
    const line = bounded(
      score > 0
        ? `${text(row.feature_region)} as ${text(row.shot_type)}: kept ${integer(row.selected_count)} time(s) - this reads well for this category.`
        : `${text(row.feature_region)} as ${text(row.shot_type)}: reworked or rejected ${reworked} time(s) - prefer a different subject or framing unless the references clearly call for it.`,
      200,
    );
    if (!line) continue;
    const prefix = used ? "\n- " : "- ";
    if (MAX_SHOWCASE_FEEDBACK_CHARS - used - prefix.length < line.length) break;
    selected.push({ id, line });
    used += prefix.length + line.length;
  }

  return {
    ids: selected.map((entry) => entry.id),
    guidance: selected.map((entry) => `- ${entry.line}`).join("\n"),
  };
}

export function nextShowcaseOutcomeCounts(
  row: ShowcaseFeatureOutcomeRow | null | undefined,
  outcome: ShowcaseOutcome,
  qualityScore?: number | null,
) {
  const counts = {
    selectedCount: integer(row?.selected_count) + (outcome === "selected" ? 1 : 0),
    rejectedCount: integer(row?.rejected_count) + (outcome === "rejected" ? 1 : 0),
    regeneratedCount: integer(row?.regenerated_count) + (outcome === "regenerated" ? 1 : 0),
    qaFailedCount: integer(row?.qa_failed_count) + (outcome === "qa_failed" ? 1 : 0),
  };
  const previousAverage = Number(row?.avg_quality);
  const score = Number(qualityScore);
  let avgQuality: number | null = Number.isFinite(previousAverage) ? previousAverage : null;
  if (outcome === "selected" && Number.isFinite(score) && score >= 0 && score <= 100 && counts.selectedCount > 0) {
    const prior = Number.isFinite(previousAverage) ? previousAverage : score;
    const priorWeight = Math.max(0, counts.selectedCount - 1);
    avgQuality = Math.round(((prior * priorWeight) + score) / counts.selectedCount * 100) / 100;
  }
  return { ...counts, avgQuality };
}

export const SHOWCASE_OUTCOME_WRITE_ATTEMPTS = 4;

export function planShowcaseOutcomeWrite(
  rows: readonly ShowcaseFeatureOutcomeRow[] | null | undefined,
  outcome: ShowcaseOutcome,
  qualityScore?: number | null,
) {
  const sorted = [...(Array.isArray(rows) ? rows : [])].filter((row) => text(row.id))
    .sort((left, right) => {
      const created = (Date.parse(text(left.created_at)) || 0) - (Date.parse(text(right.created_at)) || 0);
      if (created) return created;
      return text(left.id).localeCompare(text(right.id));
    });
  const row = sorted[0];
  if (!row) return { action: "insert" as const, next: nextShowcaseOutcomeCounts(null, outcome, qualityScore) };
  return {
    action: "update" as const,
    id: text(row.id),
    expected: {
      selectedCount: integer(row.selected_count),
      rejectedCount: integer(row.rejected_count),
      regeneratedCount: integer(row.regenerated_count),
      qaFailedCount: integer(row.qa_failed_count),
    },
    next: nextShowcaseOutcomeCounts(row, outcome, qualityScore),
  };
}
