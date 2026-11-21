import { scopePoseRowsToJob } from "../../../lib/generationRuns.ts";
import type { FlowPose, FlowReference } from "./flowLinks.ts";

const REGENERATE_WINDOW_MS = 86_400_000;

type Loose = Record<string, any>;

function imageFrom(record: Loose | null | undefined) {
  if (!record) return "";
  const outputs = record.outputs || {};
  const inputs = record.inputs || {};
  return String(
    outputs.outputUrls?.[0] ||
    outputs.url ||
    outputs.output_url ||
    outputs.downloadUrl ||
    inputs.imageUrl ||
    inputs.url ||
    inputs.downloadUrl ||
    "",
  );
}

function referenceFrom(entry: Loose, fallbackId: string): FlowReference | null {
  const imageUrl = String(
    entry.downloadUrl ||
    entry.download_url ||
    entry.url ||
    entry.imageUrl ||
    entry.image_url ||
    "",
  ).trim();
  if (!imageUrl) return null;
  const role = String(entry.role || entry.asset_role || "reference");
  const fileName = String(entry.filename || entry.fileName || entry.storagePath?.split("/").pop() || "").trim();
  return {
    id: String(entry.id || fallbackId),
    role,
    label: role.replaceAll("_", " "),
    imageUrl,
    ...(fileName ? { fileName } : {}),
    roomOnly: role.toLowerCase().includes("style"),
  };
}

export function boardFromGenerationData(data: Loose | null | undefined): { references: FlowReference[]; poses: FlowPose[] } {
  if (!data) return { references: [], poses: [] };
  if (data.trace) {
    const summary: Loose = data.trace.summary || {};
    const posePlan: Loose[] = Array.isArray(data.trace.session?.posePlan) ? data.trace.session.posePlan : [];
    const settingsText = [summary.aspect_ratio, summary.image_size, summary.quality].filter(Boolean).join(" · ");
    const jobBusy = ["queued", "processing", "cancelling"].includes(String(summary.status || ""));
    const jobId = String(summary.job_id || "");
    const rawTracePoses: Loose[] = Array.isArray(data.trace.poses) ? data.trace.poses : [];
    const scopedTracePoses = jobId ? scopePoseRowsToJob(rawTracePoses, jobId) : rawTracePoses;
    const poses: FlowPose[] = scopedTracePoses.map((pose: Loose) => {
      const manifestRefs: Loose[] = Array.isArray(pose.referenceManifest?.references) ? pose.referenceManifest.references : [];
      const attempts: Loose[] = Array.isArray(pose.attempts) ? pose.attempts : [];
      const planned = posePlan[Number(pose.pose_index || 1) - 1] || posePlan.find((item) => item?.id === pose.pose_type);
      const finalOutputUrl = String(pose.final_output_url || pose.output_url || "").trim();
      const latestAttemptUrl = String([...attempts].reverse().find((attempt: Loose) => attempt.output_url)?.output_url || "");
      const imageUrl = String(finalOutputUrl || latestAttemptUrl);
      const poseStatus = String(pose.status || "");
      const completedStamp = pose.updated_at || pose.completed_at || summary.completed_at;
      const completedMs = completedStamp ? Date.parse(String(completedStamp)) : NaN;
      const withinRegenerateWindow = Number.isFinite(completedMs) && Date.now() - completedMs < REGENERATE_WINDOW_MS;
      const poseEligibleStatus = poseStatus === "failed" || (poseStatus === "completed" && Boolean(finalOutputUrl));
      return {
        poseIndex: Number(pose.pose_index),
        title: String(pose.title || planned?.title || `Pose ${pose.pose_index}`),
        prompt: String(pose.full_prompt || planned?.prompt || "").trim(),
        imageUrl,
        referenceRoles: manifestRefs.map((reference: Loose) => String(reference.role || "")),
        sent: manifestRefs.map((reference: Loose) => ({
          role: String(reference.role || ""),
          ...(reference.filename ? { fileName: String(reference.filename) } : {}),
        })),
        model: String(attempts.at(-1)?.model || summary.model || ""),
        status: poseStatus,
        error: String(pose.error || ""),
        settings: settingsText,
        versionCount: attempts.length || (imageUrl ? 1 : 0),
        versions: attempts.slice().reverse().slice(0, 4).map((attempt: Loose, index: number) => ({
          version: Number(attempt.attempt_index || attempts.length - index || 1),
          status: String(attempt.qa?.outcome || (attempt.rejected ? "rejected_by_qa" : pose.status) || ""),
          imageUrl: String(attempt.output_url || ""),
        })),
        canRegenerate: Boolean(pose.generation_id && !jobBusy && poseEligibleStatus && withinRegenerateWindow),
      };
    });
    const sessionRows: Loose[] = Array.isArray(data.trace.session?.references) ? data.trace.session.references : [];
    // The stored plan (session_data.posePlanning) decides adoption; Pose 4 = creative, Pose 6 = showcase.
    const slots: Loose = data.trace.session?.posePlanning?.slots || {};
    const postureFor = [slots.creative?.source === "reference" ? 4 : 0, slots.showcase?.source === "reference" ? 6 : 0].filter(Boolean);
    const sessionReferences = sessionRows
      .map((entry, index) => referenceFrom(entry, `trace-${index}`))
      .filter((entry): entry is FlowReference => Boolean(entry))
      .map((reference) => (reference.roomOnly && postureFor.length ? { ...reference, postureFor } : reference));
    return { references: sessionReferences, poses };
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
      if (imageUrl) {
        const role = String(inputs.role || "reference");
        references.push({
          id: String(node.id || role),
          role,
          label: role.replaceAll("_", " "),
          imageUrl,
          roomOnly: role.toLowerCase().includes("style"),
        });
      }
      return;
    }
    // V2 reference nodes only record that references were loaded; the uploads
    // themselves live on the analysis node's inputs.
    if (type === "ai_visual_analysis" || type === "analysis") {
      (Array.isArray(inputs.references) ? inputs.references : []).forEach((entry: Loose, refIndex: number) => {
        const reference = referenceFrom(entry, `${node.id || "analysis"}-${refIndex}`);
        if (reference) references.push(reference);
      });
      return;
    }
    if (type === "prompt_compilation" || type === "prompt") {
      prompts.set(poseIndex, String(inputs.prompt || node.outputs?.compiledPrompt || node.outputs?.prompt || prompts.get(poseIndex) || ""));
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
