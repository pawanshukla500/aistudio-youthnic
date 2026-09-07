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
  model: "gpt-image-2",
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
 * Muse Spark 1.3 Standard is the approved fast product-truth route. Slow OpenAI
 * Sol/Terra-high reasoning remains allowed, but analysis should not wait on it
 * when Muse (or Gemini Flash) can do the visual work. Luna is the cheap OpenAI
 * fallback — never Sol.
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
 * Multi-image product-truth JSON routinely needs 30–40s (Gemini Flash completions
 * on production were often 30–37s). A 28s abort killed those and then burned a
 * second 28s on Luna, which is why Studio showed a timeout at ~60s with only the
 * last hop recorded.
 */
export const PRODUCT_TRUTH_TIMEOUT_MS = 50_000;
export const VISION_PROVIDER_TIMEOUT_MS = 50_000;
export const VISION_GATEWAY_BUDGET_MS = 145_000;
export const VISION_GATEWAY_RESERVE_MS = 8_000;
export const PRODUCT_TRUTH_MIN_SLICE_MS = 12_000;
export const VISION_ROUTE_PROMOTION_THRESHOLD = 4;

/**
 * Remaining hops after the selected primary. Order is Luna → Terra → Gemini
 * Flash → Muse so a Muse primary becomes Muse → Luna → Terra → Gemini, and a
 * Gemini primary (interim Studio policy) still fails over to Luna then Terra.
 */
export const PRODUCT_TRUTH_FAILOVER_CHAIN: readonly NormalizedAiModelRoute[] = [
  CHEAP_OPENAI_VISION_ROUTE,
  OPENAI_TERRA_VISION_ROUTE,
  FAST_PRODUCT_TRUTH_GEMINI_ROUTE,
  FAST_PRODUCT_TRUTH_ROUTE,
];

const FAST_OPENAI_THINKING: readonly AiThinkingLevel[] = ["none", "low"];

function routeKey(route: Pick<NormalizedAiModelRoute, "provider" | "model">) {
  return `${text(route.provider)}:${text(route.model)}`;
}

export function isSlowReasoningVisionRoute(route: Pick<NormalizedAiModelRoute, "provider" | "thinkingLevel">) {
  return route.provider === "openai" &&
    !FAST_OPENAI_THINKING.includes(route.thinkingLevel);
}

/**
 * Product-truth analyze must stay on low/minimal thinking even when Admin saved
 * `high`. High reasoning on Luna is as slow as Sol for this workload and misses
 * the Edge budget.
 */
