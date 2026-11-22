# Generation orchestration

How a six-pose shoot moves from references to delivered images, how **LangGraph + FastAPI + Postgres** manage Product DNA V2 and the pose plan, and where every image version is kept.

## The pipeline

The studio pairs an Edge Gateway queue (`supabase/functions/app-api`) with a **LangGraph** service (`backend/`, deployed on Railway as `FastAPI` + `Valkey`). The Edge worker does all generation, QA and correction; FastAPI extracts Product DNA V2 and plans Pose 4/6 and expressions:

1. **Analyse & Product DNA V2** (`studio.analyze` / `/api/v1/dna/extract`). One `product_truth` vision call (Meta Muse Spark `muse-spark-1.3-contributor`, `medium` thinking, then the configured fallbacks) extracts immutable evidence-linked Product DNA V2 (`dna_versions`), shared Creative Direction (the set), Model Identity, the six-pose plan, and, from analysis v36, the style reference person's `referencePose` and a shoot-wide `expressionPlan` (Farshi 4-inch upper-hem taper stays isolated to Farshi SKUs). Results are SHA-256 fingerprinted and cached in Postgres & Valkey. When the style reference was analysed before, its cached text profile (`analysis_cache`, `cache_kind = 'style_reference_profile'`) replaces the style image in this call.
2. **Plan Pose 4/6 and expressions** (`POST /api/v1/plan`, LangGraph). Edge sends the analysis result it already has (`posePlanningGraphPayload`); the graph `analyze_references → recall_outcomes → plan_poses → plan_expression → validate_plan` makes no model call. It applies the hard guards (`referenceAdoptionBlockReason`), reads the organization's `pose_plan_outcomes`, decides whether Pose 4 (`creative`) copies the reference posture, and writes per-pose expressions. Edge merges the response with `mergeGraphPosePlanning` (guards re-applied) or, if the planner is unavailable, uses the deterministic `localPosePlanningDecision`. From analysis v38 (`generation-session-v38-signature-reference-product-highlight`) the six slots are Full Front, Turning, Back, Signature Reference, Face + Details and Product Highlight:
   - **Pose 4 (Signature Reference)** adopts the reference person's posture, camera angle and framing, seat, hand gesture and gaze whenever the reference shows a person. Only four guards remain: no person; a sit request in the notes when the reference is not seated; Farshi + folded posture; saree + reclining. The analysis's `suitableForProduct` verdict and a generic stance no longer block it, and a walking or lifted-foot reference is grounded as a weight shift (stored slot posture `standing`).
   - **Pose 6 (Product Highlight)** never adopts. `normalizeAnalysis` resolves `creativeDirection.showcasePlan` with `productHighlightPlan` (`lib/showcaseFeature.ts`): the analysis's feature, moved to `back_detail` when it sits on the back, or the next distinctive feature in `productIdentity` (back closure, sleeves, dupatta, hem, bottom wear, embroidery, print, fabric) when the pick is vague or is Pose 5's subject. The plan is stored with `productHighlight: true`, a `macro_detail` or `half_body_detail` shot and the evidence role that best shows the feature, which becomes the pose's `primaryReference` and so leads the Pose 6 manifest (`selectReferences`). The prompt carries `PRODUCT HIGHLIGHT` framing per region (`productHighlightFrame`), a back detail answers to the BACK image only, the face and requested props may stay out of the crop, and QA fails a full-body frame or a Pose 5 repeat.
   - Plans stored before v38 keep their Pose 4/6 decisions and full-body showcase at generation; re-analyse (Clone Session, then Studio "Re-analyze Ground Truth") to get the new slots.
