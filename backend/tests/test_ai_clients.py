import base64
from agents.dna_agent import ProductDNAAgent
from services.ai_clients import invoke_vision_json
from config import settings


def test_parse_meta_response_sse_keeps_product_truth_json():
    import json
    from services.ai_clients import parse_meta_response_sse

    payload = parse_meta_response_sse("\n".join([
        "data: " + json.dumps({"type": "response.output_text.delta", "delta": '{"ok":'}),
        "data: " + json.dumps({"type": "response.output_text.delta", "delta": "true}"}),
        "data: " + json.dumps({"type": "response.completed", "response": {"id": "resp_1", "usage": {"output_tokens": 4}}}),
        "data: [DONE]",
    ]))
    assert payload["output_text"] == '{"ok":true}'
    assert payload["usage"]["output_tokens"] == 4

    import pytest
    with pytest.raises(RuntimeError, match="server_error: stream failed"):
        parse_meta_response_sse("\n".join([
            "data: " + json.dumps({"type": "response.output_text.delta", "delta": '{"ok":true}'}),
            "data: " + json.dumps({"type": "error", "error": {"code": "server_error", "message": "stream failed"}}),
        ]))


def test_analysis_budget_reaches_muse_past_the_default_window(monkeypatch):
    from services import ai_clients

    monkeypatch.setattr(settings, "META_MODEL_API_KEY", "meta_test_key")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    monkeypatch.setattr(settings, "VISION_TIMEOUT_SECONDS", 80)
    seen = {}

    class FakeResp:
        status_code = 200
        content = b'{"output_text": "{\\"ok\\": true}"}'
        text = '{"output_text": "{\\"ok\\": true}"}'

        def json(self):
            return {"output_text": '{"ok": true}'}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            seen["timeout"] = kwargs.get("timeout", args[0] if args else None)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            seen["timeout_s_body"] = json["reasoning"]["effort"]
            return FakeResp()

    monkeypatch.setattr(ai_clients.httpx, "Client", FakeClient)
    monkeypatch.setattr(ai_clients.cache_manager, "record_provider_result", lambda *a, **k: None)
    result = ai_clients.invoke_vision_json(
        "prompt",
        [{"role": "front", "mime_type": "image/jpeg", "base64": "YQ=="}],
        purpose="product_truth",
        timeout_budget_s=240,
    )
    assert result is not None
    assert result["provider"] == "meta"
    # OpenAI is configured, so Muse keeps the established 35s fallback reserve.
    timeout = seen["timeout"]
    read_s = getattr(timeout, "read", timeout)
    assert float(read_s) > 180


def test_meta_image_stream_stops_when_the_deadline_passes(monkeypatch):
    import pytest
    from services import ai_clients

    monkeypatch.setattr(settings, "META_MODEL_API_KEY", "meta_test_key")
    monkeypatch.setattr(ai_clients.cache_manager, "record_provider_result", lambda *a, **k: None)
    clock = {"now": 0.0}
    monkeypatch.setattr(ai_clients.time, "monotonic", lambda: clock["now"])

    class StreamBody:
        status_code = 200
        closed = False

        def iter_bytes(self):
            clock["now"] = 50.0
            yield b'data: {"type":"response.output_text.delta","delta":"{"}'

        def close(self):
            self.closed = True

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def stream(self, method, url, headers=None, json=None):
            assert json["stream"] is True
            return StreamBody()

    client = FakeClient()
    with pytest.raises(TimeoutError, match="deadline exhausted"):
        ai_clients._invoke_meta_response(
            client,
            {"model": "muse-spark-1.3-contributor", "stream": True, "input": []},
            deadline=10.0,
        )


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
            if json["model"] == "muse-spark-1.3-contributor":
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
    assert result["model"] == "muse-spark-1.2-contributor"
    assert result["reasoning"] == "medium"
    assert calls[0]["json"]["model"] == "muse-spark-1.3-contributor"
    assert calls[1]["json"]["model"] == "muse-spark-1.2-contributor"
    assert calls[0]["json"]["input"][0]["role"] == "user"
    assert calls[0]["json"]["reasoning"] == {"effort": "medium"}


