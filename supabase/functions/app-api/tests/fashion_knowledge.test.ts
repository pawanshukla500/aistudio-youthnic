import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { selectFashionKnowledgeGuidance } from "../lib/fashionKnowledge.ts";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "farshi-1",
    organization_id: null,
    category: "kurta_or_kurti_set",
    topic: "bottom_wear",
    title: "Farshi / farsi pajama cut and print lock",
    guidance:
      "Farshi pajama is extremely voluminous two-leg trousers, not palazzo or lehenga. Copy the large metallic floral motifs from the bottom-visible references; never render solid magenta or micro-dots.",
    tags: ["bottom", "farshi", "farsi", "print"],
    priority: 90,
    is_active: true,
    ...overrides,
  };
}

Deno.test("fashion knowledge prefers farshi cut/print rows and ignores pose-framing bottoms", () => {
  const selected = selectFashionKnowledgeGuidance([
    row({
      id: "framing",
      title: "Bottom hem readability",
      topic: "bottoms",
      tags: ["bottom", "pose"],
      priority: 99,
      guidance: "Keep the waistband and hem inside the frame for full-length catalog poses.",
    }),
    row(),
    row({
      id: "org-other",
      organization_id: "org-b",
      title: "Other tenant farshi",
    }),
  ], { organizationId: "org-a", garmentFamily: "kurta_or_kurti_set" });

  assertEquals(selected.ids, ["farshi-1"]);
  assertStringIncludes(selected.guidance, "two-leg trousers");
  assertStringIncludes(selected.guidance, "large metallic floral");
  assertEquals(selected.guidance.includes("waistband"), false);
});

Deno.test("fashion knowledge fails closed without an organization and skips inactive rows", () => {
  assertEquals(selectFashionKnowledgeGuidance([row()], { organizationId: "" }), { ids: [], guidance: "" });
  assertEquals(
    selectFashionKnowledgeGuidance([row({ is_active: false })], { organizationId: "org-a" }),
    { ids: [], guidance: "" },
  );
  assertEquals(
    selectFashionKnowledgeGuidance([row()], { organizationId: "org-a", garmentFamily: "saree" }),
    { ids: [], guidance: "" },
  );
});
