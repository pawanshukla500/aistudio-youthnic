from typing import Dict, Any
from fastapi import APIRouter, HTTPException, Query, Body, Depends
from auth import verify_internal_secret
from models.dna_v2 import ProductDNAV2
from database import get_latest_dna_version, list_dna_versions, approve_dna_version
from graph import get_compiled_graph
from cache import cache_manager

router = APIRouter(
    prefix="/api/v1/dna",
    tags=["Product DNA V2"],
    dependencies=[Depends(verify_internal_secret)],
)


@router.post("/extract")
def extract_product_dna(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Runs LangGraph Product Evidence & DNA Agent workflow to produce immutable Product DNA V2."""
    org_id = str(payload.get("organization_id") or "").strip()
    sku_id = str(payload.get("sku_id") or "").strip()
    sku_name = str(payload.get("sku_name") or sku_id or "Garment")
    references = payload.get("references", [])

    if not org_id:
        raise HTTPException(status_code=400, detail="organization_id is required")
    if not sku_id:
        raise HTTPException(status_code=400, detail="sku_id is required")

    graph = get_compiled_graph()
    thread_id = f"thread_dna_{org_id}_{sku_id}"
    initial_state = {
        "organization_id": org_id,
        "sku_id": sku_id,
        "sku_name": sku_name,
        "references": references,
        "category": payload.get("category", "ethnic/fusion"),
        "garment_family": payload.get("garment_family", ""),
        "main_color": payload.get("main_color", "unknown"),
        "force_refresh": bool(payload.get("force_refresh", False)),
        "auto_approve": bool(payload.get("auto_approve", False)),
        "poses_to_generate": [1, 2, 3, 4, 5, 6],
        # Reset QA/generation fields so prior checkpoint values on thread_id never bleed into DNA extraction
        "qa_target_image_url": "",
        "ai_raw_evaluation": None,
        "correction_decision": "",
        "requires_human_review": False,
        "status": "extracting_dna",
    }

    config = {"configurable": {"thread_id": thread_id}}
    final_state = graph.invoke(initial_state, config=config)
    dna = final_state.get("product_dna", {})

    return {
        "status": "success",
        "sku_id": sku_id,
        "thread_id": thread_id,
        "product_dna": dna,
        "dna_approved": bool(final_state.get("dna_approved", False)),
        "dna_persisted": bool(final_state.get("dna_persisted", True)),
        "persisted": bool(final_state.get("dna_persisted", True)),
        "pose_plans_count": len(final_state.get("pose_plans", [])),
    }


@router.get("/{sku_id}")
def get_sku_dna(sku_id: str, org_id: str = Query(...)) -> Dict[str, Any]:
    """Retrieves latest Product DNA from Valkey hot cache or PostgreSQL."""
    if not org_id.strip():
        raise HTTPException(status_code=400, detail="org_id is required")
    cached = cache_manager.get_hot_dna(org_id, sku_id)
    if cached:
        return {"source": "valkey_cache", "product_dna": cached}

    db_row = get_latest_dna_version(org_id, sku_id)
    if not db_row:
        raise HTTPException(status_code=404, detail=f"Product DNA not found for SKU {sku_id}")

    dna = dict(db_row.get("dna_payload") or {})
    dna["version"] = int(db_row.get("version") or dna.get("version") or 1)
    dna["approved"] = bool(db_row.get("approved", dna.get("approved", False)))
    dna["status"] = str(db_row.get("status") or dna.get("status") or "draft")
    cache_manager.set_hot_dna(org_id, sku_id, dna)
    return {"source": "postgres", "version": db_row.get("version"), "product_dna": dna}


@router.get("/{sku_id}/versions")
def get_dna_versions(sku_id: str, org_id: str = Query(...)) -> Dict[str, Any]:
    """Lists version history and audit log for a product's DNA."""
    if not org_id.strip():
        raise HTTPException(status_code=400, detail="org_id is required")
    versions = list_dna_versions(org_id, sku_id)
    return {"sku_id": sku_id, "versions_count": len(versions), "versions": versions}


@router.post("/approve")
def approve_dna(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Approves a specific Product DNA version, locking it as immutable product truth."""
    org_id = str(payload.get("organization_id") or "").strip()
    sku_id = str(payload.get("sku_id") or "").strip()
    version = int(payload.get("version", 1))
    approved_by = str(payload.get("approved_by") or "admin")

    if not org_id:
        raise HTTPException(status_code=400, detail="organization_id is required")
    if not sku_id:
        raise HTTPException(status_code=400, detail="sku_id is required")

    success = approve_dna_version(org_id, sku_id, version, approved_by)
    if not success:
        raise HTTPException(status_code=404, detail="DNA version not found to approve")

    # Invalidate stale cache
    cache_manager.invalidate_sku_cache(org_id, sku_id)

    return {"status": "approved", "sku_id": sku_id, "version": version, "approved_by": approved_by}
