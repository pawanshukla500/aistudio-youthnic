import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the authenticated live workflow verification.`);
  return value;
};

const supabaseUrl = required("SUPABASE_URL").replace(/\/$/, "");
const publishableKey = required("SUPABASE_PUBLISHABLE_KEY");
const workItemId = required("CATALOG_TEST_WORK_ITEM_ID");
const invalidId = "00000000-0000-4000-8000-000000000000";
const actors = {
  manager: { token: required("CATALOG_TEST_MANAGER_JWT"), role: process.env.CATALOG_TEST_MANAGER_ROLE || "planning-manager" },
  generator: { token: required("CATALOG_TEST_GENERATOR_JWT"), role: process.env.CATALOG_TEST_GENERATOR_ROLE || "creative-team" },
  reviewer: { token: required("CATALOG_TEST_REVIEWER_JWT"), role: process.env.CATALOG_TEST_REVIEWER_ROLE || "review-team" },
  listing: { token: required("CATALOG_TEST_LISTING_JWT"), role: process.env.CATALOG_TEST_LISTING_ROLE || "listing-team" },
  viewer: { token: required("CATALOG_TEST_VIEWER_JWT"), role: process.env.CATALOG_TEST_VIEWER_ROLE || "viewer" },
  otherOrg: { token: required("CATALOG_TEST_OTHER_ORG_JWT"), role: process.env.CATALOG_TEST_OTHER_ORG_ROLE || "viewer" },
};

function headers(token, extra = {}) {
  return { apikey: publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extra };
}

function storageClient(actor) {
  return createClient(supabaseUrl, publishableKey, {
    accessToken: async () => actor.token,
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function responseJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return { raw: text }; }
}

async function rest(actor, path, options = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, { ...options, headers: headers(actor.token, options.headers) });
  return { response, body: await responseJson(response) };
}

async function appApi(actor, operation, args = {}) {
  return rest(actor, "/functions/v1/app-api", { method: "POST", body: JSON.stringify({ operation, args }) });
}

function errorText(result) {
  return String(result.body?.error || result.body?.message || result.body?.raw || "");
}

async function workspace(actor, name) {
  const result = await rest(actor, "/rest/v1/rpc/app_current_workspace", { method: "POST", body: "{}" });
  assert.equal(result.response.ok, true, `${name} workspace bootstrap failed: ${errorText(result)}`);
  assert.ok(result.body?.organization?.id && result.body?.member?.id, `${name} has no active workspace membership.`);
  const roleSlugs = (result.body.roles || []).map((role) => role.slug);
  assert.ok(roleSlugs.includes(actor.role), `${name} must have the ${actor.role} role; found ${roleSlugs.join(", ") || "none"}.`);
  return result.body;
}

async function expectAllowedUntilFixtureLookup(actor, operation, args, label) {
  const result = await appApi(actor, operation, args);
  const message = errorText(result);
  assert.doesNotMatch(message, /permission required|only the listing team|do not have permission/i, `${label} was rejected by authorization: ${message}`);
  return result;
}

async function expectDenied(actor, operation, args, label) {
  const result = await appApi(actor, operation, args);
  assert.equal(result.response.ok, false, `${label} unexpectedly succeeded.`);
  assert.match(errorText(result), /permission required|only the listing team|do not have permission/i, `${label} did not fail at the permission boundary.`);
}

const workspaces = {};
for (const [name, actor] of Object.entries(actors)) workspaces[name] = await workspace(actor, name);
const primaryOrg = String(workspaces.manager.organization.id);
for (const name of ["generator", "reviewer", "listing", "viewer"]) {
  assert.equal(String(workspaces[name].organization.id), primaryOrg, `${name} must belong to the manager test organization.`);
}
assert.notEqual(String(workspaces.otherOrg.organization.id), primaryOrg, "The cross-tenant actor must belong to another organization.");

for (const name of ["manager", "generator", "reviewer", "listing", "viewer"]) {
  const result = await appApi(actors[name], "catalogProduction.workflow.get", { workItemId });
  assert.equal(result.response.ok, true, `${name} cannot read the live workflow: ${errorText(result)}`);
  assert.equal(String(result.body?.data?.item?.id), workItemId, `${name} received the wrong workflow item.`);
}
const hiddenWorkflow = await appApi(actors.otherOrg, "catalogProduction.workflow.get", { workItemId });
assert.equal(hiddenWorkflow.response.ok, false, "A user in another organization can read the workflow through the Edge API.");
assert.match(errorText(hiddenWorkflow), /not found/i, "Cross-tenant Edge access did not resolve to not-found.");

const ownRest = await rest(actors.viewer, `/rest/v1/catalog_work_items?select=id&id=eq.${encodeURIComponent(workItemId)}`);
assert.equal(ownRest.response.ok, true, `Tenant Data API read failed: ${errorText(ownRest)}`);
assert.equal(ownRest.body?.length, 1, "The same-tenant work item is not visible through RLS.");
const foreignRest = await rest(actors.otherOrg, `/rest/v1/catalog_work_items?select=id&id=eq.${encodeURIComponent(workItemId)}`);
assert.equal(foreignRest.response.ok, true, `Cross-tenant Data API probe failed unexpectedly: ${errorText(foreignRest)}`);
assert.deepEqual(foreignRest.body, [], "Cross-tenant RLS exposed a catalog work item.");

await expectAllowedUntilFixtureLookup(actors.manager, "catalogProduction.assign", { workItemId: invalidId, assignment: "generation", memberId: "" }, "manager assignment");
await expectAllowedUntilFixtureLookup(actors.manager, "catalogProduction.handoffs.admin", {}, "manager handoff administration");
await expectAllowedUntilFixtureLookup(actors.generator, "catalogProduction.bulkGenerate", { workItemIds: [invalidId] }, "generator retry");
await expectAllowedUntilFixtureLookup(actors.reviewer, "catalogProduction.reviewPose", { workItemId: invalidId, assetVersionId: invalidId, decision: "approved", comments: "permission probe" }, "reviewer pose decision");
await expectAllowedUntilFixtureLookup(actors.listing, "catalogProduction.startListing", { workItemId: invalidId }, "Listing Team transition");

for (const [operation, args] of [
  ["catalogProduction.assign", { workItemId: invalidId, assignment: "generation", memberId: "" }],
  ["catalogProduction.bulkGenerate", { workItemIds: [invalidId] }],
  ["catalogProduction.reviewPose", { workItemId: invalidId, assetVersionId: invalidId, decision: "approved", comments: "permission probe" }],
  ["catalogProduction.handoffs.admin", {}],
  ["catalogProduction.startListing", { workItemId: invalidId }],
]) await expectDenied(actors.viewer, operation, args, `viewer ${operation}`);

const directMutation = await rest(actors.manager, "/rest/v1/catalog_work_item_comments", {
  method: "POST",
  headers: { Prefer: "return=minimal" },
  body: JSON.stringify({ organization_id: primaryOrg, work_item_id: workItemId, body: "direct write probe" }),
});
assert.equal(directMutation.response.ok, false, "Authenticated browser clients can insert server-owned workflow rows directly.");
assert.ok([401, 403].includes(directMutation.response.status), `Direct mutation failed for an unexpected reason (${directMutation.response.status}).`);

const foreignStorage = await rest(actors.manager, "/storage/v1/object/list/catalog-assets", {
  method: "POST",
  body: JSON.stringify({ prefix: `${workspaces.otherOrg.organization.id}/`, limit: 10, offset: 0 }),
});
assert.equal(foreignStorage.response.ok, true, `Storage RLS probe failed unexpectedly: ${errorText(foreignStorage)}`);
assert.deepEqual(foreignStorage.body, [], "Tenant-prefixed Storage RLS exposed another organization's objects.");

const managerStorage = storageClient(actors.manager).storage.from("catalog-assets");
const viewerStorage = storageClient(actors.viewer).storage.from("catalog-assets");
const otherOrgStorage = storageClient(actors.otherOrg).storage.from("catalog-assets");
const acceptancePath = `${primaryOrg}/acceptance/${crypto.randomUUID()}.png`;
const pixel = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
try {
  const firstUpload = await managerStorage.upload(acceptancePath, pixel, { contentType: "image/png", upsert: false });
  assert.equal(firstUpload.error, null, `Same-tenant Storage upload failed: ${firstUpload.error?.message || "unknown error"}`);
  const upsert = await managerStorage.upload(acceptancePath, pixel, { contentType: "image/png", upsert: true });
  assert.equal(upsert.error, null, `Same-tenant Storage upsert failed: ${upsert.error?.message || "unknown error"}`);
  const ownDownload = await viewerStorage.download(acceptancePath);
  assert.equal(ownDownload.error, null, `Same-tenant Storage read failed: ${ownDownload.error?.message || "unknown error"}`);
  assert.ok(ownDownload.data && ownDownload.data.size > 0, "Same-tenant Storage read returned no bytes.");
  const viewerUpload = await viewerStorage.upload(`${primaryOrg}/acceptance/${crypto.randomUUID()}.png`, pixel, { contentType: "image/png", upsert: false });
  assert.ok(viewerUpload.error, "A read-only workspace member uploaded a catalog object.");
  const viewerDelete = await viewerStorage.remove([acceptancePath]);
  assert.ok(viewerDelete.error, "A read-only workspace member deleted a catalog object.");
  const crossTenantDownload = await otherOrgStorage.download(acceptancePath);
  assert.ok(crossTenantDownload.error, "A user in another organization downloaded the acceptance object.");
  const crossTenantUpload = await otherOrgStorage.upload(`${primaryOrg}/acceptance/${crypto.randomUUID()}.png`, pixel, { contentType: "image/png", upsert: false });
  assert.ok(crossTenantUpload.error, "A user in another organization uploaded into the primary tenant prefix.");
} finally {
  const cleanup = await managerStorage.remove([acceptancePath]);
  assert.equal(cleanup.error, null, `Acceptance Storage cleanup failed: ${cleanup.error?.message || "unknown error"}`);
}

const notificationRows = await rest(actors.viewer, "/rest/v1/notifications?select=recipient_member_id,recipient_team,recipient_email&limit=200");
assert.equal(notificationRows.response.ok, true, `Notification RLS probe failed: ${errorText(notificationRows)}`);
const viewerRoles = new Set((workspaces.viewer.roles || []).map((role) => String(role.slug)));
for (const row of notificationRows.body || []) {
  const directlyAddressed = row.recipient_member_id === workspaces.viewer.member.id;
  const roleAddressed = !row.recipient_member_id && row.recipient_team && viewerRoles.has(String(row.recipient_team));
  const emailAddressed = !row.recipient_member_id && !row.recipient_team && row.recipient_email && String(row.recipient_email).toLowerCase() === String(workspaces.viewer.member.email).toLowerCase();
  const broadcast = !row.recipient_member_id && !row.recipient_team && !row.recipient_email;
  assert.ok(directlyAddressed || roleAddressed || emailAddressed || broadcast, "Notification RLS exposed a row addressed to another member or team.");
}

console.log("Live Catalog Workflow verification passed: six roles, cross-tenant RLS, action authorization, server-owned writes, notification targeting, and tenant-safe Storage upload/upsert/read/delete.");
