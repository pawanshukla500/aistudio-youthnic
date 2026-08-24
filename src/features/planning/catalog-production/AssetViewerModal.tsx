import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, FileText, Images, Link2, Loader2, X } from "lucide-react";
import { saveAs } from "file-saver";
import { invokeAppApi } from "../../../lib/backend";
import { supabase } from "../../../lib/supabase";
import { resolveCatalogAssetUrl } from "../../../lib/catalogStorage";
import { formatDuration, type CatalogWorkItem } from "./types";

type PoseAsset = {
  generation_id: string;
  pose_index: number;
  title: string;
  pose_type: string;
  instructions: string;
  full_prompt: string;
  status: string;
  output_url: string;
  storage_path: string;
  storage_backend?: string;
  qa_status: string;
  updated_at: string;
};

type ReferenceAsset = {
  role?: string;
  filename?: string;
  downloadUrl?: string;
  storagePath?: string;
  storageBackend?: string;
  storageProvider?: string;
};

type DownloadedAsset = {
  storagePath: string;
  poseIndex: number;
  title: string;
  base64?: string;
  mimeType?: string;
  error?: string;
};

function base64Blob(base64: string, mimeType: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

function extension(mimeType = "image/png") {
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

function safeFilename(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "catalog";
}

export function AssetViewerModal({ item, onClose }: { item: CatalogWorkItem; onClose: () => void }) {
  const [poses, setPoses] = useState<PoseAsset[]>([]);
  const [references, setReferences] = useState<ReferenceAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      const [posesResult, sessionResult] = await Promise.all([
        supabase.from("session_generations")
          .select("generation_id,pose_index,title,pose_type,instructions,full_prompt,status,output_url,storage_path,storage_backend,qa_status,updated_at")
          .eq("session_id", item.catalog_session_id || "")
          .order("pose_index"),
        supabase.from("catalog_sessions").select("session_data").eq("session_id", item.catalog_session_id || "").maybeSingle(),
      ]);
      if (!active) return;
      const requestError = posesResult.error || sessionResult.error;
      if (requestError) setError(requestError.message);
      else {
        const resolvedPoses = await Promise.all((posesResult.data || []).map(async (pose) => ({
          ...pose,
          output_url: await resolveCatalogAssetUrl({ storageBackend: pose.storage_backend, storagePath: pose.storage_path, fallbackUrl: pose.output_url }),
        })));
        const sessionData = (sessionResult.data?.session_data || {}) as Record<string, unknown>;
        const resolvedReferences = await Promise.all((Array.isArray(sessionData.references) ? sessionData.references as ReferenceAsset[] : []).map(async (reference) => ({
          ...reference,
          downloadUrl: await resolveCatalogAssetUrl({
            storageBackend: reference.storageBackend || reference.storageProvider,
            storagePath: reference.storagePath,
            fallbackUrl: reference.downloadUrl,
          }),
        })));
        if (!active) return;
        setPoses(resolvedPoses as PoseAsset[]);
        setReferences(resolvedReferences);
      }
      if (!active) return;
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [item.catalog_session_id]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const completed = useMemo(() => poses.filter((pose) => pose.status === "completed" && pose.output_url), [poses]);

  const fetchAssets = async (selected: PoseAsset[]) => {
    const result = await invokeAppApi<{ assets: DownloadedAsset[] }>("catalogProduction.downloadAssets", {
      workItemId: item.id,
      storagePaths: selected.map((pose) => pose.storage_path).filter(Boolean),
      poseIndexes: selected.map((pose) => pose.pose_index),
    });
    const failures = result.assets.filter((asset) => asset.error || !asset.base64);
    if (failures.length === result.assets.length) throw new Error(failures[0]?.error || "No generated assets could be downloaded.");
    return result.assets;
  };

  const downloadOne = async (pose: PoseAsset) => {
    setDownloading(`pose:${pose.pose_index}`);
    setError("");
    try {
      const assets = await fetchAssets([pose]);
      const asset = assets.find((entry) => entry.poseIndex === pose.pose_index) || assets[0];
      if (!asset?.base64) throw new Error(asset?.error || "The pose could not be downloaded.");
      const mimeType = asset.mimeType || "image/png";
      saveAs(base64Blob(asset.base64, mimeType), `${safeFilename(item.sku_name)}-pose-${pose.pose_index}.${extension(mimeType)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDownloading("");
    }
  };

  const downloadAll = async () => {
    setDownloading("all");
    setError("");
    try {
      const [{ default: JSZip }, assets] = await Promise.all([import("jszip"), fetchAssets(completed)]);
      const zip = new JSZip();
      for (const asset of assets) {
        if (!asset.base64) continue;
        const mimeType = asset.mimeType || "image/png";
        zip.file(`pose-${asset.poseIndex}.${extension(mimeType)}`, asset.base64, { base64: true });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      saveAs(blob, `${safeFilename(item.sku_name)}-poses.zip`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDownloading("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Generated assets for ${item.sku_name}`} onMouseDown={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex flex-col gap-4 border-b border-outline-variant/40 bg-white p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-primary">Generated asset package</p>
            <h2 className="mt-1 truncate text-xl font-bold text-on-surface">{item.sku_name}</h2>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
              <span>{completed.length} of {poses.length || 5} poses complete</span>
              <span>Generation time: <strong className="text-on-surface">{formatDuration(item.generation_started_at, item.generation_completed_at)}</strong></span>
              {item.generation_completed_at && <span>Completed {new Date(item.generation_completed_at).toLocaleString()}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={downloadAll} disabled={loading || !completed.length || Boolean(downloading)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-40">
              {downloading === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download ZIP
            </button>
            <button onClick={onClose} className="rounded-full p-2 text-secondary hover:bg-surface-container" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
        </header>

        {error && <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto bg-surface-container/20 p-5">
          {loading ? (
            <div className="grid min-h-64 place-items-center text-sm font-semibold text-secondary"><span className="inline-flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading prompts, references, and poses…</span></div>
          ) : (
            <div className="space-y-6">
              <section>
                <div className="mb-3 flex items-center gap-2"><Images className="h-4 w-4 text-primary" /><h3 className="text-sm font-bold text-on-surface">Pose 1–5 outputs</h3></div>
                {poses.length ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {poses.map((pose) => (
                      <article key={pose.generation_id} className="flex overflow-hidden rounded-xl border border-outline-variant/40 bg-white shadow-sm">
                        <div className="h-44 w-32 shrink-0 bg-surface-container">
                          {pose.output_url ? <img src={pose.output_url} alt={`${item.sku_name} pose ${pose.pose_index}`} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center px-3 text-center text-xs text-secondary">No image</div>}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-primary">Pose {pose.pose_index}</p><p className="mt-0.5 truncate text-sm font-bold text-on-surface">{pose.title || pose.pose_type || `Pose ${pose.pose_index}`}</p></div>
                            <span className={`rounded-full px-2 py-1 text-[10px] font-bold capitalize ${pose.qa_status === "passed" || pose.qa_status === "pass" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{pose.qa_status || pose.status}</span>
                          </div>
                          <p className="mt-2 line-clamp-4 text-[11px] leading-4 text-secondary">{pose.full_prompt || pose.instructions || "Prompt was not recorded for this pose."}</p>
                          <div className="mt-auto flex gap-2 pt-3">
                            {pose.output_url && <a href={pose.output_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-outline-variant px-2 py-1.5 text-[11px] font-bold text-secondary hover:bg-surface-container"><ExternalLink className="h-3 w-3" /> Open</a>}
                            {pose.status === "completed" && <button onClick={() => void downloadOne(pose)} disabled={Boolean(downloading)} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-primary px-2 py-1.5 text-[11px] font-bold text-primary hover:bg-primary/5 disabled:opacity-40">{downloading === `pose:${pose.pose_index}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Download</button>}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : <div className="rounded-xl border-2 border-dashed border-outline-variant/50 py-12 text-center text-sm text-secondary">No pose records were found for this session.</div>}
              </section>

              <section className="rounded-xl border border-outline-variant/40 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2"><Link2 className="h-4 w-4 text-primary" /><h3 className="text-sm font-bold text-on-surface">Reference details</h3></div>
                {references.length || item.reference_image_url ? (
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    {references.map((reference, index) => {
                      const url = reference.downloadUrl || (reference.storagePath?.startsWith("http") ? reference.storagePath : "");
                      return (
                        <div key={`${reference.role || "reference"}:${reference.storagePath || index}`} className="flex items-center gap-3 rounded-lg bg-surface-container/55 p-3">
                          <FileText className="h-4 w-4 shrink-0 text-primary" />
                          <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold capitalize text-on-surface">{(reference.role || "reference").replaceAll("_", " ")}</p><p className="mt-0.5 truncate text-[11px] text-secondary">{reference.filename || reference.storagePath || "Stored reference"}</p></div>
                          {url && <a href={url} target="_blank" rel="noreferrer" aria-label="Open reference" className="rounded-md p-1.5 text-primary hover:bg-primary/10"><ExternalLink className="h-3.5 w-3.5" /></a>}
                        </div>
                      );
                    })}
                    {item.reference_image_url && <a href={item.reference_image_url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg bg-surface-container/55 p-3 text-xs font-bold text-primary"><Link2 className="h-4 w-4" /> Imported reference image <ExternalLink className="ml-auto h-3.5 w-3.5" /></a>}
                  </div>
                ) : <p className="mt-3 text-sm text-secondary">No reference metadata was stored with this session.</p>}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
