import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  cacheableStyleProfile,
  posePlanTimeoutMs,
  requestGraphPosePlan,
  styleProfileCacheKey,
  wakeFastApi,
  withGraphPosePlanning,
  type FastApiTarget,
} from "../lib/posePlanningClient.ts";
import { ANALYSIS_VERSION, normalizeAnalysis, smallHash, type JsonRecord } from "../lib/profiles.ts";

type Call = { url: string; init: RequestInit };

function fakeTarget(respond: () => Response | Promise<Response>): { target: FastApiTarget; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(respond());
  }) as typeof fetch;
  return { target: { baseUrl: "https://fastapi.test", secret: "s3cret", fetchFn }, calls };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function withWarnings<T>(work: () => Promise<T>): Promise<{ value: T; warnings: string[] }> {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  try {
    return { value: await work(), warnings };
  } finally {
    console.warn = original;
  }
}

const seatedRaw = {
  posture: "seated",
  description: "Seated on a low stool, torso turned slightly, head tilted",
  seatOrSupport: "low wooden stool",
  distinctiveness: "generic",
  attitude: "Quiet, self-assured",
  suitableForProduct: "yes",
  suitabilityReason: "front design stays readable",
};

const kurtiRaw: JsonRecord = {
  productIdentity: { garmentFamily: "kurti", category: "kurti" },
  referencePose: seatedRaw,
  expressionPlan: { energy: "warm" },
};

Deno.test("planner timeout is capped, keeps a save reserve and skips short budgets", () => {
  assertEquals(posePlanTimeoutMs(120_000), 15_000);
  assertEquals(posePlanTimeoutMs(20_000), 10_000);
  assertEquals(posePlanTimeoutMs(15_000), 5_000);
  assertEquals(posePlanTimeoutMs(14_999), 0);
  assertEquals(posePlanTimeoutMs(Number.NaN), 0);
});

Deno.test("style profile cache key covers style references only and skips unsafe cases", () => {
  const style = { role: "style_reference", hash: "style-a", storagePath: "orgs/o/style.jpg" };
  const front = { role: "front", hash: "front-a" };
  const key = styleProfileCacheKey([front, style]);
  assert(/^style:[0-9a-f]{16}:/.test(key));
  assert(key.endsWith(`:${ANALYSIS_VERSION}`));
  // A hit drops the style image, so two photos whose single 32-bit hash collides must still get different keys.
  const [a, b] = ["style-179599", "style-362382"];
  assertEquals(smallHash(`style_reference:${a}`), smallHash(`style_reference:${b}`));
  assert(styleProfileCacheKey([{ role: "style_reference", hash: a }]) !== styleProfileCacheKey([{ role: "style_reference", hash: b }]));
  // A different product with the same style photo reuses the profile.
  assertEquals(styleProfileCacheKey([{ role: "front", hash: "front-b" }, style]), key);
  assert(styleProfileCacheKey([front, { ...style, hash: "style-b" }]) !== key);
  // Scene/model directions shape the room and styling the profile records.
  const scened = styleProfileCacheKey([front, style], { sceneDirection: "plain white  seamless" });
  assert(scened !== key && scened.endsWith(`:${ANALYSIS_VERSION}`));
  assertEquals(styleProfileCacheKey([front, style], { sceneDirection: " plain white seamless " }), scened);
  assert(styleProfileCacheKey([front, style], { modelDirection: "plain white seamless" }) !== scened);
  assertEquals(styleProfileCacheKey([front, style], { sceneDirection: "  ", modelDirection: "" }), key);
  assertEquals(styleProfileCacheKey([front]), "");
  assertEquals(styleProfileCacheKey([front, { role: "style_reference", hash: "" }]), "");
  // The style photo doubles as the model face: it must stay attached.
  assertEquals(styleProfileCacheKey([front, style, { role: "model_identity", hash: "style-a", storagePath: "orgs/o/style.jpg" }]), "");
});

Deno.test("cacheableStyleProfile needs a v36 plan that names a posture", () => {
  const room = { creativeDirection: { backgroundStyle: "warm limewash wall", lighting: "soft window light" } };
  const profile = cacheableStyleProfile(normalizeAnalysis({ ...kurtiRaw, ...room }, "kurti"));
  assertEquals(profile?.referencePose.posture, "seated");
  // Legacy JSON (no referencePose/expressionPlan) and an omitted referencePose both normalize to "none".
  assertEquals(cacheableStyleProfile(normalizeAnalysis({ productIdentity: kurtiRaw.productIdentity, ...room }, "kurti")), null);
  assertEquals(cacheableStyleProfile(normalizeAnalysis({ ...kurtiRaw, ...room, referencePose: undefined }, "kurti")), null);
});

