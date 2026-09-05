export type JsonRecord = Record<string, unknown>;

// Print and embroidery are what make a garment this SKU rather than a similar
// one, and a single free-text sentence cannot pin motif scale, spacing or the
// geometry of an embroidered yoke. These structured profiles carry that detail
// into every generation prompt and give QA something exact to measure against.
export type PatternGeometryProfile = {
  type: string;
  scale: string;
  orientation: string;
  density: string;
  repeat: string;
  placementByPanel: string[];
  accentColors: string[];
  motifInventory: string[];
};

export type EmbroideryGeometryProfile = {
  placement: string;
  geometry: string;
  motifStructure: string;
  scaleRelativeToGarment: string;
  colorsAndMaterial: string;
  borders: string;
  necklineRelation: string;
};

// What the model wears alongside the garment. Held apart from productIdentity,
// which records what the product references actually show: footwear the customer
// receives is product truth, footwear the stylist adds is a styling decision, and
// conflating them let the generator treat a proposed accessory as part of the SKU.
export type StylingPlanProfile = {
  footwear: string;
  jewellery: string;
  ornaments: string;
  makeup: string;
  hair: string;
  stylingNotes: string;
  themeInterpretation: string;
};

export type GarmentRegionEvidence = {
  region: string;
  // The exact reference role that proved this region. Keeping the source with
  // the observation prevents a front-only trim from becoming a rear hard lock.
  sourceRole: string;
  state: "confirmed" | "confirmed_absent" | "unknown";
  visibleConstruction: string;
  visibleDecoration: string;
  closures: string;
  explicitlyAbsent: string[];
  uncertainty: string;
};

export type SareeTruthProfile = {
  body: {
    mainFabric: string;
    weave: string;
    weaveGeometry: string;
    texture: string;
    transparency: string;
    shine: string;
    baseColor: string;
    secondaryColors: string[];
    pattern: string;
    motifInventory: string[];
    motifScale: string;
    motifOrientation: string;
    motifRepeat: string;
    motifDensity: string;
    motifPlacement: string;
    embellishment: string;
    bodyOrientation: string;
  };
  borders: {
    upperBorder: string;
    lowerBorder: string;
    borderWidth: string;
    upperBorderWidth: string;
    lowerBorderWidth: string;
    borderColors: string;
    construction: string;
    motifGeometry: string;
    edgeTreatment: string;
    continuityRules: string;
    tasselColor: string;
    tasselConstruction: string;
    tasselSpacing: string;
  };
  pallu: {
    hasDistinctPallu: boolean;
    startingRegion: string;
    baseColor: string;
    motifInventory: string[];
    motifScale: string;
    motifOrientation: string;
    motifRepeat: string;
    motifDensity: string;
    borders: string;
    artwork: string;
    zari: string;
    embroidery: string;
    tassels: string;
    edgeTreatment: string;
    visualOrientation: string;
    evidenceReferences: string;
    uncertainty: string;
  };
  pleatZone: {
    patternBehavior: string;
    borderBehavior: string;
    embellishmentBehavior: string;
    hasSpecialPanel: boolean;
  };
  blouse: {
    hasBlouse: boolean;
    color: string;
    fabric: string;
    frontConstruction: string;
    backConstruction: string;
    neckline: string;
    sleeves: string;
    ties: string;
    closure: string;
    embroidery: string;
    border: string;
    pattern: string;
    fit: string;
    isUnstitchedPiece: boolean;
  };
  physics: {
    weight: string;
    stiffness: string;
    fluidity: string;
    transparency: string;
    shine: string;
    creaseBehavior: string;
    expectedFall: string;
  };
  regionEvidence: GarmentRegionEvidence[];
};

export type SareeDrapePlan = {
  baseDrapeFamily: string;
  shoulderSide: string;
  waistTuck: string;
  frontPleatTreatment: string;
  palluShoulderPlacement: string;
  openOrPleatedPallu: string;
  palluSpread: string;
  palluFallDirection: string;
  palluVisibleLength: string;
  handInteraction: string;
  movementAmount: string;
  pinningBehavior: string;
  borderVisibility: string;
  blouseVisibility: string;
  coverageConstraints: string;
  poseSpecificDrapeState: string;
};

export type ProductIdentityProfile = {
  garmentFamily: string;
  category: string;
  mainColor: string;
  secondaryColors: string[];
  fabric: string;
  pattern: string;
  print: string;
  patternGeometry: PatternGeometryProfile;
  embroideryGeometry: EmbroideryGeometryProfile;
  texture: string;
  neckline: string;
  sleeveType: string;
  length: string;
  fit: string;
  silhouette: string;
  frontConstruction: string;
  backConstruction: string;
  buttons: string;
  zippers: string;
  pockets: string;
  embroidery: string;
  logos: string;
  accessoriesIncluded: string;
  bottomWearDetails: string;
  footwearDetails: string;
  detailPlacementMap: string[];
  absenceConstraints: string[];
  invariantDetails: string[];
  uncertaintyNotes: string[];
  garmentEvidence: GarmentRegionEvidence[];
  sareeTruth?: SareeTruthProfile;
  sareeDrapePlan?: SareeDrapePlan;
};

export type StudioPose = {
  id: string;
  title: string;
  description: string;
  cameraAngle: string;
  framing: string;
  bodyPosition: string;
  handPlacement: string;
  expression: string;
  highlightedDetails: string[];
  productVisibilityRules: string[];
  primaryReference: string;
  purpose: string;
  consistencyNotes: string;
  prompt: string;
  enabled: boolean;
};

