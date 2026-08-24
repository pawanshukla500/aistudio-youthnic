import { Check, Eye, Play, ShieldCheck, Workflow, X } from "lucide-react";
import { formatDuration, productionStage, type ProductionActionProps } from "./types";

const columns = [
  { id: "requested", title: "Requested", hint: "Needs production setup" },
  { id: "generation", title: "Generation", hint: "Ready, queued, or running" },
  { id: "qc", title: "QC Review", hint: "Generated assets awaiting review" },
  { id: "listing", title: "Listing Pending", hint: "QC passed and ready to list" },
  { id: "blocked", title: "Blocked", hint: "Generation or QC needs attention" },
  { id: "completed", title: "Completed", hint: "Listing finished" },
] as const;

export function ProductionBoard({
  items,
  members,
  canManage,
  canReviewQc,
  canCompleteListing,
  busyKey,
  onAssign,
  onQc,
  onListingDone,
  onListingStarted,
  onViewAssets,
  onViewWorkflow,
}: ProductionActionProps) {
  return (
    <div className="flex h-full min-h-[580px] min-w-0 flex-col">
      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-4">
        {columns.map((column) => {
          const columnItems = items.filter((item) => productionStage(item) === column.id);
          return (
            <section key={column.id} className="flex max-h-full w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container/30">
              <header className="border-b border-outline-variant/40 bg-surface-container px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-bold text-on-surface">{column.title}</h3>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-secondary shadow-sm">{columnItems.length}</span>
                </div>
                <p className="mt-1 text-[11px] text-secondary">{column.hint}</p>
              </header>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                {columnItems.map((item) => (
                  <article key={item.id} className={`rounded-xl border bg-white p-3 shadow-sm transition-colors ${column.id === "completed" ? "border-emerald-100 opacity-80" : "border-outline-variant/40 hover:border-primary/60"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-on-surface">{item.sku_name}</p>
                        <p className="mt-0.5 truncate text-[11px] text-secondary">{item.request_code}{item.color_label ? ` · ${item.color_label}` : ""}</p>
                      </div>
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.priority === "urgent" ? "bg-red-500" : item.priority === "high" ? "bg-orange-400" : "bg-primary/30"}`} title={`${item.priority} priority`} />
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-lg bg-surface-container/60 p-2"><p className="text-secondary">Generation</p><p className="mt-0.5 font-bold capitalize text-on-surface">{item.generation_status.replaceAll("_", " ")}</p></div>
                      <div className="rounded-lg bg-surface-container/60 p-2"><p className="text-secondary">Elapsed</p><p className="mt-0.5 font-bold text-on-surface">{formatDuration(item.generation_started_at, item.generation_completed_at)}</p></div>
                    </div>

                    <div className="mt-3 space-y-2">
                      {canManage ? (
                        <>
                          <label className="block text-[10px] font-bold uppercase tracking-wide text-secondary">
                            AI owner
                            <select value={item.generation_assigned_member_id || ""} disabled={busyKey === `assign:generation:${item.id}`} onChange={(event) => void onAssign(item.id, "generation", event.target.value)} className="mt-1 w-full rounded-lg border border-outline-variant bg-white px-2 py-1.5 text-xs font-semibold normal-case tracking-normal text-on-surface disabled:opacity-50">
                              <option value="">Unassigned</option>
                              {members.map((member) => <option key={member.id} value={member.id}>{member.display_name || member.email}</option>)}
                            </select>
                          </label>
                          <label className="block text-[10px] font-bold uppercase tracking-wide text-secondary">
                            Listing owner
                            <select value={item.listing_assigned_member_id || ""} disabled={busyKey === `assign:listing:${item.id}`} onChange={(event) => void onAssign(item.id, "listing", event.target.value)} className="mt-1 w-full rounded-lg border border-outline-variant bg-white px-2 py-1.5 text-xs font-semibold normal-case tracking-normal text-on-surface disabled:opacity-50">
                              <option value="">Unassigned</option>
                              {members.map((member) => <option key={member.id} value={member.id}>{member.display_name || member.email}</option>)}
                            </select>
                          </label>
                        </>
                      ) : (
                        <div className="flex items-center justify-between text-xs text-secondary"><span>Owner</span><span className="max-w-40 truncate font-semibold text-on-surface">{item.generation_assigned_member?.display_name || "Unassigned"}</span></div>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 border-t border-outline-variant/20 pt-3">
                      <button onClick={() => onViewWorkflow(item)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-outline-variant px-2 py-1.5 text-xs font-bold text-secondary hover:border-primary hover:text-primary"><Workflow className="h-3.5 w-3.5" /> Live flow</button>
                      {item.catalog_session_id && item.generation_status === "completed" && (
                        <button onClick={() => onViewAssets(item)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary px-2 py-1.5 text-xs font-bold text-primary hover:bg-primary/5"><Eye className="h-3.5 w-3.5" /> Assets</button>
                      )}
                      {canReviewQc && item.generation_status === "completed" && item.qc_status === "needs_review" && (
                        <>
                          <button disabled={busyKey === `qc:${item.id}`} onClick={() => void onQc(item.id, "passed")} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-2 py-1.5 text-xs font-bold text-white disabled:opacity-50"><ShieldCheck className="h-3.5 w-3.5" /> Pass</button>
                          <button disabled={busyKey === `qc:${item.id}`} onClick={() => void onQc(item.id, "rejected")} className="inline-flex items-center justify-center rounded-lg border border-red-300 px-2 py-1.5 text-red-700 disabled:opacity-50" aria-label="Reject QC"><X className="h-3.5 w-3.5" /></button>
                        </>
                      )}
                      {canCompleteListing && item.workflow_stage === "sent_to_listing_team" && (
                        <button disabled={busyKey === `listing-start:${item.id}`} onClick={() => void onListingStarted(item.id)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-1.5 text-xs font-bold text-white disabled:opacity-50"><Play className="h-3.5 w-3.5" /> Start listing</button>
                      )}
                      {canCompleteListing && (item.listing_status === "in_progress" || (item.listing_status === "pending" && !item.listing_sent_at)) && item.qc_status === "passed" && (
                        <button disabled={busyKey === `listing:${item.id}`} onClick={() => void onListingDone(item.id)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-1.5 text-xs font-bold text-white disabled:opacity-50"><Check className="h-3.5 w-3.5" /> Listing Done</button>
                      )}
                      {column.id === "completed" && <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><Check className="h-3.5 w-3.5" /> Finished</span>}
                    </div>
                  </article>
                ))}
                {!columnItems.length && <div className="rounded-xl border-2 border-dashed border-outline-variant/40 px-3 py-8 text-center text-sm text-secondary">No items</div>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
