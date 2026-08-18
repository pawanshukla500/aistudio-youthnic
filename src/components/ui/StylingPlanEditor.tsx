// oxlint-disable react/only-export-components -- the plan type and its normalizer
// belong with the editor that owns the field list; splitting them apart invites the
// two shapes drifting from each other.
import { useEffect, useState } from "react";
import { Check, Loader2, Sparkles, Undo2 } from "lucide-react";

export type StylingPlan = {
  footwear: string;
  jewellery: string;
  ornaments: string;
  makeup: string;
  hair: string;
  stylingNotes: string;
  themeInterpretation: string;
};

export const emptyStylingPlan: StylingPlan = {
  footwear: "", jewellery: "", ornaments: "", makeup: "", hair: "", stylingNotes: "", themeInterpretation: "",
};

const FIELDS: Array<[keyof StylingPlan, string, string]> = [
  ["footwear", "Footwear", "e.g. Minimal beige block heels, 2 inch"],
  ["jewellery", "Jewellery", "e.g. Oxidised silver jhumkas + two thin bangles"],
  ["ornaments", "Ornaments / accessories", "e.g. No necklace, one minimal ring"],
  ["makeup", "Makeup", "e.g. Soft matte base, warm nude lip"],
  ["hair", "Hair", "e.g. Centre-parted soft waves, off the shoulder"],
  ["stylingNotes", "Styling notes", "e.g. Keep the right wrist bare so sleeve embroidery stays visible"],
  ["themeInterpretation", "Theme reading", "The aesthetic taken from the reference and why this styling serves it"],
];

export function normalizePlan(value: unknown): StylingPlan {
  const plan = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    footwear: String(plan.footwear || ""), jewellery: String(plan.jewellery || ""), ornaments: String(plan.ornaments || ""),
    makeup: String(plan.makeup || ""), hair: String(plan.hair || ""), stylingNotes: String(plan.stylingNotes || ""),
    themeInterpretation: String(plan.themeInterpretation || ""),
  };
}

/**
 * Shared by Studio (one shoot) and Planning (a whole catalogue) so a stylist sees
 * the same fields in both places and the catalogue plan cannot drift into a
 * different shape from the single-shoot one.
 */
export function StylingPlanEditor({
  plan,
  proposed,
  title,
  description,
  saving,
  saveLabel = "Save styling plan",
  approveLabel,
  onSave,
  onApprove,
  disabled = false,
}: {
  plan: StylingPlan;
  proposed?: StylingPlan | null;
  title: string;
  description: string;
  saving?: boolean;
  saveLabel?: string;
  approveLabel?: string;
  // Both callbacks report whether the write actually landed. They catch their own
  // errors to show a notice, so an explicit `false` is the only way this component
  // can tell a failed save from a successful one - and clearing the draft on a
  // failure would throw away the edits and disable the retry.
  onSave: (plan: StylingPlan) => Promise<boolean | void> | boolean | void;
  onApprove?: (plan: StylingPlan) => Promise<boolean | void> | boolean | void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<StylingPlan>(plan);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(plan);
  }, [plan, dirty]);

  const set = (key: keyof StylingPlan, value: string) => {
    setDirty(true);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const changedFromProposed = (key: keyof StylingPlan) => Boolean(proposed && proposed[key] && proposed[key] !== draft[key]);

  return (
    <div className="rounded-xl border border-outline-variant/40 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
            <Sparkles className="h-3.5 w-3.5" /> {title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-secondary">{description}</p>
        </div>
        {dirty && (
          <button
            type="button"
            onClick={() => { setDraft(plan); setDirty(false); }}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-secondary transition hover:bg-surface-container hover:text-on-surface"
          >
            <Undo2 className="h-3 w-3" /> Revert
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {FIELDS.map(([key, label, placeholder]) => (
          <label key={key} className={`block text-[11px] font-bold uppercase tracking-wider text-secondary ${key === "stylingNotes" || key === "themeInterpretation" ? "sm:col-span-2" : ""}`}>
            <span className="flex items-center gap-1.5">
              {label}
              {changedFromProposed(key) && <span className="rounded-full bg-soft-blush px-1.5 py-0.5 text-[9px] font-bold normal-case tracking-normal text-primary">edited</span>}
            </span>
            <textarea
              value={draft[key]}
              onChange={(event) => set(key, event.target.value)}
              rows={key === "stylingNotes" || key === "themeInterpretation" ? 2 : 2}
              placeholder={placeholder}
              disabled={disabled}
              className="mt-1.5 w-full resize-none rounded-lg border border-outline-variant/60 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-on-surface shadow-sm outline-none transition focus:border-primary disabled:bg-surface-container-low"
            />
          </label>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          disabled={disabled || saving || !dirty}
          onClick={async () => { if (await onSave(draft) !== false) setDirty(false); }}
          className="flex items-center gap-2 rounded-lg border border-outline-variant px-3 py-2 text-xs font-bold text-secondary transition hover:bg-surface-container disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {saveLabel}
        </button>
        {onApprove && (
          <button
            type="button"
            disabled={disabled || saving}
            onClick={async () => { if (await onApprove(draft) !== false) setDirty(false); }}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white transition hover:bg-primary-container disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {approveLabel || "Approve and start"}
          </button>
        )}
      </div>
    </div>
  );
}
