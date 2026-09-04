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
