# AGENTS.md — Agent Guidelines & Behavioral Contracts

This document establishes operational requirements, architectural constraints, and behavioral contracts for all autonomous, pair-programming, and review agents (Antigravity, Claude, Cursor, Copilot, CodeAnt, etc.) interacting with the Youthnic AI Studio codebase.

---

## 1. Prime Directives (Non-Negotiable)

1. **Adhere to `MEMORY.md`:** `MEMORY.md` is the canonical source of truth for architectural contracts, model routing, and generation quality standards. Never violate any contract defined in `MEMORY.md`.
2. **Product Truth is Absolute:**
   - Generated outfits must be derived **EXCLUSIVELY** from uploaded product images (FRONT, BACK, BOTTOM, FABRIC, MANNEQUIN).
   - Style reference images provide ONLY the studio backdrop, architecture, flooring, set dressing, lighting, and camera mood. Copy the room only: do not copy the pose, the outfit, or objects in the hands.
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

---

## 2. Vision Model Calling & Zero-Fallback Protocol

When interacting with vision pipelines (`supabase/functions/app-api/` and `backend/services/ai_clients.py`):
- **Primary Route (Analysis & Pose Planning):** Meta Muse Spark (`muse-spark-1.2-contributor:high` or `muse-spark-1.3-contributor:high`, or standard `muse-spark-1.3:high` / `1.2:high`) is the default primary when `META_MODEL_API_KEY` is present, running with **`high` thinking** (`reasoning: { effort: "high" }`).
- **Payload Schema:** Always send `input: [{ role: "user", content: [...] }]` to `https://api.meta.ai/v1/responses`. Do not send `{ type: "message" }`.
- **Reasoning Effort:** Meta Muse Spark, OpenAI `gpt-6.1-terra`, and `gpt-5.6-luna` preserve **`high`** thinking during `product_truth` analysis & pose planning (`clampProductTruthThinking`), only clamping down to `low` under emergency tight hop budgets (`< 60s`). Image QA (`qa`) runs at `low` for speed.
- **In-Provider Sibling Retry:** If `muse-spark-1.2-contributor` returns 404/not available, transparently retry `muse-spark-1.3-contributor` (and vice-versa) before falling back.
- **Fallback Chain:** Hop 1 is **OpenAI GPT 6.1 Terra (`gpt-6.1-terra:high`)** for analysis & pose planning fallback, Hop 2 is OpenAI GPT 5.6 Luna (`gpt-5.6-luna:high`/`low`), then Gemini Flash (`gemini-3.8-flash`).
- **Default Image Generation Model:** **`gpt-image-2.6-sunburst`** (3:4, 2K / `1536x2048`, default `medium` quality unless overridden).
- **Garment Construction Isolation:** Preserve Farshi/Farsi two-leg architecture and 4-inch upper-hem taper strictly on `farshi` SKUs only—never bleed Farshi geometry rules onto non-Farshi bottoms.

---

## 3. Mandatory Core Agent Workflows (`/ponytail` & `/graphify`)

Every AI agent accessing or modifying this repository **MUST** follow these two workflows by default:

1. **`/ponytail` Always-On Code Discipline (Mandatory on Every Code Change):**
   - Inspect real callers first (`git grep`) before changing interfaces, signatures, or shared helpers.
   - Deliver the **smallest complete change** that solves the full problem—no speculative abstractions, redundant wrappers, or silent fallbacks.
   - Keep existing validation, tenant isolation, and error handling intact; preserve unrelated comments/docstrings.
   - Leave concise unit tests for non-trivial behavior changes and summarize any skipped checks or residual risks in the final report.
2. **`/graphify` Default Knowledge Graph Usage:**
   - Query `graphify-out/graph.json` and `graphify-out/GRAPH_REPORT.md` **first** when navigating architecture or tracing multi-file dependencies across TypeScript, Deno, React, and Python instead of reading entire directories blindly.
   - Run `/graphify . --update` after completing code or documentation edits so `graphify-out/` stays current for subsequent agents.

---

## 4. Architecture & Verification Standards

1. **Dual-Service Backend Architecture (`Railway` project `AI Studio App`):**
   - **Edge Gateway (`supabase/functions/app-api/`):** `functions` service handling auth, `organization_ai_model_policies`, image generation jobs, Firebase Storage proxying, and orchestration delegation. Keep `supabase/functions/app-api/lib/aiModelPolicy.ts` pure (no DB queries, network fetches, or env reads).
   - **LangGraph Agentic Service (`backend/`):** `FastAPI` + `celery-worker` services backed by Supabase Postgres (`AsyncPostgresSaver` checkpoints, Product DNA V2 immutable versions) and `Valkey` (cache + Celery broker), providing `/api/v1/dna/extract`, `/api/v1/studio/generate`, `/api/v1/qa/evaluate`, and `/health`.
2. **Atomic Commits & Verification:**
   - Deno checks & tests: `node $npxCli deno check --frozen supabase/functions/app-api/index.ts` and `node $npxCli deno test -A supabase/functions/app-api/tests/` (using full `test:catalog-workflow` list before push).
   - Python backend tests: `$env:PYTHONPATH = "backend"; python -m pytest backend/tests/ -q`.
   - Frontend lint & build (also regenerates `src/features/docs/docsData.ts`): `node $npmCli run lint` and `node $npmCli run build`.
   - Never push or merge changes that break existing tests.
3. **Workflow & PR Governance:**
   - Run pre-commit CodeRabbit (`code-reviewer`), fix findings on PRs, squash-merge into `main`, and actively monitor GitHub Actions (`Validate application`, `Deploy Supabase database and Edge Function`, `Deploy web app to Cloud Run`) and Railway deployments (`functions`, `FastAPI`, `celery-worker`) until green completion.