export function clampProductTruthThinking(route: NormalizedAiModelRoute): AiThinkingLevel {
  const allowed = allowedThinkingLevels(route, "product_truth", { strictJson: true });
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

export function productTruthRouteChain(
  primary: NormalizedAiModelRoute,
  existingFallback?: NormalizedAiModelRoute,
): NormalizedAiModelRoute[] {
  const chain: NormalizedAiModelRoute[] = [];
  const seen = new Set<string>();
  const push = (route?: NormalizedAiModelRoute | null) => {
    if (!route) return;
    if (text(route.model) === "gpt-5.6-sol") return;
    const next = withFastProductTruthThinking(route);
    const key = routeKey(next);
    if (seen.has(key)) return;
    seen.add(key);
    chain.push(next);
  };
  push(primary);
  push(existingFallback);
  for (const hop of PRODUCT_TRUTH_FAILOVER_CHAIN) push(hop);
  return chain;
}

export function remainingVisionTimeoutMs(args: {
  purpose: string;
  remainingRouteCount: number;
  elapsedMs: number;
  gatewayBudgetMs: number;
  preferredTimeoutMs?: number;
}): number {
  const preferred = args.preferredTimeoutMs ??
    (args.purpose === "product_truth"
      ? PRODUCT_TRUTH_TIMEOUT_MS
      : VISION_PROVIDER_TIMEOUT_MS);
  const remainingWall = Math.max(
    0,
    args.gatewayBudgetMs - args.elapsedMs - VISION_GATEWAY_RESERVE_MS,
  );
  if (remainingWall <= 0) return 0;
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

export async function runVisionProviderChain<T>(args: {
  routes: NormalizedAiModelRoute[];
  purpose: string;
  gatewayBudgetMs: number;
  invoke: (route: NormalizedAiModelRoute, timeoutMs: number) => Promise<T>;
  classify: (route: NormalizedAiModelRoute, error: unknown) => VisionProviderFailure;
  now?: () => number;
}): Promise<{ value: T; route: NormalizedAiModelRoute; attempts: VisionHopAttempt[] }> {
  const now = args.now || Date.now;
  const started = now();
  const attempts: VisionHopAttempt[] = [];
  let lastFailure: VisionProviderFailure | null = null;
  let lastRoute = args.routes[0];
  if (!args.routes.length) {
    throw new Error("No approved vision provider route is available.");
  }

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
    if (timeoutMs < 8_000) {
      lastFailure = classifyVisionProviderFailure(route.provider as AiProvider, {
        name: "TimeoutError",
        message: "The selected vision provider timed out.",
      });
      attempts.push({
        provider: route.provider as AiProvider,
        model: route.model,
        thinkingLevel: route.thinkingLevel,
        outcome: "failed",
        failureCode: lastFailure.code,
        latencyMs: now() - hopStarted,
        attemptNumber: index + 1,
      });
      continue;
    }
    try {
      const value = await args.invoke(route, timeoutMs);
      attempts.push({
        provider: route.provider as AiProvider,
        model: route.model,
        thinkingLevel: route.thinkingLevel,
        outcome: "completed",
        latencyMs: now() - hopStarted,
        attemptNumber: index + 1,
      });
      return { value, route, attempts };
    } catch (error) {
      const failure = args.classify(route, error);
      lastFailure = failure;
      attempts.push({
        provider: route.provider as AiProvider,
        model: route.model,
        thinkingLevel: route.thinkingLevel,
        outcome: "failed",
        failureCode: failure.code,
        latencyMs: now() - hopStarted,
        attemptNumber: index + 1,
      });
      const remaining = args.routes.length - index - 1;
      if (!shouldContinueVisionFallback(failure, remaining)) {
        throw Object.assign(new Error(failure.message), {
          name: "VisionChainError",
          failure,
          attempts,
          route,
        });
      }
    }
  }

  throw Object.assign(
    new Error(
      lastFailure?.message || "No approved vision provider route is available.",
    ),
    {
      name: "VisionChainError",
      failure: lastFailure,
      attempts,
      route: lastRoute,
    },
  );
}

export type VisionPromotionRun = {
  provider: string;
  model: string;
  status: string;
};

export function evaluateVisionRoutePromotion(args: {
  primary: Pick<NormalizedAiModelRoute, "provider" | "model">;
  recentSuccessfulRuns: VisionPromotionRun[];
  threshold?: number;
}): NormalizedAiModelRoute | null {
  const threshold = args.threshold ?? VISION_ROUTE_PROMOTION_THRESHOLD;
  const promotable = new Set(["gpt-5.6-luna", "gpt-5.6-terra"]);
  const recent = args.recentSuccessfulRuns.filter((run) =>
    run.status === "completed"
  );
  if (!recent.length) return null;
  const candidate = recent[0];
  if (
    text(candidate.provider) === text(args.primary.provider) &&
    text(candidate.model) === text(args.primary.model)
  ) {
    return null;
  }
  if (!promotable.has(text(candidate.model))) return null;
  let streak = 0;
  for (const run of recent) {
    if (
      text(run.model) === text(candidate.model) &&
      text(run.provider) === text(candidate.provider)
    ) {
      streak += 1;
      continue;
    }
    break;
  }
  if (streak < threshold) return null;
  return withFastProductTruthThinking(
    text(candidate.model) === "gpt-5.6-terra"
      ? OPENAI_TERRA_VISION_ROUTE
      : CHEAP_OPENAI_VISION_ROUTE,
  );
}

export function promotionFallbackRoute(
  promoted: NormalizedAiModelRoute,
): NormalizedAiModelRoute {
  if (text(promoted.model) === "gpt-5.6-luna") {
    return withFastProductTruthThinking(OPENAI_TERRA_VISION_ROUTE);
  }
  if (text(promoted.model) === "gpt-5.6-terra") {
    return withFastProductTruthThinking(CHEAP_OPENAI_VISION_ROUTE);
  }
  return withFastProductTruthThinking(CHEAP_OPENAI_VISION_ROUTE);
}

export type FastProductTruthPreference = {
  route: NormalizedAiModelRoute;
  fallback?: NormalizedAiModelRoute;
  rerouted: boolean;
};

/**
 * Prefer a fast vision model for product-truth analysis when the stored primary
 * is a slow OpenAI reasoning route. Expensive Sol is never kept as fallback;
 * Luna is the cheap OpenAI option.
 */
export function preferFastProductTruthRoute(
  primary: NormalizedAiModelRoute,
  existingFallback?: NormalizedAiModelRoute,
): FastProductTruthPreference {
  if (!isSlowReasoningVisionRoute(primary)) {
    return { route: primary, fallback: existingFallback, rerouted: false };
  }
  const fast = assertAllowedAiModelRoute(
    FAST_PRODUCT_TRUTH_ROUTE,
    "product_truth",
    { strictJson: true },
  );
  const cheapOpenAi = assertAllowedAiModelRoute(
    CHEAP_OPENAI_VISION_ROUTE,
    "product_truth",
    { strictJson: true },
  );
  const fallback = existingFallback &&
      !isSlowReasoningVisionRoute(existingFallback) &&
      existingFallback.model !== "gpt-5.6-sol" &&
      (existingFallback.provider !== fast.provider ||
        existingFallback.model !== fast.model)
    ? existingFallback
    : cheapOpenAi;
  return { route: fast, fallback, rerouted: true };
}

export function aiModelDisplayLabel(model: string): string {
  const labels: Record<string, string> = {
    "gpt-image-2": "GPT Image 2 · recommended",
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
  return "";
}

export function preferredModelId(
  provider: string,
  models: readonly string[],
): string {
  if (!models.length) return "";
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
      "The selected vision provider has reached its budget or quota. A configured fallback can be used; otherwise update its billing or choose another configured provider in Administration.",
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
      "The selected vision model is not available. A configured fallback can be used.",
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
      "The vision request is invalid or unsupported. Check the selected model and product references before trying again.",
    );
  }

  if (
    [401, 403].includes(status || 0) ||
    /invalid[_\s-]*(?:api\s*)?key|unauthori[sz]ed|forbidden|authentication|is not configured in the supabase edge function/
      .test(detail)
  ) {
    return failure(
      provider,
      "provider_authentication_failed",
      status,
      false,
      false,
      "The selected vision provider is not authorized. An administrator must verify its server-side secret.",
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
      "The selected vision provider is temporarily rate-limited. The request can retry or use a configured fallback.",
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
      "The selected vision provider timed out. The request can retry or use a configured fallback.",
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
      "The vision provider returned an incomplete response. The request can retry or use a configured fallback.",
    );
  }

  if (
    (status !== null && status >= 500) ||
    /network\s+error|fetch\s+failed|service\s+unavailable|temporar(?:y|ily)\s+unavailable/
      .test(detail)
  ) {
    return failure(
      provider,
      "provider_unavailable",
      status,
      true,
      true,
      "The selected vision provider is temporarily unavailable. The request can retry or use a configured fallback.",
    );
  }

  return failure(
    provider,
    "provider_request_failed",
    status,
    false,
    false,
    "The vision provider could not complete this request. Review the provider configuration and request details.",
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
