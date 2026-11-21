# AI model routing

Which model does which job, who decides, and what happens when a model fails.

## The rule

**The models saved in Administration → AI models are the models that run.** Code never
inserts another model ahead of them or swaps one saved model for another. When `product_truth` uses Meta primary with fallbacks enabled, `resolveVisionPolicy` wires **Z.ai GLM 5.3 Flash** (`glm-5.3-flash:medium`, when `ZAI_API_KEY` is configured) right after Meta Muse Spark, followed by **OpenAI GPT 6.1 Terra** (`gpt-6.1-terra:medium`), **OpenAI GPT 5.6 Luna** (`gpt-5.6-luna:low`), and **Gemini 3.8 Flash** (`gemini-3.8-flash:low`) when configured. When there is no saved policy, the defaults below apply.

Earlier versions broke this rule in several ways, and none of them may come back:

- A hardcoded GPT 5.6 Luna hop always ran first.
- A primary with high reasoning was rerouted to Luna.
- Gemini and Sol were dropped from product analysis.
- A hop whose API key was missing was removed without a trace.
- Four successful Luna runs rewrote the organization's saved policy.

## Purposes

| Purpose (`organization_ai_model_policies.purpose`) | Admin label | Used by | Fallback |
| --- | --- | --- | --- |
| `product_truth` | Product truth & pose planning | Studio **Analyze**, catalog preflight and variant analysis | Yes |
| `qa` | Image QA | The product DNA consistency check on every pose (always on), and per-pose consistency QA when QA is on | Yes |
| `qa_escalation` | *(no separate card)* | Independent recheck for complex garments | Uses the `qa` policy unless its own row exists |
| `image_generation` | Image Generation | The final images (OpenAI Images API) | No |

Each row stores `primary_provider`, `primary_model`, `primary_reasoning`,
`fallback_enabled`, `fallback_provider`, `fallback_model` and `fallback_reasoning`.
Only models listed in `AI_MODEL_REGISTRY` (`supabase/functions/app-api/lib/aiModelPolicy.ts`)
can be saved or called.

## Order and fallback

For a vision purpose, the chain is `[primary, ...fallbacks]` as saved or resolved
(`productTruthRouteChain`). When Meta Muse Spark is primary and OpenAI GPT 6.1 Terra is the
first fallback for `product_truth`, the system also wires OpenAI GPT 5.6 Luna as secondary safety
net (or GPT 6.1 Terra when Luna is saved as first fallback). Administration refuses to
save a fallback identical to the primary ("Choose a different fallback provider or model."). If an older
stored row has an identical primary and fallback route, it deduplicates to avoid redundant retries.

The chain moves to the next fallback when the current model fails for a reason another model can fix:

- model not available (404 / model not found / no access);
- API key missing or rejected;
- budget, quota or billing;
- rate limit;
- timeout;
- incomplete response;
- server error (5xx).

An invalid request (400, malformed input, safety block) stops the chain, because
switching models would not fix the product references.

A hop whose API key is not set is **still attempted**. It fails at once with a
message naming the secret (`META_MODEL_API_KEY`, `ZAI_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`,
`QWEN_API_KEY`), so the administrator can see why a configured fallback never answered.

## Reasoning effort for product analysis

Product analysis is one large multimodal JSON call that must finish inside Studio's 360s wait (and Railway's 280s gateway budget).
- **Meta Muse Spark** (`muse-spark-1.3-contributor` / `1.2-contributor` / `1.3` / `1.2`), **Z.ai GLM 5.3 Flash** (`glm-5.3-flash` / `glm-5.3-flashx`), **OpenAI GPT 6.1 Terra** (`gpt-6.1-terra`), and **OpenAI GPT 5.6 Luna** (`gpt-5.6-luna`) default to **medium** thinking (Meta/Z.ai/Terra) or **low** (Luna) and preserve explicit **high** or **medium** thinking during `product_truth` analysis & pose planning (`clampProductTruthThinking`) for deep chain-of-thought reasoning across garment construction, Farshi/saree drape taxonomy, styling, and 6-pose choreography.
- **Z.ai GLM 5.3 Flash** uses forced thinking (`thinking: { type: "enabled" }`, `temperature: 1`, `top_p: 0.95`, `response_format: { type: "json_object" }`), mapping internal `low` -> `low`, `medium`/`high` -> `high` ("Enhanced Reasoning"), and `max` -> `max`, with 50 concurrent requests on `glm-5.3-flash` and automatic sibling failover to `glm-5.3-flashx` (20x concurrency, 200 tok/s).
- Legacy heavy models (`gpt-5.6-terra`, `gpt-5.6-sol`, `gemini-*`) run at **low** reasoning (or lowest supported level; explicit `"none"` or `"minimal"` is preserved; Qwen runs with thinking off).
- When any hop runs under an emergency tight deadline (`timeoutMs < 60s`), thinking is dynamically clamped to **low** (`clampProductTruthHopThinking`) to avoid timeout cascades while still letting Meta/Z.ai/Terra finish cleanly under standard failover budgets.
QA keeps its saved reasoning, except that Gemini Flash models run at low.

