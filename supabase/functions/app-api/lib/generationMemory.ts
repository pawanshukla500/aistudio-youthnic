/**
 * Session and house generation memory.
 *
 * Images already live in catalog/Firebase storage. This module labels those
 * assets (product vs style vs model vs approved), keeps corrections, and
 * extracts only generic presentation patterns for prompt_patterns. Product
 * construction never becomes a reusable house pattern; generation_learnings
 * remains an audit ledger and is not accepted here.
 */

import { type JsonRecord } from "./profiles.ts";
import { PRODUCT_REFERENCE_ROLES } from "./referencePolicy.ts";
import { type PromptPatternKind } from "./promptPatterns.ts";

export const GENERATION_MEMORY_VERSION = 1;
export const MAX_MEMORY_ASSETS = 12;
export const MAX_MEMORY_CORRECTIONS = 12;
export const MAX_MEMORY_PRESERVED_DETAILS = 10;
export const MAX_MEMORY_BRIEF_CHARS = 900;
export const MAX_PATTERN_TEXT_CHARS = 280;

const PRODUCT_ROLE_SET = new Set<string>(PRODUCT_REFERENCE_ROLES);

export type ReferenceRoleClass = "product" | "style" | "model" | "approved" | "other";

export type MemoryAsset = {
  poseIndex: number;
  url: string;
  storagePath: string;
  qaStatus: string;
  approvalStatus: string;
};

export type MemoryCorrection = {
  poseIndex: number;
  text: string;
};

export type GenerationMemory = {
  version: number;
  productRoles: string[];
  styleRoles: string[];
  modelRoles: string[];
  preservedDetails: string[];
  generatedAssets: MemoryAsset[];
  approvedAssets: MemoryAsset[];
  corrections: MemoryCorrection[];
  referenceFingerprint: string;
};

export type LearnedPromptPattern = {
  kind: PromptPatternKind;
  title: string;
  patternText: string;
  outcome: "success" | "failure";
};

