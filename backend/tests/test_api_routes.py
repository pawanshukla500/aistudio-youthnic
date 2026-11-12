import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "Youthnic AI Fashion Studio Orchestration API"
    assert data["version"] == "2.0.0"


def test_health_check_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "components" in data
    assert "postgresql" in data["components"]
    assert "valkey" in data["components"]


def test_readiness_endpoint():
    response = client.get("/readiness")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"


def test_dna_extract_endpoint(monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "INTERNAL_API_SECRET", "test_internal_secret")
    payload = {
        "organization_id": "7d56360f-2c96-4eb2-923e-f22b7fe36605",
        "sku_id": "api_test_sku",
        "sku_name": "API Test Kurti Set",
        "references": [
            {"role": "front", "downloadUrl": "http://example.com/front.jpg", "hash": "f1"},
            {"role": "bottom", "downloadUrl": "http://example.com/bottom.jpg", "hash": "b1"},
        ],
    }
    response = client.post(
        "/api/v1/dna/extract",
        json=payload,
        headers={"x-internal-secret": "test_internal_secret"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["product_dna"]["sku_id"] == "api_test_sku"
    assert data["pose_plans_count"] == 6


def test_qa_evaluate_endpoint(monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "INTERNAL_API_SECRET", "test_internal_secret")
    payload = {
        "organization_id": "7d56360f-2c96-4eb2-923e-f22b7fe36605",
        "job_id": "job_eval_01",
        "generation_id": "gen_eval_01",
        "sku_id": "sku_eval_01",
        "pose_index": 1,
        "pose_type": "full_front",
        "product_dna": {"bottom_wear": {"cut_class": "straight"}},
        "ai_raw_evaluation": {
            "scores": {"garment_identity": 98.0, "colors": 96.0},
            "checks": {"garment_identity": "pass", "colors": "pass"},
        },
    }
    response = client.post(
        "/api/v1/qa/evaluate",
        json=payload,
        headers={"x-internal-secret": "test_internal_secret"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "evaluated"
    assert data["outcome"] == "pass"


def test_internal_api_auth_enforcement(monkeypatch):
    from config import settings

    # Fail closed (503) when secret is unconfigured and bypass is disabled
    monkeypatch.setattr(settings, "INTERNAL_API_SECRET", "")
    monkeypatch.setattr(settings, "INTERNAL_API_AUTH_BYPASS", False)
    assert client.get("/api/v1/workflows/overview").status_code == 503

    monkeypatch.setattr(settings, "INTERNAL_API_SECRET", "super_secret_test_token")

    # Public health endpoints must stay reachable without internal auth
    assert client.get("/health").status_code == 200
    assert client.get("/readiness").status_code == 200

    # Protected /api/v1/* endpoints reject missing or wrong secret
    assert client.get("/api/v1/workflows/overview").status_code == 401
    assert client.get("/api/v1/workflows/overview", headers={"x-internal-secret": "wrong"}).status_code == 401

    # Valid secret succeeds via header or Bearer token
    ok_res = client.get("/api/v1/workflows/overview", headers={"x-internal-secret": "super_secret_test_token"})
    assert ok_res.status_code == 200
    assert ok_res.json()["engine"] == "langgraph"

    bearer_res = client.get("/api/v1/workflows/overview", headers={"Authorization": "Bearer super_secret_test_token"})
    assert bearer_res.status_code == 200

    # Cross-tenant workflow thread access returns 403
    org_a = "7d56360f-2c96-4eb2-923e-f22b7fe36605"
    org_b = "11111111-2222-3333-4444-555555555555"
    cross_res = client.get(
        f"/api/v1/workflows/checkpoints/thread_dna_{org_b}_sku1?organization_id={org_a}",
        headers={"x-internal-secret": "super_secret_test_token"},
    )
    assert cross_res.status_code == 403

    seen_org = {}

    def fake_list_threads(limit=30, organization_id=None):
        seen_org["organization_id"] = organization_id
        return [{"thread_id": f"thread_dna_{organization_id}_sku1"}]

    monkeypatch.setattr("routes.workflows.list_workflow_threads", fake_list_threads)
    threads_res = client.get(
        f"/api/v1/workflows/threads?organization_id={org_a}",
        headers={"x-internal-secret": "super_secret_test_token"},
    )
    assert threads_res.status_code == 200
    assert threads_res.json()["organization_id"] == org_a
    assert seen_org["organization_id"] == org_a

