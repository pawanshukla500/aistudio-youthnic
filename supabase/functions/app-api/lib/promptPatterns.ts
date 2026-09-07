/**
 * Pure, fail-closed selection of prompt_patterns rows for analysis/planning.
 *
 * generation_learnings remains an audit ledger and is never accepted here.
 * Only net-successful, tenant-safe, category-compatible patterns may shrink
 * pose/scene invention. Product references still outrank this guidance.
 */

export const MAX_PROMPT_PATTERNS = 3;
export const MAX_PROMPT_PATTERN_CHARS = 700;
export const MAX_PROMPT_PATTERN_ROW_CHARS = 280;

export const PROMPT_PATTERN_KINDS = [
  "pose",
  "scene",
  "styling",
  "analysis",
  "garment",
] as const;
export type PromptPatternKind = typeof PROMPT_PATTERN_KINDS[number];

export type PromptPatternRow = {
  [key: string]: unknown;
  id?: unknown;
  organization_id?: unknown;
  product_category?: unknown;
  pattern_kind?: unknown;
  title?: unknown;
  pattern_text?: unknown;
  success_count?: unknown;
  failure_count?: unknown;
  avg_quality?: unknown;
};

export type PromptPatternSelection = {
  ids: string[];
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
  return `${normalized.slice(0, Math.max(0, maxChars - suffix.length)).trimEnd()}${suffix}`;
}

function isKind(value: unknown): value is PromptPatternKind {
  return PROMPT_PATTERN_KINDS.includes(text(value) as PromptPatternKind);
}

function orgAllowed(row: PromptPatternRow, organizationId: string) {
  const owner = text(row.organization_id);
  return !owner || owner === organizationId;
}

function categoryMatches(row: PromptPatternRow, productCategory: string) {
  const category = comparable(row.product_category) || "general";
  return category === "general" || category === productCategory;
}

function netSuccessful(row: PromptPatternRow) {
  const success = Number(row.success_count);
  const failure = Number(row.failure_count);
  const successCount = Number.isFinite(success) ? success : 0;
  const failureCount = Number.isFinite(failure) ? failure : 0;
  return successCount >= 1 && successCount > failureCount;
}

function quality(row: PromptPatternRow) {
  const value = Number(row.avg_quality);
  return Number.isFinite(value) ? value : 0;
}

function rank(row: PromptPatternRow) {
  return Number(row.success_count || 0) * 100 + quality(row);
}

export function selectPromptPatterns(
  rows: readonly PromptPatternRow[] | null | undefined,
  args: { organizationId: string; productCategory?: string },
): PromptPatternSelection {
  const organizationId = text(args.organizationId);
  const productCategory = comparable(args.productCategory);
  if (!organizationId || !productCategory || !Array.isArray(rows)) {
    return { ids: [], guidance: "" };
  }

  const eligible = rows.filter((row) => (
    orgAllowed(row, organizationId) &&
    categoryMatches(row, productCategory) &&
    isKind(row.pattern_kind) &&
    netSuccessful(row)
  )).sort((left, right) => {
    const delta = rank(right) - rank(left);
    if (delta) return delta;
    return text(left.id).localeCompare(text(right.id));
  });

  const selected: Array<{ id: string; guidance: string }> = [];
  let used = 0;
  for (const row of eligible) {
    if (selected.length >= MAX_PROMPT_PATTERNS) break;
    const id = text(row.id);
    if (!id || selected.some((entry) => entry.id === id)) continue;
    const compacted = compactGuidance(row.pattern_text, MAX_PROMPT_PATTERN_ROW_CHARS);
    if (!compacted) continue;
    const prefix = used ? "\n- " : "- ";
    const available = MAX_PROMPT_PATTERN_CHARS - used - prefix.length;
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
