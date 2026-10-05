import { useState } from "react";
import { Camera, CheckCircle2, ChevronDown, ChevronUp, Crosshair, Eye, Lock, Sparkles } from "lucide-react";
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

  const poseBadgeForIndex = (index: number) => {
    switch (index) {
      case 0:
        return { label: "ANCHOR", color: "bg-primary text-white" };
      case 1:
        return { label: "3/4 VIEW", color: "bg-surface-container text-on-surface" };
      case 2:
        return { label: "REAR TRUTH", color: "bg-amber-100 text-amber-900 border border-amber-300" };
      case 3:
        return { label: "EDITORIAL", color: "bg-pink-100 text-pink-900" };
      case 4:
        return { label: "MACRO DETAIL", color: "bg-teal-100 text-teal-900" };
      case 5:
        return { label: "SHOWCASE", color: "bg-indigo-100 text-indigo-900" };
      default:
        return { label: `POSE ${index + 1}`, color: "bg-surface-container text-secondary" };
    }
  };

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-outline-variant/40 bg-white shadow-xs transition-all">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-surface-container-low/40"
      >
        <div className="flex items-center gap-4">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-tr from-pink-50 to-white text-primary shadow-xs border border-primary/10">
            <Camera className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-on-surface">6-Pose Fashion Catalog Plan</h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                SCENE LOCKED
              </span>
            </div>
            <p className="mt-0.5 text-xs text-secondary">
              {ready
                ? `${enabledCount}/${poses.length || 6} poses locked and aligned with ground-truth references`
                : stale
                  ? "Stale plan · automatically reconstructing from revised references"
                  : "Waiting for product reference analysis…"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-secondary">
          <span className="text-xs font-semibold">{isOpen ? "Collapse plan" : "View 6 poses"}</span>
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-surface-container-low text-secondary transition-transform">
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="space-y-5 border-t border-outline-variant/30 bg-surface-container-lowest/60 p-5 sm:p-6">
          {!ready && (
            <div className="flex items-center gap-2.5 rounded-xl border border-outline-variant/50 bg-surface-container-low p-3.5 text-xs text-secondary">
              <Lock className="h-4 w-4 text-primary shrink-0" />
              <span>Catalog generation remains locked until Gemini vision creates and validates the 6-pose plan.</span>
            </div>
          )}

          {/* Horizontal pose selector cards */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            {poses.map((pose, index) => {
              const active = selected?.id === pose.id;
              const badge = poseBadgeForIndex(index);
              return (
                <button
                  key={pose.id}
                  type="button"
                  onClick={() => setActiveId(pose.id)}
                  className={`group relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all duration-200 ${
                    active
                      ? "border-primary bg-soft-blush/90 shadow-xs ring-2 ring-primary/20 -translate-y-0.5"
                      : "border-outline-variant/60 bg-white hover:border-primary/40 hover:bg-surface-container-low/40"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-on-surface">Pose {index + 1}</span>
                      <span className={`rounded-md px-1.5 py-0.2 text-[8px] font-bold uppercase tracking-wider ${badge.color}`}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-1 text-xs font-bold text-on-surface">{pose.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-secondary">{pose.purpose}</p>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-outline-variant/30 pt-2 text-[9px] font-medium text-secondary">
                    <span className="truncate">{pose.cameraAngle.split(" ")[0]}</span>
                    {active ? (
                      <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-outline-variant/70" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected pose detail view */}
          {selected && (
            <div className="rounded-2xl border border-outline-variant/60 bg-white p-5 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/30 pb-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
                    Inspecting Pose {poses.findIndex((p) => p.id === selected.id) + 1} of {poses.length}
                  </span>
                  <h3 className="font-syne text-lg font-bold text-on-surface">{selected.title}</h3>
                </div>
                <span className="rounded-full bg-soft-blush px-3 py-1 text-xs font-semibold text-primary border border-primary/20">
                  {selected.purpose}
                </span>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-secondary">{selected.description}</p>

              {/* Viewfinder Spec Grid */}
              <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest/80 p-3">
                  <span className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-secondary">
                    <Camera className="h-3.5 w-3.5 text-primary" /> Camera Angle
                  </span>
                  <span className="font-semibold text-on-surface">{selected.cameraAngle}</span>
                </div>

                <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest/80 p-3">
                  <span className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-secondary">
                    <Eye className="h-3.5 w-3.5 text-primary" /> Framing
                  </span>
                  <span className="font-semibold text-on-surface">{selected.framing || "3:4 Full Body Portrait"}</span>
                </div>

                <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest/80 p-3">
                  <span className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-secondary">
                    <Crosshair className="h-3.5 w-3.5 text-primary" /> Primary Reference
                  </span>
                  <span className="font-semibold capitalize text-on-surface">{selected.primaryReference.replaceAll("_", " ")}</span>
                </div>

                <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest/80 p-3">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-secondary">Body Position</span>
                  <span className="font-semibold text-on-surface">{selected.bodyPosition || "Natural garment-first position"}</span>
                </div>

                <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest/80 p-3">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-secondary">Hands & Arms</span>
                  <span className="font-semibold text-on-surface">{selected.handPlacement || "Hands clear of garment detail"}</span>
                </div>

                <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest/80 p-3">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-secondary">Expression</span>
                  <span className="font-semibold text-on-surface">{selected.expression || "Poised editorial fashion expression"}</span>
                </div>
              </div>

              {/* Highlighted Details */}
              <div className="mt-4">
                <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-secondary">
                  Preserved Detail Highlights
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {selected.highlightedDetails.map((detail) => (
                    <span
                      key={detail}
                      className="inline-flex items-center gap-1 rounded-full border border-pink-200 bg-pink-50/80 px-2.5 py-1 text-[10px] font-bold text-pink-700"
                    >
                      <Sparkles className="h-2.5 w-2.5" />
                      <span>{detail}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Product Visibility & Continuity Rules */}
              {(selected.productVisibilityRules?.length || selected.consistencyNotes) && (
                <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50/70 p-3.5 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-teal-900">
                    <CheckCircle2 className="h-4 w-4 text-teal-700" />
                    <span>Product Truth & Continuity Invariants</span>
                  </div>
                  {selected.productVisibilityRules?.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-teal-800">
                      {selected.productVisibilityRules.map((rule) => (
                        <li key={rule}>{rule}</li>
                      ))}
                    </ul>
                  ) : null}
                  {selected.consistencyNotes && (
                    <p className="mt-2 text-[11px] font-medium text-teal-900 border-t border-teal-200/50 pt-2">
                      {selected.consistencyNotes}
                    </p>
                  )}
                </div>
              )}

              {/* Editable Prompt */}
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-secondary">
                    Generation Prompt (Scene Locked)
                  </label>
                  <span className="text-[10px] text-secondary">{selected.prompt.length} characters</span>
                </div>
                <textarea
                  rows={3}
                  value={selected.prompt}
                  onChange={(event) => update(selected.id, { prompt: event.target.value })}
                  disabled={!ready}
                  placeholder="Pose prompt instructions..."
                  className="w-full resize-y rounded-xl border border-outline-variant/70 bg-white p-3 text-xs leading-relaxed text-on-surface shadow-xs outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-surface-container-low"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
