import { assertEquals } from "jsr:@std/assert@1";
import { selectCatalogRecipients } from "./catalogRecipientSelection.ts";

Deno.test("team-only mode never silently falls back to stale custom recipients", () => {
  assertEquals(selectCatalogRecipients("listing_team", [], ["legacy@example.com"]), []);
  assertEquals(selectCatalogRecipients("listing_team", ["LISTING@example.com"], ["legacy@example.com"]), ["listing@example.com"]);
});

Deno.test("custom and combined modes select and deduplicate the configured recipients", () => {
  assertEquals(selectCatalogRecipients("custom", ["team@example.com"], ["Custom@example.com"]), ["custom@example.com"]);
  assertEquals(
    selectCatalogRecipients("listing_team_and_custom", ["team@example.com"], ["TEAM@example.com", "custom@example.com"]),
    ["team@example.com", "custom@example.com"],
  );
});
