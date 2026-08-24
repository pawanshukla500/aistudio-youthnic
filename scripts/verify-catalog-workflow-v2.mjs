import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260824130000_catalog_workflow_v2.sql", "utf8");
const edge = await readFile("supabase/functions/app-api/index.ts", "utf8");
const catalogApi = await readFile("supabase/functions/app-api/catalogProduction.ts", "utf8");
const flow = await readFile("src/features/history/generation-flow/OperationalWorkflowView.tsx", "utf8");

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
assert.match(migration, /catalog_pose_asset_versions_current_approved_uidx/, "One-approved-version-per-pose invariant is missing");
assert.match(migration, /catalog_report_delivery_items.*unique \(handoff_id\)/s, "Per-handoff email idempotency is missing");
assert.match(migration, /sync_catalog_pose_asset_version/, "Pose-version synchronization trigger is missing");
assert.match(migration, /freeze_catalog_handoff_on_approval/, "Approval handoff freeze trigger is missing");
assert.match(migration, /'catalog_work_items'[\s\S]*alter publication supabase_realtime add table public\.%I/, "Catalog work items are not published to Realtime");

for (const operation of [
  "catalogProduction.workflow.get",
  "catalogProduction.update",
  "catalogProduction.comment",
  "catalogProduction.regeneratePose",
  "catalogProduction.startListing",
  "catalogProduction.handoffs.admin",
  "catalogProduction.handoffs.updateSettings",
  "catalogProduction.handoffs.send",
]) assert.match(edge, new RegExp(operation.replaceAll(".", "\\.")), `Missing Edge operation ${operation}`);

assert.match(edge, /if \(!context\.rows\.length\)/, "Empty handoff emails are not prevented");
assert.match(edge, /previousBusinessDate/, "Business-day cutoff is not used");
assert.match(edge, /catalog_report_delivery_attempts/, "Delivery attempts are not recorded");
assert.match(catalogApi, /decision === "rejected" && !comments/, "QC rejection comments are not required");
assert.match(catalogApi, /\[1, 2, 3, 4, 5\]\.some\(\(poseIndex\) => !completedPoseIndexes\.has\(poseIndex\)\)/, "Five completed pose versions are not required for approval");
assert.match(flow, /data\.stages/, "Flow View is not data-driven");
assert.doesNotMatch(flow, /const\s+stages\s*=\s*\[/, "Flow View contains static stage fixtures");

console.log(`Catalog Workflow V2 contract verified: ${stageCodes.length} stages, ${tenantTables.length} tenant tables, live actions, five-pose approval, and idempotent handoff checks.`);
