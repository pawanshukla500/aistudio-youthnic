import { Shirt, Image as ImageIcon } from 'lucide-react';

export function GenerationFlowList({
  jobs,
  onSelectJob,
  isLoading
}: {
  jobs: any[];
  onSelectJob: (jobId: string) => void;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <div className="p-8 text-center text-secondary">Loading generations...</div>;
  }

  if (!jobs.length) {
    return <div className="p-8 text-center text-secondary">No recent generations found.</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="grid gap-4 p-4">
        {jobs.map(job => (
          <div 
            key={job.job_id} 
            className="border border-outline-variant/40 rounded-xl p-4 bg-surface-container-lowest hover:bg-surface-container-low transition-colors cursor-pointer"
            onClick={() => onSelectJob(job.job_id)}
          >
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-2">
                {job.batch_id ? <ImageIcon className="w-4 h-4 text-primary" /> : <Shirt className="w-4 h-4 text-primary" />}
                <span className="text-xs font-bold uppercase tracking-wider text-secondary">
                  {job.batch_id ? 'Catalog' : 'Studio'}
                </span>
              </div>
              <span className="text-[10px] text-secondary">
                {new Date(job.started_at).toLocaleString()}
              </span>
            </div>
            
            <h3 className="text-base font-bold text-on-surface mb-1">{job.sku_name || 'Unnamed Product'}</h3>
            
            <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-secondary">
              <div>Status: <span className="font-semibold text-on-surface capitalize">{job.status.replace('_', ' ')}</span></div>
              <div>Cost: <span className="font-semibold text-on-surface">${Number(job.actual_cost_usd || 0).toFixed(2)}</span></div>
              <div className="col-span-2">Model: <span className="font-semibold text-on-surface">{job.model}</span></div>
            </div>
            
            <div className="mt-4 text-right">
              <button className="text-sm font-bold text-primary hover:text-primary-dark transition-colors">
                [View Flow]
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
