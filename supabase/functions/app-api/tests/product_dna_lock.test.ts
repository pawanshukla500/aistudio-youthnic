import { assert, assertEquals } from "jsr:@std/assert@1";
import { productDnaLock } from "../lib/productDnaLock.ts";
import { buildDnaConsistencyPrompt } from "../lib/qa.ts";
import { composeGenerationPrompt } from "../lib/generationPrompt.ts";

const analysis = {
  garmentFamily: "kurti",
  invariantDetails: ["Gold butti work on the yoke"],
  absenceConstraints: ["No buttons on the front placket"],
};

function row(overrides: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) {
  return {
    version: 4,
    approved_by: "stylist@example.com",
    dna_payload: {
      garment_family: "kurta_or_kurti_set",
      bottom_wear: { cut_class: "straight" },
      explicit_invariants: [
        "Back view (Pose 4) must strictly mirror back product reference",
        "gold butti work on the yoke.",
        "Contrast piping along both side slits",
      ],
      prohibited_changes: ["floating_hand", "no_buttons_on_the_front_placket", "added_pockets"],
      ...payload,
    },
    ...overrides,
  };
}

Deno.test("a person-approved DNA version prepends only its new locks", () => {
  const lock = productDnaLock(row(), analysis, { farshi: false });
  assert(lock.applied);
  assertEquals(lock.version, 4);
  assertEquals(lock.invariants, ["Contrast piping along both side slits"]);
  assertEquals(lock.prohibitions, ["added pockets"]);
  assertEquals(lock.productIdentity.invariantDetails, ["Contrast piping along both side slits", "Gold butti work on the yoke"]);
  assertEquals(lock.productIdentity.absenceConstraints, ["added pockets", "No buttons on the front placket"]);
  // The caller's object is never mutated: sessionData is saved back to the session row.
  assertEquals(analysis.invariantDetails, ["Gold butti work on the yoke"]);
});

Deno.test("the merged lock reaches the DNA consistency check", () => {
  const lock = productDnaLock(row(), analysis, { farshi: false });
  assert(lock.applied);
  const prompt = buildDnaConsistencyPrompt({
    productIdentity: lock.productIdentity,
    skuName: "Kurti",
    pose: { id: "full_front", title: "Front" },
    referenceLabels: ["FRONT PRODUCT REFERENCE"],
  });
  assert(prompt.includes("Contrast piping along both side slits"));
});

Deno.test("the merged lock reaches the image prompt", () => {
  const lock = productDnaLock(row(), { ...analysis, garmentFamily: "kurta_or_kurti_set", mainColor: "beige" }, { farshi: false });
  assert(lock.applied);
  const prompt = composeGenerationPrompt({
    skuName: "BEIGE-KURTI",
    productDetails: "",
    pose: {
      id: "full_front", poseNumber: 1, title: "Front", description: "Planted catalog stance.", prompt: "Planted catalog stance.",
      cameraAngle: "eye level", framing: "full length", bodyPosition: "weight on one leg", handPlacement: "relaxed",
      expression: "soft smile", highlightedDetails: [], productVisibilityRules: [], purpose: "sell the garment",
      consistencyNotes: "same model", enabled: true,
    } as any,
    session: { productIdentity: lock.productIdentity, creativeDirection: { backgroundStyle: "plain studio" } },
    references: [{ role: "front" }, { role: "back" }],
  } as any);
  assert(prompt.includes("Contrast piping along both side slits"));
  assert(prompt.includes("- added pockets"));
});

Deno.test("workflow approvals, heuristic DNA and missing rows never apply", () => {
  assertEquals(productDnaLock(null, analysis, { farshi: false }).applied, false);
  assertEquals(productDnaLock(row({ approved_by: "dna_agent" }), analysis, { farshi: false }).applied, false);
  assertEquals(productDnaLock(row({ approved_by: "auto_workflow" }), analysis, { farshi: false }).applied, false);
  assertEquals(productDnaLock(row({}, { metadata: { analysis_source: "heuristic_offline" } }), analysis, { farshi: false }).applied, false);
});

Deno.test("DNA for a different kind of product is skipped whole", () => {
  const sareeDna = row({}, { garment_family: "saree" });
  assertEquals(productDnaLock(sareeDna, analysis, { farshi: false }).applied, false);
  const farshiDna = row({}, { bottom_wear: { cut_class: "farshi" } });
  // Farshi DNA never reaches a non-Farshi (or top-only) shoot, and the reverse.
  assertEquals(productDnaLock(farshiDna, analysis, { farshi: false }).applied, false);
  assertEquals(productDnaLock(row(), analysis, { farshi: true }).applied, false);
  assert(productDnaLock(farshiDna, analysis, { farshi: true }).applied);
});

Deno.test("a seeded DNA that only repeats the analysis adds nothing", () => {
  const lock = productDnaLock(
    row({}, { explicit_invariants: ["Gold butti work on the yoke"], prohibited_changes: ["floating_hand"] }),
    analysis,
    { farshi: false },
  );
  assertEquals(lock, { applied: false, reason: "Product DNA adds nothing beyond the analysis" });
});