def test_invoke_vision_json_falls_back_to_gpt61_terra_medium_for_analysis(monkeypatch):
    monkeypatch.setattr(settings, "META_MODEL_API_KEY", "meta_test_key")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-test-key")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")

    def fail_meta(*args, **kwargs):
        raise RuntimeError("Meta unavailable")

    openai_calls = []

    def fake_openai(prompt, images, model="gpt-5.6-luna", reasoning_effort="medium", timeout_s=60):
        openai_calls.append((model, reasoning_effort))
        return {
            "provider": "openai",
            "model": model,
            "reasoning": reasoning_effort,
            "data": {"garment_family": "kurti_set"},
        }

    monkeypatch.setattr("services.ai_clients._meta_vision_json", fail_meta)
    monkeypatch.setattr("services.ai_clients._langchain_openai_vision_json", fake_openai)

    result = invoke_vision_json(
        "Extract kurti DNA",
        [{"role": "front_product", "mime_type": "image/jpeg", "base64": "YWJj"}],
        purpose="product_truth",
    )
    assert result is not None
    assert result["provider"] == "openai"
    assert result["model"] == "gpt-6.1-terra"
    assert result["reasoning"] == "medium"
    assert openai_calls == [("gpt-6.1-terra", "medium")]


def test_dna_agent_sets_draft_and_quarantines_style(monkeypatch):
    import os
    import tempfile

    valid_png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    )

    seen_roles = []

    def fake_vision(prompt, images, purpose="product_truth", timeout_budget_s=None):
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


def test_meta_vision_json_records_terminal_failure_once(monkeypatch):
    import pytest
    from services import ai_clients

    recorded = []

    class FakeResp:
        status_code = 500
        content = b'{"error": {"message": "Meta internal error"}}'
        def json(self):
            return {"error": {"message": "Meta internal error"}}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def post(self, *args, **kwargs):
            return FakeResp()

    monkeypatch.setattr(ai_clients.settings, "META_MODEL_API_KEY", "meta-test-key")
    monkeypatch.setattr(ai_clients.httpx, "Client", FakeClient)
    monkeypatch.setattr(ai_clients.cache_manager, "record_provider_result", lambda provider, success, error=None: recorded.append((provider, success, error)))

    with pytest.raises(RuntimeError, match="Meta vision call failed"):
        ai_clients._meta_vision_json("prompt", [], effort="high")

    assert recorded == [("meta", False, "Meta internal error")]


def test_invoke_vision_json_clamps_tight_budget_to_low_effort(monkeypatch):
    from services import ai_clients

    seen_efforts = []

    class FakeResp:
        status_code = 200
        content = b"{}"

        def json(self):
            return {"output_text": '{"ok": true}'}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            seen_efforts.append((json["model"], json["reasoning"]["effort"]))
            return FakeResp()

    monkeypatch.setattr(ai_clients.settings, "META_MODEL_API_KEY", "meta-test-key")
    monkeypatch.setattr(ai_clients.settings, "OPENAI_API_KEY", "")
    monkeypatch.setattr(ai_clients.settings, "GEMINI_API_KEY", "")
    monkeypatch.setattr(ai_clients.httpx, "Client", FakeClient)
    monkeypatch.setattr(ai_clients.cache_manager, "record_provider_result", lambda *a, **k: None)

    result = ai_clients.invoke_vision_json(
        "prompt",
        [],
        purpose="product_truth",
        timeout_budget_s=45.0,
    )
    assert result is not None
    assert result["reasoning"] == "low"
    assert seen_efforts == [("muse-spark-1.3-contributor", "low")]


