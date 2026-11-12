/**
 * Pure, fail-closed selection for reusable generation guidance.
 *
 * `generation_learnings` is an observation/audit ledger and is intentionally not
 * accepted here. Only records from the separate, explicitly approved rule table
 * may reach a generation prompt. Product-scoped rules additionally require the
 * exact current source-reference fingerprint.
 */

export const MAX_REUSABLE_LEARNING_RULES = 3;
export const MAX_REUSABLE_LEARNING_GUIDANCE_CHARS = 900;
export const MAX_REUSABLE_RULE_GUIDANCE_CHARS = 300;

export type LearningRuleScope = "category" | "pose" | "product";
export type LearningRuleKind = "presentation" | "qa_guard" | "reference_guard";

export type GenerationLearningRuleRow = {
  [key: string]: unknown;
  id?: unknown;
  organization_id?: unknown;
  garment_family?: unknown;
  product_category?: unknown;
  pose_id?: unknown;
  scope?: unknown;
  rule_kind?: unknown;
  reference_fingerprint?: unknown;
  guidance?: unknown;
  status?: unknown;
  approved_by_member_id?: unknown;
  approved_at?: unknown;
};

export type ReusableLearningRuleArgs = {
  organizationId: string;
  garmentFamily: string;
  productCategory: string;
  poseType?: string;
  referenceFingerprint?: string;
  maxRules?: number;
  maxGuidanceChars?: number;
  maxRuleGuidanceChars?: number;
};

export type ReusableLearningRule = {
  id: string;
  scope: LearningRuleScope;
  kind: LearningRuleKind;
  guidance: string;
};

export type ReusableLearningRuleSelection = {
  ruleIds: string[];
  guidance: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function comparable(value: unknown) {
  return text(value).toLocaleLowerCase();
}

function compactGuidance(value: unknown, maxChars: number) {
  const normalized = text(value).replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  const suffix = " [truncated]";
  if (maxChars <= suffix.length) return normalized.slice(0, maxChars).trimEnd();
  return `${
    normalized.slice(0, Math.max(0, maxChars - suffix.length)).trimEnd()
  }${suffix}`;
}

function clampInteger(value: unknown, fallback: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), maximum));
}

function validScope(value: unknown): LearningRuleScope | null {
  const scope = text(value);
  return scope === "category" || scope === "pose" || scope === "product"
    ? scope
    : null;
}

function validKind(value: unknown): LearningRuleKind | null {
  const kind = text(value);
  return kind === "presentation" || kind === "qa_guard" ||
      kind === "reference_guard"
    ? kind
    : null;
}

function scopeAndKindAreSafe(
  scope: LearningRuleScope,
  kind: LearningRuleKind,
  poseId: string,
  fingerprint: string,
) {
  if (scope === "category") {
    return poseId === "" && fingerprint === "" &&
      (kind === "presentation" || kind === "qa_guard");
  }
  if (scope === "pose") {
    return poseId !== "" && fingerprint === "" &&
      (kind === "presentation" || kind === "qa_guard");
  }
  return fingerprint !== "" && kind === "reference_guard";
}

/**
 * Select only the rows that can safely influence a new generation. This is a
 * second guard after the database query so a future broad query cannot leak an
 * unreviewed, cross-tenant, cross-garment, or stale product-specific rule.
 */
export function selectReusableLearningRules(
  rows: readonly GenerationLearningRuleRow[] | null | undefined,
  args: ReusableLearningRuleArgs,
): ReusableLearningRuleSelection {
  const expectedOrg = text(args.organizationId);
  const expectedFamily = comparable(args.garmentFamily);
  const expectedCategory = comparable(args.productCategory);
  const expectedPose = comparable(args.poseType);
  // A fingerprint is intentionally case-sensitive: it is an exact source
  // version, not a natural-language category value.
  const expectedFingerprint = text(args.referenceFingerprint);
  const maxRules = clampInteger(
    args.maxRules,
    MAX_REUSABLE_LEARNING_RULES,
    MAX_REUSABLE_LEARNING_RULES,
  );
  const maxGuidanceChars = clampInteger(
    args.maxGuidanceChars,
    MAX_REUSABLE_LEARNING_GUIDANCE_CHARS,
    MAX_REUSABLE_LEARNING_GUIDANCE_CHARS,
  );
  const maxRuleGuidanceChars = clampInteger(
    args.maxRuleGuidanceChars,
    MAX_REUSABLE_RULE_GUIDANCE_CHARS,
    MAX_REUSABLE_RULE_GUIDANCE_CHARS,
  );

  if (
    !expectedOrg || !expectedFamily || !expectedCategory || !Array.isArray(rows)
  ) {
    return { ruleIds: [], guidance: "" };
  }

  const seenIds = new Set<string>();
  const selected: ReusableLearningRule[] = [];
  let guidanceLength = 0;

  for (const row of rows) {
    if (selected.length >= maxRules) break;
    const id = text(row?.id);
    const scope = validScope(row?.scope);
    const kind = validKind(row?.rule_kind);
    const poseId = comparable(row?.pose_id);
    const fingerprint = text(row?.reference_fingerprint);

    // Explicit approval means a recorded approved state plus its authorized
    // actor and timestamp; never infer approval from completion or a score.
    if (
      !id || seenIds.has(id) || comparable(row?.status) !== "approved" ||
      !text(row?.approved_by_member_id) || !text(row?.approved_at) ||
      text(row?.organization_id) !== expectedOrg ||
      comparable(row?.garment_family) !== expectedFamily ||
      comparable(row?.product_category) !== expectedCategory ||
      !scope || !kind || !scopeAndKindAreSafe(scope, kind, poseId, fingerprint)
    ) continue;

    if (scope === "pose" && (!expectedPose || poseId !== expectedPose)) {
      continue;
    }
    if (scope === "product") {
      if (!expectedFingerprint || fingerprint !== expectedFingerprint) continue;
      // Product rules may be pose-specific, but only when that exact pose is
      // currently being generated.
      if (poseId && (!expectedPose || poseId !== expectedPose)) continue;
    }

    const compacted = compactGuidance(row?.guidance, maxRuleGuidanceChars);
    if (!compacted) continue;
    const prefix = guidanceLength ? "\n- " : "- ";
    const available = maxGuidanceChars - guidanceLength - prefix.length;
    if (available < 2) break;
    const guidance = compactGuidance(compacted, available);
    if (!guidance) continue;

    selected.push({ id, scope, kind, guidance });
    seenIds.add(id);
    guidanceLength += prefix.length + guidance.length;
  }

  return {
    ruleIds: selected.map((rule) => rule.id),
    guidance: selected.map((rule) => `- ${rule.guidance}`).join("\n"),
  };
}

