/**
 * Pose-plan learning ledger (public.pose_plan_outcomes, one row per
 * organization_id + outcome_key). Pure helpers only: finalizeJob records each
 * job's Product DNA verdict for Pose 4 / Pose 6, the human review paths record
 * verdicts, catalogProduction.ts recordPosePlanOutcome performs the
 * compare-and-set write, and the LangGraph recall_outcomes node reads the rows
 * (backend/agents/pose_plan_agents.py outcome_key / outcome_effect).
 */
import { isFarshiGeneration, promptReferenceSlots } from "./generationPrompt.ts";
import { ADOPTABLE_SLOTS, posePlanOutcomeKey, storedPosePlanning, type AdoptableSlot, type JsonRecord, type SlotPlan } from "./posePlanning.ts";

export const POSE_PLAN_OUTCOME_WRITE_ATTEMPTS = 4;
export const POSE_PLAN_OUTCOME_COLUMNS =
  "id,use_count,dna_pass_count,dna_fail_count,dna_score_avg,human_approved_count,human_rejected_count,best_plan";

export type HumanVerdict = "approved" | "rejected";

/**
 * A human verdict counts once per status transition: `verdict` is incremented and
 * `previous` (the verdict it replaces) decremented, floored at 0. A null verdict
 * withdraws the previous one (back to pending).
 */
export type PosePlanObservation =
  | { kind: "dna"; pass: boolean; score: number | null; expression?: string }
  | { kind: "human"; verdict: HumanVerdict | null; previous?: HumanVerdict | null };

export type PosePlanOutcomeRow = {
  id?: unknown;
  use_count?: unknown;
  dna_pass_count?: unknown;
  dna_fail_count?: unknown;
  dna_score_avg?: unknown;
  human_approved_count?: unknown;
  human_rejected_count?: unknown;
  best_plan?: unknown;
};

export type PosePlanOutcomeTarget = {
  outcomeKey: string;
  poseFamily: string;
  bottomCutClass: string;
  slot: AdoptableSlot;
  source: SlotPlan["source"];
  posture: string;
  distinctiveness: string;
  directive: string;
};