## Product DNA consistency check

Every generated pose gets one DNA consistency call (`buildDnaConsistencyPrompt` in `lib/qa.ts`) before it is
accepted. It runs as purpose `qa` through the same saved chain, at **low** reasoning, and scores shape, color,
material, logo and details (pass floor 85 per attribute; logo is skipped when the product has none). When full
pose QA runs for that pose, no separate call is made: the verdict is derived from the QA scores
(`dnaConsistencyFromQaScores`). If every hop fails, the image ships `unverified` and the check is recorded as
unavailable; it never blocks delivery.

The pose planning graph (`POST /api/v1/plan`) makes no model call and has no purpose row.

## Time budget (product analysis)

- Studio's client waits `STUDIO_ANALYZE_TIMEOUT_MS` (360s). The gateway budget is `ANALYZE_PROXY_BUDGET_MS` (280s) inside Railway's 300s proxy ceiling, holding 5s back inside the chain (`VISION_GATEWAY_RESERVE_MS`).
- While a fallback is still to come, the current hop keeps one `PRODUCT_TRUTH_FALLBACK_RESERVE_MS` (60s) window, guaranteeing Meta or Z.ai timeout still leaves OpenAI GPT 6.1 Terra its 60s medium-thinking window.
- A primary that fails fast (a 404, 429 rate-limit, or missing key) hands the next model nearly the whole budget.

## Errors people see

When every configured model fails, the message names each model and its reason.
For example:

> Every configured vision model failed. OpenAI gpt-5.6-terra: This model is not available
> to the configured API key (model not found, or the account has no access to it). Check
> the model in Administration and the provider account. · Meta muse-spark-1.3-contributor:
> Meta Muse Spark is selected for vision work but META_MODEL_API_KEY is not configured in
> Supabase Edge Function secrets.

With only one configured model the message ends "No fallback model is configured for
this purpose in Administration."

OpenAI and Meta Muse Spark vision calls support dual protocols. The first protocol gets the whole hop (`dualProtocolPrimaryTimeoutMs`).
- **Product photos** (Meta and OpenAI) use the Responses API (`/v1/responses`).
  - Meta uses the canonical `input: [{ role: "user", content }]` payload schema to eliminate 400 Bad Request retry delays.
  - Meta includes in-provider sibling candidate retry: if `muse-spark-1.3-contributor` encounters a 404 (model not found / unavailable in that account tier) or a fast `<10s` transient 429/5xx, it retries/switches immediately to `muse-spark-1.2-contributor` (and vice-versa) before declaring provider failure or falling back to OpenAI.
  - When image parts are present, Chat Completions is bypassed on Meta because Chat Completions does not support multimodal images; this prevents corrupting error logs with misleading 404s.
- **OpenAI text probes** try Chat Completions first, then the Responses API. When Chat Completions rejects the model (404 or 400), the error reported is the Responses API's.

## Debugging a failure

- **Administration → AI models → TEST / TEST FALLBACK** sends a tiny JSON ping to that
  exact model. It proves the key and model id work, but not the full image-analysis
  request.
