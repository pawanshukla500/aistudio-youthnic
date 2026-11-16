/**
 * Bounded concurrency and client-abort helpers for memory-heavy vision calls.
 *
 * Keeps concurrent base64 reference decoding bounded per isolate so traffic
 * bursts queue cleanly instead of hitting V8 old-space OOM, while immediately
 * releasing aborted requests.
 */

export function abortError(message = "The request was aborted."): DOMException {
  return new DOMException(message, "AbortError");
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    Boolean(error && typeof error === "object" && (error as { name?: string }).name === "AbortError")
  );
}

export function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  if (signal.aborted) {
    return Promise.reject(abortError("Request aborted while waiting."));
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(abortError("Request aborted while waiting."));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function combineTimeoutAndSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeoutSignal]);
  }
  const controller = new AbortController();
  const cleanup = () => {
    signal.removeEventListener("abort", onSignalAbort);
    timeoutSignal.removeEventListener("abort", onTimeoutAbort);
  };
  const forward = (reason: unknown) => {
    cleanup();
    if (!controller.signal.aborted) controller.abort(reason);
  };
  if (signal.aborted) {
    forward(signal.reason);
    return controller.signal;
  }
  const onSignalAbort = () => forward(signal.reason);
  const onTimeoutAbort = () => forward(timeoutSignal.reason);
  signal.addEventListener("abort", onSignalAbort, { once: true });
  timeoutSignal.addEventListener("abort", onTimeoutAbort, { once: true });
  return controller.signal;
}

export interface ConcurrencyLimiter {
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  readonly activeCount: number;
  readonly queuedCount: number;
}

export function createConcurrencyLimiter(maxConcurrent = 4): ConcurrencyLimiter {
  const limit = Math.max(1, Math.floor(maxConcurrent));
  let active = 0;
  const waiters: Array<() => void> = [];

  const acquire = (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) {
      return Promise.reject(abortError("Request aborted while queued."));
    }
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const grant = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        active += 1;
        resolve();
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        const index = waiters.indexOf(grant);
        if (index >= 0) waiters.splice(index, 1);
        reject(abortError("Request aborted while waiting in vision queue."));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      waiters.push(grant);
    });
  };

  const release = () => {
    active = Math.max(0, active - 1);
    const next = waiters.shift();
    if (next) next();
  };

  return {
    get activeCount() {
      return active;
    },
    get queuedCount() {
      return waiters.length;
    },
    async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      await acquire(signal);
      try {
        if (signal?.aborted) throw abortError("Request aborted before execution.");
        return await task();
      } finally {
        release();
      }
    },
  };
}
