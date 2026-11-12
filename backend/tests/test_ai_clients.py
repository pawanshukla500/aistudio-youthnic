import base64
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


def test_dna_agent_sets_draft_and_quarantines_style(monkeypatch):
    import os
    import tempfile

    valid_png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    )

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
    with tempfile.TemporaryDirectory(dir=os.path.dirname(__file__)) as fixture_dir:
        front = os.path.join(fixture_dir, "front.jpg")
        style = os.path.join(fixture_dir, "style.jpg")
        with open(front, "wb") as fh:
            fh.write(valid_png)
        with open(style, "wb") as fh:
            fh.write(valid_png)

        from services.ai_clients import load_reference_image
        assert load_reference_image({"role": "saree_front_drape", "download_url": f"local://{front}"}) is None

        out = agent.process({
            "organization_id": "org_test",
            "sku_id": "SKU-MOCK-VLM",
            "sku_name": "Banarasi Red Saree",
            "source_fingerprint": "fp_mock_1",
            "allow_local_references": True,
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


def test_ssrf_and_storage_path_tenant_guards():
    from services.ai_clients import _is_safe_public_url, _is_allowed_org_storage_path

    assert _is_safe_public_url("http://127.0.0.1:8080/secret") is False
    assert _is_safe_public_url("http://169.254.169.254/latest/meta-data/") is False
    assert _is_safe_public_url("http://10.0.0.5/internal") is False
    assert _is_safe_public_url("http://100.64.0.1/cgnat") is False
    assert _is_safe_public_url("https://8.8.8.8/image.jpg") is True

    org_id = "7d56360f-2c96-4eb2-923e-f22b7fe36605"
    other_org = "11111111-2222-3333-4444-555555555555"
    assert _is_allowed_org_storage_path(f"organizations/{org_id}/catalog/front.jpg", org_id) is True
    assert _is_allowed_org_storage_path(f"users/u1/organizations/{org_id}/front.jpg", org_id) is True
    assert _is_allowed_org_storage_path(f"organizations/{other_org}/catalog/front.jpg", org_id) is False
    assert _is_allowed_org_storage_path(f"organizations/{org_id}/../{other_org}/front.jpg", org_id) is False
    assert _is_allowed_org_storage_path(f"organizations/{org_id}/catalog/front.jpg", "") is False
    assert _is_allowed_org_storage_path(f"organizations/{org_id}/catalog/front.jpg", None) is False

    from services.ai_clients import _is_allowed_local_path
    assert _is_allowed_local_path("/etc/passwd") is False


def test_download_public_image_bounded_streams_without_context_manager(monkeypatch):
    from services.ai_clients import _download_public_image_bounded

    closed = {"flag": False}

    class NonContextResponse:
        status_code = 200
        headers = {"content-length": "6"}

        def iter_bytes(self, chunk_size=65536):
            yield b"img"
            yield b"123"

        def close(self):
            closed["flag"] = True

    class FakeHttpClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def build_request(self, method, url, headers=None):
            class Req:
                extensions = {}
            return Req()

        def send(self, req, stream=True):
            return NonContextResponse()

    monkeypatch.setattr("services.ai_clients._resolve_safe_public_ip", lambda url: "93.184.216.34")
    monkeypatch.setattr("services.ai_clients.httpx.Client", FakeHttpClient)

    out = _download_public_image_bounded("https://firebasestorage.googleapis.com/v0/b/test/o/img.jpg?alt=media")
    assert out == b"img123"
    assert closed["flag"] is True

