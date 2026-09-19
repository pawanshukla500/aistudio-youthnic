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
  PRODUCT_TRUTH_SLOW_HOP_TIMEOUT_MS,
  STUDIO_INVOKE_BUDGET_MS,
  VISION_GATEWAY_RESERVE_MS,
  VISION_REQUEST_OVERHEAD_MS,
  evaluateVisionRoutePromotion,
  isSlowProductTruthHop,
  productTruthGatewayBudgetMs,
  productTruthHopTimeoutMs,
  geminiThinkingConfig,
  normalizeAiModelRoute,
  preferFastProductTruthRoute,
  preferFastProductTruthThinking,
  productTruthRouteChain,
  promotionFallbackRoute,
  remainingVisionTimeoutMs,
  invokeWithHopTimeout,
  isOmittedProductTruthHop,
  runVisionProviderChain,
  selectConfiguredVisionRoutes,
  shouldContinueVisionFallback,
  shouldRetrySameVisionRoute,
  validateAiModelRoute,
  visionAttemptTelemetryRows,
} from "../lib/aiModelPolicy.ts";

Deno.test("vision registry keeps image generation on approved OpenAI image models", () => {
  assertEquals(DEFAULT_IMAGE_GENERATION_ROUTE, {
    provider: "openai",
    model: "gpt-image-2.5-flare-2026-09-08",
    thinkingLevel: "none",
  });
  assertEquals(defaultImageGenerationRoute(), DEFAULT_IMAGE_GENERATION_ROUTE);
  assertEquals(allowedModelsForPurpose("openai", "image_generation"), [
    "gpt-image-2.5-flare-2026-09-08",
    "gpt-image-2.5-flare",
    "gpt-image-2.5-sunburst",
    "gpt-image-2",
    "gpt-image-1.5",
    "gpt-image-1",
    "gpt-image-1-mini",
  ]);
  assertEquals(
    validateAiModelRoute(
      { provider: "openai", model: "gpt-image-2.5-flare-2026-09-08" },
      "image_generation",
    ),
    {
      valid: true,
      route: {
        provider: "openai",
        model: "gpt-image-2.5-flare-2026-09-08",
        thinkingLevel: "none",
      },
    },
  );
  assertEquals(
    validateAiModelRoute(
      { provider: "openai", model: "gpt-image-2.5-sunburst" },
      "image_generation",
    ),
    {
      valid: true,
      route: {
        provider: "openai",
        model: "gpt-image-2.5-sunburst",
        thinkingLevel: "none",
      },
    },
  );
  assertEquals(
    validateAiModelRoute(
      { provider: "openai", model: "gpt-image-2.5-flare" },
      "image_generation",
    ),
    {
      valid: true,
      route: {
        provider: "openai",
        model: "gpt-image-2.5-flare",
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
  assertEquals(missingSecret.fallbackEligible, true);

  const connectionError = classifyVisionProviderFailure("gemini", {
    message: "error sending request for url (https://generativelanguage.googleapis.com/...): connection closed before message completed",
  });
  assertEquals(connectionError.code, "provider_unavailable");
  assertEquals(connectionError.fallbackEligible, true);

  const unexpectedFailure = classifyVisionProviderFailure("gemini", {
    message: "An unexpected internal error occurred on upstream vision gateway",
  });
  assertEquals(unexpectedFailure.code, "provider_request_failed");
  assertEquals(unexpectedFailure.fallbackEligible, true);
  assert(shouldContinueVisionFallback(unexpectedFailure, 2));
});

Deno.test("product-truth defaults to fast thinking and reroutes slow GPT and Gemini to OpenAI Luna", () => {
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
  assertEquals(preferred.route, CHEAP_OPENAI_VISION_ROUTE);
  assertEquals(preferred.fallback, OPENAI_TERRA_VISION_ROUTE);
  const geminiPreferred = preferFastProductTruthRoute({
    provider: "gemini",
    model: "gemini-3.8-flash",
    thinkingLevel: "medium",
  });
  assertEquals(geminiPreferred.rerouted, true);
  assertEquals(geminiPreferred.route, CHEAP_OPENAI_VISION_ROUTE);
  assertEquals(geminiPreferred.fallback, OPENAI_TERRA_VISION_ROUTE);
  assertEquals(
    preferFastProductTruthRoute({
      provider: "openai",
      model: "gpt-5.6-luna",
      thinkingLevel: "low",
    }),
    { route: CHEAP_OPENAI_VISION_ROUTE, fallback: OPENAI_TERRA_VISION_ROUTE, rerouted: false },
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
  assertEquals(PRODUCT_TRUTH_TIMEOUT_MS, 40_000);
  assertEquals(PRODUCT_TRUTH_SLOW_HOP_TIMEOUT_MS, 25_000);
  assertEquals(STUDIO_INVOKE_BUDGET_MS, 140_000);
});

Deno.test("product-truth failover is OpenAI Luna, keeps Terra, and omits Gemini", () => {
  const expected = ["openai:gpt-5.6-luna:low"];
  assertEquals(
    productTruthRouteChain(CHEAP_OPENAI_VISION_ROUTE).map((route) =>
      `${route.provider}:${route.model}:${route.thinkingLevel}`
    ),
    expected,
  );
  assertEquals(
    productTruthRouteChain(FAST_PRODUCT_TRUTH_GEMINI_ROUTE, CHEAP_OPENAI_VISION_ROUTE)
      .map((route) => `${route.provider}:${route.model}:${route.thinkingLevel}`),
    expected,
  );
  assertEquals(
    productTruthRouteChain({
      provider: "openai",
      model: "gpt-5.6-luna",
      thinkingLevel: "high",
    }).map((route) => `${route.provider}:${route.model}:${route.thinkingLevel}`),
    expected,
  );
  assertEquals(
    productTruthRouteChain(FAST_PRODUCT_TRUTH_ROUTE, {
      provider: "qwen",
      model: "qwen3.8-max",
      thinkingLevel: "none",
    }).map((route) => `${route.provider}:${route.model}`),
    [
      "openai:gpt-5.6-luna",
      "meta:muse-spark-1.3",
      "qwen:qwen3.8-max",
    ],
  );
  assertEquals(
    productTruthRouteChain(FAST_PRODUCT_TRUTH_ROUTE, {
      provider: "gemini",
      model: "gemini-3.1-pro",
      thinkingLevel: "high",
    }).map((route) => `${route.provider}:${route.model}`),
    [
      "openai:gpt-5.6-luna",
      "meta:muse-spark-1.3",
    ],
  );
  assertEquals(
    productTruthRouteChain(CHEAP_OPENAI_VISION_ROUTE, OPENAI_TERRA_VISION_ROUTE)
      .map((route) => `${route.provider}:${route.model}`),
    ["openai:gpt-5.6-luna", "openai:gpt-5.6-terra"],
  );
  assertEquals(
    productTruthRouteChain({
      provider: "openai",
      model: "gpt-5.6-terra",
      thinkingLevel: "low",
    }).map((route) => `${route.provider}:${route.model}`),
    ["openai:gpt-5.6-luna", "openai:gpt-5.6-terra"],
  );
  assertEquals(
    productTruthRouteChain({
      provider: "openai",
      model: "gpt-5.6-sol",
      thinkingLevel: "low",
    }).map((route) => `${route.provider}:${route.model}`),
    ["openai:gpt-5.6-luna"],
  );
});

Deno.test("product-truth hop budget leaves the client wait a reserve", () => {
  // Spending the client's whole wait let the server still be working when the
  // browser aborted: the chain's clock starts after auth, the workspace RPC and
  // reference loading, so none of that is covered by the per-hop reserve.
  const reserved = STUDIO_INVOKE_BUDGET_MS - VISION_REQUEST_OVERHEAD_MS;
  assertEquals(productTruthGatewayBudgetMs(145_000), reserved);
  assertEquals(productTruthGatewayBudgetMs(), reserved);
  assert(productTruthGatewayBudgetMs() < STUDIO_INVOKE_BUDGET_MS);

  // The end-to-end invariant, and the reason the two reserves are not one:
  // a lone hop plus the work inside the chain plus the work outside it has to
  // land inside the client's wait, or the answer arrives after the browser has
  // already given up.
  const loneHop = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 1,
    elapsedMs: 0,
    gatewayBudgetMs: productTruthGatewayBudgetMs(),
    route: CHEAP_OPENAI_VISION_ROUTE,
  });
  assertEquals(
    loneHop + VISION_GATEWAY_RESERVE_MS + VISION_REQUEST_OVERHEAD_MS,
    STUDIO_INVOKE_BUDGET_MS,
  );
  assert(loneHop > 0);
  assertEquals(
    isSlowProductTruthHop({ provider: "meta", model: "muse-spark-1.3" }),
    true,
  );
  assertEquals(
    productTruthHopTimeoutMs({ provider: "meta", model: "muse-spark-1.3" }),
    PRODUCT_TRUTH_SLOW_HOP_TIMEOUT_MS,
  );
  assert(PRODUCT_TRUTH_SLOW_HOP_TIMEOUT_MS >= 20_000);
  assert(PRODUCT_TRUTH_SLOW_HOP_TIMEOUT_MS <= 25_000);
  assertEquals(
    productTruthHopTimeoutMs({ provider: "openai", model: "gpt-5.6-luna" }),
    PRODUCT_TRUTH_TIMEOUT_MS,
  );

  const lunaFirst = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 2,
    elapsedMs: 0,
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
    route: CHEAP_OPENAI_VISION_ROUTE,
  });
  assertEquals(lunaFirst, PRODUCT_TRUTH_TIMEOUT_MS);
  assert(lunaFirst < STUDIO_INVOKE_BUDGET_MS);

  const lunaOnly = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 1,
    elapsedMs: 0,
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
    route: CHEAP_OPENAI_VISION_ROUTE,
  });
  assertEquals(lunaOnly, STUDIO_INVOKE_BUDGET_MS - VISION_GATEWAY_RESERVE_MS);

  const museIfFirst = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 3,
    elapsedMs: 0,
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
    route: FAST_PRODUCT_TRUTH_ROUTE,
  });
  assertEquals(museIfFirst, PRODUCT_TRUTH_SLOW_HOP_TIMEOUT_MS);
  assert(museIfFirst <= 25_000);

  const afterLunaTimeout = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 1,
    elapsedMs: PRODUCT_TRUTH_TIMEOUT_MS,
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
    route: FAST_PRODUCT_TRUTH_ROUTE,
  });
  assert(afterLunaTimeout >= 10_000);
  assert(
    PRODUCT_TRUTH_TIMEOUT_MS + afterLunaTimeout + VISION_GATEWAY_RESERVE_MS <=
      STUDIO_INVOKE_BUDGET_MS,
  );

  const timeout = classifyVisionProviderFailure("meta", {
    name: "TimeoutError",
    message: "The signal has been aborted",
  });
  assertEquals(shouldContinueVisionFallback(timeout, 2), true);
  assertEquals(shouldRetrySameVisionRoute(timeout), false);
  assertEquals(shouldContinueVisionFallback(timeout, 0), false);
});

