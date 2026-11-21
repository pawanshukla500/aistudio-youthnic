"""The planner mirror reproduces lib/posePlanning.ts outputs exactly.

Replays supabase/functions/app-api/tests/fixtures/pose_planning_parity.json (written by
scripts/generate-pose-planning-parity.ts, also replayed by tests/pose_planning_parity.test.ts).
"""
import json
from pathlib import Path

from agents import pose_plan_agents as agents

FIXTURE = Path(__file__).resolve().parents[2] / "supabase/functions/app-api/tests/fixtures/pose_planning_parity.json"
PARITY = json.loads(FIXTURE.read_text(encoding="utf-8"))
POSES = PARITY["poses"]
DIRECTIVE_POSES = {**POSES, **PARITY["directivePoses"]}


def planner_ctx(ctx):
    """PosePlanningContext (camelCase) as the planner state carries it."""
    return {
        "pose_family": ctx.get("poseFamily"),
        "bottom_cut_class": ctx.get("bottomCutClass"),
        "showcase_feature_region": ctx.get("showcaseFeatureRegion"),
        "showcase_shot_type": ctx.get("showcaseShotType"),
        "sit_requested": ctx.get("sitRequested"),
    }


def mismatches(cases, fn):
    return [(case["input"], case["output"], got) for case in cases if (got := fn(case["input"])) != case["output"]]


def test_max_directive_matches_ts():
    assert agents.MAX_DIRECTIVE == PARITY["maxReferenceDirective"]


def test_normalizers_match_ts():
    assert mismatches(PARITY["normalizeReferencePosture"], agents.normalize_reference_posture) == []
    assert mismatches(PARITY["normalizeReferencePose"], agents.normalize_reference_pose) == []
    assert mismatches(PARITY["normalizeExpressionPlan"], agents.normalize_expression_plan) == []


def test_block_reasons_match_ts_for_every_slot_pose_and_context():
    wrong = []
    for row in PARITY["referenceAdoptionBlockReason"]:
        for ctx_id, expected in row["outputs"].items():
            got = agents.reference_adoption_block_reason(row["slot"], POSES[row["pose"]], planner_ctx(PARITY["contexts"][ctx_id]))
            # Emptiness decides adoption; the messages are identical too.
            if bool(got) != bool(expected) or got != expected:
                wrong.append((row["slot"], row["pose"], ctx_id, expected, got))
    assert wrong == []
    assert len(PARITY["referenceAdoptionBlockReason"]) == 2 * len(POSES)


def test_reference_directives_match_ts_including_overflow():
    wrong = [
        (case["slot"], case["pose"])
        for case in PARITY["referenceSlotDirective"]
        if agents.reference_slot_directive(case["slot"], DIRECTIVE_POSES[case["pose"]]) != case["output"]
    ]
    assert wrong == []


def test_planner_directive_with_family_sentence_survives_edge_renormalization():
    # Edge normalizeSlotPlan keeps text(raw.directive, 900): a planner directive must come back unchanged.
    for pose in POSES.values():
        for slot in agents.ADOPTABLE_SLOTS:
            for family in ("long_kurti", "saree_bengali", "lehenga", "other"):
                directive = agents.bounded_reference_directive(slot, pose, family)
                assert agents._text(directive, agents.MAX_DIRECTIVE) == directive
                assert agents.family_safety_sentence(family) in directive
