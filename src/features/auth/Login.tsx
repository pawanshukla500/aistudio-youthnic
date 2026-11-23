import { useRef, useState, type FormEvent, type MouseEvent } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useInView, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  Store,
} from "lucide-react";
import { CollectionSurfer } from "../../components/ui/collection-surfer";
import { getErrorMessage } from "../../lib/errors";
import { useFirebaseAuth } from "../../lib/FirebaseAuthContext";
import { supabase } from "../../lib/supabase";
import { LoginShowcase } from "./LoginShowcase";
import { SHOOT_FRAMES } from "./shootTimeline";
import { KITKAT_KATTHA, WINE_KAFTAN } from "./showcaseShoots";

// The runway carries real delivered frames, the two shoots interleaved.
const RUNWAY_ITEMS = [0, 3, 4, 1, 2, 5].flatMap((frame, i) =>
  [WINE_KAFTAN, KITKAT_KATTHA].map((shoot, j) => ({
    id: i * 2 + j + 1,
    image: shoot.frames[frame].image,
    title: shoot.name,
    subtitle: SHOOT_FRAMES[frame],
  })),
);

const SECTIONS = [
  ["workflow", "How a shoot runs"],
  ["frames", "Six frames"],
  ["rules", "Product rules"],
  ["pricing", "Pricing"],
];

const HERO_FACTS = [
  ["6", "frames in every new shoot"],
  ["3:4", "at 2K, 1536 × 2048"],
  ["2", "photos to start, 4 for a saree"],
];

interface LoginProps {
  redirect?: string;
}

