import { assertEquals } from "jsr:@std/assert@1";
import { sareeProfilePresentation } from "../../../../src/features/studio/sareeProfilePresentation.ts";

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