export function getPoseSlots(garmentFamily: string): readonly StudioPose[] {
  const isSaree = garmentFamily === "saree";

  return [
    {
      id: "full_front",
      title: "Full Front Product View",
      framing: "3:4 portrait, head-to-toe with footwear and garment hem fully inside frame",
      bodyPosition: "Square to camera with balanced weight and a natural, playful Gen-Z catalog stance - relaxed and confident, never stiff or robotic",
      handPlacement: "Hands relaxed beside the body without covering neckline, waist, pockets, or trims",
      expression: "Playful, warm, confident Gen-Z energy while keeping the same face and hairstyle throughout the set",
      productVisibilityRules: ["front construction unobstructed", "complete bottom wear visible", "no garment detail hidden by hands or hair"],
      consistencyNotes: "Establish the model, face, hair, accessories, footwear, scene, lighting, and color-treatment anchor for poses 2-5",
      description: "Straight-on full-body hero view with the complete product readable from head to hem.",
      cameraAngle: "Eye-level straight-on full-body",
      highlightedDetails: ["front construction", "overall silhouette", "complete outfit"],
      primaryReference: "front",
      purpose: "Primary e-commerce listing image",
      prompt: "Create a straight-on full-body front hero image. Show the complete outfit, including the exact bottom wear and footwear, with a natural premium e-commerce stance.",
      enabled: true,
    },
    {
      id: "angled",
      title: isSaree ? "Professional Drape & Fall View" : "Professional Side / 3/4 View",
      framing: "3:4 portrait, full-body with clear side silhouette and no crop at hem or footwear",
      bodyPosition: "Rotate torso and hips together to a garment-appropriate three-quarter angle without twisting or deforming the product",
      handPlacement: "Keep hands away from the side seam, sleeve shape, pockets, waist treatment, and drape being demonstrated",
      expression: "Same recognizable face and styling, with a playful, natural Gen-Z variation on the hero expression - a genuine smile or confident smirk, not stiff studio energy",
      productVisibilityRules: isSaree ? ["drape depth and pallu fall clearly visible", "silhouette is not compressed", "bottom wear remains unchanged and visible"] : ["front and side construction remain readable", "silhouette is not compressed", "bottom wear remains unchanged and visible"],
      consistencyNotes: "Use Pose 1 only as the model and shoot anchor; preserve the original product references as garment truth",
      description: isSaree ? "A professional three-quarter or side view that reveals the drape depth, pleat structure, and pallu fall." : "A professional three-quarter or side view that reveals depth, drape, fit, and side construction.",
      cameraAngle: "Eye-level 35-55 degree three-quarter view",
      highlightedDetails: isSaree ? ["drape depth", "pallu fall", "pleats"] : ["side silhouette", "fit", "drape and construction"],
      primaryReference: "front",
      purpose: "Show garment depth and fit",
      prompt: "Create an intentional three-quarter or side fashion pose that is visibly different from the hero pose while keeping the full outfit readable.",
      enabled: true,
    },
    {
      id: "back",
      title: "Full Back View",
      framing: "3:4 portrait, head-to-toe true rear view with the full back and hem visible",
      bodyPosition: "Model faces fully away from camera with shoulders and hips square, weight relaxed and natural; no three-quarter cheat",
      handPlacement: "Hands placed naturally where they do not cover the back neckline, closure, embroidery, waist, or rear silhouette",
      expression: "Face is not forced toward camera; preserve identity and playful Gen-Z energy through hair, body, and styling continuity; if glancing back, face and profile must match identity anchor",
      productVisibilityRules: isSaree
        ? ["uploaded back image is the sole back-design authority", "rear drape and pallu fall visible", "exact same backdrop wall, floor, and lighting from Pose 1 - zero new props"]
        : [
          "uploaded back image is the sole back-design authority",
          "entire rear construction visible from neckline to hem",
          "dupatta or shawl draped forward over arms/front only - back of kurti/dress must be 100% visible and unobstructed",
          "hair swept forward or in an updo - back neckline, ties, and rear details completely unobstructed",
          "never infer back details from the front",
          "exact same backdrop wall, floor, and lighting from Pose 1 - zero new props",
        ],
      consistencyNotes: "Keep the exact same model identity, hair, accessories, footwear, exact bottom wear, and identical studio set/backdrop wall from Pose 1 while showcasing the authoritative back",
      description: "A true full back view sourced from the uploaded back product photograph with unobstructed rear garment construction.",
      cameraAngle: "Eye-level straight-on back view",
      highlightedDetails: isSaree ? ["rear drape", "pallu fall", "back blouse details"] : ["back construction", "back neckline", "rear pattern placement"],
      primaryReference: "back",
      purpose: "Document the real back design",
      prompt: "Turn the model fully away from camera to capture the authentic rear garment design from the uploaded back reference. For outfits with a dupatta, shawl, or stole, drape it forward over the arms or front so the back panel, neckline, embroidery, seams, and fit remain 100% unobstructed and clearly visible. Preserve the exact model identity, styling, and the identical studio set, wall color, and lighting established in Pose 1.",
      enabled: true,
    },
    {
      id: "creative",
      title: "Creative Gen-Z Fashion Pose",
      framing: "3:4 portrait with a garment-appropriate full or three-quarter body editorial crop",
      bodyPosition: "Use controlled movement selected for this category and construction, with anatomically natural posture and a readable silhouette",
      handPlacement: "Expressive but intentional; hands must not cover the garment's key selling features or change its apparent shape",
      expression: "Current, effortlessly cool Gen-Z editorial expression while retaining the exact same recognizable model face and hairstyle",
      productVisibilityRules: isSaree ? ["product remains the visual subject", "creative movement highlights fabric fluidity and pallu", "no prop or limb hides key drape features"] : ["product remains the visual subject", "no prop or limb hides key construction", "creative movement does not alter fit, length, or pattern"],
      consistencyNotes: "Borrow only art direction from style references; garment, bottom wear, footwear, accessories, model, and shoot continuity remain locked",
      description: "A current, expressive Gen-Z fashion pose that follows the selected creative direction without hiding the garment.",
      cameraAngle: "Product-appropriate editorial angle",
      highlightedDetails: isSaree ? ["fabric movement", "fluidity", "creative direction"] : ["movement", "silhouette", "creative direction"],
      primaryReference: "front",
      purpose: "Campaign and social-commerce storytelling",
      prompt: "Create a bold, playful, scroll-stopping Gen-Z fashion pose suited to this exact product category, with genuine attitude and movement. Preserve the complete product while borrowing only mood, composition, and lighting from style references.",
      enabled: true,
    },
    {
      id: "closeup",
      title: "Zoomed-In Face & Product Highlight",
      framing: "3:4 portrait, genuinely zoomed in to a face-to-chest or face-to-waist crop - visibly tighter in scale than the full-body hero pose, never a repeat of it",
      bodyPosition: "Natural, relaxed upper-body angle, as if caught mid-moment, that keeps both the face and the chosen product highlight clearly readable",
      handPlacement: "Hands relaxed and natural - resting near the highlighted detail without covering it, or away from frame if the detail is elsewhere",
      expression: "A beautiful, cute, natural Gen-Z-style face with a genuine expression - a soft real smile or candid laugh, warm eyes, unfiltered and approachable, never stiff or over-posed",
      productVisibilityRules: ["face is sharp and clearly visible", "one real product detail (embroidery, neckline, pallu/dupatta drape, print, trim, or fabric texture) is also sharp and unobstructed in the same frame", "this is a genuine zoomed-in shot, not the full-body hero framing repeated"],
      consistencyNotes: "Keep the same face, hair, makeup, accessories, footwear, scene, lighting, and exact bottom wear established in Pose 1; only the framing zooms in tight enough to read both the face and the highlighted detail clearly",
      description: "A zoomed-in shot that pairs a beautiful, natural face with a sharp highlight of the product's most important real detail.",
      cameraAngle: "Eye-level, zoomed in to a face-to-chest or face-to-waist crop",
      highlightedDetails: ["natural expression", "face", "key product detail"],
      primaryReference: "fabric_pattern",
      purpose: "Social-first beauty-and-product shot that sells both the face and the craftsmanship",
      prompt: "Create a genuinely zoomed-in face-to-chest or face-to-waist shot - clearly tighter in scale than the full-body hero pose, never a repeat of it - pairing a beautiful, cute, Gen-Z-style face with a genuine, natural expression alongside one sharp, clearly visible highlight of the product's most important real detail (embroidery, neckline, drape, print, or fabric texture).",
      enabled: true,
    },
  ];
}

