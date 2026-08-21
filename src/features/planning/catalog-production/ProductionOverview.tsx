

export function ProductionOverview({ items }: { items: any[] }) {
  const stats = {
    total: items.length,
    needGeneration: items.filter(i => i.generation_status === "ready" || i.generation_status === "failed").length,
    generating: items.filter(i => i.generation_status === "queued" || i.generation_status === "generating").length,
    needQc: items.filter(i => i.qc_status === "needs_review").length,
    readyForListing: items.filter(i => i.listing_status === "ready" || (i.listing_status === "pending" && i.qc_status === "passed")).length,
    listingPending: items.filter(i => i.listing_status === "pending").length,
    blocked: items.filter(i => i.status === "blocked").length,
    completed: items.filter(i => i.listing_status === "completed" || i.status === "completed").length,
  };

  const statCard = (title: string, value: number, color: string) => (
    <div className="p-4 bg-white rounded-lg border border-outline-variant/40 shadow-sm">
      <div className="text-sm font-medium text-secondary mb-1">{title}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h3 className="text-xl font-bold text-on-surface">KPI Overview</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCard("Total Requests", stats.total, "text-on-surface")}
        {statCard("Need Generation", stats.needGeneration, "text-orange-600")}
        {statCard("Generating", stats.generating, "text-blue-600")}
        {statCard("QC Required", stats.needQc, "text-purple-600")}
        {statCard("Ready for Listing", stats.readyForListing, "text-teal-600")}
        {statCard("Listing Pending", stats.listingPending, "text-yellow-600")}
        {statCard("Blocked", stats.blocked, "text-red-600")}
        {statCard("Completed", stats.completed, "text-green-600")}
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-outline-variant/40 shadow-sm p-4">
          <h4 className="text-lg font-semibold text-on-surface mb-4">Urgent & Overdue</h4>
          {items.filter(i => i.priority === "urgent" && i.status !== "completed").length === 0 ? (
            <p className="text-sm text-secondary">No urgent items pending.</p>
          ) : (
            <ul className="divide-y divide-outline-variant/20">
              {items.filter(i => i.priority === "urgent" && i.status !== "completed").slice(0, 5).map(item => (
                <li key={item.id} className="py-3 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-medium text-on-surface">{item.sku_name}</p>
                    <p className="text-xs text-secondary">{item.work_type}</p>
                  </div>
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                    Urgent
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        
        <div className="bg-white rounded-lg border border-outline-variant/40 shadow-sm p-4">
          <h4 className="text-lg font-semibold text-on-surface mb-4">Pending QC Reviews</h4>
          {items.filter(i => i.qc_status === "needs_review").length === 0 ? (
            <p className="text-sm text-secondary">No QC reviews pending.</p>
          ) : (
            <ul className="divide-y divide-outline-variant/20">
              {items.filter(i => i.qc_status === "needs_review").slice(0, 5).map(item => (
                <li key={item.id} className="py-3 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-medium text-on-surface">{item.sku_name}</p>
                    <p className="text-xs text-secondary">Completed at {item.generation_completed_at ? new Date(item.generation_completed_at).toLocaleDateString() : 'N/A'}</p>
                  </div>
                  <button className="text-sm text-primary hover:text-primary/80">Review</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