def test_meta_sibling_retry_clamps_medium_to_low_when_budget_drops_below_60s(monkeypatch):
    from services import ai_clients

    seen_calls = []
    # Simulated clock: starts at t=100.0 (deadline=175.0 -> 75s remaining -> medium);
    # after first 404 response, jumps +20s so sibling retry sees 55s remaining (<60s -> low).
    clock = {"now": 100.0}

    def fake_monotonic():
        return clock["now"]

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
            return False

        def post(self, url, headers=None, json=None):
            seen_calls.append((json["model"], json["reasoning"]["effort"]))
            if json["model"] == "muse-spark-1.3-contributor":
                clock["now"] += 20.0
                return FakeResp(404, {"error": {"message": "Model not found"}})
            return FakeResp(200, {"output_text": '{"ok": true}'})

    monkeypatch.setattr(ai_clients.settings, "META_MODEL_API_KEY", "meta-test-key")
    monkeypatch.setattr(ai_clients.time, "monotonic", fake_monotonic)
    monkeypatch.setattr(ai_clients.httpx, "Client", FakeClient)
    monkeypatch.setattr(ai_clients.cache_manager, "record_provider_result", lambda *a, **k: None)

    result = ai_clients._meta_vision_json(
        "prompt",
        [],
        timeout_s=75,
        effort="medium",
        deadline=175.0,
    )
    assert seen_calls == [
        ("muse-spark-1.3-contributor", "medium"),
        ("muse-spark-1.2-contributor", "low"),
    ]
    assert result["model"] == "muse-spark-1.2-contributor"
    assert result["reasoning"] == "low"


def test_gemini_vision_json_retries_transient_503_and_preserves_multihop_budget(monkeypatch):
    from services import ai_clients

    monkeypatch.setattr(settings, "VISION_TIMEOUT_SECONDS", 150)
    monkeypatch.setattr(settings, "META_MODEL_API_KEY", "")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "gem-test")
    monkeypatch.setattr(ai_clients.time, "sleep", lambda *a, **k: None)

    recorded_timeouts = []
    gemini_calls = {"count": 0}

    def fake_openai(prompt, images, model="gpt-5.6-luna", reasoning_effort="medium", timeout_s=60):
        recorded_timeouts.append((model, timeout_s))
        raise RuntimeError(f"{model} timed out")

    class FakeGeminiResp:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self._payload = payload
            self.headers = {}
            self.content = b"{}"

        def json(self):
            return self._payload

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            gemini_calls["count"] += 1
            if gemini_calls["count"] == 1:
                return FakeGeminiResp(503, {"error": {"message": "Temporarily unavailable"}})
            return FakeGeminiResp(
                200,
                {
                    "candidates": [
                        {
                            "content": {
                                "parts": [
                                    {"text": '{"garment_family": "kurta_or_kurti_set", "main_color": "mustard yellow"}'}
                                ]
                            }
                        }
                    ]
                },
            )

    monkeypatch.setattr("services.ai_clients._langchain_openai_vision_json", fake_openai)
    monkeypatch.setattr("services.ai_clients.httpx.Client", FakeClient)
    monkeypatch.setattr("services.ai_clients.cache_manager.record_provider_result", lambda *a, **k: None)

    res = ai_clients.invoke_vision_json(
        "Extract DNA",
        [{"role": "front", "mime_type": "image/jpeg", "base64": "YWJj"}],
        purpose="product_truth",
        timeout_budget_s=150.0,
    )
    assert res["provider"] == "gemini"
    assert res["model"] == "gemini-3.8-flash"
    assert gemini_calls["count"] == 2
    # gpt-6.1-terra reserved >= 35s for later hops instead of only 15s
    assert 110 <= recorded_timeouts[0][1] <= 116
    assert 110 <= recorded_timeouts[1][1] <= 116


