import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { ArrowRight, BookOpen, CheckCircle2, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck, Sparkles, Store } from "lucide-react";
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "signup") {
        const cleanStoreName = storeName.trim();
        if (cleanStoreName.length < 2) {
          throw new Error("Please enter your store or brand name (minimum 2 characters).");
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
          console.warn("Initial enrollment RPC notice, falling back to onboarding modal:", rpcError.message);
        }
        window.dispatchEvent(new Event("workspace-refresh"));
      } else {
        await signIn(email, password);
      }
      if (targetRedirect && targetRedirect !== "/") {
        navigate(targetRedirect, { replace: true });
      }
    } catch (reason) {
      setError(getErrorMessage(reason, mode === "signup" ? "Could not enroll store." : "Could not sign in."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#faf8f5] text-on-background selection:bg-primary/20 selection:text-primary">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute -left-44 -top-40 h-[620px] w-[620px] rounded-full bg-gradient-to-br from-primary/10 via-amber-200/10 to-transparent blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 right-[-6rem] h-[640px] w-[640px] rounded-full bg-gradient-to-tl from-tertiary/10 via-rose-200/10 to-transparent blur-3xl" />

      <div className="relative mx-auto grid min-h-screen max-w-[1540px] items-stretch lg:grid-cols-[1.08fr_0.92fr]">
        {/* Left Hero Section: Editorial Brand Atmosphere & Real Photo Showcase */}
        <section className="hidden flex-col justify-between p-10 lg:flex xl:p-14">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Youthnic" className="h-14 w-14 object-contain" />
            <div>
              <span className="font-syne text-2xl font-bold tracking-tight text-on-surface">Youthnic</span>
              <span className="block text-[9px] font-bold uppercase tracking-[0.24em] text-primary">AI Studio Atelier</span>
            </div>
          </div>

          <div className="max-w-2xl py-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-white/80 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-primary shadow-sm backdrop-blur-md">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>Multi-Tenant Fashion Studio · AaaS</span>
            </div>

            <h1 className="mt-6 font-syne text-4xl font-extrabold leading-[1.08] tracking-[-0.035em] text-on-surface xl:text-5xl">
              One product.<br />
              One model.<br />
              <span className="bg-gradient-to-r from-primary via-[#b81059] to-[#be185d] bg-clip-text text-transparent">
                One perfect shoot.
              </span>
            </h1>

            <p className="mt-4 max-w-xl text-sm leading-relaxed text-secondary font-medium">
              Transform product photos into high-fashion e-commerce catalog shoots. Locked product truth, natural studio lighting, and automated CV QA.
            </p>

            {/* Editorial Fashion Gallery Strip */}
            <div className="mt-6 grid grid-cols-4 gap-3">
              {[
                { src: "/images/editorial/editorial-ref-1.webp", label: "Studio Set" },
                { src: "/images/editorial/editorial-saree-front.webp", label: "Hero Front" },
                { src: "/images/editorial/editorial-saree-back.webp", label: "True Back" },
                { src: "/images/editorial/editorial-saree-detail.webp", label: "Craft Detail" },
              ].map(({ src, label }) => (
                <div key={label} className="group relative aspect-[3/4] overflow-hidden rounded-2xl border border-white/80 bg-stone-100 shadow-sm transition hover:shadow-md">
                  <img
                    src={src}
                    alt={label}
                    className="h-full w-full object-cover object-top transition duration-500 group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 text-center">
                    <span className="text-[10px] font-bold text-white drop-shadow-sm">{label}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Commercial Pricing Transparency */}
            <div className="mt-6 flex flex-wrap items-center gap-2 rounded-2xl border border-outline-variant/50 bg-white/85 p-3.5 shadow-sm backdrop-blur-md text-xs">
              <div className="flex items-center gap-1.5 font-bold text-on-surface">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>5 Free Shoots on Enrollment</span>
              </div>
              <span className="text-secondary/40">·</span>
              <span className="text-secondary">
                Commercial rate: <b>$1.00</b> / shoot (High Reasoning) + <b>$0.50</b> with CV QA
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-outline-variant/30 pt-4 text-xs text-secondary">
            <p>Youthnic AI Studio · Production Cloud Portal</p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-semibold text-secondary shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> All Systems Online
            </span>
          </div>
        </section>

        {/* Right Section: Glassmorphic Auth Form */}
        <section className="grid min-h-screen place-items-center p-5 sm:p-10 lg:p-12">
          <div className="w-full max-w-[480px] rounded-[32px] border border-white/90 bg-white/95 p-8 shadow-[0_24px_80px_rgba(67,35,47,0.09)] backdrop-blur-2xl transition-all sm:p-10">
            {/* Mobile Header */}
            <div className="mb-6 flex items-center justify-between lg:hidden">
              <div className="flex items-center gap-2.5">
                <img src="/logo.png" alt="Youthnic" className="h-11 w-11 object-contain" />
                <div>
                  <span className="font-syne text-lg font-bold text-on-surface">Youthnic</span>
                  <span className="block text-[8px] font-bold uppercase tracking-[0.2em] text-primary">AI Studio</span>
                </div>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 border border-emerald-200">
                5 Free Shoots
              </span>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="grid grid-cols-2 rounded-2xl bg-surface-container-low p-1.5 border border-outline-variant/40">
              <button
                type="button"
                onClick={() => { setMode("signin"); setError(""); }}
                className={`rounded-xl py-2 text-xs font-bold transition-all ${
                  mode === "signin"
                    ? "bg-white text-on-surface shadow-sm"
                    : "text-secondary hover:text-on-surface"
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => { setMode("signup"); setError(""); }}
                className={`relative rounded-xl py-2 text-xs font-bold transition-all ${
                  mode === "signup"
                    ? "bg-white text-primary shadow-sm"
                    : "text-secondary hover:text-on-surface"
                }`}
              >
                <span>Start Free Studio</span>
                <span className="ml-1 rounded-full bg-emerald-500 px-1.5 py-0.2 text-[9px] text-white">5 Free</span>
              </button>
            </div>

            <div className="mt-6">
              <h2 className="font-syne text-2xl font-bold tracking-tight text-on-surface sm:text-3xl">
                {mode === "signup" ? "Create your store workspace" : "Welcome back"}
              </h2>
              <p className="mt-1 text-xs text-secondary leading-relaxed">
                {mode === "signup"
                  ? "Enroll your e-commerce brand to get 5 free commercial photoshoots instantly."
                  : "Sign in with your store credentials to access your catalog sessions."}
              </p>
            </div>

            {targetRedirect && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs font-medium text-primary">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Sign in required to access workspace: <b>{targetRedirect}</b></span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={submit} className="mt-6 space-y-3.5">
              {mode === "signup" && (
                <div>
                  <label htmlFor="store-name-input" className="block text-xs font-bold uppercase tracking-wider text-secondary">
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
                      className="h-11 w-full rounded-xl border border-outline-variant/70 bg-white/90 pl-10 pr-4 text-sm text-on-surface outline-none transition-all placeholder:text-secondary/50 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="email-input" className="block text-xs font-bold uppercase tracking-wider text-secondary">
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
                    className="h-11 w-full rounded-xl border border-outline-variant/70 bg-white/90 pl-10 pr-4 text-sm text-on-surface outline-none transition-all placeholder:text-secondary/50 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password-input" className="block text-xs font-bold uppercase tracking-wider text-secondary">
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
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "signup" ? "Create a secure password (min 6 chars)" : "Enter your password"}
                    className="h-11 w-full rounded-xl border border-outline-variant/70 bg-white/90 pl-10 pr-12 text-sm text-on-surface outline-none transition-all placeholder:text-secondary/50 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((val) => !val)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-secondary transition hover:bg-surface-container hover:text-on-surface"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-danger/20 bg-danger-surface p-3.5 text-xs font-medium text-danger animate-in fade-in">
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
                    <span>{mode === "signup" ? "Creating store & claiming free shoots…" : "Signing in to Studio…"}</span>
                  </>
                ) : (
                  <>
                    <span>{mode === "signup" ? "Create Store & Claim 5 Free Shoots" : "Sign in to Studio"}</span>
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
                <span className="rounded-full bg-primary/10 px-1.5 py-0.2 text-[9px] font-bold text-primary">v2.4</span>
              </Link>
            </div>

            {/* Trust and Security Card */}
            <div className="mt-3.5 flex items-start gap-2.5 rounded-xl border border-outline-variant/30 bg-surface-container-low/70 p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p className="text-[11px] leading-relaxed text-secondary">
                Protected by Firebase Auth and isolated tenant storage. Each store's catalog data is strictly segregated by Supabase Row Level Security.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
