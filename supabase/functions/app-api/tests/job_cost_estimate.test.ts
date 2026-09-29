import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { AI_MODEL_REGISTRY, DEFAULT_IMAGE_GENERATION_ROUTE } from "../lib/aiModelPolicy.ts";
import { estimateJobCostUsd, typicalImageUsage, type JobCostEstimateInput } from "../lib/providerCost.ts";

const apiSource = Deno.readTextFileSync(new URL("../index.ts", import.meta.url)).replace(/\r\n/g, "\n");

// A default Studio shoot: six poses, medium quality, 3:4 at 2K on the default model, QA off.
const DEFAULT_SHOOT: JobCostEstimateInput = {
  imageModel: DEFAULT_IMAGE_GENERATION_ROUTE.model,
  quality: "medium",
  size: "1536x2048",
  poseCount: 6,
  poseQa: false,
};
const LUNA_QA = { provider: "openai", model: "gpt-5.6-luna" };

function estimate(overrides: Partial<JobCostEstimateInput> = {}) {
  return estimateJobCostUsd({ ...DEFAULT_SHOOT, ...overrides });
}

Deno.test("a default shoot is priced from the image model's token rates, not a flat $0.25", () => {
  // Flare: $5 text in, $8 image in, $30 image out per 1M. Medium at 1536x2048 is 3x the 1024x1024 frame.
  const perPose = (4_000 * 5 + 18_500 * 8 + 1056 * 3 * 30) / 1_000_000;
  assertAlmostEquals(estimate(), 6 * perPose, 1e-6);
  assert(estimate() !== 0.25);
});

Deno.test("the estimate scales with the number of enabled poses", () => {
  assertEquals(estimate({ poseCount: 0 }), 0);
  assertAlmostEquals(estimate({ poseCount: 6 }), 6 * estimate({ poseCount: 1 }), 1e-6);
  assertAlmostEquals(estimate({ poseCount: 6 }), 2 * estimate({ poseCount: 3 }), 1e-6);
});

Deno.test("higher image quality costs more", () => {
  const low = estimate({ quality: "low" });
  const medium = estimate({ quality: "medium" });
  const high = estimate({ quality: "high" });
  assert(low < medium && medium < high);
  // Only output tokens differ between qualities.
  assertAlmostEquals(high - medium, 6 * (4160 - 1056) * 3 * 30 / 1_000_000, 1e-6);
});

Deno.test("a larger frame costs more, in proportion to its output tokens", () => {
  assert(estimate({ size: "768x1024" }) < estimate({ size: "1536x2048" }));
  assertEquals(typicalImageUsage("medium", "1024x1024").outputTokens, 1056);
  assertEquals(typicalImageUsage("medium", "1024x1536").outputTokens, 1584);
  assertEquals(typicalImageUsage("high", "1536x2048").outputTokens, 12480);
});

Deno.test("pose QA adds one pass per pose, priced on the organization's QA route", () => {
  const withoutQa = estimate();
  const lunaQa = estimate({ poseQa: true, qaRoute: LUNA_QA });
  assertAlmostEquals(lunaQa - withoutQa, 6 * (15_000 * 0.20 + 2_000 * 1.20) / 1_000_000, 1e-6);
  const flashQa = estimate({ poseQa: true, qaRoute: { provider: "gemini", model: "gemini-3.8-flash" } });
  assertAlmostEquals(flashQa - withoutQa, 6 * (15_000 * 0.15 + 2_000 * 0.60) / 1_000_000, 1e-6);
});

Deno.test("QA is not charged when it is off, even with a QA route on hand", () => {
  assertEquals(estimate({ poseQa: false, qaRoute: LUNA_QA }), estimate());
  assertEquals(estimate({ poseQa: true, qaRoute: null }), estimate());
});

Deno.test("the estimate follows the image model saved in Administration", () => {
  assert(estimate({ imageModel: "gpt-image-2" }) > estimate());
  assert(estimate({ imageModel: "gpt-image-1-mini" }) < estimate());
});

Deno.test("every approved image model has a price, so no job is estimated at zero", () => {
  for (const models of Object.values(AI_MODEL_REGISTRY)) {
    for (const model of models.image_generation || []) {
      assert(estimate({ imageModel: model }) > 0, `${model} has no image token rates`);
    }
  }
});

Deno.test("admin-derived rates replace public rates, as they do for actual cost", () => {
  const adminRates = { [DEFAULT_IMAGE_GENERATION_ROUTE.model]: { imageOutput: 15 } };
  const perPose = (4_000 * 5 + 18_500 * 8 + 1056 * 3 * 15) / 1_000_000;
  assertAlmostEquals(estimate({ adminRates }), 6 * perPose, 1e-6);
});

Deno.test("an unknown quality is priced as medium and an unreadable size as 1024x1024", () => {
  assertEquals(estimate({ quality: "auto" }), estimate({ quality: "medium" }));
  assertEquals(estimate({ size: "" }), estimate({ size: "1024x1024" }));
});

Deno.test("both generation_jobs inserts store the computed estimate", () => {
  assertEquals(/estimated_cost_usd:\s*\d/.test(apiSource), false);
  assertEquals(apiSource.match(/estimated_cost_usd: estimatedCostUsd,/g)?.length, 2);
  assertEquals(apiSource.match(/await estimateGenerationJobCostUsd\(\{/g)?.length, 2);
  // Priced at the size the worker will request, on the QA route validatePose resolves.
  assert(apiSource.includes("size: normalizeImageSize(args.aspectRatio, args.imageSize, args.model),"));
  assert(apiSource.includes(`qaRoute = await resolveVisionPolicy(args.organizationId, { purpose: "qa" });`));
});
