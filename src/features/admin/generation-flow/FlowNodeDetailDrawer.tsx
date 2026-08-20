import { X } from 'lucide-react';

export function FlowNodeDetailDrawer({
  node,
  onClose
}: {
  node: any;
  onClose: () => void;
}) {
  if (!node) return null;

  return (
    <div className="absolute top-0 right-0 h-full w-96 bg-white border-l border-outline-variant/30 shadow-2xl z-50 flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-outline-variant/30">
        <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface">Node Details</h3>
        <button type="button" aria-label="Close node details" onClick={onClose} className="p-1 hover:bg-surface-container-low rounded-full">
          <X className="w-5 h-5 text-secondary" />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="mb-4">
          <div className="text-xs text-secondary font-semibold uppercase mb-1">Type</div>
          <div className="text-sm font-medium text-on-surface">{node.type}</div>
        </div>
        
        <div>
          <div className="text-xs text-secondary font-semibold uppercase mb-2">Raw Data</div>
          <pre className="text-[10px] bg-surface-container-lowest border border-outline-variant/30 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(node.data, null, 2)}
          </pre>
        </div>
        
        {/* Render specific views based on node type if needed, e.g. QA reasons, references */}
        {node.type === 'reference' && (
          <div className="text-xs text-amber-700 bg-amber-50 p-3 rounded-lg border border-amber-200">
            Exact per-attempt reference IDs were not persisted.
          </div>
        )}
        
        {node.type === 'memory' && (
          <div className="text-xs text-amber-700 bg-amber-50 p-3 rounded-lg border border-amber-200">
            Candidate rejection history was not recorded for this generation.
          </div>
        )}
      </div>
    </div>
  );
}
