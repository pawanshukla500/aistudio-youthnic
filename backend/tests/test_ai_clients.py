import base64
from unittest.mock import MagicMock
from agents.qa_agent import ComputerVisionQAAgent
from agents.dna_agent import ProductDNAAgent
from services.ai_clients import invoke_vision_json, generate_catalog_image, normalize_image_size
from config import settings


def test_meta_muse_spark_sibling_retry_uses_canonical_input(monkeypatch):
    monkeypatch.setattr(settings, "META_MODEL_API_KEY", "meta_test_key")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")

    calls = []

    class FakeResp:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self._payload = payload
            self.content = b"{}"

        def json(self):
            return self._payload

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, headers=None, json=None):
            calls.append({"url": url, "json": json})
            if json["model"] == "muse-spark-1.2-contributor":
                return FakeResp(404, {"error": {"message": "Model not found"}})
            return FakeResp(
                200,
                {
                    "output_text": '{"garment_family": "saree", "main_color": "crimson", "confidence_score": 0.94}'
                },
            )

    monkeypatch.setattr("services.ai_clients.httpx.Client", FakeClient)

    result = invoke_vision_json(
        "Extract saree DNA",
        [{"role": "saree_front_drape", "mime_type": "image/jpeg", "base64": "YWJj"}],
    )
    assert result is not None
    assert result["provider"] == "meta"
    assert result["model"] == "muse-spark-1.3-contributor"
    assert calls[0]["json"]["input"][0]["role"] == "user"
    assert calls[0]["json"]["reasoning"] == {"effort": "low"}


def test_generate_catalog_image_gpt_2_6_multipart_and_size(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-test-key")
    assert normalize_image_size("3:4", "2K", "gpt-image-2.6-sunburst") == "1536x2048"
    assert normalize_image_size("3:4", "1K", "gpt-image-2.6-flare") == "768x1024"

    captured = {}

    class FakeResp:
        status_code = 200
        headers = {"x-request-id": "req_123"}
        content = b"{}"

        def json(self):
            return {
                "data": [{"b64_json": base64.b64encode(b"\xff\xd8\xff\xe0jpegbytes").decode("ascii")}],
                "usage": {"input_tokens": 1000, "output_tokens": 2000},
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, headers=None, data=None, files=None, json=None):
            captured["url"] = url
            captured["data"] = data
            captured["files"] = files
            return FakeResp()

    monkeypatch.setattr("services.ai_clients.httpx.Client", FakeClient)

    res = generate_catalog_image(
        prompt="Saree catalog pose 1",
        model="gpt-image-2.6-sunburst",
        aspect_ratio="3:4",
        image_size="2K",
        quality="high",
        reference_images=[{"role": "saree_front_drape", "filename": "front.jpg", "bytes": b"img", "mime_type": "image/jpeg"}],
    )
    assert captured["url"] == "https://api.openai.com/v1/images/edits"
    assert captured["data"]["model"] == "gpt-image-2.6-sunburst"
    assert captured["data"]["size"] == "1536x2048"
    assert res["mime_type"] == "image/jpeg"
    assert res["request_id"] == "req_123"


def test_qa_never_passes_missing_image_without_raw_eval():
    agent = ComputerVisionQAAgent()
    eval_res = agent.evaluate(
        org_id="org_1",
        job_id="job_1",
        generation_id="gen_1",
        sku_id="sku_1",
        pose_index=1,
        pose_type="full_front",
        image_url="",
        product_dna={"garment_family": "saree"},
    )
    assert eval_res.outcome == "retry"
    assert eval_res.review_recommended is True
    assert "missing_generated_image" in eval_res.failed_checks


def test_dna_agent_sets_draft_and_quarantines_style(monkeypatch, tmp_path):
    front = tmp_path / "front.jpg"
    front.write_bytes(b"front_bytes")
    style = tmp_path / "style.jpg"
    style.write_bytes(b"style_bytes")

    seen_roles = []

    def fake_vision(prompt, images, purpose="product_truth"):
        seen_roles.extend(img.get("role") for img in images)
        return {
            "provider": "meta",
            "model": "muse-spark-1.2-contributor",
            "data": {
                "garment_family": "saree",
                "main_color": "ruby red",
                "fabric_type": "banarasi silk",
                "confidence_score": 0.95,
            },
        }

    monkeypatch.setattr("agents.dna_agent.invoke_vision_json", fake_vision)
    agent = ProductDNAAgent()
    out = agent.process({
        "organization_id": "org_test",
        "sku_id": "SKU-MOCK-VLM",
        "sku_name": "Banarasi Red Saree",
        "source_fingerprint": "fp_mock_1",
        "references": [
            {"role": "saree_front_drape", "download_url": f"local://{front}"},
            {"role": "style_reference", "download_url": f"local://{style}"},
        ],
    })
    assert seen_roles == ["saree_front_drape"]
    assert out["dna_approved"] is False
    assert out["product_dna"]["status"] == "draft"
    assert out["product_dna"]["main_color"] == "ruby red"
    assert out["product_dna"]["metadata"]["analysis_source"] == "vlm"
