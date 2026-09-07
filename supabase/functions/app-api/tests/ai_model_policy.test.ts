import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  allowedModelsForPurpose,
  assertAllowedAiModelRoute,
  classifyVisionProviderFailure,
  clampProductTruthThinking,
  DEFAULT_IMAGE_GENERATION_ROUTE,
  defaultImageGenerationRoute,
  defaultThinkingLevel,
  FAST_PRODUCT_TRUTH_ROUTE,
  FAST_PRODUCT_TRUTH_GEMINI_ROUTE,
  CHEAP_OPENAI_VISION_ROUTE,
  OPENAI_TERRA_VISION_ROUTE,
  PRODUCT_TRUTH_TIMEOUT_MS,
  evaluateVisionRoutePromotion,
  geminiThinkingConfig,
  normalizeAiModelRoute,
  preferFastProductTruthRoute,
  preferFastProductTruthThinking,
  productTruthRouteChain,
  promotionFallbackRoute,
  remainingVisionTimeoutMs,
  runVisionProviderChain,
  shouldContinueVisionFallback,
  shouldRetrySameVisionRoute,
  validateAiModelRoute,
  visionAttemptTelemetryRows,
} from "../lib/aiModelPolicy.ts";

Deno.test("vision registry keeps image generation on approved OpenAI image models", () => {
  assertEquals(DEFAULT_IMAGE_GENERATION_ROUTE, {
    provider: "openai",
    model: "gpt-image-2",
    thinkingLevel: "none",
  });
  assertEquals(defaultImageGenerationRoute(), DEFAULT_IMAGE_GENERATION_ROUTE);
  assertEquals(allowedModelsForPurpose("openai", "image_generation"), [
    "gpt-image-2",
    "gpt-image-1.5",
    "gpt-image-1",
    "gpt-image-1-mini",
  ]);
  assertEquals(
    validateAiModelRoute(
      { provider: "openai", model: "gpt-image-2" },
      "image_generation",
    ),
    {
      valid: true,
      route: {
        provider: "openai",
        model: "gpt-image-2",
        thinkingLevel: "none",
      },
    },
  );
  assertThrows(
    () =>
      assertAllowedAiModelRoute(
        { provider: "qwen", model: "qwen3.8-max" },
        "image_generation",
      ),
    Error,
    "not approved",
  );
  assertThrows(
    () =>
      assertAllowedAiModelRoute(
        { provider: "openai", model: "gpt-5.6-terra" },
        "image_generation",
      ),
    Error,
    "not approved",
  );
  assertThrows(
    () =>
      assertAllowedAiModelRoute(
        { provider: "gemini", model: "gpt-5.6-terra" },
        "product_truth",
      ),
    Error,
    "not approved",
  );
});

Deno.test("OpenAI Luna, Terra, and Sol are approved only for structured visual analysis and QA", () => {
  for (const model of ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]) {
    assertEquals(
      validateAiModelRoute(
        { provider: "openai", model, thinkingLevel: "high" },
        "product_truth",
      ),
      {
        valid: true,
        route: { provider: "openai", model, thinkingLevel: "high" },
      },
    );
    assertEquals(
      validateAiModelRoute({
        provider: "openai",
        model,
        thinkingLevel: "medium",
      }, "qa"),
      {
        valid: true,
        route: { provider: "openai", model, thinkingLevel: "medium" },
      },
    );
  }
});

Deno.test("Qwen strict visual JSON always has thinking disabled", () => {
  assertEquals(
    normalizeAiModelRoute(
      { provider: "qwen", model: "qwen3.8-max" },
      "product_truth",
      { strictJson: true },
    ),
    { provider: "qwen", model: "qwen3.8-max", thinkingLevel: "none" },
  );
  assertEquals(
    validateAiModelRoute(
      { provider: "qwen", model: "qwen3.8-max", thinkingLevel: "none" },
      "qa",
      { strictJson: true },
    ),
    {
      valid: true,
      route: { provider: "qwen", model: "qwen3.8-max", thinkingLevel: "none" },
    },
  );
  assertThrows(
    () =>
      assertAllowedAiModelRoute(
        { provider: "qwen", model: "qwen3.8-max", thinkingLevel: "high" },
        "product_truth",
        { strictJson: true },
      ),
    Error,
    "thinking to be disabled",
  );
});

