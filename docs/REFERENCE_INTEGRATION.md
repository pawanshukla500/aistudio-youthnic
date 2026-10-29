# Reference application integration map

Legacy source of truth: `C:\Users\shukl\Desktop\Fashion-Catalog-Studio-main`

## Integrated architecture

| Legacy capability | Youthnic implementation |
| --- | --- |
| Six-pose catalog plan | Gemini multimodal analysis and garment-specific planning in `supabase/functions/app-api/` |
| Product truth references | Firebase Storage URLs/paths recorded in Supabase `planning_assets` |
| Product and creative analysis | Structured Product Identity and Creative Direction profiles from all labeled references |
| Session memory | Supabase `catalog_sessions` with product/model/scene/pose locks and approved anchor data |
| Generation queue | Atomic Supabase queue claims plus cron-triggered Edge Function workers |
| Reference-aware generation | OpenAI `gpt-image-2` image edits with identity-first uploads: model face, then style-set (backdrop/room/lighting), then product DNA. Style clothing stays quarantined. |
| Pose QA | Gemini multi-image QA with bounded automatic correction retries |
| History/results | `generation_jobs`, `session_generations`, Firebase output URLs, ZIP download, and per-pose regeneration |
| Planning intake | Supabase-backed catalog requests, style references, scheduling, validation, and export |
| Authentication | Firebase Authentication |
| Authorization | Supabase membership/role/permission tables and PostgreSQL RLS |
| Notifications/events | Supabase notifications, marketing events, research runs, and scheduled digests |
| Learning and observability | Existing Supabase analysis, learning, prompt, fashion-knowledge, QA, cost, and execution tables |

## Product consistency rules

MODEL FACE REFERENCE locks the person. STYLE REFERENCE locks hair/makeup mood, jewellery taste, and the photoshoot backdrop/room/lighting for all six poses, including true-back. PRODUCT PHOTOS (FRONT, BACK, BOTTOM, FABRIC, MANNEQUIN) are the exclusive 100% DNA for garment cut, print, embroidery, colour, and construction. Style clothing is discarded. Generated Pose 1 is identity and set continuity only; it never outranks the original product photos.

Every generation prompt repeats the locked invariants and limits the permitted delta to pose, camera angle, framing, expression, and explicitly planned movement. The back pose requires the uploaded back reference, rebuilds the style-set room (not the rear product's pre-shoot studio), and keeps the same face on any over-shoulder glance. The close-up must preserve the same model while revealing an actually present primary-garment detail. Every pose must read as a living photographed person, never a mannequin or stiff freeze.

The virtual try-on construction follows OpenAI's official multimodal image prompting guidance: preserve subject and product identity, describe only the intended change, and request physically realistic garment drape, folds, occlusion, lighting, and shadows.

## Operational rules

- Front and back product images are required.
- Fabric/pattern, additional product, style, and model-identity references are optional but, when present, stay on every pose including true-back.
- GPT Image 2 attends hardest to the earliest uploads, so model face and style-set precede product photos in both the prompt IMAGE labels and the provider `image[]` order.
- Reference changes invalidate the analysis fingerprint and pose plan.
- Generation is blocked until the current analysis and plan are ready.
- Poses are generated sequentially with one worker claim at a time.
- Pose 1 is the model/scene consistency anchor; originals remain product truth.
- Default output is `3:4`, `2K`, quality `medium`.
- QA failures retry up to the configured limit and remain visible when exhausted.

## Completed backend cutover

The UI, database, actions, queues, schedules, administration, history, and learning paths use Firebase plus Supabase. Convex code, packages, local data, URLs, and credentials were removed after archiving and mapping 216 non-auth business documents to the live Supabase project.
