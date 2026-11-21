# Reference-led pose & expression planning — implementation spec

Status: implemented (branch `feat/reference-pose-expression-planning`). Agent rules: CLAUDE.md rules 2, 4 and 8,
AGENTS.md prime directives 2 and 4, MEMORY.md §2.1, §2.4, §2.6 and §3. Pipeline: `docs/GENERATION_ORCHESTRATION.md`.

## Owner decisions (2026-11-20)

1. **Pose match scope:** Pose 4 (`creative`) and Pose 6 (`showcase`) copy the STYLE REFERENCE person's
   posture and any unusual signature pose (sitting, leaning, crouching…). Poses 1 (`full_front`),
   2 (`angled`), 3 (`back`) and 5 (`closeup`) stay catalog frames. The reference **outfit, face, hair
   and anything in the hands stay quarantined in every frame** (jewellery follows `stylingPlan`). CLAUDE.md rule 2,
   AGENTS.md and MEMORY.md are amended to match.
2. **DNA consistency check always runs** on every pose before it is accepted (shape, color, material,
   logo, details). Each failed attempt is archived (never deleted) and the pose is retried within the
   existing retry limit; after the last attempt (or a repeat of the previous DNA defect) a frame that failed
   only this check is kept for human review (`requires_human_review`), never discarded. Full pose QA (anatomy, pose, etc.) stays opt-in. When full QA runs, the DNA
   verdict is derived from its scores (no second call). An infrastructure failure of the check never
   blocks delivery (image ships `unverified`, DNA marked unavailable).
3. **LangGraph planning graph** in FastAPI: `analyze_references → recall_outcomes → plan_poses →
   plan_expression → validate_plan` with per-node retry and Postgres checkpoints, exposed as
   `POST /api/v1/plan`. Edge calls it during analysis, reusing the existing vision result (no second
   vision call). Generation and the DNA check stay in the Edge worker.

## Shared contract

`supabase/functions/app-api/lib/posePlanning.ts` (already written) is the contract. Read it first.

- Stored at `catalog_sessions.session_data.posePlanning` (server-side). Seating/adoption gating is
  always derived from this stored object via `slotReferencePlan(session, poseId)` /
  `isReferenceLowPostureSlot(session, poseId)` — never from pose fields the client sends back.
- Only `creative` and `showcase` can have `source: "reference"`. `referenceAdoptionBlockReason` holds
  the hard guards: no person; generic standing; `suitableForProduct` not "yes"; walking posture or
  stride/lifted-foot text; Farshi + low posture; saree + reclining; showcase tight crop; low posture vs
  full-length or movement showcase. The Python planner mirrors them exactly (parity fixture test).
- **Explicit sit request:** a sit request in the product notes takes precedence for Pose 4. Pose 4 then
  adopts a reference posture only when that posture is seated.
- **Legacy = no `posePlanning`.** Analyses from before v36 have no `referencePose`/`expressionPlan`, so
  `normalizeAnalysis` returns no `posePlanning` and they keep today's pose behaviour: no posture copying,
  no planned expressions or attitude line. Their prompts are not byte-identical: shared prompt text (the
  `lib/garmentPoses.ts` pose-grammar lines, the default `CONSISTENCY_RULES`) was reworded for every session.
  Every new analysis has a plan: expression planning (R4) applies to all six frames; posture adoption only
  to adopted Pose 4/6.
- `expressions[poseId]` is planner-owned expression text (the LangGraph planner returns all six on every
  successful plan, adopted or not; the local fallback (planner unavailable) returns none) → empty falls back to
  `pose.expression`. The planner's Pose 5 (`closeup`) expression follows the close-up mode: the
  face-out-of-crop line only for `product_detail`.
  `expressionAttitudeLine(plan)` is the one-line attitude summary used in prompts.
- Jewellery is not quarantined: it follows `stylingPlan` (existing behaviour, taste read from the style
  reference). Outfit, face, hair and handheld objects are.

### Analysis JSON additions (vision model output, top level)

```json
"referencePose": {
  "posture": "standing|seated|leaning|kneeling|crouching|reclining|walking|other|none",
  "description": "body position only (torso, legs, arms, head) — no clothing, face, jewellery, props",
  "seatOrSupport": "what the body rests on, or ''",
  "distinctiveness": "generic|signature",
  "signatureDescription": "what makes it unusual, '' if generic",
  "attitude": "the reference person's attitude as a style cue",
  "suitableForProduct": "yes|no",
  "suitabilityReason": "short reason"
},
"expressionPlan": {
  "attitude": "...", "energy": "serene|calm|warm|playful|confident|dramatic",
  "gaze": "...", "smile": "none|soft|warm|open",
  "rationale": "why this suits both the style reference and the product"
}
```

### FastAPI `POST /api/v1/plan`

Auth: `verify_internal_secret` (same as other `/api/v1/*`). Request = `posePlanningGraphPayload(...)`:

