import { useCallback, useEffect, useState } from "react";
import { ActionDialog } from "../../components/ui/ActionDialog";
import { invokeAppApi } from "../../lib/backend";
import { getErrorMessage } from "../../lib/errors";
import { rupees } from "../../lib/pricingPacks";

type AdminRecharge = {
  id: string;
  pack_skus: number;
  amount_inr: number;
  status: "requested" | "paid" | "cancelled";
  created_at: string;
  organization: { name: string; credits: number } | null;
};

const STATUS_LABEL: Record<AdminRecharge["status"], string> = {
  requested: "Waiting",
  paid: "Approved",
  cancelled: "Cancelled",
};

const day = (value: string) =>
  new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** Stores' recharge requests. Approving one adds its shoots to the store, once. */
export function RechargeRequests() {
  const [rows, setRows] = useState<AdminRecharge[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState<AdminRecharge | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await invokeAppApi<{ recharges: AdminRecharge[] }>(
        "admin.recharges.list",
        {},
      );
      setRows(result.recharges);
      setError("");
    } catch (reason) {
      setError(getErrorMessage(reason, "Could not load recharge requests."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async () => {
    if (!confirming) return;
    const store = confirming.organization?.name || "the store";
    setBusy(true);
    try {
      const result = await invokeAppApi<{ applied: boolean }>(
        "admin.recharges.approve",
        { id: confirming.id },
      );
      setNotice(
        result.applied
          ? `${confirming.pack_skus} shoots added to ${store}.`
          : "That request was already approved or cancelled. Nothing was added.",
      );
      setError("");
      await load();
    } catch (reason) {
      setError(getErrorMessage(reason, "Could not approve the recharge."));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <section className="rounded-2xl border border-outline-variant/40 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold text-on-surface">Recharge requests</h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-secondary">
        Approve a request only after its payment has reached you. Approving
        adds the pack&apos;s shoots to the store at once.
      </p>

      {notice && (
        <p role="status" className="mt-4 text-sm font-semibold text-success">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm font-medium text-danger">
          {error}
        </p>
      )}
      {!rows && !error && (
        <p className="mt-4 text-sm text-secondary">Loading requests…</p>
      )}
      {rows?.length === 0 && (
        <p className="mt-4 text-sm text-secondary">
          No store has asked for a recharge yet.
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-outline-variant/50 text-xs font-semibold text-secondary">
              <tr>
                <th className="py-2 pr-4">Store</th>
                <th className="py-2 pr-4">Pack</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Requested</th>
                <th className="py-2 pr-4">Shoots left</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/40">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="py-3 pr-4 font-semibold text-on-surface">
                    {row.organization?.name || "Unknown store"}
                  </td>
                  <td className="py-3 pr-4">{row.pack_skus} SKUs</td>
                  <td className="py-3 pr-4 tabular-nums">
                    {rupees(row.amount_inr)}
                  </td>
                  <td className="py-3 pr-4 text-secondary">
                    {day(row.created_at)}
                  </td>
                  <td className="py-3 pr-4 tabular-nums">
                    {row.organization?.credits ?? "–"}
                  </td>
                  <td className="py-3">
                    {row.status === "requested" ? (
                      <button
                        type="button"
                        onClick={() => setConfirming(row)}
                        className="cursor-pointer rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-on-primary transition-colors hover:bg-primary-container"
                      >
                        Approve
                      </button>
                    ) : (
                      <span className="text-secondary">
                        {STATUS_LABEL[row.status]}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ActionDialog
        open={Boolean(confirming)}
        title={
          confirming
            ? `Add ${confirming.pack_skus} shoots to ${confirming.organization?.name || "this store"}?`
            : ""
        }
        description={
          confirming
            ? `Approve only after ${rupees(confirming.amount_inr)} has been received. The shoots are added at once and this cannot be undone here.`
            : ""
        }
        confirmLabel="Approve and add shoots"
        busy={busy}
        onConfirm={() => void approve()}
        onCancel={() => setConfirming(null)}
      />
    </section>
  );
}
