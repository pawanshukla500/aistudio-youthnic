export const MAX_IMAGE_REFERENCES = 16;

const NON_PRODUCT_EVIDENCE_PREFIXES = [
  "style_reference",
  "model_identity",
  "model_face_reference",
  "approved_pose",
];

/**
 * Style, model, and approved-pose photos are not garment truth.
 * Analysis records the manifest label, which is the long role text, not only
 * the short role id.
 */
export function isNonProductEvidenceRole(value: unknown) {
  const role = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!role) return false;
  return NON_PRODUCT_EVIDENCE_PREFIXES.some((prefix) => role === prefix || role.startsWith(`${prefix}_`));
}

export const PRODUCT_REFERENCE_ROLES = [
  "front",
  "back",
  "fabric_pattern",
  "bottom",
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

/** How many references the colorway structure check will look at. */
export const MAX_COLORWAY_CHECK_REFERENCES = 6;

/**
 * The references the colorway shortcut must see before it may reuse another
 * SKU's garment truth.
 *
 * It used to look at the front image alone, so a variant differing only in its
 * back, its bottom wear or its dupatta passed the structure check unseen and was
 * generated as the base garment. Every product reference is a place such a
 * difference can live; style and model references are not, and are left out so
 * this stays cheaper than a full analysis.
 */
export function colorwayCheckReferences<T extends { role: string }>(references: T[]): T[] {
  const product = references.filter((reference) =>
    (PRODUCT_REFERENCE_ROLES as readonly string[]).includes(reference.role)
  );
  return (product.length > 0 ? product : references).slice(0, MAX_COLORWAY_CHECK_REFERENCES);
}

export const SAREE_REFERENCE_ROLES = [
  "saree_front_drape",
  "saree_back_drape",
  "saree_body_detail",
  "saree_pallu_spread",
  "saree_border_tassels",
  "saree_blouse_front",
  "saree_blouse_back_piece",
] as const;

export type ReferenceLike = { role: string; hash?: string; downloadUrl?: string; storagePath?: string };

export type CurrentCatalogReferencePointers = {
  frontDownloadUrl?: string;
  frontStoragePath?: string;
  backDownloadUrl?: string;
  backStoragePath?: string;
};

/**
 * A true-back frame has one visual product authority: the current, uploaded
 * rear product image. Do not broaden this list with a blouse piece, pallu,
 * fabric close-up, style frame, or generated anchor. Those can contain a
 * legitimate but front-only detail and cause it to be invented on the rear.
 */
export function isDirectBackProductRole(role: string) {
  return role === "back" || role === "saree_back_drape";
}

export function selectTrueBackReferences<T extends ReferenceLike>(references: T[], garmentFamily = ""): T[] {
  const preferredRoles = garmentFamily.toLowerCase() === "saree"
    ? ["saree_back_drape", "back"]
    : ["back"];
  for (const role of preferredRoles) {
    const reference = references.find((entry) => entry.role === role);
    if (reference) return [reference];
  }
  return [];
}

function sameReferencePointer(
  reference: ReferenceLike,
  downloadUrl: string | undefined,
  storagePath: string | undefined,
) {
  const expectedUrl = String(downloadUrl || "");
  const expectedPath = String(storagePath || "");
  return Boolean(
    (expectedPath && String(reference.storagePath || "") === expectedPath)
    || (expectedUrl && String(reference.downloadUrl || "") === expectedUrl),
  );
}

function pointerForRole(role: string, pointers: CurrentCatalogReferencePointers) {
  if (["front", "saree_front_drape"].includes(role)) {
    return { downloadUrl: pointers.frontDownloadUrl, storagePath: pointers.frontStoragePath };
  }
  if (isDirectBackProductRole(role)) {
    return { downloadUrl: pointers.backDownloadUrl, storagePath: pointers.backStoragePath };
  }
  return null;
}

/**
 * Planning keeps prior uploads as audit history. Generation must not treat all
 * of those historical rows as live product evidence after a user replaces a
 * front or back image. Inputs are ordered oldest-to-newest by the callers, so
 * the last non-primary role is the current version; primary roles additionally
 * must match the request's canonical front/back pointer.
 */
export function selectCurrentCatalogProductReferences<T extends ReferenceLike>(
  references: T[],
  pointers: CurrentCatalogReferencePointers,
): T[] {
  const currentByRole = new Map<string, T>();
  let currentFront: T | null = null;
  let currentBack: T | null = null;
  for (const reference of references) {
    const pointer = pointerForRole(reference.role, pointers);
    if (pointer) {
      const pointerIsSet = Boolean(pointer.downloadUrl || pointer.storagePath);
      if (pointerIsSet && !sameReferencePointer(reference, pointer.downloadUrl, pointer.storagePath)) continue;
      // Front/back aliases are one logical slot. With pointers present the slot
      // must match that file; with legacy blank pointers, last upload wins.
      // Callers order historical assets oldest-to-newest, so this is a stable
      // compatibility fallback rather than hash-order roulette.
      if (["front", "saree_front_drape"].includes(reference.role)) currentFront = reference;
      else currentBack = reference;
      continue;
    }
    currentByRole.set(reference.role, reference);
  }
  return canonicalReferences([
    ...currentByRole.values(),
    ...(currentFront ? [currentFront] : []),
    ...(currentBack ? [currentBack] : []),
  ]);
}

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
    ]
    : [["front product", ["front"]], ["back product", ["back"]]];
  return requirements.filter(([, accepted]) => !accepted.some((role) => roles.has(role))).map(([label]) => label);
}

