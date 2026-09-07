/**
 * Pure, fail-closed selection of fashion_knowledge_base rows.
 *
 * Live bottoms rows are mostly pose/framing. Only cut/print/silhouette guidance
 * may reach analysis or generation, and product references always outrank it.
 */

export const MAX_FASHION_KNOWLEDGE_ROWS = 2;
export const MAX_FASHION_KNOWLEDGE_CHARS = 700;
export const MAX_FASHION_KNOWLEDGE_ROW_CHARS = 350;

export type FashionKnowledgeRow = {
  [key: string]: unknown;
  id?: unknown;
  organization_id?: unknown;
  category?: unknown;
  topic?: unknown;
  title?: unknown;
  guidance?: unknown;
  tags?: unknown;
  priority?: unknown;
  is_active?: unknown;
};

export type FashionKnowledgeSelection = {
  ids: string[];
  guidance: string;
};

const BOTTOM_IDENTITY_RE = /\b(farshi|farsi|pajama|bottom.?wear|palazzo|sharara|gharara|salwar|trouser)\b/i;
const CUT_PRINT_RE =
  /\b(cut|silhouette|print|motif|floral|boota|volume|pleat|farshi|farsi|palazzo|lehenga|pajama)\b/i;
const FARSHI_RE = /\b(farshi|farsi)\b/i;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

function tagsOf(value: unknown) {
  return (Array.isArray(value) ? value : []).map((entry) => text(entry).toLowerCase()).filter(Boolean);
}

function haystack(row: FashionKnowledgeRow) {
  return [text(row.title), text(row.topic), text(row.category), tagsOf(row.tags).join(" ")].join(" ");
}

function isActive(row: FashionKnowledgeRow) {
  return row?.is_active === true || String(row?.is_active || "").toLowerCase() === "true";
}

function orgAllowed(row: FashionKnowledgeRow, organizationId: string) {
  const owner = text(row.organization_id);
  return !owner || owner === organizationId;
}

function isBottomCutPrintKnowledge(row: FashionKnowledgeRow) {
  return BOTTOM_IDENTITY_RE.test(haystack(row)) && CUT_PRINT_RE.test(text(row.guidance));
}

function rank(row: FashionKnowledgeRow) {
  const farshi = FARSHI_RE.test(`${haystack(row)} ${text(row.guidance)}`) ? 1_000 : 0;
  const priority = Number(row.priority);
  return farshi + (Number.isFinite(priority) ? priority : 0);
}

export function selectFashionKnowledgeGuidance(
  rows: readonly FashionKnowledgeRow[] | null | undefined,
  args: { organizationId: string; category?: string; garmentFamily?: string },
): FashionKnowledgeSelection {
  const organizationId = text(args.organizationId);
  if (!organizationId || !Array.isArray(rows)) return { ids: [], guidance: "" };
  if (/\bsaree\b/i.test(`${text(args.garmentFamily)} ${text(args.category)}`)) {
    return { ids: [], guidance: "" };
  }

  const eligible = rows.filter((row) => (
    isActive(row) && orgAllowed(row, organizationId) && isBottomCutPrintKnowledge(row)
  )).sort((left, right) => {
    const delta = rank(right) - rank(left);
    if (delta) return delta;
    return text(left.id).localeCompare(text(right.id));
  });

  const selected: Array<{ id: string; guidance: string }> = [];
  let used = 0;
  for (const row of eligible) {
    if (selected.length >= MAX_FASHION_KNOWLEDGE_ROWS) break;
    const id = text(row.id) || `row-${selected.length}`;
    const compacted = compactGuidance(row.guidance, MAX_FASHION_KNOWLEDGE_ROW_CHARS);
    if (!compacted) continue;
    const prefix = used ? "\n- " : "- ";
    const available = MAX_FASHION_KNOWLEDGE_CHARS - used - prefix.length;
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
