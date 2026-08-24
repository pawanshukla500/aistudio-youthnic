import {
  assertEquals,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  assertSareeGenerationReady,
  normalizeAnalysis,
  sareeAnalysisIssues,
} from "../lib/profiles.ts";

const rawTruth = {
  body: {
    mainFabric: "silk",
    baseColor: "olive",
    motifInventory: ["peacock", "floral"],
  },
  borders: {
    upperBorder: "narrow gold",
    lowerBorder: "wide gold",
    construction: "woven",
  },
  pallu: {
    hasDistinctPallu: true,
    startingRegion: "after the body",
    artwork: "dense peacock and floral field",
  },
  pleatZone: { patternBehavior: "body repeat continues" },
  blouse: { hasBlouse: true, color: "olive", frontConstruction: "round neck" },
  physics: {
    weight: "medium",
    fluidity: "controlled",
    expectedFall: "soft structured folds",
  },
};

const rawDrapePlan = {
  baseDrapeFamily: "nivi",
  shoulderSide: "left",
  frontPleatTreatment: "five even pleats",
  palluShoulderPlacement: "left shoulder",
  palluSpread: "open",
};

const posePlan = ["full_front", "angled", "back", "creative", "closeup"].map((
  id,
) => ({ id }));
const references = [{ role: "front", storagePath: "org/front.jpg" }];

Deno.test("root-level sareeTruth and sareeDrapePlan survive canonical normalization", () => {
  const normalized = normalizeAnalysis({
    productIdentity: { garmentFamily: "saree" },
    sareeTruth: rawTruth,
    sareeDrapePlan: rawDrapePlan,
  }, "saree");

  assertEquals(normalized.productIdentity.sareeTruth?.body.baseColor, "olive");
  assertEquals(normalized.productIdentity.sareeTruth?.body.motifInventory, [
    "peacock",
    "floral",
  ]);
  assertEquals(
    normalized.productIdentity.sareeDrapePlan?.baseDrapeFamily,
    "nivi",
  );
  assertEquals("sareeTruth" in normalized, false);
  assertEquals("sareeDrapePlan" in normalized, false);
});

Deno.test("legacy nested saree profiles remain compatible", () => {
  const normalized = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "saree",
      sareeTruth: rawTruth,
      sareeDrapePlan: rawDrapePlan,
    },
  }, "saree");

  assertEquals(
    normalized.productIdentity.sareeTruth?.pallu.artwork,
    "dense peacock and floral field",
  );
  assertEquals(normalized.productIdentity.sareeDrapePlan?.shoulderSide, "left");
});

Deno.test("root saree profiles take precedence over legacy nested copies", () => {
  const normalized = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "saree",
      sareeTruth: {
        ...rawTruth,
        body: { mainFabric: "legacy", baseColor: "legacy" },
      },
      sareeDrapePlan: { ...rawDrapePlan, baseDrapeFamily: "legacy" },
    },
    sareeTruth: rawTruth,
    sareeDrapePlan: rawDrapePlan,
  }, "saree");

  assertEquals(normalized.productIdentity.sareeTruth?.body.mainFabric, "silk");
  assertEquals(
    normalized.productIdentity.sareeDrapePlan?.baseDrapeFamily,
    "nivi",
  );
});

Deno.test("partial saree truth is field-normalized without throwing", () => {
  const normalized = normalizeAnalysis({
    productIdentity: { garmentFamily: "saree" },
    sareeTruth: {
      body: { baseColor: "olive" },
      pallu: null,
      blouse: { hasBlouse: "true" },
    },
    sareeDrapePlan: { shoulderSide: "left" },
  }, "saree");

  assertEquals(normalized.productIdentity.sareeTruth?.body.baseColor, "olive");
  assertEquals(normalized.productIdentity.sareeTruth?.body.mainFabric, "");
  assertEquals(normalized.productIdentity.sareeTruth?.pallu.artwork, "");
  assertEquals(normalized.productIdentity.sareeTruth?.borders.upperBorder, "");
  assertEquals(normalized.productIdentity.sareeTruth?.physics.expectedFall, "");
  assertEquals(normalized.productIdentity.sareeTruth?.blouse.hasBlouse, true);
  assertEquals(normalized.productIdentity.sareeDrapePlan?.palluSpread, "");
});

Deno.test("complete normalized saree session passes shared Studio and Catalog preflight", () => {
  const normalized = normalizeAnalysis({
    productIdentity: { garmentFamily: "saree" },
    sareeTruth: rawTruth,
    sareeDrapePlan: rawDrapePlan,
    posePlan,
  }, "saree");
  const session = { ...normalized, references };

  assertEquals(sareeAnalysisIssues(session), []);
  assertSareeGenerationReady(session);
});

Deno.test("saree generation is blocked before paid work when truth is incomplete", () => {
  const session = {
    productIdentity: {
      garmentFamily: "saree",
      sareeTruth: { body: { baseColor: "olive" } },
    },
    posePlan,
    references,
  };

  assertThrows(
    () => assertSareeGenerationReady(session),
    Error,
    "Stored saree analysis is incomplete or outdated. Reanalyse the product references before generation.",
  );
});

Deno.test("non-saree sessions are not blocked by saree-only preflight", () => {
  assertSareeGenerationReady({ productIdentity: { garmentFamily: "dress" } });
});
