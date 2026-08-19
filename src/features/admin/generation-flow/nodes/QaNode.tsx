export function QaNode({ data }: any) {
  const isPass = data.qa?.pass;
  const containerClass = `p-3 border rounded-lg bg-surface-container-lowest min-w-[200px] ${
    isPass ? 'border-success/40 bg-success-surface/40' : 'border-error/40 bg-error-container/20'
  }`;
  
  return (
    <div className={containerClass}>
      <div className="text-[10px] font-bold text-secondary uppercase tracking-wider mb-1">◉ GEMINI QA</div>
      <div className="text-xs text-on-surface font-semibold mb-1">{data.poseTitle}</div>
      <div className="text-xs mb-1">Fidelity {Math.round(data.qa?.score || 0)}%</div>
      {!isPass && data.qa?.failed_checks?.map((c: string) => (
        <div key={c} className="text-xs text-error">{c} ✕</div>
      ))}
      <div className={`mt-2 text-[10px] font-bold ${isPass ? 'text-success' : 'text-error'}`}>
        {isPass ? 'QA PASS' : 'RETRY REQUIRED'}
      </div>
    </div>
  );
}