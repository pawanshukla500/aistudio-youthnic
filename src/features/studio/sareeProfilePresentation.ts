type SareeTruthLike = {
  body?: { mainFabric?: unknown };
  borders?: { upperBorder?: unknown };
  pallu?: { hasDistinctPallu?: unknown; motifInventory?: unknown };
  blouse?: { hasBlouse?: unknown };
  physics?: { expectedFall?: unknown };
};

type SareeDrapeLike = {
  baseDrapeFamily?: unknown;
  shoulderSide?: unknown;
  palluShoulderPlacement?: unknown;
  openOrPleatedPallu?: unknown;
  frontPleatTreatment?: unknown;
  palluSpread?: unknown;
};

type ProductIdentity = {
  garmentFamily?: unknown;
  sareeTruth?: SareeTruthLike;
  sareeDrapePlan?: SareeDrapeLike;
};

function hasEvidence(section: unknown) {
  if (!section || typeof section !== "object") return false;
  return Object.values(section).some((value) => (
    typeof value === "string" ? value.trim().length > 0 : Array.isArray(value) ? value.length > 0 : false
  ));
}

export function sareeProfilePresentation(product: ProductIdentity) {
  const truth = product.sareeTruth;
  const drape = product.sareeDrapePlan;
  const incomplete = product.garmentFamily === "saree" && (
    !hasEvidence(truth?.body) || !hasEvidence(truth?.borders) || !hasEvidence(truth?.pallu) ||
    !hasEvidence(truth?.physics) || !hasEvidence(drape)
  );
  return {
    truth,
    drape,
    incomplete,
    truthItems: [
      ["Main Fabric", truth?.body?.mainFabric],
      ["Pallu Type", truth?.pallu ? (truth.pallu.hasDistinctPallu ? "Distinct Pallu" : "Continuous Body") : "Not visible"],
      ["Pallu Motif", truth?.pallu?.motifInventory],
      ["Border", truth?.borders?.upperBorder],
      ["Blouse Piece", truth?.blouse ? (truth.blouse.hasBlouse ? "Included" : "None") : "Not visible"],
      ["Physics", truth?.physics?.expectedFall],
    ] as Array<[string, unknown]>,
    drapeItems: [
      ["Base Drape", drape?.baseDrapeFamily],
      ["Shoulder", drape?.shoulderSide],
      ["Pallu Placement", drape?.palluShoulderPlacement],
      ["Pallu Style", drape?.openOrPleatedPallu],
      ["Pleat Treatment", drape?.frontPleatTreatment],
      ["Pallu Spread", drape?.palluSpread],
    ] as Array<[string, unknown]>,
  };
}
