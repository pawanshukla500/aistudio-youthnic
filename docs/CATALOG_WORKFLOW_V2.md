# Catalog Workflow V2

## Scope and audit baseline

This document records the operational audit completed before the Catalog Production UI was changed. The audit covered the React application, the Firebase-authenticated Supabase access layer, PostgreSQL tables and policies, Realtime publication, Firebase asset storage, the `app-api` Edge Function, `pg_cron` jobs, and the existing Catalog Planning and Generation Flow screens.

Live baseline on 24 August 2026:

- Catalog Planning creates `planning_batches` and one `planning_requests` row per colourway/SKU. A batch stores the campaign and shared generation settings; each SKU stores front/back readiness, analysis, the five-pose plan, queue state, and the current generation job.
- Reference and generated files are stored in Firebase Storage. Supabase stores their URLs, paths, hashes, role, and generation metadata in `planning_assets`, `catalog_sessions`, and `session_generations`.
- A durable worker processes `generation_jobs`. Five `session_generations` rows hold the current pose outputs. `ai_runs` and `qa_reviews` hold provider and automatic-QA telemetry.
- Database triggers copy generation state into `catalog_work_items`. Catalog Production then supplies assignment, human QC, Listing Team completion, Excel import, and reconciliation actions.
- `catalog_work_item_events` records status changes but not a complete human activity trail. It lacks structured comments, per-pose decisions, regeneration-version records, and handoff/delivery links.
- The daily catalog email is idempotent by organization and report date, but it selects generation completions rather than final human approvals. It does not model business days, holidays, late approvals, delivery attempts, preview/resend administration, or per-SKU handoffs.
- Realtime is enabled for generation and planning tables, but not for Catalog Production work items, events, report deliveries, or the legacy flow-node tables. Catalog Production therefore polls every 15 seconds.
- The current Flow View reconstructs a technical execution graph. The live legacy data contains repeated prompt/provider/QA nodes for only a small number of sessions. The graph is fit into one large canvas, which makes every card too small to read and leaves most of the screen empty. It does not express the operational SKU workflow, ownership, next action, handoff, listing state, or stage time.

## Current end-to-end workflow

1. A manager creates a catalog in Planning and optionally links a campaign/event.
2. Multiple SKU/colourway lines are added.
3. Shared style/model direction and SKU front/back references are uploaded.
4. Gemini preflight validates product truth and produces a five-pose plan.
5. The catalog is scheduled or started; a durable generation job produces five pose rows.
6. Automatic QA runs during generation. Generation completion creates or updates a Catalog Production work item.
7. A manager may assign generation and listing owners.
8. A reviewer passes or rejects the SKU as a single unit.
9. Passing QC unlocks Listing Done; rejection blocks the item.
10. A scheduled Edge operation emails the Listing Team about the prior day's generation completions.
11. The Listing Team marks the listing complete and the item moves below active work.

## Google Sheet comparison and gaps

| Operational need | Existing application | Gap resolved by V2 |
| --- | --- | --- |
| Batch and multi-SKU intake | Catalog Planning and Excel import | Add deadlines, marketplaces, special instructions, priority, ownership, front/back references, and the full structured creative brief to the in-app and spreadsheet contracts |
| Per-SKU ownership | Current generation/listing owner columns | Preserve assignment history and expose owner filters |
| Structured creative brief | Batch settings and free-form directions | Store a queryable creative-direction record with mood, model, styling, pose, background, lighting, composition, and marketplace requirements |
| Thirteen business stages | Four coarse status columns | Persist one canonical workflow stage, progress, next action, blocked reason, and stage entry/exit timing |
| Complete activity trail | Status-change events only | Add actor-aware comments, assignments, approvals, rejections, failures, regenerations, and handoff/delivery events |
| Five-pose versioning | One mutable row per pose plus JSON history | Create immutable pose-version records and human review rows while retaining the current output rows for compatibility |
| Stable Listing Team package | Individual current pose links and ZIP action | Create a stable SKU handoff record that resolves to the five approved pose versions |
| Approval-based daily email | Prior-day generation-complete email | Select unsent final approvals, use business-day/timezone settings, keep delivery attempts, and never create an empty delivery |
| Live production status | 15-second polling | Publish work, event, asset-version, handoff, and delivery tables to Realtime and retain a low-frequency recovery poll |
| Usable flow visualization | Tiny technical graph | Use live operational stages as the default; keep technical diagnostics as an optional view |
| Listing execution | Pending to Done | Add Sent to Listing Team and Listing in Progress before Listed |