function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/** A 0-100 score, or null. Postgres numeric columns arrive as strings. */
function score(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

export function isAdoptableSlot(value: unknown): value is AdoptableSlot {
  return (ADOPTABLE_SLOTS as readonly unknown[]).includes(value);
}

function sessionIdOrNull(value: unknown): string | null {
  return String(value ?? "").trim().slice(0, 200) || null;
}

/**
 * The outcome row a Pose 4 / Pose 6 slot writes to. Null for a legacy session
 * (no stored posePlanning), another pose, or a plan without a family|cut key.
 * Posture and distinctiveness are the reference pose's for both sources, as the planner reads them.
 * `honoured` false (referenceAdoptionHonoured) credits a stored adoption the prompt dropped to "product".
 */
export function posePlanOutcomeTarget(posePlanning: unknown, slot: unknown, honoured = true): PosePlanOutcomeTarget | null {
  if (!isAdoptableSlot(slot)) return null;
  const planning = storedPosePlanning({ posePlanning });
  if (!planning) return null;
  const [poseFamily, bottomCutClass, ...rest] = planning.planKey.split("|");
  if (!poseFamily || !bottomCutClass || rest.length) return null;
  const plan = planning.slots[slot];
  const source = plan.source === "reference" && honoured ? "reference" : "product";
  const { posture, distinctiveness } = planning.referencePose;
  return {
    outcomeKey: posePlanOutcomeKey({ poseFamily, bottomCutClass, slot, source, posture, distinctiveness }),
    poseFamily,
    bottomCutClass,
    slot,
    source,
    posture,
    distinctiveness,
    directive: source === "reference" ? plan.directive : "",
  };
}

/**
 * Whether the generation prompt honoured this slot's stored adoption: promptReferenceSlots
 * with the isFarshiGeneration verdict over the job's SKU text, as compilePosePrompt
 * computes it (session references stand in for the pose's selection). A stale Farshi low
 * posture or a walking posture was dropped, so its frames are product-led.
 */
export function referenceAdoptionHonoured(sessionData: JsonRecord, slot: AdoptableSlot, job?: JsonRecord | null): boolean {
  const jobData = record(job?.job_data);
  const references = (Array.isArray(sessionData.references) ? sessionData.references : [])
    .map((reference) => ({ role: String(record(reference).role || "") }));
  const farshi = isFarshiGeneration({
    session: sessionData,
    skuName: String(jobData.skuName || job?.sku_name || ""),
    productDetails: String(jobData.productDetails || ""),
    references,
    bottomWearMode: sessionData.bottomWearMode ?? jobData.bottomWearMode,
  });
  return promptReferenceSlots(sessionData, farshi)[slot] !== null;
}

function humanVerdictOf(status: unknown): HumanVerdict | null {
  const value = String(status ?? "").trim().toLowerCase();
  return value === "approved" || value === "rejected" ? value : null;
}

/**
 * The human observation for an approval/review status change, or null when the verdict
 * did not change (the same status again, or pending/superseded to pending).
 */
export function humanVerdictTransition(previousStatus: unknown, nextStatus: unknown): Extract<PosePlanObservation, { kind: "human" }> | null {
  const previous = humanVerdictOf(previousStatus);
  const verdict = humanVerdictOf(nextStatus);
  return previous === verdict ? null : { kind: "human", verdict, previous };
}

/**
 * A DNA verdict worth learning from, or null when the check was unavailable, never ran or
 * left no score: pass+fail counts are dna_score_avg's sample size, so every counted
 * observation must carry a score.
 */
export function observationFromDna(dna: unknown, expression = ""): Extract<PosePlanObservation, { kind: "dna" }> | null {
  const raw = record(dna);
  const observed = score(raw.score);
  if (raw.unavailable === true || typeof raw.pass !== "boolean" || observed === null) return null;
  return { kind: "dna", pass: raw.pass, score: observed, expression: String(expression || "").trim().slice(0, 300) };
}

export function nextPosePlanOutcomeCounts(existing: PosePlanOutcomeRow | null | undefined, observation: PosePlanObservation) {
  const prior = {
    useCount: count(existing?.use_count),
    dnaPassCount: count(existing?.dna_pass_count),
    dnaFailCount: count(existing?.dna_fail_count),
    humanApprovedCount: count(existing?.human_approved_count),
    humanRejectedCount: count(existing?.human_rejected_count),
  };
  const previousAverage = score(existing?.dna_score_avg);
  if (observation.kind === "human") {
    const delta = (verdict: HumanVerdict) => (observation.verdict === verdict ? 1 : 0) - (observation.previous === verdict ? 1 : 0);
    return {
      ...prior,
      humanApprovedCount: Math.max(0, prior.humanApprovedCount + delta("approved")),
      humanRejectedCount: Math.max(0, prior.humanRejectedCount + delta("rejected")),
      dnaScoreAvg: previousAverage,
      bestPlanReplaced: false,
    };
  }
  // Every DNA observation bumps exactly one of pass/fail, so their sum is the averaged sample size.
  const samples = prior.dnaPassCount + prior.dnaFailCount;
  const dnaScoreAvg = observation.score === null
    ? previousAverage
    : previousAverage === null || samples === 0
    ? observation.score
    : Math.round(((previousAverage * samples + observation.score) / (samples + 1)) * 100) / 100;
  const bestScore = score(record(existing?.best_plan).dnaScore);
  return {
    ...prior,
    useCount: prior.useCount + 1,
    dnaPassCount: prior.dnaPassCount + (observation.pass ? 1 : 0),
    dnaFailCount: prior.dnaFailCount + (observation.pass ? 0 : 1),
    dnaScoreAvg,
    bestPlanReplaced: observation.score !== null && (bestScore === null || observation.score >= bestScore),
  };
}

/** Insert or compare-and-set update for one observation (catalogProduction.ts recordPosePlanOutcome). */
export function planPosePlanOutcomeWrite(
  existing: PosePlanOutcomeRow | null | undefined,
  target: PosePlanOutcomeTarget,
  observation: PosePlanObservation,
  context: { sessionId: string; now: string },
) {
  const next = nextPosePlanOutcomeCounts(existing, observation);
  const counters = {
    use_count: next.useCount,
    dna_pass_count: next.dnaPassCount,
    dna_fail_count: next.dnaFailCount,
    dna_score_avg: next.dnaScoreAvg,
    human_approved_count: next.humanApprovedCount,
    human_rejected_count: next.humanRejectedCount,
  };
  const bestPlan = next.bestPlanReplaced && observation.kind === "dna"
    ? { best_plan: { directive: target.directive, expression: observation.expression ?? "", dnaScore: observation.score, sessionId: context.sessionId } }
    : {};
  // A human verdict is not a new use of the plan.
  const usage = observation.kind === "dna" ? { last_session_id: sessionIdOrNull(context.sessionId), last_used_at: context.now } : {};
  const id = String(existing?.id ?? "").trim();
  if (!id) {
    return {
      action: "insert" as const,
      values: {
        outcome_key: target.outcomeKey,
        pose_family: target.poseFamily,
        bottom_cut_class: target.bottomCutClass,
        slot_id: target.slot,
        source: target.source,
        posture: target.posture,
        distinctiveness: target.distinctiveness,
        ...counters,
        ...bestPlan,
        last_session_id: sessionIdOrNull(context.sessionId),
        last_used_at: context.now,
        updated_at: context.now,
      },
    };
  }
  return {
    action: "update" as const,
    id,
    expected: {
      use_count: count(existing?.use_count),
      dna_pass_count: count(existing?.dna_pass_count),
      dna_fail_count: count(existing?.dna_fail_count),
      human_approved_count: count(existing?.human_approved_count),
      human_rejected_count: count(existing?.human_rejected_count),
    },
    values: { ...counters, ...bestPlan, ...usage, updated_at: context.now },
  };
}

/**
 * Identity of the pose version a DNA observation came from. A single-pose
 * regeneration re-finalizes the same job, so finalizeJob keeps these in
 * job_data.posePlanObserved and counts each delivered version once.
 */
export function posePlanObservationVersion(pose: JsonRecord): string {
  return [pose.generation_id, pose.generation_epoch ?? 1, pose.attempt_count ?? 0, pose.storage_path || pose.status]
    .map((part) => String(part ?? "")).join(":");
}

/** generation_learnings.pose_scores: per pose id, the final DNA verdict, QA score, prompt hash and output. */
export function buildPoseScores(poses: readonly JsonRecord[], hash: (value: string) => string): Record<string, JsonRecord> {
  const out: Record<string, JsonRecord> = {};
  for (const pose of poses) {
    const poseId = String(pose.pose_type || record(pose.generation_data).id || "").trim();
    if (!poseId) continue;
    const qa = record(pose.qa_payload);
    const dna = record(qa.dna);
    const qaRan = qa.qaEnabled !== false && !qa.qaUnavailable;
    const prompt = String(pose.full_prompt || "");
    out[poseId] = {
      dna: Object.keys(dna).length
        ? {
          scores: record(dna.scores),
          pass: typeof dna.pass === "boolean" ? dna.pass : null,
          score: score(dna.score),
          unavailable: dna.unavailable === true,
          source: String(dna.source || ""),
        }
        : null,
      qaScore: qaRan ? score(qa.productFidelity ?? qa.score) : null,
      qaStatus: String(pose.qa_status || ""),
      promptHash: prompt ? hash(prompt) : "",
      storagePath: String(pose.storage_path || ""),
      attempt: count(pose.attempt_count),
    };
  }
  return out;
}