Deno.test("timeout on hop-1 still invokes hop-2 and later hops", async () => {
  const routes = productTruthRouteChain(FAST_PRODUCT_TRUTH_ROUTE);
  const invoked: string[] = [];
  const result = await runVisionProviderChain({
    routes,
    purpose: "product_truth",
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
    now: Date.now,
    invoke: async (route) => {
      invoked.push(`${route.provider}:${route.model}`);
      if (route.model === "gpt-5.6-luna") {
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
  assertEquals(invoked[0], "openai:gpt-5.6-luna");
  assertEquals(invoked[1], "meta:muse-spark-1.3");
  assertEquals(result.route.model, "muse-spark-1.3");
  assertEquals(result.value, { ok: true, model: "muse-spark-1.3" });
  const rows = visionAttemptTelemetryRows(result.attempts);
  assertEquals(rows.map((row) => `${row.model}:${row.status}:${row.attemptNumber}`), [
    "gpt-5.6-luna:failed:1",
    "muse-spark-1.3:completed:2",
  ]);
});

Deno.test("unclassified provider request failure on hop-1 fails over to hop-2 instead of aborting", async () => {
  const routes = productTruthRouteChain(FAST_PRODUCT_TRUTH_ROUTE);
  const invoked: string[] = [];
  const result = await runVisionProviderChain({
    routes,
    purpose: "product_truth",
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
    now: Date.now,
    invoke: async (route) => {
      invoked.push(`${route.provider}:${route.model}`);
      if (route.model === "gpt-5.6-luna") {
        throw new Error("Internal provider gateway error");
      }
      return { ok: true, model: route.model };
    },
    classify: (route, error) =>
      classifyVisionProviderFailure(route.provider, {
        message: error instanceof Error ? error.message : String(error),
      }),
  });
  assertEquals(invoked[0], "openai:gpt-5.6-luna");
  assertEquals(invoked[1], "meta:muse-spark-1.3");
  assertEquals(result.route.model, "muse-spark-1.3");
  assertEquals(result.value, { ok: true, model: "muse-spark-1.3" });
});

Deno.test("60s leftover gateway still runs hop-2 after a full hop-1 timeout", async () => {
  const routes = productTruthRouteChain(FAST_PRODUCT_TRUTH_ROUTE);
  let clock = 0;
  const invoked: Array<{ model: string; timeoutMs: number; at: number }> = [];
  const result = await runVisionProviderChain({
    routes,
    purpose: "product_truth",
    gatewayBudgetMs: 60_000,
    now: () => clock,
    invoke: async (route, timeoutMs) => {
      invoked.push({ model: route.model, timeoutMs, at: clock });
      if (route.model === "gpt-5.6-luna") {
        clock += timeoutMs;
        throw Object.assign(new Error("The selected vision provider timed out."), {
          name: "TimeoutError",
        });
      }
      clock += 1_000;
      return { ok: true, model: route.model };
    },
    classify: (route, error) =>
      classifyVisionProviderFailure(route.provider, {
        name: (error as { name?: string }).name,
        message: error instanceof Error ? error.message : String(error),
      }),
  });
  assertEquals(invoked.map((hop) => hop.model), [
    "gpt-5.6-luna",
    "muse-spark-1.3",
  ]);
  assert(invoked[0].timeoutMs <= PRODUCT_TRUTH_TIMEOUT_MS);
  assert(invoked[1].timeoutMs >= 8_000);
  assert(invoked[0].timeoutMs + invoked[1].timeoutMs <= 60_000);
  assertEquals(result.route.model, "muse-spark-1.3");
});

Deno.test("Muse timeout still invokes hop-2 and logs both hops", async () => {
  const routes = [
    FAST_PRODUCT_TRUTH_ROUTE,
    CHEAP_OPENAI_VISION_ROUTE,
  ];
  const events: string[] = [];
  let clock = 0;
  const result = await runVisionProviderChain({
    routes,
    purpose: "product_truth",
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
    now: () => clock,
    invoke: async (route, timeoutMs) => {
      events.push(`invoke:${route.model}`);
      if (route.model === "muse-spark-1.3") {
        assert(timeoutMs <= PRODUCT_TRUTH_SLOW_HOP_TIMEOUT_MS);
        clock += timeoutMs;
        throw Object.assign(new Error("The selected vision provider timed out."), {
          name: "TimeoutError",
        });
      }
      clock += 1_000;
      return { ok: true, model: route.model };
    },
    classify: (route, error) =>
      classifyVisionProviderFailure(route.provider, {
        name: (error as { name?: string }).name,
        message: error instanceof Error ? error.message : String(error),
      }),
    onAttempt: (attempt) => {
      events.push(`log:${attempt.model}:${attempt.outcome}:${attempt.attemptNumber}`);
    },
  });
  assertEquals(events, [
    "invoke:muse-spark-1.3",
    "log:muse-spark-1.3:failed:1",
    "invoke:gpt-5.6-luna",
    "log:gpt-5.6-luna:completed:2",
  ]);
  assertEquals(result.route.model, "gpt-5.6-luna");
  assertEquals(
    visionAttemptTelemetryRows(result.attempts).map((row) =>
      `${row.model}:${row.status}:${row.attemptNumber}`
    ),
    [
      "muse-spark-1.3:failed:1",
      "gpt-5.6-luna:completed:2",
    ],
  );
});

Deno.test("hop timeout is enforced when invoke ignores timeoutMs", async () => {
  const started = Date.now();
  let rejected = false;
  try {
    await invokeWithHopTimeout(
      () => new Promise((resolve) => setTimeout(resolve, 2_000)),
      40,
    );
  } catch (error) {
    rejected = true;
    assertEquals((error as { name?: string }).name, "TimeoutError");
  }
  assertEquals(rejected, true);
  assert(Date.now() - started < 500);
});

Deno.test("failed hops are persisted before the next provider is invoked", async () => {
  const routes = productTruthRouteChain(FAST_PRODUCT_TRUTH_ROUTE);
  const events: string[] = [];
  await runVisionProviderChain({
    routes,
    purpose: "product_truth",
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
    invoke: async (route) => {
      events.push(`invoke:${route.model}`);
      if (route.model === "gpt-5.6-luna") {
        throw Object.assign(new Error("The signal has been aborted"), {
          name: "TimeoutError",
        });
      }
      return { ok: true };
    },
    classify: (route, error) =>
      classifyVisionProviderFailure(route.provider, {
        name: (error as { name?: string }).name,
        message: error instanceof Error ? error.message : String(error),
      }),
    onAttempt: (attempt) => {
      events.push(`log:${attempt.model}:${attempt.outcome}`);
    },
  });
  assertEquals(events, [
    "invoke:gpt-5.6-luna",
    "log:gpt-5.6-luna:failed",
    "invoke:muse-spark-1.3",
    "log:muse-spark-1.3:completed",
  ]);
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
      ],
    }),
    null,
  );
});

