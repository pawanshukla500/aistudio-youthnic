import { Handle, Position } from '@xyflow/react';
export function QaNode({ data }: any) {
  const outcome = String(data.qa?.outcome || (data.qa?.pass ? 'automatically_verified' : 'rejected_by_qa'));
  const isPass = ['automatically_verified', 'human_approved', 'passed'].includes(outcome);
  const isReview = ['requires_human_review', 'unverified'].includes(outcome);
  const outcomeLabel: Record<string, string> = {
    automatically_verified: 'AUTOMATICALLY VERIFIED',
    requires_human_review: 'HUMAN REVIEW REQUIRED',
    unverified: 'QA UNAVAILABLE · UNVERIFIED',
    rejected_by_qa: 'REJECTED BY QA',
    human_approved: 'HUMAN APPROVED',
    human_rejected: 'HUMAN REJECTED',
    passed: 'AUTOMATICALLY VERIFIED (LEGACY)',
  };
  const containerClass = `p-3 border rounded-lg bg-surface-container-lowest min-w-[200px] ${
    isPass ? 'border-success/40 bg-success-surface/40' : isReview ? 'border-warning/40 bg-warning-surface/40' : 'border-error/40 bg-error-container/20'
  }`;
  
  return (
    <div className={containerClass}>
      <Handle type="target" position={Position.Top} />
      <div className="text-[10px] font-bold text-secondary uppercase tracking-wider mb-1">🎯 GEMINI QA</div>
      <div className="text-xs text-on-surface font-semibold mb-1">{data.poseTitle}</div>
      <div className="text-xs mb-1">AI QA estimate {Math.round(data.qa?.score || 0)}%</div>
      {!isPass && data.qa?.failed_checks?.map((c: string) => (
        <div key={c} className="text-xs text-error">{c} ❌</div>
      ))}
      <div className={`mt-2 text-[10px] font-bold ${isPass ? 'text-success' : isReview ? 'text-warning' : 'text-error'}`}>
        {outcomeLabel[outcome] || 'HUMAN REVIEW REQUIRED'}
      </div>
          <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
