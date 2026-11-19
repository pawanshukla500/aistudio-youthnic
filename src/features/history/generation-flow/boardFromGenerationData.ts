import type { FlowPose, FlowReference } from "./CatalogPoseFlow";

type Loose = Record<string, any>;

function imageFrom(record: Loose | null | undefined) {
  if (!record) return "";
  const outputs = record.outputs || {};
  const inputs = record.inputs || {};
  return String(outputs.outputUrls?.[0] || outputs.url || outputs.output_url || inputs.imageUrl || inputs.url || "");
}

export function boardFromGenerationData(data: Loose | null | undefined): { references: FlowReference[]; poses: FlowPose[] } {
  if (!data) return { references: [], poses: [] };
  if (data.trace) {
    const poses: FlowPose[] = (data.trace.poses || []).map((pose: Loose) => ({
      poseIndex: Number(pose.pose_index),
      title: String(pose.title || `Pose ${pose.pose_index}`),
      prompt: String(pose.full_prompt || "").trim(),
      imageUrl: String(pose.final_output_url || pose.attempts?.find((attempt: Loose) => attempt.output_url)?.output_url || ""),
      referenceRoles: (pose.referenceManifest?.references || []).map((reference: Loose) => String(reference.role || "")),
    }));
    return { references: [], poses };
  }

  const nodes: Loose[] = Array.isArray(data.nodes) ? data.nodes : [];
  const references: FlowReference[] = [];
  const prompts = new Map<number, string>();
  const images = new Map<number, string>();
  const titles = new Map<number, string>();
  nodes.forEach((node, index) => {
    const type = String(node.node_type || "");
    const inputs = node.inputs || {};
    const poseIndex = Number(inputs.poseIndex || inputs.pose_index || index + 1);
    if (type === "pose_reference" || type === "reference") {
      const imageUrl = imageFrom(node);
      if (!imageUrl) return;
      const role = String(inputs.role || "reference");
      references.push({
        id: String(node.id || role),
        role,
        label: role.replaceAll("_", " "),
        imageUrl,
        roomOnly: role.toLowerCase().includes("style"),
      });
      return;
    }
    if (type === "prompt_compilation" || type === "prompt") {
      prompts.set(poseIndex, String(inputs.prompt || node.outputs?.prompt || prompts.get(poseIndex) || ""));
      if (inputs.title) titles.set(poseIndex, String(inputs.title));
    }
    if (type === "final_image" || type === "gpt_image_2") {
      const imageUrl = imageFrom(node);
      if (imageUrl) images.set(poseIndex, imageUrl);
      if (inputs.title) titles.set(poseIndex, String(inputs.title));
    }
  });
  const poseIndexes = [...new Set([...prompts.keys(), ...images.keys()])].sort((a, b) => a - b);
  const poses: FlowPose[] = poseIndexes.map((poseIndex) => ({
    poseIndex,
    title: titles.get(poseIndex) || `Pose ${poseIndex}`,
    prompt: String(prompts.get(poseIndex) || "").trim(),
    imageUrl: images.get(poseIndex) || "",
    referenceRoles: [],
  }));
  return { references, poses };
}
