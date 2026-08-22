import { formatDuration, isCompleted, type CatalogWorkItem } from "./types";

export function ProductionOverview({ items }: { items: CatalogWorkItem[] }) {
  const stats = {
    active: items.filter((item) => !isCompleted(item)).length,
    needGeneration: items.filter((item) => ["ready", "failed"].includes(item.generation_status)).length,
    generating: items.filter((item) => ["queued", "generating", "processing"].includes(item.generation_status)).length,
    needQc: items.filter((item) => item.generation_status === "completed" && item.qc_status === "needs_review").length,
    listingPending: items.filter((item) => item.qc_status === "passed" && item.listing_status === "pending").length,
    blocked: items.filter((item) => item.status === "blocked" || item.generation_status === "failed" || item.qc_status === "rejected").length,
    completed: items.filter(isCompleted).length,
  };
  const cards = [
    ["Active queue", stats.active, "text-on-surface"],
    ["Need generation", stats.needGeneration, "text-orange-600"],
    ["Generating", stats.generating, "text-blue-600"],
    ["QC required", stats.needQc, "text-purple-600"],
    ["Listing pending", stats.listingPending, "text-amber-600"],
    ["Blocked", stats.blocked, "text-red-600"],
    ["Completed", stats.completed, "text-emerald-600"],
  ] as const;
  const completed = items.filter(isCompleted).slice(0, 6);
  const urgent = items.filter((item) => item.priority === "urgent" && !isCompleted(item)).slice(0, 6);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h3 className="text-xl font-bold text-on-surface">Production health</h3>
        <p className="mt-1 text-sm text-secondary">Live generation, QC, and listing handoff status for the current workspace.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([title, value, color]) => (
          <div key={title} className="rounded-xl border border-outline-variant/40 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-secondary">{title}</p>
            <p className={`mt-2 text-3xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-outline-variant/40 bg-white p-4 shadow-sm">
          <h4 className="text-base font-bold text-on-surface">Urgent active work</h4>
          <div className="mt-3 divide-y divide-outline-variant/20">
            {urgent.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0"><p className="truncate text-sm font-bold text-on-surface">{item.sku_name}</p><p className="mt-0.5 text-xs capitalize text-secondary">{item.generation_status.replaceAll("_", " ")} · {item.qc_status.replaceAll("_", " ")}</p></div>
                <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-bold text-red-700">Urgent</span>
              </div>
            ))}
            {!urgent.length && <p className="py-8 text-center text-sm text-secondary">No urgent work is pending.</p>}
          </div>
        </section>
        <section className="rounded-xl border border-outline-variant/40 bg-white p-4 shadow-sm">
          <h4 className="text-base font-bold text-on-surface">Recently completed</h4>
          <div className="mt-3 divide-y divide-outline-variant/20">
            {completed.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0"><p className="truncate text-sm font-bold text-on-surface">{item.sku_name}</p><p className="mt-0.5 text-xs text-secondary">Generated in {formatDuration(item.generation_started_at, item.generation_completed_at)}</p></div>
                <p className="shrink-0 text-xs font-semibold text-emerald-700">{new Date(item.completed_at || item.updated_at).toLocaleDateString()}</p>
              </div>
            ))}
            {!completed.length && <p className="py-8 text-center text-sm text-secondary">Completed listing work will collect here.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