def test_meta_429_tpm_switches_to_sibling_then_falls_back_to_gpt61_terra(monkeypatch):
    from services import ai_clients

    monkeypatch.setattr(settings, "META_MODEL_API_KEY", "meta_test_key")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-test-key")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")

    meta_models = []
    openai_calls = []

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
            return False

        def post(self, url, headers=None, json=None):
            meta_models.append(json["model"])
            return FakeResp(
                429,
                {"error": {"message": "Rate limit reached: tokens per min (TPM) quota exceeded"}},
            )

    def fake_openai(prompt, images, model="gpt-5.6-luna", reasoning_effort="medium", timeout_s=60):
        openai_calls.append((model, reasoning_effort))
        return {
            "provider": "openai",
            "model": model,
            "reasoning": reasoning_effort,
            "data": {"garment_family": "kurta_or_kurti_set", "main_color": "maroon"},
        }

    monkeypatch.setattr(ai_clients.httpx, "Client", FakeClient)
    monkeypatch.setattr(ai_clients, "_langchain_openai_vision_json", fake_openai)
    monkeypatch.setattr(ai_clients.cache_manager, "record_provider_result", lambda *a, **k: None)

    result = ai_clients.invoke_vision_json(
        "Extract kurti DNA",
        [{"role": "front", "mime_type": "image/jpeg", "base64": "YWJj"}],
        purpose="product_truth",
        timeout_budget_s=180.0,
    )
    assert result is not None
    # Each Meta model is tried once on 429 (no redundant same-model retry), then GPT-6.1 Terra takes over
    assert meta_models == ["muse-spark-1.3-contributor", "muse-spark-1.2-contributor"]
    assert openai_calls == [("gpt-6.1-terra", "medium")]
    assert result["provider"] == "openai"
    assert result["model"] == "gpt-6.1-terra"


def test_dna_agent_reuses_matching_fingerprint_across_studio_sku_rename(monkeypatch):
    agent = ProductDNAAgent()
    monkeypatch.setattr("agents.dna_agent.cache_manager.get_hot_dna", lambda *a, **k: None)
    monkeypatch.setattr("agents.dna_agent.cache_manager.set_hot_dna", lambda *a, **k: None)
    monkeypatch.setattr("agents.dna_agent.get_latest_dna_version", lambda org_id, sku_id: None)
    monkeypatch.setattr(
        "agents.dna_agent.get_dna_version_by_fingerprint",
        lambda org_id, sku_id, fp: {
            "sku_id": "studio-draft123",
            "version": 1,
            "approved": False,
            "source_fingerprint": fp,
            "dna_payload": {
                "garment_family": "kurta_or_kurti_set",
                "main_color": "maroon",
                "version": 1,
                "approved": False,
                "metadata": {"analysis_source": "vlm"},
            },
        },
    )

    def should_not_call_vlm(*args, **kwargs):
        raise AssertionError("VLM should not be called when fingerprint already exists in Postgres")

    monkeypatch.setattr("agents.dna_agent.invoke_vision_json", should_not_call_vlm)

    out = agent.process({
        "organization_id": "org_1",
        "sku_id": "B45-Raha-Maroon",
        "sku_name": "Raha Maroon Set",
        "source_fingerprint": "fp_raha_maroon",
        "references": [],
    })
    assert out["product_dna"]["main_color"] == "maroon"
    assert out["product_dna"]["metadata"]["analysis_source"] == "vlm"


