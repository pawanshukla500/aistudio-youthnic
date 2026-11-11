import logging
from typing import Dict, Any, List
from models.generation import PoseDefinition, PoseType

logger = logging.getLogger(__name__)


class CreativePosePlanningAgent:
    """Plans the required 6-pose catalog photoshoot maintaining product fidelity,

    scene continuity, and strict style reference quarantine.
    """

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        dna = state.get("product_dna", {})
        sku_name = dna.get("sku_name", "Garment")
        main_color = dna.get("main_color", "primary")
        fabric_type = dna.get("fabric_type", "fabric")
        bottom_cut = dna.get("bottom_wear", {}).get("cut_class", "straight")
        is_farshi = bottom_cut == "farshi"

        # Farshi specific bottom prompt text
        bottom_prompt_chunk = (
            "worn with voluminous two-leg Farshi salwar trousers featuring distinct vertical pleating/gathers "
            "from the waist down to a wide flared joined hem with sequin lace trim (NOT a palazzo, NOT a skirt)"
            if is_farshi
            else f"worn with coordinated {bottom_cut} trousers matching product evidence"
        )

        scene_desc = (
            "Set in an elegant high-end fashion studio photoshoot. Warm soft ambient lighting, clean architectural set, "
            "subtle editorial shadows. Strictly copy the photoshoot room and lighting from the style reference, "
            "but completely quarantine and ignore the clothing worn in that reference."
        )

        model_desc = (
            "Professional adult Indian fashion model with realistic natural facial features, elegant poise, "
            "and strictly exactly two arms and two hands connected to visible forearms."
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

        return {
            "pose_plans": poses,
            "scene_lock": {"description": scene_desc},
            "model_lock": {"description": model_desc},
        }
