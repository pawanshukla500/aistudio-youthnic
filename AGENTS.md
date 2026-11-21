# AGENTS.md — Agent Guidelines & Behavioral Contracts

This document establishes operational requirements, architectural constraints, and behavioral contracts for all autonomous, pair-programming, and review agents (Antigravity, Claude, Cursor, Copilot, CodeAnt, etc.) interacting with the Youthnic AI Studio codebase.

---

## 1. Prime Directives (Non-Negotiable)

1. **Adhere to `MEMORY.md`:** `MEMORY.md` is the canonical source of truth for architectural contracts, model routing, and generation quality standards. Never violate any contract defined in `MEMORY.md`.
2. **Product Truth is Absolute:**
   - Generated outfits must be derived **EXCLUSIVELY** from uploaded product images (FRONT, BACK, BOTTOM, FABRIC, MANNEQUIN).
   - Style reference images provide the studio backdrop, architecture, flooring, set dressing, lighting, and camera mood, and the body posture of Pose 4/6 only when the stored pose plan adopts it (directive 4). Never copy their outfit, face, hair, or objects in the hands; jewellery follows the styling plan (`stylingPlan`). Exception: props the product notes ask the model to hold or carry (`requestedHandheldProps`) carry over from the style reference in every frame except the Pose 5 crop, never covering the garment.
   - **Quarantine the Style Reference Outfit:** Clothing worn by models in style reference images must be 100% ignored and discarded. Never borrow, blend, or transfer style reference clothing onto the model.
   - **Never Compromise Quality for Reference Matching:** The uploaded product's design, cut, prints, butti work, embroidery, and colors must remain identical to the uploaded references.
3. **Strict Anatomical Realism:**
   - Every generated person must have **strictly exactly two arms and two hands**.
   - Zero third hands, zero floating hands, zero phantom limbs, zero duplicate wrists or fingers.
   - No floating hands resting on waist, hips, navel, or fabric pleats during drape-holding without continuous, visible forearm anatomy.
   - Automated QA (`qa.ts`) must veto any image exhibiting anatomical duplication.
4. **Pose Planning Integrity:**
   - **Pose 5 (Detail Shot):** Must highlight the signature craftsmanship of the PRIMARY uploaded garment (e.g. kurti butti work, yoke embroidery, neckline craft). Never hijack Pose 5 by focusing on secondary accessories like dupattas or stoles when the primary garment has craftsmanship to showcase.
   - **Pose 6 (Showcase Frame):** Must complement frames 1–5 while showing a distinct diverging pose, preserving 100% consistency in model identity, product truth, backdrop set, and styling.
   - **Pose 4 / Pose 6 Reference Matching:** Only Pose 4 (`creative`) and Pose 6 (`showcase`) may copy the style reference person's posture or signature pose, and only when `catalog_sessions.session_data.posePlanning` adopts it. The LangGraph planner (`POST /api/v1/plan`) chooses after the hard guards in `lib/posePlanning.ts` (`referenceAdoptionBlockReason`, mirrored exactly in `backend/agents/pose_plan_agents.py`). An explicit sit request in the product notes takes precedence for Pose 4: Pose 4 then adopts a reference posture only when that posture is seated. Read adoption from the stored plan (`slotReferencePlan`), never from client-sent pose fields. Poses 1, 2, 3 and 5 stay catalog frames; analyses without `posePlanning` (before v36) keep today's pose behaviour: no posture copying, no planned expressions or attitude line.

---

## 2. Vision Model Calling & Zero-Fallback Protocol

When interacting with vision pipelines (`supabase/functions/app-api/` and `backend/services/ai_clients.py`):
- **Primary Route (Analysis & Pose Planning):** Meta Muse Spark (`muse-spark-1.3-contributor:medium` default or `muse-spark-1.2-contributor:medium`; standard `muse-spark-1.3` / `1.2` when needed) is the default primary when `META_MODEL_API_KEY` is present, running with **`medium` thinking** (`reasoning: { effort: "medium" }`).
- **Payload Schema:** Always send `input: [{ role: "user", content: [...] }]` to `https://api.meta.ai/v1/responses`. Do not send `{ type: "message" }`.
- **Reasoning Effort:** Meta Muse Spark and OpenAI `gpt-6.1-terra` default `product_truth` analysis & pose planning to **`medium`** thinking (while Edge Hop 2 safety-net runs `gpt-5.6-luna:low` and FastAPI secondary runs `gpt-5.6-luna:medium`; explicit **`high`** or **`medium`** selections are preserved in `clampProductTruthThinking` in `app-api` / `invoke_vision_json` in FastAPI), clamping down to `low` under emergency tight remaining budgets (`< 60s` in Edge or FastAPI). Image QA (`qa`) runs at `low` for speed.
- **In-Provider Sibling Retry:** If `muse-spark-1.3-contributor` returns 404/not available (or suffers a fast `<10s` transient 429/5xx), transparently retry `muse-spark-1.2-contributor` (and vice-versa) before falling back. Similarly, Z.ai `glm-5.3-flash` (50x concurrency) transparently retries sibling `glm-5.3-flashx` (20x concurrency, 200 tok/s).
- **Fallback Chain:** Hop 1 (when `ZAI_API_KEY` is configured) is **Z.ai GLM 5.3 Flash (`glm-5.3-flash:medium`)** via `https://api.z.ai/api/paas/v4/chat/completions` with forced thinking (`thinking: { type: "enabled" }`), Hop 2 is **OpenAI GPT 6.1 Terra (`gpt-6.1-terra:medium`)** for analysis & pose planning fallback, Hop 3 is OpenAI GPT 5.6 Luna (`gpt-5.6-luna:low`), then Gemini Flash (`gemini-3.8-flash`).
- **Default Image Generation Model:** **`gpt-image-2.6-sunburst`** (3:4, 2K / `1536x2048`, default `medium` quality unless overridden; DB policy `primary_reasoning` must be `'none'`).
- **Garment Construction Isolation:** Preserve Farshi/Farsi two-leg architecture and 4-inch upper-hem taper strictly on `farshi` SKUs only—never bleed Farshi geometry rules onto non-Farshi bottoms.
- **Deno Railway Runtime (`Dockerfile.functions`):** Keep `DENO_V8_FLAGS` comma-separated (`"--max-old-space-size=768,--optimize-for-size"`), never space-separated.