export function roleLabel(role: string) {
  const labels: Record<string, string> = {
    model_identity: "MODEL FACE REFERENCE - exact face, hair, skin tone and body-proportion truth; any garment, pose, or object in the hands, and any background, must not influence the SKU or set",
    front: "FRONT PRODUCT - authoritative front garment design and construction ONLY. Pre-shoot background, walls, arches, urns, pots, plants, floor, and location in this image MUST BE 100% DISCARDED; never reproduce them. Any face or body in this photo is not the model",
    back: "BACK PRODUCT - authoritative rear garment construction and design ONLY. Pre-shoot background, walls, and setting MUST BE 100% DISCARDED",
    fabric_pattern: "FABRIC / PATTERN DETAIL - high-priority UPPER-garment texture, weave, print and embroidery truth; not bottom-wear print unless this image itself shows the trousers/skirt; background must be ignored",
    bottom: "BOTTOM WEAR / FARSHI - pixel-level authority for the trousers/skirt cut, volume, hem, fabric color and print; never copy upper-garment fabric/embroidery or style-reference clothing onto this panel; pre-shoot floor and background must be ignored",
    mannequin: "MANNEQUIN / FLAT-LAY SHOT - exact garment shape and construction truth; never reproduce the apparatus or background surface",
    additional_product: "ADDITIONAL PRODUCT PHOTO - supporting product truth; background must be ignored",
    saree_front_drape: "FULL SAREE FRONT DRAPE - authoritative complete front drape, body, pleats, upper/lower borders and blouse-front truth; background must be ignored",
    saree_back_drape: "SAREE REAR / BACK DRAPE - authoritative rear drape, pallu fall and blouse-back truth; background must be ignored",
    saree_body_detail: "SAREE BODY / WEAVE CLOSE-UP - pixel-level body colour, weave/lattice, transparency, shine, motif geometry, orientation, repeat and density truth; background ignored",
    saree_pallu_spread: "FULLY SPREAD PALLU - sole authority for the pallu starting boundary, artwork, motif inventory, scale, orientation, repeat, density and edge construction; background ignored",
    saree_border_tassels: "SAREE BORDER / TASSELS DETAIL - authoritative upper/lower border widths, construction, colours, motif geometry, tassel colour, construction and spacing; background ignored",
    saree_blouse_front: "SAREE BLOUSE FRONT - authoritative blouse colour, fabric, front construction, neckline and sleeves; background ignored",
    saree_blouse_back_piece: "SAREE BLOUSE BACK OR UNSTITCHED PIECE - authoritative back construction, ties, closures, or proof that only an unstitched blouse piece exists; background ignored",
    approved_pose: "APPROVED POSE 1 - scene, lighting, styling, and shoot-continuity anchor only. Copy the room, not its pose or objects in the hands. Original product references always outrank its garment. The face is the MODEL FACE REFERENCE when one is attached, otherwise the STYLE REFERENCE. Never a different person",
    style_reference: "STYLE REFERENCE - SOLE AUTHORITY for photoshoot backdrop, room architecture, wall color/texture, flooring, mood, and lighting on every pose, including the back view. Copy the room only: do not copy the pose or objects in the hands. The clothing in this image must be 100% DISCARDED; dress the model ONLY in the uploaded product. When a MODEL FACE REFERENCE is also attached, discard the face, hair, and body in this image too. When no MODEL FACE REFERENCE is attached, this image's face, hair, and body proportions are the model identity for all six poses",
  };
  return labels[role] || role.toUpperCase();
}

