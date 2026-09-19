import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildColorwayAnalysisPrompt,
  colorwayDeltaIsSafe,
  mergeVariantColorways,
  normalizeAnalysis,
} from "../lib/profiles.ts";

Deno.test("buildColorwayAnalysisPrompt generates lightweight targeted prompt", () => {
  const prompt = buildColorwayAnalysisPrompt({
    skuName: "SKU-RED-01",
    garmentFamily: "Dress",
    referenceManifest: [{ number: 1, role: "front" }, { number: 2, role: "back" }],
  });
  assertStringIncludes(prompt, 'garment style "Dress"');
  assertStringIncludes(prompt, "SKU: SKU-RED-01");
  assertStringIncludes(prompt, "IMAGE 1: front");
  assertStringIncludes(prompt, "mainColor");
  assertStringIncludes(prompt, "secondaryColors");
  assertStringIncludes(prompt, "accentColors");
  assertStringIncludes(prompt, "bottomWearColor");
});

Deno.test("mergeVariantColorways preserves base silhouette and updates colors", () => {
  const baseAnalysis = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "saree",
      silhouette: "traditional drape with embroidered border",
      mainColor: "royal blue",
      secondaryColors: ["gold"],
    },
    sareeTruth: {
      body: { baseColor: "royal blue" },
      borders: { borderColors: "gold" },
    },
  }, "saree");

  const colorResult = {
    mainColor: "ruby red",
    secondaryColors: ["silver"],
    accentColors: ["silver", "white"],
  };

  const merged = mergeVariantColorways(baseAnalysis, colorResult, "SKU-RED-01");

  // Preserved structural truth
  assertEquals(merged.productIdentity.garmentFamily, "saree");
  assertEquals(merged.productIdentity.silhouette, "traditional drape with embroidered border");

  // Updated colorways
  assertEquals(merged.productIdentity.mainColor, "ruby red");
  assertEquals(merged.productIdentity.secondaryColors, ["silver"]);
  assertEquals(merged.productIdentity.patternGeometry.accentColors, ["silver", "white"]);
  assertEquals(merged.productIdentity.sareeTruth?.body.baseColor, "ruby red");
  assertEquals(merged.productIdentity.sareeTruth?.borders.borderColors, "silver");
});

Deno.test("mergeVariantColorways preserves bottom wear cut and records variant bottom color", () => {
  const baseAnalysis = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "ivory white",
      bottomWearDetails: "Farshi Pajama with wide flared straight legs, front inverted box pleats, 3-inch gold hem band; NOT dhoti pants, NOT tapered",
    },
  }, "kurta_or_kurti_set");

  const colorResult = {
    mainColor: "emerald green",
    secondaryColors: ["gold"],
    bottomWearColor: "emerald green",
  };

  const merged = mergeVariantColorways(baseAnalysis, colorResult, "SKU-GRN-01");

  assertEquals(merged.productIdentity.mainColor, "emerald green");
  assertStringIncludes(merged.productIdentity.bottomWearDetails, "Farshi Pajama with wide flared straight legs");
  assertStringIncludes(merged.productIdentity.bottomWearDetails, "NOT dhoti pants");
  assertStringIncludes(merged.productIdentity.bottomWearDetails, "Variant Colorway: emerald green");
});

Deno.test("the colorway shortcut is refused unless the variant is only a recolour", () => {
  // It reuses the collection's garment truth and repaints it, so a variant that
  // differs in print or cut would be generated as the base garment in the
  // variant's colours - its own references never read for anything but colour.
  assertEquals(
    colorwayDeltaIsSafe({ structureMatchesBase: true, structureDifferences: [], mainColor: "Wine" }).safe,
    true,
  );
  const changed = colorwayDeltaIsSafe({
    structureMatchesBase: false,
    structureDifferences: ["different border width", "V neckline instead of round"],
    mainColor: "Wine",
  });
  assertEquals(changed.safe, false);
  assertEquals(changed.differences.length, 2);
});

Deno.test("an unanswered structure question fails closed", () => {
  // An older model that ignores the new field must get the full analysis, not a
  // silent reuse of another SKU's garment truth.
  assertEquals(colorwayDeltaIsSafe({ mainColor: "Wine" }).safe, false);
  assertEquals(colorwayDeltaIsSafe({}).safe, false);
  assertEquals(colorwayDeltaIsSafe({ structureMatchesBase: "yes" }).safe, false);
  // Claiming a match while listing differences is a contradiction; trust the
  // differences, because that is the answer that keeps the product truthful.
  assertEquals(
    colorwayDeltaIsSafe({ structureMatchesBase: true, structureDifferences: ["added dupatta"] }).safe,
    false,
  );
  // A string "true" is accepted: some providers quote booleans.
  assertEquals(colorwayDeltaIsSafe({ structureMatchesBase: "true" }).safe, true);
});

Deno.test("the colorway prompt asks the model to check the structure first", () => {
  const prompt = buildColorwayAnalysisPrompt({
    skuName: "BT240-Totapuri-Wine",
    garmentFamily: "kurta set",
    referenceManifest: [{ number: 1, role: "front" }],
  });
  assertStringIncludes(prompt, "structureMatchesBase");
  assertStringIncludes(prompt, "structureDifferences");
  // A recolour is the case the shortcut exists for and must still be allowed.
  assertStringIncludes(prompt, "Report colour differences as a match");
});
