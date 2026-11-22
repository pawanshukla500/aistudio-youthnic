import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileText,
  Gem,
  Image as ImageIcon,
  Link2,
  Loader2,
  Maximize,
  Maximize2,
  MoreHorizontal,
  Sparkles,
  Type,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import "./catalogPoseFlow.css";
import { formatModelName } from "../../../lib/modelLabels";
import { canonicalRole, neighborIds, photosForPose, poseIsWorking, promptExcerpt, referenceLane, versionStatusLabel, type FlowPose, type FlowReference } from "./flowLinks";
import { settingsLine, type FlowSummary } from "./flowSummary";

export type { FlowPose, FlowReference };

type LaneTone = "input" | "analysis" | "prompting" | "output";

type BoardData = {
  kind: "lane" | "input" | "analysis" | "prompt" | "output";
  title: string;
  caption?: string;
  imageUrl?: string;
  fileName?: string;
  lane?: "product" | "face" | "room";
  tone?: LaneTone;
  count?: number;
  empty?: string;
  delay?: number;
  poseIndex?: number;
  prompt?: string;
  excerpt?: string;
  sentLabels?: string[];
  model?: string;
  status?: string;
  error?: string;
  settings?: string;
  aspectRatio?: string;
  imageSize?: string;
  quality?: string;
  qaLabel?: string;
  qaTone?: "good" | "warn" | "bad";
  versionCount?: number;
  canRegenerate?: boolean;
  thumbs?: Array<{ url: string; label: string }>;
  versions?: Array<{ version: number; at?: string; status?: string; imageUrl?: string }>;
  analysis?: FlowSummary["analysis"];
};

type BoardActions = {
  onPreview: (url: string, title: string) => void;
  onPrompt: (poseIndex: number, title: string) => void;
  onDownload?: (poseIndex: number) => void;
  onRegenerate?: (poseIndex: number, note: string) => void;
  onCopy: (url: string) => void;
  busyPose?: number;
  noteFor: (poseIndex: number) => string;
  saveNote: (poseIndex: number, note: string) => void;
  promptFor: (poseIndex: number) => string;
};

const ActionsContext = createContext<BoardActions>({
  onPreview: () => undefined,
  onPrompt: () => undefined,
  onCopy: () => undefined,
  noteFor: () => "",
  saveNote: () => undefined,
  promptFor: () => "",
});

const LinkedContext = createContext<ReadonlySet<string>>(new Set());

const LANE_TONES: Record<LaneTone, { bg: string; border: string; dot: string }> = {
  input: { bg: "rgba(237, 233, 254, 0.42)", border: "#ddd6fe", dot: "#8b5cf6" },
  analysis: { bg: "rgba(252, 231, 243, 0.42)", border: "#fbcfe8", dot: "#ec4899" },
  prompting: { bg: "rgba(204, 251, 241, 0.38)", border: "#99f6e4", dot: "#14b8a6" },
  output: { bg: "rgba(254, 243, 199, 0.4)", border: "#fde68a", dot: "#f59e0b" },
};

const PRODUCT_STROKE = "#93c5fd";
const FACE_STROKE = "#fcd34d";
const ROOM_STROKE = "#6ee7b7";
const ANALYSIS_STROKE = "#c4b5fd";
const PROMPT_STROKE = "#f9a8d4";
const TEXT_STROKE = "#5eead4";
const HOT_STROKE = "#2563eb";

function referenceStroke(role: string) {
  const lane = referenceLane(role);
  if (lane === "face") return FACE_STROKE;
  if (lane === "room") return ROOM_STROKE;
  return PRODUCT_STROKE;
}

const PAD = 22;
const LANE_TITLE = 44;
const GAP = 20;
const LANE_GAP = 120;
const LABEL = 24;
const INPUT = { width: 156, height: 272 };
const ANALYSIS = { width: 304, height: 600 };
const PROMPT = { width: 304, height: 188 };
const OUTPUT = { width: 280, height: 572 };
const OUTPUT_GAP = 44;
const OUTPUT_IMAGE = Math.round((OUTPUT.width * 4) / 3);
const FIT = { padding: 0.06, maxZoom: 0.9 };
/** Below this the cards are unreadable; a board that only fits smaller opens at its top-left (the inputs) instead. */
const READABLE_ZOOM = 0.42;
const LAYOUT_VERSION = "v2";

function allowedConnection(source?: string | null, target?: string | null) {
  if (!source || !target) return false;
  if (source.startsWith("ref-") && target.startsWith("image-")) return true;
  const prompt = source.match(/^prompt-(\d+)$/);
  return Boolean(prompt && target === `image-${prompt[1]}`);
}

function referenceCaption(reference: FlowReference) {
  const lane = referenceLane(reference.role);
  if (lane === "face") return "Model face";
  if (lane === "room") return reference.postureFor?.length ? `Room + Pose ${reference.postureFor.join(" & ")} posture, no outfit` : "Room only, no outfit";
  return "Product";
}

function shortRole(role: string) {
  const canonical = canonicalRole(role);
  if (canonical === "model_identity") return "model face";
  if (canonical === "style_reference") return "style";
  return canonical.replaceAll("_", " ");
}

function titleCase(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

type SavedLayout = {
  positions: Record<string, { x: number; y: number }>;
  removed: string[];
  added: Array<{ source: string; target: string }>;
  viewport?: { x: number; y: number; zoom: number };
  notes?: Record<string, string>;
};

function emptyLayout(): SavedLayout {
  return { positions: {}, removed: [], added: [] };
}

function layoutKey(storageKey: string) {
  return `youthnic-flow-layout:${LAYOUT_VERSION}:${storageKey}`;
}

function parseLayout(raw: string | null): SavedLayout {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (parsed?.positions && typeof parsed.positions === "object") {
      return {
        positions: parsed.positions,
        removed: Array.isArray(parsed.removed) ? parsed.removed : [],
        added: Array.isArray(parsed.added) ? parsed.added : [],
        viewport: finiteViewport(parsed.viewport),
        notes: parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {},
      };
    }
    return emptyLayout();
  } catch {
    return emptyLayout();
  }
}

function readLayout(storageKey?: string): SavedLayout {
  if (!storageKey) return emptyLayout();
  try {
    return parseLayout(localStorage.getItem(layoutKey(storageKey)));
  } catch {
    return emptyLayout();
  }
}

