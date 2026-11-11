from typing import Dict, Any
from fastapi import APIRouter, HTTPException, Query, Body
from models.dna_v2 import ProductDNAV2
from database import get_latest_dna_version, list_dna_versions, approve_dna_version
from graph import get_compiled_graph
from cache import cache_manager

router = APIRouter(prefix="/api/v1/dna", tags=["Product DNA V2"])


@router.post("/extract")
async def extract_product_dna(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Runs LangGraph Product Evidence & DNA Agent workflow to produce immutable Product DNA V2."""
    org_id = payload.get("organization_id", "7d56360f-2c96-4eb2-923e-f22b7fe36605")
    sku_id = payload.get("sku_id")
    sku_name = payload.get("sku_name", sku_id or "Garment")
    references = payload.get("references", [])

    if not sku_id:
        raise HTTPException(status_code=400, detail="sku_id is required")

    graph = get_compiled_graph()
    initial_state = {
        "organization_id": org_id,
        "sku_id": sku_id,
        "sku_name": sku_name,
        "references": references,
        "main_color": payload.get("main_color", "royal_purple"),
        "poses_to_generate": [1, 2, 3, 4, 5, 6],
    }

    config = {"configurable": {"thread_id": f"thread_dna_{org_id}_{sku_id}"}}
    final_state = graph.invoke(initial_state, config=config)
    dna = final_state.get("product_dna", {})

    return {
        "status": "success",
        "sku_id": sku_id,
        "product_dna": dna,
        "pose_plans_count": len(final_state.get("pose_plans", [])),
    }


@router.get("/{sku_id}")
async def get_sku_dna(sku_id: str, org_id: str = Query("7d56360f-2c96-4eb2-923e-f22b7fe36605")) -> Dict[str, Any]:
    """Retrieves latest Product DNA from Valkey hot cache or PostgreSQL."""
    cached = cache_manager.get_hot_dna(org_id, sku_id)
    if cached:
        return {"source": "valkey_cache", "product_dna": cached}

    db_row = get_latest_dna_version(org_id, sku_id)
    if not db_row:
        raise HTTPException(status_code=404, detail=f"Product DNA not found for SKU {sku_id}")

    dna = db_row.get("dna_payload", {})
    cache_manager.set_hot_dna(org_id, sku_id, dna)
    return {"source": "postgres", "version": db_row.get("version"), "product_dna": dna}


@router.get("/{sku_id}/versions")
async def get_dna_versions(sku_id: str, org_id: str = Query("7d56360f-2c96-4eb2-923e-f22b7fe36605")) -> Dict[str, Any]:
    """Lists version history and audit log for a product's DNA."""
    versions = list_dna_versions(org_id, sku_id)
    return {"sku_id": sku_id, "versions_count": len(versions), "versions": versions}


@router.post("/approve")
async def approve_dna(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Approves a specific Product DNA version, locking it as immutable product truth."""
    org_id = payload.get("organization_id", "7d56360f-2c96-4eb2-923e-f22b7fe36605")
    sku_id = payload.get("sku_id")
    version = int(payload.get("version", 1))
    approved_by = payload.get("approved_by", "admin")

    if not sku_id:
        raise HTTPException(status_code=400, detail="sku_id is required")

    success = approve_dna_version(org_id, sku_id, version, approved_by)
    if not success:
        raise HTTPException(status_code=404, detail="DNA version not found to approve")

    # Invalidate stale cache
    cache_manager.invalidate_sku_cache(org_id, sku_id)

    return {"status": "approved", "sku_id": sku_id, "version": version, "approved_by": approved_by}
