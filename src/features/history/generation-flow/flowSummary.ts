import { formatModelName } from "../../../lib/modelLabels.ts";

type Loose = Record<string, any>;

export type FlowFact = { label: string; value: string };
export type FlowPlanStep = { poseIndex: number; title: string; copiesReferencePosture: boolean };

/** What the flow board header and the analysis card show: the stored analysis and the image run. */
export type FlowSummary = {
  skuName: string;
  status: string;
  analysis: {
    model: string;
    modelLabel: string;
    provider: string;
    thinking: string;
    fallbacks: string[];
    version: number | null;
    dnaVersion: number | null;
    facts: FlowFact[];
    plan: FlowPlanStep[];
  } | null;
  run: {
    model: string;
    modelLabel: string;
    aspectRatio: string;
    imageSize: string;
    quality: string;
    costUsd: number | null;
    done: number;
    total: number;
    poseQa: boolean;
  } | null;
};

const FACTS: Array<[string, string]> = [
  ["category", "Category"],
  ["mainColor", "Main colour"],
  ["fabric", "Fabric"],
  ["print", "Print"],
  ["pattern", "Pattern"],
  ["neckline", "Neckline"],
  ["fit", "Fit"],
  ["length", "Length"],
  ["embroidery", "Embroidery"],
];

function words(value: unknown, max = 140) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(parsed) ? null : parsed;
}

/** Builds the board summary from a session's session_data and its generation_jobs row. Either may be missing. */
export function flowSummaryFrom(args: { sessionData?: Loose | null; job?: Loose | null; skuName?: string }): FlowSummary {
  const session = args.sessionData || {};
  const job = args.job || {};
  const identity: Loose = session.productIdentity && typeof session.productIdentity === "object" ? session.productIdentity : {};
  const plan: Loose[] = Array.isArray(session.posePlan) ? session.posePlan : [];
  const slots: Loose = session.posePlanning?.slots || {};
  const adopted = new Set([
    slots.creative?.source === "reference" ? 4 : 0,
    slots.showcase?.source === "reference" ? 6 : 0,
  ].filter(Boolean));
  const requested: Loose = session.analysisPolicy?.requested || {};
  const analysisModel = String(session.analysisModel || requested.model || "");
  const facts = FACTS
    .map(([key, label]) => ({ label, value: words(identity[key]) }))
    .filter((fact) => fact.value && !/^(none|n\/a|not visible|none visible)$/i.test(fact.value))
    .slice(0, 6);
  const analysis = analysisModel || facts.length || plan.length
    ? {
      model: analysisModel,
      modelLabel: analysisModel ? formatModelName(analysisModel) : "Not recorded",
      provider: String(session.analysisProvider || requested.provider || ""),
      thinking: String(requested.thinkingLevel || ""),
      fallbacks: (Array.isArray(requested.fallbacks) ? requested.fallbacks : [])
        .map((route: Loose) => String(route?.model || ""))
        .filter(Boolean)
        .slice(0, 3)
        .map((model: string) => formatModelName(model)),
      version: numberOrNull(session.analysisVersion),
      dnaVersion: numberOrNull(session.productDnaVersion),
      facts,
      plan: plan.map((step, index) => ({
        poseIndex: index + 1,
        title: words(step?.title || `Pose ${index + 1}`, 80),
        copiesReferencePosture: adopted.has(index + 1),
      })),
    }
    : null;
  const imageModel = String(job.model || "");
  // A queued job stores actual_cost_usd = 0 until something is billed; show the estimate until then.
  const actualCost = numberOrNull(job.actual_cost_usd);
  const estimatedCost = numberOrNull(job.estimated_cost_usd);
  const run = job.job_id || imageModel
    ? {
      model: imageModel,
      modelLabel: imageModel ? formatModelName(imageModel) : "Not recorded",
      aspectRatio: String(job.aspect_ratio || ""),
      imageSize: String(job.image_size || ""),
      quality: String(job.quality || ""),
      costUsd: actualCost !== null && actualCost > 0 ? actualCost : estimatedCost ?? actualCost,
      done: Number(job.completed_poses || 0),
      total: Number(job.total_poses || plan.length || 0),
      poseQa: job.pose_qa === true,
    }
    : null;
  return {
    skuName: String(args.skuName || session.skuName || job.sku_name || job.job_data?.skuName || "Unnamed product"),
    status: String(job.status || ""),
    analysis,
    run,
  };
}

/** A quality, size and aspect line such as "3:4 · 2K · Medium". */
export function settingsLine(run: { aspectRatio?: string; imageSize?: string; quality?: string } | null | undefined) {
  if (!run) return "";
  const quality = run.quality ? run.quality[0].toUpperCase() + run.quality.slice(1) : "";
  return [run.aspectRatio, run.imageSize, quality].filter(Boolean).join(" · ");
}

/**
 * A stored timestamp as the local value a `datetime-local` input shows. Slicing the UTC text
 * instead moved the deadline by the browser's UTC offset on every save.
 */
export function deadlineInputValue(value: unknown) {
  const date = value ? new Date(String(value)) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