```json
{ "organization_id": "...", "thread_key": "<analysis fingerprint>",
  "pose_family": "long_kurti", "bottom_cut_class": "farshi|none|...",
  "garment_family": "...", "category": "...",
  "showcase_feature_region": "...", "showcase_shot_type": "...",
  "reference_pose": { ...ReferencePose (camelCase keys) },
  "expression_plan": { ...ExpressionPlan },
  "pose_expressions": { "full_front": "...", ... },
  "local_plan": { "slots": { ... } } }
```

Response:

```json
{ "slots": { "creative": {"source","posture","directive","rationale"}, "showcase": {...} },
  "expressions": { "full_front": "...", "angled": "...", "back": "...", "creative": "...", "closeup": "...", "showcase": "..." },
  "plan_key": "pose_family|bottom_cut_class",
  "thread_id": "thread_plan_<org>_<thread_key>",
  "learned_signals": [ {"slot": "creative", "outcome_key": "...", "effect": "boost|penalty|none"} ],
  "validation": { "attempts": 1, "errors": [] },
  "steps": ["analyze_references", "recall_outcomes", "plan_poses", "plan_expression", "validate_plan"] }
```

### Learning table `pose_plan_outcomes` (migration `20261120180000_pose_plan_outcomes.sql`, already written)

Row per `(organization_id, outcome_key)`, `outcome_key = posePlanOutcomeKey(...)` =
`pose_family|bottom_cut_class|slot|source|posture|distinctiveness`. Counters: `use_count`,
`dna_pass_count`, `dna_fail_count`, `dna_score_avg`, `human_approved_count`, `human_rejected_count`,
`best_plan` (`{directive, expression, dnaScore, sessionId}`). Edge writes it (finalizeJob + human
review, compare-and-set like `showcase_feature_outcomes`); the LangGraph `recall_outcomes` node reads it.

Signals (planner):
- **penalty**: `use_count >= 3` and (`dna_fail_count / use_count >= 0.5` or (`human_rejected_count >= 2`
  and `human_rejected_count > human_approved_count`)).
- **boost**: `use_count >= 3` and `dna_pass_count / use_count >= 0.8` and `dna_score_avg >= 90` and
  `human_rejected_count <= human_approved_count`.

`generation_learnings` gains `pose_planning jsonb` and `pose_scores jsonb` (per pose: DNA scores,
QA score, prompt hash, output path, attempt).

### Token reduction

Style-reference profile cache: `analysis_cache` row with `cache_kind = 'style_reference_profile'`
(org-scoped), keyed by a collision-resistant hash of the style reference content hashes (plus any
scene/model direction) and `ANALYSIS_VERSION`. On a hit, the analysis call omits the style reference
image(s) and receives the cached profile as text: only the creativeDirection room, light, camera and
mood fields (not framing, composition or props), referencePose and styling taste. Skipped when the style reference doubles as model identity
(`hasCollapsedModelIdentity`) or on `forceRefresh`.

## Work split

- **A — Edge planning:** `lib/profiles.ts`, `lib/garmentPoses.ts`, `lib/showcaseFeature.ts` (only if
  needed), `lib/posePlanning.ts` (may extend; keep existing exports stable), tests
  `tests/pose_planning.test.ts` (new) + updates to profile/garment/showcase tests.
- **B — Edge prompt, QA, DNA check, cost:** `lib/generationPrompt.ts`, `lib/referencePolicy.ts`,
  `lib/qa.ts`, `lib/generationMemory.ts`, `lib/providerCost.ts`, tests
  `tests/reference_pose_prompt.test.ts`, `tests/dna_consistency.test.ts` (new) + updates.
- **D — FastAPI LangGraph planner:** `backend/`.
- **C — Edge wiring (after A/B/D):** `index.ts`, `catalogProduction.ts`, `lib/posePlanOutcomes.ts`.
- **F — UI + docs (after A/B/D):** `src/`, docs, CLAUDE.md, AGENTS.md, MEMORY.md, `youthnic-ai-studio-docs/`.

## UI surfaces

All new fields are optional, so stored sessions keep rendering.

- `src/features/studio/types.ts`: `StudioPose.referencePosture?` / `attitude?`, `StudioAnalysis.posePlanning?`
  (`PosePlanningProfile`).
- Studio pose plan (`PosePlan.tsx`): "Matches reference · <posture>" badge on an adopted Pose 4/6, planned attitude
  under Expression. Analysis profile (`AnalysisProfile.tsx`): style reference posture, Pose 4/6 decision and
  expression plan; the explicit seated request stays as "Seated pose 4 (requested in notes)".
- Generation flow board: the style card reads "Room only, no outfit", or "Room + Pose 4/6 posture, no outfit" when
  the stored `posePlanning` adopts a slot (`FlowReference.postureFor`).
- History pose viewer: "Product consistency check" (Passed / Failed / Unavailable + the five scores) from the
  pose's `qa_payload.dna`, or `planning_assets.metadata.qa.dna` for asset-only poses.