Deno.test("Gemini completions are not auto-promoted; only configured OpenAI hops run", () => {
  const gemini = {
    provider: "gemini" as const,
    model: "gemini-3.8-flash",
    status: "completed",
  };
  assertEquals(
    evaluateVisionRoutePromotion({
      primary: FAST_PRODUCT_TRUTH_ROUTE,
      recentSuccessfulRuns: [gemini, gemini, gemini],
    }),
    null,
  );
  assertEquals(
    evaluateVisionRoutePromotion({
      primary: FAST_PRODUCT_TRUTH_ROUTE,
      recentSuccessfulRuns: Array.from({ length: 12 }, () => gemini),
    }),
    null,
  );
  assertEquals(
    promotionFallbackRoute(FAST_PRODUCT_TRUTH_GEMINI_ROUTE),
    CHEAP_OPENAI_VISION_ROUTE,
  );
  assertEquals(
    selectConfiguredVisionRoutes(
      productTruthRouteChain(FAST_PRODUCT_TRUTH_GEMINI_ROUTE, FAST_PRODUCT_TRUTH_ROUTE),
      ["openai"],
    ).map((route) => `${route.provider}:${route.model}`),
    ["openai:gpt-5.6-luna"],
  );
  assertEquals(
    selectConfiguredVisionRoutes(
      [
        FAST_PRODUCT_TRUTH_GEMINI_ROUTE,
        CHEAP_OPENAI_VISION_ROUTE,
        FAST_PRODUCT_TRUTH_ROUTE,
      ],
      ["openai", "gemini", "meta"],
    ).map((route) => `${route.provider}:${route.model}`),
    ["gemini:gemini-3.8-flash", "openai:gpt-5.6-luna", "meta:muse-spark-1.3"],
  );
});

