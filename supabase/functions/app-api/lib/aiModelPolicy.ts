/**
 * Provider/model allow-list and failure policy for structured visual work.
 *
 * This module intentionally contains no secrets, environment reads, fetches, or
 * database access. The Edge Function resolves tenant configuration separately
 * and passes the selected route through these guards before making a provider
 * request. Keeping this logic pure makes it safe to reuse in Studio, Catalog,
 * and tests without accidentally accepting an arbitrary model/base URL.
 */

export const AI_PROVIDERS = ["gemini", "openai", "qwen", "meta", "reve"] as const;
export type AiProvider = typeof AI_PROVIDERS[number];

export const AI_MODEL_PURPOSES = [
  "product_truth",
  "qa",
  "qa_escalation",
  "image_generation",
] as const;
export type AiModelPurpose = typeof AI_MODEL_PURPOSES[number];

export const AI_THINKING_LEVELS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type AiThinkingLevel = typeof AI_THINKING_LEVELS[number];

export type AiModelRoute = {
  provider: AiProvider | string;
  model: string;
  thinkingLevel?: AiThinkingLevel | string | null;
};

export type NormalizedAiModelRoute = {
  provider: AiProvider;
  model: string;
  thinkingLevel: AiThinkingLevel;
};

export type AiRouteValidationOptions = {
  /**
   * Product Truth and QA responses are schema-constrained JSON. Qwen's
   * compatible API does not support strict structured output with thinking on,
   * so callers must leave this enabled for all visual analysis/QA calls.
   */
  strictJson?: boolean;
};

/**
 * Final product images are currently generated through the OpenAI Images API.
 * Keep this route explicit so a vision/planning model can never accidentally
 * become a paid image-generation model just because it accepts image input.
 */
export const DEFAULT_IMAGE_GENERATION_ROUTE = {
  provider: "openai",
  model: "gpt-image-2.5-flare-2026-09-08",
  thinkingLevel: "none",
} as const satisfies NormalizedAiModelRoute;

type Registry = Record<
  AiProvider,
  Readonly<Partial<Record<AiModelPurpose, readonly string[]>>>
>;

/**
 * The model registry is deliberately narrow. A tenant admin can select between
 * supported, reviewed choices, but cannot convert this configuration into a
 * generic outbound HTTP/model selector.
 */
export const AI_MODEL_REGISTRY: Registry = {
  gemini: {
    product_truth: [
      "gemini-2.5-flash",
      "gemini-3.1-pro-preview",
      "gemini-3.1-pro",
      "gemini-3.6-flash",
      "gemini-3.8-flash",
    ],
    qa: [
      "gemini-2.5-flash",
      "gemini-3.1-pro-preview",
      "gemini-3.1-pro",
      "gemini-3.6-flash",
      "gemini-3.8-flash",
    ],
    qa_escalation: [
      "gemini-2.5-flash",
      "gemini-3.1-pro-preview",
      "gemini-3.1-pro",
      "gemini-3.6-flash",
      "gemini-3.8-flash",
    ],
  },
  openai: {
    product_truth: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
    qa: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
    qa_escalation: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
    image_generation: [
      "gpt-image-2.5-flare-2026-09-08",
      "gpt-image-2.5-flare",
      "gpt-image-2.5-sunburst",
      "gpt-image-2",
      "gpt-image-1.5",
      "gpt-image-1",
      "gpt-image-1-mini",
    ],
  },
  qwen: {
    product_truth: ["qwen3.8-max"],
    qa: ["qwen3.8-max"],
    qa_escalation: ["qwen3.8-max"],
  },
  meta: {
    product_truth: ["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.3-contributor"],
    qa: ["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.3-contributor"],
    qa_escalation: ["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.3-contributor"],
  },
  reve: {
    image_generation: ["reve-2.1-image"],
  },
};

const VISION_PURPOSES: readonly AiModelPurpose[] = [
  "product_truth",
  "qa",
  "qa_escalation",
];

const GEMINI_THINKING: readonly AiThinkingLevel[] = ["low", "medium", "high"];
const OPENAI_THINKING: readonly AiThinkingLevel[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const META_THINKING: readonly AiThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];
const META_STANDARD_13_THINKING: readonly AiThinkingLevel[] = [
  ...META_THINKING,
  "max",
];

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isProvider(value: unknown): value is AiProvider {
  return AI_PROVIDERS.includes(value as AiProvider);
}

function isPurpose(value: unknown): value is AiModelPurpose {
  return AI_MODEL_PURPOSES.includes(value as AiModelPurpose);
}

function isThinkingLevel(value: unknown): value is AiThinkingLevel {
  return AI_THINKING_LEVELS.includes(value as AiThinkingLevel);
}

export function isVisionPurpose(purpose: AiModelPurpose | string) {
  return VISION_PURPOSES.includes(purpose as AiModelPurpose);
}