function stringValue(value: unknown, fallback = "Not visible in the supplied references") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function stringArray(value: unknown, fallback: string[] = []) {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return fallback;
  const entries = value.map((item) => stringValue(item, "")).filter(Boolean);
  return entries.length ? entries.slice(0, 20) : fallback;
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

export function parseJsonResponse(text: string): JsonRecord {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The AI provider returned an invalid object.");
  return parsed as JsonRecord;
}

function patternGeometry(product: JsonRecord): PatternGeometryProfile {
  const geometry = objectValue(product.patternGeometry ?? product.pattern_geometry);
  return {
    // A legacy profile may describe the print in `print` and leave `pattern`
    // empty. Declaring such a garment solid would make the generation lock
    // contradict the product.
    type: stringValue(geometry.type, stringValue(product.pattern, stringValue(product.print, "Solid - no repeating pattern visible"))),
    scale: stringValue(geometry.scale),
    orientation: stringValue(geometry.orientation),
    density: stringValue(geometry.density),
    repeat: stringValue(geometry.repeat),
    placementByPanel: stringArray(geometry.placementByPanel ?? geometry.placement_by_panel),
    accentColors: stringArray(geometry.accentColors ?? geometry.accent_colors),
    motifInventory: stringArray(geometry.motifInventory ?? geometry.motif_inventory),
  };
}

function embroideryGeometry(product: JsonRecord): EmbroideryGeometryProfile {
  const geometry = objectValue(product.embroideryGeometry ?? product.embroidery_geometry);
  return {
    placement: stringValue(geometry.placement, stringValue(product.embroidery, "No embroidery visible")),
    geometry: stringValue(geometry.geometry),
    motifStructure: stringValue(geometry.motifStructure ?? geometry.motif_structure),
    scaleRelativeToGarment: stringValue(geometry.scaleRelativeToGarment ?? geometry.scale_relative_to_garment),
    colorsAndMaterial: stringValue(geometry.colorsAndMaterial ?? geometry.colors_and_material),
    borders: stringValue(geometry.borders),
    necklineRelation: stringValue(geometry.necklineRelation ?? geometry.neckline_relation),
  };
}

/**
 * `preserveEmpty` separates two different callers. Analysis output wants a
 * default when the model left a field blank. A stylist's save does not: clearing
 * a field is a decision, and refilling it with generated text would overwrite
 * that decision on every round trip.
 */
export function normalizeStylingPlan(raw: unknown, options: { preserveEmpty?: boolean } = {}): StylingPlanProfile {
  const plan = objectValue(raw);
  const field = (value: unknown, fallback: string) => {
    if (options.preserveEmpty && (typeof value === "string" || value === null)) return String(value ?? "").trim();
    return stringValue(value, fallback);
  };
  return {
    footwear: field(plan.footwear, "Simple neutral footwear that suits the garment without competing with it"),
    jewellery: field(plan.jewellery, "Minimal jewellery appropriate to the garment and scene"),
    ornaments: field(plan.ornaments, "No additional ornaments"),
    makeup: field(plan.makeup, "Natural everyday makeup with soft definition"),
    hair: field(plan.hair, "Simple hairstyle that keeps the neckline and yoke visible"),
    stylingNotes: field(plan.stylingNotes ?? plan.styling_notes, ""),
    themeInterpretation: field(plan.themeInterpretation ?? plan.theme_interpretation, ""),
  };
}

function garmentEvidence(product: JsonRecord): GarmentRegionEvidence[] {
  const evidence = product.garmentEvidence ?? product.garment_evidence;
  if (!Array.isArray(evidence)) return [];
  return evidence.map((e: unknown) => {
    const obj = objectValue(e);
    const state = String(obj.state || "unknown").trim().toLowerCase().replace(/[\s-]+/g, "_");
    return {
      region: stringValue(obj.region),
      sourceRole: normalizeReferenceRole(
        obj.sourceRole ?? obj.source_role ?? obj.evidenceRole ?? obj.evidence_role ?? obj.referenceRole ?? obj.reference_role,
      ),
      state: ["confirmed", "confirmed_absent", "unknown"].includes(state) ? state as "confirmed" | "confirmed_absent" | "unknown" : "unknown",
      visibleConstruction: stringValue(obj.visibleConstruction ?? obj.visible_construction),
      visibleDecoration: stringValue(obj.visibleDecoration ?? obj.visible_decoration),
      closures: stringValue(obj.closures),
      explicitlyAbsent: stringArray(obj.explicitlyAbsent ?? obj.explicitly_absent),
      uncertainty: stringValue(obj.uncertainty),
    };
  });
}

function normalizeReferenceRole(value: unknown) {
  return stringValue(value, "").toLowerCase().replace(/[\s-]+/g, "_");
}

function isRearRegion(value: string) {
  return /(?:^|\b)(?:back|rear|centre[_\s-]?back|center[_\s-]?back)(?:\b|$)/i.test(value);
}

const REAR_SOURCE_ROLES = new Set([
  "back",
  "saree_back_drape",
  "saree_blouse_back",
  "saree_blouse_back_piece",
]);

const REAR_DETAIL_TERMS = [
  "lace",
  "trim",
  "piping",
  "fringe",
  "tassel",
  "latkan",
  "embroidery",
  "border",
  "ribbon",
  "sequin",
  "bead",
  "button",
  "zipper",
  "zip",
  "tie",
  "closure",
  "keyhole",
];

function rearRegionMatches(claim: string, evidence: GarmentRegionEvidence) {
  const claimLocation = claim.split(":", 1)[0].toLowerCase();
  const evidenceLocation = evidence.region.toLowerCase();
  if (!isRearRegion(claimLocation) || !isRearRegion(evidenceLocation)) return false;
  const areaTerms = ["neck", "hem", "body", "blouse", "waist", "sleeve", "bottom", "pallu", "border", "tassel"];
  const requiredAreas = areaTerms.filter((term) => claimLocation.includes(term));
  return requiredAreas.every((term) => evidenceLocation.includes(term));
}

function rearDetailIsProven(claim: string, evidence: GarmentRegionEvidence) {
  const claimText = claim.toLowerCase();
  const sourceText = [evidence.visibleConstruction, evidence.visibleDecoration, evidence.closures].join("\n").toLowerCase();
  const absentText = evidence.explicitlyAbsent.join(" ").toLowerCase();
  return REAR_DETAIL_TERMS
    .filter((term) => claimText.includes(term))
    .every((term) => {
      const negated = new RegExp(`\\b(?:no|without|absent|lacks?|does not have|doesn't have|not)\\b.*\\b${term}\\b`, "i");
      const directlyDenied = sourceText.split(/[.\n;]/).some((statement) => negated.test(statement));
      return sourceText.includes(term) && !absentText.includes(term) && !directlyDenied;
    });
}

/**
 * A placement map is useful only where it remains tied to physical evidence.
 * In particular, never let a front-only lace/trim claim leak into a back pose
 * through a free-text "back hem" placement. Legacy analyses without source
 * provenance remain readable, but their rear placement claims are deliberately
 * treated as unproven until a fresh analysis records the direct back source.
 */
export function sanitizeDetailPlacementMap(value: unknown, evidenceValue: unknown): string[] {
  const evidence = Array.isArray(evidenceValue)
    ? garmentEvidence({ garmentEvidence: evidenceValue })
    : garmentEvidence(objectValue(evidenceValue));
  return stringArray(value).filter((claim) => {
    if (!isRearRegion(claim)) return true;
    return evidence.some((entry) =>
      entry.state === "confirmed" &&
      REAR_SOURCE_ROLES.has(entry.sourceRole) &&
      rearRegionMatches(claim, entry) &&
      rearDetailIsProven(claim, entry)
    );
  });
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.trim().toLowerCase() === "true") return true;
    if (value.trim().toLowerCase() === "false") return false;
  }
  return fallback;
}

function normalizeRegionEvidence(value: unknown): GarmentRegionEvidence[] {
  return garmentEvidence({ garmentEvidence: value });
}

