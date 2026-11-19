import { CatalogPoseFlow, type FlowPose, type FlowReference } from "./CatalogPoseFlow";

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
];

const prompt = "Navy kurti, gold butti across the chest and hem. Keep the uploaded front, back, and fabric exactly. The style photo is the room only: warm wall, wood floor, soft window light. Do not copy any clothing from the style photo. Pose is a calm standing hero, two arms, two hands, full garment visible.";

const poses: FlowPose[] = [
  { poseIndex: 1, title: "Pose 1 · Hero", prompt, imageUrl: frame("Pose 1", true), referenceRoles: ["front"] },
  { poseIndex: 3, title: "Pose 3 · Back", prompt: `${prompt} Turn to show the true back. The rear product reference is the only authority for the back.`, imageUrl: frame("Pose 3", true), referenceRoles: ["front", "back"] },
  { poseIndex: 5, title: "Pose 5 · Detail", prompt: `${prompt} Crop to the gold butti on the chest. Do not switch the hero detail to a dupatta.`, imageUrl: frame("Pose 5", true), referenceRoles: ["front", "fabric"] },
];

export function NodeWorkflowExample() {
  return (
    <div className="h-screen bg-[#f5f6f8] p-3">
      <CatalogPoseFlow references={references} poses={poses} />
    </div>
  );
}
