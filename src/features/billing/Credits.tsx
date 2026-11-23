import { useCallback, useEffect, useState } from "react";
import { invokeAppApi } from "../../lib/backend";
import { getErrorMessage } from "../../lib/errors";
import {
  CONTACT_EMAIL,
  FRAMES_PER_SKU,
  PACKS,
  perSku,
  rupees,
} from "../../lib/pricingPacks";
import { useWorkspace } from "../../lib/WorkspaceContext";

type Recharge = {
  id: string;
  pack_skus: number;
  amount_inr: number;
  status: "requested" | "paid" | "cancelled";
  created_at: string;
};

type Overview = { usesCredits: boolean; credits: number; recharges: Recharge[] };

const STATUS_LABEL: Record<Recharge["status"], string> = {
  requested: "Waiting for approval",
  paid: "Shoots added",
  cancelled: "Cancelled",
};

const PANEL = "rounded-2xl border border-outline-variant/50 bg-card p-6 sm:p-8";

const day = (value: string) =>
  new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** A seller store's balance, the packs it can ask for, and its recharge history. */
export function Credits() {
  const { organization } = useWorkspace();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await invokeAppApi<Overview>("billing.overview", {});
      setOverview(next);
      setError("");
      return next;
    } catch (reason) {
      setError(getErrorMessage(reason, "Could not load your credits."));
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The header and Studio read the balance from the workspace: reload it when an approval changed it.
  useEffect(() => {
    if (overview?.usesCredits && overview.credits !== organization.credits) {
      window.dispatchEvent(new Event("workspace-refresh"));
    }
  }, [overview, organization.credits]);

  // A call that timed out may still have gone through, so the balance is reloaded either way and
  // the failure is shown only when the reloaded page does not already show the change (`settled`).
  const act = async (
    operation: string,
    args: Record<string, unknown>,
    failure: string,
    settled: (next: Overview) => boolean,
  ) => {
    setBusy(true);
    setError("");
    let failed = "";
    try {
      await invokeAppApi(operation, args);
    } catch (reason) {
      failed = getErrorMessage(reason, failure);
    }
    const next = await load();
    if (failed && !(next && settled(next))) setError(failed);
    setBusy(false);
  };

  const open = overview?.recharges.find((row) => row.status === "requested");
  const pack = PACKS[selected];

  return (
    <div className="mx-auto max-w-[880px] space-y-8">
      <div>
        <h2 className="font-manrope text-2xl font-bold tracking-tight text-on-surface sm:text-[28px]">
          Credits
        </h2>
        <p className="mt-1 text-sm text-secondary">
          One shoot is one SKU: six catalog frames of one product.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      {!overview && !error && (
        <p className="text-sm text-secondary">Loading your credits…</p>
      )}

      {overview && !overview.usesCredits && (
        <p className={`${PANEL} text-sm leading-relaxed text-secondary`}>
          {organization.name} has full access. Shoots are not counted against a
          balance, so there is nothing to recharge.
        </p>
      )}

      {overview?.usesCredits && (
        <>
          <section className={PANEL}>
            <p className="text-sm font-semibold text-secondary">Shoots left</p>
            <p className="mt-1 font-syne text-6xl font-bold tabular-nums tracking-tighter text-on-surface">
              {overview.credits}
            </p>
            <p className="mt-2 text-sm text-secondary">
              {overview.credits * FRAMES_PER_SKU} catalog frames
            </p>
          </section>

          {open ? (
            <section className={PANEL}>
              <h3 className="text-lg font-bold text-on-surface">
                Recharge requested
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-secondary">
                {open.pack_skus} SKUs for {rupees(open.amount_inr)}, requested
                on {day(open.created_at)}. Online payment is not connected yet:
                email us to arrange payment, and the shoots are added as soon
                as it is confirmed.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-5">
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
                    `Recharge request: ${open.pack_skus} SKUs (${rupees(open.amount_inr)}) for ${organization.name}`,
                  )}`}
                  className="rounded-full bg-primary px-6 py-3 text-sm font-bold text-on-primary transition-colors hover:bg-primary-container"
                >
                  Email us to pay
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(
                      "billing.cancelRecharge",
                      { id: open.id },
                      "Could not cancel the request.",
                      (next) =>
                        !next.recharges.some(
                          (row) => row.id === open.id && row.status === "requested",
                        ),
                    )
                  }
                  className="cursor-pointer text-sm font-semibold text-secondary underline-offset-4 hover:text-on-surface hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel request
                </button>
              </div>
            </section>
          ) : (
            <section className={PANEL}>
              <h3 className="text-lg font-bold text-on-surface">Recharge</h3>
              <fieldset className="mt-4">
                <legend className="sr-only">Choose a pack</legend>
                {PACKS.map((option, i) => (
                  <label
                    key={option.skus}
                    className={`flex cursor-pointer items-center justify-between gap-4 border-b border-outline-variant/50 px-3 py-3.5 first-of-type:border-t ${
                      selected === i ? "bg-soft-blush" : ""
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="pack"
                        checked={selected === i}
                        onChange={() => setSelected(i)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span>
                        <span className="block text-base font-bold text-on-surface">
                          {option.skus} SKUs
                        </span>
                        <span className="block text-xs text-secondary">
                          About {rupees(perSku(option))} per SKU,{" "}
                          {option.skus * FRAMES_PER_SKU} frames
                        </span>
                      </span>
                    </span>
                    <span className="font-syne text-lg font-bold tabular-nums text-on-surface">
                      {rupees(option.price)}
                    </span>
                  </label>
                ))}
              </fieldset>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  act(
                    "billing.requestRecharge",
                    { skus: pack.skus },
                    "Could not send the recharge request.",
                    (next) => next.recharges.some((row) => row.status === "requested"),
                  )
                }
                className="mt-6 cursor-pointer rounded-full bg-primary px-6 py-3 text-sm font-bold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Sending request…" : `Request the ${pack.skus} SKU pack`}
              </button>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-secondary">
                Online payment is not connected yet. After you send the request,
                email us to arrange payment; the shoots are added once it is
                confirmed.
              </p>
            </section>
          )}

          {overview.recharges.length > 0 && (
            <section>
              <h3 className="text-lg font-bold text-on-surface">
                Recharge history
              </h3>
              <ul className="mt-3 divide-y divide-outline-variant/50 border-y border-outline-variant/50">
                {overview.recharges.map((row) => (
                  <li
                    key={row.id}
                    className="grid grid-cols-2 gap-x-6 gap-y-1 py-3 text-sm sm:grid-cols-3"
                  >
                    <span className="font-semibold text-on-surface">
                      {row.pack_skus} SKUs, {rupees(row.amount_inr)}
                    </span>
                    <span className="text-secondary">{day(row.created_at)}</span>
                    <span
                      className={
                        row.status === "paid"
                          ? "font-semibold text-success"
                          : "text-secondary"
                      }
                    >
                      {STATUS_LABEL[row.status]}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