export function normalizeSareeTruth(
  raw: unknown,
): SareeTruthProfile | undefined {
  const truth = objectValue(raw);
  if (!Object.keys(truth).length) return undefined;
  const body = objectValue(truth.body);
  const borders = objectValue(truth.borders);
  const pallu = objectValue(truth.pallu);
  const pleatZone = objectValue(truth.pleatZone ?? truth.pleat_zone);
  const blouse = objectValue(truth.blouse);
  const physics = objectValue(truth.physics);
  return {
    body: {
      mainFabric: stringValue(body.mainFabric ?? body.main_fabric, ""),
      weave: stringValue(body.weave, ""),
      weaveGeometry: stringValue(body.weaveGeometry ?? body.weave_geometry, ""),
      texture: stringValue(body.texture, ""),
      transparency: stringValue(body.transparency, ""),
      shine: stringValue(body.shine, ""),
      baseColor: stringValue(body.baseColor ?? body.base_color, ""),
      secondaryColors: stringArray(
        body.secondaryColors ?? body.secondary_colors,
      ),
      pattern: stringValue(body.pattern, ""),
      motifInventory: stringArray(body.motifInventory ?? body.motif_inventory),
      motifScale: stringValue(body.motifScale ?? body.motif_scale, ""),
      motifOrientation: stringValue(
        body.motifOrientation ?? body.motif_orientation,
        "",
      ),
      motifRepeat: stringValue(body.motifRepeat ?? body.motif_repeat, ""),
      motifDensity: stringValue(body.motifDensity ?? body.motif_density, ""),
      motifPlacement: stringValue(
        body.motifPlacement ?? body.motif_placement,
        "",
      ),
      embellishment: stringValue(body.embellishment, ""),
      bodyOrientation: stringValue(
        body.bodyOrientation ?? body.body_orientation,
        "",
      ),
    },
    borders: {
      upperBorder: stringValue(borders.upperBorder ?? borders.upper_border, ""),
      lowerBorder: stringValue(borders.lowerBorder ?? borders.lower_border, ""),
      borderWidth: stringValue(borders.borderWidth ?? borders.border_width, ""),
      upperBorderWidth: stringValue(
        borders.upperBorderWidth ?? borders.upper_border_width,
        "",
      ),
      lowerBorderWidth: stringValue(
        borders.lowerBorderWidth ?? borders.lower_border_width,
        "",
      ),
      borderColors: stringValue(
        borders.borderColors ?? borders.border_colors,
        "",
      ),
      construction: stringValue(borders.construction, ""),
      motifGeometry: stringValue(
        borders.motifGeometry ?? borders.motif_geometry,
        "",
      ),
      edgeTreatment: stringValue(
        borders.edgeTreatment ?? borders.edge_treatment,
        "",
      ),
      continuityRules: stringValue(
        borders.continuityRules ?? borders.continuity_rules,
        "",
      ),
      tasselColor: stringValue(borders.tasselColor ?? borders.tassel_color, ""),
      tasselConstruction: stringValue(
        borders.tasselConstruction ?? borders.tassel_construction,
        "",
      ),
      tasselSpacing: stringValue(
        borders.tasselSpacing ?? borders.tassel_spacing,
        "",
      ),
    },
    pallu: {
      hasDistinctPallu: booleanValue(
        pallu.hasDistinctPallu ?? pallu.has_distinct_pallu,
      ),
      startingRegion: stringValue(
        pallu.startingRegion ?? pallu.starting_region,
        "",
      ),
      baseColor: stringValue(pallu.baseColor ?? pallu.base_color, ""),
      motifInventory: stringArray(
        pallu.motifInventory ?? pallu.motif_inventory,
      ),
      motifScale: stringValue(pallu.motifScale ?? pallu.motif_scale, ""),
      motifOrientation: stringValue(
        pallu.motifOrientation ?? pallu.motif_orientation,
        "",
      ),
      motifRepeat: stringValue(pallu.motifRepeat ?? pallu.motif_repeat, ""),
      motifDensity: stringValue(pallu.motifDensity ?? pallu.motif_density, ""),
      borders: stringValue(pallu.borders, ""),
      artwork: stringValue(pallu.artwork, ""),
      zari: stringValue(pallu.zari, ""),
      embroidery: stringValue(pallu.embroidery, ""),
      tassels: stringValue(pallu.tassels, ""),
      edgeTreatment: stringValue(
        pallu.edgeTreatment ?? pallu.edge_treatment,
        "",
      ),
      visualOrientation: stringValue(
        pallu.visualOrientation ?? pallu.visual_orientation,
        "",
      ),
      evidenceReferences: stringValue(
        pallu.evidenceReferences ?? pallu.evidence_references,
        "",
      ),
      uncertainty: stringValue(pallu.uncertainty, ""),
    },
    pleatZone: {
      patternBehavior: stringValue(
        pleatZone.patternBehavior ?? pleatZone.pattern_behavior,
        "",
      ),
      borderBehavior: stringValue(
        pleatZone.borderBehavior ?? pleatZone.border_behavior,
        "",
      ),
      embellishmentBehavior: stringValue(
        pleatZone.embellishmentBehavior ?? pleatZone.embellishment_behavior,
        "",
      ),
      hasSpecialPanel: booleanValue(
        pleatZone.hasSpecialPanel ?? pleatZone.has_special_panel,
      ),
    },
    blouse: {
      hasBlouse: booleanValue(blouse.hasBlouse ?? blouse.has_blouse),
      color: stringValue(blouse.color, ""),
      fabric: stringValue(blouse.fabric, ""),
      frontConstruction: stringValue(
        blouse.frontConstruction ?? blouse.front_construction,
        "",
      ),
      backConstruction: stringValue(
        blouse.backConstruction ?? blouse.back_construction,
        "",
      ),
      neckline: stringValue(blouse.neckline, ""),
      sleeves: stringValue(blouse.sleeves, ""),
      ties: stringValue(blouse.ties, ""),
      closure: stringValue(blouse.closure, ""),
      embroidery: stringValue(blouse.embroidery, ""),
      border: stringValue(blouse.border, ""),
      pattern: stringValue(blouse.pattern, ""),
      fit: stringValue(blouse.fit, ""),
      isUnstitchedPiece: booleanValue(
        blouse.isUnstitchedPiece ?? blouse.is_unstitched_piece,
      ),
    },
    physics: {
      weight: stringValue(physics.weight, ""),
      stiffness: stringValue(physics.stiffness, ""),
      fluidity: stringValue(physics.fluidity, ""),
      transparency: stringValue(physics.transparency, ""),
      shine: stringValue(physics.shine, ""),
      creaseBehavior: stringValue(
        physics.creaseBehavior ?? physics.crease_behavior,
        "",
      ),
      expectedFall: stringValue(
        physics.expectedFall ?? physics.expected_fall,
        "",
      ),
    },
    regionEvidence: normalizeRegionEvidence(
      truth.regionEvidence ?? truth.region_evidence,
    ),
  };
}

export function normalizeSareeDrapePlan(
  raw: unknown,
): SareeDrapePlan | undefined {
  const plan = objectValue(raw);
  if (!Object.keys(plan).length) return undefined;
  return {
    baseDrapeFamily: stringValue(
      plan.baseDrapeFamily ?? plan.base_drape_family,
      "",
    ),
    shoulderSide: stringValue(plan.shoulderSide ?? plan.shoulder_side, ""),
    waistTuck: stringValue(plan.waistTuck ?? plan.waist_tuck, ""),
    frontPleatTreatment: stringValue(
      plan.frontPleatTreatment ?? plan.front_pleat_treatment,
      "",
    ),
    palluShoulderPlacement: stringValue(
      plan.palluShoulderPlacement ?? plan.pallu_shoulder_placement,
      "",
    ),
    openOrPleatedPallu: stringValue(
      plan.openOrPleatedPallu ?? plan.open_or_pleated_pallu,
      "",
    ),
    palluSpread: stringValue(plan.palluSpread ?? plan.pallu_spread, ""),
    palluFallDirection: stringValue(
      plan.palluFallDirection ?? plan.pallu_fall_direction,
      "",
    ),
    palluVisibleLength: stringValue(
      plan.palluVisibleLength ?? plan.pallu_visible_length,
      "",
    ),
    handInteraction: stringValue(
      plan.handInteraction ?? plan.hand_interaction,
      "",
    ),
    movementAmount: stringValue(
      plan.movementAmount ?? plan.movement_amount,
      "",
    ),
    pinningBehavior: stringValue(
      plan.pinningBehavior ?? plan.pinning_behavior,
      "",
    ),
    borderVisibility: stringValue(
      plan.borderVisibility ?? plan.border_visibility,
      "",
    ),
    blouseVisibility: stringValue(
      plan.blouseVisibility ?? plan.blouse_visibility,
      "",
    ),
    coverageConstraints: stringValue(
      plan.coverageConstraints ?? plan.coverage_constraints,
      "",
    ),
    poseSpecificDrapeState: stringValue(
      plan.poseSpecificDrapeState ?? plan.pose_specific_drape_state,
      "",
    ),
  };
}

const REQUIRED_POSE_IDS = [
  "full_front",
  "angled",
  "back",
  "creative",
  "closeup",
] as const;
const SAREE_ANALYSIS_ERROR =
  "Stored saree analysis is incomplete or outdated. Reanalyse the product references before generation.";

function sectionHasEvidence(section: unknown) {
  return Object.values(objectValue(section)).some((value) => {
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return false;
  });
}

export function sareeAnalysisIssues(session: unknown): string[] {
  const value = objectValue(session);
  const product = objectValue(value.productIdentity ?? value.product_identity);
  const references = Array.isArray(value.references)
    ? value.references.map(objectValue)
    : [];
  const garmentFamily = String(product.garmentFamily ?? product.garment_family).toLowerCase();
  const category = String(value.category ?? product.category).toLowerCase();
  const isSareeSession = garmentFamily === "saree" || category.includes("saree") ||
    references.some((reference) => String(reference.role || "").startsWith("saree_"));
  if (!isSareeSession) return [];
  const truth = objectValue(product.sareeTruth ?? product.saree_truth);
  const plan = objectValue(product.sareeDrapePlan ?? product.saree_drape_plan);
  const poseValue = value.posePlan ?? value.pose_plan;
  const poses: unknown[] = Array.isArray(poseValue) ? poseValue : [];
  const issues: string[] = [];
  if (garmentFamily !== "saree") issues.push("garment family is not saree");
  if (!Object.keys(truth).length) issues.push("saree truth is missing");
  for (const section of ["body", "borders", "pallu", "physics"] as const) {
    if (!sectionHasEvidence(truth[section])) {
      issues.push(`${section} evidence is missing`);
    }
  }
  if (!Object.keys(plan).length) issues.push("saree drape plan is missing");
  if (
    poses.length !== REQUIRED_POSE_IDS.length ||
    poses.map((pose) => String(objectValue(pose).id)).join(",") !==
      REQUIRED_POSE_IDS.join(",")
  ) {
    issues.push("the ordered five-pose plan is incomplete");
  }
  const availableProductReferences = references.filter((reference) => {
    const role = String(reference.role || "");
    const isProduct = ![
      "style_reference",
      "model_identity",
      "approved_pose",
      "generated",
    ].includes(role);
    return isProduct &&
      Boolean(
        String(
          reference.storagePath ?? reference.storage_path ??
            reference.downloadUrl ?? reference.download_url ?? "",
        ).trim(),
      );
  });
  if (!availableProductReferences.length) {
    issues.push("authoritative product references are unavailable");
  }
  const availableRoles = new Set(
    availableProductReferences.map((reference) => String(reference.role || "")),
  );
  const requiredEvidence: Array<[string, string[]]> = [
    ["full saree front", ["saree_front_drape", "front"]],
    ["rear/back drape", ["saree_back_drape", "back"]],
  ];
  for (const [label, roles] of requiredEvidence) {
    if (!roles.some((role) => availableRoles.has(role))) {
      issues.push(`${label} reference is missing`);
    }
  }
  return issues;
}

