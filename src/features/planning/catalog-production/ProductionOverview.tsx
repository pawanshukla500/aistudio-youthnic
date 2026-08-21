

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
    <div className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{title}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h3 className="text-xl font-bold text-gray-900 dark:text-white">KPI Overview</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCard("Total Requests", stats.total, "text-gray-900 dark:text-white")}
        {statCard("Need Generation", stats.needGeneration, "text-orange-600 dark:text-orange-400")}
        {statCard("Generating", stats.generating, "text-blue-600 dark:text-blue-400")}
        {statCard("QC Required", stats.needQc, "text-purple-600 dark:text-purple-400")}
        {statCard("Ready for Listing", stats.readyForListing, "text-teal-600 dark:text-teal-400")}
        {statCard("Listing Pending", stats.listingPending, "text-yellow-600 dark:text-yellow-400")}
        {statCard("Blocked", stats.blocked, "text-red-600 dark:text-red-400")}
        {statCard("Completed", stats.completed, "text-green-600 dark:text-green-400")}
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-4">
          <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Urgent & Overdue</h4>
          {items.filter(i => i.priority === "urgent" && i.status !== "completed").length === 0 ? (
            <p className="text-sm text-gray-500">No urgent items pending.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {items.filter(i => i.priority === "urgent" && i.status !== "completed").slice(0, 5).map(item => (
                <li key={item.id} className="py-3 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{item.sku_name}</p>
                    <p className="text-xs text-gray-500">{item.work_type}</p>
                  </div>
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                    Urgent
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-4">
          <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Pending QC Reviews</h4>
          {items.filter(i => i.qc_status === "needs_review").length === 0 ? (
            <p className="text-sm text-gray-500">No QC reviews pending.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {items.filter(i => i.qc_status === "needs_review").slice(0, 5).map(item => (
                <li key={item.id} className="py-3 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{item.sku_name}</p>
                    <p className="text-xs text-gray-500">Completed at {item.generation_completed_at ? new Date(item.generation_completed_at).toLocaleDateString() : 'N/A'}</p>
                  </div>
                  <button className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400">Review</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
