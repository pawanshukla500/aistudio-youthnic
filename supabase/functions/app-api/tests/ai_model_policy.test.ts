import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  allowedModelsForPurpose,
  allowedThinkingLevels,
  assertAllowedAiModelRoute,
  classifyVisionProviderFailure,
  clampProductTruthThinking,
  clampProductTruthHopThinking,
  dualProtocolPrimaryTimeoutMs,
  DEFAULT_IMAGE_GENERATION_ROUTE,
  defaultImageGenerationRoute,
  defaultThinkingLevel,
  FAST_PRODUCT_TRUTH_ROUTE,
  FAST_PRODUCT_TRUTH_CONTRIBUTOR_ROUTE,
  FAST_PRODUCT_TRUTH_GEMINI_ROUTE,
  CHEAP_OPENAI_VISION_ROUTE,
  LUNA_HIGH_THINKING_VISION_ROUTE,
  OPENAI_TERRA_VISION_ROUTE,
  PRODUCT_TRUTH_FALLBACK_RESERVE_MS,
  PRODUCT_TRUTH_TIMEOUT_MS,
  STUDIO_INVOKE_BUDGET_MS,
  VISION_GATEWAY_RESERVE_MS,
  VISION_REQUEST_OVERHEAD_MS,
  productTruthGatewayBudgetMs,
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
  visionChainFailureMessage,
  visionRouteLabel,
} from "../lib/aiModelPolicy.ts";

// The organization's saved Administration policy for product truth.
const ADMIN_TERRA = { provider: "openai", model: "gpt-5.6-terra", thinkingLevel: "high" } as const;
const ADMIN_MUSE_CONTRIBUTOR = { provider: "meta", model: "muse-spark-1.3-contributor", thinkingLevel: "high" } as const;

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

Deno.test("product-truth analyze clamps Admin high thinking to low for heavy models while preserving high for Luna", () => {
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
  assertEquals(PRODUCT_TRUTH_FALLBACK_RESERVE_MS, 45_000);
  assertEquals(STUDIO_INVOKE_BUDGET_MS, 180_000);
});

Deno.test("product truth runs exactly the Administration primary, then its fallback", () => {
  const chain = (primary: Parameters<typeof productTruthRouteChain>[0], fallback?: Parameters<typeof productTruthRouteChain>[1]) =>
    productTruthRouteChain(primary, fallback).map((route) => `${route.provider}:${route.model}:${route.thinkingLevel}`);

  // The reported configuration: Terra first, Muse Spark 1.3 Contributor as fallback.
  // No Luna hop is inserted ahead of it and neither model is substituted; only
  // the reasoning effort is capped for the Studio time budget.
  assertEquals(chain(ADMIN_TERRA, ADMIN_MUSE_CONTRIBUTOR), [
    "openai:gpt-5.6-terra:low",
    "meta:muse-spark-1.3-contributor:low",
  ]);
  assertEquals(chain(CHEAP_OPENAI_VISION_ROUTE), ["openai:gpt-5.6-luna:low"]);
  // The user's architecture: Meta Muse Contributor primary -> Luna high thinking fallback -> Terra 3rd fallback
  assertEquals(
    chain(FAST_PRODUCT_TRUTH_CONTRIBUTOR_ROUTE, [LUNA_HIGH_THINKING_VISION_ROUTE, OPENAI_TERRA_VISION_ROUTE]),
    [
      "meta:muse-spark-1.3-contributor:low",
      "openai:gpt-5.6-luna:high",
      "openai:gpt-5.6-terra:low",
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
  }), ["meta:muse-spark-1.3:low", "qwen:qwen3.8-max:none"]);
  // A fallback identical to the primary runs once.
  assertEquals(chain(OPENAI_TERRA_VISION_ROUTE, ADMIN_TERRA), ["openai:gpt-5.6-terra:low"]);
});

