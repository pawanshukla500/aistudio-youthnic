import hashlib
import json
import logging
from typing import Dict, Any, List
from cache import cache_manager
from models.generation import PoseDefinition, PoseType

logger = logging.getLogger(__name__)

# Bump whenever planner prompt templates change so cached scene locks and
# compiled prompts automatically refresh across pods without waiting for TTL.
PLANNER_REVISION = "v2026-11-15-human-lineup"


class CreativePosePlanningAgent:
    """Plans the required 6-pose catalog photoshoot maintaining product fidelity,

    scene continuity, and strict style reference quarantine.
    """

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        dna = state.get("product_dna", {})
        org_id = str(state.get("organization_id") or "")
        sku_id = str(state.get("sku_id") or dna.get("sku_id") or "")
        sku_name = dna.get("sku_name", "Garment")
        main_color = dna.get("main_color", "primary")
        fabric_type = dna.get("fabric_type", "fabric")
        is_saree = dna.get("garment_family", "").lower() == "saree"
        bottom_cut = dna.get("bottom_wear", {}).get("cut_class", "straight")
        is_farshi = bottom_cut == "farshi"

        dna_sig = hashlib.sha256(
            json.dumps(
                {
                    "dna": dna,
                    "source_fingerprint": state.get("source_fingerprint", ""),
                    "extra": state.get("extra_instructions", ""),
                    "planner_revision": PLANNER_REVISION,
                },
                sort_keys=True,
                default=str,
            ).encode("utf-8")
        ).hexdigest()[:20]

        default_scene_desc = (
            "Set in an elegant high-end fashion studio photoshoot with warm soft ambient lighting, clean architectural set, "
            "and subtle editorial shadows. Place the model cleanly in unobstructed open floor space away from foreground pillars. "
            "Strictly copy ONLY the photoshoot room, floor, and lighting from the style reference — completely discard style-reference "
            "clothing, pillar-leaning stance, and any coffee cups, mugs, bottles, tote bags, sunglasses, or phones."
        )
        default_model_desc = (
            "Professional adult Indian fashion model with realistic natural facial features and skin pores, unforced relaxed poise, "
            "gentle natural finger curl (never stiff splayed mannequin arms), and strictly exactly two arms and two hands connected "
            "via continuous visible exterior anatomy (zero phantom fabric slits or forearm clawing)."
        )

        scene_desc = default_scene_desc
        model_desc = default_model_desc
        if org_id and sku_id:
            cached_scene = (
                cache_manager.get_scene_lock(org_id, sku_id)
                if not state.get("force_refresh")
                else None
            )
            if cached_scene and cached_scene.get("dna_sig") == dna_sig:
                scene_desc = str(cached_scene.get("description") or default_scene_desc)
                model_desc = str(cached_scene.get("model_description") or default_model_desc)
            else:
                cache_manager.set_scene_lock(
                    org_id,
                    sku_id,
                    {
                        "description": scene_desc,
                        "model_description": model_desc,
                        "dna_sig": dna_sig,
                    },
                )

        if is_saree:
            saree_arch = dna.get("saree_details", {}) or {}
            drape_style = saree_arch.get("drape_style", "nivi")
            pallu_dir = saree_arch.get("pallu_direction", "over_left_shoulder")

            poses = [
                {
                    "pose_number": 1,
                    "pose_type": "full_front",
                    "title": "Front Hero Drape Stance",
                    "description": "Full-body standing frontal shot in unobstructed studio space establishing the authentic Nivi saree drape, waist pleats, and shoulder pallu fall.",
                    "framing": "full-body head-to-toe",
                    "camera_angle": "eye-level straight on",
                    "hand_placement": "left arm relaxed naturally at side with gentle soft finger curl (no stiff mannequin splay), right hand lightly resting on or supporting an exterior fold edge with continuous visible forearm and zero phantom slits",
                    "highlighted_details": ["waist pleats", "front drape", "pallu border across torso", "blouse neckline"],
                    "prompt": (
                        f"Full-body catalog photo of a {model_desc} standing cleanly in open unobstructed floor space (not wedged behind a foreground pillar). She is wearing the authentic {main_color} "
                        f"{fabric_type} {sku_name} draped in classic {drape_style} style with neat waist pleats and the pallu draped {pallu_dir}. "
                        f"Modest tailored blouse worn cleanly underneath (if product photos show a blouseless mannequin wrap, pair with a plain undecorated solid matching short/elbow-sleeve blouse rather than bare chest/back). "
                        f"Strictly continuous unstitched saree drape with NO pants, NO palazzos, NO trousers. {scene_desc}"
                    ),
                },
                {
                    "pose_number": 2,
                    "pose_type": "angled",
                    "title": "Three-Quarter Editorial Stance",
                    "description": "Three-quarter standing pose displaying the side drape sweep, border alignment, and graceful pleat cascade.",
                    "framing": "full-body three-quarter angle",
                    "camera_angle": "slight 45-degree angle",
                    "hand_placement": "one hand gently supporting the exterior saree pallu edge with anatomically visible wrist and forearm, opposite arm relaxed naturally (no forearm clawing)",
                    "highlighted_details": ["side pleat cascade", "zari border sweep", "blouse sleeve border"],
                    "prompt": (
                        f"Full-body catalog photo of the model standing in open floor space at a three-quarter angle. Draped in the {main_color} "
                        f"{sku_name}, showcasing the fluid side drape and cascading zari border. Strictly two anatomically sound exterior arms and soft relaxed fingers. "
                        f"Continuous saree drape with no separate pants or trousers. {scene_desc}"
                    ),
                },
                {
                    "pose_number": 3,
                    "pose_type": "side_seated",
                    "title": "Seated Editorial Composure",
                    "description": "Graceful seated pose on a studio bench with saree pleats and pallu spread elegantly across the floor/prop.",
                    "framing": "wide three-quarter seated crop",
                    "camera_angle": "eye-level slight elevation",
                    "hand_placement": "hands gently folded on lap or resting calmly on studio bench with continuous visible forearms",
                    "highlighted_details": ["fabric texture richness", "pallu fan spread", "intricate zari border"],
                    "prompt": (
                        f"Seated editorial fashion shot of the model gracefully seated on a minimal studio bench. Wearing the {main_color} "
                        f"{sku_name}, with the saree pleats and pallu fanned out elegantly across the seat and floor showing the rich {fabric_type} weave. "
                        f"Anatomically correct hands resting calmly on lap, strictly two arms. {scene_desc}"
                    ),
                },
                {
                    "pose_number": 4,
                    "pose_type": "back",
                    "title": "Rear Construction & Pallu Fall",
                    "description": "Full rear catalog view displaying authentic blouse back design and the majestic fall of the pallu derived strictly from rear evidence.",
                    "framing": "full-body rear view",
                    "camera_angle": "straight-on from behind",
                    "hand_placement": "hands relaxed naturally along sides, never covering rear blouse design or pallu fall",
                    "highlighted_details": ["rear blouse neckline", "pallu fall down back", "lower hem drape"],
                    "prompt": (
                        f"Rear catalog view of the model facing away from the camera, displaying the back design of the blouse and the elegant fall of the pallu "
                        f"for the {main_color} {sku_name}. Derived strictly from direct rear product reference (if product photos show a blouseless mannequin wrap, preserve the clean plain modest solid blouse back matching Pose 1 without invented ties or cutouts). Blouse back neckline and falling pallu shown cleanly. {scene_desc}"
                    ),
                },
                {
                    "pose_number": 5,
                    "pose_type": "closeup",
                    "title": "Signature Pallu & Weave Craftsmanship",
                    "description": "Macro craftsmanship detail shot focusing on the primary saree's signature pallu artwork or intricate zari border weave (never hijacked by secondary accessories).",
                    "framing": "chest-to-waist medium macro crop",
                    "camera_angle": "tight eye-level focus",
                    "hand_placement": "hands out of tight crop or resting low away from chest pallu weave with clear forearm continuity (fingers never covering weave artwork)",
                    "highlighted_details": ["signature pallu artwork", "zari border weave", "textile craftsmanship"],
                    "prompt": (
                        f"Tight macro craftsmanship detail shot focusing exclusively on the primary saree's signature pallu artwork and intricate zari border weave "
                        f"of the {main_color} {sku_name}. Crystal-clear focus on the opulent jacquard zari weaving, motifs, and border craftsmanship. Keep hands clear of focal weave. "
                        f"Never hijacked by accessories. {scene_desc}"
                    ),
                },
                {
                    "pose_number": 6,
                    "pose_type": "showcase",
                    "title": "Flowing Drape Motion Showcase",
                    "description": "Distinct diverging editorial frame capturing the flowing saree pallu and border in subtle graceful movement.",
                    "framing": "dynamic three-quarter or full-length motion crop",
                    "camera_angle": "dynamic eye-level with subtle tilt",
                    "hand_placement": "natural graceful exterior hold on pallu border edge, both arms visible and anatomically sound with soft fingers",
                    "highlighted_details": ["fluid drape in motion", "border sweep", "signature saree silhouette"],
                    "prompt": (
                        f"Editorial showcase photo of the model in subtle graceful movement in open floor space, highlighting the fluid sweep of the {main_color} {sku_name}'s "
                        f"border and pallu. Diverging editorial frame from poses 1-5 while maintaining 100% consistent model identity and set. {scene_desc}"
                    ),
                },
            ]
        else:
            garment_family_str = str(dna.get("garment_family", "")).lower()
            bottom_bw = dna.get("bottom_wear") or {}
            has_bottom_wear = bool(bottom_bw.get("has_bottom_wear", True))
            is_top_only = not has_bottom_wear or bottom_cut in {"", "none"}
            is_western_top = is_top_only and any(
                token in f"{garment_family_str} {sku_name.lower()}"
                for token in ("top", "blouse", "shirt", "tunic", "western", "dress")
            )
            if is_farshi:
                bottom_prompt_chunk = (
                    "worn with voluminous two-leg Farshi salwar trousers featuring vertical waist pleats and side-joint pleats, "
                    "where the hem is quite narrow from the waist side with a 6-inch joined hem panel tapering 4 inches inward "
                    "from the upper hem seam to the lower ankle cuff (NOT a wide-open palazzo, NOT a circular skirt)"
                )
            elif is_top_only:
                bottom_prompt_chunk = (
                    "paired solely with understated plain neutral monochrome styling bottoms — "
                    "never invent a matching coordinated suit bottom or shared print for a standalone top/short kurti"
                )
            elif bottom_cut == "skirt":
                bottom_prompt_chunk = (
                    "worn with authentic coordinated skirt/lehenga bottom wear preserving drape, panel flare, and hem from product evidence"
                )
            else:
                bottom_prompt_chunk = (
                    f"worn with authentic coordinated {bottom_cut} bottom wear preserving exact leg cut, width, and hem from product evidence"
                )

            primary_craft_focus = (
                "neckline construction, trim/print motif, sleeve finish, and fabric weave of the top"
                if is_western_top
                else "signature neckline craft, yoke embroidery/print, and motif work of the primary kurti/top"
                if is_top_only
                else "intricate yoke embroidery, zari stitching, and butti work of the kurta"
            )
            primary_craft_details = (
                ["neckline trim & collar craft", "print/weave surface", "sleeve cuff finish"]
                if is_western_top
                else ["primary top neckline craft", "motif/print detail", "fabric weave"]
                if is_top_only
                else ["primary garment butti work", "yoke embroidery", "fabric weave"]
            )
            pose1_craft_summary = (
                f"{fabric_type} {sku_name}"
                if is_top_only
                else f"{fabric_type} {sku_name} with intricate yoke embroidery and butti work"
            )
            pose2_framing = "knees-up three-quarter editorial crop" if is_top_only else "full-body three-quarter angle"

            poses: List[Dict[str, Any]] = [
            {
                "pose_number": 1,
                "pose_type": "full_front",
                "title": "Front Hero Stance",
                "description": "Standing frontal hero catalog shot in unobstructed open floor space establishing product silhouette and set.",
                "framing": "knees-up to full-body hero frame centered on top proportion" if is_top_only else "full-body head-to-toe",
                "camera_angle": "eye-level straight on",
                "hand_placement": "natural catalog stance with relaxed softly curled fingers and slight elbow ease (zero stiff splayed mannequin arms)",
                "highlighted_details": ["top cut & neckline", "sleeve drape", "fabric finish"] if is_top_only else ["yoke embroidery", "overall silhouette", "trouser flare"],
                "prompt": (
                    f"Full-body fashion catalog photo of a {model_desc} standing in open unobstructed studio space (never behind a foreground pillar). She is wearing the authentic {main_color} "
                    f"{pose1_craft_summary}, {bottom_prompt_chunk}. "
                    f"Standing in clean frontal hero pose with balanced weight and natural hands. {scene_desc}"
                ),
            },
            {
                "pose_number": 2,
                "pose_type": "angled",
                "title": "Three-Quarter Editorial Stance",
                "description": "Three-quarter standing pose highlighting garment side profile, drape fall, and natural relaxed posture.",
                "framing": pose2_framing,
                "camera_angle": "slight 45-degree angle",
                "hand_placement": "one hand lightly supporting an exterior hem/side fold with continuous wrist and forearm, opposite arm relaxed naturally (no forearm clawing)",
                "highlighted_details": ["side silhouette", "sleeve fit", "hem finish"] if is_top_only else ["side drape", "trouser volume", "sleeve cuff"],
                "prompt": (
                    f"Editorial three-quarter catalog photo ({pose2_framing}) of the model turned gently toward side light in open studio space. She is wearing the {main_color} "
                    f"{sku_name}, showcasing natural side drape and garment proportion, {bottom_prompt_chunk}. "
                    f"Natural relaxed human posture with strictly two anatomically connected exterior arms. {scene_desc}"
                ),
            },
            {
                "pose_number": 3,
                "pose_type": "side_seated",
                "title": "Seated Editorial Composure",
                "description": "Graceful seated pose on studio prop highlighting fabric richness and natural creases.",
                "framing": "wide three-quarter seated crop",
                "camera_angle": "eye-level slight elevation",
                "hand_placement": "hands gently folded on lap or resting calmly on studio bench with continuous visible forearms",
                "highlighted_details": ["fabric texture", "lap drape", "neckline craft"],
                "prompt": (
                    f"Seated editorial fashion shot of the same model gracefully seated on a minimal studio bench. Wearing the {main_color} "
                    f"{sku_name}, showing how the {fabric_type} drapes naturally with {bottom_prompt_chunk}. Hands resting calmly on lap with exactly two arms. {scene_desc}"
                ),
            },
            {
                "pose_number": 4,
                "pose_type": "back",
                "title": "Rear Construction View",
                "description": "Full rear view displaying authentic back construction strictly derived from back reference.",
                "framing": "knees-up or full-body rear view" if is_top_only else "full-body rear view",
                "camera_angle": "straight-on from behind",
                "hand_placement": "hands relaxed naturally at sides along hips, never covering rear design",
                "highlighted_details": ["rear neckline", "back construction", "rear hem & bottom drape"],
                "prompt": (
                    f"Rear catalog view of the model facing away from the camera, displaying the back design of the {main_color} "
                    f"{sku_name}. Derived strictly from direct rear product reference, with hair swept forward and any uploaded dupatta draped forward over the arms/front so the rear garment is 100% unobstructed, "
                    f"{bottom_prompt_chunk} seen from behind. Do not mirror front design onto back. {scene_desc}"
                ),
            },
            {
                "pose_number": 5,
                "pose_type": "closeup",
                "title": "Signature Craftsmanship Detail",
                "description": f"Medium close-up highlighting {primary_craft_focus} (never hijacked by secondary accessories and never obscured by hands).",
                "framing": "chest-to-waist medium macro crop",
                "camera_angle": "tight eye-level focus",
                "hand_placement": "hands kept out of the craft zone (out of crop or relaxed softly below waist) with clear forearm continuity",
                "highlighted_details": primary_craft_details,
                "prompt": (
                    f"Tight macro craftsmanship detail shot focusing on the primary garment of the {main_color} {sku_name}. "
                    f"Sharp, crystal-clear focus on the {primary_craft_focus}. Hands kept away from chest craft; "
                    f"strictly focus on the primary garment craftsmanship, not secondary accessories. {scene_desc}"
                ),
            },
            {
                "pose_number": 6,
                "pose_type": "showcase",
                "title": "Garment-Led Feature Showcase",
                "description": "Distinct diverging editorial frame highlighting signature garment feature with natural poise.",
                "framing": "waist-up to three-quarter diverging crop" if is_top_only else "dynamic three-quarter or full-length motion crop",
                "camera_angle": "dynamic eye-level editorial angle",
                "hand_placement": "natural graceful weight shift with both arms visible, anatomically sound, and soft natural fingers",
                "highlighted_details": ["top hem & silhouette showcase", "signature feature"] if is_top_only else ["flared silhouette movement", "signature feature showcase"],
                "prompt": (
                    f"Editorial feature showcase shot of the model in a distinct three-quarter weight-shift pose, highlighting the authentic silhouette and craft "
                    f"of the {main_color} {sku_name} with {bottom_prompt_chunk}. Diverging pose from frames 1-5 with 100% consistent "
                    f"model identity and studio set. {scene_desc}"
                ),
            },
        ]

        if org_id and sku_id:
            for pose in poses:
                pose_num = int(pose["pose_number"])
                if not state.get("force_refresh"):
                    cached_prompt = cache_manager.get_compiled_prompt(org_id, sku_id, pose_num, dna_sig)
                    if cached_prompt:
                        pose["prompt"] = cached_prompt
                        continue
                cache_manager.set_compiled_prompt(org_id, sku_id, pose_num, dna_sig, str(pose["prompt"]))

        return {
            "pose_plans": poses,
            "scene_lock": {"description": scene_desc},
            "model_lock": {"description": model_desc},
        }
