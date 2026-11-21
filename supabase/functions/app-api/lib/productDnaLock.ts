/**
 * Product DNA V2 (FastAPI /api/v1/dna/*, table product_dna_versions) as a
 * generation product lock. Pure: no database, network or env reads.
 *
 * A DNA version a person approved in Studio (dna.approve stores their email in
 * approved_by) is a reviewed record of the SKU's invariants and prohibited
 * changes. The worker loads the latest such version for the job's SKU and
 * merges those locks into this attempt's productIdentity, so the image prompt
 * (invariantDetails, absenceConstraints) and the DNA consistency check read
 * them. Workflow approvals (dna_agent, auto_workflow) are not reviews and are
 * ignored. The session's own analysis stays the base truth: a DNA version that
 * describes a different kind of product (saree vs not, Farshi vs not) is
 * skipped whole, and entries already in the analysis are not repeated.
 */

type JsonRecord = Record<string, unknown>;

export const MAX_DNA_LOCK_ENTRIES = 8;
export const MAX_DNA_LOCK_ENTRY_CHARS = 240;

export type ApprovedProductDnaRow = {
  version?: unknown;
  approved_by?: unknown;
  dna_payload?: unknown;
};

export type ProductDnaLock =
  | { applied: true; version: number; productIdentity: JsonRecord; invariants: string[]; prohibitions: string[] }
  | { applied: false; reason: string };

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function isSaree(garmentFamily: unknown): boolean {
  const normalized = String(garmentFamily ?? "").trim().toLowerCase();
  return normalized === "saree" || normalized.startsWith("saree_");
}

/** Comparison key: case, punctuation and spacing do not make two entries different. */
function entryKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean) : [];
}

/**
 * DNA entries that may join the product truth. Snake-case tokens read as words.
 * Dropped: pose-numbered rules (the Python DNA baselines number poses differently
 * from this worker, e.g. "Back view (Pose 4)"), and the floating-hand token,
 * which is anatomy, not product truth (the anatomy rules already cover it).
 */
function lockEntries(value: unknown, existing: unknown): string[] {
  const seen = new Set(stringList(existing).map(entryKey));
  const entries: string[] = [];
  for (const raw of stringList(value)) {
    const text = (/^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(raw) ? raw.replace(/_/g, " ") : raw).slice(0, MAX_DNA_LOCK_ENTRY_CHARS);
    const key = entryKey(text);
    if (!key || seen.has(key) || /\bpose\s*[1-6]\b/i.test(text) || key === "floating hand") continue;
    seen.add(key);
    entries.push(text);
    if (entries.length >= MAX_DNA_LOCK_ENTRIES) break;
  }
  return entries;
}

/**
 * Merges a person-approved Product DNA version into a copy of productIdentity.
 * `farshi` is the job's Farshi verdict (isFarshiGeneration), so Farshi DNA never
 * reaches a non-Farshi shoot and the reverse.
 */
export function productDnaLock(
  row: ApprovedProductDnaRow | null | undefined,
  productIdentity: unknown,
  context: { farshi: boolean },
): ProductDnaLock {
  if (!row) return { applied: false, reason: "no approved Product DNA for this SKU" };
  if (!String(row.approved_by ?? "").includes("@")) {
    return { applied: false, reason: "Product DNA was approved by a workflow, not a person" };
  }
  const dna = record(row.dna_payload);
  if ((dna.metadata as JsonRecord | undefined)?.analysis_source === "heuristic_offline") {
    return { applied: false, reason: "Product DNA came from the offline heuristic" };
  }
  const product = record(productIdentity);
  if (isSaree(dna.garment_family) !== isSaree(product.garmentFamily)) {
    return { applied: false, reason: "Product DNA garment family does not match the analysis" };
  }
  if ((String(record(dna.bottom_wear).cut_class ?? "").toLowerCase() === "farshi") !== context.farshi) {
    return { applied: false, reason: "Product DNA bottom cut does not match this shoot" };
  }
  const invariants = lockEntries(dna.explicit_invariants, product.invariantDetails);
  const prohibitions = lockEntries(dna.prohibited_changes, product.absenceConstraints);
  if (!invariants.length && !prohibitions.length) {
    return { applied: false, reason: "Product DNA adds nothing beyond the analysis" };
  }
  return {
    applied: true,
    version: Number(row.version) || 0,
    invariants,
    prohibitions,
    // Approved locks go first: the DNA check reads only the start of invariantDetails.
    productIdentity: {
      ...product,
      invariantDetails: [...invariants, ...stringList(product.invariantDetails)],
      absenceConstraints: [...prohibitions, ...stringList(product.absenceConstraints)],
    },
  };
}
