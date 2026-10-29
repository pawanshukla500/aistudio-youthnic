import { assertEquals } from "jsr:@std/assert@1";
import { isQueueCompatiblePosePlan } from "../../../../src/lib/posePlanCompatibility.ts";

const backendSource = Deno.readTextFileSync(
  new URL("../../../../src/lib/backend.ts", import.meta.url),
).replace(/\r\n/g, "\n");

const currentPoseIds = ["full_front", "angled", "back", "creative", "closeup", "showcase"];
const plan = (ids: string[]) => ids.map((id) => ({ id, prompt: `Generate ${id}` }));

Deno.test("catalog readiness accepts ordered legacy five-pose and current six-pose plans", () => {
  assertEquals(isQueueCompatiblePosePlan(plan(currentPoseIds.slice(0, 5))), true);
  assertEquals(isQueueCompatiblePosePlan(plan(currentPoseIds)), true);
});

Deno.test("catalog readiness rejects seven-pose and unordered plans", () => {
  assertEquals(isQueueCompatiblePosePlan(plan([...currentPoseIds, "showcase"])), false);
  assertEquals(isQueueCompatiblePosePlan(plan(["angled", ...currentPoseIds.slice(1)])), false);
});

Deno.test("catalog readiness rejects malformed or unqueueable pose entries", () => {
  assertEquals(isQueueCompatiblePosePlan(null), false);
  assertEquals(isQueueCompatiblePosePlan([...plan(currentPoseIds.slice(0, 4)), null]), false);
  assertEquals(isQueueCompatiblePosePlan([...plan(currentPoseIds.slice(0, 4)), { prompt: "Missing id" }]), false);
  assertEquals(isQueueCompatiblePosePlan([...plan(currentPoseIds.slice(0, 4)), { id: "closeup", prompt: " " }]), false);
  assertEquals(isQueueCompatiblePosePlan([...plan(currentPoseIds.slice(0, 4)), { id: "closeup", prompt: "Detail", enabled: false }]), false);
});

Deno.test("both catalog readiness paths use the queue compatibility predicate", () => {
  assertEquals(backendSource.split("isQueueCompatiblePosePlan(variant.pose_plan)").length - 1, 2);
  assertEquals(backendSource.includes("variant.pose_plan.length >= 5"), false);
  assertEquals(backendSource.includes("variant.pose_plan.length < 5"), false);
});
