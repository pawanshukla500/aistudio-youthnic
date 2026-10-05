import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { ArrowRight, BookOpen, CheckCircle2, Eye, EyeOff, Images, Loader2, Lock, LockKeyhole, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { getErrorMessage } from "../../lib/errors";
import { useFirebaseAuth } from "../../lib/FirebaseAuthContext";

interface LoginProps {
  redirect?: string;
}

export function Login({ redirect }: LoginProps) {
  const { signIn } = useFirebaseAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetRedirect = redirect || searchParams.get("redirect") || "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await signIn(email, password);
      if (targetRedirect && targetRedirect !== "/") {
        navigate(targetRedirect, { replace: true });
      }
    } catch (reason) {
      setError(getErrorMessage(reason, "Could not sign in."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#faf7f5] text-on-background selection:bg-primary/20 selection:text-primary">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute -left-44 -top-40 h-[620px] w-[620px] rounded-full bg-gradient-to-br from-primary/12 via-rose-300/10 to-transparent blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 right-[-6rem] h-[640px] w-[640px] rounded-full bg-gradient-to-tl from-tertiary/10 via-amber-200/10 to-transparent blur-3xl" />
      <div className="pointer-events-none absolute left-1/3 top-1/2 h-[450px] w-[450px] -translate-y-1/2 rounded-full bg-pink-100/20 blur-3xl" />

      <div className="relative mx-auto grid min-h-screen max-w-[1540px] items-stretch lg:grid-cols-[1.08fr_0.92fr]">
        {/* Left Hero Section: Editorial Brand Atmosphere */}
        <section className="hidden flex-col justify-between p-12 lg:flex xl:p-16">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Youthnic" className="h-16 w-16 object-contain" />
            <div>
              <span className="font-syne text-2xl font-bold tracking-tight text-on-surface">Youthnic</span>
              <span className="block text-[9px] font-bold uppercase tracking-[0.24em] text-primary">AI Studio Atelier</span>
            </div>
          </div>

          <div className="max-w-2xl py-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-white/75 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-primary shadow-sm backdrop-blur-md">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>AI Fashion Catalog Production</span>
            </div>

            <h1 className="mt-8 font-syne text-5xl font-extrabold leading-[1.06] tracking-[-0.035em] text-on-surface xl:text-6xl">
              One product.<br />
              One model.<br />
              <span className="bg-gradient-to-r from-primary via-[#b81059] to-[#be185d] bg-clip-text text-transparent">
                One perfect shoot.
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-secondary font-medium">
              Transform product references into high-fashion, multi-angle e-commerce catalog photoshoots with full product identity locking, studio scene coherence, and automated QA verification.
            </p>

            <div className="mt-10 grid max-w-xl gap-3 sm:grid-cols-3">
              {[
                { icon: Images, title: "Reference-locked", detail: "Exact garment & pattern truth" },
                { icon: ShieldCheck, title: "Role-controlled", detail: "Workspace & permissions RLS" },
                { icon: CheckCircle2, title: "QA-validated", detail: "Gemini vision fidelity verified" },
              ].map(({ icon: Icon, title, detail }) => (
                <div
                  key={title}
                  className="group rounded-2xl border border-white/80 bg-white/65 p-4 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-white/85 hover:shadow-md"
                >
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-soft-blush text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <p className="mt-3.5 text-sm font-bold text-on-surface">{title}</p>
                  <p className="mt-1 text-[11px] leading-snug text-secondary">{detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-outline-variant/30 pt-6 text-xs text-secondary">
            <p>Youthnic AI Studio · Production Portal</p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-semibold text-secondary shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> System operational
            </span>
          </div>
        </section>

        {/* Right Section: Glassmorphic Auth Form */}
        <section className="grid min-h-screen place-items-center p-5 sm:p-10 lg:p-12">
          <div className="w-full max-w-[490px] rounded-[32px] border border-white/90 bg-white/95 p-8 shadow-[0_24px_80px_rgba(67,35,47,0.1)] backdrop-blur-2xl transition-all sm:p-11">
            {/* Mobile Header */}
            <div className="mb-8 flex items-center justify-between lg:hidden">
              <div className="flex items-center gap-2.5">
                <img src="/logo.png" alt="Youthnic" className="h-12 w-12 object-contain" />
                <div>
                  <span className="font-syne text-lg font-bold text-on-surface">Youthnic</span>
                  <span className="block text-[8px] font-bold uppercase tracking-[0.2em] text-primary">AI Studio</span>
                </div>
              </div>
              <span className="rounded-full bg-success-surface px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-success border border-success/20">
                Secure Portal
              </span>
            </div>

            {/* Card Header Icon & Badge */}
            <div className="flex items-center justify-between">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-tr from-soft-blush to-white text-primary shadow-sm border border-primary/10">
                <LockKeyhole className="h-5 w-5" />
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-primary/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                Private Workspace
              </span>
            </div>

            <h2 className="mt-6 font-syne text-3xl font-bold tracking-tight text-on-surface">
              Welcome back
            </h2>
            <p className="mt-1.5 text-xs text-secondary leading-relaxed">
              Sign in with your enterprise credentials to access your catalog sessions and planning workflows.
            </p>

            {targetRedirect && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs font-medium text-primary">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Sign in required to access workspace: <b>{targetRedirect}</b></span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={submit} className="mt-7 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-secondary">
                  Email Address
                </label>
                <div className="relative mt-2">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-secondary">
                    <Mail className="h-4 w-4" />
                  </div>
                  <input
                    autoFocus
                    required
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@company.com"
                    className="h-12 w-full rounded-xl border border-outline-variant/70 bg-white/90 pl-10 pr-4 text-sm text-on-surface outline-none transition-all placeholder:text-secondary/50 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-secondary">
                  Password
                </label>
                <div className="relative mt-2">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-secondary">
                    <Lock className="h-4 w-4" />
                  </div>
                  <input
                    required
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    className="h-12 w-full rounded-xl border border-outline-variant/70 bg-white/90 pl-10 pr-12 text-sm text-on-surface outline-none transition-all placeholder:text-secondary/50 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
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
                className="group relative mt-2 flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-primary via-[#b81059] to-[#be185d] px-5 text-sm font-bold text-white shadow-lg shadow-primary/25 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-primary/35 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Signing in to Studio…</span>
                  </>
                ) : (
                  <>
                    <span>Sign in to Studio</span>
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </form>

            {/* Public Documentation Portal Link */}
            <div className="mt-6 flex flex-col items-center gap-2.5 border-t border-outline-variant/40 pt-4">
              <Link
                to="/docs"
                className="group inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/5"
              >
                <BookOpen className="h-4 w-4 transition-transform group-hover:scale-110" />
                <span>Explore Public Documentation & Guides</span>
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">v2.4</span>
              </Link>
            </div>

            {/* Trust and Security Card */}
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-outline-variant/30 bg-surface-container-low/70 p-3.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <p className="text-[11px] leading-relaxed text-secondary">
                Protected by Firebase Auth session tokens. Organization role-level security (RLS) is strictly enforced on all queries and mutations.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
