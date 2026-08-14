import type { Id } from "../../lib/backend";

export type ProductReferenceRole = "front" | "back" | "fabric_pattern" | "mannequin" | "additional_product";
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

export type ProductIdentityProfile = {
  category: string;
  mainColor: string;
  secondaryColors: string[];
  fabric: string;
  pattern: string;
  print: string;
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
  posePlan: StudioPose[];
  cacheHit: boolean;
};

export type OutputOptions = {
  model: "gpt-image-2" | "gpt-image-1.5" | "gpt-image-1" | "gpt-image-1-mini";
  modelIdentity: string;
  aspectRatio: string;
  imageSize: string;
  quality: "low" | "medium" | "high";
  backgroundStyle: string;
  poseQa: boolean;
};
