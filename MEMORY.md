# Core Memory — Fashion Studio AI & Youthnic Engine

This file is the **Canonical Core Memory** for the Youthnic AI Fashion Studio codebase. It records foundational architectural decisions, immutable system contracts, model routing policies, and generation quality standards. All AI agents, engineers, and workflows must honor these principles without compromise.

---

## 1. Vision Model Routing & Zero-Fallback Architecture

### 1.1 Model Topology & Hierarchy
Visual product truth extraction and scene planning rely on a cost-effective, high-accuracy multi-tier hierarchy:
1. **Primary Vision Model:** **Meta Muse Spark 1.2 Contributor** (`muse-spark-1.2-contributor:low`)
   - Low cost (~$0.02 - $0.05 / 1M tokens), high multimodal acuity for fashion and fabric analysis.
   - Enforced reasoning effort: `"low"` (or `"minimal"`). High reasoning is prohibited on Meta vision calls because it exceeds hop timeouts.
2. **In-Provider Sibling Fallback (Zero-Drop Recovery):**
   - If `muse-spark-1.2-contributor` returns HTTP 404 or model unavailable in a specific region or account tier, the system **automatically retries** with `muse-spark-1.3-contributor` (and vice-versa for 1.3 to 1.2) within the same Meta provider execution before ever declaring a provider failure.
   - This ensures transient model version differences never cause a drop-out to secondary providers.
3. **Primary Fallback (Hop 1):** **OpenAI GPT-5.6 Luna** (`gpt-5.6-luna:high`)
   - Preserves high reasoning when hop budget permits (>= 60s) for deep chain-of-thought analysis across scene, styling, and 6-pose plans.
   - Automatically clamped to `low` (`clampProductTruthHopThinking`) when the remaining hop slice is under 60s to ensure fast, reliable answers in 10-15s without timing out.
4. **Safety Net (Hop 2):** **OpenAI GPT-5.6 Terra** (`gpt-5.6-terra:low`)
   - Final safety net; only invoked if both low-cost primary and secondary models fail.

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

---

## 3. Deployment, Testing & Verification Invariants

1. **Pure AI Model Policy:** `supabase/functions/app-api/lib/aiModelPolicy.ts` must remain pure (no database queries, no network fetches, no environment reads). Tenant resolution and database interaction belong in `index.ts`.
2. **Automated Test Gate:** All 249+ Deno tests (`cmd.exe /c npx --yes deno test -A supabase/functions/app-api/tests/`) and web build (`cmd.exe /c npm run build`) must pass cleanly before any code is merged into `main`.
3. **Workflow Vigilance:** Any pull request merged into `main` triggers automated CI/CD deployment pipelines:
   - Cloud Run web application deployment (`Deploy web app to Cloud Run`).
   - Edge Functions deployment to Supabase/Railway.
   Always monitor GitHub Actions workflow runs to green completion.