def test_dna_agent_uses_seed_analysis_without_second_vlm_call(monkeypatch):
    agent = ProductDNAAgent()
    monkeypatch.setattr("agents.dna_agent.cache_manager.get_hot_dna", lambda *a, **k: None)
    monkeypatch.setattr("agents.dna_agent.cache_manager.set_hot_dna", lambda *a, **k: None)
    monkeypatch.setattr("agents.dna_agent.get_latest_dna_version", lambda org_id, sku_id: None)
    monkeypatch.setattr("agents.dna_agent.get_dna_version_by_fingerprint", lambda org_id, sku_id, fp: None)
    monkeypatch.setattr("agents.dna_agent.save_dna_version", lambda *a, **k: 1)

    def should_not_call_vlm(*args, **kwargs):
        raise AssertionError("VLM should not be called when seed_analysis from studio.analyze is provided")

    monkeypatch.setattr("agents.dna_agent.invoke_vision_json", should_not_call_vlm)

    out = agent.process({
        "organization_id": "org_1",
        "sku_id": "B45-Raha-Maroon",
        "sku_name": "B45-Raha-Maroon",
        "source_fingerprint": "fp_seed_1",
        "seed_analysis": {
            "provider": "meta",
            "model": "muse-spark-1.3-contributor",
            "product_identity": {
                "garmentFamily": "kurta_or_kurti_set",
                "category": "ethnic/fusion",
                "mainColor": "deep maroon",
                "fabric": "georgette",
                "embroidery": "silver thread floral border embroidery",
                "bottomWearIncluded": True,
                "bottomWearCut": "farshi",
                "bottomWearDetails": "Farshi salwar with 6-inch joined hem panel",
                "invariantDetails": ["preserve silver floral hem embroidery"],
            },
        },
        "references": [
            {"role": "front", "hash": "h1"},
            {"role": "back", "hash": "h2"},
            {"role": "bottom", "hash": "h3"},
        ],
    })
    assert out["product_dna"]["main_color"] == "deep maroon"
    assert out["product_dna"]["bottom_wear"]["cut_class"] == "farshi"
    assert out["product_dna"]["metadata"]["analysis_source"] == "vlm"
    assert out["product_dna"]["metadata"]["provider"] == "meta"
    assert out["product_dna"]["metadata"]["model"] == "muse-spark-1.3-contributor"


def test_forced_reanalysis_builds_dna_from_its_fresh_seed_without_a_second_vlm_call(monkeypatch):
    """Studio "Re-analyze" sends force_refresh with the new analysis as seed: no stored version, no VLM call, no download."""
    from agents.evidence_agent import ProductEvidenceAgent

    stored = {"source_fingerprint": "fp_seed_forced", "dna_payload": {"main_color": "stale blue", "metadata": {}}, "sku_id": "T94", "version": 3}
    monkeypatch.setattr("agents.dna_agent.cache_manager.get_hot_dna", lambda *a, **k: stored["dna_payload"] | {"source_fingerprint": "fp_seed_forced"})
    monkeypatch.setattr("agents.dna_agent.cache_manager.set_hot_dna", lambda *a, **k: None)
    monkeypatch.setattr("agents.dna_agent.get_latest_dna_version", lambda org_id, sku_id: stored)
    monkeypatch.setattr("agents.dna_agent.get_dna_version_by_fingerprint", lambda org_id, sku_id, fp: stored)
    monkeypatch.setattr("agents.dna_agent.save_dna_version", lambda *a, **k: 4)

    def no_second_call(*args, **kwargs):
        raise AssertionError("a forced re-analysis with a seed must not call the VLM or download references again")

    monkeypatch.setattr("agents.dna_agent.invoke_vision_json", no_second_call)
    monkeypatch.setattr("agents.dna_agent.load_reference_image", no_second_call)
    seed = {"provider": "zai", "model": "glm-5.3-flash", "product_identity": {"garmentFamily": "kurta_or_kurti_set", "mainColor": "kattha brown"}}
    references = [{"role": "front", "hash": "h1"}, {"role": "back", "hash": "h2"}]
    out = ProductDNAAgent().process({
        "organization_id": "org_1", "sku_id": "T94", "sku_name": "T94", "source_fingerprint": "fp_seed_forced",
        "force_refresh": True, "seed_analysis": seed, "references": references,
    })
    assert out["product_dna"]["main_color"] == "kattha brown", "the fresh seed wins over the stored version"
    assert out["product_dna"]["version"] == 4
    assert out["product_dna"]["metadata"]["provider"] == "zai"

    monkeypatch.setattr("agents.evidence_agent.cache_manager.get_manifest_cache", lambda *a, **k: None)
    monkeypatch.setattr("agents.evidence_agent.cache_manager.set_manifest_cache", lambda *a, **k: None)
    monkeypatch.setattr("agents.evidence_agent.save_reference_evidence", lambda **k: "")
    monkeypatch.setattr("agents.evidence_agent.load_reference_image", no_second_call)
    evidence = ProductEvidenceAgent().process({
        "organization_id": "org_1", "sku_id": "T94", "force_refresh": True, "seed_analysis": seed, "references": references,
    })
    assert [ref["sha256_hash"] for ref in evidence["references"]] == ["h1", "h2"]


