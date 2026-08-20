import { useState, useEffect } from 'react';
import { invokeAppApi } from '../../../lib/backend';
import { GenerationFlowList } from './GenerationFlowList';
import { GenerationFlowCanvas } from './GenerationFlowCanvas';
import { FlowNodeDetailDrawer } from './FlowNodeDetailDrawer';
import type { GenerationTraceViewModel } from './graph/types';
import { parseTrace } from './graph/buildGenerationGraph';
import { ArrowLeft } from 'lucide-react';

export function GenerationFlow() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [selectedTrace, setSelectedTrace] = useState<GenerationTraceViewModel | null>(null);
  const [isLoadingTrace, setIsLoadingTrace] = useState(false);
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const data = await invokeAppApi<any>('admin.generationFlow.list', {});
        setJobs(data?.jobs || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoadingJobs(false);
      }
    };
    fetchJobs();
  }, []);

  const handleSelectJob = async (jobId: string) => {
    setIsLoadingTrace(true);
    setError(null);
    setSelectedNode(null);
    try {
      const data = await invokeAppApi<any>('admin.generationFlow.get', { jobId });
      if (data) {
        const trace = parseTrace(data);
        setSelectedTrace(trace);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoadingTrace(false);
    }
  };

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-error-container/20 text-error p-4 rounded-xl border border-error/40">
          <h3 className="font-bold mb-2">Error loading Generation Flow</h3>
          <p className="text-sm">{error}</p>
          <button onClick={() => setError(null)} className="mt-4 px-4 py-2 bg-error text-on-error rounded-lg text-sm font-semibold hover:bg-error-dark">
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (selectedTrace) {
    return (
      <div className="h-full flex flex-col relative overflow-hidden bg-surface-container-lowest">
        <div className="flex-none p-4 border-b border-outline-variant/30 flex justify-between items-center bg-white z-10">
          <div>
            <div className="flex items-center gap-4">
              <button 
                onClick={() => {
                  setSelectedTrace(null);
                  setSelectedNode(null);
                }} 
                className="p-2 hover:bg-surface-container-low rounded-full transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-on-surface" />
              </button>
              <div>
                <h2 className="text-lg font-bold text-on-surface leading-tight">
                  {selectedTrace.summary.sku_name || 'Unnamed Product'}
                </h2>
                <div className="text-xs text-secondary flex gap-3 mt-1 font-medium">
                  <span>ID: {selectedTrace.summary.job_id}</span>
                  <span>Model: {selectedTrace.summary.model}</span>
                  <span>Cost: ${(selectedTrace.summary.actual_cost_usd || 0).toFixed(3)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex-1 relative">
          <GenerationFlowCanvas 
            trace={selectedTrace} 
            onNodeSelect={(node) => setSelectedNode(node)} 
          />
        </div>

        {selectedNode && (
          <FlowNodeDetailDrawer 
            node={selectedNode} 
            onClose={() => setSelectedNode(null)} 
          />
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col max-w-4xl mx-auto w-full border-l border-r border-outline-variant/30 bg-white shadow-sm">
      <div className="p-6 border-b border-outline-variant/30">
        <h2 className="text-xl font-bold text-on-surface mb-2">Generation Flow</h2>
        <p className="text-sm text-secondary">
          Select a historical Studio or Catalog generation to reconstruct its actual execution flow graph.
        </p>
      </div>
      
      {isLoadingTrace ? (
        <div className="p-8 text-center text-secondary">Loading trace data...</div>
      ) : (
        <GenerationFlowList 
          jobs={jobs} 
          onSelectJob={handleSelectJob} 
          isLoading={isLoadingJobs} 
        />
      )}
    </div>
  );
}
