import { assertEquals } from "jsr:@std/assert@1";

Deno.test("app-api entrypoint is repo source, not a GitHub raw import stub", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));
  const trimmed = source.trim();
  assertEquals(/raw\.githubusercontent\.com/i.test(trimmed), false);
  assertEquals(trimmed.split("\n").length > 50, true);
  assertEquals(trimmed.startsWith("import "), true);
});