def test_python_sentry_telemetry_dsn_and_envelope():
    from services.sentry_telemetry import (
        build_sentry_envelope,
        build_sentry_event_payload,
        parse_sentry_dsn,
    )

    dsn = "https://pykey123@o450000.ingest.sentry.io/778899"
    parsed = parse_sentry_dsn(dsn)
    assert parsed is not None
    assert parsed["public_key"] == "pykey123"
    assert parsed["project_id"] == "778899"
    assert parsed["envelope_url"] == "https://o450000.ingest.sentry.io/api/778899/envelope/?sentry_key=pykey123&sentry_version=7"

    payload = build_sentry_event_payload(
        RuntimeError("Vision fallback exhausted"),
        tags={"purpose": "product_truth"},
        extra={"sku_id": "B45-Raha-Maroon"},
    )
    assert payload["tags"]["purpose"] == "product_truth"
    assert payload["exception"]["values"][0]["value"] == "Vision fallback exhausted"
    envelope = build_sentry_envelope(parsed, payload)
    assert len(envelope.strip().split("\n")) == 3


def test_invoke_vision_json_meta_to_zai_glm_5_3_flash_to_openai_fallback(monkeypatch):
    """When Meta Muse Spark fails, invoke_vision_json fails over to Z.ai GLM-5.3-Flash (with FlashX sibling retry) before OpenAI GPT."""
    monkeypatch.setattr(settings, "META_MODEL_API_KEY", "meta-test-key")
    monkeypatch.setattr(settings, "ZAI_API_KEY", "zai-test-key")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "openai-test-key")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")

    calls = []

    def fake_meta(prompt, images, timeout_s=115, effort="medium", deadline=None):
        calls.append(("meta", effort))
        raise RuntimeError("Meta HTTP 429: tokens per min rate limit")

    def fake_zai(prompt, images, model="glm-5.3-flash", reasoning_effort="medium", timeout_s=60, deadline=None):
        calls.append(("zai", model, reasoning_effort))
        return {
            "provider": "zai",
            "model": model,
            "reasoning": reasoning_effort,
            "data": {"garment_family": "kurta_or_kurti_set", "main_color": "maroon"},
        }

    monkeypatch.setattr("services.ai_clients._meta_vision_json", fake_meta)
    monkeypatch.setattr("services.ai_clients._zai_vision_json", fake_zai)

    result = invoke_vision_json(
        "Extract kurti DNA",
        [{"role": "front", "mime_type": "image/jpeg", "base64": "YWJj"}],
        purpose="product_truth",
        timeout_budget_s=180.0,
    )
    assert result is not None
    assert result["provider"] == "zai"
    assert result["model"] == "glm-5.3-flash"
    assert result["reasoning"] == "medium"
    assert calls[0][0] == "meta"
    assert calls[1] == ("zai", "glm-5.3-flash", "medium")


