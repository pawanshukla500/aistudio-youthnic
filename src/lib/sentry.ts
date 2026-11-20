export type ClientSentryContext = {
  operation?: string;
  level?: "fatal" | "error" | "warning" | "info";
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
};

type ParsedClientSentryDsn = {
  protocol: "http" | "https";
  publicKey: string;
  host: string;
  pathPrefix: string;
  projectId: string;
  envelopeUrl: string;
};

export function parseClientSentryDsn(rawDsn: string | null | undefined): ParsedClientSentryDsn | null {
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

function configuredClientSentryDsn(): string {
  const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return String(metaEnv?.VITE_SENTRY_DSN || "").trim();
}

function configuredClientSentryEnvironment(): string {
  const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return String(metaEnv?.VITE_SENTRY_ENVIRONMENT || metaEnv?.MODE || "production").trim();
}

export function captureClientSentryException(error: unknown, context: ClientSentryContext = {}): void {
  const parsed = parseClientSentryDsn(configuredClientSentryDsn());
  if (!parsed) return;
  try {
    const eventId = crypto.randomUUID().replace(/-/g, "");
    const now = new Date().toISOString();
    const errName = error instanceof Error ? (error.name || "Error") : "Error";
    const errMessage = error instanceof Error ? error.message : String(error ?? "Unknown error");
    const errStack = error instanceof Error && typeof error.stack === "string" ? error.stack : "";
    const tags: Record<string, string> = { surface: "web_client" };
    if (context.operation) tags.operation = String(context.operation);
    for (const [k, v] of Object.entries(context.tags || {})) {
      if (v !== undefined && v !== null && String(v).trim() !== "") tags[k] = String(v);
    }
    const payload = {
      event_id: eventId,
      timestamp: now,
      platform: "javascript",
      level: context.level || "error",
      environment: configuredClientSentryEnvironment(),
      tags,
      extra: {
        ...(context.extra || {}),
        url: typeof window !== "undefined" ? window.location.href : undefined,
        stack: errStack || undefined,
      },
      exception: {
        values: [{ type: errName, value: errMessage }],
      },
    };
    const header = JSON.stringify({
      event_id: eventId,
      sent_at: now,
      dsn: `${parsed.protocol}://${parsed.publicKey}@${parsed.host}${parsed.pathPrefix}/${parsed.projectId}`,
    });
    const itemHeader = JSON.stringify({ type: "event", content_type: "application/json" });
    const envelope = `${header}\n${itemHeader}\n${JSON.stringify(payload)}\n`;
    void fetch(parsed.envelopeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: envelope,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Telemetry must never interrupt UI execution.
  }
}

let initialized = false;

export function initFrontendSentry(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  if (!parseClientSentryDsn(configuredClientSentryDsn())) return;

  window.addEventListener("error", (event) => {
    captureClientSentryException(event.error || event.message, {
      operation: "window.onerror",
      extra: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    if ((event.reason as { name?: string })?.name === "AbortError") return;
    captureClientSentryException(event.reason, {
      operation: "window.unhandledrejection",
    });
  });
}
