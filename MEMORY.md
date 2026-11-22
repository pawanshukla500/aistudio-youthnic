# Core Memory — Fashion Studio AI & Youthnic Engine

This file is the **Canonical Core Memory** for the Youthnic AI Fashion Studio codebase. It records foundational architectural decisions, immutable system contracts, model routing policies, and generation quality standards. All AI agents, engineers, and workflows must honor these principles without compromise.

---

## 0. Mandatory Agent Skills (install if missing, then use)

Before any exploration or code change, every AI agent must use these three skills. If any check fails, stop and run `powershell -File tools/install-agent-skills.ps1`. Do not continue until it exits 0. Install only from the three repositories below.

| Skill | Source | Must exist |
| --- | --- | --- |
| Graphify | https://github.com/Graphify-Labs/graphify | `graphify` on PATH, `.cursor/rules/graphify.mdc`, `.agents/skills/graphify/SKILL.md`, `.cursor/skills/graphify/SKILL.md` |
| Ponytail | https://github.com/dietrichgebert/ponytail | `.cursor/skills/ponytail/SKILL.md`, `.cursor/hooks.json` containing `ponytail-activate.js`, checkout `tools/vendor/ponytail` |
| Understand-Anything | https://github.com/Egonex-AI/Understand-Anything | `.cursor/skills/understand/SKILL.md`, built plugin `tools/vendor/understand-anything/understand-anything-plugin/packages/core/dist/index.js` |

1. **`/ponytail` at `full`.** Read `.cursor/skills/ponytail/SKILL.md` and follow it on every code change: callers first, smallest complete change, keep validation and error handling, one small test for non-trivial logic, and say what was not checked.
2. **`/graphify` before broad codebase search.** If `graphify-out/graph.json` is missing, build it with `graphify extract . --code-only` (local AST, no API key). Prefer `graphify query`, `graphify path`, and `graphify explain`. After code edits, run `graphify update .`.
3. **`/understand` before architecture or cross-file work.** If `.ua/knowledge-graph.json` is missing, follow `.cursor/skills/understand/SKILL.md` and build it. The plugin root is `tools/vendor/understand-anything/understand-anything-plugin`. Use `/understand-explain` for a file or symbol and `/understand-diff` for change impact.

Skill folders under `.cursor/skills` and `.agents/skills` are junctions into `tools/vendor/`, except Graphify, which `graphify install --project` writes as real files. Do not add `.cursor/rules/ponytail.mdc`: that rule disables the Ponytail Cursor hooks.

---

## 1. Vision Model Routing & Zero-Fallback Architecture

### 1.1 Model Topology & Hierarchy
Visual product truth extraction, category learning, and 6-pose scene planning rely on a deep-reasoning, high-reliability multi-tier hierarchy:
1. **Primary Vision Model:** **Meta Muse Spark** (`muse-spark-1.3-contributor:medium` default, or `muse-spark-1.2-contributor:medium`; standard `muse-spark-1.3` when training opt-out is required)
   - Runs at **`medium` thinking** (`reasoning: { effort: "medium" }`) by default during `product_truth` analysis & pose planning (~103s typical full 6-image extraction within the 125s Hop 1 window, avoiding `high` 113–125s+ timeout cascades while preserving `"high"` if explicitly selected in Administration).
   - Image QA (`qa`) continues running at `"low"` for sub-second-to-few-second turnaround.
2. **In-Provider Sibling Fallback (Zero-Drop Recovery):**
   - If `muse-spark-1.3-contributor` returns HTTP 404 or model unavailable in a specific region or account tier (or suffers a fast `<10s` transient 429/5xx), the system retries once quickly / **automatically switches** to `muse-spark-1.2-contributor` (and vice-versa) within the same Meta provider execution before declaring a provider failure.
   - This ensures transient model version differences never cause a drop-out to secondary providers.
