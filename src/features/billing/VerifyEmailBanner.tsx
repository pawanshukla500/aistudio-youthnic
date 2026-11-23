import { useState } from "react";
import { getErrorMessage } from "../../lib/errors";
import { useFirebaseAuth } from "../../lib/FirebaseAuthContext";

/** Shown to seller stores until the owner's email is verified: the free shoot needs it. */
export function VerifyEmailBanner() {
  const { user, emailVerified, sendVerificationEmail, refreshEmailVerified } =
    useFirebaseAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (!user || emailVerified) return null;

  const run = async (action: () => Promise<string>, failure: string) => {
    setBusy(true);
    try {
      setMessage(await action());
    } catch (reason) {
      setMessage(getErrorMessage(reason, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-warning/30 bg-warning-surface px-4 py-3 text-sm text-on-surface sm:px-6 lg:px-8"
    >
      <p className="min-w-0 flex-1 basis-64">
        <span className="font-bold">
          Verify your email to start your free shoot.
        </span>{" "}
        {message || `We sent a link to ${user.email}.`}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await sendVerificationEmail();
            return `A new link is on its way to ${user.email}.`;
          }, "Could not send the email. Try again in a minute.")
        }
        className="cursor-pointer font-semibold text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
      >
        Resend email
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          run(
            async () =>
              (await refreshEmailVerified())
                ? ""
                : "Not verified yet. Open the link in the email, then press this again.",
            "Could not check your email status. Try again.",
          )
        }
        className="cursor-pointer rounded-full bg-primary px-4 py-1.5 font-bold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-60"
      >
        I have verified
      </button>
    </div>
  );
}
