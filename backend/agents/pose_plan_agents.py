"""Reference-led pose & expression planning nodes (FastAPI POST /api/v1/plan).

No LLM calls: the Edge vision call already produced reference_pose and
expression_plan. These nodes decide, learn from pose_plan_outcomes, validate
and are checkpointed by LangGraph. Normalizers, hard guards, directive text and
outcome keys mirror supabase/functions/app-api/lib/posePlanning.ts exactly
(tests/test_pose_planning_parity.py replays
supabase/functions/app-api/tests/fixtures/pose_planning_parity.json).

Only Pose 4 ("creative") copies the STYLE REFERENCE person's posture, whenever
the reference shows a person and no product guard blocks it; Pose 6
("showcase") is the product-highlight close-up and never does. The reference
outfit, face, hair and anything in the hands stay quarantined in every frame
(jewellery follows the styling plan). Every plan carries a planned expression
for all six poses.
"""
import logging
import re
from typing import Any, Callable, Dict, List

import database
from agents.state import PosePlanningState

logger = logging.getLogger(__name__)

ADOPTABLE_SLOTS = ("creative", "showcase")
POSE_IDS = ("full_front", "angled", "back", "creative", "closeup", "showcase")
REFERENCE_POSTURES = ("standing", "seated", "leaning", "kneeling", "crouching", "reclining", "walking", "other", "none")
LOW_POSTURES = ("seated", "kneeling", "crouching", "reclining")
EXPRESSION_ENERGIES = ("serene", "calm", "warm", "playful", "confident", "dramatic")
SMILE_TEXT = {
    "none": "neutral closed-lip mouth",
    "soft": "soft closed-lip smile",
    "warm": "warm natural smile",
    "open": "relaxed open smile",
}
DEFAULT_EXPRESSION_PLAN = {
    "attitude": "Natural, quietly confident catalog poise",
    "energy": "calm",
    "gaze": "Soft, direct gaze to camera",
    "smile": "soft",
    "rationale": "",
}
MAX_TEXT = 420
# posePlanning.ts MAX_REFERENCE_DIRECTIVE (normalizeSlotPlan / storedPosePlanning keep text(raw.directive, 900)).
MAX_DIRECTIVE = 900
MAX_PLAN_ATTEMPTS = 2

FORCED_EXPRESSION = re.compile(r"grin|grinning|toothy|laughing|forced smile|wink|pout|duck face|tongue", re.I)
# "bottle green" is a colour, not a held bottle (profiles.ts FORBIDDEN_HELD_OBJECT_CORE bottles?(?!\s*green)).
HELD_OBJECT = re.compile(
    r"\b(?:(?:cup|mug|coffee|phone|bag|handbag|purse|sunglasses|umbrella|bouquet|flower)s?|bottles?(?!\s*green))\b", re.I
)
# JavaScript's \s / String.prototype.trim() set, so _text() collapses exactly what posePlanning.ts text() does.
_JS_WHITESPACE = "\t\n\v\f\r \u00a0\u1680" + "".join(map(chr, range(0x2000, 0x200B))) + "\u2028\u2029\u202f\u205f\u3000\ufeff"
_JS_SPACE_RUN = re.compile(f"[{_JS_WHITESPACE}]+")
_JS_SPACE_OR_DASH_RUN = re.compile(f"[{_JS_WHITESPACE}-]+")
# re.ASCII: JavaScript regexes without the u flag use ASCII \b and ASCII-only case folding.
_POSTURE_SYNONYMS = tuple((posture, re.compile(pattern, re.ASCII)) for posture, pattern in (
    ("seated", r"\b(sit|sits|sitting|seated|perched)\b"),
    ("kneeling", r"\b(kneel|kneels|kneeling)\b"),
    ("crouching", r"\b(crouch|crouching|squat|squatting|hunker)"),
    ("reclining", r"\b(reclin|lying|lies|lounging|lounge)"),
    ("leaning", r"\b(lean|leans|leaning)\b"),
    ("walking", r"\b(walk|walking|stride|striding|mid-step)\b"),
    ("standing", r"\b(stand|stands|standing)\b"),
))
# posePlanning.ts FROZEN_STEP: a walk, frozen stride or lifted foot in the reference body description (never copied).
FROZEN_STEP = re.compile(
    r"\bwalk(?:s|ed|ing)?\b|\bstrode\b|\bmid[- ]?(?:stride|step)\b|\bstrid(?:e|es|ing)\b|\b(?:lifted|raised) (?:foot|feet|heels?)\b"
    r"|\b(?:foot|feet|heels?) (?:lifted|raised)\b",
    re.I | re.ASCII,
)
_SLOT_ERROR = re.compile(r"^(creative|showcase) slot: ")
# posePlanning.ts GROUNDED_SHIFT: replaces a walk or lifted foot in an adopted posture.
_GROUNDED_SHIFT = (
    "Ground the reference movement as a natural weight shift: both feet on the floor, one slightly ahead of the other "
    "with the weight easing onto it, the body turned the way the reference person moves."
)
_QUARANTINE_SENTENCE = (
    "Copy only the body position and attitude, never the reference clothing, face, hair or anything in the hands "
    "(jewellery follows the styling plan). Keep the uploaded garment's front design, print, colours and construction "
    "exactly as the product photos show; a folded posture may let the hem rest naturally but never hides the print or "
    "changes the garment."
)
_FAMILY_SAFETY = {
    "lehenga": "Keep the lehenga skirt flare spread visibly.",
    "kurta_set": "Keep the kurta hem, side slits and front panel readable.",
    "long_kurti": "Keep the kurta hem, side slits and front panel readable.",
    "short_kurti_top": "Keep the top hem and front panel readable.",
    "western_casual": "Keep the top hem and front panel readable.",
    "dress": "Keep the dress silhouette and hem readable.",
}
_REFERENCE_EFFECT = {"penalty": -60, "boost": 15}
_PRODUCT_EFFECT = {"penalty": -20, "boost": 10}


