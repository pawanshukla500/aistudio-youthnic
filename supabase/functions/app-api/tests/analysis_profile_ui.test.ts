import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { sareeProfilePresentation } from "../../../../src/features/studio/sareeProfilePresentation.ts";

const posePlanSource = Deno.readTextFileSync(
  new URL("../../../../src/features/studio/components/PosePlan.tsx", import.meta.url),
).replace(/\r\n/g, "\n");
const analysisProfileSource = Deno.readTextFileSync(
  new URL("../../../../src/features/studio/components/AnalysisProfile.tsx", import.meta.url),
).replace(/\r\n/g, "\n");

Deno.test("showcase shot type is labeled as planned while actual framing stays visible", () => {
  assertStringIncludes(posePlanSource, 'Planned shot: {showcasePlan.shotType.replace(/_/g, " ")}');
  assertStringIncludes(posePlanSource, '{selected.framing || "3:4 Full Body Portrait"}');
  assertStringIncludes(analysisProfileSource, '"Pose 6 region & planned shot type"');
  assertEquals(posePlanSource.includes("Shot: {showcasePlan.shotType"), false);
});

Deno.test("partial saree profile produces safe UI values and an actionable warning", () => {
  const presentation = sareeProfilePresentation({
    garmentFamily: "saree",
    sareeTruth: { body: { baseColor: "olive" } },
  } as never);

  assertEquals(presentation.incomplete, true);
  assertEquals(presentation.truthItems.find(([label]) => label === "Main Fabric")?.[1], undefined);
  assertEquals(presentation.truthItems.find(([label]) => label === "Physics")?.[1], undefined);
  assertEquals(presentation.drapeItems.find(([label]) => label === "Pallu Spread")?.[1], undefined);
});

Deno.test("normalized empty nested sections still show the incomplete-profile warning", () => {
  const presentation = sareeProfilePresentation({
    garmentFamily: "saree",
    sareeTruth: {
      body: { mainFabric: "" },
      borders: { upperBorder: "" },
      pallu: { hasDistinctPallu: false, motifInventory: [] },
      physics: { expectedFall: "" },
    },
    sareeDrapePlan: { palluSpread: "" },
  });

  assertEquals(presentation.incomplete, true);
});