export function providerSecretName(provider: AiProvider): string {
  if (provider === "gemini") return "GEMINI_API_KEY";
  if (provider === "openai") return "OPENAI_API_KEY";
  if (provider === "qwen") return "QWEN_API_KEY";
  if (provider === "reve") return "REVE_API_KEY";
  return "META_MODEL_API_KEY";
}

export function allowedModelsForPurpose(
  provider: AiProvider,
  purpose: AiModelPurpose,
): readonly string[] {
  return AI_MODEL_REGISTRY[provider][purpose] || [];
}

export function isAllowedAiModel(
  provider: AiProvider | string,
  purpose: AiModelPurpose | string,
  model: unknown,
) {
  if (!isProvider(provider) || !isPurpose(purpose)) return false;
  return allowedModelsForPurpose(provider, purpose).includes(text(model));
}

export function allowedThinkingLevels(
  route: Pick<AiModelRoute, "provider"> & { model?: string | null },
  purpose: AiModelPurpose,
  options: AiRouteValidationOptions = {},
): readonly AiThinkingLevel[] {
  const provider = text(route.provider) as AiProvider;
  if (purpose === "image_generation") return ["none"];
  if (provider === "qwen" && options.strictJson !== false) return ["none"];
  if (provider === "gemini") return GEMINI_THINKING;
  if (provider === "openai") return OPENAI_THINKING;
  if (provider === "meta") {
    return text(route.model) === "muse-spark-1.3"
      ? META_STANDARD_13_THINKING
      : META_THINKING;
  }
  return [];
}

export function defaultThinkingLevel(
  route: Pick<AiModelRoute, "provider"> & { model?: string | null },
  purpose: AiModelPurpose,
  options: AiRouteValidationOptions = {},
): AiThinkingLevel {
  const allowed = allowedThinkingLevels(route, purpose, options);
  if (purpose === "image_generation") return "none";
  // Product-truth analysis is a large structured vision call. Default OpenAI
  // and Gemini Flash thinking to low so a missing org reasoning value cannot
  // silently select high/medium and miss the Edge timeout.
  if (purpose === "product_truth") {
    const provider = text(route.provider);
    if (provider === "openai" && allowed.includes("low")) return "low";
    if (allowed.includes("low")) return "low";
    if (allowed.includes("medium")) return "medium";
  }
  if (allowed.includes("none")) return "none";
  if (purpose === "qa") {
    return allowed.includes("medium") ? "medium" : allowed[0];
  }
  return allowed.includes("high") ? "high" : allowed[0];
}

/**
 * Fallback defaults, used only when an organization has saved no policy for a
 * purpose. A saved Administration policy is always used as configured.
 */
export const FAST_PRODUCT_TRUTH_ROUTE = {
  provider: "meta",
  model: "muse-spark-1.3",
  thinkingLevel: "low",
} as const satisfies NormalizedAiModelRoute;

export const FAST_PRODUCT_TRUTH_GEMINI_ROUTE = {
  provider: "gemini",
  model: "gemini-3.8-flash",
  thinkingLevel: "low",
} as const satisfies NormalizedAiModelRoute;

export const CHEAP_OPENAI_VISION_ROUTE = {
  provider: "openai",
  model: "gpt-5.6-luna",
  thinkingLevel: "low",
} as const satisfies NormalizedAiModelRoute;

export const OPENAI_TERRA_VISION_ROUTE = {
  provider: "openai",
  model: "gpt-5.6-terra",
  thinkingLevel: "low",
} as const satisfies NormalizedAiModelRoute;

/**
 * Studio Analyze uses `supabase.functions.invoke("app-api")`. Without an
 * explicit client timeout the browser/SDK aborts around 55–60s, so the Studio
 * client waits `STUDIO_ANALYZE_TIMEOUT_MS` (180s) and the product-truth chain
 * is budgeted inside that wait.
 */
export const STUDIO_ANALYZE_TIMEOUT_MS = 180_000;
export const STUDIO_INVOKE_BUDGET_MS = STUDIO_ANALYZE_TIMEOUT_MS;
export const PRODUCT_TRUTH_TIMEOUT_MS = 40_000;
/**
 * Product truth keeps this much of the wait for the configured fallback while
 * the primary runs. A primary that fails fast (a 404, a missing key) hands the
 * fallback almost the whole wait; a primary that hangs cannot starve it.
 */
export const PRODUCT_TRUTH_FALLBACK_RESERVE_MS = 45_000;
export const VISION_PROVIDER_TIMEOUT_MS = 50_000;
export const VISION_GATEWAY_BUDGET_MS = 185_000;
/** Held back inside the chain: parsing a hop's reply and recording the attempt. */
export const VISION_GATEWAY_RESERVE_MS = 5_000;
/**
 * Held back outside the chain, and distinct from the reserve above.
 *
 * `runVisionProviderChain` starts its clock when the chain starts, so auth, the
 * workspace RPC, loading the reference images and the response trip home are
 * all invisible to the per-hop reserve. They still consume the client's wait,
 * so the gateway budget gives them their own allowance.
 */
