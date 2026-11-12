import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Loader2, LogOut, ShieldCheck, Sparkles, Store } from "lucide-react";
import type { User } from "firebase/auth";
import { supabase } from "../../lib/supabase";
import { getErrorMessage } from "../../lib/errors";
import type { WorkspaceValue } from "../../lib/WorkspaceContext";

interface SellerOnboardingProps {
  user: User;
  onEnrolled: (workspace: WorkspaceValue) => void;
  onSignOut: () => Promise<void>;
}

export function SellerOnboarding({ user, onEnrolled, onSignOut }: SellerOnboardingProps) {
  const [storeName, setStoreName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanName = storeName.trim();
    if (cleanName.length < 2) {
      setError("Please enter a valid store name (minimum 2 characters).");
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("app_enroll_seller", {
        store_name: cleanName,
        contact_email: user.email || null,
      });
      if (rpcError) throw rpcError;

      const raw = data as Record<string, any>;
      if (!raw?.organization || !raw?.member) {
        throw new Error("Enrollment did not return an active workspace. Please try again.");
      }

      const organization = { ...raw.organization, _id: raw.organization.id };
      const member = { ...raw.member, _id: raw.member.id };
      const userSource = raw.user || {};
      const normalizedUser = {
        ...userSource,
        _id: userSource.id || member.id,
        id: userSource.id || member.id,
        email: userSource.email || member.email || "",
        displayName: userSource.name || member.display_name || cleanName,
      };
      const roles = (Array.isArray(raw.roles) ? raw.roles : []).map((role: Record<string, any>) => ({
        ...role,
        _id: String(role.id),
        id: String(role.id),
        name: String(role.name || "Admin"),
        slug: String(role.slug || "admin"),
      }));

      onEnrolled({
        organization,
        user: normalizedUser,
        membership: member,
        roles,
        permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
        isAdmin: true,
      });
    } catch (reason) {
      setError(getErrorMessage(reason, "Could not enroll store workspace. Please retry."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#faf8f5] text-on-background selection:bg-primary/20 selection:text-primary">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-[580px] w-[580px] rounded-full bg-gradient-to-br from-primary/10 via-amber-200/15 to-transparent blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 right-[-6rem] h-[600px] w-[600px] rounded-full bg-gradient-to-tl from-tertiary/10 via-rose-200/10 to-transparent blur-3xl" />

      <main className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-xl rounded-3xl border border-white/90 bg-white/95 p-8 shadow-[0_24px_80px_rgba(67,35,47,0.08)] backdrop-blur-2xl transition-all sm:p-12">
          {/* Header Badge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Youthnic" className="h-12 w-12 object-contain" />
              <div>
                <span className="font-syne text-lg font-bold tracking-tight text-on-surface">Youthnic AI Studio</span>
                <span className="block text-[9px] font-bold uppercase tracking-[0.24em] text-primary">AaaS Onboarding</span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> 5 Free Shoots
            </span>
          </div>

          <div className="mt-8">
            <h1 className="font-syne text-2xl font-extrabold tracking-tight text-on-surface sm:text-3xl">
              Name your store workspace
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              Set up your dedicated AI photography studio. Your assets, model references, and catalog runs will remain strictly private and isolated to your store.
            </p>
          </div>

          {/* Value Highlights */}
          <div className="mt-6 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low/50 p-3.5">
              <div className="flex items-center gap-2 font-bold text-on-surface">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>5 Free Shoots</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-secondary">
                Auto-credited on enrollment with full 6-pose commercial planning.
              </p>
            </div>
            <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low/50 p-3.5">
              <div className="flex items-center gap-2 font-bold text-on-surface">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <span>Isolated Storage</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-secondary">
                Dedicated Firebase directory and strict Row Level Security.
              </p>
            </div>
          </div>

          {/* Pricing transparency note */}
          <div className="mt-4 rounded-xl border border-amber-200/70 bg-amber-50/60 p-3.5 text-xs text-amber-950">
            <p className="font-semibold text-[11px] tracking-wide uppercase text-amber-800">
              Transparent Pay-As-You-Go Rates
            </p>
            <p className="mt-1 text-[12px] leading-relaxed">
              First 5 complete photoshoots free (6-pose catalog runs). After trial: <b>$1.00</b> per shoot (Meta Muse Spark High Reasoning) + <b>$0.50</b> optional Automated CV QA Inspection.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="store-name" className="block text-xs font-bold uppercase tracking-wider text-secondary">
                Store or Brand Name
              </label>
              <div className="relative mt-2">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-secondary">
                  <Store className="h-4 w-4" />
                </div>
                <input
                  id="store-name"
                  autoFocus
                  required
                  type="text"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="e.g. Silk & Stone Atelier, Myntra Trendz"
                  className="h-12 w-full rounded-xl border border-outline-variant/70 bg-white pl-10 pr-4 text-sm text-on-surface outline-none transition-all placeholder:text-secondary/50 focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
              </div>
            </div>

            <div>
              <label htmlFor="user-email" className="block text-xs font-bold uppercase tracking-wider text-secondary">
                Account Email
              </label>
              <input
                id="user-email"
                disabled
                type="email"
                value={user.email || ""}
                className="mt-2 h-11 w-full rounded-xl border border-outline-variant/40 bg-surface-container-low/60 px-4 text-xs font-semibold text-secondary"
              />
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
                  <span>Creating store workspace…</span>
                </>
              ) : (
                <>
                  <span>Create Store & Claim 5 Free Shoots</span>
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 flex items-center justify-between border-t border-outline-variant/40 pt-4 text-xs text-secondary">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              No credit card required
            </span>
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-secondary transition hover:text-danger"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

