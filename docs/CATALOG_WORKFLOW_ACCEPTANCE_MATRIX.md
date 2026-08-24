# Catalog Workflow V2 acceptance matrix

This matrix is the delivery contract for replacing the catalog Google Sheet. It maps each operational requirement to the implemented database/API/UI behavior and to the proof required before production sign-off.

Status meanings:

- **Implemented** — code and additive migration are present and covered by local automated verification.
- **Live gate** — implemented, but the authenticated production behavior must be exercised after the hardening migration, Edge API, and client deploy in that order.
- **Deferred migration** — compatibility is complete for new work, while reversible migration of historical binaries remains operational cleanup.

## Planning and workflow

| Requirement | Implemented behavior | Status and evidence |
| --- | --- | --- |
| Create a requirement/batch and add many SKUs | Catalog Planning persists one batch plus one request/work item per SKU; the spreadsheet importer supports multi-row intake and dry-run validation. | **Implemented** — Planning UI, `catalogProduction.importGoogleSheetDryRun`, and `catalogProduction.importGoogleSheet`. |
| Assign generation and listing ownership | Current owners live on the work item; initial Planning owners and later reassignments create immutable history with actor, assignee, assignment type, note, and timestamp. Owner IDs must resolve to active members in the same organization. | **Implemented; live gate** — role transition harness covers manager/generator/listing boundaries. |
| Priority, deadlines, campaign/event, marketplaces, and instructions | In-app intake and spreadsheet contracts store all fields and expose filters/sorting. | **Implemented** — batch, priority, campaign, marketplace, assignee, stage, date, query, and sort controls use database rows. |
| Front/back and other reference assets | Browser uploads use the private `catalog-assets` bucket; URL imports and historical Firebase objects remain supported. Reference records store role, path, backend, URL, metadata, and tenant. | **Implemented; live gate** — the live harness performs same-tenant upload/upsert/read/delete plus viewer and cross-tenant denial probes. |
| Structured creative direction | Mood/look, model, styling, poses, backdrop, lighting, composition, and marketplace requirements are stored in `catalog_creative_directions` and editable from workflow detail. | **Implemented** — normalized record plus audit event. |
| Thirteen required workflow states | Canonical stages are database rows and the server derives the current stage, progress, next action, timestamps, and exceptional state. | **Implemented** — contract test asserts all 13 codes and rejects invalid transitions. |
| Complete SKU activity history | Events, assignment history, comments, reviews, generation attempts, handoffs, and delivery attempts retain actor and timestamps. | **Implemented; live gate** — API actions are audited; post-deploy role run must prove visibility and denial. |
| Retry, re-generation, approval, rejection, and listing actions | Server actions enforce current state and permission, supersede stale pending handoffs, and preserve immutable sent revisions. | **Implemented; live gate** — contract tests cover transition guards; role harness covers user-level authorization. |
| Listing Team execution and active-first ordering | Sent, listing-in-progress, and listed are distinct stages. The Listing Team must start before completing. Listed items sort below active work. | **Implemented** — list/Kanban rules and server preconditions. |

## Live Flow and operator experience

| Requirement | Implemented behavior | Status and evidence |
| --- | --- | --- |
| Live data-driven Flow | Workflow detail joins work item, stage definitions, stage events/timings, owners, dependencies, poses, reviews, comments, handoffs, generation job, and session data. No sample stages are fabricated in the client. | **Implemented; live gate** — Realtime subscriptions refresh work item, event, and pose-version changes; production subscription delivery needs post-deploy proof. |
| Status, owner, progress, step, start/end, and time per stage | Responsive stage rail and summary expose the persisted current state, entry/completion times, visit count, and total time across repeated review/re-generation visits. Transition duration is attributed to the stage being exited. | **Implemented** — deterministic Deno tests cover re-entry and legacy events without recorded duration. |
| Blockers, failures, dependencies, and next action | Detail response returns structured dependencies, blocker/error details, permission-aware actions, and recovery state. | **Implemented** — API contract and exceptional-state UI. |
| Expandable SKU detail and five-pose inspection | From list/Kanban a SKU opens a full-screen live workflow; pose cards expose history, prompt/model metadata, reviews, comments, and downloads. | **Implemented** — desktop/mobile browser QA and local build. |
| Search, sort, and requested filters | Search covers SKU/request/batch/campaign/theme/remarks/marketplace; filters cover batch, assignee, status, campaign, marketplace, priority, and date. | **Implemented** — Catalog Production controls operate on fetched rows. |
| List, Kanban, and Flow views | Catalog Production provides list and Kanban; each SKU opens the live operational Flow. The technical generation graph remains available for diagnosis. | **Implemented** — existing diagnostics preserved. |
| Responsive navigation and states | The application retains the collapsible sidebar. Catalog Production and workflow detail have desktop/mobile layouts plus loading, empty, success, and actionable error states. | **Implemented** — browser QA and production build. |
| Working controls only | QC, re-generation guidance, bulk start, spreadsheet review, Planning delete/stop, Studio stop, History stop/retry/delete, send, and resend use accessible action dialogs with real handlers and server validation. | **Implemented** — static verifier fails on browser `prompt`/`confirm`, checks dialog wiring, and rendered QA found no native JavaScript dialog. |

