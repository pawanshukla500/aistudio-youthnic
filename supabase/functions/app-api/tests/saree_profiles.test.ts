import {
  assertEquals,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  ANALYSIS_VERSION,
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

Deno.test("v15 analysis version invalidates cached analyses without rear evidence provenance", () => {
  assertEquals(ANALYSIS_VERSION, "generation-session-v15-back-evidence-memory");
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