Deno.test("Meta Muse Spark accepts supported reasoning values and rejects none", () => {
  for (
    const thinkingLevel of [
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ] as const
  ) {
    assertEquals(
      validateAiModelRoute({
        provider: "meta",
        model: "muse-spark-1.3",
        thinkingLevel,
      }, "product_truth"),
      {
        valid: true,
        route: { provider: "meta", model: "muse-spark-1.3", thinkingLevel },
      },
    );
  }
  assertEquals(
    validateAiModelRoute({
      provider: "meta",
      model: "muse-spark-1.3",
      thinkingLevel: "max",
    }, "product_truth").valid,
    true,
  );
  assertThrows(
    () =>
      assertAllowedAiModelRoute({
        provider: "meta",
        model: "muse-spark-1.3-contributor",
        thinkingLevel: "max",
      }, "product_truth"),
    Error,
    "does not support max thinking",
  );
  assertThrows(
    () =>
      assertAllowedAiModelRoute({
        provider: "meta",
        model: "muse-spark-1.3",
        thinkingLevel: "none",
      }, "qa"),
    Error,
    "Muse Spark requires",
  );
});

Deno.test("Gemini spend-cap and quota failures switch immediately to configured fallback", () => {
  for (
    const message of [
      "Your project has exceeded its monthly spending cap.",
      "RESOURCE_EXHAUSTED: quota has been exceeded",
    ]
  ) {
    const result = classifyVisionProviderFailure("gemini", {
      status: 429,
      message,
    });
    assertEquals(result.code, "provider_budget_exhausted");
    assertEquals(result.retryable, false);
    assertEquals(result.fallbackEligible, true);
  }
});

Deno.test("transient provider failures may retry/fallback, but invalid product input fails closed", () => {
  const unavailable = classifyVisionProviderFailure("gemini", {
    status: 503,
    message: "Service unavailable",
  });
  assertEquals(unavailable.code, "provider_unavailable");
  assertEquals(unavailable.retryable, true);
  assertEquals(unavailable.fallbackEligible, true);

  const rateLimited = classifyVisionProviderFailure("gemini", {
    status: 429,
    message: "Too many requests",
  });
  assertEquals(rateLimited.code, "provider_rate_limited");
  assertEquals(rateLimited.retryable, true);
  assertEquals(rateLimited.fallbackEligible, true);

  const invalid = classifyVisionProviderFailure("gemini", {
    status: 400,
    message: "Invalid image MIME type",
  });
  assertEquals(invalid.code, "provider_invalid_request");
  assertEquals(invalid.retryable, false);
  assertEquals(invalid.fallbackEligible, false);
  assert(invalid.message.includes("invalid or unsupported"));

  const missingModel = classifyVisionProviderFailure("gemini", {
    status: 404,
    message: "models/gemini-3.8-flash is not found for API version v1beta",
  });
  assertEquals(missingModel.code, "provider_unavailable");
  assertEquals(missingModel.retryable, false);
  assertEquals(missingModel.fallbackEligible, true);
  assertEquals(shouldRetrySameVisionRoute(missingModel), false);
});

