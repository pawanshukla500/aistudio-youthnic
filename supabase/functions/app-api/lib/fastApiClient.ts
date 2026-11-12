export interface FetchFastApiOptions {
  baseUrl: string;
  path: string;
  init?: RequestInit;
  maxRetries?: number;
  timeoutMs?: number;
  retryDelayMs?: number[];
  retriableStatuses?: number[];
  retryOnTimeout?: boolean;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || error.name === "AbortError" || /timed?\s*out/i.test(error.message);
}

/**
 * Call the FastAPI orchestration backend with cold-start retries so sleeping
 * Railway replicas wake cleanly on the first request after idle periods.
 */
export async function fetchFastApiWithRetry(options: FetchFastApiOptions): Promise<Response> {
  const {
    baseUrl,
    path,
    init = {},
    maxRetries = 2,
    timeoutMs = 90_000,
    retryDelayMs = [1200, 2500],
    fetchFn = fetch,
    sleepFn = defaultSleep,
  } = options;

  const cleanBase = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(cleanBase)) {
    throw new Error(`Invalid FastAPI baseUrl: "${baseUrl}"`);
  }

  const method = String(init.method || "GET").toUpperCase();
  const isMutation = MUTATING_METHODS.has(method);
  const retriableSet = new Set(options.retriableStatuses ?? (isMutation ? [502, 503] : [502, 503, 504]));
  const allowTimeoutRetry = options.retryOnTimeout ?? !isMutation;

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${cleanBase}${normalizedPath}`;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (init.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    try {
      const response = await fetchFn(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      });
      if (!retriableSet.has(response.status) || attempt === maxRetries) {
        return response;
      }
      // Drain body before retrying to avoid connection/resource leaks in Deno.
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted || attempt === maxRetries || (!allowTimeoutRetry && isTimeoutError(error))) {
        throw error;
      }
    }

    const delay = retryDelayMs[Math.min(attempt, retryDelayMs.length - 1)] ?? 1500;
    await sleepFn(delay);
  }

  throw lastError instanceof Error ? lastError : new Error("FastAPI request failed");
}
