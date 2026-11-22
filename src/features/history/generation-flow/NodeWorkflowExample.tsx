import { CatalogPoseFlow, type FlowPose, type FlowReference } from "./CatalogPoseFlow";
import { flowSummaryFrom } from "./flowSummary";

function frame(label: string, room: boolean) {
  const backdrop = room ? "#e7d3c4" : "#f4f1ec";
  const floor = room ? `<rect y="150" width="160" height="60" fill="#c4a48a"/><path d="M18 150 V28 h124 v122" fill="none" stroke="#f7f1ea" stroke-width="7"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 210"><rect width="160" height="210" fill="${backdrop}"/>${floor}<path d="M48 36 h64 l14 22 v112 H34 V58 Z" fill="#1c2744"/><path d="M62 36 h36 l6 14 H56 Z" fill="#f6ead0"/>${Array.from({ length: 12 }, (_, index) => `<circle cx="${68 + (index % 3) * 10}" cy="${78 + Math.floor(index / 3) * 16}" r="1.7" fill="#e4c56b"/>`).join("")}<title>${label}</title></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const references: FlowReference[] = [
  { id: "front", role: "front", label: "Front reference", imageUrl: frame("Front", false) },
  { id: "back", role: "back", label: "Back reference", imageUrl: frame("Back", false) },
  { id: "fabric", role: "fabric", label: "Fabric reference", imageUrl: frame("Fabric", false) },
  { id: "face", role: "model_identity", label: "Model face", imageUrl: frame("Face", false) },
  { id: "room", role: "style_reference", label: "Style reference", imageUrl: frame("Room", true), postureFor: [4] },
];

const prompt = "Navy kurti, gold butti across the chest and hem. Keep the uploaded front, back, and fabric exactly. The style photo is the room only: warm wall, wood floor, soft window light. Do not copy any clothing from the style photo. Pose is a calm standing hero, two arms, two hands, full garment visible.";

const run = { model: "gpt-image-2.6-sunburst", aspectRatio: "3:4", imageSize: "2K", quality: "medium", canRegenerate: true };

const poses: FlowPose[] = [
  { ...run, poseIndex: 1, title: "Front hero", prompt: `Pose 1: Front hero, calm standing anchor. ${prompt}`, imageUrl: frame("Pose 1", true), referenceRoles: ["front"], qaLabel: "DNA 96%", qaTone: "good", versionCount: 1, versions: [{ version: 1, status: "pending", imageUrl: frame("Pose 1", true) }] },
  { ...run, poseIndex: 2, title: "40-degree turn", prompt: `Pose 2: 40-degree turn. ${prompt}`, imageUrl: frame("Pose 2", true), referenceRoles: ["front", "back"], qaLabel: "Needs review", qaTone: "warn" },
  { ...run, poseIndex: 3, title: "True back", prompt: `Pose 3: True back. ${prompt} Turn to show the true back. The rear product reference is the only authority for the back.`, imageUrl: frame("Pose 3", true), referenceRoles: ["back"], qaLabel: "DNA 94%", qaTone: "good" },
  { ...run, poseIndex: 4, title: "Editorial, reference posture", prompt: `Pose 4: Editorial. ${prompt}`, imageUrl: "", referenceRoles: ["front"], status: "processing" },
  { ...run, poseIndex: 5, title: "Butti detail crop", prompt: `Pose 5: Detail. ${prompt} Crop to the gold butti on the chest. Do not switch the hero detail to a dupatta.`, imageUrl: frame("Pose 5", true), referenceRoles: ["front", "fabric"], qaLabel: "DNA 95%", qaTone: "good" },
  { ...run, poseIndex: 6, title: "Showcase", prompt: `Pose 6: Showcase. ${prompt}`, imageUrl: "", referenceRoles: ["front"], status: "failed", error: "The image provider timed out. Re-generate to try again." },
];

const summary = flowSummaryFrom({
  skuName: "Example navy kurti",
  sessionData: {
    analysisModel: "muse-spark-1.3-contributor",
    analysisProvider: "meta",
    analysisVersion: 37,
    analysisPolicy: { requested: { thinkingLevel: "medium", fallbacks: [{ model: "glm-5.3-flash" }, { model: "gpt-6.1-terra" }] } },
    productIdentity: { category: "ethnic/fusion", mainColor: "navy", fabric: "soft matte cotton", print: "gold butti across chest and hem", neckline: "round with placket" },
    posePlan: poses.map((pose) => ({ title: pose.title })),
    posePlanning: { slots: { creative: { source: "reference" } } },
  },
  job: { job_id: "example", status: "processing", model: run.model, aspect_ratio: "3:4", image_size: "2K", quality: "medium", completed_poses: 4, total_poses: 6, estimated_cost_usd: 1.02 },
});

export function NodeWorkflowExample() {
  return (
    <div className="h-screen bg-[#f5f6f8] p-3">
      <CatalogPoseFlow className="h-full" references={references} poses={poses} summary={summary} storageKey="flow-example" onBack={() => window.history.back()} onDownload={() => undefined} onRegenerate={() => undefined} />
    </div>
  );
}
