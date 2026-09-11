export type AdminAiPurpose = "product_truth" | "qa" | "image_generation";

export type AdminAiRegistryModel = {
  id: string;
  label: string;
  purposes: string[];
  thinkingLevels: string[];
  help?: string;
};

export type AdminAiRegistryEntry = {
  provider: string;
  configured: boolean;
  models: AdminAiRegistryModel[];
};

export type AdminAiPolicy = {
  purpose: AdminAiPurpose;
  primaryProvider: string;
  primaryModel: string;
  primaryThinking: string;
  fallbackEnabled: boolean;
  fallbackProvider?: string;
  fallbackModel?: string;
  fallbackThinking?: string;
  revision?: number;
  repairRequired?: boolean;
  repairMessage?: string;
};

export function modelsForProviderPurpose(
  registry: AdminAiRegistryEntry[],
  provider: string,
  purpose: AdminAiPurpose,
) {
  const entry = registry.find((item) => item.provider === provider);
  return (entry?.models || []).filter((model) => model.purposes.includes(purpose));
}

export function preferredModelId(provider: string, models: AdminAiRegistryModel[]) {
  const ids = models.map((model) => model.id);
  if (provider === "openai" && ids.includes("gpt-image-2.5-sunburst")) return "gpt-image-2.5-sunburst";
  if (provider === "openai" && ids.includes("gpt-5.6-luna")) return "gpt-5.6-luna";
  if (provider === "meta" && ids.includes("muse-spark-1.3")) return "muse-spark-1.3";
  if (provider === "gemini" && models.length && ids.includes("gemini-3.8-flash")) return "gemini-3.8-flash";
  return ids[0] || "";
}

const VISION_PROVIDER_PREFERENCE = ["gemini", "openai", "meta", "qwen"];
const FALLBACK_PROVIDER_PREFERENCE = ["openai", "gemini", "qwen", "meta"];

export function preferredConfiguredProvider(
  registry: AdminAiRegistryEntry[],
  purpose: AdminAiPurpose,
  options?: { exclude?: string; fallback?: boolean },
) {
  const order = purpose === "image_generation"
    ? ["openai"]
    : options?.fallback
    ? FALLBACK_PROVIDER_PREFERENCE
    : VISION_PROVIDER_PREFERENCE;
  const candidates = registry.filter((entry) =>
    entry.provider !== options?.exclude &&
    modelsForProviderPurpose(registry, entry.provider, purpose).length
  );
  return order
    .map((provider) => candidates.find((entry) => entry.provider === provider && entry.configured))
    .find(Boolean)
    || candidates.find((entry) => entry.configured)
    || candidates[0];
}

function thinkingFor(
  registry: AdminAiRegistryEntry[],
  provider: string,
  modelId: string,
  purpose: AdminAiPurpose,
  current?: string,
) {
  const levels = modelsForProviderPurpose(registry, provider, purpose)
    .find((model) => model.id === modelId)?.thinkingLevels || [];
  if (provider === "qwen") return "none";
  if (current && levels.includes(current)) return current;
  return levels[0] || "none";
}

/**
 * Drop cross-provider model bleed (e.g. OpenAI provider + gemini-3.6-flash)
 * and keep fallback on a cheap approved model for that provider.
 */
export function coerceAdminAiPolicy(
  policy: AdminAiPolicy,
  registry: AdminAiRegistryEntry[],
): AdminAiPolicy {
  const primaryModels = modelsForProviderPurpose(registry, policy.primaryProvider, policy.purpose);
  const primaryModel = primaryModels.some((model) => model.id === policy.primaryModel)
    ? policy.primaryModel
    : preferredModelId(policy.primaryProvider, primaryModels);
  const next: AdminAiPolicy = {
    ...policy,
    primaryModel,
    primaryThinking: thinkingFor(registry, policy.primaryProvider, primaryModel, policy.purpose, policy.primaryThinking),
  };
  if (policy.purpose === "image_generation" || !policy.fallbackEnabled) {
    return { ...next, fallbackEnabled: false, fallbackProvider: "", fallbackModel: "", fallbackThinking: "" };
  }
  const fallbackCandidates = registry.filter((entry) =>
    entry.provider !== next.primaryProvider &&
    modelsForProviderPurpose(registry, entry.provider, policy.purpose).length,
  );
  const fallbackProvider = next.fallbackProvider &&
      next.fallbackProvider !== next.primaryProvider &&
      fallbackCandidates.some((entry) => entry.provider === next.fallbackProvider)
    ? next.fallbackProvider
    : fallbackCandidates.find((entry) => entry.provider === "openai")?.provider ||
      fallbackCandidates.find((entry) => entry.configured)?.provider ||
      fallbackCandidates[0]?.provider ||
      "";
  const fallbackModels = modelsForProviderPurpose(registry, fallbackProvider, policy.purpose);
  const fallbackModel = fallbackModels.some((model) => model.id === next.fallbackModel)
    ? next.fallbackModel
    : preferredModelId(fallbackProvider, fallbackModels);
  const mismatched = Boolean(policy.fallbackProvider && policy.fallbackModel) &&
    (policy.fallbackProvider !== fallbackProvider || policy.fallbackModel !== fallbackModel);
  return {
    ...next,
    fallbackEnabled: Boolean(fallbackProvider && fallbackModel),
    fallbackProvider,
    fallbackModel,
    fallbackThinking: thinkingFor(registry, fallbackProvider, fallbackModel || "", policy.purpose, next.fallbackThinking),
    repairRequired: next.repairRequired || mismatched,
    repairMessage: mismatched
      ? "The stored fallback model did not belong to the selected fallback provider. It has been replaced with an approved model for that provider."
      : next.repairMessage,
  };
}
