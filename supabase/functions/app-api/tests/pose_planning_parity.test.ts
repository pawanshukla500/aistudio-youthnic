/**
 * Drift guard for the FastAPI planner mirror (backend/agents/pose_plan_agents.py).
 * tests/fixtures/pose_planning_parity.json holds lib/posePlanning.ts outputs written by
 * scripts/generate-pose-planning-parity.ts; backend/tests/test_pose_planning_parity.py replays
 * the same fixture against Python. If this fails, posePlanning.ts changed: regenerate the
 * fixture and update the Python mirror until both suites pass.
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import fixture from "./fixtures/pose_planning_parity.json" with { type: "json" };
import {
  ADOPTABLE_SLOTS,
  type AdoptableSlot,
  MAX_REFERENCE_DIRECTIVE,
  normalizeExpressionPlan,
  normalizeReferencePose,
  normalizeReferencePosture,
  type PosePlanningContext,
  referenceAdoptionBlockReason,
  type ReferencePose,
  referenceSlotDirective,
} from "../lib/posePlanning.ts";

const poses = fixture.poses as unknown as Record<string, ReferencePose>;
const directivePoses = fixture.directivePoses as unknown as Record<string, ReferencePose>;
const contexts = fixture.contexts as unknown as Record<string, PosePlanningContext>;
const blockRows = fixture.referenceAdoptionBlockReason as Array<{ slot: string; pose: string; outputs: Record<string, string> }>;

Deno.test("parity fixture: normalizers reproduce posePlanning.ts outputs", () => {
  assertEquals(fixture.maxReferenceDirective, MAX_REFERENCE_DIRECTIVE);
  for (const { input, output } of fixture.normalizeReferencePosture) {
    assertEquals(normalizeReferencePosture(input), output, JSON.stringify(input));
  }
  for (const { input, output } of fixture.normalizeReferencePose) {
    assertEquals(normalizeReferencePose(input), output, JSON.stringify(input));
  }
  for (const { input, output } of fixture.normalizeExpressionPlan) {
    assertEquals(normalizeExpressionPlan(input), output, JSON.stringify(input));
  }
});

Deno.test("parity fixture: referenceAdoptionBlockReason reproduces every slot x pose x context", () => {
  for (const row of blockRows) {
    assertEquals(Object.keys(row.outputs), Object.keys(contexts));
    for (const [ctxId, output] of Object.entries(row.outputs)) {
      assertEquals(
        referenceAdoptionBlockReason(row.slot as AdoptableSlot, poses[row.pose], contexts[ctxId]),
        output,
        `${row.slot} / ${row.pose} / ${ctxId}`,
      );
    }
  }
  // Coverage stays meaningful after a regeneration: Pose 4 sees adoptions and blocks; Pose 6 never adopts.
  const slotOutputs = (slot: string) => blockRows.filter((row) => row.slot === slot).flatMap((row) => Object.values(row.outputs));
  for (const slot of ADOPTABLE_SLOTS) assertEquals(slotOutputs(slot).length, Object.keys(poses).length * Object.keys(contexts).length);
  assert(slotOutputs("creative").includes("") && slotOutputs("creative").some(Boolean), "creative needs both adoptable and blocked cases");
  assert(slotOutputs("showcase").every(Boolean), "showcase is the product-highlight close-up and never adopts");
  // A sit request blocks a non-seated Pose 4 only; a seated Pose 4 still adopts.
  const outputs = (slot: string, pose: string) => blockRows.find((row) => row.slot === slot && row.pose === pose)!.outputs;
  assert(outputs("creative", "leaning_yes").sit_requested.startsWith("Your notes ask Pose 4 to sit"));
  assertEquals(outputs("creative", "seated_yes").sit_requested, "");
  // The analysis's suitability verdict, a generic stance and a walk no longer block Pose 4; Farshi folds still do.
  for (const pose of ["t94_seated_unsuitable", "seated_no_reason", "seated_unknown", "generic_standing", "walking_yes"]) {
    assertEquals(outputs("creative", pose).kurti_plain, "", pose);
  }
  assert(outputs("creative", "t94_seated_unsuitable").farshi_bottom.startsWith("Farshi"));
  assert(outputs("creative", "reclining_yes").saree_ethnic_drape.includes("saree"));
});

Deno.test("parity fixture: referenceSlotDirective reproduces every directive, including overflow", () => {
  for (const { slot, pose, output } of fixture.referenceSlotDirective) {
    assertEquals(referenceSlotDirective(slot as AdoptableSlot, poses[pose] ?? directivePoses[pose]), output, `${slot} / ${pose}`);
  }
  const overflow = fixture.referenceSlotDirective.filter(({ pose }) => pose.startsWith("overflow_"));
  assert(overflow.length >= 2 && overflow.every(({ output }) => output.length <= MAX_REFERENCE_DIRECTIVE));
  assert(overflow.some(({ output }) => output.length >= MAX_REFERENCE_DIRECTIVE - 10), "an overflow case must fill the budget");
});
