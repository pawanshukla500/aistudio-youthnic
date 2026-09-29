# Generation orchestration

How a six-pose shoot moves from references to delivered images, where the
history of every image is kept, and why the pipeline does not use LangGraph.

## The pipeline

The steps are fixed, and each one is a row in Postgres rather than a process in memory:

1. **Analyse** (Gemini Vision, one call). Builds the Product Identity Profile, the shared
   Creative Direction (the set), the Model Identity, and the six-pose plan. The result is
   fingerprinted and cached, so unchanged references are never analysed twice.
2. **Queue.** `generation_jobs` gets one row and `session_generations` gets one row per pose.
3. **Generate, one pose per worker call.** `claim_next_generation_job` leases the job. The worker
   builds that pose's prompt, calls the image model once, runs optional QA, then either commits
   the image or schedules a retry with `available_at` backoff. Cron recovers stale leases.
4. **Deliver.** The image is uploaded under a unique path and a `planning_assets` row is appended.

Each worker call does at most one paid image request. A crash, a deploy, or a Railway sleep
loses nothing: the next call resumes from the database.

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

## Why not LangGraph

[LangGraph](https://github.com/langchain-ai/langgraph) is an open-source library, available for
Python and JavaScript. It runs in-process, and its hosted platform is optional. It would not help
this pipeline:

- **It saves no tokens.** Cost is the image model's input images (about 16–21k tokens per pose)
  and its output image tokens, which quality and size set. A graph framework sends the same
  prompts and images. The savings come from medium quality (now the default), the scene lock
  that makes regenerations less necessary, and the existing analysis cache.
- **It gives no better images.** Output quality comes from the prompt and the reference set, and
  both are already explicit, versioned and tested.
- **Durable execution already exists.** LangGraph needs a checkpointer, such as
  `@langchain/langgraph-checkpoint-postgres`, to survive restarts. The worker already persists
  every step, leases, retry backoff and cron recovery in Postgres, and fits the
  one-paid-call-per-invocation limit.
- **Its runtime cost is real.** It would add `@langchain/core` and its dependency tree to a Deno
  function on Railway, plus a second source of truth for job state beside `generation_jobs`.

Revisit this if the pipeline becomes branching and agentic. Examples: a planner that chooses
among many tools, or several models negotiating a shot. Six fixed poses in sequence is a queue,
not a graph.

## Which models run

The vision models for analysis and QA, and the image model, come from Administration → AI
models, exactly as saved. See [AI model routing](AI_MODEL_ROUTING.md).

## Defaults

- Image quality: `medium` (`DEFAULT_IMAGE_QUALITY` in `index.ts`, Studio, and ad-hoc catalog
  batches). Choose `high` in Studio when a shoot needs it.
- Automatic QA: off unless enabled for the job, or ticked when regenerating a pose. A frame
  delivered without QA is labelled "Not QA-checked · QA off", not "QA unavailable".
