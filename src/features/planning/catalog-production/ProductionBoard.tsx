

export function ProductionBoard({ items }: { items: any[] }) {
  const columns = [
    { id: "requested", title: "Requested", filter: (i: any) => i.generation_status === "not_required" && i.listing_status === "not_required" && i.status !== "blocked" },
    { id: "generation", title: "Generation", filter: (i: any) => ["ready", "queued", "generating"].includes(i.generation_status) && i.status !== "blocked" },
    { id: "qc", title: "QC Review", filter: (i: any) => i.qc_status === "needs_review" && i.status !== "blocked" },
    { id: "listing", title: "Listing Pending", filter: (i: any) => i.listing_status === "pending" || i.listing_status === "ready" && i.status !== "blocked" },
    { id: "blocked", title: "Blocked", filter: (i: any) => i.status === "blocked" },
    { id: "completed", title: "Completed", filter: (i: any) => i.status === "completed" || (i.generation_status === "completed" && i.listing_status === "completed") }
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex overflow-x-auto pb-4 space-x-4">
        {columns.map(col => {
          const colItems = items.filter(col.filter);
          return (
            <div key={col.id} className="flex-shrink-0 w-80 bg-surface-container/30 rounded-lg flex flex-col max-h-full border border-outline-variant/40">
              <div className="p-3 border-b border-outline-variant/40 flex justify-between items-center bg-surface-container rounded-t-lg">
                <h3 className="font-semibold text-on-surface">{col.title}</h3>
                <span className="bg-outline-variant/30 text-secondary text-xs py-0.5 px-2 rounded-full font-medium">
                  {colItems.length}
                </span>
              </div>
              <div className="p-3 flex-1 overflow-y-auto space-y-3">
                {colItems.map(item => (
                  <div key={item.id} className="bg-white p-3 rounded shadow-sm border border-outline-variant/40 hover:border-primary cursor-pointer transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-medium text-sm text-on-surface truncate">{item.sku_name}</span>
                      {item.priority === 'urgent' && <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 mt-1"></span>}
                    </div>
                    <div className="text-xs text-secondary mb-3 truncate">
                      {item.theme || item.work_type}
                    </div>
                    
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-secondary">
                        {new Date(item.request_date).toLocaleDateString()}
                      </span>
                      {item.generation_assigned_member ? (
                        <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold" title={item.generation_assigned_member.full_name}>
                          {item.generation_assigned_member.full_name?.charAt(0).toUpperCase()}
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full border border-dashed border-outline-variant flex items-center justify-center text-secondary">
                          +
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {colItems.length === 0 && (
                  <div className="text-center py-4 text-sm text-secondary border-2 border-dashed border-outline-variant/40 rounded-lg">
                    No items
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
