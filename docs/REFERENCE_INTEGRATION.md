# Reference application integration map

Legacy source of truth: `C:\Users\shukl\Desktop\Fashion-Catalog-Studio-main`

## Integrated architecture

| Legacy capability | Youthnic implementation |
| --- | --- |
| Five-pose catalog plan | Gemini multimodal analysis and garment-specific planning in `supabase/functions/app-api/` |
| Product truth references | Firebase Storage URLs/paths recorded in Supabase `planning_assets` |
| Product and creative analysis | Structured Product Identity and Creative Direction profiles from all labeled references |
| Session memory | Supabase `catalog_sessions` with product/model/scene/pose locks and approved anchor data |
| Generation queue | Atomic Supabase queue claims plus cron-triggered Edge Function workers |
| Reference-aware generation | OpenAI `gpt-image-2` image edits with prioritized product, anchor, and style-only inputs |
| Pose QA | Gemini multi-image QA with bounded automatic correction retries |
| History/results | `generation_jobs`, `session_generations`, Firebase output URLs, ZIP download, and per-pose regeneration |
| Planning intake | Supabase-backed catalog requests, style references, scheduling, validation, and export |
| Authentication | Firebase Authentication |
| Authorization | Supabase membership/role/permission tables and PostgreSQL RLS |
| Notifications/events | Supabase notifications, marketing events, research runs, and scheduled digests |
| Learning and observability | Existing Supabase analysis, learning, prompt, fashion-knowledge, QA, cost, and execution tables |

## Product consistency rules

Original product references always outrank generated anchors and style references. The style image may influence photography, background, composition, mood, lighting, and pose direction, but it cannot replace or modify garment identity.

Every generation prompt repeats the locked invariants and limits the permitted delta to pose, camera angle, framing, expression, and explicitly planned movement. The back pose requires the uploaded back reference, and the close-up must preserve the same model face while revealing an actually present garment detail.

The virtual try-on construction follows OpenAI's official multimodal image prompting guidance: preserve subject and product identity, describe only the intended change, and request physically realistic garment drape, folds, occlusion, lighting, and shadows.

## Operational rules

- Front and back product images are required.
- Fabric/pattern, additional product, and style references are optional.
- Reference changes invalidate the analysis fingerprint and pose plan.
- Generation is blocked until the current analysis and plan are ready.
- Poses are generated sequentially with one worker claim at a time.
- Pose 1 is the model/scene consistency anchor; originals remain product truth.
- Default output is `3:4`, `2K`, quality `medium`.
- QA failures retry up to the configured limit and remain visible when exhausted.

## Completed backend cutover

The UI, database, actions, queues, schedules, administration, history, and learning paths use Firebase plus Supabase. Convex code, packages, local data, URLs, and credentials were removed after archiving and mapping 216 non-auth business documents to the live Supabase project.