## Target model and compatibility strategy

The migration extends existing tables instead of replacing them:

- Existing organizations, memberships, roles, permissions, planning batches, planning requests, generation jobs, sessions, automatic QA, and asset metadata remain authoritative.
- Existing organization-scoped `roles` are also the application's operational team records, and `member_roles` are their normalized memberships. V2 adds granular catalog permissions so the Listing Team, Review Team, Creative Team, and Planning Manager no longer rely on one broad `planning.manage` capability. The configured handoff recipient group can be any workspace role/team.
- `catalog_work_items` gains operational fields: canonical stage, progress, next action, deadlines, marketplaces, instructions, approval/rejection data, handoff timestamps, current stage start, blocker/error details, and a stable asset-folder key.
- `catalog_creative_directions` stores the structured brief per work item.
- `catalog_work_item_assignments` stores immutable generation/listing/reviewer assignment history.
- `catalog_pose_asset_versions` stores immutable versions for poses 1–5. A trigger mirrors completed `session_generations` rows and a backfill creates version 1/current epochs without copying binary files.
- `catalog_asset_reviews` stores human pose/SKU decisions and comments.
- `catalog_work_item_comments` stores discussion entries with authors and timestamps.
- `catalog_listing_handoffs` and `catalog_listing_handoff_assets` freeze the five approved versions for one approval revision.
- A reviewer can reopen a final approval before delivery; doing so supersedes the pending handoff and requires a new approval revision. Once sending starts or the package is sent/listed, that revision is immutable and further work must use a new catalog revision.
- `catalog_handoff_settings` stores the organization timezone, local send time, recipients, weekdays, holidays, and late-approval policy.
- Existing member `notification_preferences` now controls assignment alerts and participation in role-targeted catalog handoff email. Both preferences are editable from the member profile.
- `catalog_report_delivery_attempts` and `catalog_report_delivery_items` extend the existing report record with retry history and SKU-level idempotency.
- Existing Firebase file paths and URLs remain valid. New asset metadata includes a storage backend so a later binary migration to a tenant-prefixed Supabase Storage bucket can be performed without breaking current assets.

All new organization-owned tables include `organization_id`, RLS, an organization-leading index, explicit authenticated read grants, and server-only writes through the permission-checked Edge API. Browser clients cannot write audit, approval, assignment, handoff, or delivery records directly.

## Canonical workflow

The default workflow has these ordered stages:

1. Requirement created
2. Reference assets pending
3. Planning
4. Ready for generation
5. Generation in progress
6. Quality review
7. Re-generation required
8. Approved
9. Ready for listing
10. Sent to Listing Team
11. Listing in progress
12. Listed
13. Blocked or failed

Stage definitions are database records; work items and activity timestamps determine the visual state. The client does not fabricate sample nodes.

## Phased implementation and acceptance criteria

### Phase 1 — data contract and security

- Apply only additive columns/tables/indexes, then backfill from current records.
- Enable and test RLS and least-privilege grants on every new exposed table.
- Add new operational tables to Realtime.
- Acceptance: existing Planning and generation continue working; cross-organization reads return zero rows; every current SKU has a valid stage and current completed poses have version records.

### Phase 2 — workflow API and actions

- Return one tenant-scoped workflow detail containing summary, stages, timings, poses/versions, comments, activity, dependencies, owners, permissions, and next actions.
- Audit assignment, QC, regeneration, comments, listing start/completion, manual sends, and settings changes.
- Acceptance: invalid transitions fail server-side; authorized roles can complete their actions; unauthorized roles receive an error; retry reopens downstream state.

### Phase 3 — live Flow and production UI

- Make the operational timeline the default Flow View, with responsive summary, progress, ownership, stage timing, dependencies, errors, five-pose detail, and activity.
- Add search, filters, sort, list/Kanban/flow views, active-first ordering, detail panel, loading/empty/error/success states, and working actions.
- Acceptance: the UI updates from Realtime, works at desktop and mobile widths, and contains no decorative buttons.

