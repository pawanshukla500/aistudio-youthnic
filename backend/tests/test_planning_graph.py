import pytest
from fastapi.testclient import TestClient

import database
import graph
from agents import pose_plan_agents
from main import app

ORG = "7d56360f-2c96-4eb2-923e-f22b7fe36605"
SEATED = {
    "posture": "sitting on a low wooden stool",
    "description": "seated upright, knees together, hands resting on the lap, head tilted slightly",
    "seatOrSupport": "low wooden stool",
    "distinctiveness": "generic",
    "signatureDescription": "",
    "attitude": "relaxed, self-assured",
    "suitableForProduct": "yes",
    "suitabilityReason": "kurti hem stays visible",
}
PLANNED_STEPS = ["analyze_references", "recall_outcomes", "plan_poses", "plan_expression", "validate_plan"]
POSE_IDS = {"full_front", "angled", "back", "creative", "closeup", "showcase"}
QUARANTINE = "never the reference clothing, face, hair or anything in the hands (jewellery follows the styling plan)"
BASE_EXPRESSION = "Calm editorial poise; soft closed-lip smile; Soft gaze to camera"
FACE_OUT = "Face mostly outside the crop; if visible, relaxed natural jaw and lips."


@pytest.fixture(autouse=True)
def offline_planner(monkeypatch):
    monkeypatch.setattr(graph, "get_postgres_checkpointer", lambda: None)
    monkeypatch.setattr(database, "fetch_pose_plan_outcomes", lambda org, keys: [])


def plan(reference_pose=None, **overrides):
    payload = {
        "organization_id": ORG,
        "thread_key": "analysis-fingerprint-1",
        "pose_family": "long_kurti",
        "bottom_cut_class": "straight",
        "showcase_feature_region": "neckline",
        "showcase_shot_type": "three_quarter_feature",
        "reference_pose": SEATED if reference_pose is None else reference_pose,
        "expression_plan": {"attitude": "Calm editorial poise", "energy": "calm", "gaze": "Soft gaze to camera", "smile": "soft"},
        "pose_expressions": {},
        **overrides,
    }
    return graph.run_pose_planning(payload)


def outcome_row(key, **counters):
    return {"outcome_key": key, "use_count": 4, "dna_pass_count": 0, "dna_fail_count": 0, "dna_score_avg": None,
            "human_approved_count": 0, "human_rejected_count": 0, "best_plan": {}, **counters}


def test_normalizers_mirror_pose_planning_ts():
    assert pose_plan_agents.normalize_reference_posture("Perched on steps") == "seated"
    assert pose_plan_agents.normalize_reference_posture("squatting low") == "crouching"
    assert pose_plan_agents.normalize_reference_posture("no person") == "none"
    assert pose_plan_agents.normalize_reference_posture("twirling") == "other"
    pose = pose_plan_agents.normalize_reference_pose({"posture": "standing", "distinctiveness": "signature", "seat_or_support": "n/a"})
    assert pose["distinctiveness"] == "generic" and pose["seatOrSupport"] == "" and pose["suitableForProduct"] == "unknown"
    assert pose_plan_agents.normalize_expression_plan({"energy": "Very loud", "smile": "WARM"})["energy"] == "calm"
    assert pose_plan_agents.normalize_expression_plan({"smile": "WARM"})["smile"] == "warm"


def test_seated_suitable_reference_long_kurti_adopts_creative_and_showcase():
    result = plan()
    creative, showcase = result["slots"]["creative"], result["slots"]["showcase"]
    assert creative["source"] == showcase["source"] == "reference"
    assert creative["posture"] == "seated"
    assert "Rest on the low wooden stool" in creative["directive"]
    assert "complementary variation" in showcase["directive"]
    assert "complementary variation" not in creative["directive"]
    assert showcase["directive"].endswith("Keep the kurta hem, side slits and front panel readable.")
    assert QUARANTINE in showcase["directive"]
    assert "reference 60 vs product 50" in creative["rationale"]
    assert result["expressions"]["creative"].endswith("carry the reference attitude: relaxed, self-assured")
    assert result["plan_key"] == "long_kurti|straight"
    assert result["status"] == "planned"
    assert result["validation"] == {"attempts": 1, "errors": []}
    assert result["steps"] == PLANNED_STEPS


