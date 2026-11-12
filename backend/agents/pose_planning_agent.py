import hashlib
import json
import logging
from typing import Dict, Any, List
from cache import cache_manager
from models.generation import PoseDefinition, PoseType

logger = logging.getLogger(__name__)


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
                },
                sort_keys=True,
                default=str,
            ).encode("utf-8")
        ).hexdigest()[:20]

        default_scene_desc = (
            "Set in an elegant high-end fashion studio photoshoot. Warm soft ambient lighting, clean architectural set, "
            "subtle editorial shadows. Strictly copy the photoshoot room and lighting from the style reference, "
            "but completely quarantine and ignore the clothing worn in that reference."
        )
        default_model_desc = (
            "Professional adult Indian fashion model with realistic natural facial features, elegant poise, "
            "and strictly exactly two arms and two hands connected to visible forearms."
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
                    "description": "Full-body standing frontal shot establishing the authentic Nivi saree drape, waist pleats, and shoulder pallu fall.",
                    "framing": "full-body head-to-toe",
                    "camera_angle": "eye-level straight on",
                    "hand_placement": "one hand naturally resting lightly near waist pleats with continuous forearm visible, other arm relaxed at side",
                    "highlighted_details": ["waist pleats", "front drape", "pallu border across torso", "blouse neckline"],
                    "prompt": (
                        f"Full-body catalog photo of a {model_desc}. She is wearing the authentic {main_color} "
                        f"{fabric_type} {sku_name} draped in classic {drape_style} style with neat waist pleats and the pallu draped {pallu_dir}. "
                        f"Fitted tailored blouse visible. Strictly continuous unstitched saree drape with NO pants, NO palazzos, NO trousers. {scene_desc}"
                    ),
                },
                {
                    "pose_number": 2,
                    "pose_type": "angled",
                    "title": "Three-Quarter Editorial Stance",
                    "description": "Three-quarter standing pose displaying the side drape sweep, border alignment, and graceful pleat cascade.",
                    "framing": "full-body three-quarter angle",
                    "camera_angle": "slight 45-degree angle",
                    "hand_placement": "one hand gracefully holding the saree pallu edge with anatomically visible wrist and forearm, other arm resting naturally",
                    "highlighted_details": ["side pleat cascade", "zari border sweep", "blouse sleeve border"],
                    "prompt": (
                        f"Full-body catalog photo of the model standing at a three-quarter angle. Draped in the {main_color} "
                        f"{sku_name}, showcasing the fluid side drape and cascading zari border. Strictly two anatomically sound arms. "
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
                    "hand_placement": "hands gently folded on lap or resting on studio bench with continuous visible forearms",
                    "highlighted_details": ["fabric texture richness", "pallu fan spread", "intricate zari border"],
                    "prompt": (
                        f"Seated editorial fashion shot of the model gracefully seated on a minimal studio bench. Wearing the {main_color} "
                        f"{sku_name}, with the saree pleats and pallu fanned out elegantly across the seat and floor showing the rich {fabric_type} weave. "
                        f"Anatomically correct hands on lap, strictly two arms. {scene_desc}"
                    ),
                },
                {
                    "pose_number": 4,
                    "pose_type": "back",
                    "title": "Rear Construction & Pallu Fall",
                    "description": "Full rear catalog view displaying authentic blouse back design and the majestic fall of the pallu derived strictly from rear evidence.",
                    "framing": "full-body rear view",
                    "camera_angle": "straight-on from behind",
                    "hand_placement": "hands relaxed along sides, never covering rear blouse design or pallu fall",
                    "highlighted_details": ["rear blouse neckline", "pallu fall down back", "lower hem drape"],
                    "prompt": (
                        f"Rear catalog view of the model facing away from the camera, displaying the back design of the blouse and the elegant fall of the pallu "
                        f"for the {main_color} {sku_name}. Derived strictly from direct rear product reference. Blouse back neckline and falling pallu shown cleanly. {scene_desc}"
                    ),
                },
                {
                    "pose_number": 5,
                    "pose_type": "closeup",
                    "title": "Signature Pallu & Weave Craftsmanship",
                    "description": "Macro craftsmanship detail shot focusing on the primary saree's signature pallu artwork or intricate zari border weave (never hijacked by secondary accessories).",
                    "framing": "chest-to-waist medium macro crop",
                    "camera_angle": "tight eye-level focus",
                    "hand_placement": "hands either out of tight crop or one hand gracefully near chest with clear forearm continuity",
                    "highlighted_details": ["signature pallu artwork", "zari border weave", "textile craftsmanship"],
                    "prompt": (
                        f"Tight macro craftsmanship detail shot focusing exclusively on the primary saree's signature pallu artwork and intricate zari border weave "
                        f"of the {main_color} {sku_name}. Crystal-clear focus on the opulent jacquard zari weaving, motifs, and border craftsmanship. "
                        f"Never hijacked by accessories. {scene_desc}"
                    ),
                },
                {
                    "pose_number": 6,
                    "pose_type": "showcase",
                    "title": "Flowing Drape Motion Showcase",
                    "description": "Distinct diverging editorial frame capturing the flowing saree pallu and border in subtle walking motion.",
                    "framing": "dynamic three-quarter or full-length motion crop",
                    "camera_angle": "dynamic eye-level with subtle tilt",
                    "hand_placement": "natural graceful movement holding pallu corner, both arms visible and anatomically sound",
                    "highlighted_details": ["fluid drape in motion", "border sweep", "signature saree silhouette"],
                    "prompt": (
                        f"Editorial showcase photo of the model in gentle motion, highlighting the fluid sweep of the {main_color} {sku_name}'s "
                        f"border and pallu. Diverging editorial frame from poses 1-5 while maintaining 100% consistent model identity and set. {scene_desc}"
                    ),
                },
            ]
        else:
            # Farshi specific bottom prompt text
            bottom_prompt_chunk = (
                "worn with voluminous two-leg Farshi salwar trousers featuring distinct vertical pleating/gathers "
                "from the waist down to a wide flared joined hem with sequin lace trim (NOT a palazzo, NOT a skirt)"
                if is_farshi
                else f"worn with coordinated {bottom_cut} trousers matching product evidence"
            )

            poses: List[Dict[str, Any]] = [
            {
                "pose_number": 1,
                "pose_type": "full_front",
                "title": "Front Hero Stance",
                "description": "Full-body standing frontal catalog shot establishing product silhouette and set.",
                "framing": "full-body head-to-toe",
                "camera_angle": "eye-level straight on",
                "hand_placement": "natural catalog stance, one hand gently resting along thigh, second hand relaxed at side",
                "highlighted_details": ["yoke embroidery", "overall silhouette", "trouser flare"],
                "prompt": (
                    f"Full-body fashion catalog photo of a {model_desc}. She is wearing the authentic {main_color} "
                    f"{fabric_type} {sku_name} with intricate yoke embroidery and butti work, {bottom_prompt_chunk}. "
                    f"Standing in full frontal hero pose, head to toe visible. {scene_desc}"
                ),
            },
            {
                "pose_number": 2,
                "pose_type": "angled",
                "title": "Three-Quarter Editorial Stance",
                "description": "Three-quarter standing pose highlighting garment side profile and fabric fall.",
                "framing": "full-body three-quarter angle",
                "camera_angle": "slight 45-degree angle",
                "hand_placement": "one hand naturally holding fabric edge with visible wrist and forearm, opposite arm relaxed",
                "highlighted_details": ["side drape", "trouser volume", "sleeve cuff"],
                "prompt": (
                    f"Full-body catalog photo of the model turned at a three-quarter angle. She is wearing the {main_color} "
                    f"{sku_name}, showcasing the natural drape and side profile of the kurta, {bottom_prompt_chunk}. "
                    f"Natural elegant pose with both arms anatomically connected. {scene_desc}"
                ),
            },
            {
                "pose_number": 3,
                "pose_type": "side_seated",
                "title": "Seated Editorial Composure",
                "description": "Graceful seated pose on studio prop highlighting fabric richness and natural creases.",
                "framing": "wide three-quarter seated crop",
                "camera_angle": "eye-level slight elevation",
                "hand_placement": "hands gently folded on lap or resting on studio bench with continuous visible forearms",
                "highlighted_details": ["fabric texture", "lap drape", "yoke craft"],
                "prompt": (
                    f"Seated editorial fashion shot of the same model gracefully seated on a minimal studio bench. Wearing the {main_color} "
                    f"{sku_name}, showing how the {fabric_type} drapes naturally. Hands calmly placed on lap with exactly two arms. {scene_desc}"
                ),
            },
            {
                "pose_number": 4,
                "pose_type": "back",
                "title": "Rear Construction View",
                "description": "Full rear view displaying authentic back construction strictly derived from back reference.",
                "framing": "full-body rear view",
                "camera_angle": "straight-on from behind",
                "hand_placement": "hands relaxed at sides along hips, never covering rear design",
                "highlighted_details": ["rear neckline", "back construction", "back trouser flare"],
                "prompt": (
                    f"Rear catalog view of the model facing away from the camera, displaying the back design of the {main_color} "
                    f"{sku_name}. Derived strictly from direct rear product reference. Rear neckline and back panels shown cleanly, "
                    f"{bottom_prompt_chunk} seen from behind. Do not mirror front yoke onto back. {scene_desc}"
                ),
            },
            {
                "pose_number": 5,
                "pose_type": "closeup",
                "title": "Signature Craftsmanship Detail",
                "description": "Medium close-up highlighting primary garment embroidery and butti work (never hijacked by dupatta).",
                "framing": "chest-to-waist medium macro crop",
                "camera_angle": "tight eye-level focus",
                "hand_placement": "hands either out of tight crop or one hand gracefully near chest with clear forearm continuity",
                "highlighted_details": ["primary garment butti work", "yoke embroidery", "fabric weave"],
                "prompt": (
                    f"Tight macro craftsmanship detail shot focusing on the primary garment of the {main_color} {sku_name}. "
                    f"Sharp, crystal-clear focus on the intricate neckline embroidery, zari stitching, and butti work of the kurta. "
                    f"Strictly focus on the primary kurti craftsmanship, not secondary accessories. {scene_desc}"
                ),
            },
            {
                "pose_number": 6,
                "pose_type": "showcase",
                "title": "Garment-Led Feature Showcase",
                "description": "Distinct diverging editorial frame highlighting signature garment feature in motion.",
                "framing": "dynamic three-quarter or full-length motion crop",
                "camera_angle": "dynamic eye-level with subtle tilt",
                "hand_placement": "natural graceful movement, both arms visible and anatomically sound",
                "highlighted_details": ["flared silhouette movement", "signature feature showcase"],
                "prompt": (
                    f"Editorial feature showcase shot of the model in subtle motion, highlighting the flowing flare and silhouette "
                    f"of the {main_color} {sku_name} and {bottom_prompt_chunk}. Diverging pose from frames 1-5 with 100% consistent "
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
