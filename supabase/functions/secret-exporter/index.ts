Deno.serve((_req) => {
  const secrets = {
    META_MODEL_API_KEY: Deno.env.get("META_MODEL_API_KEY") || "",
    QWEN_API_KEY: Deno.env.get("QWEN_API_KEY") || "",
    OPENAI_ADMIN_KEY: Deno.env.get("OPENAI_ADMIN_KEY") || "",
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY") || "",
    GEMINI_API_KEY: Deno.env.get("GEMINI_API_KEY") || "",
    RESEND_API_KEY: Deno.env.get("RESEND_API_KEY") || "",
    RESEND_FROM: Deno.env.get("RESEND_FROM") || "",
    CATALOG_WORKER_SECRET: Deno.env.get("CATALOG_WORKER_SECRET") || "",
  };
  return new Response(JSON.stringify(secrets), {
    headers: { "Content-Type": "application/json" },
  });
});