def test_farshi_low_posture_stays_product_led():
    result = plan(bottom_cut_class="farshi")
    for slot in ("creative", "showcase"):
        assert result["slots"][slot] == {
            "source": "product", "posture": "standing", "directive": "",
            "rationale": "Farshi two-leg volume and the 4-inch upper-hem taper need a standing frame.",
        }
    # Expression planning applies to every plan, adopted or not.
    assert set(result["expressions"]) == POSE_IDS
    assert result["expressions"]["creative"] == "Calm editorial poise; soft closed-lip smile; Soft gaze to camera"
    assert result["status"] == "planned" and result["validation"] == {"attempts": 1, "errors": []}


def test_generic_standing_is_product_and_signature_standing_is_reference():
    generic = plan(
        {"posture": "standing", "description": "standing straight", "distinctiveness": "generic"},
        pose_expressions={"back": "Calm over-shoulder look"},
    )
    assert {s["source"] for s in generic["slots"].values()} == {"product"}
    assert set(generic["expressions"]) == POSE_IDS and generic["status"] == "planned"
    signature_pose = {
        "posture": "standing", "description": "weight on one hip", "distinctiveness": "signature",
        "signatureDescription": "one hand lifting the hair off the neck",
    }
    # Adoption needs an explicit "yes" suitability verdict.
    assert plan(signature_pose)["slots"]["creative"]["source"] == "product"
    signature = plan({**signature_pose, "suitableForProduct": "yes"})
    assert signature["slots"]["creative"]["source"] == "reference"
    assert "Reproduce the signature pose: one hand lifting the hair off the neck." in signature["slots"]["creative"]["directive"]


@pytest.mark.parametrize("pose_family", ["long_kurti", "saree_classic"])
def test_long_reference_directive_fits_edge_900_char_cut(pose_family):
    result = plan({
        **SEATED,
        "description": "seated upright with the torso turned slightly, " * 12,
        "seatOrSupport": "carved teak bench " * 10,
        "distinctiveness": "signature",
        "signatureDescription": "one elbow propped on the knee, chin resting lightly on the knuckles, " * 8,
    }, pose_family=pose_family)
    family = "Keep the kurta hem, side slits" if pose_family == "long_kurti" else "Keep the saree pleats, border and pallu"
    for slot in ("creative", "showcase"):
        directive = result["slots"][slot]["directive"]
        assert len(directive) <= pose_plan_agents.MAX_DIRECTIVE
        assert QUARANTINE in directive
        assert family in directive
    assert "complementary variation" in result["slots"]["showcase"]["directive"]
    assert "Reproduce the signature pose: one elbow propped" in result["slots"]["showcase"]["directive"]


@pytest.mark.parametrize("field, text", [
    ("description", "Leaning as she walks past the pillar"),
    ("description", "Leaning out of a WALK"),
    ("signatureDescription", "turned as if walking past"),
])
def test_walking_wording_in_a_non_walking_posture_stays_product_led(field, text):
    reference = {**SEATED, "posture": "leaning", "distinctiveness": "signature", "signatureDescription": "hand on the pillar", field: text}
    result = plan(reference)
    for slot in ("creative", "showcase"):
        assert result["slots"][slot]["source"] == "product"
        assert "walking stride" in result["slots"][slot]["rationale"]
    # "walkway" is not a walk.
    assert plan({**reference, field: "Leaning by the walkway"})["slots"]["creative"]["source"] == "reference"


def test_showcase_macro_detail_keeps_showcase_product():
    result = plan(showcase_shot_type="macro_detail")
    assert result["slots"]["creative"]["source"] == "reference"
    assert result["slots"]["showcase"]["source"] == "product"
    assert "tight detail crop" in result["slots"]["showcase"]["rationale"]