---

## 3. Mandatory Core Agent Workflows (`/ponytail`, `/graphify`, `/understand`)

Every AI agent accessing or modifying this repository **MUST** follow `MEMORY.md` section 0 before anything else. If Graphify, Ponytail, or Understand-Anything is not installed in this checkout, run `powershell -File tools/install-agent-skills.ps1` and wait until it exits 0.

1. **`/ponytail` Always-On Code Discipline (Mandatory on Every Code Change):**
   - Read `.cursor/skills/ponytail/SKILL.md` and apply level `full`.
   - Inspect real callers first (`git grep`) before changing interfaces, signatures, or shared helpers.
   - Deliver the **smallest complete change** that solves the full problem—no speculative abstractions, redundant wrappers, or silent fallbacks.
   - Keep existing validation, tenant isolation, and error handling intact; preserve unrelated comments/docstrings.
   - Leave concise unit tests for non-trivial behavior changes and summarize any skipped checks or residual risks in the final report.
2. **`/graphify` Default Knowledge Graph Usage:**
   - Query `graphify-out/graph.json` with `graphify query`, `graphify path`, or `graphify explain` **first** when navigating architecture or tracing multi-file dependencies across TypeScript, Deno, React, and Python.
   - If `graphify-out/graph.json` is missing, build it with `graphify extract . --code-only`.
   - Run `graphify update .` after completing code or documentation edits so `graphify-out/` stays current for subsequent agents.
3. **`/understand` Architecture Graph:**
   - Before architecture or cross-file work, use `.ua/knowledge-graph.json` when it exists.
   - If it is missing, follow `.cursor/skills/understand/SKILL.md` and build it. The plugin root is `tools/vendor/understand-anything/understand-anything-plugin`.
   - Use `/understand-explain` for a file or symbol and `/understand-diff` for the impact of a change.

---

## 4. Architecture & Verification Standards

1. **Dual-Service Backend Architecture (`Railway` project `AI Studio App`):**
   - **Edge Gateway (`supabase/functions/app-api/`):** `functions` service handling auth, `organization_ai_model_policies`, image generation jobs, Firebase Storage proxying, and orchestration delegation. Keep `supabase/functions/app-api/lib/aiModelPolicy.ts` pure (no DB queries, network fetches, or env reads).
   - **LangGraph Agentic Service (`backend/`):** `FastAPI` + `celery-worker` services backed by Supabase Postgres (`PostgresSaver` checkpoints, Product DNA V2 immutable versions) and `Valkey` (cache + Celery broker), providing `/api/v1/dna/extract`, `/api/v1/studio/generate`, `/api/v1/qa/evaluate`, `/api/v1/plan` (pose & expression planning graph), and `/health`.
2. **Atomic Commits & Verification:**
   - Deno checks & tests: `node $npxCli deno check --frozen supabase/functions/app-api/index.ts` and `node $npxCli deno test -A supabase/functions/app-api/tests/` (using full `test:catalog-workflow` list before push).
   - Python backend tests: `$env:PYTHONPATH = "backend"; python -m pytest backend/tests/ -q`.
   - Frontend lint & build (also regenerates `src/features/docs/docsData.ts`): `node $npmCli run lint` and `node $npmCli run build`.
   - Never push or merge changes that break existing tests.
3. **Workflow & PR Governance:**
   - Run pre-commit CodeRabbit (`code-reviewer`), fix findings on PRs, squash-merge into `main`, and actively monitor GitHub Actions (`Validate application`, `Deploy Supabase database and Edge Function`, `Deploy web app to Cloud Run`) and Railway deployments (`functions`, `FastAPI`, `celery-worker`) until green completion.
