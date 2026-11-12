# Youthnic AI Studio — notes for coding agents

Six-pose fashion catalog photoshoots generated from product references.

- **Frontend:** React + Vite (`src/`).
- **Edge Gateway:** Deno Supabase Edge Function `supabase/functions/app-api/`, running on Railway (`functions`).
- **Agentic Workflow Backend:** Python FastAPI + LangGraph (`AsyncPostgresSaver`) + Celery (`backend/`), running on Railway (`FastAPI`, `celery-worker`) with `Valkey` cache/broker.
- **Database:** Postgres migrations in `supabase/migrations/`.
- **Auth:** Firebase.
- **Knowledge Graph:** `/graphify` index at `graphify-out/graph.json` and `graphify-out/GRAPH_REPORT.md`.

## Non-negotiable rules

0. **Follow Core Memory & Mandatory Skills (`/ponytail` + `/graphify`):**
   - Read [MEMORY.md](MEMORY.md) and [AGENTS.md](AGENTS.md) before making architectural or model changes.
   - **Always use `/ponytail`** every time you write or edit code: grep callers first, ship the smallest complete diff, preserve validation & error handling, write concise tests, and disclose any skipped checks or risks.
   - **Use `/graphify` by default** whenever exploring or updating this repo: query `graphify-out/graph.json` first for cross-file discovery, and run `/graphify . --update` after edits.
1. **AI models follow configured policies.** The primary and fallback
   routes saved in Administration → AI models (`organization_ai_model_policies`), or
   defaulted when unconfigured, determine the execution chain. For product truth and pose
   planning (`product_truth`), the standard chain routes through Meta Muse Spark (`muse-spark-1.2-contributor` / `muse-spark-1.3-contributor` with **`high` thinking**) as primary,
   OpenAI GPT 6.1 Terra (`gpt-6.1-terra` with **`high` thinking**) as first fallback,
   and OpenAI GPT 5.6 Luna (`gpt-5.6-luna`) / Gemini Flash (`gemini-3.8-flash`) as secondary safety nets. Do not add arbitrary unapproved
   models or bypass the established chain. High reasoning is preserved for Meta Muse Spark, GPT 6.1 Terra, and GPT 5.6 Luna during analysis and pose planning (`clampProductTruthThinking`), only clamping to `low` under emergency tight hop budgets (`< 60s`), while legacy heavy models (`gpt-5.6-terra`, `gpt-5.6-sol`, `gemini-*`) run at `low` (explicit `none`/`minimal` preserved; Qwen thinking off). Image QA runs at `low`. Full contract: [docs/AI_MODEL_ROUTING.md](docs/AI_MODEL_ROUTING.md).
2. **Product references are the truth (PR 131).** Generated images must take clothing EXCLUSIVELY
   from uploaded product references. The outfit/clothing shown in the STYLE REFERENCE image is 100% DISCARDED and QUARANTINED.
   Style reference is strictly the authority for backdrop, room architecture, flooring, and lighting. Copy the room only: do not copy the pose, the outfit, or objects in the hands.
   Never compromise product fidelity or generation quality for style matching.
3. **Natural Human Anatomy (PR 131).** Every generated image must have strictly exactly two arms and two hands.
   Zero third hands, phantom limbs, or floating hands resting on waist/pleats without clear forearm connection.
4. **Pose Planning Directives (PR 131):**
   - **Pose 5 (Detail Crop):** Must highlight the signature craftsmanship of the primary uploaded garment (kurti butti work, yoke embroidery, neckline craft). Never hijack with secondary accessories like dupattas/stoles unless product itself is standalone dupatta.
   - **Pose 6 (Showcase):** Distinct pose complementing frames 1-5 with 100% consistency across model, product, backdrop, and styling.
5. **One set per shoot.** Every pose prompt carries the same SCENE LOCK
   (`lib/sceneLock.ts`); only pose, camera angle and framing change between frames.
6. **Never delete paid output.** Each delivered image is an immutable
   `planning_assets` row with a unique storage path; regenerations add versions
   (`src/lib/poseVersions.ts`).
7. **Real estimated job costs.** `generation_jobs.estimated_cost_usd` is computed
   dynamically via `lib/providerCost.ts` based on pose count, image model rates,
   quality, pose QA, and analysis cost (never hardcoded to $0.25).
8. **Defaults:**
   - image model `gpt-image-2.6-sunburst`;
   - image quality `medium` (`DEFAULT_IMAGE_QUALITY`);
   - pose QA off unless the job or a regeneration asks for it;
   - aspect ratio 3:4 at 2K (`1536x2048`).
   - Farshi / Farsi construction rules (4-inch upper-hem taper, waist narrowing, 2-leg spread) apply strictly to `farshi`/`farsi` SKUs only and never bleed onto other bottom silhouettes.
9. **Multimodal provider protocols:**
   - **Meta Muse Spark:** Multimodal vision calls use native Responses API (`https://api.meta.ai/v1/responses`) with canonical `input: [{ role: "user", content }]` schema and in-provider sibling candidate retry (`muse-spark-1.2-contributor` <-> `muse-spark-1.3-contributor`) to guarantee zero-drop reliability. Server secret: `META_MODEL_API_KEY`. Supported reasoning levels: `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` (`muse-spark-1.3` standard only). Never pass `none` (Meta rejects with 400). When image parts are present, Chat Completions is bypassed since it does not support images.
   - **OpenAI:** Tries Responses API (`/v1/responses`) first when image parts are present, and Chat Completions first for text-only probes (falling back on 404/400). Server secret: `OPENAI_API_KEY`.

## Where things live

| Topic | File |
| --- | --- |
| Model allow-list, routing chain, failure classification | `supabase/functions/app-api/lib/aiModelPolicy.ts` |
| Policy resolution, provider calls, generation worker | `supabase/functions/app-api/index.ts` |
| Image prompt | `supabase/functions/app-api/lib/generationPrompt.ts`, `lib/sceneLock.ts` |
| Analysis prompt, pose plan | `supabase/functions/app-api/lib/profiles.ts` |
| QA | `supabase/functions/app-api/lib/qa.ts` |
| History data layer | `src/lib/backend.ts` |
| LangGraph, FastAPI, Product DNA V2 & Celery | `backend/main.py`, `backend/graph.py`, `backend/agents/`, `backend/services/` |
| Pipeline, version history, LangGraph architecture | `docs/GENERATION_ORCHESTRATION.md` |
| Repository Knowledge Graph (`/graphify`) | `graphify-out/graph.json`, `graphify-out/GRAPH_REPORT.md` |
| In-app user docs (source of `src/features/docs/docsData.ts`) | `youthnic-ai-studio-docs/` |

## Checks before pushing

- `npm run lint`
- `npx tsc -b`
- `npm run build` (also regenerates the in-app docs data)
- Python backend checks: `$env:PYTHONPATH="backend"; python -m pytest backend/tests/ -q`
- The Deno suites listed in `package.json` → `test:catalog-workflow`. CI runs the same
  list from `.github/workflows/deploy-cloud-run.yml`, and the two lists must stay identical.
- New test files must be added to **both** lists.
- `deno check --frozen supabase/functions/app-api/index.ts` runs in CI.
- Keep `graphify-out/` updated with `/graphify . --update` after edits.

## Pull requests

- CodeAnt AI reviews every PR. Treat its findings as bug reports: verify each one, fix it
  or reply with why not, and resolve the thread.
- Merge by squash. A merge to `main` deploys migrations to Railway and the web app to Cloud Run.
- The "Verify database types sync" CI step compares the schema, not the formatting.
  If it fails, it prints the declarations that differ; update `src/database.types.ts` to match.
