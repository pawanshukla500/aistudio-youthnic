import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { selectPromptPatterns } from "../lib/promptPatterns.ts";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "pose-1",
    organization_id: "org-a",
    product_category: "ethnic/fusion",
    pattern_kind: "pose",
    title: "Five-pose ethnic set",
    pattern_text:
      "Keep full_front as an unobstructed hero, back as a true rear with dupatta forward, and closeup as face-to-chest with neckline detail.",
    success_count: 8,
    failure_count: 1,
    avg_quality: 4.2,
    ...overrides,
  };
}

Deno.test("prompt patterns accept only net-successful tenant-safe category rows", () => {
  const selected = selectPromptPatterns([
    row({ id: "failing", success_count: 1, failure_count: 3 }),
    row({ id: "other-org", organization_id: "org-b" }),
    row({ id: "wrong-cat", product_category: "saree" }),
    row({ id: "bad-kind", pattern_kind: "secret" }),
    row({ id: "zero", success_count: 0, failure_count: 0 }),
    row(),
    row({
      id: "general",
      organization_id: null,
      product_category: "general",
      pattern_kind: "scene",
      pattern_text: "Reuse the terracotta courtyard set with one locked light direction.",
      success_count: 4,
      failure_count: 0,
    }),
  ], { organizationId: "org-a", productCategory: "ethnic/fusion" });

  assertEquals(selected.ids, ["pose-1", "general"]);
  assertStringIncludes(selected.guidance, "unobstructed hero");
  assertStringIncludes(selected.guidance, "terracotta courtyard");
});

Deno.test("prompt patterns fail closed without org/category and bound guidance", () => {
  assertEquals(
    selectPromptPatterns([row()], { organizationId: "", productCategory: "ethnic/fusion" }),
    { ids: [], guidance: "" },
  );
  assertEquals(
    selectPromptPatterns([row()], { organizationId: "org-a", productCategory: "" }),
    { ids: [], guidance: "" },
  );

  const long = "x".repeat(1_000);
  const bounded = selectPromptPatterns([
    row({ id: "a", pattern_text: long, success_count: 9 }),
    row({ id: "a", pattern_text: "duplicate" }),
    row({ id: "b", pattern_text: "second", success_count: 5, failure_count: 0 }),
    row({ id: "c", pattern_text: "third", success_count: 4, failure_count: 0 }),
    row({ id: "d", pattern_text: "fourth", success_count: 3, failure_count: 0 }),
  ], { organizationId: "org-a", productCategory: "ethnic/fusion" });
  assertEquals(bounded.ids, ["a", "b", "c"]);
  assertEquals(bounded.guidance.length <= 700, true);
  assertEquals(bounded.guidance.includes("duplicate"), false);
});
