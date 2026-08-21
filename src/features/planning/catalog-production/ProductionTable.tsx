

export function ProductionTable({ items }: { items: any[] }) {
  return (
    <div className="bg-white rounded-lg border border-outline-variant/40 shadow-sm overflow-hidden h-full flex flex-col">
      <div className="overflow-auto flex-1">
        <table className="min-w-full divide-y divide-outline-variant/20">
          <thead className="bg-surface-container sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Request</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Date</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">SKU</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Priority</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Generation Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">QC Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Listing Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">AI Owner</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Theme</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-outline-variant/20">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-surface-container/50 cursor-pointer">
                <td className="px-4 py-3 whitespace-nowrap text-sm text-secondary">
                  {item.request_code}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-on-surface">
                  {new Date(item.request_date).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-on-surface">
                  {item.sku_name}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-secondary">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    item.priority === 'urgent' ? 'bg-red-100 text-red-800' :
                    item.priority === 'high' ? 'bg-orange-100 text-orange-800' :
                    'bg-surface-container text-secondary'
                  }`}>
                    {item.priority}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-secondary">
                  {item.generation_status}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-secondary">
                  {item.qc_status}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-secondary">
                  {item.listing_status}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-secondary">
                  {item.generation_assigned_member ? item.generation_assigned_member.full_name : '-'}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-secondary truncate max-w-[150px]">
                  {item.theme || '-'}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-secondary">
                  No catalog work items found. Use the Import button to sync from Google Sheets.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
