# Generation orchestration

How a six-pose shoot moves from references to delivered images, how **LangGraph + FastAPI + Postgres** manage Product DNA V2 & durable workflow state, and where every image version is kept.

## The pipeline

The studio pairs an Edge Gateway queue (`supabase/functions/app-api`) with a multi-agent **LangGraph** service (`backend/`, deployed on Railway as `FastAPI` + `celery-worker` + `Valkey`):

1. **Analyse & Product DNA V2** (`studio.analyze` / `/api/v1/dna/extract`). One `product_truth` vision call (Meta Muse Spark `muse-spark-1.3-contributor`, `medium` thinking, then the configured fallbacks) extracts immutable evidence-linked Product DNA V2 (`dna_versions`), shared Creative Direction (the set), Model Identity, the six-pose plan, and, from analysis v36, the style reference person's `referencePose` and a shoot-wide `expressionPlan` (Farshi 4-inch upper-hem taper stays isolated to Farshi SKUs). Results are SHA-256 fingerprinted and cached in Postgres & Valkey. When the style reference was analysed before, its cached text profile (`analysis_cache`, `cache_kind = 'style_reference_profile'`) replaces the style image in this call.
2. **Plan Pose 4/6 and expressions** (`POST /api/v1/plan`, LangGraph). Edge sends the analysis result it already has (`posePlanningGraphPayload`); the graph `analyze_references → recall_outcomes → plan_poses → plan_expression → validate_plan` makes no model call. It applies the hard guards (`referenceAdoptionBlockReason`), reads the organization's `pose_plan_outcomes`, decides whether Pose 4 (`creative`) and Pose 6 (`showcase`) copy the reference posture, and writes per-pose expressions. Edge merges the response with `mergeGraphPosePlanning` (guards re-applied) or, if the planner is unavailable, uses the deterministic `localPosePlanningDecision`.
3. **Store the plan.** The result is saved once at `catalog_sessions.session_data.posePlanning`. Prompts, QA role labels and seating read this stored object (`slotReferencePlan`, `isReferenceLowPostureSlot`), never pose fields sent back by the client. A session with no `posePlanning` (analysed before v36) is legacy and keeps today's pose behaviour: no posture copying, no planned expressions or attitude line.
4. **Queue.** `generation_jobs` gets one row and `session_generations` gets one row per pose; asynchronous agent tasks can dispatch through Celery + Valkey (`celery-worker`).
5. **Compose the prompt and generate, one pose per worker call.** `claim_next_generation_job` leases the job. The worker builds each pose prompt (`lib/generationPrompt.ts`: SCENE LOCK, the REFERENCE POSE MATCH block for an adopted Pose 4/6, the planned expression and attitude line) and calls `gpt-image-2.6-sunburst` (default 3:4 at 2K, `medium` quality).
6. **DNA gate (+ opt-in QA).** Every image is checked for product DNA consistency (shape, color, material, logo, details; `lib/qa.ts`, purpose `qa`, low reasoning). Each failed attempt is archived as a rejected attempt (never deleted) and the pose is retried with `dnaCorrectionText` within the existing retry limit, using `available_at` backoff. After the last attempt (or a repeat of the previous DNA defect), a frame that failed only this check is kept for human review (`requires_human_review`), never discarded. When full pose QA is on for the job or regeneration, the DNA verdict is derived from its scores instead of a second call. A check outage never blocks delivery: the image ships `unverified` and DNA is marked unavailable.
7. **Deliver.** The image is uploaded under a unique Firebase Storage path and appended to `planning_assets`.
8. **Finalize learning.** On finalize and on human review, Edge updates `pose_plan_outcomes` (compare-and-set, `lib/posePlanOutcomes.ts`) with the slot decision, DNA pass/fail and score, and approvals/rejections, and `generation_learnings` records `pose_planning` and per-pose `pose_scores`. Later plans read these counters in `recall_outcomes`.

Each worker call does at most one paid image request. A crash, a deploy, or a Railway sleep leaves the job in `generation_jobs`. When its lease expires, `recover_stale_generation_jobs` clears the lock and `claim_next_generation_job` claims the job again (while LangGraph DNA & pose-planning threads persist checkpoints to Postgres via `PostgresSaver`).

## Keeping every frame on the same set

- `lib/sceneLock.ts` builds one SCENE LOCK block from the analysed creative direction. Every
  pose gets the same block, high in the prompt where compaction never trims it. Only the pose,
  camera angle and framing differ between frames.
- Pose 1 is the visual anchor for poses 2–6, including the back view. The back view never
  receives the style reference, because that is a product-truth risk. The prompt therefore
  points it at the set Pose 1 shows, not at "a clean studio".