## Five-pose asset package

| Requirement | Implemented behavior | Status and evidence |
| --- | --- | --- |
| Stable five-pose structure | Pose indexes 1–5 represent full, angle/side, back-reference, creative, and close-up outputs from the persisted pose plan. | **Implemented** — approval cannot pass unless all five latest versions are complete. |
| Preview/original/status/version/time/model/prompt | Immutable `catalog_pose_asset_versions` records contain stable storage path, preview/original/final URL fields, generation status, version, timestamp, model, prompt, and metadata. | **Implemented** — existing pose rows are backfilled without copying binaries. |
| Approval, comments, and regeneration history | Latest-version-only human reviews are stored separately; version/review/event history remains visible after regeneration. | **Implemented** — stale-version review is rejected server-side. |
| SKU-level Listing Team package | Final approval freezes the five exact versions into one revisioned handoff and exposes a stable authenticated workflow/package link plus individual signed asset links. | **Implemented; live gate** — package immutability and delivery behavior need the deployed acceptance run. |
| Download | Operators can download an individual pose or a five-pose ZIP; backend-aware readers support Supabase and historical Firebase objects. | **Implemented** — browser and Edge download paths. |

## Daily approval handoff

| Requirement | Implemented behavior | Status and evidence |
| --- | --- | --- |
| Following-morning consolidated email | Scheduled Edge processing selects unsent final approvals before the organization-local cutoff and renders one organization delivery. | **Implemented; live gate** — production cron and email-provider delivery require post-deploy observation. |
| Required email fields | Rows include batch/requirement, SKU/product, campaign/marketplace, folder and pose links, approval time, priority, deadline, and remarks. | **Implemented** — preview uses the same delivery payload. |
| Idempotency and no empty email | Delivery items uniquely reserve a handoff; automation returns without creating/sending an empty delivery; pre-send approval is revalidated. | **Implemented** — contract tests cover duplicate reservation, retry, concurrent rejection, and no-empty behavior. |
| Attempts, errors, retries, and recipients | Delivery plus attempt tables retain status, recipients, timestamps, retry count, provider response, and error. | **Implemented** — admin history and resend action. |
| Admin preview/config/send/resend | Authorized users can configure timezone, local send time, recipient role/custom recipients, weekdays, holidays, and inspect/preview/send/resend. | **Implemented; live gate** — permission boundary is included in the role harness. |
| Weekends, holidays, and late approvals | The business calendar calculates the previous configured business day; approvals not previously delivered, including weekend/holiday/late approvals, roll into the next eligible digest. | **Implemented** — five Deno calendar tests include weekday, weekend, holiday, year boundary, and invalid configuration. |

## Supabase security and operations

| Requirement | Implemented behavior | Status and evidence |
| --- | --- | --- |
| PostgreSQL/Auth/RBAC/RLS | Existing Firebase identities map to organization memberships; granular catalog permissions gate server actions; every organization-owned V2 table has tenant RLS and organization-leading indexes. A database trigger rejects cross-organization member, work-item, batch, event, asset, handoff, and delivery links even from service-role paths. | **Implemented; live gate** — migration validates historical relationships at deploy time; six-role harness proves same/cross-tenant outcomes after deploy. |
| Realtime | Work items, events, pose versions, handoffs, comments, and deliveries are added to the publication and clients retain a low-frequency recovery refresh. | **Implemented; live gate** — verify subscription events in deployed Supabase. |
| Storage isolation | Private bucket paths start with organization UUID. Browser policies require current organization plus planning/studio permissions; Edge service-role operations reject paths outside the active tenant. | **Implemented; live gate** — real Storage policy cycle is in the authenticated harness. |
| Scheduled jobs and Edge email | Cron invokes the permission-protected Edge operation; internal calls require the catalog worker secret. | **Implemented; live gate** — observe one eligible and one empty schedule window after deploy. |
| Audit and notifications | Sensitive actions write audit/events and targeted notifications; user notification preferences participate in recipient selection. | **Implemented; live gate** — recipient visibility and addressing are checked by the role harness. |
| Safe migration | The already-applied base migration is immutable. Hardening is additive, validates RLS/policy and tenant-relationship coverage, backfills state/version/handoff/assignment data, and deploys before API/UI. | **Implemented** — verifier parses both migrations, the live preflight passed all 33 catalog relationship checks, and Git comparison protects the base file. |

## Remaining production sign-off gates

1. Merge the hardening PR only after CI is green; deploy migration, Edge API, then client.
2. Run `npm run verify:catalog-workflow:live` with fresh manager, generator, reviewer, Listing Team, viewer, and other-organization tokens.
3. Observe Realtime updates and one scheduled digest cycle in the configured application timezone; confirm the no-approval window sends nothing.
4. Migrate historical Firebase binaries later in checksum-verified, reversible batches. New assets already use Supabase Storage, so this does not block the new workflow.
