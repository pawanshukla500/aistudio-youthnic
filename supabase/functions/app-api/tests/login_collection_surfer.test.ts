import { assertEquals } from "jsr:@std/assert@1";
import { functionsInvokeBase } from "../../../../src/lib/functionsUrl.ts";
import {
  SESSION_MAX_AGE_MS,
  extractFirebaseAuthTimeSeconds,
  isFirebaseSessionExpired,
  resolveSessionLoginAtMs,
} from "../../../../src/lib/sessionExpiry.ts";
import {
  RETRIED_FRAME,
  SHOOT_FRAMES,
  SHOOT_TICKS,
  shootAt,
} from "../../../../src/features/auth/shootTimeline.ts";

const loginSource = Deno.readTextFileSync(
  new URL("../../../../src/features/auth/Login.tsx", import.meta.url),
).replace(/\r\n/g, "\n");

const showcaseSource = Deno.readTextFileSync(
  new URL("../../../../src/features/auth/LoginShowcase.tsx", import.meta.url),
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

Deno.test("functions invoke base stays a single slash before app-api", () => {
  const base = functionsInvokeBase("https://functions-production-b062.up.railway.app/");
  assertEquals(base, "https://functions-production-b062.up.railway.app");
  assertEquals(`${base}/app-api`, "https://functions-production-b062.up.railway.app/app-api");
  assertEquals(functionsInvokeBase("/functions/v1"), null);
  assertEquals(functionsInvokeBase("not a url"), null);
  assertEquals(supabaseClientSource.includes("new URL(supabaseFunctionsUrl)"), false);
  assertEquals(supabaseClientSource.includes("href: supabaseFunctionsUrl"), true);
});

Deno.test("Option 2 Login integrates CollectionSurfer in Light Atelier Mode with default Magnetic + Glide and no badge/runway-switcher clutter", () => {
  assertEquals(loginSource.includes("<CollectionSurfer"), true);
  assertEquals(loginSource.includes('variant="magnetic"'), true);
  assertEquals(loginSource.includes("autoPlay={true}"), true);
  assertEquals(loginSource.includes("showOverlays={false}"), true);
  // Light Atelier Mode tokens used; no #070609 dark mode, saree mannequin box, or removed pills
  assertEquals(loginSource.includes("bg-background"), true);
  assertEquals(loginSource.includes("#070609"), false);
  assertEquals(loginSource.includes("Locked 6-Pose Production Pipeline"), false);
  assertEquals(loginSource.includes("Multi-Tenant Fashion Studio"), false);
  assertEquals(loginSource.includes("All Systems Online"), false);
  assertEquals(loginSource.includes("Scroll or move cursor to surf"), false);
  assertEquals(loginSource.includes("setSurferVariant"), false);
  assertEquals(loginSource.includes("setAutoGlide"), false);
  assertEquals(loginSource.includes("editorial-saree-"), false);
  assertEquals(surferSource.includes("#070609"), false);
  assertEquals(surferSource.includes("editorial-saree-"), false);
  assertEquals(surferSource.includes("autoPlay = true"), true);
  assertEquals(
    surferSource.includes("useTransform([mouseX, mouseY, scrollSpring]"),
    true,
  );
});

Deno.test("Option 2 Login isolates the floating glass auth card, scrolls with the document, and validates internal redirect", () => {
  assertEquals(loginSource.includes('data-surfer-ignore="true"'), true);
  assertEquals(loginSource.includes("onWheel={(e) => e.stopPropagation()}"), true);
  // The page is a long document: no fixed inner scroller that the wheel cannot reach over the runway
  assertEquals(loginSource.includes("overflow-y-auto"), false);
  assertEquals(loginSource.includes("lg:overflow-hidden"), false);
  assertEquals(loginSource.includes("bg-card/95"), true);
  assertEquals(loginSource.includes("transition-all"), false);
  assertEquals(
    loginSource.includes('rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")'),
    true,
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

Deno.test("Login workflow board replays a real shoot: pose 1 alone first, a failed back check retried, six frames delivered", () => {
  assertEquals([...SHOOT_FRAMES], [
    "Full Front",
    "Turning",
    "Back",
    "Signature Reference",
    "Face + Details",
    "Product Highlight",
  ]);
  const run = Array.from({ length: SHOOT_TICKS }, (_, tick) => shootAt(tick));
  assertEquals(
    run.map((board) => board.step).filter((step, i, steps) => step !== steps[i - 1]).slice(0, 5),
    ["upload", "analyse", "plan", "generate", "check"],
  );
  // Pose 1 anchors the set: nothing else starts until it is delivered
  for (const board of run.filter((board) => board.stages[0] !== "delivered")) {
    assertEquals(board.stages.slice(1).every((stage) => stage === "queued"), true);
  }
  // A frame is delivered only straight after a check, and never goes back
  for (let frame = 0; frame < SHOOT_FRAMES.length; frame++) {
    const first = run.findIndex((board) => board.stages[frame] === "delivered");
    assertEquals(run[first - 1].stages[frame], "checking");
    assertEquals(run.slice(first).every((board) => board.stages[frame] === "delivered"), true);
  }
  assertEquals(
    run.filter((board) => board.stages.includes("retrying")).map((board) => board.stages.indexOf("retrying")),
    [RETRIED_FRAME],
  );
  assertEquals(run.at(-1)!.delivered, SHOOT_FRAMES.length);
  assertEquals(shootAt(SHOOT_TICKS).step, "upload");
  assertEquals(loginSource.includes("<LoginShowcase"), true);
  assertEquals(showcaseSource.includes("useReducedMotion"), true);
  assertEquals(showcaseSource.includes("transition-all"), false);
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
