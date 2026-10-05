import { useState } from "react";
import { AlertTriangle, Aperture, CheckCircle2, ChevronDown, ChevronUp, Loader2, Palette, RefreshCcw, Shirt, Sparkles } from "lucide-react";
import type { StudioAnalysis } from "../types";
import { sareeProfilePresentation } from "../sareeProfilePresentation";

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
  ["suggestedAccessories", "Suggested accessories"],
  ["seatedPoseRequired", "Seated pose 4"],
  ["seatedPoseReason", "Seated pose evidence"],
  ["closeupMode", "Pose 5 close-up mode"],
  ["closeupHeroDetail", "Pose 5 product detail"],
  ["photographyStyle", "Photography"],
  ["shadowStyle", "Shadows"],
  ["lensAndCamera", "Lens & camera"],
  ["setContinuity", "Shoot continuity"],
  ["realismRules", "Photorealism rules"],
];

function analysisRouteLabel(analysis: StudioAnalysis | null) {
  if (!analysis?.analysisProvider || !analysis.analysisModel) return "Vision Analysis Engine";
  const provider = analysis.analysisProvider === "gemini"
    ? "Gemini"
    : analysis.analysisProvider === "openai"
      ? "OpenAI"
      : analysis.analysisProvider;
  const cache = analysis.cacheHit ? " · Cache Hit" : "";
  const thinking = analysis.analysisThinking ? ` · ${analysis.analysisThinking}` : "";
  return `${provider} ${analysis.analysisModel}${thinking}${cache}`;
}