### Phase 4 — approval handoff and email administration

- Freeze a five-pose handoff only after final approval.
- Select all unsent approvals before the current local-day cutoff, including late/weekend approvals, and label the delivery with the previous configured business day.
- Skip empty deliveries; keep an idempotent item record and one attempt row for every send/resend. Revalidate the frozen approval immediately before provider delivery so a concurrently rejected package is skipped instead of emailed.
- Acceptance: the same handoff is not included twice by automation, failed sends can retry without colliding with their existing item reservation, manual preview/send/resend is permission-controlled, and delivery history exposes recipients, timestamps, attempts, and errors.

### Phase 5 — verification and rollout

- Exercise realistic batches with manager, generator, reviewer, Listing Team, and read-only roles.
- Run migration validation, lint, TypeScript, automated tests, production build, security/performance advisors, and browser QA.
- Deploy schema before Edge/API and UI. Keep the legacy technical graph available during rollout and remove it only after production workflow parity is confirmed.

## Local verification completed

The implementation was verified locally on 24 August 2026 with:

- `oxlint` across the React source.
- A workflow contract test covering all thirteen stage records, tenant-scoped tables, RLS/storage declarations, Realtime publication, latest-version/five-pose approval gates, immutable delivered revisions, implemented UI actions, idempotent retry reservations, pre-send approval revalidation, and the no-empty-email rule.
- Five Deno tests for weekday, weekend, configured holiday, year-boundary, and invalid-business-calendar behavior.
- Deno type checking for the complete `app-api` Edge Function.
- SQL parsing for all 109 statements in the immutable base migration plus all 15 statements in the additive hardening migration, using bounded top-level chunks so the verifier remains reliable as PL/pgSQL grows.
- TypeScript compilation and a production Vite build.
- Desktop and mobile browser QA of the live-data Flow interface, including Flow, assets, activity, brief editing, responsive stage navigation, loading, and pending-asset behavior.

The Excel import/template now carries the same operational data as in-app intake: SKU/product, front and back references, priority, owners, deadline, marketplaces/campaign, special instructions, and all creative-direction fields. Dry-run validation reports unknown assignees, invalid dates/priorities, missing references, and queue-ready rows before import.

The base V2 migration, Edge Function, and client were deployed from the merged implementation PR on 24 August 2026. The follow-up hardening migration and corresponding API/UI changes remain gated by their own PR and must deploy in the same order: additive migration, server/Edge API, then client. Cross-tenant RLS, role-specific transitions, Realtime delivery, Storage access, scheduled invocation, email-provider behavior, and existing-data backfill still require the authenticated manager/generator/reviewer/Listing Team/read-only acceptance run below; a green deployment job alone does not prove those user-level behaviors.

### Authenticated live acceptance command

After deployment, run `npm run verify:catalog-workflow:live` with:

- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
- `CATALOG_TEST_WORK_ITEM_ID` pointing to a realistic five-pose catalog item in the primary test organization.
- Fresh Firebase ID tokens for `CATALOG_TEST_MANAGER_JWT`, `CATALOG_TEST_GENERATOR_JWT`, `CATALOG_TEST_REVIEWER_JWT`, `CATALOG_TEST_LISTING_JWT`, `CATALOG_TEST_VIEWER_JWT`, and `CATALOG_TEST_OTHER_ORG_JWT`.

The first five users must share one organization and default to the Planning Manager, Creative Team, Review Team, Listing Team, and Viewer roles. The final user must belong to a different organization. Optional `CATALOG_TEST_*_ROLE` values override those expected role slugs. The command is non-destructive: it reads one supplied workflow, probes invalid IDs for role boundaries, verifies direct server-owned writes are denied, checks cross-tenant database and Storage reads return no rows, and audits visible notification addressing.

## Known migration boundary

Binary assets remain in Firebase Storage in this phase because the active generator and signed download path already depend on it. The new normalized version/handoff records are storage-provider neutral. Moving existing binaries to Supabase Storage is a separate, reversible migration with checksum verification, dual-read support, and a tenant-prefixed path policy; it must not be mixed into the operational workflow rollout.
