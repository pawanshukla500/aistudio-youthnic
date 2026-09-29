# AI model routing

Which model does which job, who decides, and what happens when a model fails.

## The rule

**The models saved in Administration → AI models are the models that run.** Code never
inserts another model ahead of them, never swaps one for another, never drops one from
the chain, and never rewrites the saved policy. When there is no saved policy, the
defaults below apply.

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
| `qa` | Image QA | Per-pose consistency QA, when QA is on | Yes |
| `qa_escalation` | *(no separate card)* | Independent recheck for complex garments | Uses the `qa` policy unless its own row exists |
| `image_generation` | Image Generation | The final images (OpenAI Images API) | No |

Each row stores `primary_provider`, `primary_model`, `primary_reasoning`,
`fallback_enabled`, `fallback_provider`, `fallback_model` and `fallback_reasoning`.
Only models listed in `AI_MODEL_REGISTRY` (`supabase/functions/app-api/lib/aiModelPolicy.ts`)
can be saved or called.

## Order and fallback

For a vision purpose, the chain is `[primary, fallback]` exactly as saved
(`productTruthRouteChain`). Administration refuses to save a fallback identical to the
primary ("Choose a different fallback provider or model."); an older row that has one
runs that model once.

The chain moves to the fallback when the primary fails for a reason another model can fix:

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
message naming the secret (`OPENAI_API_KEY`, `META_MODEL_API_KEY`, `GEMINI_API_KEY`,
`QWEN_API_KEY`), so the administrator can see why a configured fallback never answered.

## Reasoning effort for product analysis

Product analysis is one large multimodal JSON call that must finish inside Studio's
180s wait. High reasoning on it overran that budget, so `clampProductTruthThinking`
runs product analysis at **low** reasoning (or the provider's lowest supported level),
whatever is saved. Explicit "none" or "minimal" is preserved. Only the effort changes,
never the model. QA keeps its saved reasoning, except that Gemini Flash models run at low.

## Time budget (product analysis)

- Studio's client waits `STUDIO_ANALYZE_TIMEOUT_MS` (180s). The chain budget is 175s,
  holding 5s back for work outside the chain (`VISION_REQUEST_OVERHEAD_MS`).
- While a fallback is still to come, the primary gets the remaining time minus
  `PRODUCT_TRUTH_FALLBACK_RESERVE_MS` (45s) and `VISION_GATEWAY_RESERVE_MS` (5s), giving
  Hop 1 up to 125s. A hanging primary can never starve the fallback.
- A primary that fails fast (a 404 or a missing key) hands the fallback nearly the whole budget.

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

OpenAI vision calls try Chat Completions first, then the Responses API. When Chat
Completions rejects the model (404 or 400), which usually means the model only serves
the Responses API, the error reported is the Responses API's.

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
| `product_truth`, `qa` | OpenAI `gpt-5.6-luna`, or Meta `muse-spark-1.3` when only the Meta key is set | OpenAI `gpt-5.6-terra` |
| `image_generation` | OpenAI `gpt-image-2.5-flare-2026-09-08` | — |

Image quality defaults to `medium` (`DEFAULT_IMAGE_QUALITY`); see
[Generation orchestration](GENERATION_ORCHESTRATION.md).

## Job cost estimation

`estimateJobCostUsd` (`supabase/functions/app-api/lib/providerCost.ts`) computes
dynamic job costs for generation jobs enqueued via Studio (`studio.queue`) or catalog
processing (`catalog.process`), replacing the former fixed $0.25 placeholder:
- Primary generation: `posesCount × basePrice(model, imageQuality)`
- Image quality multipliers: standard (1.0x), medium (1.15x), high (1.35x), ultra (1.65x)
- Pose QA allowance: `$0.005` per pose when QA is enabled
- Product analysis allowance: `$0.01` amortized per job
- Pose regenerations: computed for the exact number of regenerated poses

## Changing routing code

- Keep `lib/aiModelPolicy.ts` pure (no env, fetch or DB). The edge function resolves the
  saved policy (`resolveVisionPolicy`) and calls `runVisionProviderChain`.
- `tests/ai_model_policy.test.ts` pins this contract, including the exact saved setup
  "Terra primary, Muse Spark 1.3 Contributor fallback". A change that makes that test
  expect a different model is a change to the rule above, and needs the product owner's approval.
