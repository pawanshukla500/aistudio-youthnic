/**
 * Provider token pricing and session cost rollup.
 *
 * OpenAI Admin APIs expose billed dollars and token totals by day/model, not by
 * request. Per-job History cost is therefore: recorded token usage for this
 * session (analysis + image generation + QA when it ran), priced with
 * Admin-derived $/1M rates when those snapshots exist, otherwise public rates.
 */

export type JsonMap = Record<string, unknown>;

export type ProviderUsage = {
  inputTokens: number;
  inputTextTokens: number;
  inputImageTokens: number;
  outputTokens: number;
  totalTokens: number;
  providerReported: boolean;
  raw: JsonMap;
};

export type VisionTokenRates = {
  input: number;
  output: number;
  cached: number;
  version: string;
  source: string;
};

export type ImageTokenRates = {
  textInput: number;
  imageInput: number;
  imageOutput: number;
};

export type AdminModelRates = {
  input?: number;
  output?: number;
  cached?: number;
  textInput?: number;
  imageInput?: number;
  imageOutput?: number;
};

export type AdminRateTable = Record<string, AdminModelRates>;

export type VisionUsageCost = {
  inTok: number;
  outTok: number;
  cachedTok: number;
  totalTok: number;
  thoughtsTok: number;
  costUsd: number;
  costSource: string;
  pricing: VisionTokenRates | null;
};

export const IMAGE_TOKEN_RATES: Record<string, ImageTokenRates> = {
  "gpt-image-2.5-flare-2026-09-08": { textInput: 5.0, imageInput: 8.0, imageOutput: 30.0 },
  "gpt-image-2.5-flare": { textInput: 5.0, imageInput: 8.0, imageOutput: 30.0 },
  "gpt-image-2.5-sunburst": { textInput: 5.0, imageInput: 8.0, imageOutput: 30.0 },
  "gpt-image-2": { textInput: 2.5, imageInput: 20, imageOutput: 50 },
  "gpt-image-1.5": { textInput: 2.5, imageInput: 20, imageOutput: 50 },
  "gpt-image-1": { textInput: 2.5, imageInput: 20, imageOutput: 50 },
  "gpt-image-1-mini": { textInput: 0.15, imageInput: 0.15, imageOutput: 0.6 },
  "reve-2.1-image": { textInput: 2.5, imageInput: 20, imageOutput: 50 },
};

export const GEMINI_PRICING: Record<string, VisionTokenRates> = {
  "gemini-3.8-flash": { input: 0.15, output: 0.60, cached: 0.0375, version: "2025-01", source: "google_standard_flash" },
  "gemini-3.6-flash": { input: 0.15, output: 0.60, cached: 0.0375, version: "2024-08", source: "google_standard_flash" },
  "gemini-2.5-flash": { input: 0.15, output: 0.60, cached: 0.0375, version: "2025-06", source: "google_standard_flash" },
  "gemini-3.1-pro-preview": { input: 1.25, output: 5.00, cached: 0.3125, version: "2024-08", source: "google_standard_pro" },
  "gemini-3.1-pro": { input: 1.25, output: 5.00, cached: 0.3125, version: "2024-08", source: "google_standard_pro" },
};

export const OPENAI_VISION_PRICING: Record<string, VisionTokenRates> = {
  "gpt-5.6-luna": { input: 0.20, output: 1.20, cached: 0.02, version: "2026-07", source: "openai_standard_luna" },
  "gpt-5.6-sol": { input: 2.50, output: 10.00, cached: 0.25, version: "2025-01", source: "openai_standard_sol" },
  "gpt-5.6-terra": { input: 1.25, output: 5.00, cached: 0.125, version: "2025-01", source: "openai_standard_terra" },
};

export const META_VISION_PRICING: Record<string, VisionTokenRates> = {
  "muse-spark-1.3": { input: 1.25, output: 4.25, cached: 0.125, version: "2026-09", source: "meta_standard_muse" },
  "muse-spark-1.2": { input: 1.25, output: 4.25, cached: 0.125, version: "2026-09", source: "meta_standard_muse" },
  "muse-spark-1.3-contributor": { input: 0.10, output: 0.20, cached: 0.01, version: "2026-09", source: "meta_contributor_muse" },
};

