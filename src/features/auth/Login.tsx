import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Lock,
  Mail,
  MousePointerClick,
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
  const targetRedirect = redirect || searchParams.get("redirect") || "";

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [storeName, setStoreName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Interactive 3D Runway Controls (Option 2: Luxury Floating Glass Atelier)
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
    <main className="relative min-h-screen bg-[#070609] text-on-background selection:bg-primary/20 selection:text-primary">
      {/* Layer 0: Full-Viewport 3D Collection Surfer Runway */}
      <CollectionSurfer
        variant={surferVariant}
        autoPlay={autoGlide}
        autoPlaySpeed={46}
        showOverlays={false}
        perspectiveOrigin="16% 22%"
      />

      {/* Layer 1: Sculpted Radial & Cinema Lighting Scrims (Preserves Center 3D Runway Clarity) */}
      <div className="pointer-events-none fixed inset-0 z-10 bg-[radial-gradient(ellipse_at_16%_50%,rgba(7,6,9,0.88)_0%,rgba(7,6,9,0.42)_46%,transparent_76%)]" />
      <div className="pointer-events-none fixed inset-0 z-10 bg-[radial-gradient(circle_at_80%_50%,rgba(151,0,70,0.22)_0%,rgba(7,6,9,0.68)_58%,transparent_100%)]" />
      <div className="pointer-events-none fixed inset-0 z-10 bg-[linear-gradient(to_bottom,rgba(7,6,9,0.72)_0%,transparent_22%,transparent_78%,rgba(7,6,9,0.85)_100%)]" />

      {/* Layer 2: Floating Glass Atelier Interface */}
      <div className="pointer-events-none fixed inset-0 z-20 overflow-y-auto lg:overflow-hidden">
        <div className="mx-auto grid min-h-screen max-w-[1560px] items-stretch lg:grid-cols-[1.08fr_0.92fr]">
          {/* Left Hero Section: Floating Editorial Overlay on top of the 3D Runway */}
          <section className="hidden flex-col justify-between p-10 lg:flex xl:p-14">
            {/* Top Bar: Brand Identity + Live 3D Runway Controls */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="pointer-events-auto inline-flex items-center gap-3.5 rounded-2xl border border-white/15 bg-black/55 px-4 py-2.5 shadow-[0_16px_40px_rgba(0,0,0,0.6),inset_0_1px_0_0_rgba(255,255,255,0.18)] backdrop-blur-xl">
                <img
                  src="/logo.png"
                  alt="Youthnic"
                  className="h-11 w-11 object-contain"
                />
                <div>
                  <span className="font-syne text-xl font-bold tracking-tight text-white">
                    Youthnic
                  </span>
                  <span className="block text-[9px] font-bold uppercase tracking-[0.24em] text-[#ff7aa8]">
                    AI Studio Atelier
                  </span>
                </div>
              </div>

              {/* Interactive 3D Runway Switcher */}
              <div
                data-surfer-ignore="true"
                className="pointer-events-auto inline-flex items-center gap-1 rounded-2xl border border-white/15 bg-black/60 p-1.5 text-[11px] text-white/80 shadow-[0_16px_40px_rgba(0,0,0,0.6),inset_0_1px_0_0_rgba(255,255,255,0.15)] backdrop-blur-xl"
              >
                <span className="px-2.5 font-mono text-[10px] uppercase tracking-wider text-white/50">
                  3D Runway
                </span>
                {(["magnetic", "uplift"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={surferVariant === v}
                    onClick={() => setSurferVariant(v)}
                    className={`rounded-xl px-2.5 py-1 font-semibold capitalize transition-all cursor-pointer ${
                      surferVariant === v
                        ? "bg-[#970046] text-white shadow-sm"
                        : "text-white/70 hover:bg-white/10 hover:text-white"
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
                  className="ml-0.5 inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-white/85 transition hover:bg-white/15 cursor-pointer"
                >
                  {autoGlide ? (
                    <>
                      <Pause className="h-3 w-3 text-[#ff7aa8]" />
                      <span>Glide</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3 text-emerald-400" />
                      <span>Paused</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Center-Left Editorial Headline & Studio Telemetry */}
            <div className="my-auto max-w-xl py-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#ff7aa8]/35 bg-[#970046]/30 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[#ffb8d0] shadow-lg backdrop-blur-xl">
                <Sparkles className="h-3.5 w-3.5 text-[#ff7aa8]" />
                <span>Multi-Tenant Fashion Studio · AaaS</span>
              </div>

              <h1 className="mt-5 font-syne text-4xl font-extrabold leading-[1.06] tracking-[-0.035em] text-white drop-shadow-[0_10px_30px_rgba(0,0,0,0.85)] xl:text-[3.4rem]">
                One product.
                <br />
                One model.
                <br />
                <span className="bg-gradient-to-r from-[#ff7aa8] via-[#ffb1c9] to-amber-200 bg-clip-text text-transparent">
                  One perfect shoot.
                </span>
              </h1>

              <p className="mt-4 max-w-lg text-sm font-medium leading-relaxed text-white/85 drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">
                Transform product photos into high-fashion e-commerce catalog
                shoots. Locked product truth, natural studio lighting, and
                automated CV QA.
              </p>

              {/* Compact 4-Angle Studio Proof Dock */}
              <div className="mt-6 inline-flex flex-col gap-2.5 rounded-2xl border border-white/15 bg-black/60 p-3 shadow-[0_20px_50px_rgba(0,0,0,0.7),inset_0_1px_0_0_rgba(255,255,255,0.14)] backdrop-blur-xl">
                <div className="flex items-center justify-between gap-4 px-1">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#ff8ab5]">
                    <Layers className="h-3 w-3" />
                    <span>Locked 6-Pose Production Pipeline</span>
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] text-white/65">
                    <MousePointerClick className="h-3 w-3 text-[#ff7aa8]" />
                    <span>Move cursor or scroll to surf</span>
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2.5 max-w-[420px]">
                  {[
                    {
                      src: "/images/editorial/editorial-ref-1.webp",
                      label: "Studio Set",
                      idx: "01",
                    },
                    {
                      src: "/images/editorial/editorial-saree-front.webp",
                      label: "Hero Front",
                      idx: "02",
                    },
                    {
                      src: "/images/editorial/editorial-saree-back.webp",
                      label: "True Back",
                      idx: "03",
                    },
                    {
                      src: "/images/editorial/editorial-saree-detail.webp",
                      label: "Craft Detail",
                      idx: "04",
                    },
                  ].map(({ src, label, idx }) => (
                    <div
                      key={label}
                      className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-white/20 bg-neutral-900 shadow-md"
                    >
                      <img
                        src={src}
                        alt={label}
                        className="h-full w-full object-cover object-top"
                        loading="lazy"
                      />
                      <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1 py-0.2 font-mono text-[8px] font-bold text-white/80 backdrop-blur-sm">
                        {idx}
                      </span>
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent p-1.5 text-center">
                        <span className="text-[9px] font-bold tracking-wide text-white">
                          {label}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Commercial Pricing Transparency */}
              <div className="mt-5 inline-flex flex-wrap items-center gap-2 rounded-2xl border border-white/15 bg-black/65 px-4 py-3 text-xs text-white/90 shadow-xl backdrop-blur-xl">
                <div className="flex items-center gap-1.5 font-bold text-white">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span>5 Free Shoots on Enrollment</span>
                </div>
                <span className="text-white/30">·</span>
                <span className="text-white/80">
                  Commercial rate: <b className="text-white">$1.00</b> / shoot
                  (High Reasoning) + <b className="text-white">$0.50</b> with CV
                  QA
                </span>
              </div>
            </div>

            {/* Bottom Status Footer */}
            <div className="flex items-center justify-between border-t border-white/15 pt-4 text-xs text-white/70">
              <p className="font-medium tracking-wide">
                Youthnic AI Studio · Production Cloud Portal
              </p>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">
                  Scroll to surf 16 looks
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3 py-1 text-[10px] font-semibold text-white/90 shadow-sm backdrop-blur-md">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />{" "}
                  All Systems Online
                </span>
              </div>
            </div>
          </section>

          {/* Right Section: Floating Luxury Double-Bezel Frosted-Glass Atelier Auth Card */}
          <section className="grid min-h-screen place-items-center p-4 sm:p-8 lg:p-10">
            <div
              data-surfer-ignore="true"
              onWheel={(e) => e.stopPropagation()}
              className="pointer-events-auto w-full max-w-[485px] rounded-[36px] border border-white/25 bg-gradient-to-b from-white/25 via-white/10 to-white/5 p-1.5 shadow-[0_36px_120px_rgba(0,0,0,0.85),0_0_60px_rgba(151,0,70,0.2)] backdrop-blur-2xl"
            >
              <div className="w-full rounded-[30px] border border-white/95 bg-[#faf8f5]/96 p-7 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9)] backdrop-blur-2xl transition-all sm:p-9">
                {/* Mobile Header */}
                <div className="mb-6 flex items-center justify-between lg:hidden">
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
                      <span className="block text-[8px] font-bold uppercase tracking-[0.2em] text-primary">
                        AI Studio
                      </span>
                    </div>
                  </div>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    5 Free Shoots
                  </span>
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
                    className={`rounded-xl py-2 text-xs font-bold transition-all cursor-pointer ${
                      mode === "signin"
                        ? "bg-white text-on-surface shadow-sm"
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
                    className={`relative rounded-xl py-2 text-xs font-bold transition-all cursor-pointer ${
                      mode === "signup"
                        ? "bg-white text-primary shadow-sm"
                        : "text-secondary hover:text-on-surface"
                    }`}
                  >
                    <span>Start Free Studio</span>
                    <span className="ml-1 rounded-full bg-emerald-500 px-1.5 py-0.2 text-[9px] text-white">
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
                  <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs font-medium text-primary">
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
                        className="block text-xs font-bold uppercase tracking-wider text-secondary"
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
                          className="h-11 w-full rounded-xl border border-outline-variant/70 bg-white pl-10 pr-4 text-sm text-on-surface outline-none transition-all placeholder:text-secondary/50 focus:border-primary focus:ring-4 focus:ring-primary/10"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="email-input"
                      className="block text-xs font-bold uppercase tracking-wider text-secondary"
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
                        className="h-11 w-full rounded-xl border border-outline-variant/70 bg-white pl-10 pr-4 text-sm text-on-surface outline-none transition-all placeholder:text-secondary/50 focus:border-primary focus:ring-4 focus:ring-primary/10"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="password-input"
                      className="block text-xs font-bold uppercase tracking-wider text-secondary"
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
                        className="h-11 w-full rounded-xl border border-outline-variant/70 bg-white pl-10 pr-12 text-sm text-on-surface outline-none transition-all placeholder:text-secondary/50 focus:border-primary focus:ring-4 focus:ring-primary/10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((val) => !val)}
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-secondary transition hover:bg-surface-container hover:text-on-surface cursor-pointer"
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
                      className="flex items-start gap-2.5 rounded-xl border border-danger/20 bg-danger-surface p-3.5 text-xs font-medium text-danger animate-in fade-in"
                    >
                      <span className="font-bold">Error:</span>
                      <span>{error}</span>
                    </div>
                  )}

                  <button
                    disabled={submitting}
                    type="submit"
                    className="group relative mt-2 flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-primary via-[#b81059] to-[#be185d] px-5 text-sm font-bold text-white shadow-lg shadow-primary/25 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-primary/35 active:scale-[0.99] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
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
                        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                      </>
                    )}
                  </button>
                </form>

                {/* Public Documentation Portal Link */}
                <div className="mt-5 flex flex-col items-center gap-2 border-t border-outline-variant/40 pt-3.5">
                  <Link
                    to="/docs"
                    className="group inline-flex items-center gap-2 rounded-lg px-3 py-1 text-xs font-semibold text-primary transition hover:bg-primary/5"
                  >
                    <BookOpen className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
                    <span>Explore Public Documentation & Guides</span>
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.2 text-[9px] font-bold text-primary">
                      v2.4
                    </span>
                  </Link>
                </div>

                {/* Trust and Security Card */}
                <div className="mt-3.5 flex items-start gap-2.5 rounded-xl border border-outline-variant/30 bg-surface-container-low/70 p-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <p className="text-[11px] leading-relaxed text-secondary">
                    Protected by Firebase Auth and isolated tenant storage. Each
                    store's catalog data is strictly segregated by Supabase Row
                    Level Security.
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