/** Notes typed on the board before the grouped layout (stored under the unversioned key). */
function legacyNote(storageKey: string | undefined, poseIndex: number) {
  if (!storageKey) return "";
  try {
    return String(parseLayout(localStorage.getItem(`youthnic-flow-layout:${storageKey}`)).notes?.[String(poseIndex)] || "");
  } catch {
    return "";
  }
}

function finiteViewport(value: unknown): SavedLayout["viewport"] {
  if (!value || typeof value !== "object") return undefined;
  const viewport = value as { x?: unknown; y?: unknown; zoom?: unknown };
  const x = Number(viewport.x);
  const y = Number(viewport.y);
  const zoom = Number(viewport.zoom);
  if (![x, y, zoom].every(Number.isFinite) || zoom <= 0) return undefined;
  return { x, y, zoom };
}

function writeLayout(storageKey: string, layout: SavedLayout) {
  try {
    localStorage.setItem(layoutKey(storageKey), JSON.stringify(layout));
  } catch {
    // Private windows and full storage: the board still works, it just forgets the arrangement.
  }
}

function edge(id: string, source: string, target: string, stroke: string, targetHandle = "in"): Edge {
  return {
    id,
    source,
    target,
    sourceHandle: "out",
    targetHandle,
    type: "default",
    data: { stroke },
    style: { stroke, strokeWidth: 1.5 },
  };
}

function applyEdges(edges: Edge[], saved: SavedLayout) {
  const removed = new Set(saved.removed);
  const kept = edges.filter((item) => !removed.has(item.id));
  const seen = new Set(kept.map((item) => `${item.source}>${item.target}`));
  for (const extra of saved.added) {
    const key = `${extra.source}>${extra.target}`;
    if (seen.has(key) || !allowedConnection(extra.source, extra.target)) continue;
    seen.add(key);
    kept.push(edge(`custom-${extra.source}-${extra.target}`, extra.source, extra.target, PRODUCT_STROKE, extra.source.startsWith("ref-") ? "image" : "text"));
  }
  return kept;
}

function lane(id: string, tone: LaneTone, title: string, x: number, size: { width: number; height: number }, count: number, empty?: string): Node<BoardData> {
  return {
    id,
    type: "cpf-lane",
    position: { x, y: 0 },
    width: size.width,
    height: size.height,
    measured: size,
    style: { ...size, pointerEvents: "none" },
    selectable: false,
    focusable: false,
    dragHandle: ".cpf-lane-handle",
    data: { kind: "lane", tone, title, count, ...(empty ? { empty } : {}) },
  };
}

// React Flow styles its built-in node types (input, output, default, group) by wrapper class, so ours are prefixed.
function child(id: string, kind: BoardData["kind"], parentId: string, x: number, y: number, size: { width: number; height: number }, data: BoardData): Node<BoardData> {
  return { id, type: `cpf-${kind}`, parentId, position: { x, y }, width: size.width, height: size.height, measured: size, style: size, data };
}

function buildBoard(references: FlowReference[], poses: FlowPose[], summary?: FlowSummary | null) {
  const nodes: Node<BoardData>[] = [];
  const edges: Edge[] = [];
  const analysis = summary?.analysis || null;
  const inputCols = references.length > 4 ? 2 : 1;
  const inputRows = Math.max(1, Math.ceil(references.length / inputCols));
  const outCols = Math.min(3, Math.max(1, poses.length));
  const outRows = Math.max(1, Math.ceil(poses.length / outCols));
  const inputLane = {
    width: PAD * 2 + inputCols * INPUT.width + (inputCols - 1) * GAP,
    height: LANE_TITLE + PAD + (references.length ? inputRows * INPUT.height + (inputRows - 1) * GAP : 120),
  };
  const analysisLane = { width: PAD * 2 + ANALYSIS.width, height: LANE_TITLE + PAD + ANALYSIS.height };
  const promptLane = { width: PAD * 2 + PROMPT.width, height: LANE_TITLE + PAD + Math.max(1, poses.length) * PROMPT.height + Math.max(0, poses.length - 1) * 16 };
  const outputLane = {
    width: PAD * 2 + outCols * OUTPUT.width + (outCols - 1) * OUTPUT_GAP,
    height: LANE_TITLE + PAD + outRows * OUTPUT.height + (outRows - 1) * GAP,
  };
  let x = 0;
  nodes.push(lane("lane-input", "input", "Input", x, inputLane, references.length, references.length ? undefined : "No input photos were recorded for this shoot."));
  x += inputLane.width + LANE_GAP;
  if (analysis) {
    nodes.push(lane("lane-analysis", "analysis", "Product analysis", x, analysisLane, 1));
    x += analysisLane.width + LANE_GAP;
  }
  nodes.push(lane("lane-prompting", "prompting", "Prompting", x, promptLane, poses.length));
  x += promptLane.width + LANE_GAP;
  nodes.push(lane("lane-output", "output", "Output images", x, outputLane, poses.length));

  references.forEach((reference, index) => {
    const col = index % inputCols;
    const row = Math.floor(index / inputCols);
    nodes.push(child(`ref-${reference.id}`, "input", "lane-input", PAD + col * (INPUT.width + GAP), LANE_TITLE + row * (INPUT.height + GAP), INPUT, {
      kind: "input",
      lane: referenceLane(reference.role),
      title: titleCase(reference.label),
      caption: referenceCaption(reference),
      imageUrl: reference.imageUrl,
      ...(reference.fileName ? { fileName: reference.fileName } : {}),
      delay: index * 40,
    }));
    if (analysis) edges.push(edge(`ref-${reference.id}-analysis`, `ref-${reference.id}`, "analysis", ANALYSIS_STROKE));
  });
  if (analysis) {
    nodes.push(child("analysis", "analysis", "lane-analysis", PAD, LANE_TITLE, ANALYSIS, { kind: "analysis", title: "Product analysis", analysis, delay: 120 }));
  }

  poses.forEach((pose, index) => {
    const promptId = `prompt-${pose.poseIndex}`;
    const imageId = `image-${pose.poseIndex}`;
    const sent = pose.sent?.length ? pose.sent : pose.referenceRoles.map((role) => ({ role }));
    const feeding = photosForPose(references, { poseIndex: pose.poseIndex, title: pose.title, sent });
    nodes.push(child(promptId, "prompt", "lane-prompting", PAD, LANE_TITLE + index * (PROMPT.height + 16), PROMPT, {
      kind: "prompt",
      title: pose.title || `Pose ${pose.poseIndex}`,
      prompt: pose.prompt,
      excerpt: promptExcerpt(pose.prompt, pose.poseIndex),
      poseIndex: pose.poseIndex,
      sentLabels: [...new Set(feeding.map((reference) => shortRole(reference.role)))],
      delay: 160 + index * 40,
    }));
    const col = index % outCols;
    const row = Math.floor(index / outCols);
    nodes.push(child(imageId, "output", "lane-output", PAD + col * (OUTPUT.width + OUTPUT_GAP), LANE_TITLE + row * (OUTPUT.height + GAP), OUTPUT, {
      kind: "output",
      title: pose.title || `Pose ${pose.poseIndex}`,
      caption: pose.imageUrl ? "Generated pose" : "Not generated yet",
      imageUrl: pose.imageUrl,
      poseIndex: pose.poseIndex,
      model: pose.model,
      status: pose.status,
      error: pose.error,
      settings: pose.settings,
      aspectRatio: pose.aspectRatio,
      imageSize: pose.imageSize,
      quality: pose.quality,
      qaLabel: pose.qaLabel,
      qaTone: pose.qaTone,
      versionCount: pose.versionCount,
      canRegenerate: pose.canRegenerate,
      versions: pose.versions,
      thumbs: feeding.filter((reference) => reference.imageUrl).map((reference) => ({ url: reference.imageUrl, label: reference.label })),
      delay: 220 + index * 50,
    }));
    if (analysis) edges.push(edge(`analysis-${promptId}`, "analysis", promptId, PROMPT_STROKE));
    edges.push(edge(`${promptId}-${imageId}`, promptId, imageId, TEXT_STROKE, "text"));
    for (const reference of feeding) {
      edges.push(edge(`ref-${reference.id}-${imageId}`, `ref-${reference.id}`, imageId, referenceStroke(reference.role), "image"));
    }
  });
  return { nodes, edges };
}

