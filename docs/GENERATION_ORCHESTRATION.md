# Generation orchestration

How a six-pose shoot moves from references to delivered images, how **LangGraph + FastAPI + Postgres** manage Product DNA V2 & durable workflow state, and where every image version is kept.

## The pipeline

The studio pairs an Edge Gateway queue (`supabase/functions/app-api`) with a multi-agent **LangGraph** service (`backend/`, deployed on Railway as `FastAPI` + `celery-worker` + `Valkey`):

1. **Analyse & Product DNA V2** (`studio.analyze` / `/api/v1/dna/extract`). Runs Meta Muse Spark (`high` thinking) with OpenAI `gpt-6.1-terra` (`high` thinking) fallback to extract immutable evidence-linked Product DNA V2 (`dna_versions`), shared Creative Direction (the set), Model Identity, and a tailored six-pose plan (isolating Farshi 4-inch upper-hem taper strictly to Farshi SKUs, Gen-Z saree draping, and top-only vs. multi-piece kurti sets). Results are SHA-256 fingerprinted and cached in Postgres & Valkey.
2. **Queue.** `generation_jobs` gets one row and `session_generations` gets one row per pose; asynchronous agent tasks can dispatch through Celery + Valkey (`celery-worker`).
3. **Generate, one pose per worker call.** `claim_next_generation_job` leases the job. The worker builds each pose prompt with `gpt-image-2.6-sunburst` (default 3:4 at 2K, `medium` quality), runs optional Computer Vision QA, and either commits the image or schedules a retry with `available_at` backoff.
4. **Deliver.** The image is uploaded under a unique Firebase Storage path and appended to `planning_assets`.

Each worker call does at most one paid image request. A crash, a deploy, or a Railway sleep loses nothing: `generation_jobs` plus LangGraph `AsyncPostgresSaver` checkpoints resume cleanly from Postgres.

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

The agentic workflow runs in `backend/graph.py` on **FastAPI** (Railway `FastAPI` service, configured with scale-to-zero `sleepApplication: true` for zero idle cost) with **`AsyncPostgresSaver`** checkpointing and **`Valkey`** caching/Celery task execution:

- **Supervisor / Evidence / Product DNA Agents (`agents/supervisor.py`, `agents/evidence_agent.py`, `agents/dna_agent.py`, `models/dna_v2.py`):** Verify reference roles, quarantine style-reference outfits, enforce strict bottom-wear invariants across DNA, QA, and correction (`agents/dna_agent.py`, `agents/qa_agent.py`, `agents/correction_agent.py`), and persist immutable `dna_versions` keyed by source SHA-256 hashes.
- **Knowledge & Pose Planning Agents (`agents/memory_agent.py`, `agents/pose_planning_agent.py`):** Apply historical approvals/corrections and build category-aware 6-pose shoots (Pose 5 primary craftsmanship detail; Pose 6 non-duplicate showcase) using Meta Muse Spark `high` -> `gpt-6.1-terra:high`.
- **CV QA & Correction Agents (`agents/qa_agent.py`, `agents/correction_agent.py`):** Detect anatomical duplication (must remain 2 arms, 2 hands), Farshi hem fidelity, and background continuity before final approval.

See `AGENTS.md` and `MEMORY.md` for mandatory `/ponytail` and `/graphify` engineering workflows when modifying the orchestrator.

## Which models run

The vision models for analysis (`muse-spark-1.2-contributor:high` -> `gpt-6.1-terra:high`) and QA, and the image model (`gpt-image-2.6-sunburst` default), come from Administration → AI models, exactly as saved. See [AI model routing](AI_MODEL_ROUTING.md).

## Defaults

- Image model: `gpt-image-2.6-sunburst` (`DEFAULT_IMAGE_MODEL`, 3:4 at 2K / `1536x2048`).
- Image quality: `medium` (`DEFAULT_IMAGE_QUALITY` in `index.ts`, Studio, and ad-hoc catalog batches). Choose `high` in Studio when a shoot needs it.
- Automatic QA: off unless enabled for the job, or ticked when regenerating a pose. A frame delivered without QA is labelled "Not QA-checked · QA off", not "QA unavailable".