export const ANALYSIS_RUN_KINDS = ["product_reference_analysis", "catalog_product_preflight"] as const;
export const GENERATION_RUN_KIND = "image_generation";
export const QA_RUN_KIND = "quality_assurance";
export const ADMIN_DERIVED_COST_SOURCE = "openai_admin_derived_rates";
export const ADMIN_RATE_DIMENSION_PREFIX = "rate:";
export const COMPLETIONS_DIMENSION_PREFIX = "completions:";

export type CostBucket = "analysis" | "generation" | "qa" | "other";

export type CostRun = {
  id?: string;
  run_kind: string;
  cost_usd?: number | null;
  job_id?: string | null;
  session_id?: string | null;
  planning_request_id?: string | null;
  input_fingerprint?: string | null;
  created_at?: string | null;
  status?: string | null;
  pose_index?: number | null;
  cost_source?: string | null;
};

export type SessionCostRollup = {
  analysisUsd: number;
  generationUsd: number;
  qaUsd: number;
  otherUsd: number;
  totalUsd: number;
  analysisRunCount: number;
  generationRunCount: number;
  qaRunCount: number;
  usedAiRuns: boolean;
  usedAdminRates: boolean;
};

export function roundUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

export function normalizeModelKey(model: string) {
  return String(model || "unknown").trim().toLowerCase();
}

export function costBucket(runKind: string): CostBucket {
  if ((ANALYSIS_RUN_KINDS as readonly string[]).includes(runKind)) return "analysis";
  if (runKind === GENERATION_RUN_KIND) return "generation";
  if (runKind === QA_RUN_KIND) return "qa";
  return "other";
}