export const VISION_REQUEST_OVERHEAD_MS = 5_000;
export const PRODUCT_TRUTH_MIN_SLICE_MS = 10_000;
export const VISION_HOP_MIN_MS = 8_000;
/**
 * How long the chain waits for a failed hop's telemetry write before starting
 * the next hop. A normal write lands well inside it, so the row exists before
 * the fallback runs; a stalled database can take at most this much of the
 * fallback's budget. Every write is still awaited before the chain returns.
 */
export const VISION_TELEMETRY_WAIT_MS = 2_000;

function routeKey(route: Pick<NormalizedAiModelRoute, "provider" | "model">) {
  return `${text(route.provider)}:${text(route.model)}`;
}

/**
 * Product-truth analyze runs on low/minimal thinking even when Admin saved a
 * higher level: this is one large multimodal JSON call inside Studio's 180s
 * wait, and high reasoning on it missed that budget. The model choice is never
 * changed here, only its reasoning effort. Explicit "none" or "minimal" is preserved.
 */
export function clampProductTruthThinking(route: NormalizedAiModelRoute): AiThinkingLevel {
  const allowed = allowedThinkingLevels(route, "product_truth", { strictJson: true });
  if (route.thinkingLevel === "none" && allowed.includes("none")) return "none";
  if (route.thinkingLevel === "minimal" && allowed.includes("minimal")) return "minimal";
  if (allowed.includes("low")) return "low";
  if (allowed.includes("minimal")) return "minimal";
  if (allowed.includes("none")) return "none";
  return allowed[0] || "low";
}

export function withFastProductTruthThinking(
  route: NormalizedAiModelRoute,
): NormalizedAiModelRoute {
  return { ...route, thinkingLevel: clampProductTruthThinking(route) };
}

/**
 * Cap product-truth at the Studio client wait even when
 * `VISION_GATEWAY_BUDGET_MS` is 185s. Returning after the client has
 * disconnected still drops hop 2.
 *
 * The cap holds back `VISION_REQUEST_OVERHEAD_MS` rather than spending the whole
 * client wait, because everything outside `runVisionProviderChain` is invisible
 * to that function's own reserve. Budgeting the full wait let a hop still be
 * running at the instant the browser aborted, which surfaces as "Analysis was
 * interrupted before OpenAI could finish" on a run the server would have
 * completed. A hop that finishes 5s earlier and is actually delivered beats one
 * that runs longer and has its answer thrown away.
 */
export function productTruthGatewayBudgetMs(configured?: number) {
  const value = Number.isFinite(configured) && (configured as number) >= 20_000
    ? Math.round(configured as number)
    : VISION_GATEWAY_BUDGET_MS;
  return Math.min(value, STUDIO_INVOKE_BUDGET_MS - VISION_REQUEST_OVERHEAD_MS);
}

/**
 * The routes product-truth analysis tries, in order: exactly the primary and
 * the fallback saved in Administration. No model is inserted ahead of them,
 * substituted for them, or dropped from the chain; a duplicate fallback runs
 * once. Only the reasoning effort is capped (see `clampProductTruthThinking`).
 */
export function productTruthRouteChain(
  primary: NormalizedAiModelRoute,
  fallback?: NormalizedAiModelRoute,
): NormalizedAiModelRoute[] {
  const chain: NormalizedAiModelRoute[] = [];
  const seen = new Set<string>();
  for (const route of [primary, fallback]) {
    if (!route) continue;
    const next = withFastProductTruthThinking(route);
    const key = routeKey(next);
    if (seen.has(key)) continue;
    seen.add(key);
    chain.push(next);
  }
  return chain;
}

export function visionHopTimeoutError(
  message = "The selected vision provider timed out.",
) {
  return Object.assign(new Error(message), { name: "TimeoutError" });
}

/**
 * Enforce the hop budget even when `invoke` ignores `timeoutMs` (Qwen has no
 * AbortSignal; a hanging fetch would otherwise stall every later fallback).
 */
