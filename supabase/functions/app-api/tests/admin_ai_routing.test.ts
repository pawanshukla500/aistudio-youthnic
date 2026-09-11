import { assertEquals } from "jsr:@std/assert@1";
import { coerceAdminAiPolicy, modelsForProviderPurpose, preferredConfiguredProvider, preferredModelId, type AdminAiRegistryEntry } from "../../../../src/features/admin/aiRouting.ts";

const registry: AdminAiRegistryEntry[] = [
  {
    provider: "gemini",
    configured: true,
    models: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "medium", "high"] },
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "medium", "high"] },
    ],
  },
  {
    provider: "openai",
    configured: true,
    models: [
      { id: "gpt-5.6-luna", label: "GPT 5.6 Luna", purposes: ["product_truth", "qa"], thinkingLevels: ["none", "low"] },
      { id: "gpt-5.6-sol", label: "GPT 5.6 Sol", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "high"] },
      { id: "gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst", purposes: ["image_generation"], thinkingLevels: ["none"] },
      { id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare", purposes: ["image_generation"], thinkingLevels: ["none"] },
      { id: "gpt-image-2", label: "GPT Image 2", purposes: ["image_generation"], thinkingLevels: ["none"] },
    ],
  },
  {
    provider: "meta",
    configured: true,
    models: [
      { id: "muse-spark-1.3", label: "Muse Spark 1.3", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "max"] },
      { id: "muse-spark-1.2", label: "Muse Spark 1.2", purposes: ["product_truth", "qa"], thinkingLevels: ["low"] },
      { id: "muse-spark-1.3-contributor", label: "Contributor", purposes: ["product_truth", "qa"], thinkingLevels: ["low"] },
    ],
  },
];

Deno.test("fallback model lists stay on the selected provider", () => {
  assertEquals(
    modelsForProviderPurpose(registry, "openai", "product_truth").map((model) => model.id),
    ["gpt-5.6-luna", "gpt-5.6-sol"],
  );
  assertEquals(
    modelsForProviderPurpose(registry, "openai", "product_truth").some((model) => model.id.startsWith("gemini-")),
    false,
  );
});

Deno.test("preferred vision models are Muse 1.3 and Luna, not Sol or Contributor", () => {
  assertEquals(preferredModelId("meta", registry.find((entry) => entry.provider === "meta")!.models), "muse-spark-1.3");
  assertEquals(preferredModelId("openai", modelsForProviderPurpose(registry, "openai", "product_truth")), "gpt-5.6-luna");
});

Deno.test("OpenAI fallback cannot keep a Gemini model id", () => {
  const coerced = coerceAdminAiPolicy({
    purpose: "product_truth",
    primaryProvider: "gemini",
    primaryModel: "gemini-3.8-flash",
    primaryThinking: "medium",
    fallbackEnabled: true,
    fallbackProvider: "openai",
    fallbackModel: "gemini-3.6-flash",
    fallbackThinking: "medium",
  }, registry);
  assertEquals(coerced.fallbackProvider, "openai");
  assertEquals(coerced.fallbackModel, "gpt-5.6-luna");
  assertEquals(coerced.repairRequired, true);
});

Deno.test("new vision routing prefers Gemini Flash then Luna when both are configured", () => {
  const primary = preferredConfiguredProvider(registry, "product_truth");
  assertEquals(primary?.provider, "gemini");
  assertEquals(preferredModelId("gemini", primary!.models), "gemini-3.8-flash");
  const fallback = preferredConfiguredProvider(registry, "product_truth", {
    exclude: primary?.provider,
    fallback: true,
  });
  assertEquals(fallback?.provider, "openai");
  assertEquals(
    preferredModelId("openai", modelsForProviderPurpose(registry, "openai", "product_truth")),
    "gpt-5.6-luna",
  );
});

Deno.test("preferred image generation model is Sunburst over Flare and legacy GPT Image 2", () => {
  assertEquals(
    preferredModelId("openai", modelsForProviderPurpose(registry, "openai", "image_generation")),
    "gpt-image-2.5-sunburst",
  );
});
