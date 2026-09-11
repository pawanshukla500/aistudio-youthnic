import { useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import type { OutputOptions } from "../types";

export function OutputSettings({
  value,
  onChange,
  orgModel,
  orgModelLabel,
}: {
  value: OutputOptions;
  onChange: (value: OutputOptions) => void;
  orgModel?: OutputOptions["model"];
  orgModelLabel?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const set = <K extends keyof OutputOptions>(key: K, next: OutputOptions[K]) => onChange({ ...value, [key]: next });
  const activeModel = value.model || orgModel || "gpt-image-2.5-sunburst";

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
              Image generation · {activeModel} · {value.aspectRatio} · {value.imageSize} · {value.quality} quality
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
              value={activeModel}
              onChange={(event) => set("model", event.target.value as OutputOptions["model"])}
              className="h-10 w-full rounded-md border border-outline-variant bg-white px-3 text-sm outline-none focus:border-primary"
            >
              <option value="gpt-image-2.5-sunburst">
                GPT Image 2.5 Sunburst (High Fidelity & Character Memory){orgModel === "gpt-image-2.5-sunburst" ? " · Active Org Route" : ""}
              </option>
              <option value="gpt-image-2.5-flare">
                GPT Image 2.5 Flare (High Speed & Low Latency){orgModel === "gpt-image-2.5-flare" ? " · Active Org Route" : ""}
              </option>
              <option value="gpt-image-2">
                GPT Image 2 (Legacy Production){orgModel === "gpt-image-2" ? " · Active Org Route" : ""}
              </option>
              <option value="reve-2.1-image">
                Reve 2.1 Image{orgModel === "reve-2.1-image" ? " · Active Org Route" : ""}
              </option>
            </select>
            <p className="mt-1.5 text-[11px] leading-4 text-secondary">
              {value.model && orgModel && value.model !== orgModel
                ? `Custom override selected for this session. Organization default set in Administration is ${orgModelLabel || orgModel}.`
                : orgModel
                  ? `Using your organization's configured default model (${orgModelLabel || orgModel}) from Administration.`
                  : "Your organization’s server-side routing is automatically applied unless overridden."}
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
              <option value="medium">Medium · balanced default</option>
              <option value="high">High · maximum detail and cost</option>
            </select>
            <p className="mt-1.5 text-[11px] leading-4 text-secondary">Medium is the default for GPT Image 2 and the supported GPT Image 1 family.</p>
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
