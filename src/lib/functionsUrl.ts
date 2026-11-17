/**
 * Base URL for `supabase.functions.invoke`.
 * The client joins `` `${url}/${name}` ``. `new URL(origin).href` always ends
 * with `/`, which turns that join into `//app-api`.
 */
export function functionsInvokeBase(url: string) {
  return url.trim().replace(/\/+$/, "");
}
