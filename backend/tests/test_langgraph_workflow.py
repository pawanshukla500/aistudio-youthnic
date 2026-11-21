from graph import build_studio_graph
from langgraph.checkpoint.memory import MemorySaver


def test_dna_graph_runs_evidence_then_dna_only():
    graph = build_studio_graph(checkpointer=MemorySaver())
    # Generation, QA, correction and learning run in the Edge worker; this graph only extracts DNA.
    assert [n for n in graph.get_graph().nodes if not n.startswith("__")] == ["inspect_evidence", "extract_dna"]

    initial_state = {
        "organization_id": "7d56360f-2c96-4eb2-923e-f22b7fe36605",
        "sku_id": "T62-Peppa-Purple",
        "sku_name": "T62-Peppa-Purple Farshi Set",
        "references": [
            {"role": "front", "downloadUrl": "https://example.com/front.jpg", "hash": "h1"},
            {"role": "back", "downloadUrl": "https://example.com/back.jpg", "hash": "h2"},
            {"role": "bottom", "downloadUrl": "https://example.com/bottom.jpg", "hash": "h3"},
            {"role": "style_reference", "downloadUrl": "https://example.com/style.jpg", "hash": "h4"},
        ],
    }
    config = {"configurable": {"thread_id": "thread_test_001"}}
    final_state = graph.invoke(initial_state, config=config)

    assert "source_fingerprint" in final_state
    assert len(final_state["references"]) == 4
    assert final_state["product_dna"]["sku_name"] == "T62-Peppa-Purple Farshi Set"
    assert final_state["product_dna"]["bottom_wear"]["cut_class"] == "farshi"
    for retired in ("retrieved_guidance", "pose_plans", "provider_route", "correction_decision"):
        assert retired not in final_state

    # input checkpoint + one per node
    assert len(list(graph.get_state_history(config))) == 4