export function assertSareeGenerationReady(session: unknown) {
  if (sareeAnalysisIssues(session).length) {
    throw new Error(SAREE_ANALYSIS_ERROR);
  }
}

export function normalizeAnalysis(raw: JsonRecord, categoryFallback: string) {
  const product = objectValue(raw.productIdentity ?? raw.product_identity);
  const creative = objectValue(raw.creativeDirection ?? raw.creative_direction);
  const model = objectValue(raw.modelIdentity ?? raw.model_identity);
  const rawPoseValue = raw.posePlan ?? raw.pose_plan;
  const rawPoses = Array.isArray(rawPoseValue) ? (rawPoseValue as unknown[]) : [];
  
  const sareeTruthRaw = objectValue(
    raw.sareeTruth ??
      raw.saree_truth ??
      product.sareeTruth ??
      product.saree_truth,
  );
  const sareeDrapePlanRaw = objectValue(
    raw.sareeDrapePlan ??
      raw.saree_drape_plan ??
      product.sareeDrapePlan ??
      product.saree_drape_plan,
  );
  const sareeTruth = normalizeSareeTruth(sareeTruthRaw);
  const sareeDrapePlan = normalizeSareeDrapePlan(sareeDrapePlanRaw);
  const normalizedGarmentEvidence = garmentEvidence(product);

  const productIdentity: ProductIdentityProfile = {
    garmentFamily: stringValue(product.garmentFamily ?? product.garment_family, "unknown"),
    category: stringValue(product.category, categoryFallback),
    mainColor: stringValue(product.mainColor ?? product.main_color),
    secondaryColors: stringArray(product.secondaryColors ?? product.secondary_colors),
    fabric: stringValue(product.fabric), pattern: stringValue(product.pattern), print: stringValue(product.print),
    patternGeometry: patternGeometry(product),
    embroideryGeometry: embroideryGeometry(product),
    texture: stringValue(product.texture), neckline: stringValue(product.neckline),
    sleeveType: stringValue(product.sleeveType ?? product.sleeve_type), length: stringValue(product.length),
    fit: stringValue(product.fit), silhouette: stringValue(product.silhouette),
    frontConstruction: stringValue(product.frontConstruction ?? product.front_construction),
    backConstruction: stringValue(product.backConstruction ?? product.back_construction),
    buttons: stringValue(product.buttons), zippers: stringValue(product.zippers), pockets: stringValue(product.pockets),
    embroidery: stringValue(product.embroidery), logos: stringValue(product.logos),
    accessoriesIncluded: stringValue(product.accessoriesIncluded ?? product.accessories_included),
    bottomWearDetails: stringValue(product.bottomWearDetails ?? product.bottom_wear_details),
    footwearDetails: stringValue(product.footwearDetails ?? product.footwear_details),
    detailPlacementMap: sanitizeDetailPlacementMap(product.detailPlacementMap ?? product.detail_placement_map, normalizedGarmentEvidence),
    absenceConstraints: stringArray(product.absenceConstraints ?? product.absence_constraints),
    invariantDetails: stringArray(product.invariantDetails ?? product.invariant_details),
    uncertaintyNotes: stringArray(product.uncertaintyNotes ?? product.uncertainty_notes),
    garmentEvidence: normalizedGarmentEvidence,
    sareeTruth,
    sareeDrapePlan,
  };
  const creativeDirection = {
    backgroundStyle: stringValue(creative.backgroundStyle ?? creative.background_style, "Clean premium catalog background"),
    studioEnvironment: stringValue(creative.studioEnvironment ?? creative.studio_environment, "Professional fashion shoot environment"),
    lighting: stringValue(creative.lighting, "Soft commercial fashion lighting"),
    cameraPerspective: stringValue(creative.cameraPerspective ?? creative.camera_perspective, "Eye-level fashion perspective"),
    composition: stringValue(creative.composition, "Product-first balanced composition"),
    framing: stringValue(creative.framing, "3:4 portrait framing"),
    mood: stringValue(creative.mood, "Premium, playful, and youthful Gen-Z energy"),
    colorTreatment: stringValue(creative.colorTreatment ?? creative.color_treatment, "Natural product-accurate color"),
    modelStyling: stringValue(creative.modelStyling ?? creative.model_styling, "Minimal styling that does not obscure the product"),
    photographyStyle: stringValue(creative.photographyStyle ?? creative.photography_style, "Commercial fashion photography"),
    propUsage: stringValue(creative.propUsage ?? creative.prop_usage, "No distracting props"),
    shadowStyle: stringValue(creative.shadowStyle ?? creative.shadow_style, "Natural contact shadows"),
    editorialCommercialFeel: stringValue(creative.editorialCommercialFeel ?? creative.editorial_commercial_feel, "Premium e-commerce editorial"),
    lensAndCamera: stringValue(creative.lensAndCamera ?? creative.lens_and_camera, "One consistent full-frame fashion-camera perspective and natural lens rendering"),
    setContinuity: stringValue(creative.setContinuity ?? creative.set_continuity, "One real shoot day: identical set, time of day, light direction, white balance, exposure, and color grade"),
    realismRules: stringValue(
      creative.realismRules ?? creative.realism_rules,
      "Natural skin texture with visible pores and subtle micro-imperfections, anatomically correct and naturally shaped eyes and teeth, anatomically correct hands, realistic fabric physics, optical depth, and no synthetic AI artifacts such as waxy/airbrushed skin, doll-like symmetry, or warped features",
    ),
    suggestedAccessories: stringValue(
      creative.suggestedAccessories ?? creative.suggested_accessories,
      "No additional accessory needed - style with only what the product references show",
    ),
  };
  const modelIdentity = {
    castingDirection: stringValue(model.castingDirection ?? model.casting_direction, "One consistent adult fashion model across all five images, reading as a youthful young adult with a naturally pretty, warm, approachable face"),
    face: stringValue(model.face, "Keep the exact same recognizable face across the complete set - identical face shape, eyes, eyebrows, nose, lips, and jawline as established in Pose 1"),
    faceRealism: stringValue(
      model.faceRealism ?? model.face_realism,
      "Photorealistic human face: natural skin texture with visible pores and subtle micro-imperfections, gentle natural asymmetry (not mirror-symmetric), anatomically correct eyes with realistic catchlights and correctly aligned gaze, and naturally aligned teeth (not uniformly perfect, no extra or missing teeth). Never plastic, waxy, airbrushed, doll-like, or synthetic-looking.",
    ),
    hair: stringValue(model.hair, "Keep one hairstyle across the complete set"),
    makeup: stringValue(model.makeup, "Keep makeup consistent and natural"),
    bodyProportions: stringValue(model.bodyProportions ?? model.body_proportions, "Keep realistic body proportions identical across poses"),
    stylingLock: stringValue(model.stylingLock ?? model.styling_lock, "Keep footwear and accessories identical across every pose"),
  };
  const poses = Array.isArray(rawPoses) ? rawPoses : [];
  const poseSlots = getPoseSlots(productIdentity.garmentFamily);
  const posePlan: StudioPose[] = poseSlots.map((fallback, index) => {
    const candidate = objectValue(poses.find((pose) => objectValue(pose).id === fallback.id) ?? poses[index]);
    return {
      id: fallback.id, title: stringValue(candidate.title ?? candidate.name, fallback.title),
      description: stringValue(candidate.description, fallback.description),
      cameraAngle: stringValue(candidate.cameraAngle ?? candidate.camera_angle, fallback.cameraAngle),
      framing: stringValue(candidate.framing, fallback.framing),
      bodyPosition: stringValue(candidate.bodyPosition ?? candidate.body_position, fallback.bodyPosition),
      handPlacement: stringValue(candidate.handPlacement ?? candidate.hand_placement, fallback.handPlacement),
      expression: stringValue(candidate.expression, fallback.expression),
      highlightedDetails: stringArray(candidate.highlightedDetails ?? candidate.highlighted_details, [...fallback.highlightedDetails]),
      productVisibilityRules: stringArray(candidate.productVisibilityRules ?? candidate.product_visibility_rules, [...fallback.productVisibilityRules]),
      primaryReference: stringValue(candidate.primaryReference ?? candidate.primary_reference, fallback.primaryReference),
      purpose: stringValue(candidate.purpose, fallback.purpose),
      consistencyNotes: stringValue(candidate.consistencyNotes ?? candidate.consistency_notes, fallback.consistencyNotes),
      prompt: stringValue(candidate.prompt, fallback.prompt), enabled: candidate.enabled !== false,
    };
  });
  const stylingPlan = normalizeStylingPlan(raw.stylingPlan ?? raw.styling_plan);
  return { productIdentity, creativeDirection, modelIdentity, stylingPlan, posePlan };
}

