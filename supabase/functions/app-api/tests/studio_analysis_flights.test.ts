import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  ANALYSIS_REATTACH_GRACE_MS,
  ANALYSIS_RESULT_HOLD_MS,
  createAnalysisFlights,
} from "../lib/studioAnalysisFlights.ts";
import {
  ANALYZE_TOO_LONG_MESSAGE,
  STUDIO_ANALYZE_TOTAL_WAIT_MS,
  analyzeUntilSettled,
} from "../../../../src/lib/analysisPending.ts";

type Result = { id: number };

function deferred() {
  let resolve!: (value: Result) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Result>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const live = () => new AbortController().signal;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

Deno.test("a duplicate analysis joins the flight in progress: one run per input set", async () => {
  const flights = createAnalysisFlights<Result>();
  const work = deferred();
  let runs = 0;
  const run = () => (runs += 1, work.promise);
  const first = flights.acquire("org:p:r:v", "org", {}, run);
  const second = flights.acquire("org:p:r:v", "org", { discardHeld: true }, run);
  assertEquals(first, second, "a running flight is joined, even by a forceRefresh");
  const waits = [flights.wait(first, live(), Date.now() + 5_000), flights.wait(second, live(), Date.now() + 5_000)];
  work.resolve({ id: 1 });
  assertEquals(await Promise.all(waits), [{ id: 1 }, { id: 1 }]);
  assertEquals(runs, 1);
  assertEquals(flights.size(), 0, "a delivered outcome is not held");
});

Deno.test("past the proxy deadline the request answers pending and the Studio's retry joins the same flight", async () => {
  const flights = createAnalysisFlights<Result>();
  let runs = 0;
  const calls: Record<string, unknown>[] = [];
  // studio.analyze in miniature: each request waits 20ms (standing in for 280s).
  const serve = (args: Record<string, unknown>) => {
    calls.push(args);
    const flight = flights.acquire("org:p:r:v", "org", {
      discardHeld: args.forceRefresh === true && args.resumeAnalysis !== true,
    }, async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 70));
      return { id: runs };
    });
    return flights.wait(flight, live(), Date.now() + 20)
      .then((value) => "analysisPending" in value ? { ...value, retryAfterMs: 5 } : value);
  };
  const result = await analyzeUntilSettled(serve, { forceRefresh: true });
  assertEquals(result, { id: 1 });
  assertEquals(runs, 1, "a forceRefresh analysis is not restarted by its own retries");
  assert(calls.length >= 2, "the first request answered pending");
  assertEquals(calls[0].resumeAnalysis, undefined);
  assert(calls.slice(1).every((args) => args.resumeAnalysis === true && args.forceRefresh === true));
});

Deno.test("an outcome that lands while nobody waits is held for the next call, once", async () => {
  let clock = 1_000;
  const flights = createAnalysisFlights<Result>(() => clock);
  let runs = 0;
  const run = async () => ({ id: ++runs });
  const first = flights.acquire("k", "org", {}, run);
  await first.promise;
  await tick();
  assertEquals(first.settledAt, 1_000);
  const claimed = flights.acquire("k", "org", {}, run);
  assertEquals(claimed, first);
  assertEquals(await flights.wait(claimed, live(), clock + 1_000), { id: 1 });
  assertEquals(runs, 1);
  const fresh = flights.acquire("k", "org", {}, run);
  assert(fresh !== first, "a claimed outcome is gone");
  await fresh.promise;
  assertEquals(runs, 2);
  await tick();
  clock += ANALYSIS_RESULT_HOLD_MS + 1;
  const afterHold = flights.acquire("k", "org", {}, run);
  assert(afterHold !== fresh, "a held outcome expires");
  await afterHold.promise;
  await tick();
  const forced = flights.acquire("k", "org", { discardHeld: true }, run);
  assert(forced !== afterHold, "forceRefresh drops a held outcome");
  assertEquals(await forced.promise, { id: 4 });
});

Deno.test("a failure that lands while nobody waits is reported to the next call, then a retry starts afresh", async () => {
  const flights = createAnalysisFlights<Result>();
  let runs = 0;
  const failing = flights.acquire("k", "org", {}, async () => {
    runs += 1;
    throw new Error("Every configured vision model failed.");
  });
  await failing.promise.catch(() => {});
  await tick();
  const claimed = flights.acquire("k", "org", {}, async () => ({ id: ++runs }));
  await assertRejects(() => flights.wait(claimed, live(), Date.now() + 1_000), Error, "Every configured vision model failed.");
  const retry = flights.acquire("k", "org", {}, async () => ({ id: ++runs }));
  assertEquals(await flights.wait(retry, live(), Date.now() + 1_000), { id: 2 });
});

Deno.test("an abandoned flight is aborted when its organization starts other inputs; a re-attaching one is not", async () => {
  let clock = 0;
  const flights = createAnalysisFlights<Result>(() => clock);
  const never = () => new Promise<Result>(() => {});
  const abandoned = flights.acquire("org:a", "org", {}, never);
  const waitedOn = flights.acquire("org:b", "org", {}, never);
  const otherOrg = flights.acquire("other:a", "other", {}, never);
  const pendingWait = flights.wait(waitedOn, live(), clock);
  assertEquals(await pendingWait, { analysisPending: true, retryAfterMs: 1_000 });
  assertEquals(waitedOn.reattachBy, ANALYSIS_REATTACH_GRACE_MS);
  // A client mid-wait keeps its flight alive too.
  const disconnecting = new AbortController();
  const attached = flights.acquire("org:c", "org", {}, never);
  const attachedWait = flights.wait(attached, disconnecting.signal, clock + 60_000);

  clock = 1_000;
  flights.acquire("org:d", "org", {}, never);
  assert(abandoned.controller.signal.aborted, "nobody waits on it and nobody was told to come back");
  assert(!waitedOn.controller.signal.aborted, "its client was answered pending and is coming back");
  assert(!attached.controller.signal.aborted, "a request is waiting on it");
  assert(!otherOrg.controller.signal.aborted, "another organization's flight is never touched");

  disconnecting.abort();
  assertEquals(await attachedWait, { analysisPending: true, retryAfterMs: 1_000 }, "a disconnect ends the wait, not the flight");
  assert(!attached.controller.signal.aborted);
  assertEquals(attached.reattachBy, 0, "a disconnect is not a promise to come back");
  clock += ANALYSIS_REATTACH_GRACE_MS + 1;
  flights.acquire("org:e", "org", {}, never);
  assert(waitedOn.controller.signal.aborted && attached.controller.signal.aborted);
});

Deno.test("the Studio stops asking after its total wait and on cancel", async () => {
  let clock = 0;
  const pending = async () => {
    clock += STUDIO_ANALYZE_TOTAL_WAIT_MS / 2;
    return { analysisPending: true, retryAfterMs: 0 };
  };
  await assertRejects(() => analyzeUntilSettled(pending, {}, { now: () => clock }), Error, ANALYZE_TOO_LONG_MESSAGE);

  const controller = new AbortController();
  const cancelled = analyzeUntilSettled(async () => ({ analysisPending: true, retryAfterMs: 5_000 }), {}, { signal: controller.signal });
  await tick();
  controller.abort();
  const error = await cancelled.catch((reason) => reason);
  assertEquals((error as DOMException).name, "AbortError");
  assertEquals(await analyzeUntilSettled(async () => ({ id: 7 }), {}), { id: 7 }, "a finished analysis is returned as is");
});