function record(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

export function providerUsage(value: unknown): ProviderUsage {
  const raw = record(value);
  const details = record(raw.input_tokens_details);
  const inputTokens = numberValue(raw.input_tokens);
  const outputTokens = numberValue(raw.output_tokens);
  return {
    inputTokens,
    inputTextTokens: numberValue(details.text_tokens),
    inputImageTokens: numberValue(details.image_tokens),
    outputTokens,
    totalTokens: numberValue(raw.total_tokens) || inputTokens + outputTokens,
    providerReported: Boolean(inputTokens || outputTokens || raw.total_tokens),
    raw,
  };
}

function publicVisionPricing(provider: string, model: string): VisionTokenRates | null {
  if (provider === "gemini") {
    return GEMINI_PRICING[model] || GEMINI_PRICING["gemini-3.8-flash"] || GEMINI_PRICING["gemini-3.6-flash"] || null;
  }
  if (provider === "openai") {
    return OPENAI_VISION_PRICING[model] || OPENAI_VISION_PRICING["gpt-5.6-luna"] || null;
  }
  if (provider === "meta") {
    return META_VISION_PRICING[model] || META_VISION_PRICING["muse-spark-1.3"] || null;
  }
  return null;
}

function lookupAdminRates(model: string, adminRates?: AdminRateTable): AdminModelRates | undefined {
  if (!adminRates) return undefined;
  const needle = normalizeModelKey(model);
  const exact = adminRates[needle];
  if (exact) return exact;
  const match = Object.keys(adminRates)
    .sort((left, right) => right.length - left.length)
    .find((key) => needle.includes(key) || key.includes(needle));
  return match ? adminRates[match] : undefined;
}

export function extractVisionUsageAndCost(
  raw: JsonMap,
  provider: string,
  model: string,
  adminRates?: AdminRateTable,
): VisionUsageCost {
  const usageMeta = record(raw.usageMetadata || raw.usage || raw);
  const inTok = Number(usageMeta.promptTokenCount ?? usageMeta.prompt_tokens ?? usageMeta.input_tokens ?? 0) || 0;
  const outTok = Number(usageMeta.candidatesTokenCount ?? usageMeta.completion_tokens ?? usageMeta.output_tokens ?? 0) || 0;
  const totalTok = Number(usageMeta.totalTokenCount ?? usageMeta.total_tokens ?? (inTok + outTok)) || inTok + outTok;
  const details = record(usageMeta.completion_tokens_details);
  const promptDetails = record(usageMeta.prompt_tokens_details || usageMeta.input_tokens_details);
  const thoughtsTok = Number(usageMeta.thoughtsTokenCount ?? details.reasoning_tokens ?? 0) || 0;
  const cachedTok = Number(
    usageMeta.cachedContentTokenCount ??
      usageMeta.cached_content_token_count ??
      promptDetails.cached_tokens ??
      0,
  ) || 0;

  const publicPricing = publicVisionPricing(provider, model);
  const admin = lookupAdminRates(model, adminRates);
  const pricing: VisionTokenRates | null = publicPricing
    ? {
      ...publicPricing,
      input: admin?.input ?? publicPricing.input,
      output: admin?.output ?? publicPricing.output,
      cached: admin?.cached ?? publicPricing.cached,
    }
    : admin?.input || admin?.output
    ? {
      input: admin.input || 0,
      output: admin.output || 0,
      cached: admin.cached ?? (admin.input || 0) * 0.1,
      version: "admin",
      source: ADMIN_DERIVED_COST_SOURCE,
    }
    : null;

  const uncachedInput = Math.max(0, inTok - Math.max(0, cachedTok));
  const costUsd = pricing
    ? roundUsd(
      (uncachedInput * pricing.input + Math.max(0, cachedTok) * pricing.cached + outTok * pricing.output) / 1_000_000,
    )
    : 0;
  const usedAdmin = Boolean(admin && (admin.input || admin.output || admin.cached));
  const costSource = !pricing
    ? "provider_cost_not_available"
    : usedAdmin
    ? ADMIN_DERIVED_COST_SOURCE
    : `estimated_public_rates_${pricing.version}`;

  return { inTok, outTok, cachedTok, totalTok, thoughtsTok, costUsd, costSource, pricing };
}

export function usageCostUsd(model: string, usage: ProviderUsage, adminRates?: AdminRateTable) {
  if (!usage.providerReported) return 0;
  const publicRates = IMAGE_TOKEN_RATES[model];
  const admin = lookupAdminRates(model, adminRates);
  const rates: ImageTokenRates | undefined = publicRates
    ? {
      textInput: admin?.textInput ?? publicRates.textInput,
      imageInput: admin?.imageInput ?? publicRates.imageInput,
      imageOutput: admin?.imageOutput ?? publicRates.imageOutput,
    }
    : admin?.textInput || admin?.imageInput || admin?.imageOutput
    ? {
      textInput: admin?.textInput || 0,
      imageInput: admin?.imageInput || 0,
      imageOutput: admin?.imageOutput || 0,
    }
    : undefined;
  if (!rates) return 0;
  const classifiedInput = usage.inputTextTokens + usage.inputImageTokens;
  const unclassifiedInput = Math.max(0, usage.inputTokens - classifiedInput);
  return roundUsd(
    (
      usage.inputTextTokens * rates.textInput +
      (usage.inputImageTokens + unclassifiedInput) * rates.imageInput +
      usage.outputTokens * rates.imageOutput
    ) / 1_000_000,
  );
}

export type ParsedCostLineItem = {
  model: string;
  component: "input" | "output" | "cached" | "image" | "other";
};

const KNOWN_MODEL_KEYS = [
  ...Object.keys(IMAGE_TOKEN_RATES),
  ...Object.keys(OPENAI_VISION_PRICING),
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
].map(normalizeModelKey).sort((left, right) => right.length - left.length);

export function parseCostLineItem(lineItem: string): ParsedCostLineItem {
  const raw = String(lineItem || "").trim();
  const lower = raw.toLowerCase();
  const known = KNOWN_MODEL_KEYS.find((key) => lower.includes(key));
  const commaModel = raw.split(",")[0]?.trim().toLowerCase() || "";
  const model = known || (commaModel.includes("gpt-") || commaModel.includes("gemini") || commaModel.includes("muse")
    ? commaModel
    : "unknown");
  if (/\bcached\b|\bcache\b/.test(lower)) return { model, component: "cached" };
  if (/\boutput\b|\bcompletion\b/.test(lower)) return { model, component: "output" };
  if (/\bimage\b|gpt-image/.test(lower) && !/\binput\b/.test(lower)) return { model, component: "image" };
  if (/\binput\b|\bprompt\b/.test(lower)) return { model, component: "input" };
  if (lower.includes("gpt-image") || lower.includes("image models")) return { model, component: "image" };
  return { model, component: "other" };
}

export type AdminUsageResult = {
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  input_cached_tokens?: number;
  images?: number;
  num_model_requests?: number;
  size?: string;
  source?: string;
  project_id?: string;
};

export type AdminCostResult = {
  line_item?: string;
  amount?: { value?: number; currency?: string } | number;
  project_id?: string;
};

const MIN_TOKENS_FOR_RATE = 10_000;

function billedAmount(amount: AdminCostResult["amount"]) {
  if (typeof amount === "number") return Number(amount) || 0;
  return Number(amount?.value || 0) || 0;
}

export function deriveAdminRateTable(args: {
  costResults: AdminCostResult[];
  completionResults: AdminUsageResult[];
  imageResults?: AdminUsageResult[];
}): AdminRateTable {
  const billed = new Map<string, { input: number; output: number; cached: number; image: number }>();
  const bumpBilled = (model: string, component: ParsedCostLineItem["component"], usd: number) => {
    const key = normalizeModelKey(model);
    const current = billed.get(key) || { input: 0, output: 0, cached: 0, image: 0 };
    if (component === "input") current.input += usd;
    else if (component === "output") current.output += usd;
    else if (component === "cached") current.cached += usd;
    else if (component === "image") current.image += usd;
    billed.set(key, current);
  };
  for (const result of args.costResults) {
    const parsed = parseCostLineItem(String(result.line_item || ""));
    bumpBilled(parsed.model, parsed.component, billedAmount(result.amount));
  }

  const tokens = new Map<string, { input: number; output: number; cached: number }>();
  const addTokens = (result: AdminUsageResult) => {
    const key = normalizeModelKey(String(result.model || "unknown"));
    const current = tokens.get(key) || { input: 0, output: 0, cached: 0 };
    current.input += Number(result.input_tokens || 0);
    current.output += Number(result.output_tokens || 0);
    current.cached += Number(result.input_cached_tokens || 0);
    tokens.set(key, current);
  };
  for (const result of args.completionResults) addTokens(result);
  for (const result of args.imageResults || []) addTokens(result);

  const matchBilled = (model: string) =>
    billed.get(model) || [...billed.entries()].find(([key]) => model.includes(key) || key.includes(model))?.[1];

  const table: AdminRateTable = {};
  const applyVisionRates = (model: string, token: { input: number; output: number; cached: number }, money: { input: number; output: number; cached: number; image: number }) => {
    const uncached = Math.max(0, token.input - token.cached);
    const rates: AdminModelRates = { ...(table[model] || {}) };
    if (money.input > 0 && uncached >= MIN_TOKENS_FOR_RATE) rates.input = money.input / uncached * 1_000_000;
    if (money.output > 0 && token.output >= MIN_TOKENS_FOR_RATE) rates.output = money.output / token.output * 1_000_000;
    if (money.cached > 0 && token.cached >= MIN_TOKENS_FOR_RATE) rates.cached = money.cached / token.cached * 1_000_000;
    if (rates.input || rates.output || rates.cached || rates.textInput || rates.imageInput || rates.imageOutput) table[model] = rates;
  };

  for (const [model, token] of tokens) {
    const money = matchBilled(model);
    if (money) applyVisionRates(model, token, money);
  }

  for (const [model, money] of billed) {
    const publicImage = IMAGE_TOKEN_RATES[model] || [...Object.entries(IMAGE_TOKEN_RATES)].find(([key]) => model.includes(key) || key.includes(model))?.[1];
    if (!publicImage) continue;
    const token = tokens.get(model) || [...tokens.entries()].find(([key]) => model.includes(key) || key.includes(model))?.[1] || { input: 0, output: 0, cached: 0 };
    const uncached = Math.max(0, token.input - token.cached);
    const rates: AdminModelRates = { ...(table[model] || {}) };
    if (money.input > 0 && uncached >= MIN_TOKENS_FOR_RATE) rates.textInput = money.input / uncached * 1_000_000;
    if (money.output > 0 && token.output >= MIN_TOKENS_FOR_RATE) rates.imageOutput = money.output / token.output * 1_000_000;
    const tokenVolume = token.input + token.output;
    if (money.image > 0 && tokenVolume >= MIN_TOKENS_FOR_RATE) {
      const estimated = (
        token.input * publicImage.imageInput +
        token.output * publicImage.imageOutput
      ) / 1_000_000;
      if (estimated > 0) {
        const scale = money.image / estimated;
        rates.textInput = publicImage.textInput * scale;
        rates.imageInput = publicImage.imageInput * scale;
        rates.imageOutput = publicImage.imageOutput * scale;
      }
    }
    if (rates.textInput || rates.imageInput || rates.imageOutput) table[model] = { ...table[model], ...rates };
  }
  return table;
}

export function adminRateSnapshots(usageDate: string, rates: AdminRateTable, openaiProjectId = "") {
  return Object.entries(rates).flatMap(([model, rate]) =>
    (["input", "output", "cached", "textInput", "imageInput", "imageOutput"] as const)
      .filter((component) => Number(rate[component] || 0) > 0)
      .map((component) => ({
        usage_date: usageDate,
        dimension_key: `${ADMIN_RATE_DIMENSION_PREFIX}${model}:${component}`,
        model,
        image_size: "n/a",
        source: "admin_derived_rate",
        openai_project_id: openaiProjectId,
        image_count: 0,
        request_count: 0,
        actual_cost_usd: 0,
        currency: "usd",
        usage_payload: {
          component,
          usdPerMillion: rate[component],
          source: ADMIN_DERIVED_COST_SOURCE,
        },
        cost_payload: {},
        synced_at: new Date().toISOString(),
      })),
  );
}

export function parseAdminRateRows(rows: Array<{ dimension_key?: string; usage_date?: string; usage_payload?: unknown; model?: string }>): AdminRateTable {
  const newest = new Map<string, { rates: AdminModelRates; componentDates: Record<string, string> }>();
  for (const row of rows) {
    const key = String(row.dimension_key || "");
    if (!key.startsWith(ADMIN_RATE_DIMENSION_PREFIX)) continue;
    const payload = record(row.usage_payload);
    const component = String(payload.component || key.split(":").at(-1) || "");
    const usdPerMillion = Number(payload.usdPerMillion || 0);
    if (!usdPerMillion) continue;
    const model = normalizeModelKey(String(row.model || key.slice(ADMIN_RATE_DIMENSION_PREFIX.length).split(":")[0] || "unknown"));
    const date = String(row.usage_date || "");
    const current = newest.get(model) || { rates: {}, componentDates: {} };
    const previousDate = current.componentDates[component] || "";
    if (previousDate && date < previousDate) continue;
    const next = { ...current.rates };
    if (component === "input") next.input = usdPerMillion;
    else if (component === "output") next.output = usdPerMillion;
    else if (component === "cached") next.cached = usdPerMillion;
    else if (component === "textInput") next.textInput = usdPerMillion;
    else if (component === "imageInput") next.imageInput = usdPerMillion;
    else if (component === "imageOutput") next.imageOutput = usdPerMillion;
    else continue;
    newest.set(model, {
      rates: next,
      componentDates: { ...current.componentDates, [component]: date },
    });
  }
  return Object.fromEntries([...newest.entries()].map(([model, value]) => [model, value.rates]));
}

function nonempty(value: unknown) {
  const text = String(value || "").trim();
  return text ? text : "";
}

function isNearSession(runCreatedAt: string | null | undefined, sessionCreatedAt: string | null | undefined) {
  if (!runCreatedAt || !sessionCreatedAt) return false;
  const runMs = Date.parse(runCreatedAt);
  const sessionMs = Date.parse(sessionCreatedAt);
  if (!Number.isFinite(runMs) || !Number.isFinite(sessionMs)) return false;
  return runMs <= sessionMs + 10 * 60_000 && runMs >= sessionMs - 2 * 60 * 60_000;
}

function runStatus(run: CostRun) {
  return String(run.status || "").trim().toLowerCase();
}

export function isExecutedQaRun(run: CostRun) {
  if (Number(run.cost_usd || 0) > 0) return true;
  const status = runStatus(run);
  return Boolean(status) && status !== "failed" && status !== "queued";
}

export function isCountableGenerationRun(run: CostRun) {
  if (Number(run.cost_usd || 0) > 0) return true;
  const status = runStatus(run);
  return status !== "failed" && status !== "queued";
}

export function attributeJobCostRuns(args: {
  runs: CostRun[];
  jobId: string;
  sessionId: string;
  planningRequestId?: string;
  analysisFingerprint?: string;
  sessionCreatedAt?: string;
}): CostRun[] {
  const jobId = nonempty(args.jobId);
  const sessionId = nonempty(args.sessionId);
  const planningRequestId = nonempty(args.planningRequestId);
  const fingerprint = nonempty(args.analysisFingerprint);
  const byId = new Map<string, CostRun>();
  const remember = (run: CostRun) => {
    const id = nonempty(run.id) || `${run.run_kind}:${run.created_at}:${run.cost_usd}:${run.job_id}:${run.session_id}`;
    if (!byId.has(id)) byId.set(id, run);
  };

  for (const run of args.runs) {
    const bucket = costBucket(run.run_kind);
    const jobMatch = Boolean(jobId && nonempty(run.job_id) === jobId);
    const sessionMatch = Boolean(sessionId && nonempty(run.session_id) === sessionId);
    if (bucket === "generation") {
      if ((jobMatch || sessionMatch) && isCountableGenerationRun(run)) remember(run);
      continue;
    }
    if (bucket === "qa") {
      if ((jobMatch || sessionMatch) && isExecutedQaRun(run)) remember(run);
      continue;
    }
    if (bucket !== "analysis") continue;
    if (jobMatch || sessionMatch) {
      remember(run);
      continue;
    }
    if (planningRequestId && nonempty(run.planning_request_id) === planningRequestId) {
      remember(run);
    }
  }

  const alreadyHasAnalysis = [...byId.values()].some((run) => costBucket(run.run_kind) === "analysis");
  if (!alreadyHasAnalysis && fingerprint) {
    const candidates = args.runs
      .filter((run) => costBucket(run.run_kind) === "analysis")
      .filter((run) => nonempty(run.input_fingerprint) === fingerprint)
      .filter((run) => run.status !== "failed")
      .filter((run) => !nonempty(run.session_id) || nonempty(run.session_id) === sessionId)
      .filter((run) => isNearSession(run.created_at, args.sessionCreatedAt))
      .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
    if (candidates[0]) remember(candidates[0]);
  }

  return [...byId.values()];
}

export function rollupSessionCost(runs: CostRun[], fallbackGenerationUsd = 0): SessionCostRollup {
  let analysisUsd = 0;
  let generationUsd = 0;
  let qaUsd = 0;
  let otherUsd = 0;
  let analysisRunCount = 0;
  let generationRunCount = 0;
  let qaRunCount = 0;
  let usedAdminRates = false;
  for (const run of runs) {
    const cost = Number(run.cost_usd || 0);
    if (String(run.cost_source || "") === ADMIN_DERIVED_COST_SOURCE) usedAdminRates = true;
    const bucket = costBucket(run.run_kind);
    if (bucket === "analysis") {
      analysisUsd += cost;
      analysisRunCount += 1;
    } else if (bucket === "generation") {
      generationUsd += cost;
      generationRunCount += 1;
    } else if (bucket === "qa") {
      qaUsd += cost;
      qaRunCount += 1;
    } else {
      otherUsd += cost;
    }
  }
  const usedAiRuns = analysisRunCount > 0 || generationRunCount > 0 || qaRunCount > 0;
  if (!generationRunCount && fallbackGenerationUsd > 0) {
    generationUsd = Math.max(0, fallbackGenerationUsd - analysisUsd - qaUsd);
  }
  return {
    analysisUsd: roundUsd(analysisUsd),
    generationUsd: roundUsd(generationUsd),
    qaUsd: roundUsd(qaUsd),
    otherUsd: roundUsd(otherUsd),
    totalUsd: roundUsd(analysisUsd + generationUsd + qaUsd + otherUsd),
    analysisRunCount,
    generationRunCount,
    qaRunCount,
    usedAiRuns,
    usedAdminRates,
  };
}
