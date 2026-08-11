import { useState } from "react";
import { Aperture, CheckCircle2, ChevronDown, ChevronUp, Loader2, Palette, Shirt, Sparkles } from "lucide-react";
import type { StudioAnalysis } from "../types";

const productFields: Array<[keyof StudioAnalysis["productIdentity"], string]> = [
  ["category", "Category"],
  ["mainColor", "Main color"],
  ["fabric", "Fabric"],
  ["pattern", "Pattern"],
  ["texture", "Texture"],
  ["neckline", "Neckline"],
  ["sleeveType", "Sleeves"],
  ["fit", "Fit"],
  ["silhouette", "Silhouette"],
  ["frontConstruction", "Front"],
  ["backConstruction", "Back"],
  ["bottomWearDetails", "Bottom wear"],
  ["footwearDetails", "Footwear"],
  ["detailPlacementMap", "Detail placement locks"],
  ["absenceConstraints", "Must remain absent"],
  ["embroidery", "Embroidery"],
  ["logos", "Logos"],
];

const creativeFields: Array<[keyof StudioAnalysis["creativeDirection"], string]> = [
  ["backgroundStyle", "Background"],
  ["studioEnvironment", "Environment"],
  ["lighting", "Lighting"],
  ["cameraPerspective", "Camera"],
  ["composition", "Composition"],
  ["mood", "Mood"],
  ["colorTreatment", "Color treatment"],
  ["modelStyling", "Model styling"],
  ["photographyStyle", "Photography"],
  ["shadowStyle", "Shadows"],
  ["lensAndCamera", "Lens & camera"],
  ["setContinuity", "Shoot continuity"],
  ["realismRules", "Photorealism rules"],
];

