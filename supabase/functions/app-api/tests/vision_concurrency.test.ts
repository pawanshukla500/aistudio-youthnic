import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  abortError,
  combineTimeoutAndSignal,
  createConcurrencyLimiter,
  isAbortError,
  sleepWithSignal,
} from "../lib/visionConcurrency.ts";

Deno.test("concurrency limiter caps parallel vision tasks and releases queued waiters FIFO", async () => {
  const limiter = createConcurrencyLimiter(2);
  let active = 0;
  let peak = 0;
  const started: number[] = [];

  const tasks = [1, 2, 3, 4].map((id) =>
    limiter.run(async () => {
      started.push(id);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      return id * 10;
    })
  );

  const results = await Promise.all(tasks);
  assertEquals(peak, 2);
  assertEquals(active, 0);
  assertEquals(results, [10, 20, 30, 40]);
  assertEquals(started, [1, 2, 3, 4]);
});

Deno.test("concurrency limiter aborts queued request without blocking remaining waiters", async () => {
  const limiter = createConcurrencyLimiter(1);
  let releaseFirst!: () => void;
  const firstDone = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const p1 = limiter.run(() => firstDone);
  const abortController = new AbortController();
  const p2 = limiter.run(() => Promise.resolve("should-not-run"), abortController.signal);
  const p3 = limiter.run(() => Promise.resolve("ran-after-abort"));

  assertEquals(limiter.activeCount, 1);
  assertEquals(limiter.queuedCount, 2);
  abortController.abort();

  await assertRejects(() => p2, DOMException, "aborted");
  assertEquals(limiter.queuedCount, 1);

  releaseFirst();
  await p1;
  assertEquals(await p3, "ran-after-abort");
  assertEquals(limiter.activeCount, 0);
});

Deno.test("combineTimeoutAndSignal propagates external abort and identifies AbortError", async () => {
  const controller = new AbortController();
  const combined = combineTimeoutAndSignal(10_000, controller.signal);
  assertEquals(combined.aborted, false);
  controller.abort();
  assertEquals(combined.aborted, true);
  assertEquals(isAbortError(abortError()), true);
  assertEquals(isAbortError(new Error("other")), false);
});

Deno.test("sleepWithSignal resolves normally and cancels immediately on signal abort", async () => {
  await sleepWithSignal(5);
  const controller = new AbortController();
  const wait = sleepWithSignal(5_000, controller.signal);
  controller.abort();
  await assertRejects(() => wait, DOMException, "aborted");
});
