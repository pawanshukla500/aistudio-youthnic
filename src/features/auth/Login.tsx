import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
  Store,
} from "lucide-react";
import {
  CollectionSurfer,
  type CollectionSurferVariant,
} from "../../components/ui/collection-surfer";
import { getErrorMessage } from "../../lib/errors";
import { useFirebaseAuth } from "../../lib/FirebaseAuthContext";
import { supabase } from "../../lib/supabase";

interface LoginProps {
  redirect?: string;
}

export function Login({ redirect }: LoginProps) {
  const { signIn, signUp } = useFirebaseAuth();
  const navigate = useNavigate();
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

  // Interactive 3D Runway Controls (Light Atelier Floating Glass)
  const [surferVariant, setSurferVariant] =
    useState<CollectionSurferVariant>("magnetic");
  const [autoGlide, setAutoGlide] = useState(true);

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

  return (
    <main className="relative min-h-screen bg-background text-on-background selection:bg-primary/15 selection:text-primary">
      {/* Layer 0: Full-Viewport 3D Collection Surfer Runway */}
      <CollectionSurfer
        variant={surferVariant}
        autoPlay={autoGlide}
        autoPlaySpeed={46}
        showOverlays={false}
        perspectiveOrigin="16% 22%"
      />

      {/* Layer 1: Warm Daylight Atelier Scrims (Preserves Center 3D Runway Clarity & Text Contrast) */}
      <div className="pointer-events-none fixed inset-0 z-10 bg-gradient-to-r from-background/95 via-background/60 to-background/35" />
      <div className="pointer-events-none fixed inset-0 z-10 bg-gradient-to-b from-background/80 via-transparent to-background/85" />

      {/* Layer 2: Floating Light Atelier Interface */}
      <div className="pointer-events-none fixed inset-0 z-20 overflow-y-auto overscroll-contain">
        <div className="mx-auto grid min-h-screen max-w-[1560px] items-stretch lg:grid-cols-[1.08fr_0.92fr]">
          {/* Left Hero Section: Floating Editorial Overlay on top of the 3D Runway */}
          <section className="hidden flex-col justify-between p-10 lg:flex xl:p-14">
            {/* Top Bar: Brand Identity + Live 3D Runway Controls */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="pointer-events-auto inline-flex items-center gap-3.5 rounded-2xl border border-outline-variant/60 bg-card/90 px-4 py-2.5 backdrop-blur-xl">
                <img
                  src="/logo.png"
                  alt="Youthnic"
                  className="h-11 w-11 object-contain"
                />
                <div>
                  <span className="font-syne text-xl font-bold tracking-tight text-on-surface">
                    Youthnic
                  </span>
                  <span className="block text-xs font-semibold text-primary">
                    AI Studio Atelier
                  </span>
                </div>
              </div>

              {/* Interactive 3D Runway Switcher */}
              <div
                data-surfer-ignore="true"
                className="pointer-events-auto inline-flex items-center gap-1 rounded-2xl border border-outline-variant/60 bg-card/90 p-1.5 text-xs text-secondary backdrop-blur-xl"
              >
                <span className="px-2.5 font-medium text-secondary">
                  3D Runway
                </span>
                {(["magnetic", "uplift"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={surferVariant === v}
                    onClick={() => setSurferVariant(v)}
                    className={`cursor-pointer rounded-xl px-2.5 py-1 font-semibold capitalize transition-colors ${
                      surferVariant === v
                        ? "bg-primary text-on-primary"
                        : "text-secondary hover:bg-surface-container hover:text-on-surface"
                    }`}
                  >
                    {v}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={autoGlide}
                  onClick={() => setAutoGlide((prev) => !prev)}
                  aria-label={
                    autoGlide ? "Pause runway glide" : "Play runway glide"
                  }
                  className="ml-0.5 inline-flex cursor-pointer items-center gap-1 rounded-xl border border-outline-variant/50 bg-surface-container-low px-2.5 py-1 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container"
                >
                  {autoGlide ? (
                    <>
                      <Pause className="h-3 w-3 text-primary" />
                      <span>Glide</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3 text-success" />
                      <span>Paused</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Center-Left Editorial Headline & Studio Telemetry */}
            <div className="my-auto max-w-xl py-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-outline-variant/70 bg-soft-blush/90 px-3.5 py-1.5 text-xs font-semibold text-primary backdrop-blur-md">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>Multi-Tenant Fashion Studio (AaaS)</span>
              </div>

              <h1 className="mt-5 font-syne text-4xl font-extrabold leading-[1.06] tracking-tighter text-on-surface xl:text-[3.4rem]">
                One product.
                <br />
                One model.
                <br />
                <span className="text-primary">One perfect shoot.</span>
              </h1>

              <p className="mt-4 max-w-lg text-base font-medium leading-relaxed text-secondary">
                Transform product photos into high-fashion e-commerce catalog
                shoots. Locked product truth, natural studio lighting, and
                automated CV QA across every frame.
              </p>

              {/* Commercial Pricing Transparency */}
              <div className="mt-6 inline-flex flex-wrap items-center gap-2.5 rounded-2xl border border-outline-variant/60 bg-card/90 px-4 py-3 text-xs text-secondary backdrop-blur-xl">
                <div className="flex items-center gap-1.5 font-bold text-on-surface">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <span>5 Free Shoots on Enrollment</span>
                </div>
                <span className="text-outline-variant" aria-hidden="true">
                  /
                </span>
                <span>
                  Commercial rate:{" "}
                  <b className="font-mono tabular-nums text-on-surface">
                    $1.00
                  </b>{" "}
                  / shoot (High Reasoning) +{" "}
                  <b className="font-mono tabular-nums text-on-surface">
                    $0.50
                  </b>{" "}
                  with CV QA
                </span>
              </div>
            </div>

            {/* Bottom Status Footer */}
            <div className="flex items-center justify-between border-t border-outline-variant/50 pt-4 text-xs text-secondary">
              <p className="font-medium">
                Youthnic AI Studio, Production Cloud Portal
              </p>
              <div className="flex items-center gap-3">
                <span className="font-medium text-secondary">
                  Scroll or move cursor to surf{" "}
                  <span className="font-mono tabular-nums text-on-surface">
                    16
                  </span>{" "}
                  looks
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/60 bg-card/90 px-3 py-1 text-xs font-semibold text-on-surface backdrop-blur-md">
                  <span className="h-2 w-2 rounded-full bg-success" />
                  <span>All Systems Online</span>
                </span>
              </div>
            </div>
          </section>

          {/* Right Section: Floating Light Atelier Auth Card */}
          <section className="grid min-h-screen place-items-center p-4 sm:p-8 lg:p-10">
            <div
              data-surfer-ignore="true"
              onWheel={(e) => e.stopPropagation()}
              className="pointer-events-auto w-full max-w-[485px] rounded-[34px] border border-outline-variant/60 bg-surface-container-low/65 p-1.5 backdrop-blur-2xl"
            >
              <div className="w-full rounded-[28px] border border-outline-variant/45 bg-card/95 p-7 backdrop-blur-2xl transition-colors sm:p-9">
                {/* Mobile Header */}
                <div className="mb-6 flex items-center justify-between gap-2 lg:hidden">
                  <div className="flex items-center gap-2.5">
                    <img
                      src="/logo.png"
                      alt="Youthnic"
                      className="h-10 w-10 object-contain"
                    />
                    <div>
                      <span className="font-syne text-lg font-bold text-on-surface">
                        Youthnic
                      </span>
                      <span className="block text-xs font-semibold text-primary">
                        AI Studio
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-pressed={autoGlide}
                      onClick={() => setAutoGlide((prev) => !prev)}
                      aria-label={
                        autoGlide ? "Pause runway glide" : "Play runway glide"
                      }
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-outline-variant/60 bg-card px-2.5 py-1 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container"
                    >
                      {autoGlide ? (
                        <>
                          <Pause className="h-3 w-3 text-primary" />
                          <span>Glide</span>
                        </>
                      ) : (
                        <>
                          <Play className="h-3 w-3 text-success" />
                          <span>Paused</span>
                        </>
                      )}
                    </button>
                    <span className="rounded-full border border-outline-variant/50 bg-success-surface px-2.5 py-1 text-xs font-semibold text-success">
                      5 Free Shoots
                    </span>
                  </div>
                </div>

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
                    <span className="ml-1.5 rounded-full bg-success px-1.5 py-0.5 text-[10px] font-semibold text-on-primary">
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
          </section>
        </div>
      </div>
    </main>
  );
}