3. **High-Concurrency Primary Fallback (Hop 1 when `ZAI_API_KEY` is configured):** **Z.ai GLM 5.3 Flash** (`glm-5.3-flash:medium`, sibling `glm-5.3-flashx`)
   - Native multimodal VLM (320B total / 18B active parameters, 1M context, 128K output) via `https://api.z.ai/api/paas/v4/chat/completions` (and LangChain `ChatOpenAI` in FastAPI) with forced deep thinking (`thinking: { type: "enabled", clear_thinking: false }`, `temperature: 1`, `top_p: 0.95`).
   - Supports **50 concurrent requests** on `glm-5.3-flash` and **20 concurrent requests** (200 tokens/s) on sibling `glm-5.3-flashx`, automatically failing over between siblings on 404/429/5xx before falling back to OpenAI GPT.
4. **OpenAI Fallback (Hop 2 / Hop 1 when Z.ai is unconfigured):** **OpenAI GPT 6.1 Terra** (`gpt-6.1-terra:medium`)
   - OpenAI fallback for `product_truth` analysis & pose planning, defaulting to **`medium`** reasoning (`reasoning: { effort: "medium" }` on Responses / `reasoning_effort: "medium"` on Chat Completions; clamped to `low` only when `< 60s` remains in the Edge gateway or FastAPI budget, while still preserving `"high"` if explicitly chosen in Administration when budget allows).
5. **Safety Net (Hop 3+), by service:**
   - **Edge Function (`app-api`):** Chains `Meta Muse Spark -> Z.ai GLM 5.3 Flash (when ZAI_API_KEY is configured) -> OpenAI GPT 6.1 Terra (medium) -> OpenAI GPT 5.6 Luna (low) -> Gemini 3.8 Flash (low)`.
   - **FastAPI (`invoke_vision_json`):** Chains `Meta Muse Spark -> Z.ai GLM 5.3 Flash (when ZAI_API_KEY is configured) -> OpenAI GPT 6.1 Terra (medium) -> OpenAI GPT 5.6 Luna (medium) -> Legacy GPT 5.6 Terra (low) -> Google Gemini 3.8 Flash (low)`.
   - Invoked only when earlier hops fail.
6. **Default Image Generation Model:** **`gpt-image-2.6-sunburst`** (`primary_reasoning = 'none'`)
   - Default flagship model across Studio, Catalog batches, FastAPI LangGraph nodes, and `organization_ai_model_policies` (`image_generation`), producing 3:4 2K (`1536x2048`) images at `medium` default quality (overrideable per shoot; visually verified sharper than `gpt-image-2.5-sunburst`).

### 1.2 Meta Responses API Protocol Rules
- **Multimodal Endpoint:** `https://api.meta.ai/v1/responses` is the sole multimodal endpoint for Meta Muse Spark.
- **Canonical Input Schema:** The payload `input` array MUST use the standard message format:
  ```json
  [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "..." },
        { "type": "input_image", "image_url": "data:image/jpeg;base64,..." }
      ]
    }
  ]
  ```
  *Never* send `[{ type: "message", role: "user", content }]` as primary input. Doing so triggers HTTP 400 Bad Request, causing redundant base64 re-uploads and timeout cascades.
