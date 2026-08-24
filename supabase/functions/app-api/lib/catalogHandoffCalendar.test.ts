import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { previousBusinessDate } from "./catalogHandoffCalendar.ts";

Deno.test("uses the preceding weekday during a normal work week", () => {
  assertEquals(previousBusinessDate("2026-08-25", [1, 2, 3, 4, 5], []), "2026-08-24");
});

Deno.test("carries Monday handoffs across the weekend", () => {
  assertEquals(previousBusinessDate("2026-08-24", [1, 2, 3, 4, 5], []), "2026-08-21");
});

Deno.test("skips configured holidays", () => {
  assertEquals(previousBusinessDate("2026-08-25", [1, 2, 3, 4, 5], ["2026-08-24"]), "2026-08-21");
});

Deno.test("handles year boundaries", () => {
  assertEquals(previousBusinessDate("2027-01-04", [1, 2, 3, 4, 5], ["2027-01-01"]), "2026-12-31");
});

Deno.test("rejects a calendar with no eligible day", () => {
  assertThrows(() => previousBusinessDate("2026-08-24", [9], []), Error, "no eligible handoff day");
});
