import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { fetchFastApiWithRetry } from "../lib/fastApiClient.ts";

Deno.test("fetchFastApiWithRetry retries 502/503 cold starts and returns on recovery", async () => {
  let calls = 0;
  const delays: number[] = [];

  const response = await fetchFastApiWithRetry({
    baseUrl: "https://fastapi-production-example.up.railway.app/",
    path: "/api/v1/dna/extract",
    retryDelayMs: [10, 20],
    sleepFn: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
    fetchFn: () => {
      calls += 1;
      if (calls === 1) return Promise.resolve(new Response("sleeping", { status: 503 }));
      if (calls === 2) return Promise.reject(new Error("connection reset during wake"));
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    },
  });

  assertEquals(calls, 3);
  assertEquals(delays, [10, 20]);
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.ok, true);
});

Deno.test("fetchFastApiWithRetry does not retry non-transient 401 or POST TimeoutError/504", async () => {
  let calls = 0;
  const response = await fetchFastApiWithRetry({
    baseUrl: "https://fastapi-production-example.up.railway.app",
    path: "api/v1/workflows/overview",
    sleepFn: () => Promise.resolve(),
    fetchFn: () => {
      calls += 1;
      return Promise.resolve(new Response("unauthorized", { status: 401 }));
    },
  });
  assertEquals(calls, 1);
  assertEquals(response.status, 401);
  await response.body?.cancel();

  let postCalls = 0;
  await assertRejects(
    async () => {
      await fetchFastApiWithRetry({
        baseUrl: "https://fastapi-production-example.up.railway.app",
        path: "/api/v1/dna/extract",
        init: { method: "POST", body: "{}" },
        sleepFn: () => Promise.resolve(),
        fetchFn: () => {
          postCalls += 1;
          return Promise.reject(new DOMException("Timed out", "TimeoutError"));
        },
      });
    },
  );
  assertEquals(postCalls, 1);
});

Deno.test("fetchFastApiWithRetry validates baseUrl and respects aborted caller signal", async () => {
  await assertRejects(
    async () => {
      await fetchFastApiWithRetry({
        baseUrl: "",
        path: "/api/v1/dna/sku-1",
      });
    },
    Error,
    "Invalid FastAPI baseUrl",
  );

  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assertRejects(
    async () => {
      await fetchFastApiWithRetry({
        baseUrl: "https://fastapi-production-example.up.railway.app",
        path: "/api/v1/dna/sku-1",
        init: { signal: controller.signal },
        fetchFn: () => {
          calls += 1;
          return Promise.resolve(new Response("ok"));
        },
      });
    },
    DOMException,
  );
  assertEquals(calls, 0);
});
