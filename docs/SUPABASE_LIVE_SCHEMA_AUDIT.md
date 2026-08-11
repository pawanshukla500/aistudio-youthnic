# Supabase live schema audit and completed cutover

Audit and cutover date: 2026-08-11  
Project: `cyygmyiqgdzgeoayxbro` (`Ai Fashion Studio App`, production branch)

## Outcome

The live Supabase project is the canonical database and backend runtime. Firebase Authentication is the only identity/session authority, and Firebase Storage is the durable media store. The application has no remaining Convex runtime or package dependency.

Supabase validates Firebase ID tokens through its Firebase third-party Auth integration. PostgreSQL RLS maps `auth.jwt()->>'sub'` to `organization_members.firebase_uid` and applies organization/permission access.

## Existing live data reused

The project already contained the legacy application's RBAC, planning history, learning data, prompt patterns, fashion knowledge, and event intelligence. The cutover reused and extended that schema instead of creating a parallel replacement.

The audited public tables cover:

- Identity and RBAC: `organizations`, `organization_members`, `roles`, `permissions`, `role_permissions`, `member_roles`
- Planning and production: `planning_batches`, `planning_requests`, `planning_assets`, `batch_approvals`, `notifications`, `audit_logs`, `execution_events`
- AI and learning: `analysis_cache`, `generation_learnings`, `learning_daily_digests`, `prompt_patterns`, `prompt_versions`, `fashion_knowledge_base`, `ai_runs`, `visual_attributes`, `qa_reviews`
- Events: `marketing_events`, `regional_festival_catalog`, `marketplace_campaign_catalog`, `event_research_runs`
- Runtime: `catalog_sessions`, `session_generations`, `scene_analyses`, `generation_jobs`
- Settings/audit: `app_settings`, `app_system_settings`, `app_audit_logs`

Cutover migrations added `app_migration_archive`, enriched runtime tables, and added traceable `legacy_convex_id` fields where canonical records were reused.

## Convex business-data import

Source: the read-only export in `.migration-audit-20260811/convex-export`.

- 216 non-auth business documents archived in `app_migration_archive`
- 216 documents assigned a canonical destination
- 0 unresolved documents
- 30 generation sessions mapped to `catalog_sessions`
- 44 reference records mapped to `planning_assets`
- 13 unique analysis-cache records linked after natural-key deduplication
- 15 imported event records linked to `marketing_events`

All source payloads remain available in `app_migration_archive` for service-role audit and rollback tooling, including records whose canonical representation was merged by a natural key.

The import deliberately excluded Convex Auth credentials, password data, sessions, refresh tokens, verifiers, and rate-limit rows. Moving those records would conflict with Firebase's role as the identity authority and would retain unnecessary sensitive data.

## Database and security changes

Applied migrations:

- `20260811065551_firebase_rls_and_app_access.sql`
- `20260811150000_convex_cutover_runtime.sql`
- `20260811153000_edge_worker_schedules.sql`
- `20260811160000_import_convex_business_archive.sql`

Security and runtime behavior:

- RLS is enabled across the application tables.
- Firebase-aware helpers resolve current UID, member, organization, and permissions.
- Browser clients receive only explicit authenticated Data API grants.
- Organization-scoped policies protect business tables.
- Server-only learning, queue, and audit access stays behind the Edge Function/service role.
- `planning_assets.asset_role` supports front, back, fabric/pattern, additional product, style, model anchor, catalog reference, and generated assets.
- Planning, notification, and generation workflow tables participate in Supabase Realtime.
- Queue claims are atomic and recover expired locks.

## Runtime mapping

| Application concept | Supabase source |
| --- | --- |
| Organization/workspace | `organizations`, `organization_members` |
| Roles and permissions | `roles`, `permissions`, `member_roles`, `role_permissions` |
| Catalog batch | `planning_batches` |
| Catalog colourway/SKU | `planning_requests` |
| Front/back/fabric/additional/style/generated media | `planning_assets` with Firebase URLs/paths |
| Product analysis and pose-plan cache | `analysis_cache`, `planning_requests.garment_analysis` |
| Generation session and anchor memory | `catalog_sessions` |
| Sequential job/pose state | `generation_jobs`, `session_generations` |
| QA and retries | `qa_reviews` plus generation/validation fields |
| Cross-run learning | `generation_learnings`, `prompt_patterns`, `fashion_knowledge_base`, `learning_daily_digests` |
| Cost and traceability | `ai_runs`, `prompt_versions`, `execution_events` |
| Events roadmap | `marketing_events`, regional/marketplace catalogs, `event_research_runs` |
| Notifications and approvals | `notifications`, `batch_approvals` |

## Edge Function and schedules

`app-api` now owns Studio analysis, queueing, cancellation, regeneration, Firebase media persistence, catalog planning/scheduling, administration, event research, and migration intake.

The deployed function validates Firebase ID tokens directly, invokes Gemini Vision and OpenAI server-side, and applies the Supabase service role only after workspace authorization. It also accepts a dedicated `CATALOG_WORKER_SECRET` for internal scheduled work.

Active cron jobs:

- `ai-studio-due-catalogs` every minute
- `ai-studio-generation-recovery` every minute

## Verification evidence

The production cutover verifier passed with:

- Supabase Edge API authenticated and healthy
- Firebase Auth + Supabase RLS accepted
- Configured OpenAI key allowed access to `gpt-image-2`
- Five workspace members visible to the API
- Archive audit: 216 total, 0 unresolved

Run locally:

```powershell
npm.cmd run firebase:sync-supabase-claims
npm.cmd run supabase:verify-firebase
npm.cmd run supabase:verify-cutover -- --email returnorders@vbexports.co.in
npm.cmd run lint
npm.cmd run build
```

## Retirement boundary

The application can run without the former self-hosted Convex instance. The archived export should be retained until the team is satisfied with production operation. Removing the old service from the Hostinger VPS is an infrastructure action outside this repository and should be done only after a final deployment smoke test.

Do not commit `.env.local`, Firebase service-account material, passwords, provider API keys, or Supabase service-role secrets.
