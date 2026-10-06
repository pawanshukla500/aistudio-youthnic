# AGENTS.md — Agent Guidelines & Behavioral Contracts

This document establishes operational requirements, architectural constraints, and behavioral contracts for all autonomous, pair-programming, and review agents (Antigravity, Claude, Cursor, Copilot, CodeAnt, etc.) interacting with the Youthnic AI Studio codebase.

---

## 1. Prime Directives (Non-Negotiable)

1. **Adhere to `MEMORY.md`:** `MEMORY.md` is the canonical source of truth for architectural contracts, model routing, and generation quality standards. Never violate any contract defined in `MEMORY.md`.
2. **Product Truth is Absolute:**
   - Generated outfits must be derived **EXCLUSIVELY** from uploaded product images (FRONT, BACK, BOTTOM, FABRIC, MANNEQUIN).
   - Style reference images provide ONLY the studio backdrop, architecture, flooring, props, lighting, and camera mood.
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

When interacting with vision pipelines (`supabase/functions/app-api/`):
- **Primary Route:** Meta Muse Spark 1.2 Contributor (`muse-spark-1.2-contributor:low`) is the default primary when `META_MODEL_API_KEY` is present.
- **Payload Schema:** Always send `input: [{ role: "user", content: [...] }]` to `https://api.meta.ai/v1/responses`. Do not send `{ type: "message" }`.
- **Reasoning Effort:** Clamped to `low` or `minimal` on Meta to ensure execution inside 15-25 seconds and prevent hop timeouts.
- **In-Provider Sibling Retry:** If `muse-spark-1.2-contributor` returns 404/not available, transparently retry `muse-spark-1.3-contributor` (and vice-versa) before falling back.
- **Fallback Chain:** Hop 1 is OpenAI Luna (`gpt-5.6-luna:high`), Hop 2 is OpenAI Terra (`gpt-5.6-terra:low`).

---

## 3. Engineering & Workflow Standards

1. **Pure Policy Layer:** `supabase/functions/app-api/lib/aiModelPolicy.ts` must remain pure (no database queries, no network fetches, no environment reads).
2. **Atomic Commits & Verification:**
   - Run full Deno tests: `cmd.exe /c npx --yes deno test -A supabase/functions/app-api/tests/`
   - Run web build: `cmd.exe /c npm run build`
   - Never push or merge changes that break existing tests.
3. **Workflow Monitoring:**
   - When pull requests are merged into `main`, actively monitor the resulting GitHub Actions workflow until green completion.
