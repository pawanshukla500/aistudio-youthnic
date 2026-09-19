import { assertEquals } from "jsr:@std/assert@1";
import {
  ANALYZE_GATEWAY_CUT_MESSAGE,
  STUDIO_ANALYZE_TIMEOUT_MS,
  appApiInvokeTimeoutMs,
  functionInvokeErrorMessage,
  isGatewayCutFailure,
  isRetryableInvokeOperation,
} from "../../../../src/lib/errors.ts";

Deno.test("Studio analyze client timeout is at least 140s", () => {
  assertEquals(STUDIO_ANALYZE_TIMEOUT_MS, 140_000);
  assertEquals(appApiInvokeTimeoutMs("studio.analyze"), 140_000);
  assertEquals(appApiInvokeTimeoutMs("analysis.analyzeReferences"), 140_000);
  assertEquals(appApiInvokeTimeoutMs("studio.queue"), undefined);
});

Deno.test("analyze 504 does not claim the selected vision provider timed out", () => {
  assertEquals(
    functionInvokeErrorMessage({
      operation: "studio.analyze",
      fallbackMessage: "Edge Function returned a non-2xx status code",
      status: 504,
      bodyError: "The selected vision provider timed out. The request can retry or use a configured fallback.",
      bodyText: "gateway timeout",
    }),
    ANALYZE_GATEWAY_CUT_MESSAGE,
  );
  assertEquals(
    functionInvokeErrorMessage({
      operation: "studio.analyze",
      fallbackMessage: "Failed to send a request to the Edge Function",
    }),
    ANALYZE_GATEWAY_CUT_MESSAGE,
  );
});

Deno.test("non-analyze 504 keeps the generic timeout copy", () => {
  assertEquals(
    functionInvokeErrorMessage({
      operation: "studio.queue",
      fallbackMessage: "Edge Function returned a non-2xx status code",
      status: 504,
      bodyText: "504 Gateway Timeout",
    }),
    "The server timed out while processing 'studio.queue'. Please retry with smaller images or faster AI model settings.",
  );
});

Deno.test("completed hop timeout JSON is still shown when the function returned 4xx", () => {
  assertEquals(
    functionInvokeErrorMessage({
      operation: "studio.analyze",
      fallbackMessage: "Edge Function returned a non-2xx status code",
      status: 502,
      bodyError: "The selected vision provider timed out. The request can retry or use a configured fallback.",
    }),
    "The selected vision provider timed out. The request can retry or use a configured fallback.",
  );
});

Deno.test("a routing read is not told to shrink its images", () => {
  // It runs one workspace RPC and one select: there is nothing to shrink and no
  // model setting to speed up, so the generic copy would be unactionable.
  const message = functionInvokeErrorMessage({
    operation: "ai.routing.effective",
    fallbackMessage: "Edge Function returned a non-2xx status code",
    status: 504,
    bodyText: "504 Gateway Timeout",
  });
  assertEquals(message.includes("smaller images"), false);
  assertEquals(message.includes("was busy"), true);
  assertEquals(message.includes("ai.routing.effective"), true);
});

Deno.test("only side-effect-free reads may be repeated after a gateway cut", () => {
  assertEquals(isRetryableInvokeOperation("ai.routing.effective"), true);
  // Repeating any of these would queue a second paid job or analysis.
  for (
    const mutation of [
      "studio.queue",
      "studio.analyze",
      "analysis.analyzeReferences",
      "jobs.regenerate",
      "catalog.process",
    ]
  ) {
    assertEquals(isRetryableInvokeOperation(mutation), false);
  }
});

Deno.test("a gateway cut is told apart from the operation failing", () => {
  assertEquals(isGatewayCutFailure({ status: 504 }), true);
  assertEquals(isGatewayCutFailure({ bodyText: "504 Gateway Timeout" }), true);
  assertEquals(
    isGatewayCutFailure({ fallbackMessage: "Failed to send a request to the Edge Function" }),
    true,
  );
  // A real failure from the handler must not be retried.
  assertEquals(
    isGatewayCutFailure({ status: 400, bodyError: "Stored image-generation routing is invalid." }),
    false,
  );
  assertEquals(isGatewayCutFailure({}), false);
});