Deno.test("requestGraphPosePlan skips without a target or budget and never throws", async () => {
  const { target, calls } = fakeTarget(() => jsonResponse({ slots: {} }));
  assertEquals(await requestGraphPosePlan(null, {}, 60_000), null);
  assertEquals(await requestGraphPosePlan(target, {}, 14_000), null);
  assertEquals(calls.length, 0);

  for (const respond of [
    () => jsonResponse({ detail: "Pose planning graph failed" }, 503),
    () => jsonResponse(["not", "an", "object"]),
    () => Promise.reject(new Error("connection refused")),
  ]) {
    const failing = fakeTarget(respond);
    const { value, warnings } = await withWarnings(() => requestGraphPosePlan(failing.target, { a: 1 }, 60_000));
    assertEquals(value, null);
    assertEquals(warnings.length, 1);
    assertEquals(failing.calls.length, 1);
  }
});

Deno.test("requestGraphPosePlan posts once with the internal secret", async () => {
  const { target, calls } = fakeTarget(() => jsonResponse({ slots: { creative: { source: "product" } } }));
  const result = await requestGraphPosePlan(target, { organization_id: "org_1" }, 60_000);
  assertEquals(result, { slots: { creative: { source: "product" } } });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "https://fastapi.test/api/v1/plan");
  assertEquals(calls[0].init.method, "POST");
  assertEquals((calls[0].init.headers as Record<string, string>)["x-internal-secret"], "s3cret");
  assertEquals(JSON.parse(String(calls[0].init.body)), { organization_id: "org_1" });
});

Deno.test("wakeFastApi pings /health and swallows failures", async () => {
  await wakeFastApi(null);
  const { target, calls } = fakeTarget(() => new Response("ok"));
  await wakeFastApi(target);
  assertEquals(calls.map((call) => call.url), ["https://fastapi.test/health"]);
  await wakeFastApi(fakeTarget(() => Promise.reject(new Error("down"))).target);
});

Deno.test("withGraphPosePlanning merges the planner answer over the same vision JSON", async () => {
  const local = normalizeAnalysis(kurtiRaw, "kurti");
  assertEquals(local.posePlanning!.planner, "local");
  const { target, calls } = fakeTarget(() => jsonResponse({
    slots: { creative: { source: "product", rationale: "learned penalty" }, showcase: { source: "product" } },
    expressions: { full_front: "Soft direct gaze" },
    thread_id: "thread_plan_org_1_fp1",
  }));
  const merged = await withGraphPosePlanning({
    target, normalized: local, rawAnalysis: kurtiRaw, category: "kurti", options: {},
    organizationId: "org_1", threadKey: "fp1", remainingBudgetMs: 60_000,
  });
  const body = JSON.parse(String(calls[0].init.body));
  assertEquals(body.organization_id, "org_1");
  assertEquals(body.thread_key, "fp1");
  assertEquals(body.reference_pose.posture, "seated");
  assertEquals([body.sit_requested, body.closeup_mode], [false, "face_and_detail"]);
  assertEquals(Object.keys(body.pose_expressions).length, 6);
  assertEquals(merged.posePlanning!.planner, "langgraph");
  assertEquals(merged.posePlanning!.threadId, "thread_plan_org_1_fp1");
  assertEquals(merged.posePlanning!.slots.creative.source, "product");
  assertEquals(merged.posePlan[0].expression, "Soft direct gaze");
});

Deno.test("withGraphPosePlanning keeps legacy and failed plans, and the Farshi guard sees the bottom photo", async () => {
  const legacy = normalizeAnalysis({ productIdentity: { garmentFamily: "kurti" } }, "kurti");
  const unused = fakeTarget(() => jsonResponse({}));
  const args = { rawAnalysis: kurtiRaw, category: "kurti", options: {}, organizationId: "org_1", threadKey: "fp1", remainingBudgetMs: 60_000 };
  assertEquals(await withGraphPosePlanning({ ...args, target: unused.target, normalized: legacy }), legacy);
  assertEquals(unused.calls.length, 0);

  const local = normalizeAnalysis(kurtiRaw, "kurti");
  const failing = fakeTarget(() => jsonResponse({}, 503));
  const { value } = await withWarnings(() => withGraphPosePlanning({ ...args, target: failing.target, normalized: local }));
  assertEquals(value, local);

  // An unclassified cut with a bottom photo is generated as Farshi, so an adoption is re-blocked.
  const setRaw: JsonRecord = { ...kurtiRaw, productIdentity: { garmentFamily: "kurta_or_kurti_set", category: "kurta set" } };
  const options = { hasBottomReference: true };
  const adopting = fakeTarget(() => jsonResponse({ slots: { creative: { source: "reference" }, showcase: { source: "reference" } } }));
  const guarded = await withGraphPosePlanning({
    ...args, rawAnalysis: setRaw, category: "kurta set", options, target: adopting.target,
    normalized: normalizeAnalysis(setRaw, "kurta set", options),
  });
  assertEquals(JSON.parse(String(adopting.calls[0].init.body)).bottom_cut_class, "farshi");
  assertEquals(guarded.posePlanning!.slots.creative.source, "product");
});
