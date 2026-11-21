/**
 * Edge side of the FastAPI LangGraph pose planner (POST /api/v1/plan) and of the
 * style-reference profile cache. Everything here is best-effort: a planner
 * failure keeps the deterministic local plan normalizeAnalysis already built.
 */
import { fetchFastApiWithRetry } from "./fastApiClient.ts";
import {
  posePlanningGraphPayload,
  styleReferenceProfileFromAnalysis,
  type JsonRecord,
  type StyleReferenceProfile,
} from "./posePlanning.ts";
import { ANALYSIS_VERSION, normalizeAnalysis, posePlanningContextFor, smallHash } from "./profiles.ts";
import { canonicalReferences, hasCollapsedModelIdentity, type ReferenceLike } from "./referencePolicy.ts";

export type FastApiTarget = { baseUrl: string; secret: string; fetchFn?: typeof fetch };
type AnalysisOptions = NonNullable<Parameters<typeof normalizeAnalysis>[2]>;
type NormalizedAnalysis = ReturnType<typeof normalizeAnalysis>;

export const POSE_PLAN_TIMEOUT_CAP_MS = 15_000;
/** Left for saving the analysis once the planner answers. */
export const POSE_PLAN_RESERVE_MS = 10_000;
export const POSE_PLAN_MIN_TIMEOUT_MS = 5_000;

/** Planner timeout for the analysis budget that is left, or 0 to skip the call. */
export function posePlanTimeoutMs(remainingBudgetMs: number): number {
  const timeout = Math.min(POSE_PLAN_TIMEOUT_CAP_MS, Math.floor(remainingBudgetMs) - POSE_PLAN_RESERVE_MS);
  return timeout >= POSE_PLAN_MIN_TIMEOUT_MS ? timeout : 0;
}

/** Fire-and-forget GET /health, so a scale-to-zero FastAPI is warm when the vision call returns. */
export function wakeFastApi(target: FastApiTarget | null): Promise<void> {
  if (!target) return Promise.resolve();
  return fetchFastApiWithRetry({
    baseUrl: target.baseUrl,
    path: "/health",
    init: { method: "GET" },
    timeoutMs: 15_000,
    maxRetries: 1,
    retryOnTimeout: true,
    fetchFn: target.fetchFn,
  }).then(async (response) => {
    await response.body?.cancel();
  }).catch(() => {});
}

/** POST /api/v1/plan. The 2xx JSON object, or null on a skip or any failure (warned once, never thrown). */
export async function requestGraphPosePlan(
  target: FastApiTarget | null,
  payload: JsonRecord,
  remainingBudgetMs: number,
): Promise<JsonRecord | null> {
  const timeoutMs = posePlanTimeoutMs(remainingBudgetMs);
  if (!target || !timeoutMs) return null;
  try {
    const response = await fetchFastApiWithRetry({
      baseUrl: target.baseUrl,
      path: "/api/v1/plan",
      timeoutMs,
      // One POST: a retry would run past the analysis budget this timeout was cut from.
      maxRetries: 0,
      fetchFn: target.fetchFn,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": target.secret },
        body: JSON.stringify(payload),
      },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${response.status}`);
    }
    const body = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("response is not a JSON object");
    return body as JsonRecord;
  } catch (error) {
    console.warn(`LangGraph pose planner skipped, keeping the local plan: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Refines a fresh analysis' local pose plan with the LangGraph planner, then
 * re-normalizes the same vision JSON with its answer (adoptions re-checked
 * against the hard guards). A legacy analysis without a plan is returned as is.
 */
export async function withGraphPosePlanning(args: {
  target: FastApiTarget | null;
  normalized: NormalizedAnalysis;
  rawAnalysis: JsonRecord;
  category: string;
  options: AnalysisOptions;
  organizationId: string;
  threadKey: string;
  remainingBudgetMs: number;
}): Promise<NormalizedAnalysis> {
  const local = args.normalized.posePlanning;
  if (!local || !args.target || !args.organizationId) return args.normalized;
  // Same options as normalizeAnalysis, so the planner sees the garment the guards see.
  const ctx = posePlanningContextFor(args.normalized, {
    categoryFallback: args.category,
    bottomWearMode: args.options.bottomWearMode,
    skuName: args.options.skuName,
    productDetails: args.options.productDetails,
    hasBottomReference: args.options.hasBottomReference,
  });
  const response = await requestGraphPosePlan(args.target, posePlanningGraphPayload({
    organizationId: args.organizationId,
    threadKey: args.threadKey,
    ctx,
    garmentFamily: String(args.normalized.productIdentity.garmentFamily || ""),
    category: args.category,
    local,
    poseExpressions: Object.fromEntries(args.normalized.posePlan.map((pose) => [pose.id, String(pose.expression || "")])),
  }), args.remainingBudgetMs);
  return response
    ? normalizeAnalysis(args.rawAnalysis, args.category, { ...args.options, posePlanningOverride: response })
    : args.normalized;
}

export const STYLE_PROFILE_CACHE_KIND = "style_reference_profile";

/**
 * analysis_cache key of the style-reference profile, or "" when the cache must
 * not be used: no style reference, a style reference without a content hash, or
 * a style photo that doubles as the model identity. Scene and model directions
 * shape the room and styling the analysis writes, so they are part of the key.
 * A forced refresh skips only the lookup (index.ts): its fresh profile still
 * overwrites the row, so a re-analysis repairs a bad one.
 */
export function styleProfileCacheKey(
  references: readonly ReferenceLike[],
  directions: { sceneDirection?: unknown; modelDirection?: unknown } = {},
): string {
  if (hasCollapsedModelIdentity(references)) return "";
  const style = canonicalReferences(references.filter((reference) => reference.role === "style_reference"));
  if (!style.length || style.some((reference) => !reference.hash)) return "";
  // index.ts referenceHash, over the style references only (+ directions, normalized like productHash).
  const parts = style.map((reference) => `${reference.role}:${reference.hash}`);
  const direction = [directions.sceneDirection, directions.modelDirection]
    .map((value) => String(value || "").trim().replace(/\s+/g, " "));
  if (direction.some(Boolean)) parts.push(`directions:${direction.join("|")}`);
  // A hit drops the style image from the vision call, so one 32-bit hash is too collision-prone:
  // a second hash from another starting state (a prefix; a suffix would keep a collision) makes it 64-bit.
  const joined = parts.join("|");
  return `style:${smallHash(joined)}${smallHash(`style-profile|${joined}`)}:${ANALYSIS_VERSION}`;
}

/**
 * The style profile worth caching from a fresh analysis, or null. It needs a v36
 * plan whose referencePose names a posture: "none" is also what an omitted
 * referencePose normalizes to, and a cached "none" would keep Pose 4/6 from ever
 * adopting that style photo.
 */
export function cacheableStyleProfile(normalized: NormalizedAnalysis): StyleReferenceProfile | null {
  if (!normalized.posePlanning || normalized.posePlanning.referencePose.posture === "none") return null;
  return styleReferenceProfileFromAnalysis(normalized);
}
