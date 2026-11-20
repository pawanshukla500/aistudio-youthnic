export type ParsedSentryDsn = {
  protocol: "http" | "https";
  publicKey: string;
  host: string;
  pathPrefix: string;
  projectId: string;
  envelopeUrl: string;
};

export type SentryContext = {
  operation?: string;
  organizationId?: string;
  skuId?: string;
  jobId?: string;
  provider?: string;
  model?: string;
  level?: "fatal" | "error" | "warning" | "info";
  environment?: string;
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
};

export function parseSentryDsn(rawDsn: string | null | undefined): ParsedSentryDsn | null {
  const trimmed = String(rawDsn || "").trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const protocol = url.protocol === "http:" ? "http" : url.protocol === "https:" ? "https" : null;
  const publicKey = decodeURIComponent(url.username || "").trim();
  const host = url.host.trim();
  const segments = url.pathname.split("/").map((s) => s.trim()).filter(Boolean);
  const projectId = segments.pop() || "";
  const pathPrefix = segments.length ? `/${segments.join("/")}` : "";
  if (!protocol || !publicKey || !host || !projectId) return null;
  const envelopeUrl = `${protocol}://${host}${pathPrefix}/api/${encodeURIComponent(projectId)}/envelope/?sentry_key=${encodeURIComponent(publicKey)}&sentry_version=7`;
  return { protocol, publicKey, host, pathPrefix, projectId, envelopeUrl };
}

function normalizeEventId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function buildSentryEventPayload(error: unknown, context: SentryContext = {}) {
  const eventId = normalizeEventId();
  const timestamp = new Date().toISOString();
  const errName = error instanceof Error ? (error.name || "Error") : "Error";
  const errMessage = error instanceof Error ? error.message : String(error ?? "Unknown error");
  const errStack = error instanceof Error && typeof error.stack === "string" ? error.stack : "";

  const tags: Record<string, string> = {};
  if (context.operation) tags.operation = String(context.operation);
  if (context.organizationId) tags.organization_id = String(context.organizationId);
  if (context.skuId) tags.sku_id = String(context.skuId);
  if (context.jobId) tags.job_id = String(context.jobId);
  if (context.provider) tags.ai_provider = String(context.provider);
  if (context.model) tags.ai_model = String(context.model);
  for (const [key, value] of Object.entries(context.tags || {})) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      tags[key] = String(value);
    }
  }

  return {
    event_id: eventId,
    timestamp,
    platform: "javascript",
    level: context.level || "error",
    environment: context.environment || "production",
    tags,
    extra: {
      ...(context.extra || {}),
      stack: errStack || undefined,
    },
    exception: {
      values: [
        {
          type: errName,
          value: errMessage,
        },
      ],
    },
  };
}

export function buildSentryEnvelope(dsn: ParsedSentryDsn, eventPayload: ReturnType<typeof buildSentryEventPayload>): string {
  const envelopeHeader = JSON.stringify({
    event_id: eventPayload.event_id,
    sent_at: new Date().toISOString(),
    dsn: `${dsn.protocol}://${dsn.publicKey}@${dsn.host}${dsn.pathPrefix}/${dsn.projectId}`,
  });
  const itemHeader = JSON.stringify({ type: "event", content_type: "application/json" });
  const itemBody = JSON.stringify(eventPayload);
  return `${envelopeHeader}\n${itemHeader}\n${itemBody}\n`;
}

export async function sendSentryException(
  error: unknown,
  context: SentryContext = {},
  rawDsn?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const parsed = parseSentryDsn(rawDsn);
  if (!parsed) return false;
  try {
    const event = buildSentryEventPayload(error, context);
    const body = buildSentryEnvelope(parsed, event);
    const response = await fetchImpl(parsed.envelopeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body,
      signal: AbortSignal.timeout(4_000),
    });
    await response.body?.cancel().catch(() => {});
    return response.ok;
  } catch {
    return false;
  }
}
