# Youthnic AI Studio — notes for coding agents

Six-pose fashion catalog photoshoots generated from product references.

- **Frontend:** React + Vite (`src/`).
- **Edge Gateway:** Deno Supabase Edge Function `supabase/functions/app-api/`, running on Railway (`functions`).
- **Agentic Workflow Backend:** Python FastAPI + LangGraph (`PostgresSaver`) + Celery (`backend/`), running on Railway (`FastAPI`, `celery-worker`) with `Valkey` cache/broker.
- **Database:** Postgres migrations in `supabase/migrations/`.
- **Auth:** Firebase.
- **Knowledge Graph:** `/graphify` index at `graphify-out/graph.json` and `graphify-out/GRAPH_REPORT.md`.

## Non-negotiable rules

0. **Follow Core Memory & Mandatory Skills (`/ponytail` + `/graphify` + `/understand`):**
   - Read [MEMORY.md](MEMORY.md) section 0 and [AGENTS.md](AGENTS.md) before any exploration or code change.
   - If Graphify, Ponytail, or Understand-Anything is missing, run `powershell -File tools/install-agent-skills.ps1` and stop until it exits 0.
   - **Always use `/ponytail` (`full`)** every time you write or edit code: grep callers first, ship the smallest complete diff, preserve validation & error handling, write concise tests, and disclose any skipped checks or risks.
   - **Use `/graphify` by default** whenever exploring or updating this repo: query `graphify-out/graph.json` first (`graphify query` / `path` / `explain`). If the graph is missing, run `graphify extract . --code-only`. After edits, run `graphify update .`.
   - **Use `/understand`** before architecture or cross-file work. If `.ua/knowledge-graph.json` is missing, follow `.cursor/skills/understand/SKILL.md`. The plugin root is `tools/vendor/understand-anything/understand-anything-plugin`.
1. **AI models follow configured policies.** The primary and fallback
   routes saved in Administration → AI models (`organization_ai_model_policies`), or
   defaulted when unconfigured, determine the execution chain. For product truth and pose
   planning (`product_truth`), the standard chain routes through Meta Muse Spark (`muse-spark-1.3-contributor` / `muse-spark-1.2-contributor` with **`medium` thinking**) as primary,
   **Z.ai GLM 5.3 Flash** (`glm-5.3-flash:medium`, sibling `glm-5.3-flashx`, 50x concurrency) as first fallback when `ZAI_API_KEY` is configured,
   **OpenAI GPT 6.1 Terra** (`gpt-6.1-terra:medium`) next,
   and OpenAI GPT 5.6 Luna (`gpt-5.6-luna`) / Gemini Flash (`gemini-3.8-flash`) as secondary safety nets. Do not add arbitrary unapproved
   models or bypass the established chain. Medium/high reasoning is preserved for Meta Muse Spark, Z.ai GLM 5.3 Flash, GPT 6.1 Terra, and GPT 5.6 Luna during analysis and pose planning (`clampProductTruthThinking`), only clamping to `low` under emergency tight remaining budgets (`< 60s` in Edge `app-api` or FastAPI `invoke_vision_json`), while legacy heavy models (`gpt-5.6-terra`, `gpt-5.6-sol`, `gemini-*`) run at `low` (explicit `none`/`minimal` preserved; Qwen thinking off). Image QA runs at `low`. Full contract: [docs/AI_MODEL_ROUTING.md](docs/AI_MODEL_ROUTING.md).
2. **Product references are the truth (PR 131).** Generated images must take clothing EXCLUSIVELY
   from uploaded product references. The outfit/clothing shown in the STYLE REFERENCE image is 100% DISCARDED and QUARANTINED.
   Style reference is the authority for backdrop, room architecture, flooring, and lighting, and for the body posture of
   Pose 4/6 only when the stored pose plan adopts it (rule 4). Its outfit, face, hair, and objects in the hands are
   quarantined in every frame; jewellery follows `stylingPlan`. Exception: props the product notes ask the model to
   hold or carry (`requestedHandheldProps`, e.g. "holds a coffee glass and a hand bag as in the reference") carry over
   from the style reference in every frame except the Pose 5 crop, never covering the garment; other props stay out.
   When the same photo is uploaded as model face and style reference, it is sent once, in the identity slot.
   Never compromise product fidelity or generation quality for style matching.
3. **Natural Human Anatomy (PR 131).** Every generated image must have strictly exactly two arms and two hands.
   Zero third hands, phantom limbs, or floating hands resting on waist/pleats without clear forearm connection.
