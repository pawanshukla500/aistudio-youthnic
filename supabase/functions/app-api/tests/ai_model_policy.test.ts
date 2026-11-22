import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  allowedModelsForPurpose,
  allowedThinkingLevels,
  assertAllowedAiModelRoute,
  classifyVisionProviderFailure,
  clampProductTruthThinking,
  clampProductTruthHopThinking,
  dualProtocolPrimaryTimeoutMs,
  visionProtocolOrder,
  DEFAULT_IMAGE_GENERATION_ROUTE,
  defaultImageGenerationRoute,
  defaultThinkingLevel,
  FAST_PRODUCT_TRUTH_ROUTE,
  FAST_PRODUCT_TRUTH_CONTRIBUTOR_ROUTE,
  FAST_PRODUCT_TRUTH_GEMINI_ROUTE,
  FAST_PRODUCT_TRUTH_ZAI_ROUTE,
  CHEAP_OPENAI_VISION_ROUTE,
  LUNA_HIGH_THINKING_VISION_ROUTE,
  OPENAI_TERRA_VISION_ROUTE,
  ANALYZE_PROXY_BUDGET_MS,
  PRODUCT_TRUTH_FALLBACK_RESERVE_MS,
  PRODUCT_TRUTH_PRIMARY_WINDOW_MS,
  PRODUCT_TRUTH_TIMEOUT_MS,
  STUDIO_ANALYSIS_FLIGHT_BUDGET_MS,
  studioAnalysisBudgetMs,
  STUDIO_INVOKE_BUDGET_MS,
  VISION_GATEWAY_RESERVE_MS,
  VISION_REQUEST_OVERHEAD_MS,
  productTruthGatewayBudgetMs,
  productTruthRemainingBudgetMs,
  geminiThinkingConfig,
  normalizeAiModelRoute,
  preferFastProductTruthThinking,
  productTruthRouteChain,
  remainingVisionTimeoutMs,
  invokeWithHopTimeout,
  runVisionProviderChain,
  shouldContinueVisionFallback,
  shouldRetrySameVisionRoute,
  validateAiModelRoute,
  visionAttemptTelemetryRows,
  parseMetaResponseSse,
  visionChainFailureMessage,
  visionRouteLabel,
} from "../lib/aiModelPolicy.ts";
import { parseJsonResponse } from "../lib/profiles.ts";

// The organization's saved Administration policy for product truth.
const ADMIN_TERRA = { provider: "openai", model: "gpt-5.6-terra", thinkingLevel: "high" } as const;
const ADMIN_MUSE_CONTRIBUTOR = { provider: "meta", model: "muse-spark-1.3-contributor", thinkingLevel: "high" } as const;

