import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildColorwayAnalysisPrompt,
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
