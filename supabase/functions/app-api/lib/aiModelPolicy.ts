/**
 * Provider/model allow-list and failure policy for structured visual work.
 *
 * This module intentionally contains no secrets, environment reads, fetches, or
 * database access. The Edge Function resolves tenant configuration separately
 * and passes the selected route through these guards before making a provider
 * request. Keeping this logic pure makes it safe to reuse in Studio, Catalog,
 * and tests without accidentally accepting an arbitrary model/base URL.
 */

export const AI_PROVIDERS = ["gemini", "openai", "qwen", "meta"] as const;
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
    product_truth: ["gemini-3.1-pro-preview", "gemini-3.6-flash"],
    qa: ["gemini-3.1-pro-preview", "gemini-3.6-flash"],
    qa_escalation: ["gemini-3.1-pro-preview", "gemini-3.6-flash"],
  },
  openai: {
    product_truth: ["gpt-5.6-terra", "gpt-5.6-sol"],
    qa: ["gpt-5.6-terra", "gpt-5.6-sol"],
    qa_escalation: ["gpt-5.6-terra", "gpt-5.6-sol"],
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
    product_truth: ["muse-spark-1.2"],
    qa: ["muse-spark-1.2"],
    qa_escalation: ["muse-spark-1.2"],
  },
};

const VISION_PURPOSES: readonly AiModelPurpose[] = [
  "product_truth",
  "qa",
  "qa_escalation",
];

const GEMINI_THINKING: readonly AiThinkingLevel[] = ["medium", "high"];
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
  route: Pick<AiModelRoute, "provider">,
  purpose: AiModelPurpose,
  options: AiRouteValidationOptions = {},
): readonly AiThinkingLevel[] {
  const provider = text(route.provider) as AiProvider;
  if (purpose === "image_generation") return ["none"];
  if (provider === "qwen" && options.strictJson !== false) return ["none"];
  if (provider === "gemini") return GEMINI_THINKING;
  if (provider === "openai") return OPENAI_THINKING;
  if (provider === "meta") return META_THINKING;
  return [];
}

export function defaultThinkingLevel(
  route: Pick<AiModelRoute, "provider">,
  purpose: AiModelPurpose,
  options: AiRouteValidationOptions = {},
): AiThinkingLevel {
  const allowed = allowedThinkingLevels(route, purpose, options);
  if (purpose === "image_generation" || allowed.includes("none")) return "none";
  if (purpose === "qa") {
    return allowed.includes("medium") ? "medium" : allowed[0];
  }
  return allowed.includes("high") ? "high" : allowed[0];
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
        { provider },
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

  const invalidInput =
    /invalid\s+(?:argument|input|request)|malformed|unsupported\s+(?:image|media|mime|model)|schema\s+(?:invalid|error)|safety\s+(?:blocked|violation)|content\s+policy/
      .test(detail);
  if (invalidInput || [400, 404, 409, 413, 415, 422].includes(status || 0)) {
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
    /invalid[_\s-]*(?:api\s*)?key|unauthori[sz]ed|forbidden|authentication/
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