function IconHandle({ id, type, position, top, text = false }: { id: string; type: "source" | "target"; position: Position; top: number; text?: boolean }) {
  const Icon = text ? Type : ImageIcon;
  return (
    <Handle id={id} type={type} position={position} className={`cpf-handle${text ? " cpf-handle-text" : ""}`} style={{ top }}>
      <Icon className="pointer-events-none h-3 w-3" strokeWidth={2.4} />
    </Handle>
  );
}

function NodeLabel({ icon: Icon, title, meta }: { icon: ComponentType<{ className?: string }>; title: string; meta?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1" style={{ height: LABEL }}>
      <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-[#4b5563]">
        <Icon className="h-3.5 w-3.5 shrink-0 text-[#6b7280]" />
        <span className="truncate">{title}</span>
      </span>
      {meta && <span className="shrink-0 truncate text-[11px] text-[#9aa0ab]" style={{ maxWidth: "52%" }}>{meta}</span>}
    </div>
  );
}

function FadeImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="grid h-full w-full place-items-center px-3 text-center text-[11px] text-[#9aa0ab]">Image link expired. Refresh the page.</span>;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      draggable={false}
      onLoad={(event) => { event.currentTarget.dataset.loaded = "true"; }}
      onError={() => setFailed(true)}
      className={`cpf-img pointer-events-none h-full w-full object-cover ${className || ""}`}
    />
  );
}

function useLinked(id: string) {
  return useContext(LinkedContext).has(id) ? "true" : "false";
}

function LaneNode({ data }: NodeProps<Node<BoardData>>) {
  const tone = LANE_TONES[data.tone || "input"];
  return (
    <div className="relative h-full w-full rounded-[24px] border" style={{ background: tone.bg, borderColor: tone.border }}>
      <div className="cpf-lane-handle absolute left-3 top-2.5 flex items-center gap-2 rounded-full px-2 py-1 text-[13px] font-semibold text-[#1f2430]" style={{ pointerEvents: "auto" }} title="Drag to move this group">
        <span className="h-2 w-2 rounded-full" style={{ background: tone.dot }} />
        {data.title}
        <span className="rounded-full bg-white/80 px-1.5 text-[10.5px] font-semibold text-[#6b7280]">{data.count}</span>
      </div>
      {data.empty && <p className="absolute inset-x-6 top-16 text-[12px] leading-5 text-[#6b7280]">{data.empty}</p>}
    </div>
  );
}

function InputNode({ id, data }: NodeProps<Node<BoardData>>) {
  const actions = useContext(ActionsContext);
  const imageHeight = Math.round((INPUT.width * 4) / 3);
  return (
    <div className="cpf-node h-full w-full" style={{ animationDelay: `${data.delay || 0}ms` }}>
      <NodeLabel icon={ImageIcon} title={data.title} meta={data.lane === "face" ? "Identity" : data.lane === "room" ? "Style" : "Upload"} />
      <div className="cpf-card overflow-hidden" data-linked={useLinked(id)}>
        <button type="button" className="nodrag block w-full overflow-hidden bg-[#f3f1ee]" style={{ height: imageHeight }} onClick={() => data.imageUrl && actions.onPreview(data.imageUrl, data.title)} aria-label={`Open ${data.title}`}>
          {data.imageUrl ? <FadeImage key={data.imageUrl} src={data.imageUrl} alt={data.title} /> : <span className="grid h-full place-items-center text-[11px] text-[#9aa0ab]">No image</span>}
        </button>
        <div className="px-2.5 py-2">
          <p className="truncate text-[11px] font-medium text-[#374151]">{data.caption}</p>
          {data.fileName && <p className="truncate text-[10px] text-[#9aa0ab]" title={data.fileName}>{data.fileName}</p>}
        </div>
      </div>
      <IconHandle id="out" type="source" position={Position.Right} top={LABEL + imageHeight / 2} />
    </div>
  );
}

