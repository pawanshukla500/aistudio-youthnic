import { assertEquals } from "jsr:@std/assert@1";

const loginSource = Deno.readTextFileSync(
  new URL("../../../../src/features/auth/Login.tsx", import.meta.url),
).replace(/\r\n/g, "\n");

const surferSource = Deno.readTextFileSync(
  new URL("../../../../src/components/ui/collection-surfer.tsx", import.meta.url),
).replace(/\r\n/g, "\n");

Deno.test("Option 2 Login integrates CollectionSurfer as a full-viewport 3D runway with interactive controls", () => {
  assertEquals(loginSource.includes("<CollectionSurfer"), true);
  assertEquals(loginSource.includes("variant={surferVariant}"), true);
  assertEquals(loginSource.includes("autoPlay={autoGlide}"), true);
  assertEquals(loginSource.includes("showOverlays={false}"), true);
});

Deno.test("Option 2 Login isolates the floating glass auth card from background scroll and cursor magnetism", () => {
  assertEquals(loginSource.includes('data-surfer-ignore="true"'), true);
  assertEquals(loginSource.includes("onWheel={(e) => e.stopPropagation()}"), true);
});

Deno.test("Option 2 Login preserves all multi-tenant auth, 5-free-shoots RPC enrollment, and input IDs", () => {
  assertEquals(loginSource.includes('supabase.rpc("app_enroll_seller"'), true);
  assertEquals(loginSource.includes('id="store-name-input"'), true);
  assertEquals(loginSource.includes('id="email-input"'), true);
  assertEquals(loginSource.includes('id="password-input"'), true);
  assertEquals(loginSource.includes('new Event("workspace-refresh")'), true);
  assertEquals(loginSource.includes("5 Free Shoots on Enrollment"), true);
});

Deno.test("CollectionSurfer uses positive modulo math, foreground slot offset, and local editorial fallbacks", () => {
  assertEquals(
    surferSource.includes("((value % loopDistance) + loopDistance) % loopDistance"),
    true,
  );
  assertEquals(surferSource.includes("const slot = i - 2;"), true);
  assertEquals(surferSource.includes("prefers-reduced-motion: reduce"), true);
  assertEquals(surferSource.includes("x < -1000 || y < -1000"), true);
  assertEquals(surferSource.includes("target.dataset.fallbackApplied"), true);
  assertEquals(surferSource.includes('/images/editorial/editorial-saree-front.webp'), true);
});