- Every failed hop is written to `ai_runs`:
  - `run_kind` is `product_reference_analysis`, or `catalog_product_preflight` for catalogs;
  - `status = 'failed'`;
  - `provider`, `model`, `attempt_number`;
  - `error_message` reads `"<Provider> <model>: <reason>"`.

  A failed fallback hop is recorded too; before this change a failed second hop was
  silently lost. The chain waits up to `VISION_TELEMETRY_WAIT_MS` (2s) for a failed
  hop's row before starting the next hop, so the row normally exists before the fallback
  runs, and a stalled database costs the fallback at most 2s. Every write is awaited
  before the chain returns.

## Defaults (no saved policy)

| Purpose | Primary | Fallback |
| --- | --- | --- |
| `product_truth` | Meta `muse-spark-1.3-contributor` (`medium`), Z.ai `glm-5.3-flash` (`medium`) if only `ZAI_API_KEY` is set, or OpenAI `gpt-6.1-terra` (`medium`) | Hop 1: Z.ai `glm-5.3-flash` (`medium`, when `ZAI_API_KEY` set) · Hop 2: OpenAI `gpt-6.1-terra` (`medium`) · Hop 3: OpenAI `gpt-5.6-luna` (`low`) · Hop 4: Gemini `gemini-3.8-flash` (`low`) |
| `qa` | Meta `muse-spark-1.3-contributor` (`low`) or Z.ai `glm-5.3-flash` (`low`) or OpenAI `gpt-5.6-luna` | Z.ai `glm-5.3-flash` (`low`) / OpenAI `gpt-5.6-luna` / `gpt-6.1-terra` / Gemini `gemini-3.8-flash` |
| `image_generation` | OpenAI `gpt-image-2.6-sunburst` (`none`) | — |

See [MEMORY.md](../MEMORY.md) and [AGENTS.md](../AGENTS.md) for core architectural memory and PR 131 product truth contracts.

Image quality defaults to `medium` (`DEFAULT_IMAGE_QUALITY`); see
[Generation orchestration](GENERATION_ORCHESTRATION.md).

## Image Generation Models: GPT Image 2.5 and GPT Image 2.6

The generation orchestration pipeline supports OpenAI's latest image generation model families:

- **`gpt-image-2.6-sunburst`**: Flagship precision model with deep latent garment memory, multi-region markup spatial guidance, and microscopic textile weave reproduction. Ideal for intricate zardozi, zari brocades, and complex ethnic draping.
- **`gpt-image-2.6-flare`**: Next-generation speed-optimized foundation model offering 50% lower generation latency at identical token rates ($5.00/1M text input, $8.00/1M image input, $30.00/1M output), designed for high-volume automated photoshoot pipelines.
- **`gpt-image-2.6`**: Standard next-generation foundation model.
- **`gpt-image-2.5-flare-2026-09-08`**: Legacy GPT Image 2.5 pinned snapshot offering high throughput when explicitly selected.
- **`gpt-image-2.5-flare`** / **`gpt-image-2.5-sunburst`**: GPT Image 2.5 foundation tiers.

## Job cost estimation

`estimateJobCostUsd` (`supabase/functions/app-api/lib/providerCost.ts`) computes
dynamic job costs for generation jobs enqueued via Studio (`studio.queue`) or catalog
processing (`catalog.process`), replacing the former fixed $0.25 placeholder:
- Primary generation: `posesCount × basePrice(model) × qualityMultiplier`
- Image quality multipliers: low (0.75x), medium (0.9x), high (1.0x)
- Pose QA allowance: `$0.005` per pose when QA is enabled (it also yields the DNA verdict)
- DNA consistency check allowance: `$0.004` per pose when QA is off (`DEFAULT_ESTIMATED_DNA_CHECK_COST_PER_POSE_USD`)
- Product analysis allowance: `$0.03` default amortized per job (or actual analysis cost when available)
- Pose regenerations: computed for the exact number of regenerated poses

## Changing routing code

- Keep `lib/aiModelPolicy.ts` pure (no env, fetch or DB). The edge function resolves the
  saved policy (`resolveVisionPolicy`) and calls `runVisionProviderChain`.
- `tests/ai_model_policy.test.ts` pins this contract, including the exact saved setup
  "Terra primary, Muse Spark 1.3 Contributor fallback". A change that makes that test
  expect a different model is a change to the rule above, and needs the product owner's approval.