export type PromptPatternOutcomeRow = {
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

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function boundedText(value: unknown, maxChars: number) {
  const normalized = text(value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  const suffix = " [truncated]";
  if (maxChars <= suffix.length) return normalized.slice(0, maxChars).trimEnd();
  return `${normalized.slice(0, Math.max(0, maxChars - suffix.length)).trimEnd()}${suffix}`;
}

function uniqueRoles(roles: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const role of roles) {
    const normalized = text(role);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export function classifyReferenceRole(role: string): ReferenceRoleClass {
  const normalized = text(role);
  if (PRODUCT_ROLE_SET.has(normalized)) return "product";
  if (normalized === "style_reference") return "style";
  if (normalized === "model_identity") return "model";
  if (normalized === "approved_pose") return "approved";
  return "other";
}

function rolesOfClass(references: Array<{ role?: string }>, kind: ReferenceRoleClass) {
  return uniqueRoles(
    references
      .filter((reference) => classifyReferenceRole(String(reference.role || "")) === kind)
      .map((reference) => String(reference.role || "")),
  );
}

function asAsset(value: unknown): MemoryAsset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as JsonRecord;
  const poseIndex = integer(row.poseIndex ?? row.pose_index);
  const url = text(row.url ?? row.output_url ?? row.downloadUrl);
  const storagePath = text(row.storagePath ?? row.storage_path);
  if (poseIndex < 1 || (!url && !storagePath)) return null;
  return {
    poseIndex,
    url: boundedText(url, 500),
    storagePath: boundedText(storagePath, 400),
    qaStatus: boundedText(row.qaStatus ?? row.qa_status, 80),
    approvalStatus: boundedText(row.approvalStatus ?? row.approval_status, 80),
  };
}

function asCorrection(value: unknown): MemoryCorrection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as JsonRecord;
  const poseIndex = integer(row.poseIndex ?? row.pose_index);
  const body = boundedText(row.text ?? row.correction, 240);
  if (poseIndex < 1 || !body) return null;
  return { poseIndex, text: body };
}

function mergeAssets(existing: MemoryAsset[], incoming: MemoryAsset[]) {
  const byPose = new Map<number, MemoryAsset>();
  for (const asset of [...existing, ...incoming]) {
    if (byPose.size >= MAX_MEMORY_ASSETS && !byPose.has(asset.poseIndex)) continue;
    byPose.set(asset.poseIndex, asset);
  }
  return [...byPose.values()].sort((left, right) => left.poseIndex - right.poseIndex).slice(0, MAX_MEMORY_ASSETS);
}

function mergeCorrections(existing: MemoryCorrection[], incoming: MemoryCorrection[]) {
  const seen = new Set<string>();
  const merged: MemoryCorrection[] = [];
  for (const correction of [...existing, ...incoming]) {
    const key = `${correction.poseIndex}:${correction.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(correction);
  }
  return merged.slice(-MAX_MEMORY_CORRECTIONS);
}

function preservedDetailsFromProduct(productIdentity: JsonRecord, creativeDirection: JsonRecord) {
  const details: string[] = [];
  const invariant = boundedText(productIdentity.invariantDetails, 180);
  if (invariant) details.push(`Product invariants: ${invariant}`);
  const family = boundedText(productIdentity.garmentFamily, 80);
  const color = boundedText(productIdentity.mainColor, 80);
  if (family || color) {
    details.push(`SKU identity: ${[family, color].filter(Boolean).join(", ")}`);
  }
  const absences = (Array.isArray(productIdentity.absenceConstraints) ? productIdentity.absenceConstraints : [])
    .map((entry) => boundedText(entry, 120))
    .filter(Boolean)
    .slice(0, 3);
  if (absences.length) details.push(`Do not invent: ${absences.join("; ")}`);
  const seated = boundedText(creativeDirection.seatedPoseRequired ?? creativeDirection.seated_pose_required, 20);
  if (seated) details.push(`Seated pose 4 required: ${seated}`);
  const closeupMode = boundedText(creativeDirection.closeupMode ?? creativeDirection.closeup_mode, 40);
  const hero = boundedText(creativeDirection.closeupHeroDetail ?? creativeDirection.closeup_hero_detail, 120);
  if (closeupMode) {
    details.push(`Pose 5 close-up mode: ${closeupMode}${hero ? ` (${hero})` : ""}`);
  }
  details.push("Product images are garment/SKU truth. Style reference is set/backdrop/jewellery taste only.");
  return details.slice(0, MAX_MEMORY_PRESERVED_DETAILS);
}

export function emptyGenerationMemory(): GenerationMemory {
  return {
    version: GENERATION_MEMORY_VERSION,
    productRoles: [],
    styleRoles: [],
    modelRoles: [],
    preservedDetails: [],
    generatedAssets: [],
    approvedAssets: [],
    corrections: [],
    referenceFingerprint: "",
  };
}

export function normalizeGenerationMemory(value: unknown): GenerationMemory {
  const base = emptyGenerationMemory();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const row = value as JsonRecord;
  const generated = (Array.isArray(row.generatedAssets) ? row.generatedAssets : [])
    .map(asAsset)
    .filter((entry): entry is MemoryAsset => Boolean(entry));
  const approved = (Array.isArray(row.approvedAssets) ? row.approvedAssets : [])
    .map(asAsset)
    .filter((entry): entry is MemoryAsset => Boolean(entry));
  const corrections = (Array.isArray(row.corrections) ? row.corrections : [])
    .map(asCorrection)
    .filter((entry): entry is MemoryCorrection => Boolean(entry));
  return {
    version: GENERATION_MEMORY_VERSION,
    productRoles: uniqueRoles(Array.isArray(row.productRoles) ? row.productRoles.map(String) : []),
    styleRoles: uniqueRoles(Array.isArray(row.styleRoles) ? row.styleRoles.map(String) : []),
    modelRoles: uniqueRoles(Array.isArray(row.modelRoles) ? row.modelRoles.map(String) : []),
    preservedDetails: (Array.isArray(row.preservedDetails) ? row.preservedDetails : [])
      .map((entry) => boundedText(entry, 180))
      .filter(Boolean)
      .slice(0, MAX_MEMORY_PRESERVED_DETAILS),
    generatedAssets: generated.slice(0, MAX_MEMORY_ASSETS),
    approvedAssets: approved.slice(0, MAX_MEMORY_ASSETS),
    corrections: corrections.slice(-MAX_MEMORY_CORRECTIONS),
    referenceFingerprint: boundedText(row.referenceFingerprint, 120),
  };
}

export function buildGenerationMemory(args: {
  references?: Array<{ role?: string }>;
  productIdentity?: JsonRecord;
  creativeDirection?: JsonRecord;
  generatedAssets?: unknown[];
  approvedAssets?: unknown[];
  corrections?: unknown[];
  referenceFingerprint?: string;
  existing?: unknown;
}): GenerationMemory {
  const existing = normalizeGenerationMemory(args.existing);
  const references = Array.isArray(args.references) ? args.references : [];
  const productIdentity = args.productIdentity && typeof args.productIdentity === "object" && !Array.isArray(args.productIdentity)
    ? args.productIdentity
    : {};
  const creativeDirection = args.creativeDirection && typeof args.creativeDirection === "object" && !Array.isArray(args.creativeDirection)
    ? args.creativeDirection
    : {};
  const productRoles = rolesOfClass(references, "product");
  const styleRoles = rolesOfClass(references, "style");
  const modelRoles = rolesOfClass(references, "model");
  const preservedDetails = preservedDetailsFromProduct(productIdentity, creativeDirection);
  return {
    version: GENERATION_MEMORY_VERSION,
    productRoles: productRoles.length ? productRoles : existing.productRoles,
    styleRoles: styleRoles.length ? styleRoles : existing.styleRoles,
    modelRoles: modelRoles.length ? modelRoles : existing.modelRoles,
    preservedDetails: preservedDetails.length ? preservedDetails : existing.preservedDetails,
    generatedAssets: mergeAssets(
      existing.generatedAssets,
      (args.generatedAssets || []).map(asAsset).filter((entry): entry is MemoryAsset => Boolean(entry)),
    ),
    approvedAssets: mergeAssets(
      existing.approvedAssets,
      (args.approvedAssets || []).map(asAsset).filter((entry): entry is MemoryAsset => Boolean(entry)),
    ),
    corrections: mergeCorrections(
      existing.corrections,
      (args.corrections || []).map(asCorrection).filter((entry): entry is MemoryCorrection => Boolean(entry)),
    ),
    referenceFingerprint: text(args.referenceFingerprint) || existing.referenceFingerprint,
  };
}

export function resetGenerationMemoryForClone(value: unknown): GenerationMemory {
  const memory = normalizeGenerationMemory(value);
  return {
    ...memory,
    generatedAssets: [],
    approvedAssets: [],
    corrections: [],
  };
}

export function formatGenerationMemoryBrief(args: {
  references?: Array<{ role?: string }>;
  memory?: unknown;
}): string {
  const memory = normalizeGenerationMemory(args.memory);
  const live = Array.isArray(args.references) ? args.references : [];
  const product = rolesOfClass(live, "product");
  const style = rolesOfClass(live, "style");
  const model = rolesOfClass(live, "model");
  const approved = rolesOfClass(live, "approved");
  const lines: string[] = [];
  lines.push(`Product images (SKU/garment truth only): ${product.join(", ") || memory.productRoles.join(", ") || "none labeled in this request"}.`);
  lines.push(`Style reference (photoshoot set, backdrop, lighting, jewellery taste only): ${style.join(", ") || (memory.styleRoles.length ? `${memory.styleRoles.join(", ")} uploaded for this session` : "none")}.`);
  if (model.length || memory.modelRoles.length) {
    lines.push(`Model identity lock: ${model.join(", ") || memory.modelRoles.join(", ")}.`);
  }
  if (approved.length || memory.approvedAssets.length) {
    const poses = memory.approvedAssets.map((asset) => `pose ${asset.poseIndex}`).join(", ");
    lines.push(`Previous approved output in this shoot: ${approved.join(", ") || "approved_pose"}${poses ? ` (${poses})` : ""}. Use it for identity and set continuity, never as garment geometry.`);
  }
  for (const detail of memory.preservedDetails.slice(0, 6)) {
    lines.push(detail);
  }
  if (memory.corrections.length) {
    const latest = memory.corrections.slice(-3).map((entry) => `pose ${entry.poseIndex}: ${entry.text}`).join(" | ");
    lines.push(`Applied corrections this shoot: ${latest}.`);
  }
  const brief = lines.map((line) => `- ${line}`).join("\n");
  return boundedText(brief, MAX_MEMORY_BRIEF_CHARS);
}

function poseCompleted(pose: { status?: string }) {
  return text(pose.status).toLowerCase() === "completed";
}

function poseFailed(pose: { status?: string }) {
  return text(pose.status).toLowerCase() === "failed";
}

function pattern(
  kind: PromptPatternKind,
  title: string,
  patternText: string,
  outcome: "success" | "failure",
): LearnedPromptPattern {
  return {
    kind,
    title,
    patternText: boundedText(patternText, MAX_PATTERN_TEXT_CHARS),
    outcome,
  };
}

/**
 * Fail-closed extraction: only generic presentation/pose/scene locks that are
 * already structured on the job. Never copy SKU colors, motifs, or construction
 * into reusable house patterns.
 */
export function extractLearnedPromptPatterns(args: {
  category?: string;
  hasStyleReference?: boolean;
  seatedPoseRequired?: string;
  closeupMode?: string;
  poses?: Array<{ poseIndex?: number; poseType?: string; status?: string }>;
}): LearnedPromptPattern[] {
  const category = text(args.category);
  if (!category) return [];
  const poses = Array.isArray(args.poses) ? args.poses : [];
  const byType = (poseType: string) => poses.filter((pose) => text(pose.poseType) === poseType);
  const byIndex = (poseIndex: number) => poses.filter((pose) => integer(pose.poseIndex) === poseIndex);
  const outcomeFor = (matched: Array<{ status?: string }>) => {
    if (matched.some(poseCompleted)) return "success" as const;
    if (matched.some(poseFailed)) return "failure" as const;
    return null;
  };
  const extracted: LearnedPromptPattern[] = [];

  if (args.hasStyleReference) {
    const sceneOutcome = outcomeFor(poses);
    if (sceneOutcome) {
      extracted.push(pattern(
        "scene",
        "style-reference-backdrop-lock",
        "When a style reference is supplied, rebuild wall, floor, lighting, and props from that image only. Discard product-photo backgrounds. Never copy garment identity from the style frame.",
        sceneOutcome,
      ));
    }
  }

  const seated = text(args.seatedPoseRequired).toLowerCase();
  if (seated === "yes") {
    const pose4 = [...byType("creative"), ...byIndex(4)];
    const seatedOutcome = outcomeFor(pose4.length ? pose4 : poses);
    if (seatedOutcome) {
      extracted.push(pattern(
        "pose",
        "seated-pose-4-lock",
        "When seated coverage is required, only pose 4 sits. Keep garment, hem, bottom wear, and footwear fully visible on a set-matching seat.",
        seatedOutcome,
      ));
    }
  }

  const closeupMode = text(args.closeupMode).toLowerCase();
  const pose5 = [...byType("closeup"), ...byIndex(5)];
  const closeupOutcome = outcomeFor(pose5);
  if (closeupOutcome && closeupMode === "product_detail") {
    extracted.push(pattern(
      "pose",
      "closeup-product-detail-lock",
      "A product-detail close-up fills the frame with the named selling detail and may omit or crop the face. Never a full-body hero repeat.",
      closeupOutcome,
    ));
  } else if (closeupOutcome && (closeupMode === "face_and_detail" || closeupMode === "")) {
    extracted.push(pattern(
      "pose",
      "closeup-face-and-detail-lock",
      "A face-and-detail close-up is tighter than the hero pose: face plus a large, catalog-readable product detail, never a full-body repeat.",
      closeupOutcome,
    ));
  }

  const pose1 = [...byType("full_front"), ...byIndex(1)];
  const pose1Outcome = outcomeFor(pose1);
  if (pose1Outcome === "success") {
    extracted.push(pattern(
      "pose",
      "pose1-continuity-lock",
      "Later poses reuse Pose 1 model identity and physical set. Pose 1 never overrides original product references for garment geometry.",
      "success",
    ));
  }

  return extracted.filter((entry) => entry.patternText && entry.title);
}

export function nextPromptPatternCounts(row: PromptPatternOutcomeRow | null | undefined, outcome: "success" | "failure", qualityScore?: number | null) {
  const success = integer(row?.success_count);
  const failure = integer(row?.failure_count);
  const nextSuccess = success + (outcome === "success" ? 1 : 0);
  const nextFailure = failure + (outcome === "failure" ? 1 : 0);
  const previousAverage = Number(row?.avg_quality);
  const quality = Number(qualityScore);
  let avgQuality: number | null = Number.isFinite(previousAverage) ? previousAverage : null;
  if (outcome === "success" && Number.isFinite(quality) && quality >= 0 && quality <= 100 && nextSuccess > 0) {
    const prior = Number.isFinite(previousAverage) ? previousAverage : quality;
    const priorWeight = Math.max(0, nextSuccess - 1);
    avgQuality = Math.round(((prior * priorWeight) + quality) / nextSuccess * 100) / 100;
  }
  return { successCount: nextSuccess, failureCount: nextFailure, avgQuality };
}
