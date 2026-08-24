export const MAX_IMAGE_REFERENCES = 16;

export const PRODUCT_REFERENCE_ROLES = [
  "front",
  "back",
  "fabric_pattern",
  "mannequin",
  "additional_product",
  "saree_front_drape",
  "saree_back_drape",
  "saree_body_detail",
  "saree_pallu_spread",
  "saree_border_tassels",
  "saree_blouse_front",
  "saree_blouse_back_piece",
] as const;

export const SAREE_REFERENCE_ROLES = [
  "saree_front_drape",
  "saree_back_drape",
  "saree_body_detail",
  "saree_pallu_spread",
  "saree_border_tassels",
  "saree_blouse_front",
  "saree_blouse_back_piece",
] as const;

type ReferenceLike = { role: string; hash?: string; downloadUrl?: string; storagePath?: string };

export function isSareeReferenceSet(references: ReferenceLike[], garmentFamily = "") {
  return garmentFamily.toLowerCase().includes("saree") || references.some((reference) => reference.role.startsWith("saree_"));
}

export function missingRequiredReferenceLabels(references: ReferenceLike[], garmentFamily = "") {
  const roles = new Set(references.filter((reference) => {
    const hasAvailabilityFields = reference.downloadUrl !== undefined || reference.storagePath !== undefined;
    return !hasAvailabilityFields || Boolean(reference.downloadUrl || reference.storagePath);
  }).map((reference) => reference.role));
  const requirements: Array<[string, string[]]> = isSareeReferenceSet(references, garmentFamily)
    ? [
      ["full saree front", ["saree_front_drape", "front"]],
      ["rear/back drape", ["saree_back_drape", "back"]],
      ["fully spread pallu", ["saree_pallu_spread"]],
      ["saree body/weave detail", ["saree_body_detail", "fabric_pattern"]],
    ]
    : [["front product", ["front"]], ["back product", ["back"]]];
  return requirements.filter(([, accepted]) => !accepted.some((role) => roles.has(role))).map(([label]) => label);
}

export function roleLabel(role: string) {
  const labels: Record<string, string> = {
    model_identity: "MODEL FACE REFERENCE - exact face, hair, skin tone and body-proportion truth; any garment in this image is unrelated and must not influence the SKU",
    front: "FRONT PRODUCT - legacy authoritative front product truth",
    back: "BACK PRODUCT - legacy authoritative rear design and construction",
    fabric_pattern: "FABRIC / PATTERN DETAIL - legacy high-priority body texture, weave, print and construction truth",
    mannequin: "MANNEQUIN / FLAT-LAY SHOT - exact garment shape and construction truth; never reproduce the apparatus",
    additional_product: "ADDITIONAL PRODUCT PHOTO - supporting product truth",
    saree_front_drape: "FULL SAREE FRONT DRAPE - authoritative complete front drape, body, pleats, upper/lower borders and blouse-front truth",
    saree_back_drape: "SAREE REAR / BACK DRAPE - authoritative rear drape, pallu fall and blouse-back truth",
    saree_body_detail: "SAREE BODY / WEAVE CLOSE-UP - pixel-level body colour, weave/lattice, transparency, shine, motif geometry, orientation, repeat and density truth",
    saree_pallu_spread: "FULLY SPREAD PALLU - sole authority for the pallu starting boundary, artwork, motif inventory, scale, orientation, repeat, density and edge construction",
    saree_border_tassels: "SAREE BORDER / TASSELS DETAIL - authoritative upper/lower border widths, construction, colours, motif geometry, tassel colour, construction and spacing",
    saree_blouse_front: "SAREE BLOUSE FRONT - authoritative blouse colour, fabric, front construction, neckline and sleeves",
    saree_blouse_back_piece: "SAREE BLOUSE BACK OR UNSTITCHED PIECE - authoritative back construction, ties, closures, or proof that only an unstitched blouse piece exists",
    approved_pose: "APPROVED POSE 1 - model, styling and shoot-continuity anchor only; original product references always outrank its garment",
    style_reference: "STYLE REFERENCE ONLY - background, composition, mood and lighting; never product identity",
  };
  return labels[role] || role.toUpperCase();
}

