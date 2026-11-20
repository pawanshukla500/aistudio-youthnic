import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildSentryEnvelope,
  buildSentryEventPayload,
  parseSentryDsn,
  sendSentryException,
} from "../lib/sentry.ts";
import { parseClientSentryDsn } from "../../../../src/lib/sentry.ts";

Deno.test("parseSentryDsn parses standard and path-prefixed Sentry DSNs", () => {
  const parsed = parseSentryDsn("https://abc123pub@o450000.ingest.us.sentry.io/450999");
  assertEquals(parsed?.protocol, "https");
  assertEquals(parsed?.publicKey, "abc123pub");
  assertEquals(parsed?.host, "o450000.ingest.us.sentry.io");
  assertEquals(parsed?.projectId, "450999");
  assertEquals(
    parsed?.envelopeUrl,
    "https://o450000.ingest.us.sentry.io/api/450999/envelope/?sentry_key=abc123pub&sentry_version=7",
  );

  const clientParsed = parseClientSentryDsn("https://clientkey@o450000.ingest.us.sentry.io/450999");
  assertEquals(clientParsed?.envelopeUrl, parsed?.envelopeUrl.replace("abc123pub", "clientkey"));

  assertEquals(parseSentryDsn(""), null);
  assertEquals(parseSentryDsn("not-a-url"), null);
  assertEquals(parseSentryDsn("https://no-user-host.com/123"), null);
  assertEquals(parseSentryDsn("https://bad%ZZkey@o450000.ingest.us.sentry.io/450999"), null);
  assertEquals(parseClientSentryDsn("https://bad%ZZkey@o450000.ingest.us.sentry.io/450999"), null);
});

Deno.test("buildSentryEnvelope and sendSentryException deliver valid v7 Sentry envelope", async () => {
  const dsn = "https://pubKey789@o123.ingest.sentry.io/98765";
  const parsed = parseSentryDsn(dsn)!;
  const err = new Error("Meta Muse Spark TPM limit reached");
  const payload = buildSentryEventPayload(err, {
    operation: "studio.analyze",
    organizationId: "org_1",
    skuId: "B45-Raha-Maroon",
    provider: "meta",
    model: "muse-spark-1.3-contributor",
    tags: { fallback_triggered: true },
  });
  assertEquals(payload.tags.operation, "studio.analyze");
  assertEquals(payload.tags.sku_id, "B45-Raha-Maroon");
  assertEquals(payload.tags.ai_provider, "meta");
  assertEquals(payload.tags.fallback_triggered, "true");

  const envelope = buildSentryEnvelope(parsed, payload);
  const lines = envelope.trim().split("\n");
  assertEquals(lines.length, 3);
  assertStringIncludes(lines[0], '"dsn":"https://pubKey789@o123.ingest.sentry.io/98765"');
  assertStringIncludes(lines[1], '"type":"event"');
  assertStringIncludes(lines[2], "Meta Muse Spark TPM limit reached");

  let capturedUrl = "";
  let capturedBody = "";
  const ok = await sendSentryException(
    err,
    { operation: "studio.analyze", skuId: "B45-Raha-Maroon" },
    dsn,
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body || "");
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  );
  assertEquals(ok, true);
  assertEquals(capturedUrl, parsed.envelopeUrl);
  assertStringIncludes(capturedBody, "B45-Raha-Maroon");
});
