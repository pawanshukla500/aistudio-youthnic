export const ANALYSIS_RUN_KINDS = ["product_reference_analysis", "catalog_product_preflight"] as const;

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

function nonempty(value: unknown) {
  const text = String(value || "").trim();
  return text ? text : "";
}

function roundUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function costBucket(runKind: string): CostBucket {
  if ((ANALYSIS_RUN_KINDS as readonly string[]).includes(runKind)) return "analysis";
  if (runKind === "image_generation") return "generation";
  if (runKind === "quality_assurance") return "qa";
  return "other";
}

function isNearSession(runCreatedAt: string | null | undefined, sessionCreatedAt: string | null | undefined) {
  if (!runCreatedAt || !sessionCreatedAt) return false;
  const runMs = Date.parse(runCreatedAt);
  const sessionMs = Date.parse(sessionCreatedAt);
  if (!Number.isFinite(runMs) || !Number.isFinite(sessionMs)) return false;
  return runMs <= sessionMs + 10 * 60_000 && runMs >= sessionMs - 2 * 60 * 60_000;
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
    if (bucket === "generation" || bucket === "qa") {
      if (jobMatch || sessionMatch) remember(run);
      continue;
    }
    if (bucket !== "analysis") continue;
    if (jobMatch || sessionMatch) {
      remember(run);
      continue;
    }
    if (planningRequestId && nonempty(run.planning_request_id) === planningRequestId) remember(run);
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
    if (String(run.cost_source || "") === "openai_admin_derived_rates") usedAdminRates = true;
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
  if (!generationRunCount && fallbackGenerationUsd > 0) generationUsd = fallbackGenerationUsd;
  return {
    analysisUsd: roundUsd(analysisUsd),
    generationUsd: roundUsd(generationUsd),
    qaUsd: roundUsd(qaUsd),
    otherUsd: roundUsd(otherUsd),
    totalUsd: roundUsd(analysisUsd + generationUsd + qaUsd + otherUsd),
    analysisRunCount,
    generationRunCount,
    qaRunCount,
    usedAiRuns: runs.length > 0,
    usedAdminRates,
  };
}