export function buildCombinedAnalysisPrompt(args: {
  skuName: string; productDetails: string; category: string; modelDirection: string; sceneDirection: string;
  referenceManifest: Array<{ number: number; role: string }>; housePreferences?: string;
}) {
  const manifest = args.referenceManifest.map(({ number, role }) => `IMAGE ${number}: ${role}`).join("\n");
  return `You are the visual merchandiser and shoot planner for a fashion e-commerce studio.

Analyze EVERY supplied image before answering.
${manifest}

REFERENCE AUTHORITY (highest to lowest):
1. MODEL FACE REFERENCE (if supplied) - the exact, non-negotiable face and identity for the model. Overrides any face you would otherwise design.
2. Region-specific SAREE PRODUCT references (when supplied) - FULL FRONT DRAPE, REAR/BACK DRAPE, BODY/WEAVE DETAIL, FULLY SPREAD PALLU, BORDER/TASSELS and BLOUSE references are each authoritative for their named physical region. A pallu-spread image is pallu truth, never a generic fabric image.
3. FRONT PRODUCT - legacy authoritative front product design.
4. BACK PRODUCT - legacy authoritative back design; never infer the back from the front.
5. FABRIC / PATTERN DETAIL - legacy high-priority truth for body weave, texture, print, embroidery, stitching, trims, and construction; it does not prove pallu artwork.
6. MANNEQUIN / FLAT-LAY SHOT - on a mannequin or dress form, authoritative for worn shape, fit, proportion and drape; laid flat, authoritative for outline, construction, panel layout and length only, since flat cloth shows no worn drape.
7. ADDITIONAL PRODUCT - another source of product truth.
8. STYLE REFERENCE - creative direction only. Never copy its garment, product color, bottoms, logos, or accessories.

Product references are frequently flat-lay, folded, pinned, or shot on a mannequin or dress form. Read the garment through that presentation: infer how each panel, hem, sleeve and closure behaves once it is worn on a live human body, and record that in the profile. The mannequin, dress form, hanger, clips, pins and the flat surface are photography apparatus, never part of the product - never describe them as garment features and never let them appear in the pose plan.

First, determine the garmentFamily from the references: "kurta_or_kurti_set", "saree", "dress", "western_or_casual", or "other".

SKU: ${args.skuName}
Declared category: ${args.category}
User product notes: ${args.productDetails}
Requested model direction: ${args.modelDirection || "one consistent professional adult fashion model"}
Requested scene direction: ${args.sceneDirection || "derive one consistent commercial scene from style references"}

PRINT AND EMBROIDERY GEOMETRY - the part that decides whether the output is this SKU or a lookalike. A sentence like "pink bandhani print with gold embroidery" is not enough to rebuild a garment, so measure the geometry from the highest-resolution image available (normally FABRIC / PATTERN DETAIL) and fill patternGeometry and embroideryGeometry concretely:
- patternGeometry.scale: motif size relative to a body landmark, e.g. "each bandhani dot cluster is roughly 8-10 mm, about one fingernail width; the diagonal band repeats about every 4 cm".
- patternGeometry.orientation and repeat: the direction bands or motifs run (vertical, diagonal at roughly 45 degrees, chevron, mirrored at the centre front) and how often the unit repeats.
- patternGeometry.density: how much ground fabric shows between motifs.
- patternGeometry.placementByPanel: one entry per panel - body front, body back, sleeves, yoke, bottom wear, dupatta - stating how the pattern sits on that panel, because sleeves and body frequently differ.
- patternGeometry.accentColors: the small secondary colours inside the print that are easy to lose, e.g. "orange and yellow dots inside the pink bandhani field".
- patternGeometry.motifInventory: name each distinct motif shape once.
- embroideryGeometry.geometry and motifStructure: the actual internal construction, e.g. "square yoke panel of nested diamond lattice, each diamond about 2 cm, filled with a single floral sprig, bordered by a double scalloped gold line".
- embroideryGeometry.scaleRelativeToGarment: how far the embroidery extends, e.g. "yoke covers from the neckline to roughly 20 percent of the kurta length, shoulder seam to shoulder seam".
- embroideryGeometry.necklineRelation: exactly how the embroidery meets the neckline and where any tie, drawstring or tassel sits relative to it.
Anything you genuinely cannot measure goes in uncertaintyNotes - never guess a geometry.

Build a precise Product Identity Profile. Perform a rigorous geographic evidence audit for construction, closures and decoration placement. Break the garment into specific physical regions. For stitched garments use (e.g. front neckline, front chest/yoke, front body, front hem, center back, back neckline, back body, back hem, left side construction, right side construction, left sleeve/armhole, right sleeve/armhole, waist, bottom wear front, bottom wear back). For sarees use (e.g. inner pallu, outer pallu, pallu border, body upper border, body lower border, chest drape, front pleats, waist tuck, unstitched blouse piece).
  For each region, record its evidence in garmentEvidence:
  - region: the physical location.
  - sourceRole: the exact role from the manifest that proves this observation (for example "front", "back", "saree_back_drape", "fabric_pattern", or "saree_pallu_spread"). Never leave it blank for a confirmed observation.
  - state: "confirmed" (clearly visible in an authoritative reference), "confirmed_absent" (clearly proven to not exist there), or "unknown" (not visually proven either way).
- visibleConstruction: explicitly what construction (seams, slits, folds) is proven there.
- visibleDecoration: explicitly what trim, lace, embroidery, or print is proven there.
- closures: any buttons, ties, zippers.
- explicitlyAbsent: what is explicitly proven NOT to be there.
- uncertainty: what cannot be seen or is ambiguous.

Crucial Evidence Rules:
  - UNKNOWN DOES NOT MEAN INFER. If left/right side construction cannot be established, record state as "unknown" and state explicitly in uncertainty that it is unproven.
  - Do not use words like "probably", "likely", "usually", "typically", "symmetrical", or "same as the other side". If it is not proven, it is unknown.
  - Do not extrapolate decoration. If gold lace is confirmed at the front hem, but the side seam is unknown, do not assume the lace continues. Record the side seam as unknown.
  - When a BACK PRODUCT or REAR/BACK DRAPE reference is supplied, include separate back neckline, back body, and back hem entries sourced from that direct back role. If a rear region is hidden or unresolved, record it as unknown with that sourceRole; do not fill it from the front image.
  - A rear/back entry in detailPlacementMap is allowed only when the matching rear region is "confirmed" and the named decoration/construction is explicitly visible in a direct BACK PRODUCT, REAR/BACK DRAPE, or matching BLOUSE BACK reference. Do not copy front lace, trim, borders, closures, or motifs into a rear placement lock.
  Fill detailPlacementMap with only source-supported region-specific hard locks and absenceConstraints with negative product facts as well for backward compatibility.

SCENE AUTHORITY: when a STYLE REFERENCE image is supplied, that image defines the shoot. Describe what it actually shows - wall colour and finish, floor or ground surface, every prop and its placement, plant or furniture presence, light direction and quality, camera height and distance, depth of field, colour grade - concretely enough to rebuild that set from the description alone. Never replace it with a generic "clean premium studio backdrop": a plain seamless-paper description when the reference shows a styled set is a failure of this analysis. A requested scene direction refines mood, styling and props on top of the referenced set; it does not replace the referenced backdrop. Only when no style reference is supplied does the requested scene direction define the scene by itself.

Build a Creative Direction Profile from style references, but never allow style to alter the product. Lock one lens family, camera height, perspective, exposure, white balance, color grade, light direction, shadow behavior, set geometry, and time-of-day so the results read as contact sheets from one real professional shoot. In realismRules, explicitly require natural skin texture with visible pores, anatomically correct and naturally shaped eyes and teeth, and no synthetic AI artifacts.

Define one Model Identity Profile with concrete, specific facial detail - not generic filler. Describe visible appearance attributes only; never identify, name, or infer personal attributes of anyone depicted.
CASTING BRIEF: an adult fashion model who reads as a youthful young adult - late teens to early twenties in appearance - with a naturally pretty, warm, approachable face and a genuine friendly expression rather than a severe or corporate look. Record this in modelIdentity.castingDirection. This brief describes the casting look only: when a MODEL FACE REFERENCE image is supplied, that face governs completely and must not be restyled, aged, slimmed, lightened or "improved" to fit the brief. If a MODEL FACE REFERENCE image is present in the manifest above, describe the face shape, eye shape and color, eyebrow shape, nose, lips, and jawline visible in that image in modelIdentity.face - do not design a different face, and note in modelIdentity.face that these attributes must match the reference image exactly. If no MODEL FACE REFERENCE was supplied, design one specific face and describe it with the same level of concrete detail, specific enough that the exact same person is recognizable in every pose. In modelIdentity.faceRealism, lock the photorealism bar for every pose: natural skin texture with visible pores and subtle micro-imperfections, gentle natural asymmetry, anatomically correct eyes with realistic catchlights and correctly aligned gaze, and naturally aligned teeth (not uniformly perfect, no extra or missing teeth) - never a plastic, waxy, airbrushed, or symmetric "AI face". Lock skin tone, hair, makeup, body proportions, accessories and footwear the same way across all five images.

Overall pose energy: every one of the five poses should feel playful, warm, and Gen-Z-friendly - natural and full of genuine attitude, never stiff, robotic, or overly corporate-catalog.

STYLING PLAN - decide what this model wears alongside the garment, and fill stylingPlan. Read both sources before choosing: the product references decide what the garment already includes, and the style reference decides the aesthetic the shoot is aiming at. State each choice specifically enough that a stylist could pull it from a shelf and repeat it identically in every frame - "oxidised silver jhumkas roughly 4 cm with a small matching cuff on the right wrist" is usable, "ethnic jewellery" is not.
- footwear: one specific pair - style, heel height, colour, finish - that suits the garment length and hem. Say if the product references already show footwear that must be kept instead.
- jewellery: choose the metal and family deliberately - oxidised silver, temple or antique gold, polished gold, kundan or polki, pearl, contemporary minimal - and name each piece worn (earrings, neckpiece, bangles, rings, maang tikka, nose ring). Pick what the reference theme and the garment's own embellishment support: heavy gold against dense zari competes, oxidised silver suits earthy prints and handloom, minimal metal suits pastels and modern indo-western.
- ornaments: any remaining accessory decisions - belt, potli or bag, dupatta drape treatment, waist chain, hair ornament - or an explicit "none" so nothing is invented later.
- makeup and hair: one look each, held across all five frames.
- stylingNotes: the rule a stylist would need to avoid mistakes on this specific product, for example "keep the right wrist bare so the sleeve embroidery stays visible" or "no neckpiece over the embroidered yoke".
- themeInterpretation: one sentence naming the aesthetic you read from the style reference and why this styling serves it.
${args.housePreferences ? `HOUSE STYLING PREFERENCE - drawn from styling plans this team has actually approved for this category, showing where they rewrote an earlier proposal:
${args.housePreferences}
Treat this as the house taste and start from it. It ranks below product truth and below the style reference: if this product or this reference genuinely calls for something else, choose what the images support and say why in stylingNotes. Never let it override a detail the product references show.
` : ""}Every choice is a styling addition only: it must never be treated as part of the garment, must never hide, replace or contradict a detail from the product references, and must never contradict detailPlacementMap or absenceConstraints. When the product references already show footwear or accessories that ship with the product, keep those and say so rather than replacing them.

Accessory styling suggestion: look at what footwear and accessories (if any) the product references actually show. If the product's own footwear/bag/accessories are missing, incomplete, or would not read well on camera, propose ONE tasteful, trend-right, Gen-Z-appropriate addition (for example a specific footwear style or a small bag) in creativeDirection.suggestedAccessories, described specifically enough for a stylist to execute identically across all five poses. Only suggest an addition when it genuinely fits the pose plan and category - if the product references already show adequate footwear/accessories, or nothing suits the shot, leave creativeDirection.suggestedAccessories empty. This is a styling addition only: it must never be treated as part of the garment, and it must never contradict detailPlacementMap or absenceConstraints.

Create exactly five product-specific camera setups in one coherent commercial coverage sequence, in this order and with these ids: full_front, angled, back, creative, closeup. They are not five unrelated concepts. Every pose must specify exact framing, body position, hand placement, expression, product visibility rules, reference authority, highlighted details, purpose, consistency note, and a self-contained prompt that repeats the relevant location locks and absence constraints.

- full_front: square, unobstructed head-to-toe hero; establishes face/hair/styling/footwear/scene/lighting anchor with playful, confident Gen-Z energy.
- angled: best side or three-quarter orientation for THIS garment; for stitched garments, reveal side construction; for sarees, reveal drape depth and pallu fall. Show existing slits or pockets only when references prove they exist; never invent, extend, or extrapolate decoration into unknown side regions.
- back: true head-to-toe rear view, shoulders and hips fully away; uploaded BACK is the sole rear-construction authority, or rear drape for sarees. For outfits with a dupatta or shawl, the dupatta must be draped forward over arms or front so the rear garment (neckline, back panel, embroidery, hem) is 100% unobstructed and visible. The studio set, backdrop wall, lighting, and model identity must strictly match the other poses.
- creative: playful, scroll-stopping Gen-Z editorial movement tailored to this garment while keeping product completely readable. For sarees, use safe pallu movement tailored to its fabric physics.
- closeup: a genuine zoomed-in face-to-chest or face-to-waist shot (never a repeat of the full-body hero framing) pairing a beautiful, cute, Gen-Z-style face with a genuine, natural expression AND one sharp, clearly visible real product detail (embroidery, neckline, drape, print, or fabric texture).

If the garmentFamily is "saree", you MUST also generate sareeTruth and sareeDrapePlan inside the JSON root.
sareeTruth: Record exact base and secondary colours; fabric family; weave/lattice geometry; texture, shine and transparency; every peacock/floral/other motif with its scale, orientation, repeat, density and placement by body/pallu/border; separate upper/lower border widths, construction and colours; the exact region where the pallu starts plus its artwork, motif density and orientation; tassel colour, construction and spacing; blouse colour/fabric/front/back/neckline/sleeves/ties/closures; and fabric weight, stiffness, fluidity and expected fall. Add regionEvidence entries with region, sourceRole, confirmed/confirmed_absent/unknown state and the same evidence fields as garmentEvidence. Unknown must stay unknown: never mirror or extrapolate decoration into an unproven region.
sareeDrapePlan: Choose a baseDrapeFamily (e.g., "shoulder-side/open-pallu" or "shoulder-side/pleated-pallu"), frontPleatTreatment, palluShoulderPlacement, handInteraction, borderVisibility, and poseSpecificDrapeState (e.g. how the angled pose shows the pallu fall).

posePlan: Design 5 distinct poses (full_front, angled, back, creative, closeup). For each, specify the cameraAngle, framing, bodyPosition, handPlacement, expression, and write a detailed photorealistic 'prompt' that combines these elements with the product and model identity.
CRITICAL: Every individual 'prompt' MUST be completely self-contained. The image generator does not see the other poses. You MUST explicitly describe the model's exact face, hair, skin tone, makeup, styling, bottom wear, footwear, and the exact studio/scene background and lighting inside EVERY SINGLE 'prompt' string. NEVER use phrases like "consistent with previous poses", "same as full_front", or "locked scene" inside the 'prompt' string itself.

Across all five, ONLY pose, angle, framing, and expression may change. Exact product, colors, pattern, bottom wear, face, hairstyle, makeup, accessories, footwear, scene, lighting, shadows, camera/lens feel, and color treatment remain locked.

Return STRICT JSON only:
{"productIdentity":{"garmentFamily":"","category":"","mainColor":"","secondaryColors":[],"fabric":"","pattern":"","print":"","patternGeometry":{"type":"","scale":"","orientation":"","density":"","repeat":"","placementByPanel":[],"accentColors":[],"motifInventory":[]},"embroideryGeometry":{"placement":"","geometry":"","motifStructure":"","scaleRelativeToGarment":"","colorsAndMaterial":"","borders":"","necklineRelation":""},"texture":"","neckline":"","sleeveType":"","length":"","fit":"","silhouette":"","frontConstruction":"","backConstruction":"","buttons":"","zippers":"","pockets":"","embroidery":"","logos":"","accessoriesIncluded":"","bottomWearDetails":"","footwearDetails":"","detailPlacementMap":[],"absenceConstraints":[],"invariantDetails":[],"uncertaintyNotes":[],"garmentEvidence":[{"region":"","state":"unknown","visibleConstruction":"","visibleDecoration":"","closures":"","explicitlyAbsent":[],"uncertainty":""}]},"sareeTruth":{"body":{"mainFabric":"","weave":"","weaveGeometry":"","texture":"","transparency":"","shine":"","baseColor":"","secondaryColors":[],"pattern":"","motifInventory":[],"motifScale":"","motifOrientation":"","motifRepeat":"","motifDensity":"","motifPlacement":"","embellishment":"","bodyOrientation":""},"borders":{"upperBorder":"","lowerBorder":"","borderWidth":"","upperBorderWidth":"","lowerBorderWidth":"","borderColors":"","construction":"","motifGeometry":"","edgeTreatment":"","continuityRules":"","tasselColor":"","tasselConstruction":"","tasselSpacing":""},"pallu":{"hasDistinctPallu":false,"startingRegion":"","baseColor":"","motifInventory":[],"motifScale":"","motifOrientation":"","motifRepeat":"","motifDensity":"","borders":"","artwork":"","zari":"","embroidery":"","tassels":"","edgeTreatment":"","visualOrientation":"","evidenceReferences":"","uncertainty":""},"pleatZone":{"patternBehavior":"","borderBehavior":"","embellishmentBehavior":"","hasSpecialPanel":false},"blouse":{"hasBlouse":false,"color":"","fabric":"","frontConstruction":"","backConstruction":"","neckline":"","sleeves":"","ties":"","closure":"","embroidery":"","border":"","pattern":"","fit":"","isUnstitchedPiece":false},"physics":{"weight":"","stiffness":"","fluidity":"","transparency":"","shine":"","creaseBehavior":"","expectedFall":""},"regionEvidence":[{"region":"","state":"unknown","visibleConstruction":"","visibleDecoration":"","closures":"","explicitlyAbsent":[],"uncertainty":""}]},"sareeDrapePlan":{"baseDrapeFamily":"","shoulderSide":"","waistTuck":"","frontPleatTreatment":"","palluShoulderPlacement":"","openOrPleatedPallu":"","palluSpread":"","palluFallDirection":"","palluVisibleLength":"","handInteraction":"","movementAmount":"","pinningBehavior":"","borderVisibility":"","blouseVisibility":"","coverageConstraints":"","poseSpecificDrapeState":""},"creativeDirection":{"backgroundStyle":"","studioEnvironment":"","lighting":"","cameraPerspective":"","composition":"","framing":"","mood":"","colorTreatment":"","modelStyling":"","photographyStyle":"","propUsage":"","shadowStyle":"","editorialCommercialFeel":"","lensAndCamera":"","setContinuity":"","realismRules":"","suggestedAccessories":""},"modelIdentity":{"castingDirection":"","face":"","faceRealism":"","hair":"","makeup":"","bodyProportions":"","stylingLock":""},"stylingPlan":{"footwear":"","jewellery":"","ornaments":"","makeup":"","hair":"","stylingNotes":"","themeInterpretation":""},"posePlan":[{"id":"full_front","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""},{"id":"angled","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""},{"id":"back","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""},{"id":"creative","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""},{"id":"closeup","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""}]}  `;
}

