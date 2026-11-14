import { assertEquals } from "jsr:@std/assert@1";
import {
  SESSION_MAX_AGE_MS,
  extractFirebaseAuthTimeSeconds,
  isFirebaseSessionExpired,
  resolveSessionLoginAtMs,
} from "../../../../src/lib/sessionExpiry.ts";

const loginSource = Deno.readTextFileSync(
  new URL("../../../../src/features/auth/Login.tsx", import.meta.url),
).replace(/\r\n/g, "\n");

const surferSource = Deno.readTextFileSync(
  new URL("../../../../src/components/ui/collection-surfer.tsx", import.meta.url),
).replace(/\r\n/g, "\n");

const authContextSource = Deno.readTextFileSync(
  new URL("../../../../src/lib/FirebaseAuthContext.tsx", import.meta.url),
).replace(/\r\n/g, "\n");

const supabaseClientSource = Deno.readTextFileSync(
  new URL("../../../../src/lib/supabase.ts", import.meta.url),
).replace(/\r\n/g, "\n");

const appApiIndexSource = Deno.readTextFileSync(
  new URL("../index.ts", import.meta.url),
).replace(/\r\n/g, "\n");

Deno.test("Option 2 Login integrates CollectionSurfer in Light Atelier Mode without dark mode or saree mannequin box", () => {
  assertEquals(loginSource.includes("<CollectionSurfer"), true);
  assertEquals(loginSource.includes("variant={surferVariant}"), true);
  assertEquals(loginSource.includes("autoPlay={autoGlide}"), true);
  assertEquals(loginSource.includes("showOverlays={false}"), true);
  // Light Atelier Mode tokens used; no #070609 dark mode or saree mannequin box
  assertEquals(loginSource.includes("bg-background"), true);
  assertEquals(loginSource.includes("#070609"), false);
  assertEquals(loginSource.includes("Locked 6-Pose Production Pipeline"), false);
  assertEquals(loginSource.includes("editorial-saree-"), false);
  assertEquals(surferSource.includes("#070609"), false);
  assertEquals(surferSource.includes("editorial-saree-"), false);
});

Deno.test("Option 2 Login isolates the floating glass auth card, validates internal redirect, and exposes mobile glide pause", () => {
  assertEquals(loginSource.includes('data-surfer-ignore="true"'), true);
  assertEquals(loginSource.includes("onWheel={(e) => e.stopPropagation()}"), true);
  assertEquals(loginSource.includes("overflow-y-auto overscroll-contain"), true);
  assertEquals(loginSource.includes("lg:overflow-hidden"), false);
  assertEquals(loginSource.includes("bg-card/95"), true);
  assertEquals(loginSource.includes("transition-all"), false);
  assertEquals(
    loginSource.includes('rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")'),
    true,
  );
  // Both desktop and mobile headers expose the autoGlide pause/play toggle
  assertEquals(
    loginSource.split("setAutoGlide((prev) => !prev)").length - 1,
    2,
  );
});

Deno.test("Option 2 Login preserves all multi-tenant auth, 5-free-shoots RPC enrollment, and input IDs", () => {
  assertEquals(loginSource.includes('supabase.rpc("app_enroll_seller"'), true);
  assertEquals(loginSource.includes('id="store-name-input"'), true);
  assertEquals(loginSource.includes('id="email-input"'), true);
  assertEquals(loginSource.includes('id="password-input"'), true);
  assertEquals(loginSource.includes('new Event("workspace-refresh")'), true);
  assertEquals(loginSource.includes("5 Free Shoots on Enrollment"), true);
});

Deno.test("CollectionSurfer repeats short collections, decouples embedded scroll, and respects Hallmark rules", () => {
  assertEquals(
    surferSource.includes("((value % loopDistance) + loopDistance) % loopDistance"),
    true,
  );
  assertEquals(
    surferSource.includes("Math.max(1, Math.ceil(16 / safeItems.length))"),
    true,
  );
  assertEquals(surferSource.includes("...baseTrack.slice(0, 2)"), true);
  assertEquals(surferSource.includes("(showOverlays ? Number(values[0]) : 0)"), true);
  assertEquals(surferSource.includes("const slot = i - 2;"), true);
  assertEquals(surferSource.includes("prefers-reduced-motion: reduce"), true);
  assertEquals(surferSource.includes("x < -1000 || y < -1000"), true);
  assertEquals(surferSource.includes("target.dataset.fallbackApplied"), true);
  assertEquals(surferSource.includes('loading={i < 4 ? "eager" : "lazy"}'), true);
  assertEquals(surferSource.includes("transition-all"), false);
});

Deno.test("24-hour login session expiration is enforced across FirebaseAuthContext, Supabase client, and app-api Edge Function", () => {
  assertEquals(SESSION_MAX_AGE_MS, 24 * 60 * 60 * 1000);
  assertEquals(authContextSource.includes("isFirebaseSessionExpired("), true);
  assertEquals(supabaseClientSource.includes("isFirebaseSessionExpired("), true);
  assertEquals(
    appApiIndexSource.includes("MAX_SESSION_AGE_SECONDS = 24 * 60 * 60"),
    true,
  );
  assertEquals(
    appApiIndexSource.includes("assertTokenNotOlderThan24Hours(request)"),
    true,
  );

  // Runtime verification of exported sessionExpiry functions
  const nowMs = 1_760_000_000_000;
  const recentAuthSec = Math.floor((nowMs - 23 * 60 * 60 * 1000) / 1000);
  const expiredAuthSec = Math.floor((nowMs - 24 * 60 * 60 * 1000) / 1000);

  assertEquals(isFirebaseSessionExpired(recentAuthSec, null, nowMs), false);
  assertEquals(isFirebaseSessionExpired(expiredAuthSec, null, nowMs), true);

  // A fresh Firebase auth_time overrides a stale >24h stored localStorage timestamp
  const staleStoredMs = nowMs - 48 * 60 * 60 * 1000;
  assertEquals(
    resolveSessionLoginAtMs(recentAuthSec, staleStoredMs),
    recentAuthSec * 1000,
  );
  assertEquals(
    isFirebaseSessionExpired(recentAuthSec, staleStoredMs, nowMs),
    false,
  );

  // extractFirebaseAuthTimeSeconds falls back cleanly
  assertEquals(
    extractFirebaseAuthTimeSeconds({ claims: { auth_time: 1700000000 } }, null),
    1700000000,
  );
});
