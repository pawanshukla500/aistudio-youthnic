import pytest
from graph import build_studio_graph
from langgraph.checkpoint.memory import MemorySaver


def test_studio_workflow_execution():
    checkpointer = MemorySaver()
    graph = build_studio_graph(checkpointer=checkpointer)

    initial_state = {
        "organization_id": "7d56360f-2c96-4eb2-923e-f22b7fe36605",
        "sku_id": "T62-Peppa-Purple",
        "sku_name": "T62-Peppa-Purple",
        "references": [
            {"role": "front", "downloadUrl": "https://example.com/front.jpg", "hash": "h1"},
            {"role": "back", "downloadUrl": "https://example.com/back.jpg", "hash": "h2"},
            {"role": "bottom", "downloadUrl": "https://example.com/bottom.jpg", "hash": "h3"},
            {"role": "style_reference", "downloadUrl": "https://example.com/style.jpg", "hash": "h4"},
        ],
        "poses_to_generate": [1, 2, 3, 4, 5, 6],
    }

    config = {"configurable": {"thread_id": "thread_test_001"}}
    final_state = graph.invoke(initial_state, config=config)

    # 1. Evidence was inspected
    assert "source_fingerprint" in final_state
    assert len(final_state["references"]) == 4

    # 2. Product DNA was extracted
    assert final_state["product_dna"] is not None
    assert final_state["product_dna"]["sku_name"] == "T62-Peppa-Purple"
    assert final_state["product_dna"]["bottom_wear"]["cut_class"] == "farshi"

    # 3. Knowledge Memory was retrieved
    assert len(final_state["retrieved_guidance"]) > 0

    # 4. Six poses planned
    assert len(final_state["pose_plans"]) == 6
    pose5 = next(p for p in final_state["pose_plans"] if p["pose_number"] == 5)
    assert pose5["pose_type"] == "closeup"
    assert "primary garment" in pose5["prompt"].lower()

    # 5. Route generation selected
    assert "provider_route" in final_state
    assert final_state["provider_route"]["image_provider"] == "openai"

    # 6. Checkpoints persisted step-by-step in thread history
    history = list(graph.get_state_history(config))
    assert len(history) >= 5

    # 7. QA failure -> correction_required / regeneration conditional branch
    regen_state = graph.invoke(
        {
            **initial_state,
            "qa_pose_index": 1,
            "qa_pose_type": "full_front",
            "ai_raw_evaluation": {"notes": "Rendered as tubular palazzo instead of pleated farshi salwar"},
        },
        config={"configurable": {"thread_id": "thread_test_regen_002"}},
    )
    assert regen_state["correction_decision"] == "regenerate"
    assert regen_state["status"] == "regeneration_scheduled"
    assert len(regen_state["corrections"]) == 1

    # 8. QA pass -> learning recorded & completed
    pass_state = graph.invoke(
        {
            **initial_state,
            "qa_pose_index": 1,
            "qa_pose_type": "full_front",
            "ai_raw_evaluation": {
                "scores": {"garment_identity": 98.0, "bottom_wear": 97.0},
                "checks": {"garment_identity": "pass", "bottom_wear": "pass"},
            },
        },
        config={"configurable": {"thread_id": "thread_test_pass_003"}},
    )
    assert pass_state["correction_decision"] == "pass"
    assert pass_state["status"] == "completed"

