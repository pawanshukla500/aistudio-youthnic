import assert from "node:assert/strict";
import test from "node:test";
import { boardFromGenerationData } from "./boardFromGenerationData.ts";
import { namesMatch, neighborIds, photosForPose, poseIsWorking, promptExcerpt } from "./flowLinks.ts";

const photos = [
  { id: "front", role: "front", fileName: "BT217-Nandlal-Navy-5-.jpg" },
  { id: "bottom", role: "bottom", fileName: "BT217-Nandlal-Navy-4-.jpg" },
  { id: "back", role: "back", fileName: "BT217-Nandlal-Navy-1-.jpg" },
  { id: "fabric", role: "fabric_pattern", fileName: "BT217-Nandlal-Navy-7-.jpg" },
  { id: "mannequin", role: "mannequin", fileName: "BT217-Nandlal-Navy-4-1-.jpg" },
  { id: "extra", role: "additional_product", fileName: "BT217-Nandlal-Navy-6-.jpg" },
  { id: "face", role: "model_identity", fileName: "face.jpeg" },
  { id: "room", role: "style_reference", fileName: "room.jpeg" },
];

test("a standing pose keeps the back, fabric, and extra product photos that were sent", () => {
  const linked = photosForPose(photos, {
    poseIndex: 1,
    title: "Front hero",
    sent: ["front", "bottom", "back", "mannequin", "style_reference", "fabric_pattern", "additional_product"].map((role) => ({ role })),
  }).map((photo) => photo.id);
  assert.deepEqual(linked, ["front", "bottom", "back", "fabric", "mannequin", "extra", "face", "room"]);
});

test("a rear pose does not take front, fabric, or extra product photos", () => {
  const linked = photosForPose(photos, {
    poseIndex: 3,
    title: "True rear",
    sent: ["back", "bottom", "style_reference"].map((role) => ({ role })),
  }).map((photo) => photo.id);
  assert.deepEqual(linked, ["bottom", "back", "face", "room"]);
});

test("twelve detail photos connect only the file that was sent", () => {
  const details = Array.from({ length: 12 }, (_, index) => ({
    id: `detail-${index + 1}`,
    role: "additional_product",
    fileName: `detail-${index + 1}.jpg`,
  }));
  const linked = photosForPose([...details, { id: "face", role: "model_identity" }], {
    poseIndex: 5,
    title: "Embroidery macro",
    sent: [{ role: "additional_product", fileName: "detail-7.jpg" }],
  }).map((photo) => photo.id);
  assert.deepEqual(linked, ["detail-7", "face"]);
});

test("four product photos all feed a pose when no send-list was stored", () => {
  const four = photos.slice(0, 4);
  const linked = photosForPose(four, { poseIndex: 1, title: "Hero" }).map((photo) => photo.id);
  assert.deepEqual(linked, ["front", "bottom", "back", "fabric"]);
});

test("selecting one pose lights its photos and output, and a shared face does not pull in the other pose", () => {
  const edges = [
    { source: "ref-front", target: "prompt-1" },
    { source: "ref-face", target: "prompt-1" },
    { source: "prompt-1", target: "image-1" },
    { source: "ref-face", target: "prompt-3" },
    { source: "ref-back", target: "prompt-3" },
    { source: "prompt-3", target: "image-3" },
  ];
  assert.deepEqual([...neighborIds("prompt-1", edges)].sort(), ["image-1", "ref-face", "ref-front"]);
  assert.deepEqual([...neighborIds("image-1", edges)].sort(), ["prompt-1", "ref-face", "ref-front"]);
  assert.deepEqual([...neighborIds("ref-face", edges)].sort(), ["image-1", "image-3", "prompt-1", "prompt-3"]);
  assert.equal(neighborIds("", edges).size, 0);
});

test("a finished pose is not shown as still generating", () => {
  assert.equal(poseIsWorking("Generated · review pending"), false);
  assert.equal(poseIsWorking("queued"), true);
  assert.equal(poseIsWorking("running"), true);
  assert.equal(poseIsWorking(""), false);
});

test("a prompt card keeps the pose line and leaves the long lock text closed", () => {
  const prompt = `Create ONE photograph.\n\nSHARED LOCK ${"x".repeat(400)}\nPlace the garment and create Pose 1: Front hero - straight stance. Then more lock text.`;
  assert.equal(promptExcerpt(prompt, 1), "Pose 1: Front hero - straight stance");
  assert.equal(promptExcerpt("", 1), "");
  assert.equal(promptExcerpt("Only a short brief.", 2), "Only a short brief.");
});

test("numbered sibling files do not cross-match", () => {
  assert.equal(namesMatch("1.jpg", "1.jpg"), true);
  assert.equal(namesMatch("1.jpg", "11.jpg"), false);
  assert.equal(namesMatch("detail-1.jpg", "detail-11.jpg"), false);
});

test("stored file names still match the upload name", () => {
  assert.equal(namesMatch("a65ad731-988e-4912-a41d-5ab1992cb36f-BT217-Nandlal-Navy-5-.jpg", "BT217-Nandlal-Navy (5).jpg"), true);
});

test("boardFromGenerationData preserves downloadUrl references, manifest links, versions, and queued prompts", () => {
  const board = boardFromGenerationData({
    trace: {
      summary: {
        job_id: "job_1",
        status: "completed",
        model: "gpt-image-2.6-sunburst",
        aspect_ratio: "3:4",
        image_size: "2K",
        quality: "medium",
      },
      session: {
        references: [
          { id: "ref_f", role: "front", downloadUrl: "https://cdn.example.com/front.jpg", filename: "front.jpg" },
          { id: "ref_s", role: "style_reference", downloadUrl: "https://cdn.example.com/room.jpg", filename: "room.jpg" },
        ],
        posePlan: [
          { id: "full_front", title: "Full Front", prompt: "Planned full front prompt" },
        ],
      },
      poses: [
        {
          generation_id: "job_1:pose:1",
          pose_index: 1,
          title: "Full Front",
          status: "completed",
          full_prompt: "",
          final_output_url: "https://cdn.example.com/out-1.jpg",
          attempts: [
            { attempt_index: 1, model: "gpt-image-2.6-sunburst", output_url: "https://cdn.example.com/rej-1.jpg", rejected: true, qa: { outcome: "rejected_by_qa" } },
            { attempt_index: 2, model: "gpt-image-2.6-sunburst", output_url: "https://cdn.example.com/out-1.jpg", rejected: false, qa: { outcome: "automatically_verified" } },
          ],
          referenceManifest: {
            references: [
              { role: "front", filename: "front.jpg" },
              { role: "style_reference", filename: "room.jpg" },
            ],
          },
        },
      ],
    },
  });
  assert.equal(board.references.length, 2);
  assert.equal(board.references[0].imageUrl, "https://cdn.example.com/front.jpg");
  assert.equal(board.references[1].roomOnly, true);
  assert.equal(board.poses[0].prompt, "Planned full front prompt");
  assert.equal(board.poses[0].canRegenerate, true);
  assert.equal(board.poses[0].versions?.length, 2);
  assert.equal(board.poses[0].sent?.[0].fileName, "front.jpg");
  assert.equal(board.poses[0].settings, "3:4 · 2K · medium");
});
