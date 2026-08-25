import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { selectReusableLearningRules } from "../lib/learningRules.ts";

const context = {
  organizationId: "org-a",
  garmentFamily: "saree",
  productCategory: "ethnic/fusion",
  poseType: "back",
  referenceFingerprint: "refs-123",
};

function approved(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    organization_id: "org-a",
    garment_family: "saree",
    product_category: "ethnic/fusion",
    pose_id: "",
    scope: "category",
    rule_kind: "presentation",
    reference_fingerprint: "",
    guidance:
      "Keep the original product references above all learned presentation guidance.",
    status: "approved",
    approved_by_member_id: "member-a",
    approved_at: "2026-08-25T12:00:00.000Z",
    ...overrides,
  };
}

Deno.test("reusable learning accepts only explicitly approved compatible category and pose rules", () => {
  const result = selectReusableLearningRules([
    approved(),
    approved({
      id: "back-rule",
      scope: "pose",
      pose_id: "back",
      rule_kind: "qa_guard",
      guidance:
        "For a true back pose, do not mirror unproven front decoration into the rear view.",
    }),
  ], context);

  assertEquals(result.ruleIds, ["rule-1", "back-rule"]);
  assertStringIncludes(result.guidance, "original product references");
  assertStringIncludes(result.guidance, "true back pose");
});

Deno.test("unapproved, cross-tenant, incompatible, and malformed rules fail closed", () => {
  const result = selectReusableLearningRules([
    approved({ id: "candidate", status: "candidate" }),
    approved({ id: "no-actor", approved_by_member_id: "" }),
    approved({ id: "wrong-org", organization_id: "org-b" }),
    approved({ id: "wrong-family", garment_family: "dress" }),
    approved({ id: "wrong-category", product_category: "saree" }),
    approved({ id: "wrong-pose", scope: "pose", pose_id: "full_front" }),
    approved({ id: "bad-shape", scope: "category", pose_id: "back" }),
    // A legacy generation_learnings observation has no reusable-rule shape and
    // must never become prompt guidance merely because it contains feedback.
    {
      id: "legacy-audit-observation",
      organization_id: "org-a",
      garment_family: "saree",
      product_category: "ethnic/fusion",
      status: "failed",
      failure_signals: { feedback: [{ corrections: ["add lace"] }] },
    },
  ], context);

  assertEquals(result, { ruleIds: [], guidance: "" });
});

Deno.test("product-scoped reference guards require an exact current reference fingerprint", () => {
  const productRule = approved({
    id: "product-rule",
    scope: "product",
    rule_kind: "reference_guard",
    pose_id: "back",
    reference_fingerprint: "refs-123",
    guidance:
      "Keep the rear plain where the authoritative back reference proves no trim.",
  });

  assertEquals(selectReusableLearningRules([productRule], context).ruleIds, [
    "product-rule",
  ]);
  assertEquals(
    selectReusableLearningRules([productRule], {
      ...context,
      referenceFingerprint: "refs-other",
    }).ruleIds,
    [],
  );
  assertEquals(
    selectReusableLearningRules([productRule], {
      ...context,
      referenceFingerprint: "REFS-123",
    }).ruleIds,
    [],
  );
  assertEquals(
    selectReusableLearningRules([productRule], {
      ...context,
      poseType: "full_front",
    }).ruleIds,
    [],
  );
});

Deno.test("selection deduplicates rule IDs and bounds both rule count and prompt guidance", () => {
  const longGuidance = "x".repeat(1_000);
  const result = selectReusableLearningRules([
    approved({ id: "one", guidance: longGuidance }),
    approved({ id: "one", guidance: "duplicate must not appear" }),
    approved({ id: "two", guidance: "second rule" }),
    approved({ id: "three", guidance: "third rule" }),
    approved({ id: "four", guidance: "fourth rule" }),
  ], {
    ...context,
    maxRules: 3,
    maxGuidanceChars: 120,
    maxRuleGuidanceChars: 80,
  });

  assertEquals(result.ruleIds, ["one", "two", "three"]);
  assertEquals(result.ruleIds.length, 3);
  assertEquals(result.guidance.length <= 120, true);
  assertEquals(result.guidance.includes("duplicate must not appear"), false);
});