export async function invokeWithHopTimeout<T>(
  invoke: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = Promise.resolve().then(invoke);
  work.catch(() => {});
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(visionHopTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function remainingVisionTimeoutMs(args: {
  purpose: string;
  remainingRouteCount: number;
  elapsedMs: number;
  gatewayBudgetMs: number;
  preferredTimeoutMs?: number;
}): number {
  const remainingWall = Math.max(
    0,
    args.gatewayBudgetMs - args.elapsedMs - VISION_GATEWAY_RESERVE_MS,
  );
  if (remainingWall <= 0) return 0;
  // Product truth: the last hop gets whatever is left of the Studio wait; an
  // earlier hop gets it minus a fixed reserve for each hop still to come.
  if (args.purpose === "product_truth") {
    if (args.remainingRouteCount <= 1) return remainingWall;
    const reservedForLater = PRODUCT_TRUTH_FALLBACK_RESERVE_MS * (args.remainingRouteCount - 1);
    return Math.max(
      Math.min(PRODUCT_TRUTH_MIN_SLICE_MS, remainingWall),
      remainingWall - reservedForLater,
    );
  }
  const preferred = args.preferredTimeoutMs ?? VISION_PROVIDER_TIMEOUT_MS;
  if (args.remainingRouteCount <= 1) return Math.min(preferred, remainingWall);
  const reservedForLater = PRODUCT_TRUTH_MIN_SLICE_MS *
    Math.max(0, args.remainingRouteCount - 1);
  const available = remainingWall - reservedForLater;
  if (available < PRODUCT_TRUTH_MIN_SLICE_MS) {
    return Math.min(preferred, remainingWall);
  }
  return Math.min(preferred, available, remainingWall);
}

export function shouldContinueVisionFallback(
  failure: VisionProviderFailure | null | undefined,
  remainingRouteCount: number,
) {
  return remainingRouteCount > 0 && canFallbackFromVisionFailure(failure);
}

export type VisionHopAttempt = {
  provider: AiProvider;
  model: string;
  thinkingLevel: AiThinkingLevel;
  outcome: "completed" | "failed";
  failureCode?: string;
  /** Why this hop failed, in words an administrator can act on. */
  failureMessage?: string;
  latencyMs: number;
  attemptNumber: number;
};

export type VisionAttemptTelemetryRow = {
  provider: string;
  model: string;
  thinkingLevel: string;
  status: "completed" | "failed";
  latencyMs: number;
  attemptNumber: number;
  errorCode?: string;
};

export function visionAttemptTelemetryRows(
  attempts: VisionHopAttempt[],
): VisionAttemptTelemetryRow[] {
  return attempts.map((attempt) => ({
    provider: attempt.provider,
    model: attempt.model,
    thinkingLevel: attempt.thinkingLevel,
    status: attempt.outcome,
    latencyMs: attempt.latencyMs,
    attemptNumber: attempt.attemptNumber,
    errorCode: attempt.failureCode,
  }));
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  meta: "Meta",
  gemini: "Gemini",
  qwen: "Qwen",
  reve: "Reve",
};

/** "OpenAI gpt-5.6-terra" - the provider and the exact model id that was called. */
export function visionRouteLabel(route: Pick<NormalizedAiModelRoute, "provider" | "model">) {
  return `${PROVIDER_LABELS[text(route.provider)] || text(route.provider)} ${text(route.model)}`;
}

/**
 * What the person sees when analysis or QA could not run: every configured
 * model that was tried and why each one failed, so a wrong model id, a missing
 * key or an exhausted budget is named instead of hidden behind "a fallback can
 * be used".
 */
export function visionChainFailureMessage(
  attempts: Pick<VisionHopAttempt, "provider" | "model" | "outcome" | "failureMessage" | "failureCode">[],
  configuredRouteCount: number,
): string {
  const failed = attempts.filter((attempt) => attempt.outcome === "failed");
  if (!failed.length) return "No approved vision provider route is available.";
  const lines = failed.map((attempt) =>
    `${visionRouteLabel(attempt)}: ${attempt.failureMessage || attempt.failureCode || "vision_request_failed"}`
  );
  const untried = configuredRouteCount - attempts.length;
  const tail = configuredRouteCount <= 1
    ? " No fallback model is configured for this purpose in Administration."
    : untried > 0
      ? " The configured fallback was not tried because this failure cannot be fixed by switching models."
      : "";
  return `${failed.length > 1 ? "Every configured vision model failed. " : ""}${lines.join(" · ")}${tail}`;
}

export async function runVisionProviderChain<T>(args: {
  routes: NormalizedAiModelRoute[];
  purpose: string;
  gatewayBudgetMs: number;
  invoke: (route: NormalizedAiModelRoute, timeoutMs: number) => Promise<T>;
  classify: (route: NormalizedAiModelRoute, error: unknown) => VisionProviderFailure;
  now?: () => number;
  /**
   * Fired after each hop is finished, before the next hop starts. Studio uses
   * this to persist a failed hop immediately so a later abort still leaves its
   * row in `ai_runs`.
   */
  onAttempt?: (attempt: VisionHopAttempt) => Promise<void> | void;
  /** Override for tests; see `VISION_TELEMETRY_WAIT_MS`. */
  telemetryWaitMs?: number;
}): Promise<{ value: T; route: NormalizedAiModelRoute; attempts: VisionHopAttempt[] }> {
  const now = args.now || Date.now;
  const started = now();
  const attempts: VisionHopAttempt[] = [];
  let lastFailure: VisionProviderFailure | null = null;
  let lastRoute = args.routes[0];
  if (!args.routes.length) {
    throw new Error("No approved vision provider route is available.");
  }

  // A failed hop's telemetry is written before the next hop starts, but the
  // wait is capped: a stalled write must not spend the fallback's budget.
  // Any write still running then is awaited before the chain returns or throws.
  const telemetryWaitMs = args.telemetryWaitMs ?? VISION_TELEMETRY_WAIT_MS;
  const writes: Promise<void>[] = [];
  const emit = async (attempt: VisionHopAttempt) => {
    attempts.push(attempt);
    const write = (async () => {
      try {
        await args.onAttempt?.(attempt);
      } catch {
        // Telemetry must never hide a successful later hop.
      }
    })();
    writes.push(write);
    if (attempt.outcome !== "failed") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      write,
      new Promise<void>((resolve) => { timer = setTimeout(resolve, telemetryWaitMs); }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
  };
  const settleWrites = () => Promise.all(writes);

  const chainError = (failure: VisionProviderFailure | null, route: NormalizedAiModelRoute) => {
    const message = visionChainFailureMessage(attempts, args.routes.length);
    return Object.assign(new Error(message), {
      name: "VisionChainError",
      failure: failure ? { ...failure, message } : null,
      attempts,
      route,
    });
  };

  for (let index = 0; index < args.routes.length; index += 1) {
    const route = args.routes[index];
    lastRoute = route;
    const timeoutMs = remainingVisionTimeoutMs({
      purpose: args.purpose,
      remainingRouteCount: args.routes.length - index,
      elapsedMs: now() - started,
      gatewayBudgetMs: args.gatewayBudgetMs,
    });
    const hopStarted = now();
    if (timeoutMs < VISION_HOP_MIN_MS) {
      lastFailure = classifyVisionProviderFailure(route.provider as AiProvider, {
        name: "TimeoutError",
        message: "The selected vision provider timed out.",
      });
      await emit({
        provider: route.provider as AiProvider,
        model: route.model,
        thinkingLevel: route.thinkingLevel,
        outcome: "failed",
        failureCode: lastFailure.code,
        failureMessage: "Not started: the time left in this request was too short to call it.",
        latencyMs: now() - hopStarted,
        attemptNumber: index + 1,
      });
      continue;
    }
    try {
      const value = await invokeWithHopTimeout(
        () => args.invoke(route, timeoutMs),
        timeoutMs,
      );
      await emit({
        provider: route.provider as AiProvider,
        model: route.model,
        thinkingLevel: route.thinkingLevel,
        outcome: "completed",
        latencyMs: now() - hopStarted,
        attemptNumber: index + 1,
      });
      await settleWrites();
      return { value, route, attempts };
    } catch (error) {
      const failure = args.classify(route, error);
      lastFailure = failure;
      await emit({
        provider: route.provider as AiProvider,
        model: route.model,
        thinkingLevel: route.thinkingLevel,
        outcome: "failed",
        failureCode: failure.code,
        failureMessage: failure.message,
        latencyMs: now() - hopStarted,
        attemptNumber: index + 1,
      });
      const remaining = args.routes.length - index - 1;
      if (!shouldContinueVisionFallback(failure, remaining)) {
        await settleWrites();
        throw chainError(failure, route);
      }
    }
  }

  await settleWrites();
  throw chainError(lastFailure, lastRoute);
}

export function aiModelDisplayLabel(model: string): string {
  const labels: Record<string, string> = {
    "gpt-image-2.5-flare-2026-09-08": "GPT Image 2.5 Flare (2026-09-08 · Default)",
    "gpt-image-2.5-flare": "GPT Image 2.5 Flare · fast/high-volume",
    "gpt-image-2.5-sunburst": "GPT Image 2.5 Sunburst · high-fidelity/memory",
    "gpt-image-2": "GPT Image 2 · standard",
    "gpt-image-1.5": "GPT Image 1.5",
    "gpt-image-1": "GPT Image 1",
    "gpt-image-1-mini": "GPT Image 1 Mini",
    "gpt-5.6-luna": "GPT 5.6 Luna · cost-efficient",
    "gpt-5.6-terra": "GPT 5.6 Terra",
    "gpt-5.6-sol": "GPT 5.6 Sol · expensive",
    "muse-spark-1.3": "Muse Spark 1.3 · Standard",
    "muse-spark-1.2": "Muse Spark 1.2 · Standard",
    "muse-spark-1.3-contributor": "Muse Spark 1.3 Contributor · trains on prompts",
    "gemini-3.8-flash": "Gemini 3.8 Flash",
    "gemini-3.6-flash": "Gemini 3.6 Flash",
    "gemini-3.1-pro": "Gemini 3.1 Pro",
    "gemini-3.1-pro-preview": "Gemini 3.1 Pro Preview",
    "gemini-2.5-flash": "Gemini 2.5 Flash",
    "qwen3.8-max": "Qwen 3.8 Max",
    "reve-2.1-image": "Reve 2.1 Image",
  };
  return labels[text(model)] || text(model);
}

export function aiModelHelpText(model: string): string {
  if (text(model) === "muse-spark-1.3-contributor") {
    return "Contributor is cheaper (~$0.10 / $0.20 per 1M tokens) but Meta may train on prompts and completions. Do not use it for fashion product data unless the organization opts in.";
  }
  if (text(model) === "muse-spark-1.3" || text(model) === "muse-spark-1.2") {
    return "Standard Muse Spark does not train on your data. About $1.25 / 1M input and $4.25 / 1M output.";
  }
  if (text(model) === "gpt-5.6-sol") {
    return "Sol is the expensive GPT 5.6 flagship. Prefer Luna for fallback vision.";
  }
  if (text(model) === "gpt-5.6-luna") {
    return "Luna is the cost-efficient GPT 5.6 vision fallback (~$0.20 / 1M input, $1.20 / 1M output). Prefer it over Sol.";
  }
  if (text(model) === "gpt-image-2.5-flare-2026-09-08") {
    return "Pinned default snapshot of GPT Image 2.5 Flare released on 2026-09-08. OpenAI's fastest model for high-quality everyday catalog image generation.";
  }
  if (text(model) === "gpt-image-2.5-flare") {
    return "Flare is OpenAI's speed-optimized model offering up to 50% lower latency for rapid iterations and high-volume catalog production at identical token pricing.";
  }
  if (text(model) === "gpt-image-2.5-sunburst") {
    return "Sunburst is OpenAI's flagship precision model with enhanced character and garment latent memory, superior fabric detail, and cross-pose identity consistency.";
  }
  if (text(model) === "gpt-image-2") {
    return "GPT Image 2 is OpenAI's previous-generation image synthesis model.";
  }
  return "";
}

export function preferredModelId(
  provider: string,
  models: readonly string[],
): string {
  if (!models.length) return "";
  if (provider === "openai" && models.includes("gpt-image-2.5-flare-2026-09-08")) return "gpt-image-2.5-flare-2026-09-08";
  if (provider === "openai" && models.includes("gpt-image-2.5-flare")) return "gpt-image-2.5-flare";
  if (provider === "openai" && models.includes("gpt-image-2.5-sunburst")) return "gpt-image-2.5-sunburst";
  if (provider === "openai" && models.includes("gpt-5.6-luna")) return "gpt-5.6-luna";
  if (provider === "meta" && models.includes("muse-spark-1.3")) return "muse-spark-1.3";
  if (provider === "gemini" && models.includes("gemini-3.8-flash")) return "gemini-3.8-flash";
  return models[0];
}

const GEMINI_FLASH_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-2.5-flash",
] as const;

/**
 * Gemini 3.x uses thinkingLevel. Gemini 2.5 uses thinkingBudget. Sending the
 * 3.x field to 2.5 (or the reverse) is a 400, not a slow timeout.
 */
export function geminiThinkingConfig(
  model: string,
  thinkingLevel: AiThinkingLevel,
): { thinkingLevel: AiThinkingLevel } | { thinkingBudget: number } {
  if (text(model).startsWith("gemini-2.")) {
    if (thinkingLevel === "high") return { thinkingBudget: 8192 };
    if (thinkingLevel === "medium") return { thinkingBudget: 2048 };
    return { thinkingBudget: 0 };
  }
  return { thinkingLevel };
}

/**
 * Gemini 3.8 Flash supports thinking levels low/medium/high. Product-truth
 * planning is a large multimodal JSON call; high/medium reasoning is what made
 * Flash feel like a slow GPT job. Flash stays on low for analysis. Pro models
 * keep the stored thinking level.
 */
export function preferFastProductTruthThinking(route: NormalizedAiModelRoute): AiThinkingLevel {
  if (route.provider !== "gemini") return route.thinkingLevel;
  if (!GEMINI_FLASH_MODELS.includes(route.model as typeof GEMINI_FLASH_MODELS[number])) {
    return route.thinkingLevel;
  }
  return "low";
}

/**
 * Normalization fills an omitted thinking level only. It intentionally does
 * not turn an explicitly invalid setting into a valid one; callers should use
 * `assertAllowedAiModelRoute` before a provider call or configuration write.
 */
export function normalizeAiModelRoute(
  route: AiModelRoute,
  purpose: AiModelPurpose,
  options: AiRouteValidationOptions = {},
): NormalizedAiModelRoute {
  const provider = text(route.provider) as AiProvider;
  const suppliedLevel = text(route.thinkingLevel);
  return {
    provider,
    model: text(route.model),
    thinkingLevel: (suppliedLevel ||
      defaultThinkingLevel(
        { provider, model: text(route.model) },
        purpose,
        options,
      )) as AiThinkingLevel,
  };
}

export type AiRouteValidation =
  | { valid: true; route: NormalizedAiModelRoute }
  | { valid: false; message: string };

export function validateAiModelRoute(
  route: AiModelRoute,
  purpose: AiModelPurpose | string,
  options: AiRouteValidationOptions = {},
): AiRouteValidation {
  if (!isPurpose(purpose)) {
    return { valid: false, message: "Unknown AI model policy purpose." };
  }
  const providerRaw = text(route?.provider);
  if (!isProvider(providerRaw)) {
    return {
      valid: false,
      message: "The selected AI provider is not supported.",
    };
  }
  const model = text(route?.model);
  if (!isAllowedAiModel(providerRaw, purpose, model)) {
    const allowed = allowedModelsForPurpose(providerRaw, purpose);
    return {
      valid: false,
      message: allowed.length
        ? `Model ${
          model || "(missing)"
        } is not approved for ${purpose} with ${providerRaw}.`
        : `${providerRaw} is not approved for ${purpose}.`,
    };
  }

  const suppliedThinking = text(route?.thinkingLevel);
  if (suppliedThinking && !isThinkingLevel(suppliedThinking)) {
    return {
      valid: false,
      message: "The selected thinking level is not supported.",
    };
  }
  const normalized = normalizeAiModelRoute(route, purpose, options);
  const allowedThinking = allowedThinkingLevels(normalized, purpose, options);
  if (!allowedThinking.includes(normalized.thinkingLevel)) {
    if (providerRaw === "qwen" && options.strictJson !== false) {
      return {
        valid: false,
        message:
          "Qwen structured vision requires thinking to be disabled so JSON/image analysis remains schema-safe.",
      };
    }
    if (providerRaw === "meta" && normalized.thinkingLevel === "none") {
      return {
        valid: false,
        message:
          "Muse Spark requires a reasoning effort of minimal, low, medium, high, or xhigh.",
      };
    }
    return {
      valid: false,
      message:
        `${providerRaw} does not support ${normalized.thinkingLevel} thinking for ${purpose}.`,
    };
  }
  return { valid: true, route: normalized };
}

export function assertAllowedAiModelRoute(
  route: AiModelRoute,
  purpose: AiModelPurpose | string,
  options: AiRouteValidationOptions = {},
): NormalizedAiModelRoute {
  const validation = validateAiModelRoute(route, purpose, options);
  if (!validation.valid) throw new Error(validation.message);
  return validation.route;
}

export function defaultImageGenerationRoute(): NormalizedAiModelRoute {
  return assertAllowedAiModelRoute(
    DEFAULT_IMAGE_GENERATION_ROUTE,
    "image_generation",
  );
}

export type StoredImageRoutingRow = {
  primary_provider?: unknown;
  primary_model?: unknown;
  primary_reasoning?: unknown;
  fallback_enabled?: unknown;
  revision?: unknown;
};

export type StoredImageRouteResolution = NormalizedAiModelRoute & { revision: number };

/**
 * Turn a stored organization image-generation row into the route that will run.
 *
 * Returns null only when there is no stored row, so the caller applies the
 * system default. Anything stored is the administrator's explicit choice: it is
 * validated against the registry and used as written, or it throws. Quietly
 * substituting one approved model for another is what made Administration show
 * a setting the rest of the system ignored.
 */
export function resolveStoredImageGenerationRoute(
  row: StoredImageRoutingRow | null | undefined,
): StoredImageRouteResolution | null {
  if (!row) return null;
  if (row.fallback_enabled === true) {
    throw new Error(
      "Stored image-generation routing is invalid. Clear its fallback and choose an approved OpenAI GPT Image model in Administration.",
    );
  }
  try {
    const primary = assertAllowedAiModelRoute({
      provider: text(row.primary_provider),
      model: text(row.primary_model),
      thinkingLevel: text(row.primary_reasoning),
    }, "image_generation");
    return { ...primary, revision: Math.max(1, Number(row.revision || 1)) };
  } catch {
    throw new Error(
      "Stored image-generation routing is invalid. Choose an approved OpenAI GPT Image model in Administration.",
    );
  }
}

export type ProviderFailureInput = {
  status?: unknown;
  message?: unknown;
  code?: unknown;
  name?: unknown;
};

export type VisionProviderFailure = {
  provider: AiProvider;
  code:
    | "provider_budget_exhausted"
    | "provider_rate_limited"
    | "provider_unavailable"
    | "provider_timeout"
    | "provider_authentication_failed"
    | "provider_invalid_request"
    | "provider_incomplete_response"
    | "provider_request_failed";
  status: number | null;
  retryable: boolean;
  fallbackEligible: boolean;
  message: string;
};

function statusNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599
    ? parsed
    : null;
}

function failureText(input: ProviderFailureInput) {
  return [input.message, input.code, input.name].map(text).filter(Boolean).join(
    " ",
  ).toLowerCase();
}

function isAbortLike(input: ProviderFailureInput) {
  const name = text(input.name).toLowerCase();
  const detail = failureText(input);
  return name === "timeouterror" || name === "aborterror" ||
    name === "domexception" && /abort|timeout/.test(detail) ||
    /the signal has been aborted|operation was aborted|aborterror|timeouterror/
      .test(detail);
}

function failure(
  provider: AiProvider,
  code: VisionProviderFailure["code"],
  status: number | null,
  retryable: boolean,
  fallbackEligible: boolean,
  message: string,
): VisionProviderFailure {
  return { provider, code, status, retryable, fallbackEligible, message };
}

/**
 * Classify provider errors without forwarding their often noisy/billing-specific
 * text to product users. In particular, a monthly spend cap cannot be solved by
 * retrying the same provider; it should immediately be eligible for a configured
 * fallback route. Input/auth mistakes fail closed and never silently switch a
 * provider, which avoids masking a malformed request or unsafe configuration.
 */
export function classifyVisionProviderFailure(
  provider: AiProvider,
  input: ProviderFailureInput = {},
): VisionProviderFailure {
  const status = statusNumber(input.status);
  const detail = failureText(input);
  const budgetExhausted =
    /monthly\s+(?:spend|spending)|spend(?:ing)?\s+cap|project\s+spend|billing|budget(?:\s+(?:has\s+)?(?:been\s+)?exceeded)?|quota(?:\s+(?:has\s+)?(?:been\s+)?exceeded)?|resource[_\s-]*exhausted|daily\s+limit/
      .test(detail);
  if (budgetExhausted) {
    return failure(
      provider,
      "provider_budget_exhausted",
      status,
      false,
      true,
      "Its budget or quota is exhausted. Update the provider's billing or choose another model in Administration.",
    );
  }

  // 404 / "model not found" must fall over. A missing model id fails in ~1s;
  // treating it as a non-fallback invalid request is what would hide a bad
  // allowlisted id. 30–45s empty failures are timeouts, not 404s.
  if (
    status === 404 ||
    /(?:model|models\/[\w.-]+)\s+(?:is\s+)?not found|not found for api version|is not available/
      .test(detail)
  ) {
    return failure(
      provider,
      "provider_unavailable",
      status,
      false,
      true,
      "This model is not available to the configured API key (model not found, or the account has no access to it). Check the model in Administration and the provider account.",
    );
  }

  const invalidInput =
    /invalid\s+(?:argument|input|request)|malformed|unsupported\s+(?:image|media|mime)|schema\s+(?:invalid|error)|safety\s+(?:blocked|violation)|content\s+policy/
      .test(detail);
  if (invalidInput || [400, 409, 413, 415].includes(status || 0)) {
    return failure(
      provider,
      "provider_invalid_request",
      status,
      false,
      false,
      "The request was rejected as invalid or unsupported by this model. Check the selected model and the product references.",
    );
  }

  if (
    [401, 403].includes(status || 0) ||
    /invalid[_\s-]*(?:api\s*)?key|unauthori[sz]ed|forbidden|authentication|permission[_\s-]*denied|is not configured in (?:the )?supabase edge function/
      .test(detail)
  ) {
    // assertVisionProviderConfigured says "... is not configured in Supabase Edge
    // Function secrets."; the old pattern required "the" and never matched it.
    const missingSecret = /is not configured in (?:the )?supabase edge function/.test(detail);
    return failure(
      provider,
      "provider_authentication_failed",
      status,
      false,
      true,
      missingSecret
        ? `Its API key (${providerSecretName(provider)}) is not configured on the server.`
        : `Its API key (${providerSecretName(provider)}) was rejected as unauthorized. An administrator must check the server-side secret.`,
    );
  }

  if (
    status === 429 || /rate\s*limit|too\s+many\s+requests|throttl/.test(detail)
  ) {
    return failure(
      provider,
      "provider_rate_limited",
      status,
      true,
      true,
      "It is rate-limited right now. Try again shortly.",
    );
  }

  if (
    [408, 504].includes(status || 0) ||
    isAbortLike(input) ||
    /timeout|timed\s*out|deadline\s+exceeded/.test(detail)
  ) {
    return failure(
      provider,
      "provider_timeout",
      status,
      true,
      true,
      "It did not answer in time.",
    );
  }

  if (
    /unexpected token|invalid json|json parse|not valid json|incomplete json|invalid object|returned an invalid object|no structured (?:visual )?response/
      .test(detail)
  ) {
    return failure(
      provider,
      "provider_incomplete_response",
      status,
      true,
      true,
      "It returned an incomplete response.",
    );
  }

  if (
    (status !== null && status >= 500) ||
    /network\s+error|fetch\s+failed|error\s+sending\s+request|connection\s+(?:closed|reset|refused)|broken\s+pipe|dns\s+error|failed\s+to\s+lookup|econnreset|econnrefused|etimedout|client\s+error|socket\s+error|stream\s+error|dispatch\s+error|service\s+unavailable|temporar(?:y|ily)\s+unavailable/
      .test(detail)
  ) {
    return failure(
      provider,
      "provider_unavailable",
      status,
      true,
      true,
      "It is temporarily unavailable (server error). Try again shortly.",
    );
  }

  return failure(
    provider,
    "provider_request_failed",
    status,
    false,
    true,
    "It could not complete this request.",
  );
}

export function canFallbackFromVisionFailure(
  failure: VisionProviderFailure | null | undefined,
) {
  return Boolean(failure?.fallbackEligible);
}

/**
 * Timeouts and truncated JSON should fail over immediately. Retrying the same
 * slow GPT reasoning call usually burns the Edge/gateway budget before Flash
 * can run.
 */
export function shouldRetrySameVisionRoute(
  failure: VisionProviderFailure | null | undefined,
) {
  if (!failure?.retryable) return false;
  return failure.code !== "provider_timeout" &&
    failure.code !== "provider_incomplete_response";
}