export const CONSISTENCY_RULES = [
  "Original product references always outrank generated images and style references.",
  "If a MODEL FACE REFERENCE image was supplied, it is the exact, non-negotiable face and identity for the model in every pose, including pose 1 - reproduce it as closely as photographically possible and never substitute, average, or beautify a different face.",
  "Keep the same model face, skin tone, hair, body proportions, makeup, accessories, and footwear across all five poses.",
  "Every face must be photorealistic and anatomically correct: natural skin texture with visible pores, correctly shaped and aligned eyes with realistic catchlights, and naturally aligned teeth. Never render a distorted, warped, blurred, or plastic/waxy/mirror-symmetric \"AI face\".",
  "Keep exact garment colors, fabric, texture, pattern scale and placement, print, embroidery, logos, stitching, trims, buttons, zippers, pockets, fit, silhouette, and length.",
  "Keep the exact bottom wear and included accessories shown in product references.",
  "Use the back product image as the sole authority for the back pose.",
  "Style references control only background, lighting, composition, camera, mood, and creative treatment.",
  "Never add text, random logos, extra layers, duplicate people, or unreferenced garment elements.",
  "Treat detailPlacementMap and absenceConstraints as hard locks: never relocate, mirror, extend, add, or remove a garment detail.",
  "Keep the identical studio backdrop wall color, texture, flooring, and lighting established in Pose 1 across all poses 2-5 without adding new props (no brass urlis, urns, flower petals, or altered staircases).",
  "In back poses, dupattas or shawls must be draped over the arms or in front so the entire back of the garment is 100% visible and unobstructed.",
  "The optional stylist accessory suggestion (creativeDirection.suggestedAccessories) may be added only when present, and must stay identical and product-appropriate across every pose - never invent a second, different accessory and never let it hide or replace any garment detail, bottom wear, or footwear shown in the product references.",
];

