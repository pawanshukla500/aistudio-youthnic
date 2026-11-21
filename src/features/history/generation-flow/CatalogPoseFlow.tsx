import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
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
import { neighborIds, photosForPose, poseIsWorking, promptExcerpt, referenceLane, type FlowPose, type FlowReference } from "./flowLinks";

export type { FlowPose, FlowReference };

type ShotData = {
  title: string;
  caption: string;
  imageUrl?: string;
  prompt?: string;
  excerpt?: string;
  kind: "reference" | "prompt" | "generated";
  lane?: "product" | "face" | "room";
  poseIndex?: number;
  model?: string;
  status?: string;
  error?: string;
  settings?: string;
  versionCount?: number;
  canRegenerate?: boolean;
  thumbs?: Array<{ url: string; label: string }>;
  versions?: Array<{ version: number; at?: string; status?: string; imageUrl?: string }>;
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

const PRODUCT_STROKE = "#60a5fa";
const FACE_STROKE = "#d97706";
const ROOM_STROKE = "#059669";
const OUTPUT_STROKE = "#94a3b8";

function referenceStroke(role: string) {
  const lane = referenceLane(role);
  if (lane === "face") return FACE_STROKE;
  if (lane === "room") return ROOM_STROKE;
  return PRODUCT_STROKE;
}

const card = { width: 168, height: 214 };
const promptCard = { width: 260, height: 280 };
const output = { width: 300, height: 490 };
const row = 236;

function allowedConnection(source?: string | null, target?: string | null) {
  if (!source || !target) return false;
  if (source.startsWith("ref-") && target.startsWith("prompt-")) return true;
  const prompt = source.match(/^prompt-(\d+)$/);
  return Boolean(prompt && target === `image-${prompt[1]}`);
}

function referenceCaption(reference: FlowReference) {
  const lane = referenceLane(reference.role);
  if (lane === "face") return "Model face";
  if (lane === "room") return reference.postureFor?.length ? `Room + Pose ${reference.postureFor.join(" & ")} posture, no outfit` : "Room only, no outfit";
  return "Product";
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

function readLayout(storageKey?: string): SavedLayout {
  if (!storageKey) return emptyLayout();
  try {
    const parsed = JSON.parse(localStorage.getItem(`youthnic-flow-layout:${storageKey}`) || "{}");
    if (parsed?.positions && typeof parsed.positions === "object") {
      return {
        positions: parsed.positions,
        removed: Array.isArray(parsed.removed) ? parsed.removed : [],
        added: Array.isArray(parsed.added) ? parsed.added : [],
        viewport: finiteViewport(parsed.viewport),
        notes: parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {},
      };
    }
    return { positions: parsed && typeof parsed === "object" ? parsed : {}, removed: [], added: [] };
  } catch {
    return emptyLayout();
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
  localStorage.setItem(`youthnic-flow-layout:${storageKey}`, JSON.stringify(layout));
}

function applyEdges(edges: Edge[], saved: SavedLayout) {
  const removed = new Set(saved.removed);
  const kept = edges.filter((edge) => !removed.has(edge.id));
  const seen = new Set(kept.map((edge) => `${edge.source}>${edge.target}`));
  for (const extra of saved.added) {
    const key = `${extra.source}>${extra.target}`;
    if (seen.has(key) || !extra.source.startsWith("ref-") || !extra.target.startsWith("prompt-")) continue;
    seen.add(key);
    kept.push({
      id: `custom-${extra.source}-${extra.target}`,
      source: extra.source,
      target: extra.target,
      sourceHandle: "out",
      targetHandle: "in",
      type: "default",
      data: { stroke: PRODUCT_STROKE },
      style: { stroke: PRODUCT_STROKE, strokeWidth: 1.6 },
    });
  }
  return kept;
}

function buildBoard(references: FlowReference[], poses: FlowPose[]) {
  const nodes: Node<ShotData>[] = [];
  const edges: Edge[] = [];
  const lanes = (["product", "face", "room"] as const)
    .map((lane) => references.filter((reference) => referenceLane(reference.role) === lane))
    .filter((lane) => lane.length);
  let x = 24;
  for (const lane of lanes) {
    lane.forEach((reference, index) => {
      nodes.push({
        id: `ref-${reference.id}`,
        type: "shot",
        position: { x, y: 24 + index * row },
        width: card.width,
        height: card.height,
        measured: { width: card.width, height: card.height },
        style: card,
        data: {
          kind: "reference",
          lane: referenceLane(reference.role),
          title: reference.label,
          caption: referenceCaption(reference),
          imageUrl: reference.imageUrl,
        },
      });
    });
    x += card.width + 120;
  }
  const promptX = x + 36;
  const imageX = promptX + promptCard.width + 90;
  poses.forEach((pose, index) => {
    const promptId = `prompt-${pose.poseIndex}`;
    const imageId = `image-${pose.poseIndex}`;
    const y = 24 + index * (output.height + 36);
    const sent = pose.sent?.length ? pose.sent : pose.referenceRoles.map((role) => ({ role }));
    const feeding = photosForPose(references, { poseIndex: pose.poseIndex, title: pose.title, sent });
    nodes.push({
      id: promptId,
      type: "shot",
      position: { x: promptX, y },
      width: promptCard.width,
      height: promptCard.height,
      measured: { width: promptCard.width, height: promptCard.height },
      style: promptCard,
      data: {
        kind: "prompt",
        title: `Pose ${pose.poseIndex} prompt`,
        caption: pose.title,
        excerpt: promptExcerpt(pose.prompt, pose.poseIndex),
        poseIndex: pose.poseIndex,
      },
    });
    nodes.push({
      id: imageId,
      type: "shot",
      position: { x: imageX, y },
      width: output.width,
      height: output.height,
      measured: { width: output.width, height: output.height },
      style: output,
      data: {
        kind: "generated",
        title: pose.title || `Pose ${pose.poseIndex}`,
        caption: pose.imageUrl ? "Generated pose" : "Not generated yet",
        imageUrl: pose.imageUrl,
        poseIndex: pose.poseIndex,
        model: pose.model,
        status: pose.status,
        error: pose.error,
        settings: pose.settings,
        versionCount: pose.versionCount,
        canRegenerate: pose.canRegenerate,
        versions: pose.versions,
        thumbs: feeding.filter((reference) => reference.imageUrl).map((reference) => ({ url: reference.imageUrl, label: reference.label })),
      },
    });
    edges.push({
      id: `${promptId}-${imageId}`,
      source: promptId,
      target: imageId,
      sourceHandle: "out",
      targetHandle: "in",
      type: "default",
      data: { stroke: OUTPUT_STROKE },
      style: { stroke: OUTPUT_STROKE, strokeWidth: 1.6 },
    });
    for (const reference of feeding) {
      const stroke = referenceStroke(reference.role);
      edges.push({
        id: `ref-${reference.id}-${promptId}`,
        source: `ref-${reference.id}`,
        target: promptId,
        sourceHandle: "out",
        targetHandle: "in",
        type: "default",
        data: { stroke },
        style: { stroke, strokeWidth: 1.6 },
      });
    }
  });
  return { nodes, edges };
}

function ShotNode({ id, data, selected }: NodeProps<Node<ShotData>>) {
  const actions = useContext(ActionsContext);
  const linked = useContext(LinkedContext);
  const [note, setNote] = useState(() => data.poseIndex ? actions.noteFor(data.poseIndex) : "");
  const sourceColor = data.kind === "prompt" ? OUTPUT_STROKE : data.lane === "face" ? FACE_STROKE : data.lane === "room" ? ROOM_STROKE : "#2563eb";
  const ring = selected ? "ring-2 ring-[#1d4ed8]" : linked.has(id) ? "ring-2 ring-[#93c5fd]" : "ring-1 ring-[#e6e8ee]";
  return (
    <div data-shot-id={id} data-linked={linked.has(id) ? "true" : "false"} className={`flex h-full w-full flex-col overflow-hidden rounded-xl bg-white shadow-[0_8px_24px_rgba(20,24,40,0.08)] ${ring}`}>
      {data.kind !== "reference" && <Handle id="in" type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-[#2563eb]" />}
      <div className="flex items-center justify-between gap-2 px-2.5 pb-1 pt-1.5 text-[11px] text-[#6b7280]">
        <span className="truncate">{data.title}</span>
        {data.status && <span className="shrink-0 capitalize">{data.status.replaceAll("_", " ")}</span>}
      </div>
      {data.kind === "prompt" ? (
        <div className="nodrag nowheel mx-2 mb-2 flex min-h-0 flex-1 flex-col gap-2">
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg bg-[#f7f8fa] p-2 text-[11px] leading-4 text-[#1f2430]">{data.excerpt || (data.poseIndex ? actions.promptFor(data.poseIndex) : "") || "This pose does not have a stored prompt yet."}</pre>
          {Boolean(data.poseIndex && actions.promptFor(data.poseIndex).length > (data.excerpt || "").length) && (
            <button type="button" className="rounded-md border border-[#e6e8ee] px-2 py-1 text-[10px] font-semibold text-[#1f2430]" onClick={() => data.poseIndex && actions.onPrompt(data.poseIndex, data.title)}>Full prompt</button>
          )}
        </div>
      ) : (
        <button type="button" className="nodrag mx-1.5 mb-1 min-h-0 flex-1 overflow-hidden rounded-lg bg-[#f3f1ee] text-left" onClick={() => data.imageUrl && actions.onPreview(data.imageUrl, data.title)} disabled={!data.imageUrl}>
          {data.imageUrl ? <img src={data.imageUrl} alt={data.title} draggable={false} className="pointer-events-none h-full w-full object-cover" /> : <span className="grid h-full place-items-center px-3 text-center text-[11px] text-[#9aa0ab]">No image yet</span>}
        </button>
      )}
      {data.kind === "generated" ? (
        <div className="nodrag nowheel space-y-1.5 px-2.5 pb-2">
          {!!data.thumbs?.length && (
            <div className="flex flex-wrap gap-1">
              {data.thumbs.map((thumb) => (
                <button key={`${thumb.label}:${thumb.url}`} type="button" title={thumb.label} onClick={() => actions.onPreview(thumb.url, thumb.label)} className="h-8 w-6 overflow-hidden rounded">
                  <img src={thumb.url} alt={thumb.label} draggable={false} className="pointer-events-none h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
          <p className="truncate text-[10px] text-[#6b7280]">{data.model || "Model not recorded"}{data.settings ? ` · ${data.settings}` : ""}</p>
          {poseIsWorking(data.status) && <p className="text-[10px] font-semibold text-[#1d4ed8]">Working on this pose only</p>}
          {(data.versions || []).slice(0, 4).map((version) => {
            const when = version.at ? new Date(version.at) : null;
            const stamp = when && Number.isFinite(when.getTime()) ? when.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
            const label = `v${version.version} ${(version.status || "").replaceAll("_", " ")}${stamp ? ` · ${stamp}` : ""}`;
            return version.imageUrl
              ? <button key={version.version} type="button" className="block w-full truncate text-left text-[10px] font-semibold text-[#1d4ed8]" onClick={() => actions.onPreview(version.imageUrl || "", `Version ${version.version}`)}>{label}</button>
              : <p key={version.version} className="truncate text-[10px] text-[#6b7280]">{label}</p>;
          })}
          <textarea value={note} maxLength={1000} onChange={(event) => {
            const next = event.target.value;
            setNote(next);
            if (data.poseIndex) actions.saveNote(data.poseIndex, next);
          }} placeholder="Change for the next version only" className="h-12 w-full resize-none rounded-md border border-[#e6e8ee] p-1.5 text-[10px] leading-4 text-[#1f2430] outline-none" />
          <p className="text-right text-[10px] text-[#9aa0ab]">{note.length}/1000</p>
          <p className="text-[10px] text-[#6b7280]">Queues this pose only. The current image stays until the new one is saved.</p>
          {data.error && <p className="text-[10px] text-red-700">{data.error}</p>}
          <div className="flex flex-wrap gap-1">
            <button type="button" disabled={!data.imageUrl} onClick={() => data.imageUrl && actions.onCopy(data.imageUrl)} className="rounded-md border border-[#e6e8ee] px-2 py-1 text-[10px] font-semibold text-[#1f2430] disabled:opacity-40">Copy link</button>
            <button type="button" disabled={!actions.onDownload || actions.busyPose !== undefined} onClick={() => data.poseIndex && actions.onDownload?.(data.poseIndex)} className="rounded-md border border-[#e6e8ee] px-2 py-1 text-[10px] font-semibold text-[#1f2430] disabled:opacity-40">{actions.busyPose === data.poseIndex ? "Downloading" : "Download"}</button>
            <button type="button" title={data.canRegenerate ? "Queue a new version of this pose only" : "Re-generation is closed for this shoot"} disabled={!data.canRegenerate || !actions.onRegenerate || !note.trim() || actions.busyPose !== undefined} onClick={() => data.poseIndex && actions.onRegenerate?.(data.poseIndex, note.trim())} className="rounded-md bg-[#182033] px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-40">{actions.busyPose === data.poseIndex ? "Queueing..." : "Re-generate"}</button>
          </div>
        </div>
      ) : data.kind === "reference" ? <p className="px-2.5 pb-1.5 text-[10px] text-[#9aa0ab]">{data.caption}</p> : null}
      {data.kind !== "generated" && <Handle id="out" type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white" style={{ background: sourceColor }} />}
    </div>
  );
}

const nodeTypes = { shot: ShotNode };

export function CatalogPoseFlow({
  references,
  poses,
  className,
  storageKey,
  onBack,
  onDownload,
  onRegenerate,
  busyPose,
}: {
  references: FlowReference[];
  poses: FlowPose[];
  className?: string;
  storageKey?: string;
  onBack?: () => void;
  onDownload?: (poseIndex: number) => void;
  onRegenerate?: (poseIndex: number, note: string) => void;
  busyPose?: number;
}) {
  const board = useMemo(() => buildBoard(references, poses), [references, poses]);
  const [nodes, setNodes, onNodesChange] = useNodesState(board.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(board.edges);
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const [linked, setLinked] = useState<ReadonlySet<string>>(() => new Set());
  const [zoom, setZoom] = useState(85);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [promptView, setPromptView] = useState<{ text: string; title: string } | null>(null);
  const [notice, setNotice] = useState("");
  const flow = useRef<ReactFlowInstance<Node<ShotData>, Edge> | null>(null);
  const signature = JSON.stringify({
    layout: "prompt-excerpt-v4",
    references: references.map((item) => [item.id, item.role, item.fileName, item.imageUrl]),
    poses: poses.map((item) => [item.poseIndex, item.title, item.prompt, item.imageUrl, item.referenceRoles, item.sent, item.model, item.status, item.canRegenerate, item.versions?.map((version) => [version.version, version.imageUrl, version.status])]),
  });
  const seen = useRef("");

  const fit = useCallback(() => {
    void flow.current?.fitView({ padding: 0.16, duration: 240 });
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

  const actions = useMemo<BoardActions>(() => ({
    onPreview: (url, title) => setPreview({ url, title }),
    onPrompt: (poseIndex, title) => setPromptView({ text: promptByPose.get(poseIndex) || "", title }),
    onDownload,
    onRegenerate,
      onCopy: (url) => {
        let settled = false;
        const finish = (copied: boolean) => {
          if (settled) return;
          settled = true;
          setNotice(copied ? "Image link copied" : "Could not copy the image link");
          window.setTimeout(() => setNotice(""), 4000);
        };
        const command = () => {
          try {
            const field = document.createElement("textarea");
            field.value = url;
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
        void navigator.clipboard.writeText(url).then(() => {
          window.clearTimeout(timer);
          finish(true);
        }).catch(() => {
          window.clearTimeout(timer);
          finish(command());
        });
      },
    busyPose,
    noteFor: (poseIndex) => String(readLayout(storageKey).notes?.[String(poseIndex)] || "").slice(0, 1000),
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
  }), [onDownload, onRegenerate, busyPose, storageKey, remember, promptByPose]);

  const paintEdges = useCallback((activeId: string) => {
    const linkedIds = neighborIds(activeId, edgesRef.current);
    const group = new Set(linkedIds);
    if (activeId) group.add(activeId);
    setLinked(linkedIds);
    setEdges((current) => current.map((edge) => {
      const hot = Boolean(activeId) && group.has(edge.source) && group.has(edge.target);
      const stroke = typeof edge.data?.stroke === "string" ? edge.data.stroke : PRODUCT_STROKE;
      return { ...edge, animated: hot, style: { stroke: hot ? "#1d4ed8" : stroke, strokeWidth: hot ? 2.4 : 1.6 } };
    }));
  }, [setEdges]);

  return (
    <ActionsContext.Provider value={actions}>
      <LinkedContext.Provider value={linked}>
      <div className={`flex flex-col overflow-hidden rounded-2xl border border-[#e6e8ee] bg-[#f5f6f8] ${className || "h-[calc(100vh-280px)] min-h-[560px]"}`}>
        <div className="flex items-center gap-2 px-3 py-2.5">
          {onBack && <button type="button" onClick={onBack} className="rounded-full border border-[#e6e8ee] bg-white px-3 py-1.5 text-sm shadow-sm">Back</button>}
          <button type="button" onClick={fit} className="ml-auto rounded-full border border-[#e6e8ee] bg-white px-3 py-1.5 text-sm shadow-sm">Fit</button>
          <div className="rounded-full border border-[#e6e8ee] bg-white px-3 py-1.5 text-sm tabular-nums shadow-sm">{zoom}%</div>
        </div>
        {notice && <p className="px-3 pb-1 text-xs text-[#1f2430]">{notice}</p>}
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
              setEdges((current) => current.some((edge) => edge.source === connection.source && edge.target === connection.target) ? current : [...current, {
                id: pair,
                source: connection.source,
                target: connection.target,
                sourceHandle: "out",
                targetHandle: "in",
                type: "default",
                style: { stroke: PRODUCT_STROKE, strokeWidth: 1.6 },
                data: { stroke: PRODUCT_STROKE },
              }]);
              remember((saved) => {
                if (saved.removed.includes(pair)) saved.removed = saved.removed.filter((id) => id !== pair);
                else if (!saved.added.some((item) => item.source === connection.source && item.target === connection.target)) saved.added.push({ source: connection.source, target: connection.target });
              });
            }}
            onEdgesDelete={(deleted) => {
              remember((saved) => {
                for (const edge of deleted) {
                  const added = saved.added.some((item) => item.source === edge.source && item.target === edge.target);
                  if (edge.id.startsWith("custom-") || added) saved.added = saved.added.filter((item) => !(item.source === edge.source && item.target === edge.target));
                  if (!added) saved.removed = [...new Set([...saved.removed, `${edge.source}-${edge.target}`])];
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
              void instance.setViewport(saved.viewport ?? { x: 16, y: 12, zoom: 0.85 }, { duration: 0 });
            }}
            onMove={(_event, viewport) => setZoom(Math.round(viewport.zoom * 100))}
            onMoveEnd={(_event, viewport) => {
              setZoom(Math.round(viewport.zoom * 100));
              remember((saved) => {
                saved.viewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
              });
            }}
            nodesConnectable
            edgesReconnectable
            deleteKeyCode={["Backspace", "Delete"]}
            minZoom={0.15}
            maxZoom={1.6}
            defaultViewport={{ x: 16, y: 12, zoom: 0.85 }}
            proOptions={{ hideAttribution: true }}
            colorMode="light"
            style={{ background: "#f5f6f8" }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="#d5d8e0" />
            <Controls showInteractive={false} position="bottom-left" />
          </ReactFlow>
        </div>
      </div>
      {preview && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#111827]/75 p-6" onClick={() => setPreview(null)}>
          <img src={preview.url} alt={preview.title} className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain" />
        </div>
      )}
      {promptView && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#111827]/75 p-6" onClick={() => setPromptView(null)}>
          <article className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl bg-white p-5" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-base font-semibold text-[#1f2430]">{promptView.title}</h2>
            <p className="mt-1 text-xs text-[#6b7280]">This is the stored prompt. Type a change on the generated pose to queue the next version.</p>
            <pre className="mt-4 whitespace-pre-wrap text-xs leading-5 text-[#1f2430]">{promptView.text}</pre>
          </article>
        </div>
      )}
      </LinkedContext.Provider>
    </ActionsContext.Provider>
  );
}
