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
      { id: "gpt-6.1-terra", label: "GPT 6.1 Terra", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "medium", "high"] },
      { id: "gpt-5.6-luna", label: "GPT 5.6 Luna", purposes: ["product_truth", "qa"], thinkingLevels: ["none", "low"] },
      { id: "gpt-5.6-sol", label: "GPT 5.6 Sol", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "high"] },
      { id: "gpt-image-2.6-sunburst", label: "GPT Image 2.6 Sunburst", purposes: ["image_generation"], thinkingLevels: ["none"] },
      { id: "gpt-image-2.6-flare", label: "GPT Image 2.6 Flare", purposes: ["image_generation"], thinkingLevels: ["none"] },
      { id: "gpt-image-2.5-flare-2026-09-08", label: "GPT Image 2.5 Flare (2026-09-08)", purposes: ["image_generation"], thinkingLevels: ["none"] },
      { id: "gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst", purposes: ["image_generation"], thinkingLevels: ["none"] },
      { id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare", purposes: ["image_generation"], thinkingLevels: ["none"] },
      { id: "gpt-image-2", label: "GPT Image 2", purposes: ["image_generation"], thinkingLevels: ["none"] },
    ],
  },
  {
    provider: "meta",
    configured: true,
    models: [
      { id: "muse-spark-1.3", label: "Muse Spark 1.3", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "high", "max"] },
      { id: "muse-spark-1.2", label: "Muse Spark 1.2", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "high"] },
      { id: "muse-spark-1.3-contributor", label: "Contributor 1.3", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "high"] },
      { id: "muse-spark-1.2-contributor", label: "Contributor 1.2", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "high"] },
    ],
  },
];

Deno.test("fallback model lists stay on the selected provider", () => {
  assertEquals(
    modelsForProviderPurpose(registry, "openai", "product_truth").map((model) => model.id),
    ["gpt-6.1-terra", "gpt-5.6-luna", "gpt-5.6-sol"],
  );
  assertEquals(
    modelsForProviderPurpose(registry, "openai", "product_truth").some((model) => model.id.startsWith("gemini-")),
    false,
  );
});

Deno.test("preferred vision models are Muse Spark 1.3 Contributor and GPT 6.1 Terra, falling back to Luna", () => {
  assertEquals(preferredModelId("meta", registry.find((entry) => entry.provider === "meta")!.models), "muse-spark-1.3-contributor");
  const openAiModels = modelsForProviderPurpose(registry, "openai", "product_truth");
  assertEquals(preferredModelId("openai", openAiModels), "gpt-6.1-terra");
  assertEquals(preferredModelId("openai", openAiModels, "qa"), "gpt-5.6-luna");
  assertEquals(preferredModelId("openai", openAiModels.filter((model) => model.id !== "gpt-6.1-terra")), "gpt-5.6-luna");
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
  assertEquals(coerced.fallbackModel, "gpt-6.1-terra");
  assertEquals(coerced.repairRequired, true);
});

Deno.test("product truth routing prefers Meta Muse Spark 1.3 Contributor as primary and OpenAI GPT 6.1 Terra as fallback when both are configured", () => {
  const primary = preferredConfiguredProvider(registry, "product_truth");
  assertEquals(primary?.provider, "meta");
  assertEquals(
    preferredModelId("meta", modelsForProviderPurpose(registry, "meta", "product_truth")),
    "muse-spark-1.3-contributor",
  );
  const fallback = preferredConfiguredProvider(registry, "product_truth", {
    exclude: primary?.provider,
    fallback: true,
  });
  assertEquals(fallback?.provider, "openai");
  assertEquals(
    preferredModelId("openai", modelsForProviderPurpose(registry, "openai", "product_truth")),
    "gpt-6.1-terra",
  );
});

Deno.test("preferred image generation model is 2.6 Sunburst over Flare and legacy GPT Image 2", () => {
  assertEquals(
    preferredModelId("openai", modelsForProviderPurpose(registry, "openai", "image_generation")),
    "gpt-image-2.6-sunburst",
  );
});

