import { useCallback, useRef, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { invokeAppApi } from '../../../lib/backend';
import { parseTrace } from './graph/buildGenerationGraph';
import { supabase } from '../../../lib/supabase';
import { OperationalWorkflowView } from './OperationalWorkflowView';
import { CatalogPoseFlow, FlowBoardSkeleton } from './CatalogPoseFlow';
import { boardFromGenerationData } from './boardFromGenerationData';

export function GenerationFlowPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  
  const [selectedGraphData, setSelectedGraphData] = useState<any | null>(null);
  const [isLoadingTrace, setIsLoadingTrace] = useState(true);
  const [busyPose, setBusyPose] = useState<number | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestFlowReqRef = useRef(0);
  const poseActionLockRef = useRef(false);

  const fetchFlow = useCallback(async (silent = false) => {
    if (!jobId) return;
    const requestId = ++latestFlowReqRef.current;
    if (!silent) setIsLoadingTrace(true);
    setError(null);
    try {
      const data = await invokeAppApi<any>('history.generationFlow.get', { jobId });
      if (requestId !== latestFlowReqRef.current) return;
      if (data) {
        if (data.is_workflow_v2 || data.is_v2) {
          setSelectedGraphData(data);
        } else {
          const trace = parseTrace(data);
          setSelectedGraphData({ is_v2: false, trace });
        }
      }
    } catch (err: any) {
      if (requestId !== latestFlowReqRef.current) return;
      setError(err.message);
    } finally {
      if (!silent && requestId === latestFlowReqRef.current) setIsLoadingTrace(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    let ignore = false;
    const requestId = ++latestFlowReqRef.current;
    const load = async () => {
      setError(null);
      try {
        const data = await invokeAppApi<any>('history.generationFlow.get', { jobId });
        if (!ignore && requestId === latestFlowReqRef.current) {
          if (data) {
            if (data.is_workflow_v2 || data.is_v2) {
              setSelectedGraphData(data);
            } else {
              const trace = parseTrace(data);
              setSelectedGraphData({ is_v2: false, trace });
            }
          }
        }
      } catch (err: any) {
        if (!ignore && requestId === latestFlowReqRef.current) {
          setError(err.message);
        }
      } finally {
        if (!ignore && requestId === latestFlowReqRef.current) {
          setIsLoadingTrace(false);
        }
      }
    };
    
    void load();

    return () => {
      ignore = true;
    };
  }, [jobId]);

  useEffect(() => {
    const workItemId = selectedGraphData?.is_workflow_v2 ? selectedGraphData.item?.id : '';
    if (!workItemId) return;
    let timer = 0;
    const refreshSoon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void fetchFlow(true), 300);
    };
    const channel = supabase.channel(`catalog-workflow:${workItemId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catalog_work_items', filter: `id=eq.${workItemId}` }, refreshSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catalog_work_item_events', filter: `work_item_id=eq.${workItemId}` }, refreshSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catalog_work_item_comments', filter: `work_item_id=eq.${workItemId}` }, refreshSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catalog_pose_asset_versions', filter: `work_item_id=eq.${workItemId}` }, refreshSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catalog_listing_handoffs', filter: `work_item_id=eq.${workItemId}` }, refreshSoon)
      .subscribe();
    const recoveryPoll = window.setInterval(() => {
      if (!document.hidden && selectedGraphData?.item?.workflow_stage === 'generation_in_progress') {
        void fetchFlow(true);
      }
    }, 60_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(recoveryPoll);
      void supabase.removeChannel(channel);
    };
  }, [fetchFlow, selectedGraphData?.is_workflow_v2, selectedGraphData?.item?.id, selectedGraphData?.item?.workflow_stage]);

  const traceSummaryStatus = String(selectedGraphData?.trace?.summary?.status || "");
  useEffect(() => {
    if (selectedGraphData?.is_workflow_v2 || !["queued", "processing", "cancelling"].includes(traceSummaryStatus)) {
      return;
    }
    const timer = window.setInterval(() => {
      if (!document.hidden) void fetchFlow(true);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [fetchFlow, selectedGraphData?.is_workflow_v2, traceSummaryStatus]);

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
            <button onClick={() => { setError(null); void fetchFlow(); }} className="flex-1 px-4 py-2 bg-error text-on-error rounded-lg text-sm font-semibold hover:bg-error-dark transition-colors">
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoadingTrace || !selectedGraphData) {
    return (
      <div className="h-screen w-full bg-[#f5f6f8] p-3">
        <FlowBoardSkeleton className="h-full" />
      </div>
    );
  }

  if (selectedGraphData.is_workflow_v2) {
    return <OperationalWorkflowView boardOnly data={selectedGraphData} onRefresh={() => fetchFlow(true)} />;
  }

  const board = boardFromGenerationData(selectedGraphData);
  const summarySku = board.summary.skuName;
  const tracePoses = (selectedGraphData.trace?.poses || []) as Array<{ generation_id?: string; pose_index: number; storage_path?: string; final_output_url?: string }>;
  const traceJobId = String(selectedGraphData.trace?.summary?.job_id || "");

  const handleDownloadPose = async (poseIndex: number) => {
    const pose = tracePoses.find((item) => Number(item.pose_index) === poseIndex);
    const storagePath = String(pose?.storage_path || pose?.final_output_url || "").trim();
    if (!traceJobId || !storagePath || poseActionLockRef.current) return;
    poseActionLockRef.current = true;
    setBusyPose(poseIndex);
    setActionError(null);
    try {
      const result = await invokeAppApi<{ base64: string; mimeType: string }>("jobs.downloadAsset", {
        jobId: traceJobId,
        storagePath,
      });
      if (!result?.base64) throw new Error("Image asset was unavailable.");
      const clean = result.base64.replace(/[\r\n\s]/g, "").replace(/-/g, "+").replace(/_/g, "/");
      const binary = window.atob(clean);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: result.mimeType || "image/jpeg" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      const ext = (result.mimeType || "").includes("png") ? "png" : (result.mimeType || "").includes("webp") ? "webp" : "jpg";
      const safeName = String(summarySku || "pose").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "pose";
      anchor.download = `${safeName}-pose-${poseIndex}.${ext}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not download pose image.");
    } finally {
      poseActionLockRef.current = false;
      setBusyPose(undefined);
    }
  };

  const handleRegeneratePose = async (poseIndex: number, note: string) => {
    const pose = tracePoses.find((item) => Number(item.pose_index) === poseIndex);
    if (!pose?.generation_id || !note.trim() || poseActionLockRef.current) return;
    poseActionLockRef.current = true;
    setBusyPose(poseIndex);
    setActionError(null);
    try {
      await invokeAppApi("jobs.regenerate", { poseId: pose.generation_id, extraInstructions: note.trim() });
      await fetchFlow(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not queue pose re-generation.");
    } finally {
      poseActionLockRef.current = false;
      setBusyPose(undefined);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col relative overflow-hidden bg-[#f5f6f8]">
      <div className="min-h-0 flex-1 p-3">
        <CatalogPoseFlow
          className="h-full"
          references={board.references}
          poses={board.poses}
          summary={board.summary}
          message={actionError}
          storageKey={`flow-${jobId}`}
          onBack={() => navigate('/history')}
          onDownload={traceJobId ? handleDownloadPose : undefined}
          onRegenerate={traceJobId ? handleRegeneratePose : undefined}
          busyPose={busyPose}
        />
      </div>
    </div>
  );
}
