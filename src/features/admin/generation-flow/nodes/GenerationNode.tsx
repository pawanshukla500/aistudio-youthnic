import { Handle, Position } from '@xyflow/react';

export function GenerationNode({ data }: any) { 
  const isV2 = data.status !== undefined && data.inputs !== undefined;
  
  const latency = isV2 ? data.outputs?.latency_ms : data.attempt?.latency_ms;
  const isFiniteLatency = Number.isFinite(latency) && latency !== null;
  const model = isV2 ? 'GPT IMAGE 2' : (data.attempt?.model || 'GPT IMAGE 2');
  const title = isV2 ? `Pose ${data.inputs?.poseIndex || '?'}` : (data.poseTitle || 'Pose');
  const attemptIndex = isV2 ? data.inputs?.attempt : data.attempt?.attempt_index;

  return (
    <div className={`p-3 border rounded-lg min-w-[200px] ${isV2 ? (data.status === 'running' ? 'bg-primary-container border-primary' : data.status === 'completed' ? 'bg-surface-container-lowest border-success' : data.status === 'failed' ? 'bg-error-container border-error' : 'bg-surface-container-low') : 'bg-surface-container-lowest'}`}>
      <Handle type="target" position={Position.Top} />
      <div className='text-[10px] font-bold text-secondary uppercase tracking-wider mb-1'>✨ {model}</div>
      <div className='text-xs text-on-surface'>{title} · Attempt {attemptIndex || 1}</div>
      <div className='mt-2 text-xs text-secondary'>{isFiniteLatency ? `${(latency / 1000).toFixed(1)} sec | ` : 'N/A | '}</div>
      <div className='mt-1 text-xs font-semibold text-success'>
        {isV2 ? (data.status === 'running' ? 'Generating...' : data.status === 'completed' ? '✓ Generated' : data.status === 'failed' ? 'Failed' : 'Pending') : '✓ Generated'}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  ); 
}