def test_penalty_rows_make_reference_lose(monkeypatch):
    seen = {}

    def fetch(org, keys):
        seen["keys"] = keys
        return [outcome_row(k, dna_fail_count=3) for k in keys if "|reference|" in k]

    monkeypatch.setattr(database, "fetch_pose_plan_outcomes", fetch)
    result = plan()
    assert "long_kurti|straight|creative|product|seated|generic" in seen["keys"]
    assert len(seen["keys"]) == 4
    assert result["slots"]["creative"]["source"] == "product"
    assert "reference 0 vs product 50" in result["slots"]["creative"]["rationale"]
    assert {(s["slot"], s["effect"]) for s in result["learned_signals"]} == {("creative", "penalty"), ("showcase", "penalty")}
    assert set(result["learned_signals"][0]) == {"slot", "outcome_key", "effect"}


def test_boost_rows_feed_showcase_best_plan_expression(monkeypatch):
    def fetch(org, keys):
        return [
            outcome_row(k, dna_pass_count=4, dna_score_avg=94.5, human_approved_count=1,
                        best_plan={"expression": "Serene half-smile, eyes lowered to the embroidery"})
            for k in keys if "|showcase|reference|" in k
        ]

    monkeypatch.setattr(database, "fetch_pose_plan_outcomes", fetch)
    result = plan()
    assert result["slots"]["showcase"]["source"] == "reference"
    assert "reference 75 vs product 50" in result["slots"]["showcase"]["rationale"]
    assert result["expressions"]["showcase"] == "Serene half-smile, eyes lowered to the embroidery"
    assert result["learned_signals"] == [{
        "slot": "showcase", "outcome_key": "long_kurti|straight|showcase|reference|seated|generic", "effect": "boost",
    }]


def test_showcase_best_plan_expression_only_from_chosen_source_row(monkeypatch):
    def fetch(org, keys):
        return [
            outcome_row(k, dna_pass_count=4, dna_score_avg=95, best_plan={"expression": "Product-row expression"})
            for k in keys if "|showcase|product|" in k
        ]

    monkeypatch.setattr(database, "fetch_pose_plan_outcomes", fetch)
    # Signature reference (80) beats the boosted product pose (60): the product row's best_plan must not leak in.
    result = plan({**SEATED, "distinctiveness": "signature", "signatureDescription": "chin resting on one hand"})
    assert result["slots"]["showcase"]["source"] == "reference"
    assert result["expressions"]["showcase"] != "Product-row expression"
    # A generic reference ties the boosted product pose (60 vs 60), so the product pose and its row win.
    tied = plan()
    assert tied["slots"]["showcase"]["source"] == "product"
    assert tied["expressions"]["showcase"] == "Product-row expression"


def test_db_failure_plans_without_signals(monkeypatch):
    def fetch(org, keys):
        raise RuntimeError("relation pose_plan_outcomes does not exist")

    monkeypatch.setattr(database, "fetch_pose_plan_outcomes", fetch)
    result = plan()
    assert result["learned_signals"] == []
    assert result["slots"]["creative"]["source"] == "reference"
    assert result["status"] == "planned"


def test_forced_smile_llm_expression_is_replaced():
    result = plan(pose_expressions={"full_front": "Big toothy grin at camera", "angled": "Quiet glance past the lens"})
    assert result["expressions"]["full_front"] == "Calm editorial poise; soft closed-lip smile; Soft gaze to camera"
    assert result["expressions"]["angled"] == "Quiet glance past the lens"
    assert result["expressions"]["back"].startswith("Face turned away from camera")
    # The default face_and_detail close-up keeps a sharp face: the base expression, not the face-out line.
    assert result["expressions"]["closeup"] == BASE_EXPRESSION
    assert set(result["expressions"]) == {"full_front", "angled", "back", "creative", "closeup", "showcase"}


