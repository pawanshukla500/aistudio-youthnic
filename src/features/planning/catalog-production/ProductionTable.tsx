import { Check, Eye, ShieldCheck, X } from "lucide-react";
import { formatDuration, isCompleted, type ProductionActionProps } from "./types";

function statusTone(status: string) {
  if (["completed", "passed"].includes(status)) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (["failed", "rejected", "blocked"].includes(status)) return "bg-red-50 text-red-700 ring-red-200";
  if (["queued", "generating", "processing", "needs_review", "pending"].includes(status)) return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-surface-container text-secondary ring-outline-variant/50";
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-bold capitalize ring-1 ring-inset ${statusTone(value)}`}>{value.replaceAll("_", " ")}</span>;
}

export function ProductionTable({
  items,
  members,
  canManage,
  canReviewQc,
  canCompleteListing,
  busyKey,
  onAssign,
  onQc,
  onListingDone,
  onViewAssets,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}: ProductionActionProps) {
  const isAllSelected = items.length > 0 && selectedIds.size === items.length;
  const isSomeSelected = selectedIds.size > 0 && selectedIds.size < items.length;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-outline-variant/40 bg-white shadow-sm">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-[1500px] divide-y divide-outline-variant/20">
          <thead className="sticky top-0 z-10 bg-surface-container">
            <tr>
              <th className="w-10 px-4 py-3 text-center">
                <input 
                  type="checkbox" 
                  checked={isAllSelected}
                  ref={(input) => { if (input) input.indeterminate = isSomeSelected; }}
                  onChange={onToggleSelectAll}
                  className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
                />
              </th>
              {[
                "Request", "Date", "SKU", "Priority", "Generation", "Generation time", "QC", "Listing",
                "AI owner", "Listing owner", "Theme", "Actions",
              ].map((header) => (
                <th key={header} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-secondary">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/20 bg-white">
            {items.map((item) => {
              const completed = isCompleted(item);
              const assigningGeneration = busyKey === `assign:generation:${item.id}`;
              const assigningListing = busyKey === `assign:listing:${item.id}`;
              return (
                <tr key={item.id} className={`${completed ? "bg-surface-container/35 text-secondary" : "hover:bg-surface-container/35"} ${selectedIds.has(item.id) ? "bg-primary/5" : ""} transition-colors`}>
                  <td className="px-4 py-3 text-center">
                    <input 
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => onToggleSelect(item.id)}
                      className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-secondary">{item.request_code}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-on-surface">{new Date(item.request_date).toLocaleDateString()}</td>
                  <td className="max-w-[220px] px-4 py-3">
                    <p className="truncate text-sm font-bold text-on-surface">{item.sku_name}</p>
                    {item.color_label && <p className="mt-0.5 truncate text-xs text-secondary">{item.color_label}</p>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3"><StatusBadge value={item.priority} /></td>
                  <td className="whitespace-nowrap px-4 py-3"><StatusBadge value={item.generation_status} /></td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <p className="text-sm font-semibold text-on-surface">{formatDuration(item.generation_started_at, item.generation_completed_at)}</p>
                    {item.generation_completed_at && <p className="mt-0.5 text-[11px] text-secondary">Done {new Date(item.generation_completed_at).toLocaleString()}</p>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3"><StatusBadge value={item.qc_status} /></td>
                  <td className="whitespace-nowrap px-4 py-3"><StatusBadge value={item.listing_status} /></td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <select
                        value={item.generation_assigned_member_id || ""}
                        disabled={assigningGeneration}
                        onChange={(event) => void onAssign(item.id, "generation", event.target.value)}
                        className="w-40 rounded-lg border border-outline-variant bg-white px-2 py-1.5 text-xs font-semibold text-on-surface disabled:opacity-50"
                        aria-label={`Generation owner for ${item.sku_name}`}
                      >
                        <option value="">Unassigned</option>
                        {members.map((member) => <option key={member.id} value={member.id}>{member.display_name || member.email}</option>)}
                      </select>
                    ) : <span className="text-sm text-secondary">{item.generation_assigned_member?.display_name || item.generation_assigned_member?.email || "Unassigned"}</span>}
                  </td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <select
                        value={item.listing_assigned_member_id || ""}
                        disabled={assigningListing}
                        onChange={(event) => void onAssign(item.id, "listing", event.target.value)}
                        className="w-40 rounded-lg border border-outline-variant bg-white px-2 py-1.5 text-xs font-semibold text-on-surface disabled:opacity-50"
                        aria-label={`Listing owner for ${item.sku_name}`}
                      >
                        <option value="">Unassigned</option>
                        {members.map((member) => <option key={member.id} value={member.id}>{member.display_name || member.email}</option>)}
                      </select>
                    ) : <span className="text-sm text-secondary">{item.listing_assigned_member?.display_name || item.listing_assigned_member?.email || "Unassigned"}</span>}
                  </td>
                  <td className="max-w-[160px] px-4 py-3 text-sm text-secondary"><p className="truncate">{item.theme || "—"}</p></td>
                  <td className="px-4 py-3">
                    <div className="flex min-w-[250px] flex-wrap items-center gap-2">
                      {item.catalog_session_id && item.generation_status === "completed" && (
                        <button onClick={() => onViewAssets(item)} className="inline-flex items-center gap-1.5 rounded-lg border border-primary px-2.5 py-1.5 text-xs font-bold text-primary hover:bg-primary/5">
                          <Eye className="h-3.5 w-3.5" /> Assets
                        </button>
                      )}
                      {canReviewQc && item.generation_status === "completed" && item.qc_status === "needs_review" && (
                        <>
                          <button disabled={busyKey === `qc:${item.id}`} onClick={() => void onQc(item.id, "passed")} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                            <ShieldCheck className="h-3.5 w-3.5" /> Pass QC
                          </button>
                          <button disabled={busyKey === `qc:${item.id}`} onClick={() => void onQc(item.id, "rejected")} className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">
                            <X className="h-3.5 w-3.5" /> Reject
                          </button>
                        </>
                      )}
                      {canCompleteListing && item.listing_status === "pending" && item.generation_status === "completed" && item.qc_status === "passed" && (
                        <button disabled={busyKey === `listing:${item.id}`} onClick={() => void onListingDone(item.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-bold text-white hover:bg-primary/90 disabled:opacity-50">
                          <Check className="h-3.5 w-3.5" /> Listing Done
                        </button>
                      )}
                      {item.listing_status === "pending" && item.qc_status !== "passed" && <span className="text-[11px] font-semibold text-amber-700">Awaiting QC</span>}
                      {completed && <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><Check className="h-3.5 w-3.5" /> Complete</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!items.length && (
              <tr><td colSpan={12} className="px-4 py-16 text-center text-sm text-secondary">No catalog work items yet. Select SKUs from Planning or upload the Excel template.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