export type LearningOutcomeRow = {
  [key: string]: unknown;
  id?: unknown;
  organization_id?: unknown;
  sku_id?: unknown;
  rule_type?: unknown;
  rule_text?: unknown;
  trigger_condition?: unknown;
  positive_guidance?: unknown;
  effectiveness_score?: unknown;
  is_active?: unknown;
  approved?: unknown;
};

/**
 * Filter approved organizational learning outcomes so Farshi rules never bleed
 * onto Palazzo/Sharara/Straight/Saree SKUs, and cross-tenant rows never leak.
 */
export function selectApprovedLearningOutcomes(
  rows: readonly LearningOutcomeRow[] | null | undefined,
  args: { organizationId: string; garmentFamily?: string; bottomCutClass?: string },
): { ids: string[]; guidance: string } {
  const expectedOrg = text(args.organizationId);
  if (!expectedOrg || !Array.isArray(rows)) return { ids: [], guidance: "" };
  const family = comparable(args.garmentFamily);
  const bottomCut = comparable(args.bottomCutClass);
  const isSaree = family === "saree";
  const FAMILY_NON_FARSHI = new Set(["palazzo", "sharara_gharara", "sharara", "salwar_churidar", "churidar", "straight_trouser", "straight", "skirt_lehenga", "skirt", "none", "other"]);

  const selected: Array<{ id: string; guidance: string }> = [];
  let used = 0;
  for (const row of rows) {
    if (selected.length >= MAX_REUSABLE_LEARNING_RULES) break;
    const id = text(row?.id);
    const active = row?.is_active === true || comparable(row?.is_active) === "true";
    const approved = row?.approved === true || comparable(row?.approved) === "true";
    if (!id || !active || !approved || text(row?.organization_id) !== expectedOrg) continue;

    const trigger = row?.trigger_condition && typeof row.trigger_condition === "object"
      ? (row.trigger_condition as Record<string, unknown>)
      : {};
    const triggerFamily = comparable(trigger.garment_family ?? trigger.garmentFamily);
    const triggerCut = comparable(trigger.bottom_cut ?? trigger.bottomCut ?? trigger.cut_class);
    if (triggerFamily && family && triggerFamily !== family) continue;
    if (triggerCut && triggerCut !== (bottomCut || "none")) continue;

    const guidanceRaw = text(row?.positive_guidance) || text(row?.rule_text);
    const lower = `${text(row?.rule_text)} ${guidanceRaw}`.toLowerCase();
    if (isSaree && (/\b(farshi|farsi|fasi|palazzo|sharara|salwar|trouser)\b/i.test(lower))) continue;
    if (!isSaree && /\bsaree\b/i.test(lower) && !/\bkurti|kurta\b/i.test(lower)) continue;
    if (/\b(farshi|farsi|fasi)\b/i.test(lower) && (isSaree || !bottomCut || FAMILY_NON_FARSHI.has(bottomCut))) continue;

    const compacted = compactGuidance(guidanceRaw, MAX_REUSABLE_RULE_GUIDANCE_CHARS);
    if (!compacted) continue;
    const prefix = used ? "\n- " : "- ";
    const available = MAX_REUSABLE_LEARNING_GUIDANCE_CHARS - used - prefix.length;
    if (available < 2) break;
    const guidance = compactGuidance(compacted, available);
    if (!guidance) continue;
    selected.push({ id, guidance });
    used += prefix.length + guidance.length;
  }

  return {
    ids: selected.map((entry) => entry.id),
    guidance: selected.map((entry) => `- ${entry.guidance}`).join("\n"),
  };
}