Deno.test("abort and truncated JSON are timeout/incomplete so Flash fallback can run", () => {
  const aborted = classifyVisionProviderFailure("openai", {
    name: "TimeoutError",
    message: "The signal has been aborted",
  });
  assertEquals(aborted.code, "provider_timeout");
  assertEquals(aborted.retryable, true);
  assertEquals(aborted.fallbackEligible, true);
  assertEquals(shouldRetrySameVisionRoute(aborted), false);

  const truncated = classifyVisionProviderFailure("openai", {
    message: "Unexpected token E in JSON at position 0",
  });
  assertEquals(truncated.code, "provider_incomplete_response");
  assertEquals(truncated.fallbackEligible, true);
  assertEquals(shouldRetrySameVisionRoute(truncated), false);

  const emptyJson = classifyVisionProviderFailure("openai", {
    status: 422,
    message: "openai returned no structured visual response.",
  });
  assertEquals(emptyJson.code, "provider_incomplete_response");
  assertEquals(emptyJson.fallbackEligible, true);

  const missingSecret = classifyVisionProviderFailure("gemini", {
    message: "GEMINI_API_KEY is not configured in the Supabase Edge Function.",
  });
  assertEquals(missingSecret.code, "provider_authentication_failed");
  assertEquals(missingSecret.fallbackEligible, false);
});

Deno.test("product-truth defaults to fast thinking and reroutes slow GPT to Muse Spark 1.3", () => {
  assertEquals(
    defaultThinkingLevel({ provider: "openai" }, "product_truth", {
      strictJson: true,
    }),
    "low",
  );
  assertEquals(
    defaultThinkingLevel({ provider: "gemini" }, "product_truth", {
      strictJson: true,
    }),
    "low",
  );
  assertEquals(
    normalizeAiModelRoute(
      { provider: "openai", model: "gpt-5.6-sol" },
      "product_truth",
      { strictJson: true },
    ),
    { provider: "openai", model: "gpt-5.6-sol", thinkingLevel: "low" },
  );
  const preferred = preferFastProductTruthRoute({
    provider: "openai",
    model: "gpt-5.6-sol",
    thinkingLevel: "high",
  });
  assertEquals(preferred.rerouted, true);
  assertEquals(preferred.route, FAST_PRODUCT_TRUTH_ROUTE);
  assertEquals(preferred.fallback, CHEAP_OPENAI_VISION_ROUTE);
  assertEquals(
    preferFastProductTruthRoute({
      provider: "gemini",
      model: "gemini-3.8-flash",
      thinkingLevel: "medium",
    }).rerouted,
    false,
  );
  assertEquals(
    preferFastProductTruthThinking({
      provider: "gemini",
      model: "gemini-3.8-flash",
      thinkingLevel: "medium",
    }),
    "low",
  );
  assertEquals(
    preferFastProductTruthThinking({
      provider: "gemini",
      model: "gemini-3.6-flash",
      thinkingLevel: "high",
    }),
    "low",
  );
  assertEquals(
    preferFastProductTruthThinking({
      provider: "gemini",
      model: "gemini-2.5-flash",
      thinkingLevel: "medium",
    }),
    "low",
  );
  assertEquals(
    preferFastProductTruthThinking({
      provider: "gemini",
      model: "gemini-3.1-pro",
      thinkingLevel: "high",
    }),
    "high",
  );
  assertEquals(
    validateAiModelRoute({
      provider: "gemini",
      model: "gemini-3.8-flash",
      thinkingLevel: "low",
    }, "product_truth"),
    {
      valid: true,
      route: {
        provider: "gemini",
        model: "gemini-3.8-flash",
        thinkingLevel: "low",
      },
    },
  );
});

