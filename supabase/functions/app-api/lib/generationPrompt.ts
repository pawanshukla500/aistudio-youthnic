import {
  CONSISTENCY_RULES,
  normalizeStylingPlan,
  type JsonRecord,
  type StudioPose,
} from "./profiles.ts";
import { roleLabel } from "./referencePolicy.ts";

export type PromptReference = { role: string };

// Analyses cached before the geometry profiles existed still flow through here,
// so both readers fall back to the flat legacy fields instead of emitting null.
function patternGeometryOf(product: JsonRecord) {
  const geometry = product?.patternGeometry && typeof product.patternGeometry === "object" ? product.patternGeometry as JsonRecord : {};
  return Object.keys(geometry).length ? geometry : { type: String(product?.pattern || ""), print: String(product?.print || "") };
}

function embroideryGeometryOf(product: JsonRecord) {
  const geometry = product?.embroideryGeometry && typeof product.embroideryGeometry === "object" ? product.embroideryGeometry as JsonRecord : {};
  return Object.keys(geometry).length ? geometry : { placement: String(product?.embroidery || "") };
}

export function composeGenerationPrompt(args: {
  skuName: string; productDetails: string; pose: StudioPose & { poseNumber: number };
  session: JsonRecord; references: PromptReference[]; correction?: string; learnings?: string;
}) {
  const product = args.session.productIdentity as JsonRecord;
  const creative = args.session.creativeDirection as JsonRecord;
  const model = args.session.modelIdentity as JsonRecord;
  // Null for sessions analysed before v10. They keep the old accessory line
  // instead of being handed generated defaults dressed up as stylist decisions.
  const styling = args.session.stylingPlan ? normalizeStylingPlan(args.session.stylingPlan) : null;
  const rules = Array.isArray(args.session.consistencyRules) ? args.session.consistencyRules.map(String) : CONSISTENCY_RULES;
  const placement = Array.isArray(product?.detailPlacementMap) ? product.detailPlacementMap.map(String) : [];
  const absent = Array.isArray(product?.absenceConstraints) ? product.absenceConstraints.map(String) : [];
  const evidence = Array.isArray(product?.garmentEvidence) ? product.garmentEvidence as JsonRecord[] : [];
  
  const isSaree = product?.garmentFamily === "saree";
  if (isSaree && (!product.sareeTruth || typeof product.sareeTruth !== "object" || !product.sareeDrapePlan || typeof product.sareeDrapePlan !== "object")) {
    throw new Error("Stored saree analysis is incomplete or outdated. Reanalyse the product references before generation.");
  }
  const sareeTruth = isSaree ? product.sareeTruth as JsonRecord : undefined;
  const sareeDrapePlan = isSaree ? product.sareeDrapePlan as JsonRecord : undefined;
  const manifest = args.references.map((reference, index) => `IMAGE ${index + 1}: ${roleLabel(reference.role)}`).join("\n");
  const hasApprovedAnchor = args.references.some((reference) => reference.role === "approved_pose");
  const hasModelReference = args.references.some((reference) => reference.role === "model_identity");
  const faceVisible = args.pose.id !== "back";
  const allowedDelta = [
    `pose/body position: ${args.pose.bodyPosition}`,
    `camera angle: ${args.pose.cameraAngle}`,
    `framing: ${args.pose.framing}`,
    `expression: ${args.pose.expression}`,
  ];
  return `Create ONE premium photorealistic fashion e-commerce photograph for ${args.skuName}.

REFERENCE MANIFEST IN UPLOAD ORDER:
${manifest}

EDIT GOAL:
Place the exact uploaded product on one consistent professional adult fashion model and create Pose ${args.pose.poseNumber}: ${args.pose.title}. The finished image must look like the same real professional photoshoot as the other four images.

LOCKED SUBJECT - MUST NOT CHANGE:
${JSON.stringify(model)}
- Same recognizable face, skin tone, body proportions, hairstyle, hair length/color, makeup, accessories and footwear across the complete set.
- Pose 1 is only the subject/scene anchor for later poses. It never overrides original product references.

FACE & IDENTITY LOCK - HIGHEST PRIORITY:
${hasModelReference
    ? `The image labeled MODEL FACE REFERENCE in the reference manifest above is the exact, non-negotiable face and identity for this model in EVERY pose, including this one - it outranks every other face source, including the approved-pose anchor. Reproduce it as close to pixel-identical as photographically possible: identical facial bone structure, eyes (shape, color, spacing), eyebrows, nose, lips, jawline, skin tone and texture, and hairstyle. Do not idealize, beautify, average, restyle, or blend it with any other face - this must read as the same real person from that reference photo, not merely a similar-looking model.${hasApprovedAnchor ? " Use the APPROVED POSE 1 image only for scene, lighting, and styling continuity - never as a face source." : ""}`
    : hasApprovedAnchor
      ? "The image labeled APPROVED POSE 1 in the reference manifest above is the exact, non-negotiable ground truth for this model's identity. Reproduce the identical facial bone structure, eye shape and color, eyebrow shape, nose, lips, jawline, skin tone and texture, and hairstyle seen in that image - do not idealize, beautify, average, or drift toward a different face."
      : "This is the hero pose and establishes the model identity anchor for the whole shoot. Commit to one specific, photorealistic, naturally beautiful adult face exactly as described in modelIdentity above - every later pose in this set must reproduce this same face."}
${faceVisible
    ? "The face must read as a real photographed person: natural skin texture with visible pores and subtle micro-imperfections, gentle natural asymmetry, anatomically correct and naturally shaped eyes with realistic catchlights and correctly aligned gaze, and naturally aligned teeth (not uniformly perfect, no extra or missing teeth). Never render a plastic, waxy, over-smoothed, mirror-symmetric, or otherwise synthetic \"AI face\". Never distort, warp, blur, or misalign eyes, eyebrows, nose, lips, ears, or teeth."
    : "The face is turned away and is not the subject of this pose - keep hair color/style, skin tone, and body proportions consistent with the identity anchor."}

LOCKED PRODUCT - MUST NOT CHANGE:
${JSON.stringify(product)}
${isSaree ? `SAREE TRUTH - CRITICAL:
${JSON.stringify(sareeTruth)}
SAREE DRAPE PLAN:
${JSON.stringify(sareeDrapePlan)}` : ""}
User notes: ${args.productDetails}
Reference authority: original product images always outrank generated anchors and style references. FRONT controls front construction; BACK solely controls rear construction; FABRIC/PATTERN resolves material and small construction; a MANNEQUIN/DRESS-FORM shot resolves worn shape, fit, proportion and drape, while a FLAT-LAY resolves outline, construction, panel layout and length only; ADDITIONAL supports product truth; STYLE controls art direction only.${isSaree ? " For sarees, FULL SAREE FRONT and REAR/BACK DRAPE control their complete worn regions; SAREE BODY/WEAVE controls body colour, weave and motif geometry; FULLY SPREAD PALLU alone controls the pallu boundary and artwork; BORDER/TASSELS controls edge geometry and tassel construction; BLOUSE FRONT/BACK controls only the matching blouse region. Never classify or treat the pallu spread as generic body fabric." : ""}
- Product references may be flat-lay, folded, pinned or shot on a mannequin or dress form. Rebuild the garment as it falls on a live human body, and never render a mannequin, dress form, hanger, clip, pin, prop stand, or the flat background surface in the output.
${isSaree ? `- SAREE SPECIFIC RULES: Pallu artwork stays on the pallu, never bleed the border into the main body, do not duplicate the pallu into multiple loose cloth panels, border width stays identical, follow the drape plan explicitly.` : ""}

GARMENT TRUTH CONTRACT (EVIDENCE BY REGION):
${evidence.length ? evidence.map((e) => `- Region ${String(e.region).toUpperCase() || "UNKNOWN"}: [State: ${String(e.state)}]
  Construction: ${e.visibleConstruction || "None explicitly proven"}
  Decoration/Trim: ${e.visibleDecoration || "None explicitly proven"}
  Closures: ${e.closures || "None"}
  Absent: ${(Array.isArray(e.explicitlyAbsent) ? e.explicitlyAbsent : []).join(", ") || "None"}
  Uncertainty: ${e.uncertainty || "None"}`).join("\n") : ""}
${placement.length ? `Detail placement hard locks:\n${placement.map((rule) => `- ${rule}`).join("\n")}` : "- Preserve every visible detail only in the exact region shown by the authoritative image."}
${absent.length ? `Negative-evidence hard locks:\n${absent.map((rule) => `- ${rule}`).join("\n")}` : "- Add no button, closure, tassel/latkan, trim, embroidery, pocket, logo, jewelry or hardware unless the authoritative product image proves it exists at that location."}

CRITICAL EVIDENCE RULES:
- If a region's state is "confirmed_absent", do not render the decoration, trim, closure, or specialized construction represented by that region.
- If a region's state is "unknown", it MUST be rendered in plain base fabric without any unproven decoration, trim, or specialized construction. UNKNOWN DOES NOT MEAN INFER.
- Do NOT extrapolate decoration. If trim is confirmed at the front hem but the side seam is unknown, do not extend the trim up the side.

PRINT AND EMBROIDERY GEOMETRY LOCK - the difference between photographing THIS garment and inventing a similar one:
Pattern geometry: ${JSON.stringify(patternGeometryOf(product))}
Embroidery geometry: ${JSON.stringify(embroideryGeometryOf(product))}
- The FABRIC / PATTERN DETAIL image is the pixel-level authority for motif shape, motif scale, spacing, orientation and embroidery construction. Read the geometry off that image rather than reproducing a generic version of the same craft or style.
- Reproduce motifs at the stated physical scale relative to the body. Do not enlarge, simplify, stylize, redraw or "clean up" a motif, and do not reduce a dense print to fewer, larger shapes.
- Keep the print's orientation, repeat interval and density identical, including where panels differ - body, sleeves, yoke, bottom wear and dupatta each keep their own stated treatment.
- Keep every accent colour inside the print. Small secondary-colour details within a motif field are part of this product's identity, not noise to average away.
- Reproduce embroidery as the same internal geometry: same lattice or motif structure, same count and rhythm of repeated units, same borders, same coverage area, and the same relationship to the neckline, tie, drawstring and tassel.
- If a region is not clearly resolved in any reference, render it plainly in the garment's base fabric, colour and texture only. Never copy a neighbouring panel's motif arrangement into it, never mirror or continue decoration across it, and never invent decoration to fill it - unresolved means undecorated, not "probably like the panel next to it".

LOCKED ART DIRECTION - MUST NOT CHANGE BETWEEN POSES:
${JSON.stringify(creative)}
- Build the set described above, and where a STYLE REFERENCE or APPROVED POSE 1 image is supplied, rebuild the scene those images actually show: the same wall colour and finish, floor or ground surface, props and their placement, light direction and quality, camera height and distance, depth of field and colour grade. Do not substitute a neutral seamless studio backdrop, a white or grey sweep, or a different set that merely feels premium.

${styling ? `APPROVED STYLING PLAN - the stylist's decisions for this shoot, identical in all five frames:
- Footwear: ${styling.footwear}
- Jewellery: ${styling.jewellery}
- Ornaments and accessories: ${styling.ornaments}
- Makeup: ${styling.makeup}
- Hair: ${styling.hair}
${styling.stylingNotes ? `- Stylist notes: ${styling.stylingNotes}` : ""}
${styling.themeInterpretation ? `- Theme being served: ${styling.themeInterpretation}` : ""}
- Style the model with exactly these pieces - the same metal, the same count, the same placement in every frame. Do not add a necklace, bangle, ring, belt, bag, hair ornament or any other accessory this plan does not list, and do not drop one it does.
- This is styling only. It never becomes part of the garment, never hides or replaces a garment detail, bottom wear or footwear shown in the product references, and never contradicts the placement or absence locks above.
${creative?.suggestedAccessories ? `- Legacy stylist note (subordinate to the plan above): ${creative.suggestedAccessories}` : ""}`
  : `STYLING ADDITION (optional, locked once chosen):
${creative?.suggestedAccessories ? `The stylist has proposed adding: ${creative.suggestedAccessories}. Style the model with exactly this addition, identical across every pose. It is a styling choice only - it must never hide, replace, or contradict the garment, bottom wear, or footwear shown in the product references.` : "No additional styling accessory is needed for this product - use only what the product references show."}`}

ALLOWED DELTA - THE ONLY THINGS THAT MAY CHANGE:
${allowedDelta.map((value) => `- ${value}`).join("\n")}
- Hand placement: ${args.pose.handPlacement}
- Everything not named here stays locked.

POSE REQUIREMENT:
Description: ${args.pose.description}
Details to highlight: ${args.pose.highlightedDetails.join(", ")}
Visibility rules: ${args.pose.productVisibilityRules.join("; ")}
Purpose: ${args.pose.purpose}
Consistency notes: ${args.pose.consistencyNotes}
${args.correction ? `
CORRECTION REQUIRED FROM PREVIOUS QA ATTEMPT:
${args.correction}
- Address this correction completely and literally. Do not change anything else that was working.` : ""}
${args.learnings ? `
CONTINUOUS LEARNING ADVISORY (PAST QA FEEDBACK FOR THIS CATEGORY):
${args.learnings}
- These are historical corrections from other products. They are ADVISORY only.
- You MUST validate these learnings against the current product's GARMENT TRUTH CONTRACT. If a past correction contradicts the current authoritative product references or evidence, ignore the learning. The current product references ALWAYS override past learnings.
` : ""}

PROMPT:
${args.pose.prompt}

REALISTIC INTEGRATION:
- Treat this as frame ${args.pose.poseNumber} from one photographed contact sheet, not a new image concept. Reuse the same physical set coordinates, time of day, camera family, focal-length character, camera height, exposure, white balance, light direction, shadow density, and color grade established by Pose 1.
- Preserve natural fabric drape, folds, gravity, occlusion, thickness and construction for this exact material and fit.
- Match locked lighting direction, color temperature, shadows, contact shadows, perspective, lens feel, depth and scene geometry.
- Keep anatomy realistic and keep hands away from product details.
- Preserve believable pores, flyaway hairs, fabric microtexture, seam depth, edge transitions, optical depth of field, and grounded foot/contact shadows. Avoid waxy skin, over-smoothed fabric, duplicated motifs, over-sharpening, floating garments, plastic texture, and other synthetic AI tells.
${faceVisible ? `- Render the eyes with correct anatomy: two naturally shaped, correctly positioned eyes with realistic iris detail, natural catchlights, and a correctly aligned gaze - never crossed, misaligned, melted, or malformed.
- Render teeth naturally: a real, slightly imperfect smile with naturally aligned teeth in the correct count - never uniformly perfect, fused, extra, missing, or warped.
- Skin must show real photographic micro-detail (pores, faint texture variation) rather than an airbrushed, plastic, or over-smoothed "beauty filter" look.` : ""}

PROHIBITED UNRELATED CHANGES:
${rules.map((rule) => `- ${rule}`).join("\n")}
- Never complete, mirror, continue, relocate, add or remove decoration for symmetry.
- Never add random text, branding, people, layers, props that hide the product, or substitute bottom wear.
${args.pose.id === "back" ? "- TRUE BACK HARD RULE: shoulders and hips fully face away. Reproduce uploaded BACK exactly; never infer the rear from FRONT." : ""}
${args.pose.id === "closeup" ? "- POSE 5 HARD RULE: this is a genuine ZOOMED-IN face-to-chest or face-to-waist shot - visibly tighter in scale than the full-body hero pose, never a repeat of that wide framing. The face must be sharp, beautiful, and carry a natural Gen-Z expression, and one real product detail (embroidery, neckline, drape, print, or fabric texture) must also be sharp and clearly visible in the same frame." : ""}
${args.correction ? `\nEARLIER ATTEMPTS OF THIS EXACT POSE FAILED CONSISTENCY QA. Fix every issue listed below in one image while preserving every lock, and never reintroduce a defect an earlier attempt already corrected:\n${args.correction}` : ""}

Product accuracy is more important than style matching. Output only the finished photograph: no captions, labels, collage, borders or watermark.`;
}