- **Chat Completions Endpoint Guard:** Meta `/v1/chat/completions` does NOT support multimodal images. When image parts are present, failed Responses API calls must never fall back to Chat Completions, as it corrupts error telemetry with misleading 404s.
- **Time Budgets & Multi-SKU Per-Minute Throughput (3–6+ SKUs/min):**
  - Studio analysis runs in a detached in-memory flight (`lib/studioAnalysisFlights.ts`, one per org + input set) with a 600s chain budget (`STUDIO_ANALYSIS_FLIGHT_BUDGET_MS`). Each request answers `analysisPending` at 280s (`ANALYZE_PROXY_BUDGET_MS`, inside Railway's 300s proxy cut), and the Studio re-joins with `resumeAnalysis` (`src/lib/analysisPending.ts`). The primary may run 240s (`PRODUCT_TRUTH_PRIMARY_WINDOW_MS`), so after a Meta timeout GLM 5.3 Flash gets ~285s. Later hops keep `60s` (`PRODUCT_TRUTH_FALLBACK_RESERVE_MS`) for the next one. Spec: `docs/specs/studio-analysis-fallback-window.md`.
  - Studio eagerly uploads all reference images in the background on selection and automatically starts `studio.analyze` **1 second (`AUTO_ANALYZE_DELAY_MS = 1000`)** after all uploaded images finish (`requiredReady && allReferencesUploaded`). Editing `SKU Code` or `Product Name` never aborts or invalidates analysis, and editing director notes never aborts an in-flight analysis.
  - `visionLimiter(6)` allows up to 6 concurrent vision analyses. When `>= 2` concurrent requests are already running on `muse-spark-1.3-contributor`, additional concurrent requests balance onto `muse-spark-1.2-contributor`. On HTTP `429` (`TPM` / `RPM` per-minute limits), the rate-limited model enters a 45s cooldown and switches immediately to its sibling or fails over in `0ms` to OpenAI `gpt-6.1-terra:medium`.
  - When `studio.analyze` completes, it passes `seed_analysis` (`product_identity`, `provider`, `model`) to FastAPI `dna.extract`, persisting immutable Product DNA V2 without re-downloading images or making a duplicate VLM call.

---

## 2. Product Truth & Generation Quality Contracts (PR 131 Rules)

### 2.1 Style Reference Clothing Isolation & Quarantine
- **The Role of Style Reference:** The style reference image is the authority for:
  - Photoshoot backdrop set, room architecture, wall color/finish, flooring, furniture, props, lighting behavior, composition, and mood.
  - The body posture or signature pose, camera angle and framing of **Pose 4 only**, and only when the stored pose plan adopts it (section 2.6). A plan stored before analysis v38 may also carry a Pose 6 adoption, which generation still honours.
- **Quarantine in Every Frame:** The style reference person's outfit, face, hair, and anything in the hands are never copied. Jewellery is not quarantined: it follows `stylingPlan` (taste read from the style reference).
- **Requested Props Exception:** When the product notes ask the model to hold or carry a prop ("holds a coffee glass and a hand bag as in the reference image"; `requestedHandheldProps` in `lib/profiles.ts`, which needs a holding/carrying verb and skips negated sentences), that prop carries over from the style reference in every frame except the Pose 5 craft crop and the Pose 6 detail close-up, never covering the garment. `withRequestedPropsAllowed` narrows the generic no-props lines in the image prompt and QA to unrequested props, and QA fails a frame that misses a requested prop.
- **Shared Face/Style Upload:** When the same photo is uploaded as both model face and style reference, it is sent once, in the identity slot (first for front poses), with an identity-first label; every prompt ends with an IDENTITY CHECK naming that image.
- **Absolute Quarantine on Garment Copying:** The clothing, outfit, saree, dress, fabric, color, prints, embroidery, or neckline shown on the person in the style reference image MUST BE **100% DISCARDED**.
- **Exclusive Authority of Product Uploads:** The model must be dressed **EXCLUSIVELY** in the uploaded product references (FRONT, BACK, BOTTOM, FABRIC, MANNEQUIN).
- **Zero Compromise Rule:** Never compromise product fidelity to match the aesthetic or outfit in the style reference image. If the uploaded product is a navy blue kurti with gold butti work and the style reference shows a white gown in an archway, the final render must feature the navy blue kurti in the archway—NEVER the white gown or a blend of both.

### 2.2 Strict Human Anatomy & Limb Integrity
- **Two Arms, Two Hands Mandate:** Every generated image must adhere to strict human anatomical realism:
  - STRICTLY EXACTLY TWO ARMS AND TWO HANDS.
  - Zero third hands, zero phantom hands, zero duplicate wrists, zero extra arms or limbs.
  - Both hands must be anatomically connected to visible forearms and wrists originating from the model's shoulders.
  - **No Floating Hands:** Strictly prohibit floating hands resting on waist, hips, navel, or fabric pleats during drape-holding or poses without a clear, continuous forearm connection.
- **QA Verification Rule:** Automated QA (`qa.ts`) must immediately fail and veto any render exhibiting extra hands, phantom limbs, or detached fingers, with zero tolerance.

### 2.3 Pose 5 Primary Garment Focus (Detail / Macro Shot)
- **Primary Garment Craftsmanship:** Pose 5 is dedicated to selling the primary product's core craftsmanship (e.g. kurti butti work, chest/yoke embroidery, neckline craft, handwork, or fabric weave).
- **Prohibition on Secondary Hijack:** Pose 5 must NEVER be hijacked by secondary accessories. It is strictly forbidden to focus on, zoom into, or crop into a dupatta, stole, or scarf when the primary garment has signature details (such as butti work or embroidery) to showcase.
- **Exception:** A dupatta may only be the hero focus of Pose 5 if the uploaded SKU is strictly a standalone dupatta.

### 2.4 Pose 6 Product Highlight
- **Detail Close-Up (analysis v38+):** Frame 6 is a tight, accurate detail close-up of the product's most distinctive feature on the worn garment, never a full-body frame and never a reference posture. `productHighlightPlan` (`lib/showcaseFeature.ts`) starts from the analysis's `showcasePlan` pick (a torso feature on the back moves to `back_detail`) and takes the next distinctive feature recorded in `productIdentity` (back closure, sleeves, dupatta, hem, bottom wear, embroidery, print, fabric) when the pick is vague or is Pose 5's subject. It stores `productHighlight: true`, a `macro_detail`/`half_body_detail` shot, and the evidence role that best shows the feature (`back`, `fabric_pattern`, `mannequin`/`additional_product` for sleeves), which leads the Pose 6 reference manifest. The crop follows the feature (back closure: back-detail crop from behind, shoulder blades to waist; sleeves: forearm/cuff; dupatta: drape detail; print/embroidery: torso).
- **Legacy Showcase:** A plan stored before v38 keeps its full-body showcase and any Pose 6 reference variation at generation.
- **Total Consistency:** Frame 6 must maintain 100% consistency with frames 1–5 in:
  - Model identity and appearance.
  - Product fidelity, colors, prints, embroidery, and styling.
  - Photoshoot backdrop set, architecture, lighting, and camera grading.

### 2.5 Cut-Isolated Garment & Style Learning Architecture
- **Farshi / Farsi Salwar Isolation:** When an uploaded garment's `bottom_cut` or `garment_family` is explicitly `farshi` / `farsi`, preserve authentic two-leg separated volume, gathered waist pleats, upper-hem narrowing toward the waist side, a **4-inch taper from the upper hem**, and continuous bottom border geometry. **Never** leak Farshi geometry rules onto non-Farshi bottoms (regular salwar, palazzo, sharara, gharara, straight pants).
- **Category-Specific Visual Intelligence:**
  - **Sarees:** Detect weave, pallu vs. body vs. border patterns, blouse contrast, and Gen-Z editorial draping silhouettes from uploaded product & reference photos without inventiveness.
  - **Top-Only Kurtis vs. Multi-Piece Kurti Sets:** Keep `top_only` kurtis free of hallucinated coordinating bottoms unless `outfit_includes_bottom_wear` is active; coordinate top + bottom + dupatta draping across all 6 poses when multi-piece references are uploaded.

### 2.6 Reference-Led Pose & Expression Planning
Spec: `docs/specs/reference-pose-expression-planning.md`. Contract: `supabase/functions/app-api/lib/posePlanning.ts`.
- **Contract:** The analysis (v36+) records `referencePose` (posture, body-only description, seat/support, `generic|signature`, attitude, suitability) and `expressionPlan` (attitude, energy, gaze, smile). The result is stored once at `catalog_sessions.session_data.posePlanning`: `slots.creative` / `slots.showcase` (`source: "reference" | "product"`, posture, directive, rationale), per-pose `expressions`, `planner: "langgraph" | "local"`, `planKey`, `threadId`, `learnedSignals`.
- **Scope:** Only Pose 4 (`creative`) can have `source: "reference"` from analysis v38 (Pose 6 is the product highlight; a v36/v37 stored plan may still adopt Pose 6). Prompts, QA role labels, and seating are always derived from the stored plan (`slotReferencePlan`, `isReferenceLowPostureSlot`), never from pose fields the client sends back.
- **Hard guards** (`referenceAdoptionBlockReason`, mirrored exactly in `backend/agents/pose_plan_agents.py`, parity fixture test), v38: no person; Pose 6 (never adopts); an explicit sit request in the product notes when the reference posture is not seated; Farshi + folded posture (seated, kneeling, crouching, reclining); saree + reclining. Pose 4 adopts whenever the reference shows a person: the soft `suitableForProduct` verdict and a generic stance no longer block it (Poses 1-3 already show the silhouette and the back), and a walking or lifted-foot reference is grounded as a weight shift (`slotPosture`: a walking reference is stored as `standing`). The adopted directive carries the seat, the reference `cameraAngle` (camera and framing) and a garment line (front, print and colours exact; a folded posture may let the hem rest but never hides the print). Every stored or planner-supplied adoption is re-checked on normalization.
- **Legacy rule:** No `posePlanning` = legacy. Analyses before v36 have no `referencePose`/`expressionPlan`, `normalizeAnalysis` returns no `posePlanning`, and they keep today's pose behaviour: no posture copying, no planned expressions or attitude line. Their prompts are not byte-identical to before: shared prompt text (the `lib/garmentPoses.ts` pose-grammar lines, the default `CONSISTENCY_RULES`) was reworded for every session. Every new analysis has a plan: the expression plan and attitude line apply to all six frames; posture adoption only to adopted Pose 4/6.
- **Per-frame look (v37, `lib/expressionDirection.ts`):** each face-visible slot gets its own gaze, head angle, mouth (smile level shifted per slot, capped by energy) and gesture, in a `THIS FRAME'S EXPRESSION, GAZE & BODY LANGUAGE` closing-tail block; other lines point at it. Applies to legacy sessions too. `expressionPlan` no longer prints a shared gaze; `modelIdentity.face` is stripped of gaze/smile words. `referencePose` adds `cameraAngle`, `expression`, `gaze`, `hands` (Python `normalize_reference_pose` mirrors them): Pose 4 takes that look whenever the reference shows a person (scrubbed like every expression line; folded-posture hands are dropped from a standing frame), the camera only when adopted; an adopted Pose 6 keeps its own showcase look. The planner's per-frame mood gets the same scrub. QA never fails `model_face` for a different expression, gaze or head angle. Audit (Nov 2026): every live session was v35, so v36 planning had never run; existing shoots need Clone Session plus Studio "Re-analyze Ground Truth" for v37 (`cloneJob` copies session_data, it does not re-analyse).
- **Expressions:** `expressions[poseId]` is planner-owned text. The LangGraph planner returns all six on every successful plan (adopted or not); the local fallback (planner unavailable) returns none, so empty falls back to `pose.expression`. The planner's Pose 5 expression follows the close-up mode: the face-out-of-crop line only for `product_detail`.
- **Learning loop:** `pose_plan_outcomes` holds one row per `(organization_id, outcome_key)`, `outcome_key = pose_family|bottom_cut_class|slot|source|posture|distinctiveness`, with use, DNA pass/fail, DNA score average, human approved/rejected counters and `best_plan`. The Edge worker writes it (finalize + human review, compare-and-set; `lib/posePlanOutcomes.ts`); the planner's `recall_outcomes` node reads it. Penalty: `use_count >= 3` and (DNA fail rate `>= 0.5` or `human_rejected_count >= 2` and more rejections than approvals). Boost: `use_count >= 3`, DNA pass rate `>= 0.8`, `dna_score_avg >= 90`, rejections `<=` approvals. Learning is advisory: the guards always run first, and a recall failure plans without signals. `generation_learnings` also stores `pose_planning` and per-pose `pose_scores`.
- **DNA consistency gate:** Every pose is scored on shape, color, material, logo and details (`lib/qa.ts`, pass floor 85 per attribute) before it is accepted, as purpose `qa` at low reasoning. Each failed attempt is archived (never deleted) and the pose retried within the existing retry limit; after the last attempt (or a repeat of the previous DNA defect) a frame that failed only this check is kept for human review (`requires_human_review`), never discarded. A check outage ships the image `unverified` with DNA marked unavailable. When opt-in pose QA runs, the DNA verdict is derived from its scores (no second call).
- **Style profile cache:** An `analysis_cache` row (`cache_kind = 'style_reference_profile'`, org-scoped) stores only the style reference's room, light, camera and mood fields (not framing, composition or props), its `referencePose` and styling taste. The key is a collision-resistant hash of the style reference content hashes (plus any scene/model direction) and `ANALYSIS_VERSION`. On a hit, the analysis omits the style image and receives the profile as text; suitability, Pose 4/6 and the expression plan are judged afresh. Skipped when the style reference doubles as model identity or on `forceRefresh`.

---

## 3. Agentic Backend, Tooling & Verification Invariants

1. **Mandatory Agent Skills (`/ponytail` + `/graphify` + `/understand`):** Follow section 0. If the skill files, the `graphify` CLI, or the Understand-Anything core build are missing, run `powershell -File tools/install-agent-skills.ps1` before any other work.
2. **Pure AI Model Policy:** `supabase/functions/app-api/lib/aiModelPolicy.ts` must remain pure (no database queries, no network fetches, no environment reads). Tenant resolution and database interaction belong in `index.ts`.
3. **LangGraph + FastAPI + Valkey Microservices (`backend/`):**
   - `FastAPI` runs two LangGraph graphs (`PostgresSaver` checkpoints) with `Valkey` as its cache on Railway (`AI Studio App`): Product DNA V2 extraction (`inspect_evidence → extract_dna`, immutable `product_dna_versions`) and the pose planner below. It never generates or judges images. Celery, the `celery-worker` service, the `/api/v1/generation|qa|memory` routes and the unused pgvector memory search were retired in Nov 2026 (no production traffic reached them; `knowledge_embeddings` had no rows). A Product DNA version a person approved for a SKU is read by the Edge worker as a product lock (`lib/productDnaLock.ts`): its invariants and prohibited changes join the prompt, QA and DNA check, never when it describes a different kind of product (saree vs not, Farshi vs not). Internal Edge-to-FastAPI traffic uses `INTERNAL_API_SECRET` / `CATALOG_WORKER_SECRET` and internal networking (`http://fastapi.railway.internal:8000`) with scale-to-zero idle posture (`sleepApplication: true` in `railway.toml`).
   - **Pose planning graph (`POST /api/v1/plan`, `verify_internal_secret`):** `analyze_references → recall_outcomes → plan_poses → plan_expression → validate_plan` (`backend/graph.py` `build_planning_graph` / `run_pose_planning`, nodes in `backend/agents/pose_plan_agents.py`), `RetryPolicy(max_attempts=3)` per node, re-plans with failing slots forced product-led until `MAX_PLAN_ATTEMPTS`, then keeps both slots product-led. It makes no model call: Edge sends the existing analysis result (`posePlanningGraphPayload`). Checkpoints use thread `thread_plan_<org>_<thread_key>` (thread key = analysis fingerprint). Edge merges the response with `mergeGraphPosePlanning`, which re-applies the guards; if the planner is unreachable, the deterministic `localPosePlanningDecision` is stored instead. Generation and the DNA check stay in the Edge worker.
4. **Automated Test Gate:** All Deno tests (`node $npxCli deno test -A supabase/functions/app-api/tests/`), Python backend tests (`$env:PYTHONPATH="backend"; python -m pytest backend/tests/ -q`), linter (`npm run lint`), and web build (`npm run build`) must pass cleanly before merging into `main`.
5. **Sentry Error Tracking (`SENTRY_DSN` / `VITE_SENTRY_DSN`):**
   - Lightweight zero-dependency Sentry Envelope v7 reporters are wired across Frontend (`src/lib/sentry.ts`), Edge Gateway (`supabase/functions/app-api/lib/sentry.ts`), and Python FastAPI (`backend/services/sentry_telemetry.py`), capturing non-aborted API/vision/worker exceptions with structured tags (`operation`, `sku_id`, `ai_provider`, `ai_model`, `gateway_cut`).
6. **Workflow Vigilance:** Any pull request merged into `main` triggers automated CI/CD deployment pipelines:
   - `Validate application` + `Deploy Supabase database and Edge Function` (`supabase/functions/app-api` + migrations).
   - `Deploy web app to Cloud Run` + Railway auto-deploys (`functions`, `FastAPI`).
   Always monitor GitHub Actions & Railway deployments to green/SUCCESS completion.