Deno.test("Gemini 3.8 Flash and Gemini 3.1 Pro are approved for visual analysis and QA", () => {
  assertEquals(
    allowedModelsForPurpose("gemini", "product_truth").includes("gemini-3.8-flash"),
    true,
  );
  assertEquals(
    allowedModelsForPurpose("gemini", "product_truth").includes("gemini-3.6-flash"),
    true,
  );
  assertEquals(
    allowedModelsForPurpose("gemini", "product_truth").includes("gemini-2.5-flash"),
    true,
  );
  assertEquals(
    allowedModelsForPurpose("meta", "product_truth"),
    ["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.3-contributor"],
  );
  assertEquals(
    allowedModelsForPurpose("openai", "product_truth"),
    ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
  );
  assertEquals(
    validateAiModelRoute({
      provider: "meta",
      model: "muse-spark-1.2",
      thinkingLevel: "low",
    }, "qa").valid,
    true,
  );
  assertEquals(
    geminiThinkingConfig("gemini-3.8-flash", "low"),
    { thinkingLevel: "low" },
  );
  assertEquals(
    geminiThinkingConfig("gemini-2.5-flash", "low"),
    { thinkingBudget: 0 },
  );
  assertEquals(
    validateAiModelRoute(
      { provider: "gemini", model: "gemini-3.8-flash", thinkingLevel: "high" },
      "qa",
    ),
    {
      valid: true,
      route: { provider: "gemini", model: "gemini-3.8-flash", thinkingLevel: "high" },
    },
  );
  assertEquals(
    validateAiModelRoute(
      { provider: "gemini", model: "gemini-3.1-pro", thinkingLevel: "high" },
      "product_truth",
    ),
    {
      valid: true,
      route: { provider: "gemini", model: "gemini-3.1-pro", thinkingLevel: "high" },
    },
  );
});

Deno.test("product-truth analyze clamps Admin high thinking to low for Muse and Luna", () => {
  assertEquals(
    clampProductTruthThinking({
      provider: "meta",
      model: "muse-spark-1.3",
      thinkingLevel: "high",
    }),
    "low",
  );
  assertEquals(
    clampProductTruthThinking({
      provider: "openai",
      model: "gpt-5.6-luna",
      thinkingLevel: "high",
    }),
    "low",
  );
  assertEquals(
    clampProductTruthThinking({
      provider: "openai",
      model: "gpt-5.6-terra",
      thinkingLevel: "xhigh",
    }),
    "low",
  );
  assertEquals(
    clampProductTruthThinking({
      provider: "gemini",
      model: "gemini-3.8-flash",
      thinkingLevel: "high",
    }),
    "low",
  );
  assertEquals(PRODUCT_TRUTH_TIMEOUT_MS, 50_000);
});

Deno.test("product-truth failover is Muse then Luna then Terra then Gemini Flash", () => {
  assertEquals(
    productTruthRouteChain(FAST_PRODUCT_TRUTH_ROUTE).map((route) =>
      `${route.provider}:${route.model}:${route.thinkingLevel}`
    ),
    [
      "meta:muse-spark-1.3:low",
      "openai:gpt-5.6-luna:low",
      "openai:gpt-5.6-terra:low",
      "gemini:gemini-3.8-flash:low",
    ],
  );
  assertEquals(
    productTruthRouteChain(FAST_PRODUCT_TRUTH_GEMINI_ROUTE, CHEAP_OPENAI_VISION_ROUTE)
      .map((route) => `${route.provider}:${route.model}`),
    [
      "gemini:gemini-3.8-flash",
      "openai:gpt-5.6-luna",
      "openai:gpt-5.6-terra",
      "meta:muse-spark-1.3",
    ],
  );
  assertEquals(
    productTruthRouteChain({
      provider: "openai",
      model: "gpt-5.6-luna",
      thinkingLevel: "high",
    }).map((route) => `${route.provider}:${route.model}:${route.thinkingLevel}`),
    [
      "openai:gpt-5.6-luna:low",
      "openai:gpt-5.6-terra:low",
      "gemini:gemini-3.8-flash:low",
      "meta:muse-spark-1.3:low",
    ],
  );
});

Deno.test("product-truth timeout budget stays at 45-55s and still reserves failover slices", () => {
  assertEquals(
    remainingVisionTimeoutMs({
      purpose: "product_truth",
      remainingRouteCount: 4,
      elapsedMs: 0,
      gatewayBudgetMs: 145_000,
    }),
    50_000,
  );
  const afterPrimary = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 3,
    elapsedMs: 50_000,
    gatewayBudgetMs: 145_000,
  });
  assert(afterPrimary >= 12_000);
  assert(afterPrimary <= 50_000);
  const timeout = classifyVisionProviderFailure("meta", {
    name: "TimeoutError",
    message: "The signal has been aborted",
  });
  assertEquals(shouldContinueVisionFallback(timeout, 3), true);
  assertEquals(shouldRetrySameVisionRoute(timeout), false);
  assertEquals(shouldContinueVisionFallback(timeout, 0), false);
});

