export function getErrorMessage(reason: unknown, fallback: string) {
  if (!(reason instanceof Error)) return fallback;
  const uncaught = reason.message.match(/Uncaught Error:\s*([^\n]+)/);
  if (uncaught?.[1]) return uncaught[1].trim();
  const cleaned = reason.message.replace(/^\[Request ID:[^\]]+\]\s*(Server Error\s*)?/i, "").trim();
  return cleaned || fallback;
}

const ANALYZE_OPERATIONS = new Set([
  "studio.analyze",
  "analysis.analyzeReferences",
]);

/**
 * Reads with no side effects, safe to repeat when the gateway cuts us off.
 *
 * `ai.routing.effective` is the only useQuery endpoint that goes through the
 * Edge Function rather than PostgREST, so it is the one read that queues behind
 * a long analyze or generation and gets a 504 for it. One retry turns that into
 * a delay instead of an unusable panel. Never list a mutation here.
 */
const RETRYABLE_READ_OPERATIONS = new Set([
  "ai.routing.effective",
]);

export function isRetryableInvokeOperation(operation: string) {
  return RETRYABLE_READ_OPERATIONS.has(operation);
}

export type InvokeFailureShape = {
  status?: number | null;
  bodyError?: string;
  bodyText?: string;
  fallbackMessage?: string;
};

/** The gateway or client gave up, as opposed to the operation itself failing. */
export function isGatewayCutFailure(args: InvokeFailureShape): boolean {
  const status = args.status ?? null;
  const text = String(args.bodyText || "");
  const haystack = `${args.fallbackMessage || ""} ${text} ${args.bodyError || ""}`.toLowerCase();
  return status === 504 ||
    text.includes("504") ||
    haystack.includes("gateway timeout") ||
    haystack.includes("failed to send a request to the edge function");
}

/** Must cover VISION_GATEWAY_BUDGET_MS so a single OpenAI Luna hop can finish. */
export const STUDIO_ANALYZE_TIMEOUT_MS = 140_000;

export const ANALYZE_GATEWAY_CUT_MESSAGE =
  "Analysis was interrupted before OpenAI could finish. Retry Analyze — GPT 5.6 Luna runs first on the configured OpenAI API key.";

export function isAnalyzeInvokeOperation(operation: string) {
  return ANALYZE_OPERATIONS.has(operation);
}

export function appApiInvokeTimeoutMs(operation: string): number | undefined {
  return isAnalyzeInvokeOperation(operation) ? STUDIO_ANALYZE_TIMEOUT_MS : undefined;
}

/**
 * Map supabase.functions.invoke failures. A 504 / client disconnect is the
 * invoke window, not "the selected vision provider timed out".
 */
export function functionInvokeErrorMessage(args: {
  operation: string;
  fallbackMessage: string;
  status?: number | null;
  bodyError?: string;
  bodyText?: string;
}): string {
  const status = args.status ?? null;
  const text = String(args.bodyText || "");
  const haystack = `${args.fallbackMessage} ${text} ${args.bodyError || ""}`.toLowerCase();

  if (isGatewayCutFailure(args)) {
    if (ANALYZE_OPERATIONS.has(args.operation)) return ANALYZE_GATEWAY_CUT_MESSAGE;
    // A read that runs one query has no images to shrink and no model settings
    // to speed up, so the generic advice below would be unactionable.
    if (isRetryableInvokeOperation(args.operation)) {
      return `The server was busy and did not answer '${args.operation}' in time. A long analysis or generation usually holds it up; it clears on its own.`;
    }
    return `The server timed out while processing '${args.operation}'. Please retry with smaller images or faster AI model settings.`;
  }

  if (status === 413 || text.includes("413") || haystack.includes("payload too large")) {
    return `The uploaded images for '${args.operation}' exceed the server size limit.`;
  }

  if (args.bodyError) return args.bodyError;

  if (
    text &&
    !text.includes("<!DOCTYPE") &&
    !text.includes("<html") &&
    text.trim().length > 0
  ) {
    return text.trim().slice(0, 300);
  }

  if (args.fallbackMessage === "Edge Function returned a non-2xx status code") {
    return `The application server encountered an error processing '${args.operation}'.`;
  }

  return args.fallbackMessage || "Supabase request failed.";
}