Deno.test("product-truth hop budget leaves the client wait a reserve", () => {
  // Spending the client's whole wait let the server still be working when the
  // browser aborted: the chain's clock starts after auth, the workspace RPC and
  // reference loading, so none of that is covered by the per-hop reserve.
  const reserved = STUDIO_INVOKE_BUDGET_MS - VISION_REQUEST_OVERHEAD_MS;
  assertEquals(productTruthGatewayBudgetMs(185_000), reserved);
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

Deno.test("60s leftover gateway still runs hop-2 after a full hop-1 timeout", async () => {
  const routes = productTruthRouteChain(ADMIN_TERRA, ADMIN_MUSE_CONTRIBUTOR);
  let clock = 0;
  const invoked: Array<{ model: string; timeoutMs: number; at: number }> = [];
  const result = await runVisionProviderChain({
    routes,
    purpose: "product_truth",
    gatewayBudgetMs: 60_000,
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
  assert(invoked[0].timeoutMs + invoked[1].timeoutMs <= 60_000);
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
  let releaseWrite: () => void = () => {};
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

  // 3 routes in 175s gateway budget: hop 1 leaves 90s reserve for hop 2 and hop 3
  const hop1Timeout = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 3,
    elapsedMs: 0,
    gatewayBudgetMs: 175_000,
  });
  // 175,000 - 5,000 reserve - 90,000 reserve for 2 fallbacks = 80,000ms
  assertEquals(hop1Timeout, 80_000);

  // hop 2 leaves 45s reserve for hop 3
  const hop2Timeout = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 2,
    elapsedMs: 20_000,
    gatewayBudgetMs: 175_000,
  });
  // 175,000 - 20,000 - 5,000 - 45,000 = 105,000ms
  assertEquals(hop2Timeout, 105_000);

  // hop 3 gets whatever is left of the wait
  const hop3Timeout = remainingVisionTimeoutMs({
    purpose: "product_truth",
    remainingRouteCount: 1,
    elapsedMs: 80_000,
    gatewayBudgetMs: 175_000,
  });
  // 175,000 - 80,000 - 5,000 = 90,000ms
  assertEquals(hop3Timeout, 90_000);
});

Deno.test("dualProtocolPrimaryTimeoutMs bounds the primary slice to preserve fallback time", () => {
  // 80s hop (primary Meta route in 3-tier chain) is bounded to 25s
  assertEquals(dualProtocolPrimaryTimeoutMs(80_000), 25_000);

  // 45s hop (reserve for fallback) allocates 45% = 20,250ms
  assertEquals(dualProtocolPrimaryTimeoutMs(45_000), 20_250);

  // 30s hop allocates 45% = 13,500ms
  assertEquals(dualProtocolPrimaryTimeoutMs(30_000), 13_500);

  // Hop with 20s allocates 45% = 9,000ms
  assertEquals(dualProtocolPrimaryTimeoutMs(20_000), 9_000);

  // Very small hop (<= 2 * VISION_HOP_MIN_MS = 16s) uses the entire hop timeout
  assertEquals(dualProtocolPrimaryTimeoutMs(16_000), 16_000);
  assertEquals(dualProtocolPrimaryTimeoutMs(15_000), 15_000);
});

Deno.test("clampProductTruthHopThinking clamps high reasoning when hop timeout is under 60s", () => {
  // Luna with high thinking under 45s fallback hop is clamped to low
  const lunaHigh = { provider: "openai" as const, model: "gpt-5.6-luna", thinkingLevel: "high" as const };
  assertEquals(clampProductTruthHopThinking(lunaHigh, 45_000), {
    provider: "openai",
    model: "gpt-5.6-luna",
    thinkingLevel: "low",
  });

  // Luna with high thinking under full 80s primary hop preserves high
  assertEquals(clampProductTruthHopThinking(lunaHigh, 80_000), lunaHigh);

  // Low, minimal, or none thinking are untouched under any timeout
  const lunaLow = { provider: "openai" as const, model: "gpt-5.6-luna", thinkingLevel: "low" as const };
  assertEquals(clampProductTruthHopThinking(lunaLow, 45_000), lunaLow);

  const museNone = { provider: "meta" as const, model: "muse-spark-1.3", thinkingLevel: "none" as const };
  assertEquals(clampProductTruthHopThinking(museNone, 30_000), museNone);
});