Deno.test("Meta response stream keeps the product-truth JSON", () => {
  const payload = parseMetaResponseSse([
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "{\"ok\":" })}`,
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "true}" })}`,
    `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", usage: { output_tokens: 4 } } })}`,
    "data: [DONE]",
  ].join("\n"));
  assertEquals(payload.output_text, "{\"ok\":true}");
  assertEquals((payload.usage as { output_tokens: number }).output_tokens, 4);
  assertThrows(() => parseMetaResponseSse(
    `data: ${JSON.stringify({ type: "response.failed", response: { error: { message: "model overloaded" } } })}`,
  ), Error, "model overloaded");
  assertThrows(() => parseMetaResponseSse([
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "{\"ok\":true}" })}`,
    `data: ${JSON.stringify({ type: "error", error: { code: "server_error", message: "stream failed" } })}`,
  ].join("\n")), Error, "server_error: stream failed");
});

Deno.test("vision registry keeps image generation on approved OpenAI image models", () => {
  assertEquals(DEFAULT_IMAGE_GENERATION_ROUTE, {
    provider: "openai",
    model: "gpt-image-2.6-sunburst",
    thinkingLevel: "none",
  });
  assertEquals(defaultImageGenerationRoute(), DEFAULT_IMAGE_GENERATION_ROUTE);
  assertEquals(allowedModelsForPurpose("openai", "image_generation"), [
    "gpt-image-2.6-sunburst",
    "gpt-image-2.6-flare",
    "gpt-image-2.6",
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

Deno.test("product-truth defaults to fast thinking; Gemini Flash QA thinking stays low", () => {
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
    ["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.3-contributor", "muse-spark-1.2-contributor"],
  );
  assertEquals(
    allowedModelsForPurpose("openai", "product_truth"),
    ["gpt-6.1-terra", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
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

Deno.test("product-truth analyze preserves high thinking for Meta Muse Spark, GPT 6.1 Terra, and Luna while clamping legacy heavy models", () => {
  assertEquals(
    clampProductTruthThinking({
      provider: "meta",
      model: "muse-spark-1.3",
      thinkingLevel: "high",
    }),
    "high",
  );
  assertEquals(
    clampProductTruthThinking({
      provider: "openai",
      model: "gpt-6.1-terra",
      thinkingLevel: "high",
    }),
    "high",
  );
  assertEquals(
    clampProductTruthThinking({
      provider: "openai",
      model: "gpt-5.6-luna",
      thinkingLevel: "high",
    }),
    "high",
  );
  assertEquals(
    clampProductTruthThinking({
      provider: "openai",
      model: "gpt-5.6-luna",
      thinkingLevel: "low",
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
  assertEquals(
    clampProductTruthThinking({
      provider: "openai",
      model: "gpt-5.6-terra",
      thinkingLevel: "none",
    }),
    "none",
  );
  assertEquals(PRODUCT_TRUTH_TIMEOUT_MS, 40_000);
  assertEquals(PRODUCT_TRUTH_FALLBACK_RESERVE_MS, 60_000);
  assertEquals(STUDIO_INVOKE_BUDGET_MS, 360_000);
});

Deno.test("product truth runs exactly the Administration primary, then its fallback", () => {
  const chain = (primary: Parameters<typeof productTruthRouteChain>[0], fallback?: Parameters<typeof productTruthRouteChain>[1]) =>
    productTruthRouteChain(primary, fallback).map((route) => `${route.provider}:${route.model}:${route.thinkingLevel}`);

  // The reported configuration: Terra first, Muse Spark 1.3 Contributor as fallback.
  // No Luna hop is inserted ahead of it and neither model is substituted; only
  // the reasoning effort is capped for the Studio time budget.
  assertEquals(chain(ADMIN_TERRA, ADMIN_MUSE_CONTRIBUTOR), [
    "openai:gpt-5.6-terra:low",
    "meta:muse-spark-1.3-contributor:high",
  ]);
  assertEquals(chain(CHEAP_OPENAI_VISION_ROUTE), ["openai:gpt-5.6-luna:low"]);
  // Meta Muse Contributor (medium) primary -> GPT 6.1 Terra (medium) fallback + Luna secondary fallback
  assertEquals(
    chain(FAST_PRODUCT_TRUTH_CONTRIBUTOR_ROUTE, [OPENAI_TERRA_VISION_ROUTE, LUNA_HIGH_THINKING_VISION_ROUTE]),
    [
      "meta:muse-spark-1.3-contributor:medium",
      "openai:gpt-6.1-terra:medium",
      "openai:gpt-5.6-luna:high",
    ],
  );
  // Gemini and Sol are no longer dropped: a saved choice is a saved choice.
  assertEquals(chain(FAST_PRODUCT_TRUTH_GEMINI_ROUTE, CHEAP_OPENAI_VISION_ROUTE), [
    "gemini:gemini-3.8-flash:low",
    "openai:gpt-5.6-luna:low",
  ]);
  assertEquals(chain({ provider: "openai", model: "gpt-5.6-sol", thinkingLevel: "high" }), ["openai:gpt-5.6-sol:low"]);
  assertEquals(chain(FAST_PRODUCT_TRUTH_ROUTE, {
    provider: "qwen",
    model: "qwen3.8-max",
    thinkingLevel: "none",
  }), ["meta:muse-spark-1.3:medium", "qwen:qwen3.8-max:none"]);
  // A fallback identical to the primary runs once.
  assertEquals(chain(OPENAI_TERRA_VISION_ROUTE, { provider: "openai", model: "gpt-6.1-terra", thinkingLevel: "medium" }), ["openai:gpt-6.1-terra:medium"]);
});

Deno.test("product-truth hop budget leaves the client wait a reserve", () => {
  // Spending the client's whole wait let the server still be working when the
  // browser aborted: the chain's clock starts after auth, the workspace RPC and
  // reference loading, so none of that is covered by the per-hop reserve.
  const reserved = STUDIO_INVOKE_BUDGET_MS - VISION_REQUEST_OVERHEAD_MS;
  assertEquals(productTruthGatewayBudgetMs(400_000), reserved);
  assertEquals(productTruthGatewayBudgetMs(), reserved);
  assert(productTruthGatewayBudgetMs() < STUDIO_INVOKE_BUDGET_MS);
  assertEquals(productTruthRemainingBudgetMs(0), ANALYZE_PROXY_BUDGET_MS);
  assertEquals(productTruthRemainingBudgetMs(20_000), ANALYZE_PROXY_BUDGET_MS - 20_000);
  assertEquals(productTruthRemainingBudgetMs(reserved + 5_000), 0);
  // After a long photo download, the chain only gets what is left before the
  // 300s proxy, and that leftover goes to Muse instead of a fallback window.
  const afterSlowPrep = productTruthRemainingBudgetMs(140_000);
  assertEquals(afterSlowPrep, ANALYZE_PROXY_BUDGET_MS - 140_000);
  assertEquals(remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 2,
    elapsedMs: 0,
    gatewayBudgetMs: afterSlowPrep,
    prepElapsedMs: 140_000,
  }), afterSlowPrep - VISION_GATEWAY_RESERVE_MS);
  // A configured cap with no prep delay is not a late start. The primary
  // still holds one fallback window.
  assertEquals(remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 2,
    elapsedMs: 0,
    gatewayBudgetMs: 175_000,
  }), 175_000 - VISION_GATEWAY_RESERVE_MS - PRODUCT_TRUTH_FALLBACK_RESERVE_MS);

  // The end-to-end invariant, and the reason the two reserves are not one:
  // a lone hop plus the work inside the chain plus the work outside it has to
  // land inside the client's wait, or the answer arrives after the browser has
  // already given up.
  const loneHop = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 1,
    elapsedMs: 0,
    gatewayBudgetMs: productTruthGatewayBudgetMs(),
  });
  assertEquals(
    loneHop + VISION_GATEWAY_RESERVE_MS + VISION_REQUEST_OVERHEAD_MS,
    STUDIO_INVOKE_BUDGET_MS,
  );
  assert(loneHop > 0);
  // With a fallback configured, the primary may use the wait minus a fixed
  // reserve, so a hanging primary can never starve the fallback.
  const primaryFirst = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 2,
    elapsedMs: 0,
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
  });
  assertEquals(primaryFirst, STUDIO_INVOKE_BUDGET_MS - VISION_GATEWAY_RESERVE_MS - PRODUCT_TRUTH_FALLBACK_RESERVE_MS);

  const primaryOnly = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 1,
    elapsedMs: 0,
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
  });
  assertEquals(primaryOnly, STUDIO_INVOKE_BUDGET_MS - VISION_GATEWAY_RESERVE_MS);

  // A primary that timed out still leaves the fallback its reserved share...
  const fallbackAfterPrimaryTimeout = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 1,
    elapsedMs: primaryFirst,
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
  });
  assertEquals(fallbackAfterPrimaryTimeout, PRODUCT_TRUTH_FALLBACK_RESERVE_MS);
  // ...and one that failed fast (a 404, a missing key) hands it nearly everything.
  const fallbackAfterFastFailure = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 1,
    elapsedMs: 1_000,
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
  });
  assert(fallbackAfterFastFailure > primaryFirst);
  assert(primaryFirst + fallbackAfterPrimaryTimeout + VISION_GATEWAY_RESERVE_MS <= STUDIO_INVOKE_BUDGET_MS);

  const timeout = classifyVisionProviderFailure("meta", {
    name: "TimeoutError",
    message: "The signal has been aborted",
  });
  assertEquals(shouldContinueVisionFallback(timeout, 2), true);
  assertEquals(shouldRetrySameVisionRoute(timeout), false);
  assertEquals(shouldContinueVisionFallback(timeout, 0), false);
});

Deno.test("timeout on hop-1 still invokes hop-2 and later hops", async () => {
  const routes = productTruthRouteChain(ADMIN_TERRA, ADMIN_MUSE_CONTRIBUTOR);
  const invoked: string[] = [];
  const result = await runVisionProviderChain({
    routes,
    purpose: "product_truth",
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
    now: Date.now,
    invoke: async (route) => {
      invoked.push(`${route.provider}:${route.model}`);
      if (route.model === "gpt-5.6-terra") {
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
  assertEquals(invoked[0], "openai:gpt-5.6-terra");
  assertEquals(invoked[1], "meta:muse-spark-1.3-contributor");
  assertEquals(result.route.model, "muse-spark-1.3-contributor");
  assertEquals(result.value, { ok: true, model: "muse-spark-1.3-contributor" });
  const rows = visionAttemptTelemetryRows(result.attempts);
  assertEquals(rows.map((row) => `${row.model}:${row.status}:${row.attemptNumber}`), [
    "gpt-5.6-terra:failed:1",
    "muse-spark-1.3-contributor:completed:2",
  ]);
});

Deno.test("unclassified provider request failure on hop-1 fails over to hop-2 instead of aborting", async () => {
  const routes = productTruthRouteChain(ADMIN_TERRA, ADMIN_MUSE_CONTRIBUTOR);
  const invoked: string[] = [];
  const result = await runVisionProviderChain({
    routes,
    purpose: "product_truth",
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
    now: Date.now,
    invoke: async (route) => {
      invoked.push(`${route.provider}:${route.model}`);
      if (route.model === "gpt-5.6-terra") {
        throw new Error("Internal provider gateway error");
      }
      return { ok: true, model: route.model };
    },
    classify: (route, error) =>
      classifyVisionProviderFailure(route.provider, {
        message: error instanceof Error ? error.message : String(error),
      }),
  });
  assertEquals(invoked[0], "openai:gpt-5.6-terra");
  assertEquals(invoked[1], "meta:muse-spark-1.3-contributor");
  assertEquals(result.route.model, "muse-spark-1.3-contributor");
  assertEquals(result.value, { ok: true, model: "muse-spark-1.3-contributor" });
});

Deno.test("80s leftover gateway still runs hop-2 after a full hop-1 timeout", async () => {
  const routes = productTruthRouteChain(ADMIN_TERRA, ADMIN_MUSE_CONTRIBUTOR);
  let clock = 0;
  const invoked: Array<{ model: string; timeoutMs: number; at: number }> = [];
  const result = await runVisionProviderChain({
    routes,
    purpose: "product_truth",
    gatewayBudgetMs: 80_000,
    now: () => clock,
    invoke: async (route, timeoutMs) => {
      invoked.push({ model: route.model, timeoutMs, at: clock });
      if (route.model === "gpt-5.6-terra") {
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
    "gpt-5.6-terra",
    "muse-spark-1.3-contributor",
  ]);
  assert(invoked[1].timeoutMs >= PRODUCT_TRUTH_FALLBACK_RESERVE_MS);
  assert(invoked[0].timeoutMs + invoked[1].timeoutMs <= 80_000);
  assertEquals(result.route.model, "muse-spark-1.3-contributor");
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
        assert(timeoutMs <= STUDIO_INVOKE_BUDGET_MS - VISION_GATEWAY_RESERVE_MS - PRODUCT_TRUTH_FALLBACK_RESERVE_MS);
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
  const routes = productTruthRouteChain(ADMIN_TERRA, ADMIN_MUSE_CONTRIBUTOR);
  const events: string[] = [];
  await runVisionProviderChain({
    routes,
    purpose: "product_truth",
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
    invoke: async (route) => {
      events.push(`invoke:${route.model}`);
      if (route.model === "gpt-5.6-terra") {
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
    "invoke:gpt-5.6-terra",
    "log:gpt-5.6-terra:failed",
    "invoke:muse-spark-1.3-contributor",
    "log:muse-spark-1.3-contributor:completed",
  ]);
});

Deno.test("a failed hop's row is written before the fallback starts", async () => {
  const routes = productTruthRouteChain(ADMIN_TERRA, ADMIN_MUSE_CONTRIBUTOR);
  let terraRowWritten = false;
  let rowWrittenWhenFallbackStarted: boolean | null = null;
  await runVisionProviderChain({
    routes,
    purpose: "product_truth",
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
    invoke: async (route) => {
      if (route.model === "gpt-5.6-terra") throw Object.assign(new Error("model not found"), { status: 404 });
      rowWrittenWhenFallbackStarted = terraRowWritten;
      return { ok: true };
    },
    classify: (route, error) =>
      classifyVisionProviderFailure(route.provider, {
        message: error instanceof Error ? error.message : String(error),
        status: (error as { status?: number }).status,
      }),
    onAttempt: async (attempt) => {
      if (attempt.outcome !== "failed") return;
      await new Promise((resolve) => setTimeout(resolve, 5)); // a normal, quick insert
      terraRowWritten = true;
    },
  });
  assertEquals(rowWrittenWhenFallbackStarted, true);
});

Deno.test("a stalled telemetry write takes at most the capped wait from the fallback, and is still awaited", async () => {
  const routes = productTruthRouteChain(ADMIN_TERRA, ADMIN_MUSE_CONTRIBUTOR);
  let clock = 0;
  let releaseWrite: () => void = () => { };
  let writeFinished = false;
  const fallbackTimeouts: number[] = [];
  const events: string[] = [];
  const chain = runVisionProviderChain({
    routes,
    purpose: "product_truth",
    gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
    now: () => clock,
    telemetryWaitMs: 1,
    invoke: async (route, timeoutMs) => {
      events.push(`invoke:${route.model}`);
      if (route.model === "gpt-5.6-terra") {
        clock += 1_000;
        throw Object.assign(new Error("model not found"), { status: 404 });
      }
      fallbackTimeouts.push(timeoutMs);
      return { ok: true };
    },
    classify: (route, error) =>
      classifyVisionProviderFailure(route.provider, {
        message: error instanceof Error ? error.message : String(error),
        status: (error as { status?: number }).status,
      }),
    onAttempt: async (attempt) => {
      if (attempt.outcome !== "failed") return;
      events.push(`write-started:${attempt.model}`);
      // A database write that is still pending when the fallback starts.
      await new Promise<void>((resolve) => { releaseWrite = resolve; });
      clock += 30_000;
      writeFinished = true;
    },
  });
  // The write is stalled; the fallback starts once the capped wait ends.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assertEquals(events, ["invoke:gpt-5.6-terra", "write-started:gpt-5.6-terra", "invoke:muse-spark-1.3-contributor"]);
  // The fallback got the full remaining wait: the pending write took nothing from it.
  assertEquals(fallbackTimeouts, [STUDIO_INVOKE_BUDGET_MS - VISION_GATEWAY_RESERVE_MS - 1_000]);
  assertEquals(writeFinished, false);
  releaseWrite();
  const result = await chain;
  // The chain does not return until the failed hop's row is written.
  assertEquals(writeFinished, true);
  assertEquals(result.route.model, "muse-spark-1.3-contributor");
});

Deno.test("a failed chain names every configured model and why it failed", async () => {
  const routes = productTruthRouteChain(ADMIN_TERRA, ADMIN_MUSE_CONTRIBUTOR);
  let thrown: unknown;
  try {
    await runVisionProviderChain({
      routes,
      purpose: "product_truth",
      gatewayBudgetMs: STUDIO_INVOKE_BUDGET_MS,
      invoke: (route) => {
        if (route.provider === "openai") {
          throw Object.assign(new Error("The model `gpt-5.6-terra` does not exist or you do not have access to it."), { status: 404 });
        }
        throw new Error("Meta Muse Spark is selected for vision work but META_MODEL_API_KEY is not configured in Supabase Edge Function secrets.");
      },
      classify: (route, error) =>
        classifyVisionProviderFailure(route.provider, {
          message: error instanceof Error ? error.message : String(error),
          status: (error as { status?: number }).status,
        }),
    });
  } catch (error) {
    thrown = error;
  }
  const failure = (thrown as { failure?: { message: string; code: string } }).failure;
  assert(failure);
  // Both hops ran: the missing Meta key did not silently remove the fallback.
  assertEquals((thrown as { attempts: unknown[] }).attempts.length, 2);
  assert(failure.message.startsWith("Every configured vision model failed."));
  assert(failure.message.includes("OpenAI gpt-5.6-terra: This model is not available to the configured API key"));
  assert(failure.message.includes("Meta muse-spark-1.3-contributor: Its API key (META_MODEL_API_KEY) is not configured on the server."));
  // The old wording promised a fallback at the very moment every fallback had failed.
  assertEquals(failure.message.includes("A configured fallback can be used"), false);
  assertEquals((thrown as Error).message, failure.message);
});

Deno.test("a single configured model says there is no fallback; a hard failure says the fallback was skipped", () => {
  const terraFailure = {
    provider: "openai" as const,
    model: "gpt-5.6-terra",
    outcome: "failed" as const,
    failureCode: "provider_unavailable",
    failureMessage: "This model is not available to the configured API key.",
  };
  assertEquals(
    visionChainFailureMessage([terraFailure], 1),
    "OpenAI gpt-5.6-terra: This model is not available to the configured API key. No fallback model is configured for this purpose in Administration.",
  );
  const invalid = { ...terraFailure, failureCode: "provider_invalid_request", failureMessage: "The request was rejected as invalid." };
  assert(visionChainFailureMessage([invalid], 2).endsWith("The configured fallback was not tried because this failure cannot be fixed by switching models."));
  assertEquals(visionRouteLabel(ADMIN_MUSE_CONTRIBUTOR), "Meta muse-spark-1.3-contributor");
  assertEquals(visionChainFailureMessage([], 2), "No approved vision provider route is available.");
  // A failed hop is named even when it carries no message or code.
  assertEquals(
    visionChainFailureMessage([{ provider: "meta", model: "muse-spark-1.3", outcome: "failed" }], 1),
    "Meta muse-spark-1.3: vision_request_failed No fallback model is configured for this purpose in Administration.",
  );
  // A completed hop is never listed as a failure.
  assertEquals(
    visionChainFailureMessage([{ provider: "meta", model: "muse-spark-1.3", outcome: "completed" }], 1),
    "No approved vision provider route is available.",
  );
});

Deno.test("Meta Muse Spark thinking levels and provider failure details", () => {
  const standardRoute = { provider: "meta", model: "muse-spark-1.3" };
  const standardLevels = allowedThinkingLevels(standardRoute, "product_truth");
  assertEquals(standardLevels.includes("max"), true);
  assertEquals(standardLevels.includes("minimal"), true);
  assertEquals(standardLevels.includes("none"), false);

  const contributorRoute = { provider: "meta", model: "muse-spark-1.3-contributor" };
  const contributorLevels = allowedThinkingLevels(contributorRoute, "product_truth");
  assertEquals(contributorLevels.includes("max"), false);
  assertEquals(contributorLevels.includes("minimal"), true);
  assertEquals(contributorLevels.includes("none"), false);

  // 404 failure returns safe, standardized message without echoing raw provider strings
  const unavailable404 = classifyVisionProviderFailure("meta", {
    status: 404,
    message: "Endpoint /v1/chat/completions does not serve this model. Use /v1/responses.",
  });
  assertEquals(unavailable404.code, "provider_unavailable");
  assertEquals(unavailable404.fallbackEligible, true);
  assertEquals(
    unavailable404.message,
    "This model is not available to the configured API key (model not found, or the account has no access to it). Check the model in Administration and the provider account.",
  );
});

Deno.test("3-tier vision fallback chain formats failure messages and budgets time across all 3 hops", () => {
  const metaFailure = {
    provider: "meta" as const,
    model: "muse-spark-1.3-contributor",
    outcome: "failed" as const,
    failureCode: "provider_unavailable",
    failureMessage: "Meta key not configured.",
  };
  const lunaFailure = {
    provider: "openai" as const,
    model: "gpt-5.6-luna",
    outcome: "failed" as const,
    failureCode: "provider_rate_limited",
    failureMessage: "It is rate-limited right now.",
  };
  const terraFailure = {
    provider: "openai" as const,
    model: "gpt-5.6-terra",
    outcome: "failed" as const,
    failureCode: "provider_budget_exhausted",
    failureMessage: "Budget exhausted.",
  };

  const message = visionChainFailureMessage([metaFailure, lunaFailure, terraFailure], 3);
  assert(message.startsWith("Every configured vision model failed."));
  assert(message.includes("Meta muse-spark-1.3-contributor"));
  assert(message.includes("OpenAI gpt-5.6-luna"));
  assert(message.includes("OpenAI gpt-5.6-terra"));

  // Terra is a third hop, but it does not take a second 60s reserve out of
  // the primary. One fallback window is held back, same as a two-hop chain.
  const hop1Timeout = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 3,
    elapsedMs: 0,
    gatewayBudgetMs: 235_000,
  });
  // 235,000 - 5,000 reserve - 60,000 fallback window = 170,000ms
  assertEquals(hop1Timeout, 170_000);
  assertEquals(hop1Timeout, remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 2,
    elapsedMs: 0,
    gatewayBudgetMs: 235_000,
  }));

  // hop 2 leaves 60s reserve for hop 3
  const hop2Timeout = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 2,
    elapsedMs: 20_000,
    gatewayBudgetMs: 235_000,
  });
  // 235,000 - 20,000 - 5,000 - 60,000 = 150,000ms
  assertEquals(hop2Timeout, 150_000);

  // Inside a tight 60s leftover window with 2 hops left ([Luna, Gemini]),
  // share the remaining budget (36s Luna / 24s Gemini) instead of starving hop 2 to 10s.
  const tightHop2Timeout = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 2,
    elapsedMs: 170_000,
    gatewayBudgetMs: 235_000,
  });
  assertEquals(tightHop2Timeout, 36_000);

  // hop 3 gets whatever is left of the wait
  const hop3Timeout = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 1,
    elapsedMs: 80_000,
    gatewayBudgetMs: 235_000,
  });
  // 235,000 - 80,000 - 5,000 = 150,000ms
  assertEquals(hop3Timeout, 150_000);
});

Deno.test("the first vision protocol keeps the whole hop", () => {
  // A 25s cap aborted Muse Spark while a product-photo call was still running.
  assertEquals(dualProtocolPrimaryTimeoutMs(80_000), 80_000);
  assertEquals(dualProtocolPrimaryTimeoutMs(125_000), 125_000);
  assertEquals(dualProtocolPrimaryTimeoutMs(45_000), 45_000);
  assertEquals(dualProtocolPrimaryTimeoutMs(8_000), 8_000);
  assertEquals(visionProtocolOrder("meta", true), ["responses", "chat"]);
  assertEquals(visionProtocolOrder("meta", false), ["responses", "chat"]);
  assertEquals(visionProtocolOrder("openai", true), ["responses", "chat"]);
  assertEquals(visionProtocolOrder("openai", false), ["chat", "responses"]);
});

Deno.test("clampProductTruthHopThinking clamps medium/high reasoning when hop timeout is under 60s", () => {
  // Luna with high thinking under 45s fallback hop is clamped to low
  const lunaHigh = { provider: "openai" as const, model: "gpt-5.6-luna", thinkingLevel: "high" as const };
  assertEquals(clampProductTruthHopThinking(lunaHigh, 45_000), {
    provider: "openai",
    model: "gpt-5.6-luna",
    thinkingLevel: "low",
  });

  // Terra / Muse with medium thinking under 45s emergency hop is clamped to low, but preserves medium at >= 60s
  const terraMedium = { provider: "openai" as const, model: "gpt-6.1-terra", thinkingLevel: "medium" as const };
  assertEquals(clampProductTruthHopThinking(terraMedium, 45_000), {
    provider: "openai",
    model: "gpt-6.1-terra",
    thinkingLevel: "low",
  });
  assertEquals(clampProductTruthHopThinking(terraMedium, 80_000), terraMedium);

  const museMedium = { provider: "meta" as const, model: "muse-spark-1.3-contributor", thinkingLevel: "medium" as const };
  assertEquals(clampProductTruthHopThinking(museMedium, 120_000), museMedium);
  assertEquals(
    clampProductTruthThinking({ provider: "meta", model: "muse-spark-1.3-contributor", thinkingLevel: "medium" }),
    "medium",
  );
  assertEquals(
    clampProductTruthThinking({ provider: "openai", model: "gpt-6.1-terra", thinkingLevel: "medium" }),
    "medium",
  );

  // Luna with high thinking under full 80s primary hop preserves high
  assertEquals(clampProductTruthHopThinking(lunaHigh, 80_000), lunaHigh);

  // Low, minimal, or none thinking are untouched under any timeout
  const lunaLow = { provider: "openai" as const, model: "gpt-5.6-luna", thinkingLevel: "low" as const };
  assertEquals(clampProductTruthHopThinking(lunaLow, 45_000), lunaLow);

  const museNone = { provider: "meta" as const, model: "muse-spark-1.3", thinkingLevel: "none" as const };
  assertEquals(clampProductTruthHopThinking(museNone, 30_000), museNone);
});

Deno.test("classifyVisionProviderFailure keeps HTTP 5xx not-available errors retryable instead of mislabeling API key access", () => {
  const transient503 = classifyVisionProviderFailure("meta", {
    status: 503,
    message: "Service is not available right now",
  });
  assertEquals(transient503.code, "provider_unavailable");
  assertEquals(transient503.retryable, true);
  assertEquals(transient503.fallbackEligible, true);
  assert(!transient503.message.includes("not available to the configured API key"));

  const missing404 = classifyVisionProviderFailure("meta", {
    status: 404,
    message: "This model is not available",
  });
  assertEquals(missing404.code, "provider_unavailable");
  assertEquals(missing404.retryable, false);
  assertEquals(missing404.fallbackEligible, true);
  assert(missing404.message.includes("not available to the configured API key"));

  const missing400 = classifyVisionProviderFailure("openai", {
    status: 400,
    code: "model_not_found",
    message: "The model does not exist or you do not have access to it",
  });
  assertEquals(missing400.code, "provider_unavailable");
  assertEquals(missing400.retryable, false);
  assertEquals(missing400.fallbackEligible, true);

  const payment402 = classifyVisionProviderFailure("meta", {
    status: 402,
    message: "Payment required",
  });
  assertEquals(payment402.code, "provider_budget_exhausted");
  assertEquals(payment402.retryable, false);
  assertEquals(payment402.fallbackEligible, true);

  const perMinuteTpm429 = classifyVisionProviderFailure("meta", {
    status: 429,
    message: "Rate limit quota exceeded: 60000 tokens per min (TPM) limit reached",
  });
  assertEquals(perMinuteTpm429.code, "provider_rate_limited");
  assertEquals(perMinuteTpm429.retryable, true);
  assertEquals(perMinuteTpm429.fallbackEligible, true);

  const streamDropped = classifyVisionProviderFailure("meta", {
    message: "Meta stream ended without a response.",
  });
  assertEquals(streamDropped.code, "provider_incomplete_response");
  assertEquals(streamDropped.retryable, true);
  assertEquals(streamDropped.fallbackEligible, true);
});

Deno.test("runVisionProviderChain clamps fallback thinking for product truth in telemetry and returned route", async () => {
  const primaryRoute = { provider: "meta" as const, model: "muse-spark-1.3", thinkingLevel: "low" as const };
  const fallbackRoute = { provider: "openai" as const, model: "gpt-5.6-luna", thinkingLevel: "high" as const };
  const terraRoute = { provider: "openai" as const, model: "gpt-5.6-terra", thinkingLevel: "low" as const };

  let simulatedTime = 1_000;
  let fallbackInvokedThinking: string | undefined;
  const result = await runVisionProviderChain({
    routes: [primaryRoute, fallbackRoute, terraRoute],
    purpose: "product_truth",
    gatewayBudgetMs: 50_000,
    now: () => simulatedTime,
    classify: (route, error) => classifyVisionProviderFailure(route.provider as any, { message: String(error) }),
    invoke: async (route, _timeoutMs) => {
      if (route.provider === "meta") {
        simulatedTime += 1_000;
        throw Object.assign(new Error("model not found"), { status: 404 });
      }
      fallbackInvokedThinking = route.thinkingLevel;
      return { ok: true };
    },
  });

  // Fallback invoked with low thinking under 45s hop budget
  assertEquals(fallbackInvokedThinking, "low");
  // Returned route reflects clamped thinking
  assertEquals(result.route.thinkingLevel, "low");
  // Telemetry attempt reflects clamped thinking
  assertEquals(result.attempts[1].thinkingLevel, "low");
});

Deno.test("defaultThinkingLevel prefers low for OpenAI QA routes when thinking is omitted", () => {
  assertEquals(defaultThinkingLevel({ provider: "openai", model: "gpt-5.6-luna" }, "qa"), "low");
  assertEquals(defaultThinkingLevel({ provider: "openai", model: "gpt-6.1-terra" }, "qa"), "low");
  assertEquals(
    assertAllowedAiModelRoute({ provider: "openai", model: "gpt-5.6-luna", thinkingLevel: "none" }, "qa").thinkingLevel,
    "none",
  );
});

Deno.test("4-tier shockproof chain (Meta -> Terra -> Luna -> Gemini) preserves runway for every fallback", async () => {
  const routes = [
    FAST_PRODUCT_TRUTH_CONTRIBUTOR_ROUTE,
    OPENAI_TERRA_VISION_ROUTE,
    CHEAP_OPENAI_VISION_ROUTE,
    FAST_PRODUCT_TRUTH_GEMINI_ROUTE,
  ];
  let clock = 0;
  const hops: Array<{ provider: string; model: string; thinking: string; timeoutMs: number }> = [];
  const result = await runVisionProviderChain({
    routes,
    purpose: "product_truth",
    gatewayBudgetMs: productTruthGatewayBudgetMs(),
    now: () => clock,
    invoke: async (route, timeoutMs) => {
      hops.push({
        provider: route.provider,
        model: route.model,
        thinking: route.thinkingLevel,
        timeoutMs,
      });
      if (route.provider === "meta") {
        clock += 2_000;
        throw Object.assign(new Error("model not found"), { status: 404 });
      }
      if (route.model === "gpt-6.1-terra") {
        clock += timeoutMs;
        throw Object.assign(new Error("The signal has been aborted"), { name: "TimeoutError" });
      }
      if (route.model === "gpt-5.6-luna") {
        clock += 12_000;
        throw Object.assign(new Error("Rate limit reached"), { status: 429 });
      }
      clock += 8_000;
      return { ok: true, model: route.model };
    },
    classify: (route, error) =>
      classifyVisionProviderFailure(route.provider, {
        name: (error as { name?: string }).name,
        status: (error as { status?: number }).status,
        message: error instanceof Error ? error.message : String(error),
      }),
  });

  assertEquals(hops.map((h) => h.model), [
    "muse-spark-1.3-contributor",
    "gpt-6.1-terra",
    "gpt-5.6-luna",
    "gemini-3.8-flash",
  ]);
  // Terra preserves medium thinking with >= 165s after fast Meta 404
  assertEquals(hops[1].thinking, "medium");
  assert(hops[1].timeoutMs >= 165_000);
  // Luna still gets > 30s inside tight reserve window instead of starving to 10s
  assertEquals(hops[2].thinking, "low");
  assert(hops[2].timeoutMs >= 30_000);
  // Gemini 3.8 Flash gets plenty of runway and completes
  assert(hops[3].timeoutMs >= 24_000);
  assertEquals(result.route.model, "gemini-3.8-flash");
});


Deno.test("runVisionProviderChain aborts immediately when signal aborts without running fallback hops", async () => {
  const controller = new AbortController();
  const invoked: string[] = [];
  const attempts: string[] = [];

  await assertRejects(
    () =>
      runVisionProviderChain({
        routes: [
          { provider: "meta", model: "muse-spark-1.3-contributor", thinkingLevel: "medium" },
          { provider: "openai", model: "gpt-6.1-terra", thinkingLevel: "medium" },
        ],
        purpose: "product_truth",
        gatewayBudgetMs: 235_000,
        signal: controller.signal,
        onAttempt: (attempt) => {
          attempts.push(`${attempt.provider}:${attempt.outcome}`);
        },
        invoke: (route) => {
          invoked.push(route.model);
          controller.abort();
          return Promise.reject(new DOMException("Aborted by client", "AbortError"));
        },
        classify: (route, error) =>
          classifyVisionProviderFailure(route.provider, {
            name: (error as { name?: string }).name,
            message: error instanceof Error ? error.message : String(error),
          }),
      }),
    DOMException,
    "aborted",
  );

  assertEquals(invoked, ["muse-spark-1.3-contributor"]);
  assertEquals(attempts, []);
});

Deno.test("Z.ai GLM 5.3 Flash and FlashX are approved for vision analysis/QA and enforce forced thinking", () => {
  assertEquals(allowedModelsForPurpose("zai", "product_truth"), ["glm-5.3-flash", "glm-5.3-flashx"]);
  assertEquals(allowedModelsForPurpose("zai", "qa"), ["glm-5.3-flash", "glm-5.3-flashx"]);
  assertEquals(allowedModelsForPurpose("zai", "image_generation"), []);

  assertEquals(
    normalizeAiModelRoute({ provider: "zai", model: "glm-5.3-flash" }, "product_truth"),
    { provider: "zai", model: "glm-5.3-flash", thinkingLevel: "medium" },
  );
  assertEquals(
    normalizeAiModelRoute({ provider: "zai", model: "glm-5.3-flash" }, "qa"),
    { provider: "zai", model: "glm-5.3-flash", thinkingLevel: "low" },
  );

  for (const thinkingLevel of ["low", "medium", "high", "max"] as const) {
    assertEquals(
      validateAiModelRoute({ provider: "zai", model: "glm-5.3-flash", thinkingLevel }, "product_truth"),
      { valid: true, route: { provider: "zai", model: "glm-5.3-flash", thinkingLevel } },
    );
    assertEquals(
      validateAiModelRoute({ provider: "zai", model: "glm-5.3-flashx", thinkingLevel }, "product_truth"),
      { valid: true, route: { provider: "zai", model: "glm-5.3-flashx", thinkingLevel } },
    );
  }

  assertEquals(
    parseJsonResponse('<think>analyzing garment pleats and zardozi border</think>\n```json\n{"category":"ethnic/fusion","mainColor":"maroon"}\n```'),
    { category: "ethnic/fusion", mainColor: "maroon" },
  );
  assertEquals(
    parseJsonResponse('{"note":"keep <think>literal</think> inside string","mainColor":"maroon"}'),
    { note: "keep <think>literal</think> inside string", mainColor: "maroon" },
  );

  assertThrows(
    () => assertAllowedAiModelRoute({ provider: "zai", model: "glm-5.3-flash", thinkingLevel: "none" }, "product_truth"),
    Error,
    "Z.ai GLM 5.3 Flash uses forced thinking",
  );

  assertEquals(
    clampProductTruthThinking({ provider: "zai", model: "glm-5.3-flash", thinkingLevel: "medium" }),
    "medium",
  );
  assertEquals(
    clampProductTruthThinking({ provider: "zai", model: "glm-5.3-flash", thinkingLevel: "high" }),
    "high",
  );
  assertEquals(visionRouteLabel({ provider: "zai", model: "glm-5.3-flash" }), "Z.ai glm-5.3-flash");
});

Deno.test("Meta Muse Spark -> Z.ai GLM 5.3 Flash -> OpenAI GPT 6.1 Terra -> GPT 5.6 Luna -> Gemini 3.8 Flash fallback chain executes seamlessly", async () => {
  const routes = productTruthRouteChain(
    FAST_PRODUCT_TRUTH_CONTRIBUTOR_ROUTE,
    [
      { provider: "zai", model: "glm-5.3-flash", thinkingLevel: "medium" },
      OPENAI_TERRA_VISION_ROUTE,
      CHEAP_OPENAI_VISION_ROUTE,
      FAST_PRODUCT_TRUTH_GEMINI_ROUTE,
    ],
  );
  assertEquals(
    routes.map((r) => `${r.provider}:${r.model}:${r.thinkingLevel}`),
    [
      "meta:muse-spark-1.3-contributor:medium",
      "zai:glm-5.3-flash:medium",
      "openai:gpt-6.1-terra:medium",
      "openai:gpt-5.6-luna:low",
      "gemini:gemini-3.8-flash:low",
    ],
  );

  const visited: string[] = [];
  const result = await runVisionProviderChain({
    routes,
    purpose: "product_truth",
    gatewayBudgetMs: 260_000,
    invoke: (route) => {
      visited.push(`${route.provider}:${route.model}:${route.thinkingLevel}`);
      if (route.provider === "meta") {
        return Promise.reject(Object.assign(new Error("Meta Muse Spark per-minute token limit active"), { status: 429 }));
      }
      return Promise.resolve({ ok: true, provider: route.provider, model: route.model });
    },
    classify: (route, error) =>
      classifyVisionProviderFailure(route.provider, {
        status: (error as { status?: number }).status,
        message: error instanceof Error ? error.message : String(error),
      }),
  });

  assertEquals(visited, [
    "meta:muse-spark-1.3-contributor:medium",
    "zai:glm-5.3-flash:medium",
  ]);
  assertEquals(result.route.provider, "zai");
  assertEquals(result.route.model, "glm-5.3-flash");
});

// Production, 14 days to Nov 22 2026: Meta completed 338 analyses (12 over 165s, max 224s) and timed out 3 times;
// GLM 5.3 Flash completed 5 with p50 202s. Inside one 280s proxy window the fallback after a Meta timeout got ~60s.
const timeoutError = () => Object.assign(new Error("The selected vision provider timed out."), { name: "TimeoutError" });

function slowMetaChain(gatewayBudgetMs: number, primaryWindowMs?: number) {
  let clock = 0;
  const invoked: { model: string; timeoutMs: number }[] = [];
  const run = runVisionProviderChain({
    routes: [FAST_PRODUCT_TRUTH_ROUTE, FAST_PRODUCT_TRUTH_ZAI_ROUTE, OPENAI_TERRA_VISION_ROUTE],
    purpose: "product_truth",
    gatewayBudgetMs,
    primaryWindowMs,
    now: () => clock,
    invoke: async (route, timeoutMs) => {
      invoked.push({ model: route.model, timeoutMs });
      // Meta hangs until its hop times out; GLM needs its p50 of 202s.
      if (route.provider === "meta" || timeoutMs < 202_000) {
        clock += timeoutMs;
        throw timeoutError();
      }
      clock += 202_000;
      return { ok: true, model: route.model };
    },
    classify: (route, error) => classifyVisionProviderFailure(route.provider, {
      name: (error as { name?: string }).name,
      message: error instanceof Error ? error.message : String(error),
    }),
  });
  return { run, invoked };
}

Deno.test("a detached Studio analysis leaves GLM a full window after a Meta timeout; one 280s request could not", async () => {
  const proxyBound = slowMetaChain(ANALYZE_PROXY_BUDGET_MS);
  await assertRejects(() => proxyBound.run);
  assert(proxyBound.invoked[1].timeoutMs <= PRODUCT_TRUTH_FALLBACK_RESERVE_MS, "the old fallback window is about a minute");

  const prepMs = 10_000;
  const detached = slowMetaChain(studioAnalysisBudgetMs(prepMs), PRODUCT_TRUTH_PRIMARY_WINDOW_MS);
  const result = await detached.run;
  assertEquals(result.route.model, "glm-5.3-flash");
  assertEquals(result.route.thinkingLevel, "medium", "GLM keeps medium reasoning: its window is far over 60s");
  assertEquals(detached.invoked[0], { model: "muse-spark-1.3", timeoutMs: PRODUCT_TRUTH_PRIMARY_WINDOW_MS });
  // 600s - 10s prep - 240s Meta - 5s reserve - 60s for Terra.
  assertEquals(detached.invoked[1].timeoutMs, STUDIO_ANALYSIS_FLIGHT_BUDGET_MS - prepMs - PRODUCT_TRUTH_PRIMARY_WINDOW_MS - VISION_GATEWAY_RESERVE_MS - PRODUCT_TRUTH_FALLBACK_RESERVE_MS);
  assert(PRODUCT_TRUTH_PRIMARY_WINDOW_MS > 224_000, "Meta's slowest completed analysis still fits its window");
});

Deno.test("the primary window caps only a first hop that has a fallback", () => {
  const budget = studioAnalysisBudgetMs(0);
  assertEquals(budget, STUDIO_ANALYSIS_FLIGHT_BUDGET_MS);
  assertEquals(studioAnalysisBudgetMs(700_000), 0);
  const base = { purpose: "product_truth", elapsedMs: 0, gatewayBudgetMs: budget };
  assertEquals(remainingVisionTimeoutMs({ ...base, remainingRouteCount: 3, primaryWindowMs: PRODUCT_TRUTH_PRIMARY_WINDOW_MS }), PRODUCT_TRUTH_PRIMARY_WINDOW_MS);
  // A lone route keeps the whole flight, as the last hop always has.
  assertEquals(remainingVisionTimeoutMs({ ...base, remainingRouteCount: 1, primaryWindowMs: PRODUCT_TRUTH_PRIMARY_WINDOW_MS }), budget - VISION_GATEWAY_RESERVE_MS);
  // A tight budget still holds the fallback reserve back from the primary.
  assertEquals(remainingVisionTimeoutMs({ ...base, gatewayBudgetMs: 200_000, remainingRouteCount: 2, primaryWindowMs: PRODUCT_TRUTH_PRIMARY_WINDOW_MS }), 200_000 - VISION_GATEWAY_RESERVE_MS - PRODUCT_TRUTH_FALLBACK_RESERVE_MS);
  // Without the window (catalog preflight, QA) nothing changes.
  assertEquals(remainingVisionTimeoutMs({ ...base, remainingRouteCount: 2 }), budget - VISION_GATEWAY_RESERVE_MS - PRODUCT_TRUTH_FALLBACK_RESERVE_MS);
  // A flight that starts late (a long wait for a vision slot) still keeps the fallback's reserve;
  // the one-request path keeps giving a late primary the whole leftover.
  const lateStart = { purpose: "product_truth", remainingRouteCount: 2, elapsedMs: 0, gatewayBudgetMs: 200_000, prepElapsedMs: 400_000 };
  assertEquals(remainingVisionTimeoutMs({ ...lateStart, primaryWindowMs: PRODUCT_TRUTH_PRIMARY_WINDOW_MS }), 200_000 - VISION_GATEWAY_RESERVE_MS - PRODUCT_TRUTH_FALLBACK_RESERVE_MS);
  assertEquals(remainingVisionTimeoutMs(lateStart), 200_000 - VISION_GATEWAY_RESERVE_MS);
});