Deno.test("product truth policy coercion preserves Meta medium/high and GPT 6.1 Terra medium/high thinking", () => {
  const metaMediumPolicy = coerceAdminAiPolicy({
    purpose: "product_truth",
    primaryProvider: "meta",
    primaryModel: "muse-spark-1.3-contributor",
    primaryThinking: "medium",
    fallbackEnabled: true,
    fallbackProvider: "openai",
    fallbackModel: "gpt-6.1-terra",
    fallbackThinking: "medium",
  }, [
    ...registry.filter((r) => r.provider !== "meta"),
    {
      provider: "meta",
      configured: true,
      models: [
        { id: "muse-spark-1.3-contributor", label: "Contributor 1.3", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "medium", "high"] },
      ],
    },
  ]);
  assertEquals(metaMediumPolicy.primaryThinking, "medium");
  assertEquals(metaMediumPolicy.fallbackModel, "gpt-6.1-terra");
  assertEquals(metaMediumPolicy.fallbackThinking, "medium");

  const metaPolicy = coerceAdminAiPolicy({
    purpose: "product_truth",
    primaryProvider: "meta",
    primaryModel: "muse-spark-1.3",
    primaryThinking: "high",
    fallbackEnabled: true,
    fallbackProvider: "openai",
    fallbackModel: "gpt-6.1-terra",
    fallbackThinking: "high",
  }, [
    ...registry.filter((r) => r.provider !== "openai"),
    {
      provider: "openai",
      configured: true,
      models: [
        { id: "gpt-6.1-terra", label: "GPT 6.1 Terra", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "high"] },
        { id: "gpt-5.6-luna", label: "GPT 5.6 Luna", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "high"] },
      ],
    },
  ]);
  // Meta and GPT 6.1 Terra preserve high thinking in product_truth
  assertEquals(metaPolicy.primaryThinking, "high");
  assertEquals(metaPolicy.fallbackModel, "gpt-6.1-terra");
  assertEquals(metaPolicy.fallbackThinking, "high");
});

Deno.test("when Z.ai GLM 5.3 Flash is configured, product truth prefers Z.ai as fallback right after Meta Muse Spark", () => {
  const registryWithZai: AdminAiRegistryEntry[] = [
    ...registry,
    {
      provider: "zai",
      configured: true,
      models: [
        { id: "glm-5.3-flash", label: "GLM 5.3 Flash", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "medium", "high"] },
        { id: "glm-5.3-flashx", label: "GLM 5.3 FlashX", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "medium", "high"] },
      ],
    },
  ];
  const primary = preferredConfiguredProvider(registryWithZai, "product_truth");
  assertEquals(primary?.provider, "meta");
  const fallback = preferredConfiguredProvider(registryWithZai, "product_truth", {
    exclude: primary?.provider,
    fallback: true,
  });
  assertEquals(fallback?.provider, "zai");
  assertEquals(
    preferredModelId("zai", modelsForProviderPurpose(registryWithZai, "zai", "product_truth")),
    "glm-5.3-flash",
  );
  const coerced = coerceAdminAiPolicy({
    purpose: "product_truth",
    primaryProvider: "meta",
    primaryModel: "muse-spark-1.3-contributor",
    primaryThinking: "medium",
    fallbackEnabled: true,
    fallbackProvider: "zai",
    fallbackModel: "glm-5.3-flash",
    fallbackThinking: "medium",
  }, registryWithZai);
  assertEquals(coerced.fallbackProvider, "zai");
  assertEquals(coerced.fallbackModel, "glm-5.3-flash");
  assertEquals(coerced.fallbackThinking, "medium");
});

Deno.test("coerceAdminAiPolicy skips unconfigured OpenAI and picks configured fallback provider", () => {
  const partialRegistry: AdminAiRegistryEntry[] = [
    {
      provider: "meta",
      configured: true,
      models: [
        { id: "muse-spark-1.3-contributor", label: "Contributor 1.3", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "medium", "high"] },
      ],
    },
    {
      provider: "openai",
      configured: false,
      models: [
        { id: "gpt-6.1-terra", label: "GPT 6.1 Terra", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "medium", "high"] },
      ],
    },
    {
      provider: "gemini",
      configured: true,
      models: [
        { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", purposes: ["product_truth", "qa"], thinkingLevels: ["low", "medium", "high"] },
      ],
    },
  ];
  const coerced = coerceAdminAiPolicy({
    purpose: "product_truth",
    primaryProvider: "meta",
    primaryModel: "muse-spark-1.3-contributor",
    primaryThinking: "medium",
    fallbackEnabled: true,
    fallbackProvider: "meta",
    fallbackModel: "muse-spark-1.3-contributor",
    fallbackThinking: "medium",
  }, partialRegistry);
  assertEquals(coerced.fallbackProvider, "gemini");
  assertEquals(coerced.fallbackModel, "gemini-3.8-flash");
});