4. **Pose Planning Directives (PR 131):**
   - **Pose 5 (Detail Crop):** Must highlight the signature craftsmanship of the primary uploaded garment (kurti butti work, yoke embroidery, neckline craft). Never hijack with secondary accessories like dupattas/stoles unless product itself is standalone dupatta.
   - **Pose 6 (Showcase):** Distinct pose complementing frames 1-5 with 100% consistency across model, product, backdrop, and styling.
   - **Pose 4/6 reference matching:** only Pose 4 (`creative`) and Pose 6 (`showcase`) may copy the style-reference
     person's posture or signature pose, and only when `session_data.posePlanning` (`lib/posePlanning.ts`) adopts it.
     The LangGraph planner (`POST /api/v1/plan`) decides each slot after the hard guards in
     `referenceAdoptionBlockReason` (no person; generic standing; not judged suitable; walking/stride; Farshi + folded
     posture; saree + reclining; tight showcase crop; folded posture vs full-length or movement showcase), mirrored in
     `backend/agents/pose_plan_agents.py`; the local plan applies the same guards when the planner is unavailable.
     An explicit sit request in the product notes takes precedence for Pose 4: Pose 4 then adopts a reference posture
     only when that posture is seated.
     Adoption is always read from the stored plan, never from pose fields the client sends. Poses 1, 2, 3 and 5 stay
     catalog frames. Analyses without `posePlanning` (before v36) keep today's pose behaviour: no posture copying, no
     planned expressions or attitude line.
5. **One set per shoot.** Every pose prompt carries the same SCENE LOCK
   (`lib/sceneLock.ts`); only pose, camera angle and framing change between frames.
6. **Never delete paid output.** Each delivered image is an immutable
   `planning_assets` row with a unique storage path; regenerations add versions
   (`src/lib/poseVersions.ts`).
7. **Real estimated job costs.** `generation_jobs.estimated_cost_usd` is computed
   dynamically via `lib/providerCost.ts` based on pose count, image model rates,
   quality, pose QA or the DNA consistency check, and analysis cost (never hardcoded to $0.25).
8. **Defaults:**
   - image model `gpt-image-2.6-sunburst`;
   - image quality `medium` (`DEFAULT_IMAGE_QUALITY`);
   - product DNA consistency check (shape, color, material, logo, details) always on for every pose: each failed
     attempt is archived (one upload retry; a storage outage is logged) and the pose retried within the existing retry limit; after the last attempt (or a repeat of
     the previous DNA defect) a frame that failed only this check is kept for human review (`requires_human_review`),
     never discarded; a check outage ships the image `unverified`;
   - full pose QA off unless the job or a regeneration asks for it (when on, the DNA verdict comes from its scores);
   - aspect ratio 3:4 at 2K (`1536x2048`).
   - Farshi / Farsi construction rules (4-inch upper-hem taper, waist narrowing, 2-leg spread) apply strictly to `farshi`/`farsi` SKUs only and never bleed onto other bottom silhouettes.
9. **Multimodal provider protocols:**
   - **Meta Muse Spark:** Multimodal vision calls use native Responses API (`https://api.meta.ai/v1/responses`) with canonical `input: [{ role: "user", content }]` schema and in-provider sibling candidate retry (`muse-spark-1.2-contributor` <-> `muse-spark-1.3-contributor`) to guarantee zero-drop reliability. Server secret: `META_MODEL_API_KEY`. Supported reasoning levels: `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` (`muse-spark-1.3` standard only). Never pass `none` (Meta rejects with 400). When image parts are present, Chat Completions is bypassed since it does not support images.
   - **Z.ai GLM 5.3 Flash:** Native multimodal VLM via Chat Completions (`https://api.z.ai/api/paas/v4/chat/completions`, LangChain `ChatOpenAI(base_url="https://api.z.ai/api/paas/v4/")` in FastAPI) with `response_format: { type: "json_object" }`, forced thinking (`thinking: { type: "enabled" }`), `reasoning_effort` (`"low" | "high" | "max"`), `temperature: 1`, `top_p: 0.95`, and sibling failover (`glm-5.3-flash` 50x concurrency <-> `glm-5.3-flashx` 20x concurrency / 200 tok/s). Server secret: `ZAI_API_KEY`.
   - **OpenAI:** Tries Responses API (`/v1/responses`) first when image parts are present, and Chat Completions first for text-only probes (falling back on 404/400). Server secret: `OPENAI_API_KEY`.

## Where things live

| Topic | File |
| --- | --- |
| Model allow-list, routing chain, failure classification | `supabase/functions/app-api/lib/aiModelPolicy.ts` |
| Policy resolution, provider calls, generation worker | `supabase/functions/app-api/index.ts` |
| Image prompt | `supabase/functions/app-api/lib/generationPrompt.ts`, `lib/sceneLock.ts` |
| Analysis prompt, pose plan | `supabase/functions/app-api/lib/profiles.ts` |
| Pose 4/6 reference matching & expression plan contract, hard guards | `supabase/functions/app-api/lib/posePlanning.ts` |
| Pose-plan learning writes (`pose_plan_outcomes`) | `supabase/functions/app-api/lib/posePlanOutcomes.ts`, migration `20261120180000_pose_plan_outcomes.sql` |
| LangGraph pose & expression planner (`POST /api/v1/plan`) | `backend/agents/pose_plan_agents.py`, `backend/routes/planning.py`, `backend/graph.py` (`run_pose_planning`) |
| QA and the always-on DNA consistency check | `supabase/functions/app-api/lib/qa.ts` |
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
