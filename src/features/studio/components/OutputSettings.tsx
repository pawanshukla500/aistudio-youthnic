import { useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import type { OutputOptions } from "../types";

export function OutputSettings({
  value,
  onChange,
  orgModel,
  orgModelLabel,
  orgModelOptions,
  routingStatus = "loading",
  routingError,
}: {
  value: OutputOptions;
  onChange: (value: OutputOptions) => void;
  orgModel?: OutputOptions["model"];
  orgModelLabel?: string;
  /** Models this organization's provider actually accepts, served by the API. */
  orgModelOptions?: Array<{ id: OutputOptions["model"]; label: string }>;
  /** Whether the organization's route has actually arrived yet. */
  routingStatus?: "loading" | "ready" | "error";
  routingError?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const set = <K extends keyof OutputOptions>(key: K, next: OutputOptions[K]) => onChange({ ...value, [key]: next });
  // No override means the organization's route is what will run.
  const activeModel = value.model || orgModel || "";
  // There is deliberately no static list to fall back on. A model this
  // organization's provider does not accept is discarded at queue time without
  // telling anyone, so until the served list arrives there is nothing honest to
  // offer and the control stays disabled rather than inviting a silent no-op.
  const routingReady = routingStatus === "ready";
  const modelOptions = routingReady ? (orgModelOptions || []) : [];
  const labelFor = (id: string) => modelOptions.find((option) => option.id === id)?.label || id;
  // Selected, but not something this route accepts: the queue would quietly run
  // the organization's model instead, so say so rather than showing it as live.
  const overrideRejected = Boolean(value.model) && modelOptions.length > 0 && !modelOptions.some((option) => option.id === value.model);
  const summaryModel = routingStatus === "error"
    ? "route unavailable"
    : !routingReady
      ? "loading route…"
      : activeModel
        ? labelFor(activeModel)
        : "organization route";

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-surface-container-low/50"
      >
        <div className="flex items-center gap-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-pink-50 text-pink-600">
            <SlidersHorizontal className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-on-surface">Output settings</h2>
            <p className="mt-0.5 text-xs text-secondary">
              Image generation · {summaryModel} · {value.aspectRatio} · {value.imageSize} · {value.quality} quality
            </p>
          </div>
        </div>
        <div className="text-secondary">
          {isOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </div>
      </button>

      {isOpen && (
        <div className="space-y-5 border-t border-outline-variant/30 bg-white/50 p-5">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-xs font-semibold text-secondary">Image generation model</label>
              {orgModel && (
                <span className="rounded-md bg-pink-50 px-2 py-0.5 text-[10px] font-bold text-primary">
                  Admin route: {orgModelLabel || orgModel}
                </span>
              )}
            </div>
            <select
              value={value.model}
              disabled={!routingReady}
              onChange={(event) => set("model", event.target.value as OutputOptions["model"])}
              className="h-10 w-full rounded-md border border-outline-variant bg-white px-3 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:bg-surface-container-low disabled:text-secondary"
            >
              <option value="">
                {orgModel
                  ? `Organization route · ${orgModelLabel || labelFor(orgModel)}`
                  : "Organization route (set in Administration)"}
              </option>
              {modelOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}{orgModel === opt.id ? " · Active Org Route" : ""}
                </option>
              ))}
              {Boolean(value.model) && !modelOptions.some((opt) => opt.id === value.model) && (
                <option value={value.model}>
                  {value.model}{overrideRejected ? " · not accepted on this route" : ""}
                </option>
              )}
            </select>
            <p
              className={`mt-1.5 text-[11px] leading-4 ${
                routingStatus === "error" || overrideRejected ? "text-red-600" : "text-secondary"
              }`}
            >
              {routingStatus === "error"
                ? `Could not load your organization's route${routingError ? `: ${routingError}` : "."} No override can be applied until it loads, and generation may fail with the same error. Check the image-generation route in Administration.`
                : !routingReady
                  ? "Loading your organization's route from Administration…"
                  : overrideRejected
                    ? `${value.model} is not accepted on this organization's route, so ${orgModelLabel || labelFor(orgModel || "") || "the organization model"} would run instead. Pick a listed model, or clear the override.`
                    : value.model && orgModel && value.model !== orgModel
                      ? `Overriding this shoot only. Your organization's route in Administration stays ${orgModelLabel || labelFor(orgModel)}.`
                      : orgModel
                        ? `Using your organization's route from Administration: ${orgModelLabel || labelFor(orgModel)}.`
                        : "No organization route is configured yet, so the system default applies. Set one in Administration."}
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-secondary">Model identity</label>
            <select value={value.modelIdentity} onChange={(event) => set("modelIdentity", event.target.value)} className="h-10 w-full rounded-md border border-outline-variant bg-white px-3 text-sm outline-none focus:border-primary">
              <option value="Same adult South Asian female fashion model across every pose">South Asian — Female</option>
              <option value="Same adult Asian female fashion model across every pose">Asian — Female</option>
              <option value="Same adult female fashion model selected to suit the garment">Auto selected — Female</option>
              <option value="Same adult male fashion model selected to suit the garment">Auto selected — Male</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-secondary">Aspect ratio</label>
              <select value={value.aspectRatio} onChange={(event) => set("aspectRatio", event.target.value)} className="h-10 w-full rounded-md border border-outline-variant bg-white px-3 text-sm outline-none focus:border-primary">
                <option value="3:4">3:4</option>
                <option value="2:3">2:3</option>
                <option value="4:5">4:5</option>
                <option value="1:1">1:1</option>
                <option value="9:16">9:16</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-secondary">Resolution</label>
              <select value={value.imageSize} onChange={(event) => set("imageSize", event.target.value)} className="h-10 w-full rounded-md border border-outline-variant bg-white px-3 text-sm outline-none focus:border-primary">
                <option value="2K">2K</option>
                <option value="1K">1K</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-secondary">Generation quality</label>
            <select value={value.quality} onChange={(event) => set("quality", event.target.value as OutputOptions["quality"])} className="h-10 w-full rounded-md border border-outline-variant bg-white px-3 text-sm outline-none focus:border-primary">
              <option value="low">Low · fastest draft</option>
              <option value="medium">Medium · balanced, lower cost</option>
              <option value="high">High · most realistic (default)</option>
            </select>
            <p className="mt-1.5 text-[11px] leading-4 text-secondary">High is the default because it gives the most photographic skin, hair and fabric detail. Choose Medium to cut image cost.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-secondary">Background styling</label>
            <select value={value.backgroundStyle} onChange={(event) => set("backgroundStyle", event.target.value)} className="h-10 w-full rounded-md border border-outline-variant bg-white px-3 text-sm outline-none focus:border-primary">
              <option value="Infer a premium consistent scene from the uploaded style reference">Auto from references</option>
              <option value="Minimal premium warm-grey fashion studio with soft directional light">Studio grey</option>
              <option value="Clean seamless white e-commerce studio with soft shadows">Studio white</option>
              <option value="Premium outdoor editorial scene with natural golden-hour lighting">Outdoor editorial</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-secondary">Bottom wear</label>
            <select value={value.bottomWear} onChange={(event) => set("bottomWear", event.target.value as OutputOptions["bottomWear"])} className="h-10 w-full rounded-md border border-outline-variant bg-white px-3 text-sm outline-none focus:border-primary">
              <option value="auto">Auto · detect from the product references</option>
              <option value="included">Outfit includes bottom wear · full-body top + bottom frames</option>
              <option value="top_only">Top only · never invent matching bottom wear</option>
            </select>
            <p className="mt-1.5 text-[11px] leading-4 text-secondary">Kurti/kurta sets with pants, palazzo, skirt or salwar get full-body poses showing both pieces. Top-only keeps the bottom plain and neutral so it never reads as part of the product.</p>
            {value.bottomWear !== "auto" && (
              <p className="mt-1 text-[11px] leading-4 text-secondary">This setting is applied at generation time and overrides any bottom-wear wording left in the pose plan below, so you do not need to re-run the analysis after changing it.</p>
            )}
          </div>
          <label className="flex cursor-pointer items-center justify-between border-t border-outline-variant/30 pt-4">
            <span>
              <span className="block text-[13px] font-semibold text-on-surface">Enable Pose QA</span>
              <span className="block text-[11px] text-secondary">Validate garment and pose consistency before returning image (optional)</span>
            </span>
            <input type="checkbox" checked={value.poseQa} onChange={(event) => set("poseQa", event.target.checked)} className="h-4 w-4 accent-primary" />
          </label>
        </div>
      )}
    </div>
  );
}
