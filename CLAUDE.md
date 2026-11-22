# Youthnic AI Studio — notes for coding agents

Six-pose fashion catalog photoshoots generated from product references.

- **Frontend:** React + Vite (`src/`).
- **Edge Gateway:** Deno Supabase Edge Function `supabase/functions/app-api/`, running on Railway (`functions`).
- **Python Backend:** FastAPI + LangGraph (`PostgresSaver`) (`backend/`), running on Railway (`FastAPI`) with `Valkey` cache. It extracts Product DNA V2 (`/api/v1/dna/*`) and plans Pose 4/6 and expressions (`/api/v1/plan`); generation, QA and correction run only in the Edge worker. Celery, the `celery-worker` service and the Python generation/QA/memory routes were retired in Nov 2026.
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
   Style reference is the authority for backdrop, room architecture, flooring, and lighting, and for the body posture,
   camera angle and framing of Pose 4 when the stored pose plan adopts it (rule 4). Its outfit, face, hair, and objects
   in the hands are quarantined in every frame; jewellery follows `stylingPlan`. Exception: props the product notes ask
   the model to hold or carry (`requestedHandheldProps`, e.g. "holds a coffee glass and a hand bag as in the reference")
   carry over from the style reference in every frame except the Pose 5 and Pose 6 detail crops, never covering the
   garment; other props stay out.
   When the same photo is uploaded as model face and style reference, it is sent once, in the identity slot.
   Never compromise product fidelity or generation quality for style matching.
3. **Natural Human Anatomy (PR 131).** Every generated image must have strictly exactly two arms and two hands.
   Zero third hands, phantom limbs, or floating hands resting on waist/pleats without clear forearm connection.
4. **Pose Planning Directives (PR 131):** the six frames are 1 Full Front, 2 Turning (3/4), 3 Back, 4 Signature
   Reference, 5 Face + Details, 6 Product Highlight. When rules conflict: product accuracy > reference accuracy > pose
   accuracy > image quality > styling.
   - **Pose 3 (Back, mandatory):** the uploaded BACK photo is the only authority for the back: back neck shape,
     closures (lace-up, ties, bow), seams and stitching, print placement and length match it, and no back detail is
     invented (`rearViewChecklist`, the rear evidence veto).
   - **Pose 5 (Face + Details):** a natural model face with a sharp view of the primary uploaded garment's signature
     craftsmanship (kurti butti work, yoke embroidery, neckline craft). Never hijack with secondary accessories like
     dupattas/stoles unless product itself is standalone dupatta.
   - **Pose 6 (Product Highlight, analysis v38+):** a tight, accurate detail close-up of the product's most distinctive
     feature on the worn garment (`productHighlightPlan` in `lib/showcaseFeature.ts`, `showcasePlan.productHighlight`):
     the analysis's pick, or the next distinctive feature recorded in `productIdentity` when the pick is not a detail
     or is Pose 5's subject. The crop follows the feature (back closure: back-detail crop from behind; sleeves:
     forearm/cuff; dupatta: drape detail; print/embroidery: torso), and the Pose 6 reference manifest leads with the
     photo that best shows it (`back` for back details, `fabric_pattern` for print/embroidery, `mannequin` or
     `additional_product` for sleeves). Never a full-body frame, never a reference posture; same model, set and light.
     Analyses before v38 keep their full-body showcase.
   - **Pose 4 reference matching (Signature Reference):** only Pose 4 (`creative`) copies the style-reference person's
     posture, camera angle and framing (`referencePose.cameraAngle`), seat (`seatOrSupport`), hand gesture and gaze,
     dressed in our garment with its front, print and colours exact, and only when `session_data.posePlanning`
     (`lib/posePlanning.ts`) adopts it. It adopts whenever the reference shows a person; the hard guards in
     `referenceAdoptionBlockReason` are only: no person; an explicit sit request when the reference is not seated;
     Farshi + folded posture; saree + reclining. A walking or lifted-foot reference becomes a grounded weight shift.
     Pose 6 never adopts. The guards are mirrored in `backend/agents/pose_plan_agents.py` (parity fixture); the
     LangGraph planner (`POST /api/v1/plan`) decides after them and the local plan applies them when it is unavailable.
     Adoption is always read from the stored plan, never from pose fields the client sends. Poses 1, 2, 3, 5 and 6 stay
     catalog frames (a plan stored before v38 may still carry a Pose 6 adoption, which generation honours). Analyses
     without `posePlanning` (before v36) keep today's pose behaviour: no posture copying, no planned expressions or
     attitude line.
   - **Per-frame expression, gaze and body language (`lib/expressionDirection.ts`):** every face-visible frame has its
     own gaze target, head angle, mouth and one natural gesture (Pose 1 eye contact; Pose 2 past the lens; Pose 4 into
     the set; Pose 5 a quarter turn back to the lens; Pose 6 toward the featured garment), stated once in the
     uncompacted closing tail; this applies to legacy sessions too. The shoot's `expressionPlan` sets only the mood
     (attitude, energy, smile level) and the planner's per-frame `expressions` only the frame's mood (gaze words are
     dropped). Identity locks (`modelIdentity.face`, the face lock, APPROVED POSE 1) carry facial features only, never
     an expression, gaze or head tilt. From analysis v37, Pose 4 also takes the style-reference person's expression,
     gaze and hand gesture (`referencePose.expression|gaze|hands`, scrubbed of posture, stride and held-object words)
     whatever its posture; `referencePose.cameraAngle` applies only to an adopted posture. A Pose 6 close-up may leave
     the face out of frame. Never their face or anything in the hands.
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
   - a Product DNA V2 version a person approved for the job's SKU adds its invariants and prohibited changes to that
     job's prompt, QA and DNA check (`lib/productDnaLock.ts`; workflow approvals and a different kind of product are skipped);
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
| LangGraph, FastAPI & Product DNA V2 extraction | `backend/main.py`, `backend/graph.py`, `backend/agents/`, `backend/services/` |
| Approved Product DNA as a generation lock | `supabase/functions/app-api/lib/productDnaLock.ts` |
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