@pytest.mark.parametrize("closeup_mode, closeup_expression, expected", [
    ("product_detail", "Warm smile, eyes on the lens", FACE_OUT),
    ("face_and_detail", "Warm smile, eyes on the lens", "Warm smile, eyes on the lens"),
    ("face_and_detail", "Big toothy grin", BASE_EXPRESSION),
    ("", None, BASE_EXPRESSION),
])
def test_closeup_expression_follows_closeup_mode(closeup_mode, closeup_expression, expected):
    result = plan(closeup_mode=closeup_mode, pose_expressions={"closeup": closeup_expression} if closeup_expression else {})
    assert result["expressions"]["closeup"] == expected


def test_sit_request_keeps_a_non_seated_reference_out_of_pose_4_only():
    leaning = {**SEATED, "posture": "leaning", "seatOrSupport": "", "description": "shoulder leaning on a pillar"}
    result = plan(leaning, sit_requested=True)
    assert result["slots"]["creative"] == {
        "source": "product", "posture": "standing", "directive": "",
        "rationale": "Your notes ask Pose 4 to sit, so it follows that request instead of the reference posture.",
    }
    assert result["slots"]["showcase"]["source"] == "reference"
    # A seated reference still matches the request.
    assert plan(sit_requested=True)["slots"]["creative"]["source"] == "reference"


def test_held_object_check_ignores_bottle_green():
    state = {
        "reference_pose": pose_plan_agents.normalize_reference_pose(SEATED),
        "slots": {"creative": {"source": "reference", "directive": "Seated against the bottle green wall."}},
        "expressions": {pose_id: "Calm gaze" for pose_id in POSE_IDS},
    }
    assert pose_plan_agents.plan_errors(state) == []
    state["slots"]["creative"]["directive"] = "Seated holding a water bottle."
    assert pose_plan_agents.plan_errors(state) == ["creative slot: directive mentions a held object (bottle)."]


def test_held_object_directive_loops_to_forced_product(monkeypatch):
    monkeypatch.setattr(pose_plan_agents, "bounded_reference_directive", lambda slot, pose, family: "Sit holding a coffee cup.")
    result = plan()
    for slot in ("creative", "showcase"):
        assert result["slots"][slot]["source"] == "product"
        assert "held object (coffee)" in result["slots"][slot]["rationale"]
    assert result["validation"] == {"attempts": 2, "errors": []}
    assert result["status"] == "planned"
    assert result["steps"] == PLANNED_STEPS + ["plan_poses", "plan_expression", "validate_plan"]


def test_persistent_validation_errors_fall_back_to_product(monkeypatch):
    monkeypatch.setattr(pose_plan_agents, "plan_errors", lambda state: ["full_front expression: missing."])
    result = plan()
    assert result["status"] == "fallback"
    assert {s["source"] for s in result["slots"].values()} == {"product"}
    assert set(result["expressions"]) == POSE_IDS
    assert "carry the reference attitude" not in result["expressions"]["creative"]
    assert result["validation"] == {"attempts": 2, "errors": ["full_front expression: missing."]}


def test_expression_error_on_creative_never_forces_the_slot_product_led(monkeypatch):
    calls = []
    real = pose_plan_agents.plan_errors

    def first_attempt_expression_error(state):
        calls.append(1)
        return ["creative expression: asks for a forced smile.", "showcase expression: missing."] if len(calls) == 1 else real(state)

    monkeypatch.setattr(pose_plan_agents, "plan_errors", first_attempt_expression_error)
    result = plan()
    assert result["validation"] == {"attempts": 2, "errors": []}
    assert result["slots"]["creative"]["source"] == result["slots"]["showcase"]["source"] == "reference"