3. **Store the plan.** The result is saved once at `catalog_sessions.session_data.posePlanning`. Prompts, QA role labels and seating read this stored object (`slotReferencePlan`, `isReferenceLowPostureSlot`), never pose fields sent back by the client. A session with no `posePlanning` (analysed before v36) is legacy and keeps today's pose behaviour: no posture copying, no planned expressions or attitude line.
4. **Queue.** `generation_jobs` gets one row and `session_generations` gets one row per pose. The Edge worker claims them (step 5); there is no separate task queue.
5. **Compose the prompt and generate, one pose per worker call.** When a person approved a Product DNA V2 version of the job's SKU (Studio "Approve DNA"; `approved_by` holds their email), its invariants and prohibited changes join this attempt's product truth for the prompt, QA and the DNA check (`lib/productDnaLock.ts`, recorded as `appliedProductDna` on the pose data). It is skipped whole when it describes a different kind of product (saree vs not, Farshi vs not), and entries the analysis already has are not repeated. `claim_next_generation_job` leases the job. The worker builds each pose prompt (`lib/generationPrompt.ts`: SCENE LOCK, the REFERENCE POSE MATCH block for an adopted Pose 4/6, the planned expression and attitude line) and calls `gpt-image-2.6-sunburst` (default 3:4 at 2K, `medium` quality).
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

## LangGraph service (`backend/`)

`backend/graph.py` runs on **FastAPI** (Railway `FastAPI` service, scale-to-zero `sleepApplication: true`) with **`PostgresSaver`** checkpointing and **`Valkey`** as the hot Product DNA and reference-manifest cache. It has two graphs, neither of which generates or judges images:

- **Product DNA V2 graph (`build_studio_graph`, `routes/dna.py`):** `inspect_evidence → extract_dna` (`agents/evidence_agent.py`, `agents/dna_agent.py`, `models/dna_v2.py`). Verifies reference roles, quarantines style-reference outfits, and persists immutable `product_dna_versions` keyed by source SHA-256 hashes. With `seed_analysis` from `studio.analyze` it makes no second vision call. Checkpoints go to thread `thread_dna_<org>_<sku>`. A person-approved version feeds generation through `lib/productDnaLock.ts` (step 5).
- **Reference-Led Pose & Expression Planning Graph (`build_planning_graph`, `run_pose_planning`, `agents/pose_plan_agents.py`, `routes/planning.py`):** Serves `POST /api/v1/plan` (step 2 above). Nodes run with `RetryPolicy(max_attempts=3)`; `validate_plan` re-plans with failing slots forced product-led until `MAX_PLAN_ATTEMPTS`, then keeps both slots product-led. Checkpoints go to Postgres under thread `thread_plan_<org>_<thread_key>` (thread key = analysis fingerprint). A failed outcome recall plans without learned signals. No model call.

Retired in Nov 2026 (never reached by production traffic): the Celery worker and `celery-worker` service, the `/api/v1/generation/*`, `/api/v1/qa/*` and `/api/v1/memory/*` routes, and the studio-graph nodes `retrieve_memory`, `plan_poses`, `route_generation`, `evaluate_qa`, `apply_correction` and `record_learning`. Their jobs belong to the Edge worker (QA and the DNA gate in `lib/qa.ts`; learning in `lib/posePlanOutcomes.ts`, `learning_outcomes` and `fashion_knowledge_base` reads in `compilePosePrompt`). The pgvector `knowledge_embeddings` table had no rows and no reader; the per-extract embeddings call that searched it is gone.

See `AGENTS.md` and `MEMORY.md` for mandatory `/ponytail` and `/graphify` engineering workflows when modifying the orchestrator.

## Which models run

The vision models for analysis (`muse-spark-1.3-contributor:medium` -> `gpt-6.1-terra:medium`) and QA (pose QA and the DNA consistency check), and the image model (`gpt-image-2.6-sunburst` default), come from Administration → AI models, exactly as saved. The pose planning graph uses no model. See [AI model routing](AI_MODEL_ROUTING.md).

## Defaults

- Image model: `gpt-image-2.6-sunburst` (`DEFAULT_IMAGE_MODEL`, 3:4 at 2K / `1536x2048`).
- Image quality: `medium` (`DEFAULT_IMAGE_QUALITY` in `index.ts`, Studio, and ad-hoc catalog batches). Choose `high` in Studio when a shoot needs it.
- Product DNA consistency check: always on for every pose (step 6). Its verdict is stored on the pose's QA payload (`qa.dna`) and shown in History as "Product consistency check".
- Automatic QA: off unless enabled for the job, or ticked when regenerating a pose. A frame delivered without QA is labelled "Not QA-checked · QA off", not "QA unavailable".