/** Canonicalize a role or an exact verbose manifest label before storage bounds. */
export function canonicalProductReferenceRole(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if ((PRODUCT_REFERENCE_ROLES as readonly string[]).includes(normalized)) return normalized;
  return PRODUCT_REFERENCE_ROLES.find((role) => roleLabel(role).toLowerCase() === normalized) ?? normalized;
}

const canonicalOrder = [
  "model_identity",
  "saree_front_drape",
  "front",
  "bottom",
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

function preferredProductOrder(poseType: string, garmentFamily: string, preferredRole = "") {
  let baseOrder: string[];
  if (garmentFamily === "saree") {
    if (poseType === "back") return ["saree_back_drape", "back"];
    if (poseType === "closeup") {
      baseOrder = ["saree_body_detail", "fabric_pattern", "saree_border_tassels", "saree_blouse_front", "saree_pallu_spread", "saree_front_drape", "front", "saree_back_drape", "back", "saree_blouse_back_piece", "mannequin", "additional_product"];
    } else if (poseType === "showcase") {
      baseOrder = ["saree_pallu_spread", "saree_front_drape", "front", "saree_border_tassels", "saree_body_detail", "fabric_pattern", "saree_back_drape", "back", "saree_blouse_front", "saree_blouse_back_piece", "mannequin", "additional_product"];
    } else {
      baseOrder = ["saree_front_drape", "front", "saree_body_detail", "fabric_pattern", "saree_pallu_spread", "saree_border_tassels", "saree_back_drape", "back", "saree_blouse_front", "saree_blouse_back_piece", "mannequin", "additional_product"];
    }
  } else {
    if (poseType === "back") return ["back", "bottom"];
    if (poseType === "closeup") {
      baseOrder = ["fabric_pattern", "front", "bottom", "back", "mannequin", "additional_product"];
    } else if (poseType === "showcase") {
      baseOrder = ["front", "bottom", "fabric_pattern", "mannequin", "back", "additional_product"];
    } else {
      baseOrder = ["front", "bottom", "back", "mannequin", "fabric_pattern", "additional_product"];
    }
  }
  // Analysis receives roleLabel(...) in its image manifest, so its chosen
  // evidenceReference can be that full label rather than the canonical role.
  // Accept only an exact known label; never fuzzy-match prose into evidence.
  const canonicalPreferred = canonicalProductReferenceRole(preferredRole);
  if (canonicalPreferred && baseOrder.includes(canonicalPreferred)) {
    return [canonicalPreferred, ...baseOrder.filter((role) => role !== canonicalPreferred)];
  }
  return baseOrder;
}

export function selectReferences<T extends ReferenceLike>(
  references: T[],
  approved: T[],
  poseType: string,
  garmentFamily: string,
  maxReferences = MAX_IMAGE_REFERENCES,
  preferredRole = "",
): T[] {
  const normalizedFamily = garmentFamily.toLowerCase();
  // For a true back pose, the DIRECT rear upload is the sole product authority
  // (front, fabric_pattern, mannequin, etc. are strictly excluded to avoid leaking
  // front details into the rear). However, the model_identity reference and
  // the approved Pose 1 anchor MUST be included so the generator preserves the
  // exact model identity and identical photoshoot studio environment/backdrop.
  if (poseType === "back") {
    // Rear construction stays the only product image. The model face and the
    // style-reference backdrop still have to travel with this frame, or the
    // back view invents a different person and a different room.
    const rearProduct = selectTrueBackReferences(references, normalizedFamily);
    const bottomProduct = normalizedFamily === "saree"
      ? []
      : references.filter((reference) => reference.role === "bottom").slice(0, 1);
    const model = references.filter((reference) => reference.role === "model_identity").slice(0, 1);
    const style = references.filter((reference) => reference.role === "style_reference").slice(0, 1);
    const anchor = approved.slice(0, 1);
    const priority = [...rearProduct, ...bottomProduct, ...model, ...style, ...anchor];
    return collapseDuplicateUploads(priority).slice(0, maxReferences);
  }
  const order = preferredProductOrder(poseType, normalizedFamily, preferredRole);

  const model = references.filter((reference) => reference.role === "model_identity").slice(0, 1);
  const style = references.filter((reference) => reference.role === "style_reference").slice(0, 1);
  const product = order.flatMap((role) => references.filter((reference) => reference.role === role));
  // A SKU can have several photos of one region. Taking every image from an
  // early role (many bottoms, many fronts) can exhaust the provider limit and
  // silently drop the only back or mannequin. Protect one image from each
  // required evidence region first, then spend remaining slots on duplicates.
  // Saree aliases share a region so legacy sessions keep the same guarantee.
  // Back-pose sole-rear authority is handled by the early return above.
  const protectedRoleGroups = normalizedFamily === "saree"
    ? [
      ["saree_front_drape", "front"],
      ["saree_back_drape", "back"],
      ["saree_body_detail", "fabric_pattern"],
      ["saree_pallu_spread"],
      ["saree_border_tassels"],
      ["saree_blouse_front"],
      ["saree_blouse_back_piece"],
    ]
    : (poseType === "closeup" || poseType === "showcase")
      ? [
        ["front"],
        ["bottom"],
        ["fabric_pattern"],
        ["back"],
        ["mannequin"],
      ]
      : [
        ["front"],
        ["bottom"],
        ["back"],
        ["mannequin"],
      ];
  const protectedProduct: T[] = [];
  for (const roles of protectedRoleGroups) {
    const match = order.flatMap((role) => roles.includes(role)
      ? references.filter((reference) => reference.role === role)
      : []).at(0);
    if (match) protectedProduct.push(match);
  }
  const roleRank = new Map(order.map((role, index) => [role, index]));
  protectedProduct.sort((left, right) => (roleRank.get(left.role) ?? 99) - (roleRank.get(right.role) ?? 99));
  const protectedSet = new Set(protectedProduct);
  const remainingProduct = product.filter((reference) => !protectedSet.has(reference));
  const productPriority = [...protectedProduct, ...remainingProduct];
  const anchor = approved.slice(0, 1);
  // Duplicate product photos must not crowd out the style reference or Pose 1
  // continuity anchor. Protected product regions still outrank extra fronts.
  const priority = poseType === "back"
    ? [...productPriority, ...model, ...anchor]
    : [...model, ...protectedProduct, ...style, ...anchor, ...remainingProduct];
  return collapseDuplicateUploads(priority).slice(0, maxReferences);
}

/**
 * The same file is often uploaded as both the model face and the style
 * reference. Sending it twice makes that outfit outvote the product photos.
 * Keep the style copy, which still supplies the face when no separate model
 * photo remains, and drop any later image of the same stored file. A content
 * hash, storage path, or download URL is enough; a missing hash must not let
 * the duplicate through.
 */
export function collapseDuplicateUploads<T extends ReferenceLike>(selected: T[]): T[] {
  const model = selected.find((reference) => reference.role === "model_identity");
  const style = selected.find((reference) => reference.role === "style_reference");
  const modelMatchesStyle = Boolean(model && style && sameUploadedImage(model, style));
  const seenProduct = new Set<string>();
  const seenStyle = new Set<string>();
  const seenModel = new Set<string>();
  const unique: T[] = [];
  for (const reference of selected) {
    if (modelMatchesStyle && reference.role === "model_identity") continue;
    const keys = uploadIdentityKeys(reference);
    if (keys.length > 0) {
      if (reference.role === "style_reference") {
        if (keys.some((key) => seenStyle.has(key))) continue;
        for (const key of keys) seenStyle.add(key);
      } else if (reference.role === "model_identity") {
        if (keys.some((key) => seenModel.has(key))) continue;
        for (const key of keys) seenModel.add(key);
      } else {
        if (keys.some((key) => seenProduct.has(key))) continue;
        for (const key of keys) seenProduct.add(key);
      }
    }
    unique.push(reference);
  }
  return unique;
}

function uploadIdentityKeys(reference: ReferenceLike) {
  const hash = String(reference.hash || "").trim();
  const path = String(reference.storagePath || "").trim();
  const url = String(reference.downloadUrl || "").trim();
  return [
    hash ? `hash:${hash}` : "",
    path ? `path:${path}` : "",
    url ? `url:${url}` : "",
  ].filter(Boolean);
}

function sameUploadedImage(left: ReferenceLike, right: ReferenceLike) {
  const leftKeys = new Set(uploadIdentityKeys(left));
  if (leftKeys.size === 0) return false;
  return uploadIdentityKeys(right).some((key) => leftKeys.has(key));
}

export function canUsePoseOneAnchor(garmentFamily: string, qaStatus: unknown, qaEnabled?: boolean) {
  const status = String(qaStatus || "");
  if (["automatically_verified", "human_approved"].includes(status)) return true;
  if (["rejected_by_qa", "failed"].includes(status)) return false;
  if (qaEnabled === false) return true;
  // A non-saree Pose 1 that QA only flagged for review is still the best continuity
  // anchor available; dropping it makes poses 2-6 drift in set, light and model.
  return garmentFamily.toLowerCase() !== "saree" && ["passed", "unverified", "requires_human_review", ""].includes(status);
}

