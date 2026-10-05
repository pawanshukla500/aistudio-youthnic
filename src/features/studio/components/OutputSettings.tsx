import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Cpu, Ratio, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
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
  const routingReady = routingStatus === "ready";
  const modelOptions = routingReady ? (orgModelOptions || []) : [];
  const labelFor = (id: string) => modelOptions.find((option) => option.id === id)?.label || id;
  const overrideRejected = Boolean(value.model) && modelOptions.length > 0 && !modelOptions.some((option) => option.id === value.model);
  const summaryModel = routingStatus === "error"
    ? "route unavailable"
    : !routingReady
      ? "loading route…"
      : activeModel
        ? labelFor(activeModel)
        : "organization route";

  const aspectRatios: Array<{ id: OutputOptions["aspectRatio"]; label: string; desc: string }> = [
    { id: "3:4", label: "3:4", desc: "Portrait" },
    { id: "2:3", label: "2:3", desc: "Fashion" },
    { id: "4:5", label: "4:5", desc: "Feed" },
    { id: "1:1", label: "1:1", desc: "Square" },
    { id: "9:16", label: "9:16", desc: "Story" },
  ];

  const qualities: Array<{ id: OutputOptions["quality"]; label: string; desc: string; tag?: string }> = [
    { id: "low", label: "Low", desc: "Fastest draft · lowest token cost" },
    { id: "medium", label: "Medium", desc: "Balanced production quality", tag: "Recommended" },
    { id: "high", label: "High", desc: "Maximum skin & fabric detail · highest cost" },
  ];

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-outline-variant/40 bg-white shadow-xs transition-all">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-surface-container-low/40"
      >
        <div className="flex items-center gap-4">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-tr from-pink-50 to-white text-primary shadow-xs border border-primary/10">
            <SlidersHorizontal className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-on-surface">Output Parameters & Engine</h2>
              {value.poseQa && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                  <ShieldCheck className="h-3 w-3" /> QA Active
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-secondary">
              <span className="font-semibold text-on-surface">{summaryModel}</span>
              <span>·</span>
              <span className="rounded bg-surface-container px-1.5 py-0.5 text-[10px] font-bold text-on-surface">{value.aspectRatio}</span>
              <span className="rounded bg-surface-container px-1.5 py-0.5 text-[10px] font-bold text-on-surface">{value.imageSize}</span>
              <span className="rounded bg-surface-container px-1.5 py-0.5 text-[10px] font-bold text-on-surface capitalize">{value.quality} Quality</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-secondary">
          <span className="text-xs font-semibold">{isOpen ? "Hide settings" : "Edit settings"}</span>
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-surface-container-low text-secondary transition-transform">
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="space-y-6 border-t border-outline-variant/30 bg-surface-container-lowest/60 p-5 sm:p-6">
          {/* AI Model Route */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-secondary">
                <Cpu className="h-3.5 w-3.5 text-primary" />
                <span>Image Generation Model</span>
              </label>
              {orgModel && (
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[10px] font-bold text-primary">
                  <Sparkles className="h-3 w-3" /> Admin Route: {orgModelLabel || orgModel}
                </span>
              )}
            </div>
            <select
              value={value.model}
              disabled={!routingReady}
              onChange={(event) => set("model", event.target.value as OutputOptions["model"])}
              className="h-11 w-full rounded-xl border border-outline-variant/70 bg-white px-3.5 text-sm text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-surface-container-low disabled:text-secondary"
            >
              <option value="">
                {orgModel
                  ? `Default to Organization route · ${orgModelLabel || labelFor(orgModel)}`
                  : "Organization route (configured in Administration)"}
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
              className={`mt-1.5 text-[11px] leading-relaxed ${
                routingStatus === "error" || overrideRejected ? "text-danger font-medium" : "text-secondary"
              }`}
            >
              {routingStatus === "error"
                ? `Could not load your organization's route${routingError ? `: ${routingError}` : "."} No override can be applied until it loads. Check Administration → AI Models.`
                : !routingReady
                  ? "Loading your organization's configured policy route…"
                  : overrideRejected
                    ? `${value.model} is not accepted on this organization's route, so ${orgModelLabel || labelFor(orgModel || "") || "the organization model"} would run instead.`
                    : value.model && orgModel && value.model !== orgModel
                      ? `Overriding for this shoot session only. Workspace default in Administration stays ${orgModelLabel || labelFor(orgModel)}.`
                      : orgModel
                        ? `Using organization route: ${orgModelLabel || labelFor(orgModel)}.`
                        : "No organization route configured yet. Set one in Administration."}
            </p>
          </div>

          {/* Aspect Ratio & Resolution */}
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-secondary">
                <Ratio className="h-3.5 w-3.5 text-primary" />
                <span>Aspect Ratio</span>
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {aspectRatios.map((ar) => {
                  const active = value.aspectRatio === ar.id;
                  return (
                    <button
                      key={ar.id}
                      type="button"
                      onClick={() => set("aspectRatio", ar.id)}
                      className={`flex flex-col items-center justify-center rounded-xl border p-2 text-center transition-all ${
                        active
                          ? "border-primary bg-primary text-white shadow-xs font-bold"
                          : "border-outline-variant/60 bg-white text-on-surface hover:border-primary/40 hover:bg-soft-blush/30"
                      }`}
                    >
                      <span className="text-xs font-bold leading-tight">{ar.label}</span>
                      <span className={`text-[9px] ${active ? "text-white/80" : "text-secondary"}`}>{ar.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-secondary">
                Resolution Output
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["2K", "1K"] as const).map((size) => {
                  const active = value.imageSize === size;
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => set("imageSize", size)}
                      className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 transition-all ${
                        active
                          ? "border-primary bg-primary text-white shadow-xs font-bold"
                          : "border-outline-variant/60 bg-white text-on-surface hover:border-primary/40 hover:bg-soft-blush/30 font-semibold"
                      }`}
                    >
                      {active && <Check className="h-4 w-4" />}
                      <span className="text-xs">{size} Ultra High-Res</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Generation Quality */}
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-secondary">
              Generation Quality
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
              {qualities.map((q) => {
                const active = value.quality === q.id;
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => set("quality", q.id)}
                    className={`flex flex-col items-start justify-between rounded-xl border p-3 text-left transition-all ${
                      active
                        ? "border-primary bg-soft-blush/80 ring-2 ring-primary/20"
                        : "border-outline-variant/60 bg-white hover:border-outline-variant hover:bg-surface-container-low/40"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="text-xs font-bold capitalize text-on-surface">{q.label}</span>
                      {q.tag && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.2 text-[8px] font-bold uppercase tracking-wide text-primary">
                          {q.tag}
                        </span>
                      )}
                    </div>
                    <span className="mt-1 text-[10px] leading-relaxed text-secondary">{q.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Model Demographic & Background styling */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-secondary">
                Model Demographic
              </label>
              <select
                value={value.modelIdentity}
                onChange={(event) => set("modelIdentity", event.target.value)}
                className="h-11 w-full rounded-xl border border-outline-variant/70 bg-white px-3.5 text-sm text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
              >
                <option value="Same adult South Asian female fashion model across every pose">South Asian — Female</option>
                <option value="Same adult Asian female fashion model across every pose">Asian — Female</option>
                <option value="Same adult female fashion model selected to suit the garment">Auto selected — Female</option>
                <option value="Same adult male fashion model selected to suit the garment">Auto selected — Male</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-secondary">
                Background Styling
              </label>
              <select
                value={value.backgroundStyle}
                onChange={(event) => set("backgroundStyle", event.target.value)}
                className="h-11 w-full rounded-xl border border-outline-variant/70 bg-white px-3.5 text-sm text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
              >
                <option value="Infer a premium consistent scene from the uploaded style reference">Auto from references</option>
                <option value="Minimal premium warm-grey fashion studio with soft directional light">Studio Warm Grey</option>
                <option value="Clean seamless white e-commerce studio with soft shadows">Studio Clean White</option>
                <option value="Premium outdoor editorial scene with natural golden-hour lighting">Outdoor Editorial Sunset</option>
              </select>
            </div>
          </div>

          {/* Bottom wear styling */}
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-secondary">
              Bottom Wear Handling
            </label>
            <select
              value={value.bottomWear}
              onChange={(event) => set("bottomWear", event.target.value as OutputOptions["bottomWear"])}
              className="h-11 w-full rounded-xl border border-outline-variant/70 bg-white px-3.5 text-sm text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            >
              <option value="auto">Auto · detect from the product references</option>
              <option value="included">Outfit includes bottom wear · full-body top + bottom frames</option>
              <option value="top_only">Top only · never invent matching bottom wear</option>
            </select>
            <p className="mt-1 text-[10px] leading-relaxed text-secondary">
              Top-only keeps bottom styling plain & neutral so it is never mistaken as part of the listing product.
            </p>
          </div>

          {/* Pose QA Consistency Switch */}
          <div className="flex items-center justify-between rounded-xl border border-emerald-600/20 bg-emerald-50/60 p-4">
            <div className="pr-4">
              <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-950">
                <ShieldCheck className="h-4 w-4 text-emerald-700" />
                <span>Enable Gemini Vision Consistency QA</span>
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-emerald-800">
                Audits each delivered pose against uploaded product references for fabric fidelity, color accuracy, and embroidery preservation.
              </span>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={value.poseQa}
                onChange={(event) => set("poseQa", event.target.checked)}
                className="peer sr-only"
              />
              <div className="h-6 w-11 rounded-full bg-slate-300 transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-emerald-600 peer-checked:after:translate-x-full peer-focus:ring-4 peer-focus:ring-emerald-500/20" />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
