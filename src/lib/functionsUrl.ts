/**
 * Base URL for `supabase.functions.invoke`.
 * The client joins `` `${url}/${name}` ``. `new URL(origin).href` always ends
 * with `/`, which turns that join into `//app-api`. A relative or invalid
 * value is rejected so the SDK keeps its standard gateway.
 */
export function functionsInvokeBase(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}
