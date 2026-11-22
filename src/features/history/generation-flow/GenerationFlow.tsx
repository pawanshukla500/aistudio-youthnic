import { useState, useEffect } from 'react';
import { invokeAppApi } from '../../../lib/backend';
import { GenerationFlowList } from './GenerationFlowList';
import { parseTrace } from './graph/buildGenerationGraph';
import { CatalogPoseFlow } from './CatalogPoseFlow';
import { boardFromGenerationData } from './boardFromGenerationData';

export function GenerationFlow() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [selectedGraphData, setSelectedGraphData] = useState<any | null>(null);
  const [isLoadingTrace, setIsLoadingTrace] = useState(false);
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
    try {
      const data = await invokeAppApi<any>('admin.generationFlow.get', { jobId });
      if (data) {
        if (data.is_v2) {
          setSelectedGraphData(data);
        } else {
          const trace = parseTrace(data);
          setSelectedGraphData({ is_v2: false, trace });
        }
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

  if (selectedGraphData) {
    const summaryJobId = selectedGraphData.is_v2
      ? selectedGraphData.session?.session_id
      : selectedGraphData.trace?.summary?.job_id;
    const board = boardFromGenerationData(selectedGraphData);

    // The board header carries the SKU, status, models, settings and cost.
    return (
      <div className="h-full flex flex-col relative overflow-hidden bg-[#f5f6f8]">
        <div className="min-h-0 flex-1 p-3">
          <CatalogPoseFlow className="h-full" references={board.references} poses={board.poses} summary={board.summary} storageKey={`admin-flow-${summaryJobId}`} onBack={() => setSelectedGraphData(null)} />
        </div>
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