export function Login({ redirect }: LoginProps) {
  const { signIn, signUp } = useFirebaseAuth();
  const navigate = useNavigate();
  const scrollBehavior = useReducedMotion() ? "auto" : "smooth";
  // The runway glides only while the hero is on screen; below it the sections cover it.
  const heroRef = useRef<HTMLElement>(null);
  const heroInView = useInView(heroRef);
  const [searchParams] = useSearchParams();
  const rawRedirect = redirect || searchParams.get("redirect") || "";
  const targetRedirect =
    rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
      ? rawRedirect
      : "";

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [storeName, setStoreName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "signup") {
        const cleanStoreName = storeName.trim();
        if (cleanStoreName.length < 2) {
          throw new Error(
            "Please enter your store or brand name (minimum 2 characters).",
          );
        }
        if (password.length < 6) {
          throw new Error("Password must be at least 6 characters long.");
        }
        const userCred = await signUp(email, password);
        await userCred.user.getIdToken(true);
        // Enroll seller organization atomically with 5 free credits
        const { error: rpcError } = await supabase.rpc("app_enroll_seller", {
          store_name: cleanStoreName,
          contact_email: email.trim().toLowerCase(),
        });
        if (rpcError) {
          console.warn(
            "Initial enrollment RPC notice, falling back to onboarding modal:",
            rpcError.message,
          );
        }
        window.dispatchEvent(new Event("workspace-refresh"));
      } else {
        await signIn(email, password);
      }
      if (targetRedirect && targetRedirect !== "/") {
        navigate(targetRedirect, { replace: true });
      }
    } catch (reason) {
      setError(
        getErrorMessage(
          reason,
          mode === "signup" ? "Could not enroll store." : "Could not sign in.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const jumpTo = (id: string) => (event: MouseEvent) => {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: scrollBehavior });
  };

  // The page's Sign in and Start free buttons bring the card back and put the cursor in it.
  const openAuth = (next: "signin" | "signup") => {
    setMode(next);
    setError("");
    document
      .getElementById("auth-card")
      ?.scrollIntoView({ behavior: scrollBehavior, block: "center" });
    requestAnimationFrame(() =>
      document
        .getElementById(next === "signup" ? "store-name-input" : "email-input")
        ?.focus({ preventScroll: true }),
    );
  };

  return (
    <main className="relative min-h-screen bg-background text-on-background selection:bg-primary/15 selection:text-primary">
      {/* Layer 0: 3D Collection Surfer Runway (Default Magnetic + Glide), pinned behind the hero.
          The zero-height wrapper lets the page scroll over it with the document. */}
      <div className="h-0" aria-hidden="true">
        <CollectionSurfer
          items={RUNWAY_ITEMS}
          variant="magnetic"
          autoPlay={heroInView}
          autoPlaySpeed={46}
          showOverlays={false}
          perspectiveOrigin="16% 22%"
        />
      </div>

      {/* Layer 1: Warm Daylight Atelier Scrims (Preserves Center 3D Runway Clarity & Text Contrast) */}
      <div className="pointer-events-none fixed inset-0 z-10 bg-gradient-to-r from-background/95 via-background/60 to-background/35" />
      <div className="pointer-events-none fixed inset-0 z-10 bg-gradient-to-b from-background/80 via-transparent to-background/85" />

      {/* Layer 2: The page, scrolling with the document */}
      <div className="relative z-20">
        <header className="sticky top-0 z-30 border-b border-outline-variant/40 bg-background/85 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1560px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-10 xl:px-14">
            <div className="flex items-center gap-2.5">
              <img src="/logo.png" alt="" className="h-9 w-9 object-contain" />
              <span className="whitespace-nowrap font-syne text-lg font-bold tracking-tight text-on-surface">
                Youthnic{" "}
                <span className="font-manrope text-sm font-semibold text-primary">
                  AI Studio
                </span>
              </span>
            </div>
            <nav
              aria-label="On this page"
              className="hidden items-center gap-7 text-sm font-semibold text-secondary md:flex"
            >
              {SECTIONS.map(([id, label]) => (
                <a
                  key={id}
                  href={`#${id}`}
                  onClick={jumpTo(id)}
                  className="transition-colors hover:text-on-surface"
                >
                  {label}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-4 text-sm font-semibold">
              <Link
                to="/docs"
                className="hidden text-secondary transition-colors hover:text-on-surface sm:inline"
              >
                Docs
              </Link>
              <button
                type="button"
                onClick={() => openAuth("signin")}
                className="cursor-pointer whitespace-nowrap rounded-full bg-on-surface px-4 py-2 text-inverse-on-surface transition-colors hover:bg-primary"
              >
                Sign in
              </button>
            </div>
          </div>
        </header>

        {/* Hero: the headline and the auth card over the runway */}
        <section ref={heroRef} className="pointer-events-none">
          <div className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-[1560px] gap-x-10 gap-y-8 px-5 pb-10 pt-8 sm:px-8 lg:grid-cols-[1.08fr_0.92fr] lg:grid-rows-[1fr_auto] lg:px-10 lg:pb-12 lg:pt-10 xl:px-14">
            <div className="pointer-events-auto self-center lg:col-start-1 lg:row-start-1">
              <h1 className="font-syne text-[clamp(2.6rem,5.6vw,5.5rem)] font-bold leading-[0.98] tracking-tighter text-on-surface">
                Two photos in.
                <br />
                Six frames out.
              </h1>
              <p className="mt-5 max-w-xl text-base font-medium leading-relaxed text-secondary sm:text-lg">
                Upload the front and back of a garment. Youthnic AI Studio
                reads it, plans a six-pose shoot and delivers catalog images
                that keep the cut, print and colour of the product you
                uploaded.
              </p>
            </div>

            {/* Floating Light Atelier Auth Card */}
            <div
              id="auth-card"
              data-surfer-ignore="true"
              onWheel={(e) => e.stopPropagation()}
              className="pointer-events-auto w-full max-w-[485px] self-center justify-self-center rounded-[34px] border border-outline-variant/60 bg-surface-container-low/65 p-1.5 backdrop-blur-2xl lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:justify-self-end"
            >
              <div className="w-full rounded-[28px] border border-outline-variant/45 bg-card/95 p-7 backdrop-blur-2xl transition-colors sm:p-9">
                {/* Mode Switcher Tabs */}
                <div className="grid grid-cols-2 rounded-2xl border border-outline-variant/40 bg-surface-container-low p-1.5">
                  <button
                    type="button"
                    aria-pressed={mode === "signin"}
                    onClick={() => {
                      setMode("signin");
                      setError("");
                    }}
                    className={`cursor-pointer rounded-xl py-2 text-xs font-bold transition-colors ${
                      mode === "signin"
                        ? "bg-card text-on-surface"
                        : "text-secondary hover:text-on-surface"
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === "signup"}
                    onClick={() => {
                      setMode("signup");
                      setError("");
                    }}
                    className={`relative cursor-pointer rounded-xl py-2 text-xs font-bold transition-colors ${
                      mode === "signup"
                        ? "bg-card text-primary"
                        : "text-secondary hover:text-on-surface"
                    }`}
                  >
                    <span>Start Free Studio</span>
                    <span className="ml-1.5 hidden rounded-full bg-success px-1.5 py-0.5 text-[10px] font-semibold text-on-primary sm:inline">
                      5 Free
                    </span>
                  </button>
                </div>

                <div className="mt-6">
                  <h2 className="font-syne text-2xl font-bold tracking-tight text-on-surface sm:text-3xl">
                    {mode === "signup"
                      ? "Create your store workspace"
                      : "Welcome back"}
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-secondary">
                    {mode === "signup"
                      ? "Enroll your e-commerce brand to get 5 free commercial photoshoots instantly."
                      : "Sign in with your store credentials to access your catalog sessions."}
                  </p>
                </div>

                {targetRedirect && (
                  <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-primary/20 bg-soft-blush p-3 text-xs font-medium text-primary">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Sign in required to access workspace:{" "}
                      <b>{targetRedirect}</b>
                    </span>
                  </div>
                )}

                {/* Form */}
                <form onSubmit={submit} className="mt-5 space-y-3.5">
                  {mode === "signup" && (
                    <div>
                      <label
                        htmlFor="store-name-input"
                        className="block text-xs font-semibold text-on-surface"
                      >
                        Store or Brand Name
                      </label>
                      <div className="relative mt-1.5">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-secondary">
                          <Store className="h-4 w-4" />
                        </div>
                        <input
                          id="store-name-input"
                          autoFocus
                          required
                          type="text"
                          value={storeName}
                          onChange={(e) => setStoreName(e.target.value)}
                          placeholder="e.g. Silk & Stone, Myntra Trendz"
                          className="h-11 w-full rounded-xl border border-outline-variant/70 bg-card pl-10 pr-4 text-sm text-on-surface outline-none transition-colors placeholder:text-secondary/50 focus:border-primary focus:ring-4 focus:ring-primary/10"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="email-input"
                      className="block text-xs font-semibold text-on-surface"
                    >
                      Work Email Address
                    </label>
                    <div className="relative mt-1.5">
                      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-secondary">
                        <Mail className="h-4 w-4" />
                      </div>
                      <input
                        id="email-input"
                        autoFocus={mode === "signin"}
                        required
                        type="email"
                        autoComplete="username"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@store.com"
                        className="h-11 w-full rounded-xl border border-outline-variant/70 bg-card pl-10 pr-4 text-sm text-on-surface outline-none transition-colors placeholder:text-secondary/50 focus:border-primary focus:ring-4 focus:ring-primary/10"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="password-input"
                      className="block text-xs font-semibold text-on-surface"
                    >
                      Password
                    </label>
                    <div className="relative mt-1.5">
                      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-secondary">
                        <Lock className="h-4 w-4" />
                      </div>
                      <input
                        id="password-input"
                        required
                        type={showPassword ? "text" : "password"}
                        autoComplete={
                          mode === "signup"
                            ? "new-password"
                            : "current-password"
                        }
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={
                          mode === "signup"
                            ? "Create a secure password (min 6 chars)"
                            : "Enter your password"
                        }
                        className="h-11 w-full rounded-xl border border-outline-variant/70 bg-card pl-10 pr-12 text-sm text-on-surface outline-none transition-colors placeholder:text-secondary/50 focus:border-primary focus:ring-4 focus:ring-primary/10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((val) => !val)}
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-lg p-2 text-secondary transition-colors hover:bg-surface-container hover:text-on-surface"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div
                      role="alert"
                      className="flex items-start gap-2.5 rounded-xl border border-danger/20 bg-danger-surface p-3.5 text-xs font-medium text-danger"
                    >
                      <span className="font-bold">Error:</span>
                      <span>{error}</span>
                    </div>
                  )}

                  <button
                    disabled={submitting}
                    type="submit"
                    className="group relative mt-2 flex h-12 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl bg-primary px-5 text-sm font-bold text-on-primary transition-colors duration-200 hover:bg-primary-container active:bg-rose-dark disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                        <span>
                          {mode === "signup"
                            ? "Creating store & claiming free shoots…"
                            : "Signing in to Studio…"}
                        </span>
                      </>
                    ) : (
                      <>
                        <span>
                          {mode === "signup"
                            ? "Create Store & Claim 5 Free Shoots"
                            : "Sign in to Studio"}
                        </span>
                        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none" />
                      </>
                    )}
                  </button>
                </form>

                {/* Public Documentation Portal Link */}
                <div className="mt-5 flex flex-col items-center gap-2 border-t border-outline-variant/40 pt-3.5">
                  <Link
                    to="/docs"
                    className="group inline-flex items-center gap-2 rounded-lg px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-soft-blush"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    <span>Explore Public Documentation & Guides</span>
                    <span className="rounded-full bg-soft-blush px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-primary">
                      v2.4
                    </span>
                  </Link>
                </div>

                {/* Trust and Security Card */}
                <div className="mt-3.5 flex items-start gap-2.5 rounded-xl border border-outline-variant/30 bg-surface-container-low/70 p-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <p className="text-[11px] leading-relaxed text-secondary">
                    Protected by Firebase Auth and isolated tenant storage. Each
                    store’s catalog data is strictly segregated by Supabase Row
                    Level Security, with 24-hour session expiration.
                  </p>
                </div>
              </div>
            </div>

            <div className="pointer-events-auto lg:col-start-1 lg:row-start-2">
              <dl className="grid max-w-xl grid-cols-3 gap-6 border-t border-outline-variant/60 pt-5">
                {HERO_FACTS.map(([value, label]) => (
                  <div key={label} className="flex flex-col-reverse">
                    <dt className="mt-1 text-xs font-medium leading-snug text-secondary">
                      {label}
                    </dt>
                    <dd className="font-syne text-3xl font-bold tracking-tighter text-on-surface xl:text-4xl">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
                <span className="inline-flex items-center gap-1.5 font-bold text-on-surface">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  5 Free Shoots on Enrollment
                </span>
                <a
                  href="#workflow"
                  onClick={jumpTo("workflow")}
                  className="inline-flex items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline"
                >
                  See how a shoot runs
                  <ArrowDown className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Below the fold the runway is covered, so its cursor tracking is parked */}
        <div data-surfer-ignore="true">
          <LoginShowcase onStart={openAuth} />
        </div>
      </div>
    </main>
  );
}
