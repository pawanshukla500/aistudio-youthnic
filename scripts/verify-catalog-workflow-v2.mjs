import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = [
  await readFile("supabase/migrations/20260824130000_catalog_workflow_v2.sql", "utf8"),
  await readFile("supabase/migrations/20260824153000_catalog_workflow_v2_hardening.sql", "utf8"),
  await readFile("supabase/migrations/20260825115104_add_generation_learning_rules.sql", "utf8"),
  await readFile("supabase/migrations/20260825122000_enforce_planning_asset_tenant_relationship.sql", "utf8"),
].join("\n");
const edge = await readFile("supabase/functions/app-api/index.ts", "utf8");
const catalogApi = await readFile("supabase/functions/app-api/catalogProduction.ts", "utf8");
const flow = await readFile("src/features/history/generation-flow/OperationalWorkflowView.tsx", "utf8");
const productionTable = await readFile("src/features/planning/catalog-production/ProductionTable.tsx", "utf8");
const productionBoard = await readFile("src/features/planning/catalog-production/ProductionBoard.tsx", "utf8");
const catalogProduction = await readFile("src/features/planning/catalog-production/CatalogProduction.tsx", "utf8");
const handoffAdmin = await readFile("src/features/planning/catalog-production/HandoffAdmin.tsx", "utf8");
const admin = await readFile("src/features/admin/Admin.tsx", "utf8");
const backend = await readFile("src/lib/backend.ts", "utf8");
const planning = await readFile("src/features/planning/Planning.tsx", "utf8");
const studio = await readFile("src/features/studio/Studio.tsx", "utf8");
const history = await readFile("src/features/history/History.tsx", "utf8");
const actionDialog = await readFile("src/components/ui/ActionDialog.tsx", "utf8");
const layout = await readFile("src/components/ui/Layout.tsx", "utf8");
const catalogStorage = await readFile("src/lib/catalogStorage.ts", "utf8");
const catalogStoragePaths = await readFile("supabase/functions/app-api/lib/catalogStoragePaths.ts", "utf8");
const liveVerifier = await readFile("scripts/verify-catalog-workflow-live.mjs", "utf8");
const stageTimeline = await readFile("supabase/functions/app-api/lib/catalogStageTimeline.ts", "utf8");

const stageCodes = [
  "requirement_created",
  "reference_assets_pending",
  "planning",
  "ready_for_generation",
  "generation_in_progress",
  "quality_review",
  "regeneration_required",
  "approved",
  "ready_for_listing",
  "sent_to_listing_team",
  "listing_in_progress",
  "listed",
  "blocked_failed",
];
for (const stage of stageCodes) assert.match(migration, new RegExp(`'${stage}'`), `Missing workflow stage ${stage}`);

