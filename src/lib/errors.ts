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

export const ANALYZE_GATEWAY_CUT_MESSAGE =
  "Analysis was interrupted before fallback providers could finish. Retry Analyze — Gemini Flash runs first so a typical run completes in about 30 seconds.";

/**
 * Map supabase.functions.invoke failures. A 504 / client disconnect is the
 * 60s Studio invoke window, not "the selected vision provider timed out".
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
  const gatewayCut = status === 504 ||
    text.includes("504") ||
    haystack.includes("gateway timeout") ||
    haystack.includes("failed to send a request to the edge function");

  if (gatewayCut) {
    if (ANALYZE_OPERATIONS.has(args.operation)) return ANALYZE_GATEWAY_CUT_MESSAGE;
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
