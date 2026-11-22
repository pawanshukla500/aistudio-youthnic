/**
 * studio.analyze answers `{ analysisPending: true }` before Railway's 300s proxy
 * cut while the analysis keeps running on the server (a slow primary model plus
 * its fallback can take up to ten minutes). Asking again with the same inputs and
 * `resumeAnalysis` joins that same analysis; it never starts a second paid one.
 */
export const STUDIO_ANALYZE_TOTAL_WAIT_MS = 12 * 60_000;

export const ANALYZE_TOO_LONG_MESSAGE =
  "Analysis is taking longer than expected. Retry Analyze in a minute to collect the result.";

function pendingRetryMs(value: unknown): number | null {
  if (!value || typeof value !== "object" || (value as { analysisPending?: unknown }).analysisPending !== true) return null;
  const retry = Number((value as { retryAfterMs?: unknown }).retryAfterMs);
  return Number.isFinite(retry) && retry >= 0 ? Math.min(retry, 10_000) : 1_000;
}

function abortableDelay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("The analysis was cancelled.", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

/** `invoke` gets a signal on each retry: it aborts on cancel or when the total wait runs out mid-call. */
export async function analyzeUntilSettled<T>(
  invoke: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<T>,
  args: Record<string, unknown>,
  options: { signal?: AbortSignal; now?: () => number } = {},
): Promise<T> {
  const now = options.now ?? Date.now;
  const deadline = now() + STUDIO_ANALYZE_TOTAL_WAIT_MS;
  let result = await invoke(args);
  for (let retryMs = pendingRetryMs(result); retryMs !== null; retryMs = pendingRetryMs(result)) {
    await abortableDelay(retryMs, options.signal);
    const remainingMs = deadline - now();
    if (remainingMs <= 0) throw new Error(ANALYZE_TOO_LONG_MESSAGE);
    const call = new AbortController();
    const timer = setTimeout(() => call.abort(), remainingMs);
    const cancel = () => call.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      result = await invoke({ ...args, resumeAnalysis: true }, call.signal);
    } catch (error) {
      if (call.signal.aborted && !options.signal?.aborted) throw new Error(ANALYZE_TOO_LONG_MESSAGE);
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    }
  }
  return result;
}