function ProfileGrid({ items }: { items: Array<[string, unknown]> }) {
  return (
    <dl className="grid gap-2.5 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-xl bg-white border border-outline-variant/40 p-3 shadow-xs">
          <dt className="text-[10px] font-bold uppercase tracking-wider text-secondary">{label}</dt>
          <dd className="mt-1 text-xs font-semibold leading-relaxed text-on-surface">
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
  sceneDirection,
  onSceneDirectionChange,
  garmentSummary,
  onGarmentSummaryChange,
}: {
  analysis: StudioAnalysis | null;
  analyzing: boolean;
  ready: boolean;
  stale: boolean;
  current: boolean;
  onAnalyze: () => void;
  onImprovePosePlan: () => void;
  sceneDirection: string;
  onSceneDirectionChange: (value: string) => void;
  garmentSummary: string;
  onGarmentSummaryChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [contextOpen, setContextOpen] = useState(false);
  const sareeProfile = analysis ? sareeProfilePresentation(analysis.productIdentity) : null;
  const sareeTruth = sareeProfile?.truth;
  const sareeDrapePlan = sareeProfile?.drape;
  const sareeProfileIncomplete = sareeProfile?.incomplete === true;

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-outline-variant/40 bg-white shadow-xs transition-all">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-surface-container-low/40"
      >
        <div className="flex items-center gap-4">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-tr from-pink-50 to-white text-primary shadow-xs border border-primary/10">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-on-surface">Scene & Creative Direction</h2>
              {current && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="h-3 w-3" /> Ground-Truth Locked
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-secondary">
              {!ready
                ? "Upload the required product references to initiate vision analysis."
                : analyzing
                  ? `${analysisRouteLabel(analysis)} is extracting product ground-truth and scene rules…`
                  : current
                    ? `${analysisRouteLabel(analysis)} locked product identity and six-pose plan.`
                    : "Product inputs updated — analysis and pose plan are rebuilding automatically."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-secondary">
          <span className="text-xs font-semibold">{isOpen ? "Hide profile" : "View profile"}</span>
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-surface-container-low text-secondary transition-transform">
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="space-y-5 border-t border-outline-variant/30 bg-surface-container-lowest/60 p-5 sm:p-6">
          {/* Quick Actions Row */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onAnalyze}
              disabled={analyzing || !ready}
              className="flex items-center gap-2 rounded-xl bg-primary/10 px-3.5 py-2 text-xs font-bold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              <span>{analyzing ? "Analyzing references…" : analysis ? "Re-analyze Ground Truth" : "Analyze References Now"}</span>
            </button>
            <button
              type="button"
              onClick={onImprovePosePlan}
              disabled={analyzing || !current}
              className="flex items-center gap-2 rounded-xl border border-outline-variant/60 bg-white px-3.5 py-2 text-xs font-bold text-secondary transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Aperture className="h-4 w-4 text-primary" />
              <span>Optimize 6-Pose Plan</span>
            </button>
          </div>

          {/* Director's notes: Scene direction */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-xs font-bold uppercase tracking-wider text-secondary">
                Scene Direction & Environment
              </label>
              <span className="text-[10px] text-secondary">Director's note · guides backdrop, lighting & mood</span>
            </div>
            <textarea
              value={sceneDirection}
              onChange={(event) => onSceneDirectionChange(event.target.value)}
              rows={2}
              placeholder="Backdrop, lighting, and mood. Edit anytime — the pose plan automatically rebuilds from your edit."
              className="w-full resize-y rounded-xl border border-outline-variant/70 bg-white p-3 text-xs leading-relaxed text-on-surface shadow-xs outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
          </div>

          {/* Director's notes: Garment summary */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-xs font-bold uppercase tracking-wider text-secondary">
                Garment Summary & Invariants
              </label>
              <span className="text-[10px] text-secondary">Extracted garment profile · edit to override</span>
            </div>
            <textarea
              value={garmentSummary}
              onChange={(event) => onGarmentSummaryChange(event.target.value)}
              rows={2}
              placeholder="AI garment notes appear after analyzing references. Edit anytime — the pose plan rebuilds from your edit."
              className="w-full resize-y rounded-xl border border-outline-variant/70 bg-white p-3 text-xs leading-relaxed text-on-surface shadow-xs outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
          </div>

          {stale && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800 animate-pulse">
              <RefreshCcw className="h-4 w-4 shrink-0 text-amber-600 animate-spin" />
              <span>Inputs changed — rebuilding ground-truth profile and pose prompts automatically.</span>
            </div>
          )}

          {sareeProfileIncomplete && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs font-medium text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>Stored saree analysis is incomplete or outdated. Please reanalyse product references before generation.</span>
            </div>
          )}

          {/* Collapsible Full Model & Scene Context */}
          {analysis && (
            <div className={`overflow-hidden rounded-xl border border-outline-variant/40 bg-white shadow-xs ${stale ? "opacity-60" : ""}`}>
              <button
                type="button"
                onClick={() => setContextOpen(!contextOpen)}
                className="flex w-full items-center justify-between p-4 text-left text-xs font-bold text-on-surface hover:bg-surface-container-low/40"
              >
                <span className="flex items-center gap-2">
                  <Shirt className="h-4 w-4 text-primary" />
                  <span>Inspect Extracted Vision Profiles & Details</span>
                </span>
                {contextOpen ? <ChevronUp className="h-4 w-4 text-secondary" /> : <ChevronDown className="h-4 w-4 text-secondary" />}
              </button>

              {contextOpen && (
                <div className="space-y-5 border-t border-outline-variant/30 bg-surface-container-lowest/70 p-4">
                  <div className="flex items-start gap-2.5 rounded-xl border border-success/20 bg-success-surface p-3 text-xs text-success">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <p className="leading-relaxed">
                      {analysis.cacheHit
                        ? "A matching verified analysis was reused from storage cache to optimize latency and generation cost."
                        : "A new authoritative product identity and creative direction profile were derived from your reference photos."}
                    </p>
                  </div>

                  <div>
                    <h3 className="mb-2.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-secondary">
                      <Shirt className="h-4 w-4 text-primary" /> Product Identity Profile
                    </h3>
                    <ProfileGrid items={productFields.map(([key, label]) => [label, analysis.productIdentity[key]])} />
                  </div>

                  {analysis.productIdentity.invariantDetails.length > 0 && (
                    <div>
                      <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-secondary">
                        <Palette className="h-4 w-4 text-primary" /> Never-Change Invariant Details
                      </h3>
                      <div className="flex flex-wrap gap-1.5">
                        {analysis.productIdentity.invariantDetails.map((detail) => (
                          <span
                            key={detail}
                            className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary"
                          >
                            {detail}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {analysis.productIdentity.garmentFamily === "saree" && sareeTruth && (
                    <div>
                      <h3 className="mb-2.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-secondary">
                        <Shirt className="h-4 w-4 text-primary" /> Saree Truth
                      </h3>
                      <ProfileGrid items={sareeProfile.truthItems} />
                    </div>
                  )}

                  {analysis.productIdentity.garmentFamily === "saree" && sareeDrapePlan && (
                    <div>
                      <h3 className="mb-2.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-secondary">
                        <Palette className="h-4 w-4 text-primary" /> Saree Drape Plan
                      </h3>
                      <ProfileGrid items={sareeProfile.drapeItems} />
                    </div>
                  )}

                  <div>
                    <h3 className="mb-2.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-secondary">
                      <Aperture className="h-4 w-4 text-primary" /> Creative Direction Profile
                    </h3>
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