function ProfileGrid({ items }: { items: Array<[string, unknown]> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-surface-container-lowest border border-outline-variant/30 p-3 shadow-sm">
          <dt className="text-[10px] font-bold uppercase tracking-wider text-secondary">{label}</dt>
          <dd className="mt-1 text-xs leading-relaxed text-on-surface">
            {Array.isArray(value) ? value.join(", ") || "None observed" : String(value || "Not visible")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AnalysisProfile({ 
  analysis,
  analyzing,
  ready,
  stale,
  current,
  onAnalyze,
  onImprovePosePlan,
}: { 
  analysis: StudioAnalysis | null,
  analyzing: boolean,
  ready: boolean,
  stale: boolean,
  current: boolean,
  onAnalyze: () => void,
  onImprovePosePlan: () => void,
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [contextOpen, setContextOpen] = useState(false);

  const sceneDirection = analysis ? [
    analysis.creativeDirection.backgroundStyle,
    analysis.creativeDirection.studioEnvironment,
    analysis.creativeDirection.lighting,
    analysis.creativeDirection.mood,
  ].filter(Boolean).join(" · ") : "";

  const garmentSummary = analysis ? [
    analysis.productIdentity.category,
    analysis.productIdentity.mainColor,
    analysis.productIdentity.fabric,
    ...(analysis.productIdentity.invariantDetails || []),
  ].filter(Boolean).join(", ") : "";

  return (
    <div className="w-full">
      <button 
        type="button" 
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-surface-container-low/50"
      >
        <div className="flex items-center gap-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-pink-50 text-pink-600">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-on-surface">Scene & styling</h2>
            <p className="mt-0.5 text-xs text-secondary">
              {!ready
                ? "Upload front and back images to start Gemini Vision analysis."
                : analyzing
                  ? "Gemini Vision is locking the product, scene, model, and five-pose plan."
                  : current
                    ? "Current product identity and creative direction are locked for generation."
                    : "Inputs changed - analysis and the pose plan are stale and will rebuild automatically."}
            </p>
          </div>
        </div>
        <div className="text-secondary">
          {isOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-outline-variant/30 p-5 space-y-6 bg-white/50">
          
          <div className="flex items-center gap-4">
            <button 
              onClick={onAnalyze}
              disabled={analyzing || !ready}
              className="flex items-center gap-2 text-sm font-semibold text-teal-600 hover:text-teal-700 disabled:opacity-50 transition-colors"
            >
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {analyzing ? "Analyzing..." : analysis ? "Analyze again" : "Analyze now"}
            </button>
            <button
              type="button"
              onClick={onImprovePosePlan}
              disabled={analyzing || !current}
              className="flex items-center gap-2 text-sm font-semibold text-teal-600 hover:text-teal-700 disabled:opacity-50 transition-colors"
            >
              <Aperture className="h-4 w-4" />
              Improve Pose Plan
            </button>
          </div>

          <div>
            <label className="mb-2 block text-xs font-bold text-secondary">Scene direction</label>
            <textarea 
              readOnly 
              value={sceneDirection} 
              rows={3} 
              placeholder="Backdrop, lighting, and mood. Edit anytime." 
              className="w-full resize-none rounded-lg border border-outline-variant/60 bg-white px-3 py-2 text-sm text-on-surface shadow-sm outline-none focus:border-primary" 
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-bold text-secondary">Garment summary</label>
            <textarea 
              readOnly 
              value={garmentSummary} 
              rows={3} 
              placeholder="AI garment notes appear after analyzing references." 
              className="w-full resize-none rounded-lg border border-outline-variant/60 bg-white px-3 py-2 text-sm text-on-surface shadow-sm outline-none focus:border-primary" 
            />
          </div>

          {stale && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              Stale analysis - generation is locked until the automatic rebuild finishes.
            </div>
          )}

          {analysis && (
            <div className={`rounded-xl border border-outline-variant/40 bg-surface-container-lowest overflow-hidden shadow-sm ${stale ? "opacity-60" : ""}`}>
              <button 
                type="button" 
                onClick={() => setContextOpen(!contextOpen)}
                className="flex w-full items-center justify-between p-4 text-left text-sm font-bold text-on-surface hover:bg-surface-container-low/50"
              >
                Model & scene context
                {contextOpen ? <ChevronUp className="h-4 w-4 text-secondary" /> : <ChevronDown className="h-4 w-4 text-secondary" />}
              </button>
              
              {contextOpen && (
                <div className="border-t border-outline-variant/30 p-4 space-y-6 bg-surface-container-lowest/50">
                  <div className="flex items-start gap-3 rounded-lg border border-success/20 bg-success-surface/40 p-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-success" />
                    <p className="text-xs leading-relaxed text-success">
                      {analysis.cacheHit ? "A matching verified analysis was reused to reduce latency and cost." : "A new product identity and shoot direction were created from the uploaded images."}
                    </p>
                  </div>

                  <div>
                    <h3 className="mb-3 flex items-center gap-2 text-xs font-bold"><Shirt className="h-4 w-4 text-primary" /> Product Identity Profile</h3>
                    <ProfileGrid items={productFields.map(([key, label]) => [label, analysis.productIdentity[key]])} />
                  </div>

                  {analysis.productIdentity.invariantDetails.length > 0 && (
                    <div>
                      <h3 className="mb-2 flex items-center gap-2 text-xs font-bold"><Palette className="h-4 w-4 text-primary" /> Never-change details</h3>
                      <div className="flex flex-wrap gap-2">
                        {analysis.productIdentity.invariantDetails.map((detail) => (
                          <span key={detail} className="rounded-full border border-primary/15 bg-primary-container/10 px-2.5 py-1 text-[10px] font-semibold text-primary">{detail}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <h3 className="mb-3 flex items-center gap-2 text-xs font-bold"><Aperture className="h-4 w-4 text-primary" /> Creative Direction Profile</h3>
                    <ProfileGrid items={creativeFields.map(([key, label]) => [label, analysis.creativeDirection[key]])} />
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