const tenantTables = [
  "organization_teams",
  "organization_team_memberships",
  "organization_member_notification_preferences",
  "catalog_creative_directions",
  "catalog_work_item_assignments",
  "catalog_work_item_comments",
  "catalog_pose_asset_versions",
  "catalog_asset_reviews",
  "catalog_listing_handoffs",
  "catalog_listing_handoff_assets",
  "catalog_handoff_settings",
  "catalog_report_delivery_attempts",
  "catalog_report_delivery_items",
];
for (const table of tenantTables) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table} \\(`), `Missing table ${table}`);
  assert.match(migration, new RegExp(`'${table}'`), `${table} is not included in the tenant RLS loop`);
}

assert.match(migration, /organization_id = \(select private\.current_organization_id\(\)\)/, "Tenant RLS predicate is missing");
assert.match(migration, /revoke insert, update, delete .* authenticated/, "Authenticated direct mutations are not revoked");
assert.match(migration, /storage\.foldername\(name\)\)\[1\].*current_organization_id/s, "Storage paths are not tenant-prefixed");
assert.match(catalogStorage, /storage\.from\(CATALOG_ASSET_BUCKET\)\.upload|const bucket = supabase\.storage\.from\(CATALOG_ASSET_BUCKET\)/, "Browser reference uploads do not use Supabase Storage");
assert.match(edge, /CATALOG_ASSET_STORAGE_BACKEND[\s\S]*\|\| "supabase"/, "Generated catalog assets do not default to Supabase Storage");
assert.match(edge, /uploadCatalogObject[\s\S]*storage_backend: stored\.storageBackend/, "Generated asset metadata does not preserve its Storage backend");
assert.match(edge, /assertCatalogReferenceOwnership[\s\S]*firebaseCatalogPath\(orgId, storagePath\)/, "Service-role reference loading does not enforce the tenant path prefix");
assert.match(catalogStoragePaths, /firebaseCatalogPath[\s\S]*outside the current organization/, "Firebase legacy reference paths do not enforce their exact tenant layouts");
assert.match(migration, /generation_learning_rules_select_current_org[\s\S]*current_organization_id/, "Reusable generation guidance is not tenant-isolated");
assert.match(migration, /enforce_planning_asset_tenant_relationship[\s\S]*planning_assets_tenant_relationship_check/, "Planning assets can still cross-link to another organization's request");
assert.match(edge, /signCatalogObject[\s\S]*supabaseCatalogPath\(orgId, storagePath\)/, "Service-role signed URLs do not validate the active tenant prefix");
assert.match(edge, /downloadCatalogObject[\s\S]*supabaseCatalogPath\(orgId, storagePath\)/, "Service-role Storage downloads do not validate the active tenant prefix");
assert.match(edge, /deleteCatalogObject[\s\S]*supabaseCatalogPath\(orgId, storagePath\)/, "Service-role Storage deletion does not validate the active tenant prefix");
assert.match(liveVerifier, /managerStorage\.upload[\s\S]*upsert: true[\s\S]*viewerUpload\.error[\s\S]*viewerDelete\.error[\s\S]*otherOrgStorage\.download[\s\S]*managerStorage\.remove/, "Live verification does not exercise permission-controlled, tenant-safe Storage writes, reads, upserts, and cleanup");
assert.match(migration, /catalog_pose_asset_versions_current_approved_uidx/, "One-approved-version-per-pose invariant is missing");
assert.match(migration, /catalog_report_delivery_items.*unique \(handoff_id\)/s, "Per-handoff email idempotency is missing");
assert.match(migration, /sync_catalog_pose_asset_version/, "Pose-version synchronization trigger is missing");
assert.match(migration, /freeze_catalog_handoff_on_approval/, "Approval handoff freeze trigger is missing");
assert.match(migration, /'catalog_work_items'[\s\S]*alter publication supabase_realtime add table public\.%I/, "Catalog work items are not published to Realtime");
assert.match(migration, /security assertion failed:[\s\S]*has_table_privilege\('authenticated'/, "Executable deployment-time RLS/grant assertions are missing");
assert.match(migration, /enforce_catalog_tenant_relationships[\s\S]*tenant assertion failed/, "Cross-tenant catalog relationships are not guarded and validated");
assert.match(migration, /notifications_select_current_org[\s\S]*recipient_team[\s\S]*member_roles/, "Role-targeted notification isolation is missing");
assert.match(migration, /recipient_role_slug text not null default 'listing-team'/, "Configurable handoff recipient group is missing");
assert.match(migration, /recipient_team_id uuid references public\.organization_teams/, "Handoff settings are not linked to an operational team");
assert.match(migration, /replace_organization_team_members[\s\S]*upsert_organization_team[\s\S]*revoke all on function public\.upsert_organization_team/, "Atomic service-only team membership administration is missing");
assert.match(edge, /catalogMemberHandoffEmails[\s\S]*organization_member_notification_preferences[\s\S]*catalog_handoff_email/, "Normalized handoff notification preferences are not enforced");
assert.match(edge, /catalogTeamRecipients[\s\S]*organization_team_memberships[\s\S]*catalogMemberHandoffEmails/, "Handoff recipients are not resolved from active operational-team memberships");
assert.match(edge, /updateOwnProfileOperation[\s\S]*organization_member_notification_preferences[\s\S]*onConflict: "organization_id,member_id"/, "Profile updates do not dual-write normalized notification preferences");
assert.match(edge, /upsertOrganizationTeamOperation[\s\S]*"admin\.upsertTeam"/, "Team administration Edge operation is missing");
for (const indexName of [
  "catalog_asset_reviews_work_item_fk_idx",
  "catalog_creative_directions_created_by_fk_idx",
  "catalog_work_item_comments_work_item_fk_idx",
  "catalog_work_item_events_actor_fk_idx",
  "catalog_work_item_events_asset_version_fk_idx",
  "catalog_work_item_events_stage_code_fk_idx",
  "catalog_work_item_external_sources_work_item_fk_idx",
  "catalog_work_items_created_by_fk_idx",
  "catalog_work_items_generation_owner_fk_idx",
  "catalog_work_items_listing_owner_fk_idx",
  "catalog_work_items_planning_batch_fk_idx",
]) assert.match(migration, new RegExp(indexName), `Missing production-advisor index ${indexName}`);

for (const operation of [
  "catalogProduction.workflow.get",
  "catalogProduction.update",
  "catalogProduction.comment",
  "catalogProduction.reviewPose",
  "catalogProduction.regeneratePose",
  "catalogProduction.startListing",
  "catalogProduction.handoffs.admin",
  "catalogProduction.handoffs.updateSettings",
  "catalogProduction.handoffs.send",
]) assert.match(edge, new RegExp(operation.replaceAll(".", "\\.")), `Missing Edge operation ${operation}`);

assert.match(edge, /if \(!context\.rows\.length\)/, "Empty handoff emails are not prevented");
assert.match(edge, /previousBusinessDate/, "Business-day cutoff is not used");
assert.match(edge, /catalog_report_delivery_attempts/, "Delivery attempts are not recorded");
assert.match(edge, /Idempotency-Key/, "Email-provider idempotency is missing");
assert.match(edge, /upsert\(deliveryItems, \{ onConflict: "handoff_id", ignoreDuplicates: true \}\)/, "A failed delivery cannot safely reuse its handoff reservation");
assert.match(edge, /reservationIsCurrent[\s\S]*approval_state_changed/, "Handoff approval state is not revalidated immediately before email delivery");
assert.match(edge, /catalog_handoff_email !== false/, "Member handoff-email preferences are not enforced");
assert.match(edge, /workspaceFor\(request, "catalog\.handoff\.manage"\)/, "Handoff administration is not protected by its granular permission");
assert.match(edge, /workspaceFor\(request, "catalog\.assign"\)/, "Assignment is not protected by its granular permission");
assert.match(edge, /assertActiveCatalogMembers[\s\S]*Every catalog owner must be an active member of this workspace/, "Catalog creation does not validate owners against the active organization");
assert.match(edge, /assertCatalogEvent[\s\S]*campaign event does not belong to this workspace/, "Catalog creation does not validate campaign ownership");
assert.match(edge, /existingSkus\.add\(normalizedSku\)[\s\S]*clean\.push\(variant\)/, "Bulk catalog creation does not reject duplicate SKUs within the same request");
assert.match(migration, /'catalog\.assign'[\s\S]*'catalog\.handoff\.manage'[\s\S]*'catalog\.listing\.complete'/, "Granular catalog permissions are not provisioned");
assert.match(migration, /role\.slug = 'listing-team'[\s\S]*'planning\.approve'[\s\S]*'planning\.manage'/, "Legacy Listing Team over-privilege is not removed");
assert.match(catalogApi, /decision === "rejected" && !comments/, "QC rejection comments are not required");
assert.match(catalogApi, /\[1, 2, 3, 4, 5\]\.some\(\(poseIndex\) => !completedPoseIndexes\.has\(poseIndex\)\)/, "Five completed pose versions are not required for approval");
assert.match(catalogApi, /export async function reviewCatalogPose[\s\S]*related_asset_version_id/, "Per-pose approval/rejection is not implemented and linked to activity history");
assert.match(catalogApi, /latestVersion\.id !== assetVersionId[\s\S]*Only the latest version of a pose can be reviewed/, "Historical pose versions can still be reviewed as current");
assert.match(catalogApi, /approval_status === "rejected"[\s\S]*must be regenerated or approved/, "Final set approval does not block a rejected latest pose");
assert.match(catalogApi, /has already been handed to the Listing Team and is immutable/, "A delivered final approval can still be reopened in place");
assert.match(catalogApi, /catalog_listing_handoffs"\)\.update\(\{ status: "superseded"/, "Rejected approvals do not invalidate the pending Listing Team handoff");
assert.match(edge, /Request changes on the approved pose before starting re-generation/, "Approved poses can be regenerated without an explicit review decision");
assert.match(catalogApi, /\.eq\("listing_status", "in_progress"\)[\s\S]*\.not\("listing_sent_at", "is", null\)[\s\S]*\.not\("listing_started_at", "is", null\)/, "Listing completion does not enforce the sent-and-started transition");
assert.doesNotMatch(productionTable, /listing_status === "pending" && !item\.listing_sent_at/, "Table still exposes Listing Done before handoff/start");
assert.doesNotMatch(productionBoard, /listing_status === "pending" && !item\.listing_sent_at/, "Kanban still exposes Listing Done before handoff/start");
assert.match(handoffAdmin, /recipientTeamId[\s\S]*data\.recipientTeams/, "Handoff administrator cannot choose an operational recipient team");
assert.match(handoffAdmin, /type="submit"[\s\S]*Save handoff settings/, "Handoff settings save control is not wired to form submission");
assert.match(admin, /api\.admin\.upsertTeam[\s\S]*tab === "teams"[\s\S]*<TeamEditor/, "Admin console does not provide working team and membership management");
assert.match(admin, /organization-team-editor-title[\s\S]*role="dialog"|role="dialog"[\s\S]*organization-team-editor-title/, "Team editor is not exposed as an accessible modal dialog");
assert.match(backend, /upsertTeam: "admin\.upsertTeam"[\s\S]*invokeAppApi\("admin\.upsertTeam"/, "Frontend team mutation is not connected to the Edge API");
assert.match(catalogProduction, /<ActionDialog[\s\S]*confirmImport/, "Spreadsheet dry-run results are not confirmed in the in-app dialog");
assert.match(catalogProduction, /planning_batch:planning_batches!planning_batch_id[\s\S]*filters\.batch === "all"[\s\S]*All batches/, "Catalog Production is missing its database-backed batch filter");
assert.match(actionDialog, /role="dialog"[\s\S]*aria-modal="true"/, "Workflow action dialogs are not exposed accessibly");
assert.match(layout, /catalogAssignmentsInApp[\s\S]*catalogHandoffEmail/, "Member notification preferences are not configurable");
assert.match(flow, /data\.stages/, "Flow View is not data-driven");
assert.match(stageTimeline, /duration belongs to `from_status`[\s\S]*completedDuration \+ liveDuration/, "Stage timing does not attribute and total repeated stage visits correctly");
assert.match(flow, /Completed \$\{dateTime\(stage\.completedAt\)\}/, "Completed workflow stages do not show their completion timestamp");
assert.match(flow, /Workflow started:[\s\S]*Generation completed:/, "Flow View does not expose workflow and generation timing boundaries");
assert.doesNotMatch(flow, /const\s+stages\s*=\s*\[/, "Flow View contains static stage fixtures");
assert.doesNotMatch([flow, catalogProduction, handoffAdmin, planning, studio, history].join("\n"), /window\.(?:prompt|confirm)/, "Catalog workflow still relies on unpolished browser prompt controls");
assert.match(planning, /<ActionDialog[\s\S]*confirmPendingAction/, "Catalog Planning destructive actions do not use the accessible action dialog");
assert.match(studio, /<ActionDialog[\s\S]*stopSubmittedJob/, "Studio cancellation does not use the accessible action dialog");
assert.match(history, /<ActionDialog[\s\S]*confirmPendingAction/, "History stop, retry, and delete actions do not use the accessible action dialog");

console.log(`Catalog Workflow V2 contract verified: ${stageCodes.length} stages, ${tenantTables.length} tenant tables, live actions, five-pose approval, and idempotent handoff checks.`);
