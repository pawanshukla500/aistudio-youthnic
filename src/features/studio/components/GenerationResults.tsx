import { CheckCircle2, Clock3, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import type { Id } from "../../../lib/backend";
import { Button } from "../../../components/ui/Button";
import { generationDeliveryProgress } from "../../../lib/generationProgress";

export function GenerationResults({
  job,
  regeneratingPose,
  onRegenerate,
}: {
  job: any;
  regeneratingPose: Id<"generationPoses"> | null;
  onRegenerate: (poseId: Id<"generationPoses">) => void;
}) {
  const delivery = generationDeliveryProgress(job || {});

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">{job.skuName || job.skuId}</p>
          <p className="text-xs text-secondary">One session · {job.aspectRatio} · {job.model}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${job.status === "completed" ? "bg-success-surface text-success" : job.status === "failed" ? "bg-danger-surface text-danger" : "bg-primary-container/20 text-primary"}`}>
          {job.status}
        </span>
      </div>

      {!["completed", "failed", "cancelled"].includes(job.status) && (
        <div>
          <div className="mb-1.5 flex justify-between text-xs text-secondary"><span>{delivery.imagesStored}/{delivery.totalPoses} images stored{delivery.failedPoses ? ` · ${delivery.failedPoses} failed` : ""}</span><span>{delivery.deliveredPercent}% delivered</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-container"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${delivery.deliveredPercent}%` }} /></div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {job.poses.map((pose: any) => (
          <article key={pose._id} className="overflow-hidden rounded-xl border border-outline-variant/40 bg-white shadow-sm">
            <div className="relative aspect-[3/4] bg-surface-container-low">
              {pose.outputUrl ? (
                <img src={pose.outputUrl} alt={pose.title} className="h-full w-full object-cover" />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-secondary">
                  {pose.status === "generating" ? <Loader2 className="h-7 w-7 animate-spin text-primary" /> : pose.status === "failed" ? <TriangleAlert className="h-7 w-7 text-danger" /> : <Clock3 className="h-7 w-7" />}
                </div>
              )}
              <span className="absolute left-2 top-2 rounded-full bg-navy-soft/80 px-2 py-1 text-[10px] font-bold text-white">Pose {pose.poseNumber}</span>
            </div>
            <div className="space-y-2 p-3">
              <h3 className="text-sm font-bold leading-tight">{pose.title}</h3>
              <div className="flex items-center gap-1 text-[11px] text-secondary">
                {pose.qaStatus === "passed" ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : pose.qaStatus === "unverified" ? <TriangleAlert className="h-3.5 w-3.5 text-warning" /> : pose.status === "failed" ? <TriangleAlert className="h-3.5 w-3.5 text-danger" /> : <Clock3 className="h-3.5 w-3.5" />}
                {pose.qaStatus === "passed" ? "Consistency passed" : pose.qaStatus === "unverified" ? "QA unverified — review" : pose.status === "failed" ? "Needs review" : pose.status}
              </div>
              {pose.error && <p className="line-clamp-3 text-[10px] leading-relaxed text-danger">{pose.error}</p>}
              {!["queued", "generating"].includes(job.status) && (
                <Button
                  variant="secondary"
                  onClick={() => onRegenerate(pose._id)}
                  disabled={regeneratingPose === pose._id}
                  className="mt-1 w-full py-2 text-xs"
                >
                  {regeneratingPose === pose._id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                  Regenerate
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
