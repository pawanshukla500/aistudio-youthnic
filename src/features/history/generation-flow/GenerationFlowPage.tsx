import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { invokeAppApi } from '../../../lib/backend';
import { GenerationFlowCanvas } from './GenerationFlowCanvas';
import { FlowNodeDetailDrawer } from './FlowNodeDetailDrawer';
import { parseTrace } from './graph/buildGenerationGraph';
import { ArrowLeft } from 'lucide-react';

export function GenerationFlowPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  
  const [selectedGraphData, setSelectedGraphData] = useState<any | null>(null);
  const [isLoadingTrace, setIsLoadingTrace] = useState(true);
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    
    let ignore = false;

    const fetchFlow = async () => {
      setIsLoadingTrace(true);
      setError(null);
      try {
        const data = await invokeAppApi<any>('history.generationFlow.get', { jobId });
        if (!ignore) {
          if (data) {
            if (data.is_v2) {
              setSelectedGraphData(data);
            } else {
              const trace = parseTrace(data);
              setSelectedGraphData({ is_v2: false, trace });
            }
          }
        }
      } catch (err: any) {
        if (!ignore) {
          setError(err.message);
        }
      } finally {
        if (!ignore) {
          setIsLoadingTrace(false);
        }
      }
    };
    
    fetchFlow();

    return () => {
      ignore = true;
    };
  }, [jobId]);

  if (error) {
    return (
      <div className="p-8 h-screen w-full flex items-center justify-center bg-surface-container-lowest">
        <div className="bg-error-container/20 text-error p-6 rounded-xl border border-error/40 max-w-md w-full">
          <h3 className="font-bold mb-2">Error loading Generation Flow</h3>
          <p className="text-sm">{error}</p>
          <div className="flex gap-3 mt-6">
            <button onClick={() => navigate('/history')} className="flex-1 px-4 py-2 bg-surface-container hover:bg-surface-container-high text-on-surface rounded-lg text-sm font-semibold transition-colors">
              Back to History
            </button>
            <button onClick={() => window.location.reload()} className="flex-1 px-4 py-2 bg-error text-on-error rounded-lg text-sm font-semibold hover:bg-error-dark transition-colors">
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoadingTrace || !selectedGraphData) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-surface-container-lowest text-secondary">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent animate-spin rounded-full mb-4"></div>
        <p className="font-medium text-sm">Loading flow visualization...</p>
      </div>
    );
  }

  const summarySku = selectedGraphData.is_v2 
    ? (selectedGraphData.session?.session_data?.skuName || 'Unnamed Product') 
    : (selectedGraphData.trace?.summary?.sku_name || 'Unnamed Product');
    
  const summaryJobId = selectedGraphData.is_v2 
    ? selectedGraphData.session?.session_id 
    : selectedGraphData.trace?.summary?.job_id;
    
  const summaryModel = selectedGraphData.is_v2 ? 'V2 Node Graph' : selectedGraphData.trace?.summary?.model;
  const summaryCost = selectedGraphData.is_v2 ? 0 : (selectedGraphData.trace?.summary?.actual_cost_usd || 0);

  return (
    <div className="h-screen w-full flex flex-col relative overflow-hidden bg-surface-container-lowest">
      <div className="flex-none p-4 border-b border-outline-variant/30 flex justify-between items-center bg-white z-10">
        <div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => navigate('/history')} 
              className="p-2 hover:bg-surface-container-low rounded-full transition-colors flex flex-shrink-0"
              title="Back to History"
            >
              <ArrowLeft className="w-5 h-5 text-on-surface" />
            </button>
            <div>
              <h2 className="text-lg font-bold text-on-surface leading-tight">
                {summarySku}
              </h2>
              <div className="text-xs text-secondary flex gap-3 mt-1 font-medium">
                <span>ID: {summaryJobId}</span>
                <span>Model: {summaryModel}</span>
                <span>Cost: ${summaryCost.toFixed(3)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="flex-1 relative">
        <GenerationFlowCanvas 
          data={selectedGraphData} 
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