- The analysis describes the set once, in `creativeDirection`, not inside each pose prompt. Any
  scene wording that is left in a pose prompt is marked as subordinate to the lock.
- Studio's "Auto from references" background keeps the analysed set. Only an explicit choice,
  such as Studio grey or Studio white, replaces it.
- When QA is on and Pose 1 is attached, `styling_continuity` fails a frame shot on a different
  wall, floor or light, and the worker retries it.

## Regeneration history and timing

A regeneration never overwrites or deletes an image. Every delivery appends a
`planning_assets` row whose `metadata` records:

- `generationEpoch` and `attempt`: the regeneration round, and the try within that round that
  QA accepted.
- `timing`: `requestedAt`, `startedAt`, `completedAt`, plus `queueMs`, `activeMs`, `totalMs`
  and `generationMs` (the image model call alone, measured before QA).
- `regenerationInstructions`, `quality`, `qaEnabled`, token usage, and `actualCostUsd`.

`src/lib/poseVersions.ts` turns those rows into each pose's version list. History uses it to
show:

- `vN of M · regenerated K×` on each card;
- a job-level regeneration count, with average and total request-to-delivery time and cost;
- a version history in the pose viewer, where every earlier image can be viewed and downloaded.

Images archived before timing was recorded get their wait time from `regeneration_history`.
Image and QA `ai_runs` rows now carry `generation_epoch`, `attempt_number` and `generation_id`.

## LangGraph Multi-Agent Architecture (`backend/`)

The agentic workflow runs in `backend/graph.py` on **FastAPI** (Railway `FastAPI` service, configured with scale-to-zero `sleepApplication: true` for zero idle cost) with **`PostgresSaver`** checkpointing and **`Valkey`** caching/Celery task execution:

- **Supervisor / Evidence / Product DNA Agents (`agents/supervisor.py`, `agents/evidence_agent.py`, `agents/dna_agent.py`, `models/dna_v2.py`):** Verify reference roles, quarantine style-reference outfits, enforce strict bottom-wear invariants across DNA, QA, and correction (`agents/dna_agent.py`, `agents/qa_agent.py`, `agents/correction_agent.py`), and persist immutable `dna_versions` keyed by source SHA-256 hashes.
- **Knowledge & Pose Planning Agents (`agents/memory_agent.py`, `agents/pose_planning_agent.py`):** Apply historical approvals/corrections and build category-aware 6-pose shoots (Pose 5 primary craftsmanship detail; Pose 6 non-duplicate showcase) from Product DNA with prompt templates. The pose planner makes no model call; the six-pose plan text the Edge worker uses is written by the `product_truth` analysis call.
- **Reference-Led Pose & Expression Planning Graph (`build_planning_graph`, `run_pose_planning`, `agents/pose_plan_agents.py`, `routes/planning.py`):** Serves `POST /api/v1/plan` (step 2 above). Nodes run with `RetryPolicy(max_attempts=3)`; `validate_plan` re-plans with failing slots forced product-led until `MAX_PLAN_ATTEMPTS`, then keeps both slots product-led. Checkpoints go to Postgres under thread `thread_plan_<org>_<thread_key>` (thread key = analysis fingerprint). A failed outcome recall plans without learned signals. No model call.
- **CV QA & Correction Agents (`agents/qa_agent.py`, `agents/correction_agent.py`):** Detect anatomical duplication (must remain 2 arms, 2 hands), Farshi hem fidelity, and background continuity before final approval.

See `AGENTS.md` and `MEMORY.md` for mandatory `/ponytail` and `/graphify` engineering workflows when modifying the orchestrator.

## Which models run

The vision models for analysis (`muse-spark-1.3-contributor:medium` -> `gpt-6.1-terra:medium`) and QA (pose QA and the DNA consistency check), and the image model (`gpt-image-2.6-sunburst` default), come from Administration → AI models, exactly as saved. The pose planning graph uses no model. See [AI model routing](AI_MODEL_ROUTING.md).

## Defaults

- Image model: `gpt-image-2.6-sunburst` (`DEFAULT_IMAGE_MODEL`, 3:4 at 2K / `1536x2048`).
- Image quality: `medium` (`DEFAULT_IMAGE_QUALITY` in `index.ts`, Studio, and ad-hoc catalog batches). Choose `high` in Studio when a shoot needs it.
- Product DNA consistency check: always on for every pose (step 6). Its verdict is stored on the pose's QA payload (`qa.dna`) and shown in History as "Product consistency check".
- Automatic QA: off unless enabled for the job, or ticked when regenerating a pose. A frame delivered without QA is labelled "Not QA-checked · QA off", not "QA unavailable".
