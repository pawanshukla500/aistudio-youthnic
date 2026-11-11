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


def test_dna_extract_endpoint():
    payload = {
        "organization_id": "7d56360f-2c96-4eb2-923e-f22b7fe36605",
        "sku_id": "api_test_sku",
        "sku_name": "API Test Kurti Set",
        "references": [
            {"role": "front", "downloadUrl": "http://example.com/front.jpg", "hash": "f1"},
            {"role": "bottom", "downloadUrl": "http://example.com/bottom.jpg", "hash": "b1"},
        ],
    }
    response = client.post("/api/v1/dna/extract", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["product_dna"]["sku_id"] == "api_test_sku"
    assert data["pose_plans_count"] == 6


def test_qa_evaluate_endpoint():
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
    response = client.post("/api/v1/qa/evaluate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "evaluated"
    assert data["outcome"] == "pass"
