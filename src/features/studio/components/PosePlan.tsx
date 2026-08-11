import { Camera, ChevronDown, ChevronUp, Crosshair, PersonStanding } from "lucide-react";
import { useState } from "react";
import type { StudioPose } from "../types";

export function PosePlan({
  poses,
  onChange,
  enabledCount,
  ready,
  stale,
}: {
  poses: StudioPose[];
  onChange: (poses: StudioPose[]) => void;
  enabledCount: number;
  ready: boolean;
  stale: boolean;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(poses[0]?.id || null);

  const update = (id: string, patch: Partial<StudioPose>) =>
    onChange(poses.map((pose) => (pose.id === id ? { ...pose, ...patch } : pose)));

  const selected = poses.find((pose) => pose.id === activeId) || poses[0] || null;

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-surface-container-low/50"
      >
        <div className="flex items-center gap-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-pink-50 text-pink-600">
            <PersonStanding className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-on-surface">Poses</h2>
            <p className="mt-0.5 text-xs text-secondary">
              {ready ? `${enabledCount}/5 ready from Gemini` : stale ? "Stale - rebuilding automatically" : "Waiting for product analysis"}
            </p>
          </div>
        </div>
        <div className="text-secondary">{isOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</div>
      </button>

      {isOpen && (
        <div className="space-y-4 border-t border-outline-variant/30 bg-white/50 p-5">
          {!ready && (
            <div className="rounded-lg border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-xs text-secondary">
              Generation remains locked until Gemini has created the current five-pose plan.
            </div>
          )}

          {/* Horizontal pose selector row */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {poses.map((pose, index) => {
              const active = selected?.id === pose.id;
              return (
                <button
                  key={pose.id}
                  type="button"
                  onClick={() => setActiveId(pose.id)}
                  className={`rounded-xl border p-3 text-left transition ${active ? "border-primary/40 bg-soft-blush shadow-sm" : "border-outline-variant/60 bg-white hover:border-outline-variant"}`}
                >
                  <div className="flex items-center gap-2">
                    <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border border-outline-variant/40 bg-surface-container-lowest">
                      <PersonStanding className="h-4 w-4 text-secondary" />
                    </div>
                    <span className="text-xs font-bold text-on-surface">Pose {index + 1}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[11px] font-semibold text-on-surface">{pose.title}</p>
                  <p className="mt-0.5 line-clamp-1 text-[10px] text-secondary">{pose.purpose}</p>
                </button>
              );
            })}
          </div>

          {/* Selected pose detail, full width */}
          {selected && (
            <div className="rounded-xl border border-outline-variant/60 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-bold text-on-surface">{selected.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-secondary">{selected.description}</p>

              <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg border border-outline-variant/40 bg-white p-3 shadow-sm">
                  <span className="mb-1 flex items-center gap-1.5 font-bold text-secondary"><Camera className="h-3.5 w-3.5" /> Camera</span>
                  <span>{selected.cameraAngle}</span>
                </div>
                <div className="rounded-lg border border-outline-variant/40 bg-white p-3 shadow-sm">
                  <span className="mb-1 block font-bold text-secondary">Framing</span>
                  <span>{selected.framing || "Product-appropriate 3:4 portrait framing"}</span>
                </div>
                <div className="rounded-lg border border-outline-variant/40 bg-white p-3 shadow-sm">
                  <span className="mb-1 flex items-center gap-1.5 font-bold text-secondary"><Crosshair className="h-3.5 w-3.5" /> Primary ref</span>
                  <span className="capitalize">{selected.primaryReference.replaceAll("_", " ")}</span>
                </div>
                <div className="rounded-lg border border-outline-variant/40 bg-white p-3 shadow-sm">
                  <span className="mb-1 block font-bold text-secondary">Body position</span>
                  <span>{selected.bodyPosition || "Natural garment-first position"}</span>
                </div>
                <div className="rounded-lg border border-outline-variant/40 bg-white p-3 shadow-sm">
                  <span className="mb-1 block font-bold text-secondary">Hands</span>
                  <span>{selected.handPlacement || "Keep hands clear of product details"}</span>
                </div>
                <div className="rounded-lg border border-outline-variant/40 bg-white p-3 shadow-sm">
                  <span className="mb-1 block font-bold text-secondary">Expression</span>
                  <span>{selected.expression || "Consistent professional expression"}</span>
                </div>
              </div>

              <div className="mt-3">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-secondary">Highlights</span>
                <div className="flex flex-wrap gap-1.5">
                  {selected.highlightedDetails.map((detail) => (
                    <span key={detail} className="rounded-full border border-pink-100 bg-pink-50 px-2.5 py-1 text-[10px] font-semibold text-pink-700">{detail}</span>
                  ))}
                </div>
              </div>

              {(selected.productVisibilityRules?.length || selected.consistencyNotes) && (
                <div className="mt-3 rounded-lg border border-teal-100 bg-teal-50/60 p-3 text-xs">
                  <span className="font-bold text-teal-800">Product visibility & continuity</span>
                  {selected.productVisibilityRules?.length ? (
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-teal-900">
                      {selected.productVisibilityRules.map((rule) => <li key={rule}>{rule}</li>)}
                    </ul>
                  ) : null}
                  {selected.consistencyNotes ? <p className="mt-2 text-teal-900">{selected.consistencyNotes}</p> : null}
                </div>
              )}

              <label className="mt-3 block text-[10px] font-bold uppercase tracking-wider text-secondary">
                Generation direction
                <textarea
                  rows={3}
                  value={selected.prompt}
                  onChange={(event) => update(selected.id, { prompt: event.target.value })}
                  disabled={!ready}
                  className="mt-1.5 w-full resize-y rounded-lg border border-outline-variant/60 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-on-surface shadow-sm outline-none focus:border-primary"
                />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
