# Youthnic AI Studio — notes for coding agents

Six-pose fashion catalog photoshoots generated from product references.

- **Frontend:** React + Vite (`src/`).
- **Backend:** Deno Supabase Edge Function `supabase/functions/app-api/`, running on Railway.
- **Database:** Postgres migrations in `supabase/migrations/`.
- **Auth:** Firebase.

## Non-negotiable rules

1. **AI models come from Administration, not from code.** The primary and fallback
   saved in Administration → AI models (`organization_ai_model_policies`) are the
   models that run, in that order. Never hardcode, insert, substitute, reroute, or
   silently drop a model, and never write to `organization_ai_model_policies` from
   code paths other than the Admin save. The only adjustment allowed is reasoning
   effort: product analysis runs at low (or the model's lowest supported level;
   explicit none/minimal is preserved; Qwen runs with thinking off) to fit the
   180s Studio wait, and Gemini Flash QA runs at low. Full contract: [docs/AI_MODEL_ROUTING.md](docs/AI_MODEL_ROUTING.md).
2. **Product references are the truth.** Generated images, style references and
   learning rules never override the uploaded front/back/fabric product images.
3. **One set per shoot.** Every pose prompt carries the same SCENE LOCK
   (`lib/sceneLock.ts`); only pose, camera angle and framing change between frames.
4. **Never delete paid output.** Each delivered image is an immutable
   `planning_assets` row with a unique storage path; regenerations add versions
   (`src/lib/poseVersions.ts`).
5. **Real estimated job costs.** `generation_jobs.estimated_cost_usd` is computed
   dynamically via `lib/providerCost.ts` based on pose count, image model rates,
   quality, pose QA, and analysis cost (never hardcoded to $0.25).
6. **Defaults:**
   - image quality `medium` (`DEFAULT_IMAGE_QUALITY`);
   - pose QA off unless the job or a regeneration asks for it;
   - aspect ratio 3:4 at 2K.
7. **Multimodal provider protocols:**
   - **Meta Muse Spark:** Implements dual-endpoint routing per [Meta Model API docs](https://dev.meta.ai/docs/overview#muse-spark). The native Responses API (`https://api.meta.ai/v1/responses`) is used for multimodal image understanding and structured JSON (`text: { format: { type: "json_object" } }`), falling back to Chat Completions (`/v1/chat/completions`) if an endpoint returns 404/400. Server secret: `META_MODEL_API_KEY`. Supported reasoning levels: `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` (`muse-spark-1.3` standard only). Never pass `none` (Meta rejects with 400).
   - **OpenAI:** Tries Chat Completions first, falling back to Responses API (`/v1/responses`) on 404/400. Server secret: `OPENAI_API_KEY`.

## Where things live

| Topic | File |
| --- | --- |
| Model allow-list, routing chain, failure classification | `supabase/functions/app-api/lib/aiModelPolicy.ts` |
| Policy resolution, provider calls, generation worker | `supabase/functions/app-api/index.ts` |
| Image prompt | `supabase/functions/app-api/lib/generationPrompt.ts`, `lib/sceneLock.ts` |
| Analysis prompt, pose plan | `supabase/functions/app-api/lib/profiles.ts` |
| QA | `supabase/functions/app-api/lib/qa.ts` |
| History data layer | `src/lib/backend.ts` |
| Pipeline, version history, LangGraph decision | `docs/GENERATION_ORCHESTRATION.md` |
| In-app user docs (source of `src/features/docs/docsData.ts`) | `youthnic-ai-studio-docs/` |

## Checks before pushing

- `npm run lint`
- `npx tsc -b`
- `npm run build` (also regenerates the in-app docs data)
- The Deno suites listed in `package.json` → `test:catalog-workflow`. CI runs the same
  list from `.github/workflows/deploy-cloud-run.yml`, and the two lists must stay identical.
- New test files must be added to **both** lists.
- `deno check --frozen supabase/functions/app-api/index.ts` runs in CI.

## Pull requests

- CodeAnt AI reviews every PR. Treat its findings as bug reports: verify each one, fix it
  or reply with why not, and resolve the thread.
- Merge by squash. A merge to `main` deploys migrations to Railway and the web app to Cloud Run.
- The "Verify database types sync" CI step compares the schema, not the formatting.
  If it fails, it prints the declarations that differ; update `src/database.types.ts` to match.