Deno.test("timeout on Muse fails over to Luna then Terra and logs every hop", async () => {
  const routes = productTruthRouteChain(FAST_PRODUCT_TRUTH_ROUTE);
  const invoked: string[] = [];
  const result = await runVisionProviderChain({
    routes,
    purpose: "product_truth",
    gatewayBudgetMs: 145_000,
    now: Date.now,
    invoke: async (route) => {
      invoked.push(`${route.provider}:${route.model}`);
      if (route.model === "muse-spark-1.3" || route.model === "gpt-5.6-luna") {
        throw Object.assign(new Error("The signal has been aborted"), {
          name: "TimeoutError",
        });
      }
      return { ok: true, model: route.model };
    },
    classify: (route, error) =>
      classifyVisionProviderFailure(route.provider, {
        name: (error as { name?: string }).name,
        message: error instanceof Error ? error.message : String(error),
      }),
  });
  assertEquals(invoked, [
    "meta:muse-spark-1.3",
    "openai:gpt-5.6-luna",
    "openai:gpt-5.6-terra",
  ]);
  assertEquals(result.route.model, "gpt-5.6-terra");
  assertEquals(result.value, { ok: true, model: "gpt-5.6-terra" });
  const rows = visionAttemptTelemetryRows(result.attempts);
  assertEquals(rows.map((row) => `${row.model}:${row.status}:${row.attemptNumber}`), [
    "muse-spark-1.3:failed:1",
    "gpt-5.6-luna:failed:2",
    "gpt-5.6-terra:completed:3",
  ]);
  assertEquals(rows.filter((row) => row.status === "failed").length, 2);
});

Deno.test("auto-promotion requires four consecutive Luna or Terra successes", () => {
  const luna = {
    provider: "openai" as const,
    model: "gpt-5.6-luna",
    status: "completed",
  };
  assertEquals(
    evaluateVisionRoutePromotion({
      primary: FAST_PRODUCT_TRUTH_GEMINI_ROUTE,
      recentSuccessfulRuns: [luna, luna, luna],
    }),
    null,
  );
  assertEquals(
    evaluateVisionRoutePromotion({
      primary: FAST_PRODUCT_TRUTH_GEMINI_ROUTE,
      recentSuccessfulRuns: [luna, luna, luna, luna],
    }),
    CHEAP_OPENAI_VISION_ROUTE,
  );
  assertEquals(
    promotionFallbackRoute(CHEAP_OPENAI_VISION_ROUTE),
    OPENAI_TERRA_VISION_ROUTE,
  );
  assertEquals(
    evaluateVisionRoutePromotion({
      primary: CHEAP_OPENAI_VISION_ROUTE,
      recentSuccessfulRuns: [luna, luna, luna, luna],
    }),
    null,
  );
  const terra = {
    provider: "openai" as const,
    model: "gpt-5.6-terra",
    status: "completed",
  };
  assertEquals(
    evaluateVisionRoutePromotion({
      primary: FAST_PRODUCT_TRUTH_ROUTE,
      recentSuccessfulRuns: [terra, terra, terra, terra],
    }),
    OPENAI_TERRA_VISION_ROUTE,
  );
  assertEquals(
    evaluateVisionRoutePromotion({
      primary: FAST_PRODUCT_TRUTH_ROUTE,
      recentSuccessfulRuns: [
        luna,
        { provider: "gemini", model: "gemini-3.8-flash", status: "completed" },
        luna,
        luna,
        luna,
      ],
    }),
    null,
  );
});