def test_dna_seed_mapping_and_cross_sku_fingerprint_clone(monkeypatch):
    from agents import dna_agent as dna_mod

    agent = dna_mod.ProductDNAAgent()
    kurti_raw = agent._raw_from_seed_analysis({
        "product_identity": {
            "garmentFamily": "kurta_or_kurti_set",
            "mainColor": "maroon",
            "fabric": "mulmul cotton",
            "bottomWearDetails": "Matching maroon farshi pajama with 6-inch tapered embroidered hem",
        }
    })
    assert kurti_raw is not None
    assert kurti_raw["bottom_wear"]["has_bottom_wear"] is True
    assert kurti_raw["bottom_wear"]["cut_class"] == "farshi"

    saree_raw = agent._raw_from_seed_analysis({
        "product_identity": {
            "garmentFamily": "saree",
            "mainColor": "crimson",
            "fabric": "kanjeevaram silk",
            "sareeDrapePlan": {
                "baseDrapeFamily": "bengali_aatpoure",
                "palluShoulderPlacement": "left_shoulder_back_to_front",
            },
            "sareeTruth": {
                "pallu": {"zari": "gold kadhua zari", "artwork": "temple motif panel"},
                "borders": {"construction": "korvai temple border"},
                "body": {"motifPlacement": "spaced gold butti", "motifInventory": ["peacock", "lotus"]},
                "blouse": {"color": "deep green", "fabric": "raw silk", "sleeves": "elbow", "backConstruction": "boat back with dori"},
            },
        }
    })
    assert saree_raw is not None
    assert saree_raw["saree_details"]["drape_style"] == "bengali_aatpoure"
    assert saree_raw["saree_details"]["pallu_zari_type"] == "gold kadhua zari"
    assert saree_raw["saree_details"]["blouse_fabric_coordination"] == "deep green raw silk"
    assert saree_raw["saree_details"]["blouse_back_neckline"] == "boat back with dori"

    saved_calls = []
    monkeypatch.setattr(dna_mod, "get_latest_dna_version", lambda org_id, sku_id: None)
    monkeypatch.setattr(
        dna_mod,
        "get_dna_version_by_fingerprint",
        lambda org_id, sku_id, fp: {
            "sku_id": "OLD-SKU",
            "sku_name": "Old Garment",
            "version": 3,
            "source_fingerprint": fp,
            "approved": True,
            "dna_payload": {
                "organization_id": org_id,
                "sku_id": "OLD-SKU",
                "sku_name": "Old Garment",
                "garment_family": "kurta_or_kurti_set",
                "main_color": "maroon",
                "source_fingerprint": fp,
                "metadata": {"analysis_source": "vlm"},
            },
        },
    )

    def fake_save_dna_version(**kwargs):
        saved_calls.append(kwargs)
        return 1

    monkeypatch.setattr(dna_mod, "save_dna_version", fake_save_dna_version)
    out = agent.process({
        "organization_id": "org_1",
        "sku_id": "NEW-SKU",
        "sku_name": "New Garment",
        "source_fingerprint": "fp_shared_1",
        "auto_approve": False,
        "references": [{"role": "front", "sha256_hash": "h1"}],
    })
    assert len(saved_calls) == 1
    assert saved_calls[0]["sku_id"] == "NEW-SKU"
    assert saved_calls[0]["sku_name"] == "New Garment"
    assert out["dna_persisted"] is True
    assert out["product_dna"]["sku_id"] == "NEW-SKU"
    assert out["product_dna"]["sku_name"] == "New Garment"
    assert out["product_dna"]["version"] == 1


def test_zai_non_retryable_client_error_skips_flashx(monkeypatch):
    from services import ai_clients

    monkeypatch.setattr(settings, "ZAI_API_KEY", "zai-test-key")
    invoked_models = []

    class FakeChat:
        def __init__(self, model, **kwargs):
            invoked_models.append(model)

        def invoke(self, msgs):
            raise RuntimeError("Error code: 401 - invalid api key unauthorized")

    import langchain_openai
    monkeypatch.setattr(langchain_openai, "ChatOpenAI", FakeChat)

    import pytest
    with pytest.raises(RuntimeError, match="401"):
        ai_clients._zai_vision_json(
            "test",
            [{"role": "front", "mime_type": "image/jpeg", "base64": "YWJj"}],
        )
    assert invoked_models == ["glm-5.3-flash"]