const canonicalOrder = [
  "model_identity",
  "saree_front_drape",
  "front",
  "saree_back_drape",
  "back",
  "saree_body_detail",
  "fabric_pattern",
  "saree_pallu_spread",
  "saree_border_tassels",
  "saree_blouse_front",
  "saree_blouse_back_piece",
  "mannequin",
  "additional_product",
  "approved_pose",
  "style_reference",
];

export function canonicalReferences<T extends ReferenceLike>(references: T[]): T[] {
  const order = new Map(canonicalOrder.map((role, index) => [role, index]));
  return [...references].sort((left, right) =>
    (order.get(left.role) ?? 99) - (order.get(right.role) ?? 99) || String(left.hash || "").localeCompare(String(right.hash || ""))
  );
}

function preferredProductOrder(poseType: string, garmentFamily: string) {
  if (garmentFamily === "saree") {
    if (poseType === "back") return ["saree_back_drape", "back", "saree_pallu_spread", "saree_front_drape", "front", "saree_blouse_back_piece", "saree_body_detail", "fabric_pattern", "saree_border_tassels", "saree_blouse_front", "mannequin", "additional_product"];
    if (poseType === "closeup") return ["saree_body_detail", "fabric_pattern", "saree_border_tassels", "saree_blouse_front", "saree_pallu_spread", "saree_front_drape", "front", "saree_back_drape", "back", "saree_blouse_back_piece", "mannequin", "additional_product"];
    return ["saree_front_drape", "front", "saree_body_detail", "fabric_pattern", "saree_pallu_spread", "saree_border_tassels", "saree_back_drape", "back", "saree_blouse_front", "saree_blouse_back_piece", "mannequin", "additional_product"];
  }
  if (poseType === "back") return ["back", "front", "mannequin", "fabric_pattern", "additional_product"];
  if (poseType === "closeup") return ["fabric_pattern", "front", "back", "mannequin", "additional_product"];
  return ["front", "back", "mannequin", "fabric_pattern", "additional_product"];
}

export function selectReferences<T extends ReferenceLike>(
  references: T[],
  approved: T[],
  poseType: string,
  garmentFamily: string,
  maxReferences = MAX_IMAGE_REFERENCES,
): T[] {
  const order = preferredProductOrder(poseType, garmentFamily);
  const model = references.filter((reference) => reference.role === "model_identity").slice(0, 1);
  const style = references.filter((reference) => reference.role === "style_reference");
  const product = order.flatMap((role) => references.filter((reference) => reference.role === role));
  // A SKU can have several full-drape or close-up photos. Taking all photos from
  // the first role before moving to the next one can exhaust the provider limit
  // and silently remove the only pallu/back/body reference. Protect one image
  // from every available saree evidence region first, then spend remaining slots
  // on useful duplicates. Legacy aliases satisfy the same region so old sessions
  // retain the same guarantee.
  const protectedSareeGroups = [
    ["saree_front_drape", "front"],
    ["saree_back_drape", "back"],
    ["saree_body_detail", "fabric_pattern"],
    ["saree_pallu_spread"],
    ["saree_border_tassels"],
    ["saree_blouse_front"],
    ["saree_blouse_back_piece"],
  ];
  const protectedProduct: T[] = [];
  if (garmentFamily.toLowerCase() === "saree") {
    for (const roles of protectedSareeGroups) {
      const match = roles.flatMap((role) => references.filter((reference) => reference.role === role))[0];
      if (match) protectedProduct.push(match);
    }
  }
  const protectedSet = new Set(protectedProduct);
  const remainingProduct = product.filter((reference) => !protectedSet.has(reference));
  const anchor = approved.slice(0, 1);
  const priority = [...model, ...protectedProduct, ...remainingProduct, ...anchor];
  const selected = priority.slice(0, maxReferences);
  const remaining = Math.max(0, maxReferences - selected.length);
  return [...selected, ...style.slice(0, remaining)];
}

export function canUsePoseOneAnchor(garmentFamily: string, qaStatus: unknown) {
  const status = String(qaStatus || "");
  if (["automatically_verified", "human_approved"].includes(status)) return true;
  return garmentFamily.toLowerCase() !== "saree" && ["passed", ""].includes(status);
}
