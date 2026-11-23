import { assertEquals } from "jsr:@std/assert@1";
import {
  OUT_OF_CREDITS_MESSAGE,
  VERIFY_EMAIL_MESSAGE,
  canApproveRecharges,
  isExternalSeller,
  sellerShootGate,
  tokenClaims,
} from "../lib/sellerAccess.ts";
import { PACKS, TRIAL_SKUS } from "../../../../src/lib/pricingPacks.ts";

const read = (path: string) =>
  Deno.readTextFileSync(new URL(path, import.meta.url)).replace(/\r\n/g, "\n");

const migration = read("../../../migrations/20261123100000_trial_one_shoot_and_credit_recharges.sql");
const indexSource = read("../index.ts");

const token = (payload: Record<string, unknown>) =>
  `Bearer header.${btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.signature`;

Deno.test("an internal organization is never charged or blocked, verified email or not", () => {
  for (const settings of [undefined, null, {}, { seller_type: "internal" }, { plan: "trial" }]) {
    for (const claims of [{}, { email_verified: false }, { email_verified: true }]) {
      assertEquals(sellerShootGate({ settings, claims }), { charge: false, error: null });
    }
    assertEquals(isExternalSeller(settings), false);
  }
});

Deno.test("a seller store is charged one credit only after its email is verified", () => {
  const settings = { seller_type: "external", plan: "trial" };
  assertEquals(sellerShootGate({ settings, claims: {} }), { charge: false, error: VERIFY_EMAIL_MESSAGE });
  assertEquals(sellerShootGate({ settings, claims: { email_verified: false } }), { charge: false, error: VERIFY_EMAIL_MESSAGE });
  // Only the boolean claim Firebase issues counts, not a look-alike string.
  assertEquals(sellerShootGate({ settings, claims: { email_verified: "true" } }), { charge: false, error: VERIFY_EMAIL_MESSAGE });
  assertEquals(sellerShootGate({ settings, claims: { email_verified: true } }), { charge: true, error: null });
});

Deno.test("token claims are read from the bearer token and a malformed token yields none", () => {
  assertEquals(tokenClaims(token({ sub: "uid-1", email_verified: true })), { sub: "uid-1", email_verified: true });
  assertEquals(tokenClaims(token({ email: "ünï@store.in", email_verified: false })).email_verified, false);
  assertEquals(tokenClaims(""), {});
  assertEquals(tokenClaims("Bearer not-a-jwt"), {});
  assertEquals(tokenClaims("Bearer a.%%%.c"), {});
  assertEquals(tokenClaims(`Bearer a.${btoa('"just a string"')}.c`), {});
});

Deno.test("only administrators of the primary organization approve recharges", () => {
  const primary = { is_primary: true, settings: {} };
  const store = { is_primary: false, settings: { seller_type: "external" } };
  assertEquals(canApproveRecharges({ organization: primary, isAdmin: true, permissions: [] }), true);
  assertEquals(canApproveRecharges({ organization: primary, isAdmin: false, permissions: ["admin.settings"] }), true);
  assertEquals(canApproveRecharges({ organization: primary, isAdmin: false, permissions: ["studio.generate"] }), false);
  // A seller is the administrator of its own store: that must not let it approve its own recharge.
  assertEquals(canApproveRecharges({ organization: store, isAdmin: true, permissions: ["admin.settings"] }), false);
  assertEquals(canApproveRecharges({ organization: {}, isAdmin: true, permissions: [] }), false);
});

Deno.test("the SQL price list equals the packs the app shows, and new stores get one trial shoot", () => {
  const list = migration.match(/from \(values ([^\n]+)\) as pack\(skus, amount_inr\)/)?.[1] || "";
  const sqlPacks = [...list.matchAll(/\((\d+), (\d+)\)/g)].map((match) => [Number(match[1]), Number(match[2])]);
  assertEquals(sqlPacks, PACKS.map((pack) => [pack.skus, pack.price]));

  assertEquals(TRIAL_SKUS, 1);
  const enroll = migration.slice(
    migration.indexOf("create or replace function public.app_enroll_seller("),
    migration.indexOf("revoke all on function public.app_enroll_seller"),
  );
  // credits and trial_credits_allocated, straight after is_primary = false
  assertEquals(enroll.includes("    false,\n    1,\n    1,\n"), true);
  assertEquals(enroll.includes("'seller_type', 'external'"), true);
});

Deno.test("a recharge is server-only, approved once, and credits follow the paid row", () => {
  assertEquals(migration.includes("alter table public.credit_recharges enable row level security;"), true);
  assertEquals(migration.includes("revoke all on public.credit_recharges from public, anon, authenticated;"), true);
  for (const signature of ["app_request_credit_recharge(uuid, uuid, integer)", "app_approve_credit_recharge(uuid, uuid, text, text)"]) {
    assertEquals(migration.includes(`revoke all on function public.${signature} from public, anon, authenticated;`), true);
    assertEquals(migration.includes(`grant execute on function public.${signature} to service_role;`), true);
  }
  const approve = migration.slice(migration.indexOf("create or replace function public.app_approve_credit_recharge("));
  const marked = approve.indexOf("and status = 'requested'");
  const bail = approve.indexOf("if not found then");
  const credited = approve.indexOf("set credits = credits + v_row.pack_skus");
  // The paid mark is conditional, a second call returns before the balance changes.
  assertEquals(marked > 0 && bail > marked && credited > bail, true);
  assertEquals(migration.includes("where status = 'requested';"), true);
});

Deno.test("the edge function gates a shoot through sellerShootGate and never trusts client ids for recharges", () => {
  assertEquals(indexSource.includes("const shootGate = sellerShootGate({"), true);
  assertEquals(indexSource.includes("if (shootGate.charge) {"), true);
  assertEquals(indexSource.includes("throw new Error(OUT_OF_CREDITS_MESSAGE);"), true);
  assertEquals(indexSource.includes("5 free photoshoot trial limit"), false);
  assertEquals(OUT_OF_CREDITS_MESSAGE.includes("Credits"), true);

  for (const operation of ["admin.recharges.list", "admin.recharges.approve", "billing.overview", "billing.requestRecharge", "billing.cancelRecharge"]) {
    assertEquals(indexSource.includes(`"${operation}": () =>`), true);
  }
  const recharge = indexSource.slice(
    indexSource.indexOf("async function requestRechargeOperation("),
    indexSource.indexOf("async function adminOverview("),
  );
  // Organization and member come from the verified workspace; the only client inputs are a pack size and a row id.
  assertEquals(recharge.includes("p_org_id: workspace.organization.id"), true);
  assertEquals(recharge.includes("p_member_id: workspace.member.id"), true);
  assertEquals(recharge.includes("p_approved_by: workspace.member.id"), true);
  assertEquals(recharge.includes('.eq("organization_id", workspace.organization.id)'), true);
  assertEquals(/args\.(organizationId|orgId|amount|price|credits)/.test(recharge), false);
  assertEquals(recharge.match(/await rechargeApproverFor\(request\)/g)?.length, 2);
});
