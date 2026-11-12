# Core Memory — Fashion Studio AI & Youthnic Engine

This file is the **Canonical Core Memory** for the Youthnic AI Fashion Studio codebase. It records foundational architectural decisions, immutable system contracts, model routing policies, and generation quality standards. All AI agents, engineers, and workflows must honor these principles without compromise.

---

## 1. Vision Model Routing & Zero-Fallback Architecture

### 1.1 Model Topology & Hierarchy
Visual product truth extraction, category learning, and 6-pose scene planning rely on a deep-reasoning, high-reliability multi-tier hierarchy:
1. **Primary Vision Model:** **Meta Muse Spark** (`muse-spark-1.2-contributor:high` or `muse-spark-1.3-contributor:high`; standard `muse-spark-1.3:high` when training opt-out is required)
   - Runs at **`high` thinking** (`reasoning: { effort: "high" }`) during `product_truth` analysis & pose planning for deep visual garment extraction and Gen-Z / ethnic pose choreography (~6–12s typical live execution).
   - Image QA (`qa`) continues running at `"low"` for sub-second-to-few-second turnaround.
2. **In-Provider Sibling Fallback (Zero-Drop Recovery):**
   - If `muse-spark-1.2-contributor` returns HTTP 404 or model unavailable in a specific region or account tier, the system **automatically retries** with `muse-spark-1.3-contributor` (and vice-versa for 1.3 to 1.2) within the same Meta provider execution before ever declaring a provider failure.
   - This ensures transient model version differences never cause a drop-out to secondary providers.
3. **Primary Fallback (Hop 1):** **OpenAI GPT 6.1 Terra** (`gpt-6.1-terra:high`)
   - First fallback for `product_truth` analysis & pose planning, preserving **`high`** reasoning (`reasoning: { effort: "high" }` on Responses / `reasoning_effort: "high"` on Chat Completions; clamped to `low` only when `< 60s` remains in the Edge gateway or FastAPI budget).
4. **Safety Net (Hop 2+), by service:**
   - **Edge Function (`app-api`):** When `product_truth` uses Meta primary + OpenAI GPT 6.1 Terra fallback, **OpenAI GPT 5.6 Luna** (`gpt-5.6-luna:high`) is appended as the secondary OpenAI safety net (and default unconfigured fallbacks include **Gemini 3.8 Flash** when `GEMINI_API_KEY` is configured).
   - **FastAPI (`invoke_vision_json`):** **OpenAI GPT 5.6 Luna** (`gpt-5.6-luna:high`) -> Legacy **GPT 5.6 Terra** (`gpt-5.6-terra:low`) -> **Google Gemini 3.8 Flash** (`gemini-3.8-flash:low`).
   - Invoked only when primary and Hop 1 fail.
5. **Default Image Generation Model:** **`gpt-image-2.6-sunburst`**
   - Default flagship model across Studio, Catalog batches, FastAPI LangGraph nodes, and `organization_ai_model_policies` (`image_generation`), producing 3:4 2K (`1536x2048`) images at `medium` default quality (overrideable per shoot).

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
- **Time Budgets:** Full gateway budget is 175s within Studio's 180s client timeout (`STUDIO_ANALYZE_TIMEOUT_MS`). Hop 1 receives up to 125s so Meta has ample time to complete full multimodal analysis without timing out.

---

## 2. Product Truth & Generation Quality Contracts (PR 131 Rules)

### 2.1 Style Reference Clothing Isolation & Quarantine
- **The Role of Style Reference:** The style reference image is STRICTLY and SOLELY the authority for:
  - Photoshoot backdrop set, room architecture, wall color/finish, flooring, furniture, props, lighting behavior, composition, and mood.
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

### 2.4 Pose 6 Complementary Divergence
- **Distinct Pose:** Frame 6 must show a distinct pose that diverges from and complements frames 1 through 5 (e.g. dynamic movement, subtle turn, distinctive detail framing).
- **Total Consistency:** Frame 6 must maintain 100% consistency with frames 1–5 in:
  - Model identity and appearance.
  - Product fidelity, colors, prints, embroidery, and styling.
  - Photoshoot backdrop set, architecture, lighting, and camera grading.

### 2.5 Cut-Isolated Garment & Style Learning Architecture
- **Farshi / Farsi Salwar Isolation:** When an uploaded garment's `bottom_cut` or `garment_family` is explicitly `farshi` / `farsi`, preserve authentic two-leg separated volume, gathered waist pleats, upper-hem narrowing toward the waist side, a **4-inch taper from the upper hem**, and continuous bottom border geometry. **Never** leak Farshi geometry rules onto non-Farshi bottoms (regular salwar, palazzo, sharara, gharara, straight pants).
- **Category-Specific Visual Intelligence:**
  - **Sarees:** Detect weave, pallu vs. body vs. border patterns, blouse contrast, and Gen-Z editorial draping silhouettes from uploaded product & reference photos without inventiveness.
  - **Top-Only Kurtis vs. Multi-Piece Kurti Sets:** Keep `top_only` kurtis free of hallucinated coordinating bottoms unless `outfit_includes_bottom_wear` is active; coordinate top + bottom + dupatta draping across all 6 poses when multi-piece references are uploaded.

---

## 3. Agentic Backend, Tooling & Verification Invariants

1. **Mandatory Agent Tooling (`/ponytail` + `/graphify`):**
   - Every agent editing code in this repo **must** use **`/ponytail`** (`full`) every time (check callers first, smallest complete change, preserve error handling/validation, add targeted tests, disclose unrun checks/risks).
   - Every agent accessing this repo **must** use **`/graphify`** by default: query `graphify-out/graph.json` / `GRAPH_REPORT.md` first for codebase discovery and update `graphify-out/` incrementally (`/graphify . --update`) after edits.
2. **Pure AI Model Policy:** `supabase/functions/app-api/lib/aiModelPolicy.ts` must remain pure (no database queries, no network fetches, no environment reads). Tenant resolution and database interaction belong in `index.ts`.
3. **LangGraph + FastAPI + Valkey Microservices (`backend/`):**
   - `FastAPI` runs the LangGraph state graph (`PostgresSaver` checkpoints + Product DNA V2 immutable versions) alongside `celery-worker` and `Valkey` on Railway (`AI Studio App`). Internal Edge-to-FastAPI traffic uses `INTERNAL_API_SECRET` / `CATALOG_WORKER_SECRET` and internal networking (`http://fastapi.railway.internal:8000`) with scale-to-zero idle posture (`sleepApplication: true` in `railway.toml`).
4. **Automated Test Gate:** All Deno tests (`node $npxCli deno test -A supabase/functions/app-api/tests/`), Python backend tests (`$env:PYTHONPATH="backend"; python -m pytest backend/tests/ -q`), linter (`npm run lint`), and web build (`npm run build`) must pass cleanly before merging into `main`.
5. **Workflow Vigilance:** Any pull request merged into `main` triggers automated CI/CD deployment pipelines:
   - `Validate application` + `Deploy Supabase database and Edge Function` (`supabase/functions/app-api` + migrations).
   - `Deploy web app to Cloud Run` + Railway auto-deploys (`functions`, `FastAPI`, `celery-worker`).
   Always monitor GitHub Actions & Railway deployments to green/SUCCESS completion.
