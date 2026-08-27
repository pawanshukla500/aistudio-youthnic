import type { Id } from "../../lib/backend";
// Aliased rather than redeclared: one definition of the seven fields, shared by
// the analysis contract, both features, and the editor that renders them.
import type { StylingPlan as StylingPlanProfile } from "../../lib/stylingPlan";

export type ProductReferenceRole =
  | "front"
  | "back"
  | "fabric_pattern"
  | "mannequin"
  | "additional_product"
  | "saree_front_drape"
  | "saree_back_drape"
  | "saree_body_detail"
  | "saree_pallu_spread"
  | "saree_border_tassels"
  | "saree_blouse_front"
  | "saree_blouse_back_piece";
// "model_identity" (not "model_reference") to match the existing planning_assets_asset_role_check
// constraint in Supabase - that value was already reserved there; introducing a different string
// here would fail the DB insert with a check-constraint violation.
export type ReferenceRole = ProductReferenceRole | "style_reference" | "model_identity";

export type StudioReference = {
  id: string;
  role: ReferenceRole;
  file: File;
  previewUrl: string;
  uploadedId?: Id<"productReferences">;
  storageBackend?: "firebase" | "supabase" | "external";
  storagePath?: string;
  downloadUrl?: string;
  hash?: string;
};

export type StudioPose = {
  id: string;
  title: string;
  description: string;
  cameraAngle: string;
  highlightedDetails: string[];
  primaryReference: string;
  purpose: string;
  framing?: string;
  bodyPosition?: string;
  handPlacement?: string;
  expression?: string;
  productVisibilityRules?: string[];
  consistencyNotes?: string;
  prompt: string;
  enabled: boolean;
};

// Mirrors the geometry profiles the analysis stage now produces. Optional so a
// session analysed before v9 still satisfies the type.
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
  regionEvidence: Array<{
    region: string;
    state: "confirmed" | "confirmed_absent" | "unknown";
    visibleConstruction: string;
    visibleDecoration: string;
    closures: string;
    explicitlyAbsent: string[];
    uncertainty: string;
  }>;
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
  garmentFamily?: string;
  category: string;
  mainColor: string;
  secondaryColors: string[];
  fabric: string;
  pattern: string;
  print: string;
  patternGeometry?: PatternGeometryProfile;
  embroideryGeometry?: EmbroideryGeometryProfile;
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
  sareeTruth?: SareeTruthProfile;
  sareeDrapePlan?: SareeDrapePlan;
};

export type CreativeDirectionProfile = {
  backgroundStyle: string;
  studioEnvironment: string;
  lighting: string;
  cameraPerspective: string;
  composition: string;
  framing: string;
  mood: string;
  colorTreatment: string;
  modelStyling: string;
  photographyStyle: string;
  propUsage: string;
  shadowStyle: string;
  editorialCommercialFeel: string;
  lensAndCamera: string;
  setContinuity: string;
  realismRules: string;
  suggestedAccessories: string;
};

export type StudioAnalysis = {
  sessionId: Id<"generationSessions">;
  referenceIds?: Id<"productReferences">[];
  analysisFingerprint: string;
  productHash: string;
  referenceHash: string;
  productIdentity: ProductIdentityProfile;
  creativeDirection: CreativeDirectionProfile;
  modelIdentity: Record<string, string>;
  stylingPlan?: StylingPlanProfile;
  posePlan: StudioPose[];
  cacheHit: boolean;
  // Returned when Gemini discovers a saree from a broad category. The analysis is
  // intentionally not queueable until the member maps the authoritative pallu
  // evidence and reruns it under the saree reference policy.
  requiresSareeEvidence?: boolean;
  sareeEvidenceIssues?: string[];
};

export type { StylingPlanProfile };

export type OutputOptions = {
  model: "gpt-image-2" | "gpt-image-1.5" | "gpt-image-1" | "gpt-image-1-mini" | "reve-2.1-image";
  modelIdentity: string;
  aspectRatio: string;
  imageSize: string;
  quality: "low" | "medium" | "high";
  backgroundStyle: string;
  poseQa: boolean;
};
