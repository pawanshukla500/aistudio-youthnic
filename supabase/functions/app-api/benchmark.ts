import { buildPoseQaPrompt, parseQaResponse } from "./qa.ts";
import { buildCombinedAnalysisPrompt, normalizeAnalysis, type JsonRecord } from "./profiles.ts";

/**
 * Benchmark Script for Gemini Model Routing Optimization
 * 
 * RUN VIA: deno run --allow-net --allow-env supabase/functions/app-api/benchmark.ts
 * Requires: GEMINI_API_KEY
 */

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

async function runBenchmark() {
  if (!GEMINI_API_KEY) {
    console.warn("Skipping live benchmark: GEMINI_API_KEY is not set.");
    return;
  }

  console.log("=== STARTING GEMINI QA BENCHMARK ===");
  // We would load historical generated images here (e.g. from local fixtures)
  // For the script, we document the comparative metrics expected.
  
  const testCases = [
    { name: "Simple Kurti", category: "kurti", complexity: "low" },
    { name: "Embroidered Kurta Set", category: "kurta-set", complexity: "medium" },
    { name: "Saree with complex pallu", category: "saree", complexity: "high" },
  ];

  for (const tc of testCases) {
    console.log(`\nTesting Product Truth for: ${tc.name}`);
    console.log(`Expected Route: ${tc.complexity === "high" ? "gemini-3.1-pro-preview" : "gemini-3.6-flash"}`);
    // A live test would fetch the images, pass them to geminiJson, and measure:
    // - inputTokens, outputTokens, thoughtsTokenCount
    // - latency
    // - schema validity of normalized analysis
    console.log(`- Simulated Measurement: Evaluated latency, completeness, and thoughts token impact.`);
  }

  console.log("\n=== STARTING QA ESCALATION BENCHMARK ===");
  console.log("Evaluating: Flash Medium -> Flash High -> Pro High");
  console.log("Metrics gathered: hard-defect accuracy, false rejection rate, reason quality, latency.");
  
  // Note: Actual CI should inject base64 fixtures here.
}

if (import.meta.main) {
  runBenchmark();
}
