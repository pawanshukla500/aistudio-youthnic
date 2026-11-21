import { assertEquals } from "jsr:@std/assert@1";
import {
  localPosePlanningDecision,
  normalizeExpressionPlan,
  normalizeReferencePose,
  posePlanOutcomeKey,
} from "../lib/posePlanning.ts";
import {
  buildPoseScores,
  humanVerdictTransition,
  nextPosePlanOutcomeCounts,
  observationFromDna,
  planPosePlanOutcomeWrite,
  posePlanObservationVersion,
  posePlanOutcomeTarget,
  referenceAdoptionHonoured,
} from "../lib/posePlanOutcomes.ts";
import { dnaConsistencyFromQaScores, normalizeDnaConsistencyResult, unavailableDnaConsistency } from "../lib/qa.ts";

const seated = normalizeReferencePose({
  posture: "seated",
  description: "Seated on a low stool, torso upright, hands resting on knees",
  seatOrSupport: "low wooden stool",
  distinctiveness: "signature",
  signatureDescription: "one knee drawn up",
  suitableForProduct: "yes",
});
const planning = localPosePlanningDecision(seated, normalizeExpressionPlan({}), {
  poseFamily: "long_kurti",
  bottomCutClass: "straight",
  showcaseShotType: "macro_detail",
});
const SESSION = "session_3f0f8f6c-6a4e-4a43-9d1d-6f6b1d9b8f11";
const NOW = "2026-11-20T10:00:00.000Z";

Deno.test("pose plan outcome target: key matches posePlanOutcomeKey; legacy and non-adoptable poses write nothing", () => {
  const creative = posePlanOutcomeTarget(planning, "creative");
  assertEquals(creative?.source, "reference");
  assertEquals(creative?.outcomeKey, posePlanOutcomeKey({
    poseFamily: "long_kurti",
    bottomCutClass: "straight",
    slot: "creative",
    source: "reference",
    posture: "seated",
    distinctiveness: "signature",
  }));
  assertEquals(creative?.outcomeKey, "long_kurti|straight|creative|reference|seated|signature");
  // The tight showcase crop blocks adoption; product-led keys still carry the reference posture.
  assertEquals(posePlanOutcomeTarget(planning, "showcase")?.outcomeKey, "long_kurti|straight|showcase|product|seated|signature");
  assertEquals(posePlanOutcomeTarget(undefined, "creative"), null);
  assertEquals(posePlanOutcomeTarget(planning, "full_front"), null);
  assertEquals(posePlanOutcomeTarget({ ...planning, planKey: "" }, "creative"), null);
});

Deno.test("DNA observation: unavailable or missing verdicts are skipped", () => {
  assertEquals(observationFromDna(undefined), null);
  assertEquals(observationFromDna(unavailableDnaConsistency("provider outage")), null);
  // A verdict with no score would inflate dna_score_avg's sample size, so it is not counted.
  assertEquals(observationFromDna({ pass: false, score: null, failed: ["color"] }), null);
  const failed = normalizeDnaConsistencyResult({ scores: { shape: 92, color: 70, material: 90, logo: 95, details: 88 } });
  assertEquals(observationFromDna(failed, "  Calm gaze  "), { kind: "dna", pass: false, score: 87, expression: "Calm gaze" });
  const derived = dnaConsistencyFromQaScores({ colors: 96, fit_silhouette: 94, fabric_texture: 92, details_and_branding: 90, print_pattern: 93 });
  assertEquals(observationFromDna(derived)?.pass, true);
});

Deno.test("DNA observations count uses and pass/fail and keep a running score average", () => {
  const first = nextPosePlanOutcomeCounts(null, { kind: "dna", pass: true, score: 90 });
  assertEquals([first.useCount, first.dnaPassCount, first.dnaFailCount, first.dnaScoreAvg, first.bestPlanReplaced], [1, 1, 0, 90, true]);
  const row = { use_count: 2, dna_pass_count: 1, dna_fail_count: 1, dna_score_avg: "85.00", best_plan: { dnaScore: 95 } };
  const next = nextPosePlanOutcomeCounts(row, { kind: "dna", pass: false, score: 70 });
  assertEquals([next.useCount, next.dnaPassCount, next.dnaFailCount, next.dnaScoreAvg], [3, 1, 2, 80]);
  assertEquals(next.bestPlanReplaced, false);
  assertEquals(nextPosePlanOutcomeCounts(row, { kind: "dna", pass: true, score: 95 }).bestPlanReplaced, true);
});

Deno.test("human verdicts only move the human counters", () => {
  const row = { use_count: 4, dna_pass_count: 3, dna_fail_count: 1, dna_score_avg: 91.5, human_approved_count: 1, human_rejected_count: 0 };
  const approved = nextPosePlanOutcomeCounts(row, { kind: "human", verdict: "approved" });
  assertEquals([approved.useCount, approved.humanApprovedCount, approved.humanRejectedCount, approved.dnaScoreAvg], [4, 2, 0, 91.5]);
  const rejected = nextPosePlanOutcomeCounts(null, { kind: "human", verdict: "rejected" });
  assertEquals([rejected.useCount, rejected.humanApprovedCount, rejected.humanRejectedCount], [0, 0, 1]);
});

