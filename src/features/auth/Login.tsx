import { useState } from "react";
import { ArrowRight, CheckCircle2, Eye, EyeOff, Images, Loader2, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { getErrorMessage } from "../../lib/errors";
import { useFirebaseAuth } from "../../lib/FirebaseAuthContext";

export function Login() {
  const { signIn } = useFirebaseAuth();
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
    } catch (reason) {
      setError(getErrorMessage(reason, "Could not sign in."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f7f3f0] text-on-background">
      <div className="absolute -left-36 -top-40 h-[520px] w-[520px] rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute -bottom-56 right-[-8rem] h-[580px] w-[580px] rounded-full bg-tertiary/10 blur-3xl" />
      <div className="relative mx-auto grid min-h-screen max-w-[1500px] items-stretch lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden flex-col justify-between p-12 lg:flex xl:p-16">
          <img src="/logo.png" alt="Youthnic" className="h-20 w-20 object-contain object-left" />
          <div className="max-w-2xl pb-12">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-white/60 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-primary backdrop-blur"><Sparkles className="h-3.5 w-3.5" /> AI catalog production</span>
            <h1 className="mt-8 font-syne text-5xl font-bold leading-[1.05] tracking-[-0.04em] text-on-surface xl:text-6xl">One product.<br />One model.<br /><span className="text-primary">One perfect shoot.</span></h1>
            <p className="mt-7 max-w-xl text-base leading-7 text-secondary">Plan, analyze, generate, and review consistent fashion catalog imagery from one secure production workspace.</p>
            <div className="mt-10 grid max-w-xl gap-3 sm:grid-cols-3">
              {[[Images, "Reference-locked", "Product accuracy"], [ShieldCheck, "Role controlled", "Team access"], [CheckCircle2, "QA validated", "Five-pose sets"]].map(([Icon, title, detail]) => (
                <div key={String(title)} className="rounded-2xl border border-white/70 bg-white/55 p-4 shadow-sm backdrop-blur"><Icon className="h-5 w-5 text-primary" /><p className="mt-4 text-sm font-bold text-on-surface">{String(title)}</p><p className="mt-0.5 text-[11px] text-secondary">{String(detail)}</p></div>
              ))}
            </div>
          </div>
          <p className="text-xs text-secondary">Youthnic AI Studio · Secured by Firebase Auth</p>
        </section>

        <section className="grid min-h-screen place-items-center p-5 sm:p-10 lg:p-12">
          <div className="w-full max-w-[480px] rounded-[28px] border border-white/80 bg-white/90 p-7 shadow-[0_28px_90px_rgba(67,35,47,0.12)] backdrop-blur-xl sm:p-10">
            <div className="mb-8 flex items-center justify-between lg:hidden"><img src="/logo.png" alt="Youthnic" className="h-14 w-14 object-contain" /><span className="rounded-full bg-success-surface px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-success">Secure</span></div>
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-soft-blush text-primary"><LockKeyhole className="h-5 w-5" /></div>
            <p className="mt-7 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Private workspace</p>
            <h2 className="mt-2 font-syne text-3xl font-bold tracking-tight text-on-surface">Welcome back</h2>
            <p className="mt-2 text-sm leading-6 text-secondary">Sign in with the account created by your studio administrator.</p>

            <form onSubmit={submit} className="mt-8 space-y-5">
              <label className="block text-sm font-semibold text-on-surface">Email address<input autoFocus required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" className="mt-2 h-12 w-full rounded-xl border border-outline-variant bg-white px-4 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" /></label>
              <label className="block text-sm font-semibold text-on-surface">Password<span className="relative mt-2 block"><input required type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" className="h-12 w-full rounded-xl border border-outline-variant bg-white px-4 pr-12 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-secondary transition hover:bg-surface-container hover:text-on-surface">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>
              {error && <div role="alert" className="rounded-xl border border-danger/15 bg-danger-surface px-4 py-3 text-sm font-medium text-danger">{error}</div>}
              <button disabled={submitting} type="submit" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:-translate-y-px hover:bg-primary/90 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}{submitting ? "Signing in…" : "Sign in to Studio"}</button>
              
            </form>
            <div className="mt-7 flex items-start gap-3 rounded-xl bg-surface-container-low p-4"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" /><p className="text-xs leading-5 text-secondary">Firebase secures your account and session. Supabase row-level security enforces organization roles and permissions.</p></div>
          </div>
        </section>
      </div>
    </main>
  );
}