// Bumping this invalidates cached/stored analyses (Studio's analysis_cache and each
// catalog variant's stored ai_analysis) so prompt/schema changes here (the playful Gen-Z
// pose plan, the accessory-suggestion field, the face/photorealism locks, the
// model-face-reference support, and the corrected zoomed-IN pose 5) take effect on the
// next analysis run instead of quietly reusing a pre-change cache hit.
// v15 adds source-role provenance to regional evidence. Analyses made before it
// can say that a rear detail exists without proving that the back image showed
// it, so cache reuse would reintroduce front-to-back hallucinations.
// v16 ensures unobstructed rear garment visibility (dupatta forward drape) and strict backdrop continuity.
export const ANALYSIS_VERSION = "generation-session-v16-rear-backdrop-continuity";

export function smallHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildColorwayAnalysisPrompt(args: {
  skuName: string;
  garmentFamily: string;
  referenceManifest: Array<{ number: number; role: string }>;
  baseMainColor?: string;
  baseSecondaryColors?: string[];
}) {
  const manifest = args.referenceManifest.map(({ number, role }) => `IMAGE ${number}: ${role}`).join("\n");
  return `You are a fashion catalog colorist and merchandiser.
This product SKU is a colorway variant of an already-analyzed catalog collection of garment style "${args.garmentFamily}".
The structural garment cut, pattern geometry, styling plan, and pose plan are already established.
Analyze the supplied reference image(s) to identify ONLY the colorway details for this SKU:

SKU: ${args.skuName}
${manifest}

Return JSON with this exact schema:
{
  "mainColor": "exact primary dominant color name (e.g. Royal Blue, Crimson Red, Mustard Yellow)",
  "secondaryColors": ["secondary accent color", "border/trim color", "underlying tone"],
  "accentColors": ["small secondary accent colors in motifs or embroidery"]
}`;
}

export function mergeVariantColorways(
  baseAnalysis: ReturnType<typeof normalizeAnalysis>,
  colorResult: JsonRecord,
  _variantSkuName?: string
): ReturnType<typeof normalizeAnalysis> {
  const mainColor = String(colorResult.mainColor || colorResult.primaryColor || colorResult.main_color || "").trim();
  const secondary = (colorResult.secondaryColors || colorResult.secondary_colors) as unknown[];
  const secondaryColors = Array.isArray(secondary)
    ? secondary.map((c) => String(c || "").trim()).filter(Boolean)
    : [];
  const accents = (colorResult.accentColors || colorResult.accent_colors) as unknown[];
  const accentColors = Array.isArray(accents)
    ? accents.map((c) => String(c || "").trim()).filter(Boolean)
    : [];

  const cloned = structuredClone(baseAnalysis);

  if (mainColor) {
    cloned.productIdentity.mainColor = mainColor;
  }
  if (secondaryColors.length) {
    cloned.productIdentity.secondaryColors = secondaryColors;
  }

  if (cloned.productIdentity.patternGeometry && accentColors.length) {
    cloned.productIdentity.patternGeometry.accentColors = accentColors;
  }

  if (cloned.productIdentity.sareeTruth) {
    if (mainColor) {
      cloned.productIdentity.sareeTruth.body.baseColor = mainColor;
      cloned.productIdentity.sareeTruth.borders.borderColors = secondaryColors.length ? secondaryColors.join(", ") : mainColor;
      cloned.productIdentity.sareeTruth.pallu.baseColor = mainColor;
    }
    if (secondaryColors.length) {
      cloned.productIdentity.sareeTruth.body.secondaryColors = secondaryColors;
    }
  }

  return cloned;
}