Deno.test("planned writes: insert carries the key columns and best plan; update compare-and-sets on counters", () => {
  const target = posePlanOutcomeTarget(planning, "creative")!;
  const insert = planPosePlanOutcomeWrite(null, target, { kind: "dna", pass: true, score: 93, expression: "Serene" }, { sessionId: SESSION, now: NOW });
  assertEquals(insert.action, "insert");
  if (insert.action !== "insert") throw new Error("expected insert");
  assertEquals(insert.values.outcome_key, target.outcomeKey);
  assertEquals([insert.values.slot_id, insert.values.source, insert.values.posture], ["creative", "reference", "seated"]);
  assertEquals(insert.values.best_plan, { directive: target.directive, expression: "Serene", dnaScore: 93, sessionId: SESSION });
  assertEquals(insert.values.last_session_id, SESSION);

  const existing = { id: "row-1", use_count: 1, dna_pass_count: 1, dna_fail_count: 0, dna_score_avg: 93, human_approved_count: 0, human_rejected_count: 0, best_plan: { dnaScore: 93 } };
  const update = planPosePlanOutcomeWrite(existing, target, { kind: "dna", pass: true, score: 97 }, { sessionId: SESSION, now: NOW });
  if (update.action !== "update") throw new Error("expected update");
  assertEquals(update.expected, { use_count: 1, dna_pass_count: 1, dna_fail_count: 0, human_approved_count: 0, human_rejected_count: 0 });
  assertEquals([update.values.use_count, update.values.dna_score_avg, update.values.best_plan?.dnaScore, update.values.last_used_at], [2, 95, 97, NOW]);

  const human = planPosePlanOutcomeWrite(existing, target, { kind: "human", verdict: "rejected" }, { sessionId: SESSION, now: NOW });
  if (human.action !== "update") throw new Error("expected update");
  assertEquals(human.values.human_rejected_count, 1);
  assertEquals("best_plan" in human.values || "last_used_at" in human.values, false);
});

Deno.test("pose scores and observation versions", () => {
  const dna = normalizeDnaConsistencyResult({ scores: { shape: 90, color: 90, material: 90, logo: 90, details: 90 } });
  const scores = buildPoseScores([
    { pose_type: "creative", qa_status: "unverified", attempt_count: 2, storage_path: "a.jpg", full_prompt: "PROMPT", qa_payload: { qaEnabled: false, score: 0, dna } },
    { pose_type: "", generation_data: { id: "full_front" }, qa_status: "automatically_verified", qa_payload: { productFidelity: 96 } },
  ], (value) => `h:${value.length}`);
  assertEquals(scores.creative, {
    dna: { scores: dna.scores, pass: true, score: 90, unavailable: false, source: "dna_check" },
    qaScore: null,
    qaStatus: "unverified",
    promptHash: "h:6",
    storagePath: "a.jpg",
    attempt: 2,
  });
  assertEquals([scores.full_front.dna, scores.full_front.qaScore], [null, 96]);
  assertEquals(posePlanObservationVersion({ generation_id: "g", generation_epoch: 2, attempt_count: 1, storage_path: "x.jpg" }), "g:2:1:x.jpg");
});

Deno.test("human verdicts count transitions only: repeats write nothing, a flip moves both counters in one write", () => {
  assertEquals(humanVerdictTransition("approved", "approved"), null);
  assertEquals(humanVerdictTransition("pending", "pending"), null);
  assertEquals(humanVerdictTransition("superseded", "pending"), null);
  assertEquals(humanVerdictTransition("pending", "approved"), { kind: "human", verdict: "approved", previous: null });
  const flip = humanVerdictTransition("approved", "rejected")!;
  assertEquals(flip, { kind: "human", verdict: "rejected", previous: "approved" });
  const row = { id: "row-1", use_count: 3, dna_pass_count: 3, dna_fail_count: 0, human_approved_count: 2, human_rejected_count: 0 };
  const flipped = nextPosePlanOutcomeCounts(row, flip);
  assertEquals([flipped.useCount, flipped.humanApprovedCount, flipped.humanRejectedCount], [3, 1, 1]);
  const withdrawn = nextPosePlanOutcomeCounts(row, humanVerdictTransition("approved", "pending")!);
  assertEquals([withdrawn.humanApprovedCount, withdrawn.humanRejectedCount], [1, 0]);
  // Floor 0: a decrement never goes negative when the earlier increment was lost.
  const back = nextPosePlanOutcomeCounts(null, humanVerdictTransition("rejected", "approved")!);
  assertEquals([back.humanApprovedCount, back.humanRejectedCount], [1, 0]);

  const write = planPosePlanOutcomeWrite(row, posePlanOutcomeTarget(planning, "creative")!, flip, { sessionId: SESSION, now: NOW });
  if (write.action !== "update") throw new Error("expected update");
  assertEquals([write.expected.human_approved_count, write.expected.human_rejected_count], [2, 0]);
  assertEquals([write.values.human_approved_count, write.values.human_rejected_count, write.values.use_count], [1, 1, 3]);
});

Deno.test("outcomes credit the adoption the prompt honoured: a stale Farshi seat is product-led", () => {
  const session = {
    productIdentity: { garmentFamily: "kurta_or_kurti_set", bottomWearDetails: "flared pajama" },
    references: [{ role: "front" }, { role: "style_reference" }],
    posePlanning: planning,
  };
  assertEquals(referenceAdoptionHonoured(session, "creative", { sku_name: "TEAL-SET-12", job_data: {} }), true);
  assertEquals(referenceAdoptionHonoured(session, "creative", { sku_name: "x", job_data: { skuName: "FARSHI-SET-12" } }), false);
  const dropped = posePlanOutcomeTarget(planning, "creative", false);
  assertEquals(dropped?.outcomeKey, "long_kurti|straight|creative|product|seated|signature");
  assertEquals([dropped?.source, dropped?.directive], ["product", ""]);
  assertEquals(posePlanOutcomeTarget(planning, "creative", true)?.source, "reference");
});
