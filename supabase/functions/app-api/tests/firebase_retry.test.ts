import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { firebaseFetchWithRetry } from "../lib/firebase-admin.ts";

Deno.test("firebaseFetchWithRetry recovers from transient 503, 401, and network errors without retrying 404", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let transientCalls = 0;
    globalThis.fetch = (() => {
      transientCalls += 1;
      if (transientCalls === 1) {
        return Promise.reject(new TypeError("Connection reset by peer"));
      }
      if (transientCalls === 2) {
        return Promise.resolve(new Response("temporarily unavailable", { status: 503 }));
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as typeof fetch;

    const okResponse = await firebaseFetchWithRetry("https://storage.googleapis.com/test", () => ({ method: "GET" }));
    assertEquals(okResponse.status, 200);
    assertEquals(await okResponse.text(), "ok");
    assertEquals(transientCalls, 3);

    let authCalls = 0;
    const seenAuthHeaders: string[] = [];
    globalThis.fetch = ((_input, init) => {
      authCalls += 1;
      seenAuthHeaders.push(String((init?.headers as Record<string, string>)?.Authorization ?? ""));
      if (authCalls === 1) {
        return Promise.resolve(new Response("expired token", { status: 401 }));
      }
      return Promise.resolve(new Response("refreshed", { status: 200 }));
    }) as typeof fetch;

    const refreshedResponse = await firebaseFetchWithRetry(
      "https://storage.googleapis.com/auth-test",
      () => ({ method: "GET", headers: { Authorization: `Bearer token-${authCalls + 1}` } }),
      { invalidateTokenOn401: true },
    );
    assertEquals(refreshedResponse.status, 200);
    assertEquals(await refreshedResponse.text(), "refreshed");
    assertEquals(authCalls, 2);
    assertEquals(seenAuthHeaders, ["Bearer token-1", "Bearer token-2"]);

    let unrefreshed401Calls = 0;
    globalThis.fetch = (() => {
      unrefreshed401Calls += 1;
      return Promise.resolve(new Response("unauthorized", { status: 401 }));
    }) as typeof fetch;

    const unrefreshed401 = await firebaseFetchWithRetry("https://storage.googleapis.com/no-refresh", () => ({ method: "GET" }));
    assertEquals(unrefreshed401.status, 401);
    assertEquals(await unrefreshed401.text(), "unauthorized");
    assertEquals(unrefreshed401Calls, 1);

    let exhausted503Calls = 0;
    globalThis.fetch = (() => {
      exhausted503Calls += 1;
      return Promise.resolve(new Response("still unavailable", { status: 503 }));
    }) as typeof fetch;

    const exhausted503 = await firebaseFetchWithRetry(
      "https://storage.googleapis.com/exhaust-503",
      () => ({ method: "GET" }),
      { maxAttempts: 2 },
    );
    assertEquals(exhausted503.status, 503);
    assertEquals(await exhausted503.text(), "still unavailable");
    assertEquals(exhausted503Calls, 2);

    let exhaustedErrCalls = 0;
    globalThis.fetch = (() => {
      exhaustedErrCalls += 1;
      return Promise.reject(new TypeError("Socket hangup"));
    }) as typeof fetch;

    await assertRejects(
      () =>
        firebaseFetchWithRetry(
          "https://storage.googleapis.com/exhaust-err",
          () => ({ method: "GET" }),
          { maxAttempts: 2 },
        ),
      TypeError,
      "Socket hangup",
    );
    assertEquals(exhaustedErrCalls, 2);

    let notFoundCalls = 0;
    globalThis.fetch = (() => {
      notFoundCalls += 1;
      return Promise.resolve(new Response("missing", { status: 404 }));
    }) as typeof fetch;

    const missingResponse = await firebaseFetchWithRetry("https://storage.googleapis.com/missing", () => ({ method: "GET" }));
    assertEquals(missingResponse.status, 404);
    assertEquals(await missingResponse.text(), "missing");
    assertEquals(notFoundCalls, 1);

    let abortedCalls = 0;
    const abortController = new AbortController();
    globalThis.fetch = (() => {
      abortedCalls += 1;
      abortController.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }) as typeof fetch;

    await assertRejects(
      () =>
        firebaseFetchWithRetry(
          "https://storage.googleapis.com/aborted",
          () => ({ method: "GET" }),
          { maxAttempts: 3, signal: abortController.signal },
        ),
      DOMException,
      "Aborted",
    );
    assertEquals(abortedCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