function AnalysisNode({ id, data }: NodeProps<Node<BoardData>>) {
  const analysis = data.analysis;
  return (
    <div className="cpf-node h-full w-full" style={{ animationDelay: `${data.delay || 0}ms` }}>
      <NodeLabel icon={Sparkles} title="Product analysis" meta={analysis?.modelLabel} />
      <div className="cpf-card cpf-scroll nowheel flex flex-col gap-3 overflow-y-auto p-3.5" style={{ height: ANALYSIS.height - LABEL }} data-linked={useLinked(id)}>
        <div className="rounded-xl bg-[#faf5ff] p-2.5">
          <p className="text-[12.5px] font-semibold text-[#1f2430]">{analysis?.modelLabel || "Model not recorded"}</p>
          <p className="mt-0.5 text-[10.5px] text-[#6b7280]">
            {[analysis?.provider ? titleCase(analysis.provider) : "", analysis?.thinking ? `${analysis.thinking} thinking` : ""].filter(Boolean).join(" · ") || "Vision analysis"}
          </p>
          {!!analysis?.fallbacks.length && <p className="mt-1 text-[10.5px] leading-4 text-[#9aa0ab]">Fallbacks: {analysis.fallbacks.join(" → ")}</p>}
        </div>
        {!!analysis?.facts.length && (
          <section>
            <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#9aa0ab]">Product truth</h4>
            <dl className="mt-1.5 space-y-1.5">
              {analysis.facts.map((fact) => (
                <div key={fact.label} className="grid grid-cols-[78px_1fr] gap-2 text-[11.5px] leading-[16px]">
                  <dt className="text-[#6b7280]">{fact.label}</dt>
                  <dd className="line-clamp-2 text-[#1f2430]" title={fact.value}>{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {!!analysis?.plan.length && (
          <section>
            <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#9aa0ab]">Pose plan</h4>
            <ol className="mt-1.5 space-y-1">
              {analysis.plan.map((step) => (
                <li key={step.poseIndex} className="flex items-start gap-2 text-[11.5px] leading-[16px] text-[#1f2430]">
                  <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[#f3f4f6] text-[9.5px] font-semibold text-[#4b5563]">{step.poseIndex}</span>
                  <span className="min-w-0 flex-1">
                    {step.title}
                    {step.copiesReferencePosture && <span className="ml-1.5 rounded-full bg-[#ecfdf5] px-1.5 py-px text-[9.5px] font-semibold text-[#047857]">reference posture</span>}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {analysis?.version != null && <span className="rounded-full bg-[#f3f4f6] px-2 py-0.5 text-[10px] font-medium text-[#4b5563]">Analysis v{analysis.version}</span>}
          {analysis?.dnaVersion != null && <span className="rounded-full bg-[#fdf2f8] px-2 py-0.5 text-[10px] font-medium text-[#be185d]">Product DNA v{analysis.dnaVersion}</span>}
        </div>
      </div>
      <IconHandle id="in" type="target" position={Position.Left} top={LABEL + 40} />
      <IconHandle id="out" type="source" position={Position.Right} top={LABEL + 40} text />
    </div>
  );
}

function PromptNode({ id, data }: NodeProps<Node<BoardData>>) {
  const actions = useContext(ActionsContext);
  const prompt = data.prompt || (data.poseIndex ? actions.promptFor(data.poseIndex) : "");
  const labels = data.sentLabels || [];
  return (
    <div className="cpf-node h-full w-full" style={{ animationDelay: `${data.delay || 0}ms` }}>
      <NodeLabel icon={Type} title={`Prompt · Pose ${data.poseIndex}`} meta={prompt ? `${prompt.length.toLocaleString()} chars` : undefined} />
      <div className="cpf-card flex flex-col gap-2 p-3" style={{ height: PROMPT.height - LABEL }} data-linked={useLinked(id)}>
        <p className="line-clamp-2 text-[12.5px] font-semibold leading-[17px] text-[#1f2430]">{data.excerpt || data.title}</p>
        <pre className="cpf-scroll nodrag nowheel min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words font-[inherit] text-[11px] leading-[16px] text-[#6b7280]">{prompt || "This pose does not have a stored prompt yet."}</pre>
        <div className="flex items-center gap-1.5">
          <div className="flex min-w-0 flex-1 gap-1 overflow-hidden">
            {labels.slice(0, 3).map((label) => <span key={label} className="shrink-0 rounded-md bg-[#eff6ff] px-1.5 py-0.5 text-[10px] font-medium text-[#1d4ed8]">@{label}</span>)}
            {labels.length > 3 && <span className="shrink-0 rounded-md bg-[#f3f4f6] px-1.5 py-0.5 text-[10px] font-medium text-[#6b7280]">+{labels.length - 3}</span>}
          </div>
          {prompt && (
            <button type="button" className="nodrag inline-flex shrink-0 items-center gap-1 rounded-full border border-[#e6e8ee] bg-white px-2 py-0.5 text-[10.5px] font-semibold text-[#1f2430] transition hover:bg-[#f5f6f8]" onClick={() => data.poseIndex && actions.onPrompt(data.poseIndex, `Pose ${data.poseIndex} · ${data.title}`)}>
              <FileText className="h-3 w-3" /> Full prompt
            </button>
          )}
        </div>
      </div>
      <IconHandle id="in" type="target" position={Position.Left} top={LABEL + 26} text />
      <IconHandle id="out" type="source" position={Position.Right} top={LABEL + 26} text />
    </div>
  );
}

const TONE_CHIP: Record<"good" | "warn" | "bad", { dot: string; text: string }> = {
  good: { dot: "#10b981", text: "#065f46" },
  warn: { dot: "#f59e0b", text: "#92400e" },
  bad: { dot: "#ef4444", text: "#991b1b" },
};

function OutputNode({ id, data }: NodeProps<Node<BoardData>>) {
  const actions = useContext(ActionsContext);
  const [note, setNote] = useState(() => (data.poseIndex ? actions.noteFor(data.poseIndex) : ""));
  const [menu, setMenu] = useState<"versions" | "more" | null>(null);
  const working = poseIsWorking(data.status);
  const failed = /fail/i.test(data.status || "") && !data.imageUrl;
  const modelLabel = data.model ? formatModelName(data.model) : "Model not recorded";
  const quality = data.quality ? titleCase(data.quality) : "";
  const tone = data.qaTone ? TONE_CHIP[data.qaTone] : null;
  const busy = actions.busyPose !== undefined;
  const runTitle = !data.canRegenerate ? "Re-generation is closed for this shoot" : actions.busyPose !== undefined ? "Another pose is being queued" : !note.trim() ? "Type what to change first: each version is a paid generation" : "Queue a new version of this pose only";
  return (
    <div className="cpf-node relative h-full w-full" style={{ animationDelay: `${data.delay || 0}ms` }} onMouseLeave={() => setMenu(null)}>
      <NodeLabel icon={ImageIcon} title={`Pose ${data.poseIndex} – ${data.title}`} meta={modelLabel} />
      <div className="cpf-card" data-linked={useLinked(id)}>
        <div className="relative overflow-hidden rounded-t-[17px] bg-[#f3f1ee]" style={{ height: OUTPUT_IMAGE }}>
          {data.imageUrl ? (
            <button type="button" className="nodrag block h-full w-full" onClick={() => actions.onPreview(data.imageUrl || "", data.title)} aria-label={`Open Pose ${data.poseIndex} full size`}>
              <FadeImage key={data.imageUrl} src={data.imageUrl} alt={data.title} />
            </button>
          ) : (
            <div className={`grid h-full w-full place-items-center ${working ? "cpf-skeleton" : ""}`}>
              <span className="px-4 text-center text-[11.5px] text-[#9aa0ab]">{working ? "Generating this pose…" : failed ? "This pose failed" : "No image yet"}</span>
            </div>
          )}
          <div className="pointer-events-none absolute left-2.5 top-2.5 flex flex-wrap gap-1">
            {working && <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10.5px] font-semibold text-[#1d4ed8] shadow-sm backdrop-blur"><Loader2 className="h-3 w-3 animate-spin" /> {/queue/i.test(data.status || "") ? "Queued" : "Generating"}</span>}
            {failed && <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10.5px] font-semibold text-[#991b1b] shadow-sm backdrop-blur"><span className="h-1.5 w-1.5 rounded-full bg-[#ef4444]" /> Failed</span>}
            {!working && data.qaLabel && tone && <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10.5px] font-semibold shadow-sm backdrop-blur" style={{ color: tone.text }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.dot }} /> {data.qaLabel}</span>}
          </div>
          {data.imageUrl && (
            <button type="button" className="nodrag absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full bg-white/85 text-[#374151] shadow-sm backdrop-blur transition hover:bg-white" onClick={() => actions.onPreview(data.imageUrl || "", data.title)} aria-label="Expand image" title="Expand">
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
          {!!data.thumbs?.length && (
            <div className="absolute bottom-2.5 left-2.5 flex gap-1">
              {data.thumbs.slice(0, 4).map((thumb) => (
                <button key={`${thumb.label}:${thumb.url}`} type="button" title={thumb.label} onClick={() => actions.onPreview(thumb.url, thumb.label)} className="nodrag h-7 w-7 overflow-hidden rounded-md bg-white shadow-sm ring-2 ring-white transition hover:scale-105">
                  <img src={thumb.url} alt={thumb.label} draggable={false} loading="lazy" className="pointer-events-none h-full w-full object-cover" />
                </button>
              ))}
              {data.thumbs.length > 4 && <span className="grid h-7 min-w-7 place-items-center rounded-md bg-white/90 px-1 text-[10px] font-semibold text-[#4b5563] shadow-sm ring-2 ring-white">+{data.thumbs.length - 4}</span>}
            </div>
          )}
          {working && <div className="cpf-progress absolute inset-x-0 bottom-0 h-1 bg-[#dbeafe]" />}
        </div>
        <div className="nodrag nowheel relative px-3 pb-3 pt-2.5">
          {data.error && <p className="mb-1.5 line-clamp-2 text-[10.5px] leading-4 text-red-700" title={data.error}>{data.error}</p>}
          {working && <p className="mb-1.5 text-[10.5px] font-semibold text-[#1d4ed8]">Working on this pose only</p>}
          <textarea value={note} maxLength={1000} onChange={(event) => {
            const next = event.target.value;
            setNote(next);
            if (data.poseIndex) actions.saveNote(data.poseIndex, next);
          }} placeholder="What to change in the next version (required to re-generate)" className="h-[52px] w-full resize-none bg-transparent text-[12.5px] leading-[17px] text-[#1f2430] outline-none placeholder:text-[#9aa0ab]" />
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[10px] text-[#9aa0ab]" title="Queues this pose only. The current image stays until the new one is saved.">{note.length}/1000 · this pose only, current image stays</p>
            <div className="relative flex shrink-0 items-center rounded-full bg-[#111827] text-white shadow-sm">
              <button type="button" title={runTitle} disabled={!data.canRegenerate || !actions.onRegenerate || !note.trim() || actions.busyPose !== undefined} onClick={() => data.poseIndex && actions.onRegenerate?.(data.poseIndex, note.trim())} className="rounded-l-full py-1.5 pl-3.5 pr-2.5 text-[12px] font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45">
                {actions.busyPose === data.poseIndex ? "Queueing..." : "Run"}
              </button>
              <span className="h-4 w-px bg-white/25" />
              <button type="button" title="Version history" aria-label="Version history" onClick={() => setMenu(menu === "versions" ? null : "versions")} className="rounded-r-full py-1.5 pl-1.5 pr-2.5 transition hover:bg-white/10">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${menu === "versions" ? "rotate-180" : ""}`} />
              </button>
              {menu === "versions" && (
                <div className="absolute bottom-full right-0 z-20 mb-2 w-60 rounded-xl border border-[#e6e8ee] bg-white p-1.5 text-[#1f2430] shadow-[0_16px_40px_rgba(16,24,40,0.16)]">
                  <p className="px-2 pb-1 pt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#9aa0ab]">Versions{data.versionCount ? ` · ${data.versionCount}` : ""}</p>
                  {(data.versions || []).slice(0, 4).map((version) => {
                    const when = version.at ? new Date(version.at) : null;
                    const stamp = when && Number.isFinite(when.getTime()) ? when.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
                    const label = `v${version.version} ${versionStatusLabel(version.status)}${stamp ? ` · ${stamp}` : ""}`;
                    return version.imageUrl
                      ? <button key={version.version} type="button" className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-[11.5px] font-medium text-[#1d4ed8] hover:bg-[#f5f6f8]" onClick={() => { setMenu(null); actions.onPreview(version.imageUrl || "", `Version ${version.version}`); }}>{label}</button>
                      : <p key={version.version} className="truncate px-2 py-1.5 text-[11.5px] text-[#6b7280]">{label}</p>;
                  })}
                  {!data.versions?.length && <p className="px-2 py-1.5 text-[11.5px] text-[#6b7280]">No earlier versions.</p>}
                </div>
              )}
            </div>
          </div>
        </div>
        <IconHandle id="image" type="target" position={Position.Left} top={LABEL + OUTPUT_IMAGE / 2} />
        <IconHandle id="text" type="target" position={Position.Left} top={LABEL + OUTPUT_IMAGE + 36} text />
      </div>
      <div className="nodrag absolute left-1/2 mt-2 flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-full border border-[#e6e8ee] bg-white px-1.5 py-1 text-[11.5px] text-[#1f2430] shadow-[0_4px_14px_rgba(16,24,40,0.08)]">
        <span className="max-w-[118px] truncate px-1.5 font-medium" title={modelLabel}>{modelLabel}</span>
        {data.aspectRatio && <><span className="h-3.5 w-px bg-[#e6e8ee]" /><span className="px-1.5">{data.aspectRatio}</span></>}
        {data.imageSize && <span className="px-1.5">{data.imageSize}</span>}
        {quality && <span className="inline-flex items-center gap-1 px-1.5"><Gem className="h-3 w-3 text-[#6b7280]" />{quality}</span>}
        {!data.aspectRatio && !data.imageSize && !quality && data.settings && <span className="px-1.5">{data.settings}</span>}
        <span className="h-3.5 w-px bg-[#e6e8ee]" />
        <button type="button" title={actions.busyPose === data.poseIndex ? "Downloading" : "Download"} aria-label="Download" disabled={!actions.onDownload || busy || !data.imageUrl} onClick={() => data.poseIndex && actions.onDownload?.(data.poseIndex)} className="grid h-6 w-6 place-items-center rounded-full transition hover:bg-[#f3f4f6] disabled:opacity-35">
          {actions.busyPose === data.poseIndex ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        </button>
        <div className="relative">
          <button type="button" title="More" aria-label="More actions" onClick={() => setMenu(menu === "more" ? null : "more")} className="grid h-6 w-6 place-items-center rounded-full transition hover:bg-[#f3f4f6]">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menu === "more" && (
            <div className="absolute right-0 top-full z-20 mt-2 w-44 rounded-xl border border-[#e6e8ee] bg-white p-1.5 shadow-[0_16px_40px_rgba(16,24,40,0.16)]">
              <button type="button" disabled={!data.imageUrl} onClick={() => { setMenu(null); if (data.imageUrl) actions.onCopy(data.imageUrl); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11.5px] font-medium hover:bg-[#f5f6f8] disabled:opacity-40"><Link2 className="h-3.5 w-3.5" /> Copy link</button>
              <button type="button" disabled={!data.poseIndex || !actions.promptFor(data.poseIndex)} onClick={() => { setMenu(null); if (data.poseIndex) actions.onPrompt(data.poseIndex, `Pose ${data.poseIndex} · ${data.title}`); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11.5px] font-medium hover:bg-[#f5f6f8] disabled:opacity-40"><FileText className="h-3.5 w-3.5" /> Full prompt</button>
              <button type="button" disabled={!data.imageUrl} onClick={() => { setMenu(null); if (data.imageUrl) actions.onPreview(data.imageUrl, data.title); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11.5px] font-medium hover:bg-[#f5f6f8] disabled:opacity-40"><Maximize2 className="h-3.5 w-3.5" /> Open full size</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = { "cpf-lane": LaneNode, "cpf-input": InputNode, "cpf-analysis": AnalysisNode, "cpf-prompt": PromptNode, "cpf-output": OutputNode };

function statusTone(status: string) {
  const value = status.toLowerCase();
  if (["queued", "processing", "cancelling", "running"].includes(value)) return { label: titleCase(value), dot: "#3b82f6", pulse: true };
  if (value === "completed") return { label: "Completed", dot: "#10b981", pulse: false };
  if (["failed", "cancelled", "needs_review"].includes(value)) return { label: titleCase(value.replaceAll("_", " ")), dot: value === "needs_review" ? "#f59e0b" : "#ef4444", pulse: false };
  return value ? { label: titleCase(value.replaceAll("_", " ")), dot: "#9aa0ab", pulse: false } : null;
}

function HeaderChip({ icon: Icon, children, title }: { icon?: ComponentType<{ className?: string }>; children: ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#e6e8ee] bg-white px-2.5 py-1 text-[11.5px] font-medium text-[#374151] shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      {Icon && <Icon className="h-3.5 w-3.5 text-[#6b7280]" />}
      {children}
    </span>
  );
}

/** A loading stand-in for the board: four tinted groups with shimmering cards. */
export function FlowBoardSkeleton({ className }: { className?: string }) {
  return (
    <div className={`cpf-board flex flex-col overflow-hidden rounded-2xl border border-[#e6e8ee] bg-[#f7f8fa] ${className || "h-[calc(100vh-280px)] min-h-[560px]"}`} aria-busy="true" aria-label="Loading generation flow">
      <div className="flex items-center gap-2 border-b border-[#eceef3] bg-white/70 px-4 py-3">
        <div className="cpf-skeleton h-7 w-16 rounded-full" />
        <div className="cpf-skeleton h-5 w-48 rounded-md" />
        <div className="ml-auto cpf-skeleton h-7 w-28 rounded-full" />
      </div>
      <div className="flex min-h-0 flex-1 gap-8 overflow-hidden p-8">
        {(["input", "analysis", "prompting", "output"] as const).map((tone, index) => (
          <div key={tone} className="flex shrink-0 flex-col gap-4 rounded-[24px] border p-5" style={{ background: LANE_TONES[tone].bg, borderColor: LANE_TONES[tone].border, width: index === 3 ? 520 : 220 }}>
            <div className="cpf-skeleton h-4 w-24 rounded-md" />
            <div className={index === 3 ? "grid grid-cols-2 gap-4" : "flex flex-col gap-4"}>
              {Array.from({ length: index === 1 ? 1 : index === 3 ? 4 : 3 }).map((_, item) => <div key={item} className="cpf-skeleton rounded-2xl" style={{ height: index === 1 ? 320 : index === 3 ? 240 : 120 }} />)}
            </div>
          </div>
        ))}
      </div>
      <p className="pb-4 text-center text-[12px] font-medium text-[#6b7280]">Loading the generation flow…</p>
    </div>
  );
}

export function CatalogPoseFlow({
  references,
  poses,
  className,
  storageKey,
  onBack,
  onDownload,
  onRegenerate,
  busyPose,
  summary,
  message,
}: {
  references: FlowReference[];
  poses: FlowPose[];
  className?: string;
  storageKey?: string;
  onBack?: () => void;
  onDownload?: (poseIndex: number) => void;
  onRegenerate?: (poseIndex: number, note: string) => void;
  busyPose?: number;
  /** Analysis and image-run details for the header and the analysis card. */
  summary?: FlowSummary | null;
  /** An error or notice from the page (e.g. a failed download), shown above the board. */
  message?: string | null;
}) {
  const board = useMemo(() => buildBoard(references, poses, summary), [references, poses, summary]);
  const [nodes, setNodes, onNodesChange] = useNodesState(board.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(board.edges);
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const [linked, setLinked] = useState<ReadonlySet<string>>(() => new Set());
  const [zoom, setZoom] = useState(85);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [promptView, setPromptView] = useState<{ text: string; title: string } | null>(null);
  const [notice, setNotice] = useState("");
  const flow = useRef<ReactFlowInstance<Node<BoardData>, Edge> | null>(null);
  const signature = JSON.stringify({
    layout: `grouped-${LAYOUT_VERSION}`,
    references: references.map((item) => [item.id, item.role, item.fileName, item.imageUrl]),
    poses: poses.map((item) => [item.poseIndex, item.title, item.prompt, item.imageUrl, item.referenceRoles, item.sent, item.model, item.status, item.canRegenerate, item.qaLabel, item.versions?.map((version) => [version.version, version.imageUrl, version.status])]),
    analysis: summary?.analysis ? [summary.analysis.model, summary.analysis.facts.length, summary.analysis.plan.length] : null,
  });
  const seen = useRef("");

  const fit = useCallback(() => {
    void flow.current?.fitView({ ...FIT, duration: 260 });
  }, []);

  const showBoard = useCallback((instance: ReactFlowInstance<Node<BoardData>, Edge>) => {
    void instance.fitView({ ...FIT, duration: 0 }).then(() => {
      if (instance.getZoom() >= READABLE_ZOOM) return;
      const bounds = instance.getNodesBounds(instance.getNodes().filter((node) => !node.parentId));
      void instance.setViewport({ x: 16 - bounds.x * READABLE_ZOOM, y: 16 - bounds.y * READABLE_ZOOM, zoom: READABLE_ZOOM }, { duration: 0 });
    });
  }, []);

  const remember = useCallback((patch: (saved: SavedLayout) => void) => {
    if (!storageKey) return;
    const saved = readLayout(storageKey);
    patch(saved);
    writeLayout(storageKey, saved);
  }, [storageKey]);

  useEffect(() => {
    if (seen.current === signature) return;
    seen.current = signature;
    const saved = readLayout(storageKey);
    setNodes(board.nodes.map((node) => saved.positions[node.id] ? { ...node, position: saved.positions[node.id] } : node));
    setEdges(applyEdges(board.edges, saved));
  }, [board.edges, board.nodes, setEdges, setNodes, signature, storageKey]);

  const promptByPose = useMemo(() => {
    const map = new Map<number, string>();
    for (const pose of poses) map.set(pose.poseIndex, pose.prompt.trim());
    return map;
  }, [poses]);

  const flash = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 4000);
  }, []);

  const copyText = useCallback((value: string, done: string, failed: string) => {
    let settled = false;
    const finish = (copied: boolean) => {
      if (settled) return;
      settled = true;
      flash(copied ? done : failed);
    };
    const command = () => {
      try {
        const field = document.createElement("textarea");
        field.value = value;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.left = "0";
        field.style.top = "0";
        document.body.appendChild(field);
        field.focus();
        field.select();
        const copied = document.execCommand("copy");
        field.remove();
        return copied;
      } catch {
        return false;
      }
    };
    const timer = window.setTimeout(() => finish(command()), 400);
    if (!navigator.clipboard?.writeText) {
      window.clearTimeout(timer);
      finish(command());
      return;
    }
    void navigator.clipboard.writeText(value).then(() => {
      window.clearTimeout(timer);
      finish(true);
    }).catch(() => {
      window.clearTimeout(timer);
      finish(command());
    });
  }, [flash]);

  const actions = useMemo<BoardActions>(() => ({
    onPreview: (url, title) => setPreview({ url, title }),
    onPrompt: (poseIndex, title) => setPromptView({ text: promptByPose.get(poseIndex) || "", title }),
    onDownload,
    onRegenerate,
    onCopy: (url) => copyText(url, "Image link copied", "Could not copy the image link"),
    busyPose,
    noteFor: (poseIndex) => String(readLayout(storageKey).notes?.[String(poseIndex)] || legacyNote(storageKey, poseIndex)).slice(0, 1000),
    saveNote: (poseIndex, next) => {
      remember((saved) => {
        const notes = { ...(saved.notes || {}) };
        const trimmed = next.slice(0, 1000);
        if (trimmed) notes[String(poseIndex)] = trimmed;
        else delete notes[String(poseIndex)];
        saved.notes = notes;
      });
    },
    promptFor: (poseIndex) => promptByPose.get(poseIndex) || "",
  }), [onDownload, onRegenerate, busyPose, storageKey, remember, promptByPose, copyText]);

  const paintEdges = useCallback((activeId: string) => {
    const linkedIds = activeId.startsWith("lane-") ? new Set<string>() : neighborIds(activeId, edgesRef.current);
    const group = new Set(linkedIds);
    if (activeId) group.add(activeId);
    setLinked(linkedIds);
    setEdges((current) => current.map((item) => {
      const hot = Boolean(activeId) && !activeId.startsWith("lane-") && group.has(item.source) && group.has(item.target);
      const stroke = typeof item.data?.stroke === "string" ? item.data.stroke : PRODUCT_STROKE;
      const dim = Boolean(activeId) && !activeId.startsWith("lane-") && !hot;
      return { ...item, animated: hot, zIndex: hot ? 1 : 0, style: { stroke: hot ? HOT_STROKE : stroke, strokeWidth: hot ? 2.2 : 1.5, opacity: dim ? 0.35 : 1 } };
    }));
  }, [setEdges]);

  const status = statusTone(summary?.status || "");
  const settings = settingsLine(summary?.run);

  return (
    <ActionsContext.Provider value={actions}>
      <LinkedContext.Provider value={linked}>
      <div className={`cpf-board flex flex-col overflow-hidden rounded-2xl border border-[#e6e8ee] bg-[#f7f8fa] ${className || "h-[calc(100vh-280px)] min-h-[560px]"}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#eceef3] bg-white/80 px-3 py-2.5 backdrop-blur sm:px-4">
          {onBack && (
            <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-full border border-[#e6e8ee] bg-white px-3 py-1.5 text-[12.5px] font-medium shadow-sm transition hover:bg-[#f5f6f8]">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
          )}
          {summary && (
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-[15px] font-semibold tracking-tight text-[#111827]">{summary.skuName}</h2>
              {status && (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#f3f4f6] px-2 py-0.5 text-[11px] font-medium text-[#374151]">
                  <span className={`h-1.5 w-1.5 rounded-full ${status.pulse ? "animate-pulse" : ""}`} style={{ background: status.dot }} />
                  {status.label}
                </span>
              )}
            </div>
          )}
          {summary && (
            <div className="cpf-scroll order-3 flex w-full min-w-0 gap-1.5 overflow-x-auto pb-0.5 lg:order-none lg:w-auto lg:flex-1">
              {summary.analysis && <HeaderChip icon={Sparkles} title="Model that analysed the product photos">Analysis · {summary.analysis.modelLabel}</HeaderChip>}
              {summary.run && <HeaderChip icon={ImageIcon} title="Image model">Image · {summary.run.modelLabel}</HeaderChip>}
              {settings && <HeaderChip icon={Gem} title="Aspect ratio · size · quality">{settings}</HeaderChip>}
              {summary.run && summary.run.total > 0 && <HeaderChip>{summary.run.done}/{summary.run.total} poses</HeaderChip>}
              {summary.run?.costUsd != null && <HeaderChip title="Actual cost so far, or the estimate before it ran">${summary.run.costUsd.toFixed(2)}</HeaderChip>}
            </div>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => void flow.current?.zoomOut({ duration: 160 })} className="grid h-8 w-8 place-items-center rounded-full border border-[#e6e8ee] bg-white shadow-sm transition hover:bg-[#f5f6f8]" aria-label="Zoom out" title="Zoom out"><ZoomOut className="h-3.5 w-3.5" /></button>
            <div className="min-w-[52px] rounded-full border border-[#e6e8ee] bg-white px-2.5 py-1.5 text-center text-[12px] tabular-nums shadow-sm">{zoom}%</div>
            <button type="button" onClick={() => void flow.current?.zoomIn({ duration: 160 })} className="grid h-8 w-8 place-items-center rounded-full border border-[#e6e8ee] bg-white shadow-sm transition hover:bg-[#f5f6f8]" aria-label="Zoom in" title="Zoom in"><ZoomIn className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={fit} className="inline-flex items-center gap-1.5 rounded-full border border-[#e6e8ee] bg-white px-3 py-1.5 text-[12.5px] font-medium shadow-sm transition hover:bg-[#f5f6f8]" title="Fit the whole flow"><Maximize className="h-3.5 w-3.5" /> Fit</button>
          </div>
        </div>
        {(message || notice) && (
          <p className={`mx-3 mt-2 rounded-xl border px-3 py-2 text-[12px] ${message ? "border-red-200 bg-red-50 text-red-700" : "border-[#e6e8ee] bg-white text-[#1f2430]"}`} role="status">{message || notice}</p>
        )}
        <div className="min-h-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={(_event, _node, dragged) => {
              remember((saved) => {
                for (const node of dragged) saved.positions[node.id] = node.position;
              });
            }}
            onNodeClick={(_event, node) => paintEdges(node.id)}
            onPaneClick={() => paintEdges("")}
            onConnect={(connection) => {
              if (!allowedConnection(connection.source, connection.target)) return;
              const pair = `${connection.source}-${connection.target}`;
              setEdges((current) => current.some((item) => item.source === connection.source && item.target === connection.target) ? current : [
                ...current,
                edge(pair, connection.source, connection.target, PRODUCT_STROKE, connection.source.startsWith("ref-") ? "image" : "text"),
              ]);
              remember((saved) => {
                if (saved.removed.includes(pair)) saved.removed = saved.removed.filter((item) => item !== pair);
                else if (!saved.added.some((item) => item.source === connection.source && item.target === connection.target)) saved.added.push({ source: connection.source, target: connection.target });
              });
            }}
            onEdgesDelete={(deleted) => {
              remember((saved) => {
                for (const item of deleted) {
                  const added = saved.added.some((extra) => extra.source === item.source && extra.target === item.target);
                  if (item.id.startsWith("custom-") || added) saved.added = saved.added.filter((extra) => !(extra.source === item.source && extra.target === item.target));
                  if (!added) saved.removed = [...new Set([...saved.removed, item.id])];
                }
              });
            }}
            onBeforeDelete={async ({ nodes: selectedNodes, edges: selectedEdges }) => (
              selectedNodes.length ? { nodes: [], edges: [] } : { nodes: [], edges: selectedEdges }
            )}
            isValidConnection={(connection) => allowedConnection(connection.source, connection.target)}
            nodeTypes={nodeTypes}
            onInit={(instance) => {
              flow.current = instance;
              const saved = readLayout(storageKey);
              if (saved.viewport) void instance.setViewport(saved.viewport, { duration: 0 });
              else window.requestAnimationFrame(() => showBoard(instance));
            }}
            onMove={(_event, viewport) => setZoom(Math.round(viewport.zoom * 100))}
            onMoveEnd={(event, viewport) => {
              setZoom(Math.round(viewport.zoom * 100));
              if (!event) return;
              remember((saved) => {
                saved.viewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
              });
            }}
            nodesConnectable
            edgesReconnectable
            deleteKeyCode={["Backspace", "Delete"]}
            minZoom={0.15}
            maxZoom={1.6}
            defaultViewport={{ x: 24, y: 24, zoom: 0.6 }}
            proOptions={{ hideAttribution: true }}
            colorMode="light"
            style={{ background: "#f7f8fa" }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="#d5d8e0" />
          </ReactFlow>
        </div>
      </div>
      {preview && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#111827]/75 p-6 backdrop-blur-sm" onClick={() => setPreview(null)} role="dialog" aria-label={preview.title}>
          <img src={preview.url} alt={preview.title} className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl" />
        </div>
      )}
      {promptView && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#111827]/75 p-6 backdrop-blur-sm" onClick={() => setPromptView(null)} role="dialog" aria-label={promptView.title}>
          <article className="cpf-board max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[#1f2430]">{promptView.title}</h2>
                <p className="mt-1 text-xs text-[#6b7280]">This is the stored prompt. Type a change on the generated pose to queue the next version.</p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button type="button" onClick={() => copyText(promptView.text, "Prompt copied", "Could not copy the prompt")} className="rounded-full border border-[#e6e8ee] px-3 py-1.5 text-[12px] font-semibold text-[#1f2430] transition hover:bg-[#f5f6f8]">Copy</button>
                <button type="button" onClick={() => setPromptView(null)} className="rounded-full bg-[#111827] px-3 py-1.5 text-[12px] font-semibold text-white">Close</button>
              </div>
            </div>
            <pre className="mt-4 whitespace-pre-wrap break-words font-[inherit] text-[12.5px] leading-5 text-[#1f2430]">{promptView.text}</pre>
          </article>
        </div>
      )}
      </LinkedContext.Provider>
    </ActionsContext.Provider>
  );
}
