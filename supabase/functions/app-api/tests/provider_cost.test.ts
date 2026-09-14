import { assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import {
  ADMIN_DERIVED_COST_SOURCE,
  ANALYSIS_RUN_KINDS,
  attributeJobCostRuns,
  deriveAdminRateTable,
  extractVisionUsageAndCost,
  parseAdminRateRows,
  parseCostLineItem,
  providerUsage,
  rollupSessionCost,
  usageCostUsd,
} from "../lib/providerCost.ts";

Deno.test("image cost uses provider-reported GPT Image 2.5 Flare token rates", () => {
  const usage = providerUsage({
    input_tokens: 14065,
    output_tokens: 556,
    total_tokens: 14621,
    input_tokens_details: { text_tokens: 800, image_tokens: 13265 },
  });
  assertAlmostEquals(usageCostUsd("gpt-image-2.5-flare", usage), (800 * 5 + 13265 * 8 + 556 * 30) / 1_000_000, 1e-8);
});

Deno.test("vision cost subtracts cached tokens and uses Luna public rates", () => {
  const calculated = extractVisionUsageAndCost({
    usage: {
      prompt_tokens: 12000,
      completion_tokens: 800,
      prompt_tokens_details: { cached_tokens: 2000 },
    },
  }, "openai", "gpt-5.6-luna");
  assertEquals(calculated.cachedTok, 2000);
  assertAlmostEquals(calculated.costUsd, (10000 * 0.20 + 2000 * 0.02 + 800 * 1.20) / 1_000_000, 1e-8);
  assertEquals(calculated.costSource, "estimated_public_rates_2026-07");
});

Deno.test("vision cost prefers OpenAI admin-derived rates when present", () => {
  const calculated = extractVisionUsageAndCost({
    usage: { prompt_tokens: 10000, completion_tokens: 500 },
  }, "openai", "gpt-5.6-luna", {
    "gpt-5.6-luna": { input: 0.18, output: 1.05, cached: 0.018 },
  });
  assertAlmostEquals(calculated.costUsd, (10000 * 0.18 + 500 * 1.05) / 1_000_000, 1e-8);
  assertEquals(calculated.costSource, ADMIN_DERIVED_COST_SOURCE);
});

Deno.test("parseCostLineItem classifies billed OpenAI line items", () => {
  assertEquals(parseCostLineItem("gpt-5.6-luna, input").component, "input");
  assertEquals(parseCostLineItem("GPT-5.6 Luna cached input").component, "cached");
  assertEquals(parseCostLineItem("gpt-5.6-luna, output").model.includes("luna"), true);
  assertEquals(parseCostLineItem("Image models, gpt-image-2.5-flare, 1536x2048").component, "image");
});

Deno.test("deriveAdminRateTable builds $/1M from billed dollars and completion tokens", () => {
  const rates = deriveAdminRateTable({
    costResults: [
      { line_item: "gpt-5.6-luna, input", amount: { value: 2 } },
      { line_item: "gpt-5.6-luna, output", amount: { value: 1.5 } },
      { line_item: "gpt-5.6-luna, cached input", amount: { value: 0.2 } },
    ],
    completionResults: [
      { model: "gpt-5.6-luna", input_tokens: 10_200_000, output_tokens: 1_000_000, input_cached_tokens: 200_000 },
    ],
  });
  assertAlmostEquals(rates["gpt-5.6-luna"]?.input || 0, 0.2, 1e-8);
  assertAlmostEquals(rates["gpt-5.6-luna"]?.output || 0, 1.5, 1e-8);
  assertAlmostEquals(rates["gpt-5.6-luna"]?.cached || 0, 1.0, 1e-8);
});

Deno.test("parseAdminRateRows keeps the newest snapshot per model", () => {
  const rates = parseAdminRateRows([
    { dimension_key: "rate:gpt-5.6-luna:input", model: "gpt-5.6-luna", usage_date: "2026-09-01", usage_payload: { component: "input", usdPerMillion: 0.5 } },
    { dimension_key: "rate:gpt-5.6-luna:input", model: "gpt-5.6-luna", usage_date: "2026-09-13", usage_payload: { component: "input", usdPerMillion: 0.18 } },
    { dimension_key: "rate:gpt-5.6-luna:output", model: "gpt-5.6-luna", usage_date: "2026-09-13", usage_payload: { component: "output", usdPerMillion: 1.05 } },
  ]);
  assertEquals(rates["gpt-5.6-luna"]?.input, 0.18);
  assertEquals(rates["gpt-5.6-luna"]?.output, 1.05);
});

Deno.test("session rollup includes analysis and QA, and omits QA when it never ran", () => {
  const attributed = attributeJobCostRuns({
    jobId: "job_1",
    sessionId: "session_1",
    planningRequestId: "plan_1",
    analysisFingerprint: "fp-a",
    sessionCreatedAt: "2026-09-14T15:25:00.000Z",
    runs: [
      { id: "a1", run_kind: ANALYSIS_RUN_KINDS[0], cost_usd: 0.0117, session_id: "", planning_request_id: "", input_fingerprint: "fp-a", created_at: "2026-09-14T15:24:30.000Z", status: "completed" },
      { id: "g1", run_kind: "image_generation", cost_usd: 0.0974, job_id: "job_1", session_id: "session_1" },
      { id: "g2", run_kind: "image_generation", cost_usd: 0.1097, job_id: "job_1", session_id: "session_1" },
      { id: "other", run_kind: "image_generation", cost_usd: 9.99, job_id: "job_other", session_id: "session_other" },
    ],
  });
  const rolled = rollupSessionCost(attributed, 0.5);
  assertEquals(rolled.analysisRunCount, 1);
  assertEquals(rolled.qaRunCount, 0);
  assertEquals(rolled.generationRunCount, 2);
  assertAlmostEquals(rolled.analysisUsd, 0.0117, 1e-8);
  assertAlmostEquals(rolled.generationUsd, 0.2071, 1e-8);
  assertEquals(rolled.qaUsd, 0);
  assertAlmostEquals(rolled.totalUsd, 0.2188, 1e-8);
});

Deno.test("QA cost is included only when quality_assurance runs exist", () => {
  const rolled = rollupSessionCost([
    { run_kind: "image_generation", cost_usd: 0.10, job_id: "job_1" },
    { run_kind: "quality_assurance", cost_usd: 0.0042, job_id: "job_1", cost_source: ADMIN_DERIVED_COST_SOURCE },
  ]);
  assertAlmostEquals(rolled.qaUsd, 0.0042, 1e-8);
  assertAlmostEquals(rolled.totalUsd, 0.1042, 1e-8);
  assertEquals(rolled.usedAdminRates, true);
});

Deno.test("generation and QA from another job on the same planning request are excluded", () => {
  const attributed = attributeJobCostRuns({
    jobId: "job_new",
    sessionId: "session_new",
    planningRequestId: "plan_1",
    runs: [
      { id: "old-gen", run_kind: "image_generation", cost_usd: 0.40, job_id: "job_old", session_id: "session_old", planning_request_id: "plan_1" },
      { id: "old-qa", run_kind: "quality_assurance", cost_usd: 0.02, job_id: "job_old", session_id: "session_old", planning_request_id: "plan_1" },
      { id: "analysis", run_kind: "catalog_product_preflight", cost_usd: 0.01, planning_request_id: "plan_1" },
      { id: "new-gen", run_kind: "image_generation", cost_usd: 0.08, job_id: "job_new", session_id: "session_new", planning_request_id: "plan_1" },
    ],
  });
  const rolled = rollupSessionCost(attributed);
  assertEquals(rolled.generationRunCount, 1);
  assertEquals(rolled.qaRunCount, 0);
  assertAlmostEquals(rolled.analysisUsd, 0.01, 1e-8);
  assertAlmostEquals(rolled.generationUsd, 0.08, 1e-8);
});
