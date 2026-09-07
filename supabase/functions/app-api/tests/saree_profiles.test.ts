import {
  assertEquals,
  assertThrows,
} from "jsr:@std/assert@1";
import { assertStringIncludes } from "jsr:@std/assert@1";
import {
  ANALYSIS_VERSION,
  assertSareeGenerationReady,
  buildCombinedAnalysisPrompt,
  hasRecordedBottomWear,
  isFarshiBottomWear,
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
    motifInventory: "peacock and floral field",
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
const references = [
  { role: "saree_front_drape", storagePath: "org/front.jpg" },
  { role: "saree_back_drape", storagePath: "org/back.jpg" },
  { role: "saree_body_detail", storagePath: "org/body.jpg" },
  { role: "saree_pallu_spread", storagePath: "org/pallu.jpg" },
];

Deno.test("analysis version invalidates cached analyses without rear evidence provenance and bottom wear fidelity", () => {
  assertEquals(ANALYSIS_VERSION, "generation-session-v18-bottom-print-silhouette");
});

Deno.test("analysis prompt distinguishes farshi from palazzo and does not take bottom print from upper fabric close-ups", () => {
  const prompt = buildCombinedAnalysisPrompt({
    skuName: "FARSHI-SET",
    category: "kurta set",
    productDetails: "white kurta with magenta farshi pajama",
    modelDirection: "",
    sceneDirection: "",
    referenceManifest: [
      { number: 1, role: "front" },
      { number: 2, role: "fabric_pattern" },
      { number: 3, role: "bottom" },
    ],
    fashionKnowledge: "- Farshi pajama is two-leg volume, not palazzo; copy large metallic florals from the bottom references.",
    analysisLearning: "- Keep the terracotta courtyard locked; back pose drapes the dupatta forward.",
  });
  assertStringIncludes(prompt, "Farshi / Farsi / Farshi Pajama");
  assertStringIncludes(prompt, "TWO DISTINCT LEGS");
  assertStringIncludes(prompt, "NOT palazzo, NOT plain wide-leg, NOT lehenga");
  assertStringIncludes(prompt, "SUCCESSFUL HOUSE PATTERNS");
  assertStringIncludes(prompt, "terracotta courtyard");
  assertStringIncludes(prompt, "FABRIC / PATTERN DETAIL is NOT authority for bottoms");
  assertStringIncludes(prompt, "BOTTOM WEAR / FARSHI");
  assertStringIncludes(prompt, "FASHION KNOWLEDGE (SEEDED CUT/PRINT GUIDANCE, SUBORDINATE TO PRODUCT REFERENCES):");
  assertStringIncludes(prompt, "copy large metallic florals");
  assertEquals(hasRecordedBottomWear({ bottomWearDetails: "Farshi Pajama, magenta gold floral" }), true);
  assertEquals(hasRecordedBottomWear({ bottomWearDetails: "straight-cut palazzo pants" }), true);
  assertEquals(hasRecordedBottomWear({ bottomWearDetails: "none - standalone garment" }), false);
  assertEquals(hasRecordedBottomWear({ bottomWearDetails: "Not visible in the supplied references" }), false);
  assertEquals(hasRecordedBottomWear({ bottomWearDetails: "unknown" }), false);
  assertEquals(hasRecordedBottomWear({ bottomWearDetails: "Unknown" }), false);
  assertEquals(hasRecordedBottomWear({ bottomWearDetails: "No bottom wear" }), false);
  assertEquals(hasRecordedBottomWear({ bottomWearDetails: "No bottom wear recorded" }), false);
  assertEquals(isFarshiBottomWear("Farsi pajama with large gold florals"), true);
  assertEquals(isFarshiBottomWear("Palazzo pants, solid magenta; NOT farshi"), false);
});

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
  assertEquals(normalized.productIdentity.sareeTruth?.pallu.motifInventory, ["peacock and floral field"]);
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
      regionEvidence: [{ region: "lower border", state: "confirmed-absent" }],
    },
    sareeDrapePlan: { shoulderSide: "left" },
  }, "saree");

  assertEquals(normalized.productIdentity.sareeTruth?.body.baseColor, "olive");
  assertEquals(normalized.productIdentity.sareeTruth?.body.mainFabric, "");
  assertEquals(normalized.productIdentity.sareeTruth?.pallu.artwork, "");
  assertEquals(normalized.productIdentity.sareeTruth?.borders.upperBorder, "");
  assertEquals(normalized.productIdentity.sareeTruth?.physics.expectedFall, "");
  assertEquals(normalized.productIdentity.sareeTruth?.blouse.hasBlouse, true);
  assertEquals(normalized.productIdentity.sareeTruth?.regionEvidence[0]?.state, "confirmed_absent");
  assertEquals(normalized.productIdentity.sareeDrapePlan?.palluSpread, "");
});

Deno.test("rear placement locks require direct rear evidence with provenance", () => {
  const unsupported = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "dress",
      detailPlacementMap: [
        "Front hem: gold lace trim",
        "Back hem: gold lace trim",
      ],
      garmentEvidence: [
        {
          region: "front hem",
          sourceRole: "front",
          state: "confirmed",
          visibleDecoration: "gold lace trim",
        },
        {
          region: "back hem",
          source_role: "back",
          state: "unknown",
          visibleDecoration: "",
        },
      ],
    },
  }, "dress");

  assertEquals(unsupported.productIdentity.garmentEvidence[1]?.sourceRole, "back");
  assertEquals(unsupported.productIdentity.detailPlacementMap, ["Front hem: gold lace trim"]);

  const proven = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "dress",
      detailPlacementMap: ["Back hem: gold lace trim"],
      garmentEvidence: [{
        region: "back hem",
        sourceRole: "back",
        state: "confirmed",
        visibleDecoration: "gold lace trim",
      }],
    },
  }, "dress");
  assertEquals(proven.productIdentity.detailPlacementMap, ["Back hem: gold lace trim"]);

  const explicitlyAbsent = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "dress",
      detailPlacementMap: ["Back hem: gold lace trim"],
      garmentEvidence: [{
        region: "back hem",
        sourceRole: "back",
        state: "confirmed",
        visibleDecoration: "no lace or trim is visible on the back hem",
      }],
    },
  }, "dress");
  assertEquals(explicitlyAbsent.productIdentity.detailPlacementMap, []);
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

Deno.test("a legacy detected saree has no specific blocker if pallu is not explicitly mapped", () => {
  const normalized = normalizeAnalysis({
    productIdentity: { garmentFamily: "saree" },
    sareeTruth: rawTruth,
    sareeDrapePlan: rawDrapePlan,
    posePlan,
  }, "ethnic/fusion");
  const legacyReferences = [
    { role: "front", storagePath: "org/front.jpg" },
    { role: "back", storagePath: "org/back.jpg" },
    { role: "fabric_pattern", storagePath: "org/body.jpg" },
  ];

  assertEquals(
    sareeAnalysisIssues({ ...normalized, references: legacyReferences }),
    [],
  );
  assertEquals(
    sareeAnalysisIssues({ ...normalized, references: [...legacyReferences, { role: "saree_pallu_spread", storagePath: "org/pallu.jpg" }] }),
    [],
  );
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

Deno.test("a saree category cannot queue with a non-saree garment family", () => {
  assertThrows(
    () => assertSareeGenerationReady({
      category: "saree",
      productIdentity: { garmentFamily: "dress" },
      posePlan,
      references,
    }),
    Error,
    "Stored saree analysis is incomplete or outdated. Reanalyse the product references before generation.",
  );
});