def _js_string(value: Any) -> str:
    """String(value ?? "") for JSON values, as posePlanning.ts text() sees them."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (list, tuple)):
        return ",".join(_js_string(item) for item in value)
    if isinstance(value, dict):
        return "[object Object]"
    return str(value)


def _u16len(value: str) -> int:
    """JS String.length: UTF-16 code units, which Edge's text() and 900-char cut count."""
    return len(value.encode("utf-16-le", "surrogatepass")) // 2


def _u16slice(value: str, end: int) -> str:
    """JS String.slice(0, end) in UTF-16 units, dropping a split surrogate pair's dangling half."""
    if end <= 0:
        return ""
    if _u16len(value) <= end:
        return value
    return value.encode("utf-16-le", "surrogatepass")[: 2 * end].decode("utf-16-le", "ignore")


def _text(value: Any, max_len: int = MAX_TEXT) -> str:
    return _u16slice(_JS_SPACE_RUN.sub(" ", _js_string(value)).strip(" "), max_len)


def _pick(raw: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if raw.get(key) is not None:
            return raw[key]
    return None


def _record(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _one_of(value: Any, allowed: tuple, fallback: str) -> str:
    normalized = _JS_SPACE_OR_DASH_RUN.sub("_", _text(value, 40).lower())
    return normalized if normalized in allowed else fallback


def _steps(state: PosePlanningState, name: str) -> List[str]:
    return [*(state.get("steps") or []), name]


# -------------------------------------------------------------
# posePlanning.ts mirrors
# -------------------------------------------------------------
def normalize_reference_posture(value: Any) -> str:
    raw = _text(value, 80).lower()
    if not raw or re.fullmatch(r"none|no person|no model|n/a|na|empty", raw):
        return "none"
    if raw in REFERENCE_POSTURES:
        return raw
    for posture, pattern in _POSTURE_SYNONYMS:
        if pattern.search(raw):
            return posture
    return "other"


def normalize_reference_pose(raw_value: Any) -> Dict[str, str]:
    raw = _record(raw_value)
    posture = normalize_reference_posture(_pick(raw, "posture"))
    signature_description = _text(_pick(raw, "signatureDescription", "signature_description"))
    distinctiveness = _one_of(_pick(raw, "distinctiveness"), ("generic", "signature"), "generic")
    suitable = _text(_pick(raw, "suitableForProduct", "suitable_for_product"), 20).lower()
    seat = _text(_pick(raw, "seatOrSupport", "seat_or_support"), 120)
    return {
        "posture": posture,
        "description": "" if posture == "none" else _text(_pick(raw, "description")),
        "seatOrSupport": "" if re.fullmatch(r"(none|n/a|na|-)?", seat, re.I | re.ASCII) else seat,
        # A signature with nothing written down cannot be reproduced.
        "distinctiveness": "signature" if distinctiveness == "signature" and signature_description else "generic",
        "signatureDescription": signature_description if distinctiveness == "signature" else "",
        "attitude": _text(_pick(raw, "attitude"), 200),
        # v37: how the reference is shot and the person's look (never their face or objects).
        "cameraAngle": "" if posture == "none" else _text(_pick(raw, "cameraAngle", "camera_angle"), 160),
        "expression": "" if posture == "none" else _text(_pick(raw, "expression"), 160),
        "gaze": "" if posture == "none" else _text(_pick(raw, "gaze"), 160),
        "hands": "" if posture == "none" else _text(_pick(raw, "hands", "handGesture", "hand_gesture"), 160),
        "suitableForProduct": "yes" if suitable in ("yes", "true") else "no" if suitable in ("no", "false") else "unknown",
        "suitabilityReason": _text(_pick(raw, "suitabilityReason", "suitability_reason"), 240),
    }


def normalize_expression_plan(raw_value: Any) -> Dict[str, str]:
    raw = _record(raw_value)
    return {
        "attitude": _text(_pick(raw, "attitude"), 200) or DEFAULT_EXPRESSION_PLAN["attitude"],
        "energy": _one_of(_pick(raw, "energy"), EXPRESSION_ENERGIES, DEFAULT_EXPRESSION_PLAN["energy"]),
        "gaze": _text(_pick(raw, "gaze"), 160) or DEFAULT_EXPRESSION_PLAN["gaze"],
        "smile": _one_of(_pick(raw, "smile"), tuple(SMILE_TEXT), DEFAULT_EXPRESSION_PLAN["smile"]),
        "rationale": _text(_pick(raw, "rationale"), 300),
    }


def slot_posture(posture: str) -> str:
    """posePlanning.ts slotPosture: a walking reference becomes a grounded standing weight shift."""
    return "standing" if posture == "walking" else posture


def reference_adoption_block_reason(slot: str, pose: Dict[str, str], ctx: Dict[str, Any]) -> str:
    """Hard guards ("" = the slot may copy the reference posture), as referenceAdoptionBlockReason.

    Pose 4 adopts whenever the reference shows a person; only a sit request and the construction
    guards remain. Pose 6 is the product-highlight close-up and never adopts.
    """
    posture = pose["posture"]
    if posture == "none":
        return "The style reference shows no person to match."
    if slot == "showcase":
        return "Pose 6 is the product-highlight close-up, so it never copies the reference posture."
    if ctx.get("sit_requested") and posture != "seated":
        return "Your notes ask Pose 4 to sit, so it follows that request instead of the reference posture."
    if posture in LOW_POSTURES and ctx.get("bottom_cut_class") == "farshi":
        return "Farshi two-leg volume and the 4-inch upper-hem taper need a standing frame."
    if posture == "reclining" and str(ctx.get("pose_family") or "").startswith("saree"):
        return "A reclining pose breaks the saree pleats and pallu fall."
    return ""


def without_held_objects(value: str) -> str:
    """posePlanning.ts withoutHeldObjects: clauses naming something held (cup, phone, bag...) are dropped.

    Anything in the reference hands is never copied, so "right elbow bent holding cup up near mouth" must
    not reach the directive (it would also fail plan_errors and force Pose 4 product-led).
    """
    if not HELD_OBJECT.search(value):
        return value
    return ", ".join(clause for clause in re.split(r"\s*[,;.]\s*", value) if clause and not HELD_OBJECT.search(clause))


def _directive_inputs(pose: Dict[str, str]):
    """referenceSlotDirective's free text: held objects are dropped; a walk or lifted foot is dropped (and grounded)."""
    walking = pose["posture"] == "walking"
    base_description = without_held_objects(pose["description"])
    description = "" if walking or FROZEN_STEP.search(base_description) else base_description
    raw_signature = without_held_objects(pose["signatureDescription"]) if pose["distinctiveness"] == "signature" else ""
    signature = "" if walking or FROZEN_STEP.search(raw_signature) else raw_signature
    grounded = walking or description != base_description or signature != raw_signature
    return walking, description, signature, grounded


def _reference_directive_parts(slot: str, pose: Dict[str, str], description: str, signature_text: str) -> List[str]:
    walking, _, signature, grounded = _directive_inputs(pose)
    parts = [
        "Match the STYLE REFERENCE person's direction of movement in a grounded standing pose."
        if walking
        else f"Match the STYLE REFERENCE person's {pose['posture']} posture: {description or pose['posture']}."
    ]
    if grounded:
        parts.append(_GROUNDED_SHIFT)
    if pose["seatOrSupport"]:
        parts.append(f"Rest on the {pose['seatOrSupport']}, which must already belong to the locked set.")
    if signature:
        parts.append(f"Reproduce the signature pose: {signature_text}.")
    camera = (pose.get("cameraAngle") or "") if slot == "creative" else ""
    if camera:
        parts.append(f"Camera and framing as the STYLE REFERENCE is shot: {camera}.")
    if slot == "showcase":
        parts.append(
            "Use a complementary variation of that posture with a different camera angle and framing from Pose 4, "
            "framed for the showcase hero feature."
        )
    parts.append(_QUARANTINE_SENTENCE)
    return parts


def _fit_directive(pose: Dict[str, str], compose: Callable[[str, str], str]) -> str:
    """referenceSlotDirective's MAX_REFERENCE_DIRECTIVE budget.

    On overflow the free-text body description and signature share what is left, so the fixed
    seat, showcase, quarantine (and family) sentences survive Edge's 900-char cut.
    """
    _, description, signature, _ = _directive_inputs(pose)
    directive = compose(description, signature)
    if _u16len(directive) <= MAX_DIRECTIVE:
        return directive
    budget = max(0, MAX_DIRECTIVE - (_u16len(directive) - _u16len(description) - _u16len(signature)))
    signature_len = min(_u16len(signature), max(budget // 2, budget - _u16len(description)))
    return _u16slice(compose(
        _u16slice(description, budget - signature_len).rstrip(_JS_WHITESPACE),
        _u16slice(signature, signature_len).rstrip(_JS_WHITESPACE),
    ), MAX_DIRECTIVE)


def reference_slot_directive(slot: str, pose: Dict[str, str]) -> str:
    """posePlanning.ts referenceSlotDirective."""
    return _fit_directive(pose, lambda description, signature: " ".join(
        _reference_directive_parts(slot, pose, description, signature)
    ))


def family_safety_sentence(pose_family: str) -> str:
    if pose_family.startswith("saree"):
        return "Keep the saree pleats, border and pallu fall readable."
    return _FAMILY_SAFETY.get(pose_family, "")


def bounded_reference_directive(slot: str, pose: Dict[str, str], pose_family: str) -> str:
    """referenceSlotDirective + family safety sentence, within the same MAX_DIRECTIVE budget."""
    family = family_safety_sentence(pose_family)
    return _fit_directive(pose, lambda description, signature: " ".join([
        *_reference_directive_parts(slot, pose, description, signature),
        *([family] if family else []),
    ]))


def product_slot_plan(reason: str) -> Dict[str, str]:
    return {"source": "product", "posture": "standing", "directive": "", "rationale": _text(reason, 300)}


def outcome_key(state: PosePlanningState, slot: str, source: str) -> str:
    """posePlanOutcomeKey; posture/distinctiveness are the reference pose's for both sources."""
    pose = state["reference_pose"]
    return "|".join([
        state.get("pose_family") or "other",
        state.get("bottom_cut_class") or "none",
        slot,
        source,
        pose["posture"],
        pose["distinctiveness"],
    ])


def outcome_effect(row: Dict[str, Any]) -> str:
    use = int(row.get("use_count") or 0)
    if use < 3:
        return "none"
    rejected = int(row.get("human_rejected_count") or 0)
    approved = int(row.get("human_approved_count") or 0)
    if int(row.get("dna_fail_count") or 0) / use >= 0.5 or (rejected >= 2 and rejected > approved):
        return "penalty"
    avg = row.get("dna_score_avg")
    if int(row.get("dna_pass_count") or 0) / use >= 0.8 and avg is not None and float(avg) >= 90 and rejected <= approved:
        return "boost"
    return "none"


def _valid_expression(value: Any) -> str:
    cleaned = _text(value, 300)
    return cleaned if cleaned and not FORCED_EXPRESSION.search(cleaned) else ""


def _signal_effect(state: PosePlanningState, slot: str, source: str) -> str:
    for signal in state.get("learned_signals") or []:
        if signal.get("slot") == slot and signal.get("source") == source:
            return str(signal.get("effect") or "none")
    return "none"


def _boosted_showcase_expression(state: PosePlanningState, chosen_source: str) -> str:
    """best_plan expression of a boosted showcase row, only from the row of the chosen source."""
    rows = {row.get("outcome_key"): row for row in state.get("outcome_rows") or []}
    for signal in state.get("learned_signals") or []:
        if signal.get("slot") != "showcase" or signal.get("source") != chosen_source or signal.get("effect") != "boost":
            continue
        expression = _valid_expression(_record(_record(rows.get(signal.get("outcome_key"))).get("best_plan")).get("expression"))
        if expression:
            return expression
    return ""


def build_expressions(state: PosePlanningState, slots: Dict[str, Dict[str, Any]]) -> Dict[str, str]:
    """Planner-owned expression for all six poses; expression planning applies to every plan."""
    plan = state["expression_plan"]
    pose = state["reference_pose"]
    llm = state.get("pose_expressions") or {}
    # Analysis text can itself carry forced-smile words; never let it into a planner-owned line.
    attitude = _valid_expression(plan["attitude"]) or DEFAULT_EXPRESSION_PLAN["attitude"]
    # No shared gaze: one gaze on every frame made all five face-visible poses look into the lens
    # the same way. Each frame's gaze comes from the Edge per-frame direction (expressionDirection.ts).
    base = f"{attitude}; {SMILE_TEXT[plan['smile']]}"

    def led(pose_id: str) -> str:
        return _valid_expression(llm.get(pose_id)) or base

    creative = led("creative")
    reference_attitude = _valid_expression(pose.get("attitude"))
    if _record(slots.get("creative")).get("source") == "reference" and reference_attitude:
        creative = f"{creative}; carry the reference attitude: {reference_attitude}"
    showcase_source = str(_record(slots.get("showcase")).get("source") or "product")
    expressions = {
        "full_front": led("full_front"),
        "angled": led("angled"),
        "back": f"Face turned away from camera or a brief over-the-shoulder glance; {attitude} carried through the posture.",
        "creative": creative,
        # Only a product-detail close-up crops the face out; the default face_and_detail keeps a sharp face.
        "closeup": "Face mostly outside the crop; if visible, relaxed natural jaw and lips."
        if state.get("closeup_mode") == "product_detail" else led("closeup"),
        "showcase": _boosted_showcase_expression(state, showcase_source) or led("showcase"),
    }
    return {pose_id: _text(value, 300) for pose_id, value in expressions.items()}


def plan_errors(state: PosePlanningState) -> List[str]:
    """Slot errors read "<slot> slot: ..." and expression errors "<pose id> expression: ...".

    Only slot errors force a slot product-led (validate_plan), so an expression problem on
    the creative or showcase pose never discards that slot's reference posture.
    """
    errors: List[str] = []
    pose = state["reference_pose"]
    slots = state.get("slots") or {}
    for slot in ADOPTABLE_SLOTS:
        plan = _record(slots.get(slot))
        if plan.get("source") != "reference":
            continue
        blocked = reference_adoption_block_reason(slot, pose, state)
        if blocked:
            errors.append(f"{slot} slot: {blocked}")
        held = HELD_OBJECT.search(str(plan.get("directive") or ""))
        if held:
            errors.append(f"{slot} slot: directive mentions a held object ({held.group(0).lower()}).")
    expressions = state.get("expressions") or {}
    for pose_id in POSE_IDS:
        expression = _text(expressions.get(pose_id), 300)
        if not expression:
            errors.append(f"{pose_id} expression: missing.")
        elif FORCED_EXPRESSION.search(expression):
            errors.append(f"{pose_id} expression: asks for a forced smile.")
    return errors


# -------------------------------------------------------------
# Graph nodes
# -------------------------------------------------------------
def analyze_references(state: PosePlanningState) -> Dict[str, Any]:
    return {
        **{
            key: _text(state.get(key), 80)
            for key in (
                "pose_family", "bottom_cut_class", "garment_family", "category",
                "showcase_feature_region", "showcase_shot_type", "closeup_mode",
            )
        },
        "sit_requested": bool(state.get("sit_requested")),
        "reference_pose": normalize_reference_pose(state.get("reference_pose")),
        "expression_plan": normalize_expression_plan(state.get("expression_plan")),
        "pose_expressions": {
            str(pose_id): _text(value, 300)
            for pose_id, value in _record(state.get("pose_expressions")).items()
            if _text(value, 300)
        },
        "steps": _steps(state, "analyze_references"),
    }


def recall_outcomes(state: PosePlanningState) -> Dict[str, Any]:
    keys = {(slot, source): outcome_key(state, slot, source) for slot in ADOPTABLE_SLOTS for source in ("reference", "product")}
    rows: List[Dict[str, Any]] = []
    signals: List[Dict[str, Any]] = []
    try:
        fetched = database.fetch_pose_plan_outcomes(str(state.get("organization_id") or ""), list(keys.values()))
        by_key = {str(row.get("outcome_key")): row for row in fetched or []}
        for (slot, source), key in keys.items():
            row = by_key.get(key)
            if row is None:
                continue
            rows.append(dict(row))
            signals.append({"slot": slot, "source": source, "outcome_key": key, "effect": outcome_effect(row)})
    except Exception as exc:
        # Learning is advisory: a missing table or DB outage never blocks planning.
        logger.warning("Pose plan outcome recall failed; planning without learned signals: %s", exc)
        rows, signals = [], []
    return {"outcome_rows": rows, "learned_signals": signals, "steps": _steps(state, "recall_outcomes")}


def plan_poses(state: PosePlanningState) -> Dict[str, Any]:
    pose = state["reference_pose"]
    forced = set(state.get("forced_product_slots") or [])
    slots: Dict[str, Dict[str, Any]] = {}
    for slot in ADOPTABLE_SLOTS:
        blocked = reference_adoption_block_reason(slot, pose, state)
        if blocked:
            slots[slot] = product_slot_plan(blocked)
            continue
        if slot in forced:
            reasons = "; ".join(e for e in state.get("validation_errors") or [] if e.startswith(f"{slot} slot:"))
            slots[slot] = product_slot_plan(f"Plan validation kept this slot product-led ({reasons or 'reference plan rejected'}).")
            continue
        reference_effect = _signal_effect(state, slot, "reference")
        product_effect = _signal_effect(state, slot, "product")
        # The analysis's suitability verdict no longer gates Pose 4; only learned outcomes can outweigh the reference.
        reference_score = (
            60
            + (20 if pose["distinctiveness"] == "signature" else 0)
            + _REFERENCE_EFFECT.get(reference_effect, 0)
        )
        product_score = 50 + _PRODUCT_EFFECT.get(product_effect, 0)
        scores = (
            f"reference {reference_score} vs product {product_score}; "
            f"learned reference {reference_effect}, product {product_effect}"
        )
        if reference_score > product_score:
            matched = (
                "signature style" if pose["distinctiveness"] == "signature"
                else "movement as a grounded weight shift" if pose["posture"] == "walking"
                else f"{pose['posture']} posture"
            )
            slots[slot] = {
                "source": "reference",
                "posture": slot_posture(pose["posture"]),
                "directive": bounded_reference_directive(slot, pose, state.get("pose_family") or ""),
                "rationale": _text(f"Matches the style reference {matched} ({scores}).", 300),
            }
        else:
            slots[slot] = product_slot_plan(f"The product-led pose scored higher ({scores}).")
    return {
        "slots": slots,
        "plan_attempts": int(state.get("plan_attempts") or 0) + 1,
        "steps": _steps(state, "plan_poses"),
    }


def plan_expression(state: PosePlanningState) -> Dict[str, Any]:
    return {"expressions": build_expressions(state, state.get("slots") or {}), "steps": _steps(state, "plan_expression")}


def validate_plan(state: PosePlanningState) -> Dict[str, Any]:
    errors = plan_errors(state)
    attempts = int(state.get("plan_attempts") or 0)
    update: Dict[str, Any] = {"validation_errors": errors, "steps": _steps(state, "validate_plan")}
    if not errors:
        update["status"] = "planned"
    elif attempts < MAX_PLAN_ATTEMPTS:
        forced = list(state.get("forced_product_slots") or [])
        for error in errors:
            match = _SLOT_ERROR.match(error)
            if match and match.group(1) not in forced:
                forced.append(match.group(1))
        update["forced_product_slots"] = forced
        update["status"] = "replanning"
    else:
        slots = {
            slot: product_slot_plan(f"Plan validation still failed after {attempts} attempts; product-led pose kept.")
            for slot in ADOPTABLE_SLOTS
        }
        update["slots"] = slots
        # Expression planning still applies: all six expressions, rebuilt for the product-led slots.
        update["expressions"] = build_expressions(state, slots)
        update["status"] = "fallback"
    return update
