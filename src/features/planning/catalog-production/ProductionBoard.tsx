import React from "react";

export function ProductionBoard({ items, refresh }: { items: any[], refresh: () => void }) {
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
            <div key={col.id} className="flex-shrink-0 w-80 bg-gray-50 dark:bg-gray-800/50 rounded-lg flex flex-col max-h-full border border-gray-200 dark:border-gray-700">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-100 dark:bg-gray-800 rounded-t-lg">
                <h3 className="font-semibold text-gray-700 dark:text-gray-300">{col.title}</h3>
                <span className="bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 text-xs py-0.5 px-2 rounded-full font-medium">
                  {colItems.length}
                </span>
              </div>
              <div className="p-3 flex-1 overflow-y-auto space-y-3">
                {colItems.map(item => (
                  <div key={item.id} className="bg-white dark:bg-gray-800 p-3 rounded shadow-sm border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 cursor-pointer transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-medium text-sm text-gray-900 dark:text-white truncate">{item.sku_name}</span>
                      {item.priority === 'urgent' && <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 mt-1"></span>}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-3 truncate">
                      {item.theme || item.work_type}
                    </div>
                    
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-400">
                        {new Date(item.request_date).toLocaleDateString()}
                      </span>
                      {item.generation_assigned_member ? (
                        <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold" title={item.generation_assigned_member.full_name}>
                          {item.generation_assigned_member.full_name?.charAt(0).toUpperCase()}
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full border border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-400">
                          +
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {colItems.length === 0 && (
                  <div className="text-center py-4 text-sm text-gray-400 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
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
