import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  firebaseCatalogPath,
  supabaseCatalogPath,
} from "../lib/catalogStoragePaths.ts";

const ORG = "3cb1d547-c9c2-4b2a-b346-71abbed23b9d";
const OTHER_ORG = "d0994a48-f2aa-4311-930b-b02095a1abce";

Deno.test("Supabase catalog paths normalize the legacy organization prefix", () => {
  assertEquals(
    supabaseCatalogPath(ORG, `organizations/${ORG}/references/front.jpg`),
    `${ORG}/references/front.jpg`,
  );
  assertEquals(
    supabaseCatalogPath(ORG, `${ORG}/generated/pose-1.png`),
    `${ORG}/generated/pose-1.png`,
  );
});

Deno.test("Firebase catalog paths accept only the two historical tenant layouts", () => {
  assertEquals(
    firebaseCatalogPath(ORG, `organizations/${ORG}/generated/pose-1.png`),
    `organizations/${ORG}/generated/pose-1.png`,
  );
  assertEquals(
    firebaseCatalogPath(
      ORG,
      `users/member-1/organizations/${ORG}/references/back.jpg`,
    ),
    `users/member-1/organizations/${ORG}/references/back.jpg`,
  );
});

Deno.test("Firebase ownership no longer accepts an organization id embedded in another tenant path", () => {
  assertThrows(
    () =>
      firebaseCatalogPath(
        ORG,
        `users/member-1/organizations/${OTHER_ORG}/references/${ORG}-back.jpg`,
      ),
    Error,
    "outside the current organization",
  );
  assertThrows(
    () =>
      firebaseCatalogPath(
        ORG,
        `organizations/${OTHER_ORG}/generated/pose-1.png`,
      ),
    Error,
  );
  assertThrows(
    () =>
      firebaseCatalogPath(ORG, `organizations/${ORG}/generated/../pose-1.png`),
    Error,
    "invalid",
  );
});