def test_slot_errors_are_tagged_apart_from_expression_errors():
    state = {
        "reference_pose": pose_plan_agents.normalize_reference_pose({**SEATED, "suitableForProduct": "unknown"}),
        "slots": {"creative": {"source": "reference", "directive": "Hold the phone."}},
        "expressions": {"creative": "Big grin"},
    }
    errors = pose_plan_agents.plan_errors(state)
    assert errors[:2] == [
        "creative slot: Analysis did not confirm that the reference posture suits this product.",
        "creative slot: directive mentions a held object (phone).",
    ]
    assert "creative expression: asks for a forced smile." in errors and "full_front expression: missing." in errors
    update = pose_plan_agents.validate_plan({**state, "plan_attempts": 1})
    assert update["forced_product_slots"] == ["creative"] and update["status"] == "replanning"


def test_thread_id_is_sanitized_and_history_is_readable():
    result = plan(thread_key="style:abc/def ghi" + "x" * 100)
    assert result["thread_id"].startswith(f"thread_plan_{ORG}_style_abc_def_ghi")
    assert len(result["thread_id"]) == len(f"thread_plan_{ORG}_") + 80
    history = graph.get_thread_state_history(result["thread_id"], limit=5)
    assert history[0]["status"] == "planned"
    assert history[0]["slot_sources"] == {"creative": "reference", "showcase": "reference"}
    assert history[0]["plan_attempts"] == 1
    assert "sku_id" not in history[0]


def test_plan_route_requires_internal_secret_and_validates(monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "INTERNAL_API_SECRET", "test_internal_secret")
    client = TestClient(app)
    headers = {"x-internal-secret": "test_internal_secret"}
    body = {
        "organization_id": ORG,
        "thread_key": "fp-route",
        "pose_family": "long_kurti",
        "bottom_cut_class": "none",
        "reference_pose": {"posture": "seated", "description": "seated on steps", "suitableForProduct": "yes"},
        "expression_plan": {"attitude": "Warm poise", "smile": "warm"},
        "pose_expressions": {"full_front": "Gentle smile", "back": None},
        "local_plan": {"slots": {"creative": {"source": "reference"}}},
    }

    assert client.post("/api/v1/plan", json=body).status_code == 401
    assert client.post("/api/v1/plan", json={**body, "organization_id": ""}, headers=headers).status_code == 422
    assert client.post("/api/v1/plan", json={**body, "organization_id": "org%"}, headers=headers).status_code == 422
    assert client.post("/api/v1/plan", json={**body, "thread_key": " \t "}, headers=headers).status_code == 422

    ok = client.post("/api/v1/plan", json=body, headers=headers)
    assert ok.status_code == 200
    data = ok.json()
    assert data["thread_id"] == f"thread_plan_{ORG}_fp-route"
    assert data["slots"]["creative"]["source"] == "reference"
    assert data["expressions"]["full_front"] == "Gentle smile"
    assert data["steps"] == PLANNED_STEPS

    # garment_family/category are informational: long real values never 422.
    detailed = client.post("/api/v1/plan", json={
        **body, "garment_family": "g" * 900, "category": "c" * 900, "sit_requested": True, "closeup_mode": "product_detail",
    }, headers=headers)
    assert detailed.status_code == 200
    assert detailed.json()["slots"]["creative"]["source"] == "reference"
    assert detailed.json()["expressions"]["closeup"] == FACE_OUT

    def boom(payload):
        raise RuntimeError("checkpointer down")

    monkeypatch.setattr("routes.planning.run_pose_planning", boom)
    failed = client.post("/api/v1/plan", json=body, headers=headers)
    assert failed.status_code == 503
    assert failed.json()["detail"] == "Pose planning graph failed"

    other_org = "11111111-2222-3333-4444-555555555555"
    cross = client.get(f"/api/v1/workflows/checkpoints/thread_plan_{other_org}_fp?organization_id={ORG}", headers=headers)
    assert cross.status_code == 403
    own = client.get(f"/api/v1/workflows/checkpoints/thread_plan_{ORG}_fp-route?organization_id={ORG}", headers=headers)
    assert own.status_code == 200
