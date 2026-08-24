import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import { invokeAppApi } from "../../../lib/backend";
import { supabase } from "../../../lib/supabase";
import { OperationalWorkflowView } from "../../history/generation-flow/OperationalWorkflowView";
import type { CatalogWorkItem } from "./types";

export function WorkItemWorkflowModal({ item, onClose }: { item: CatalogWorkItem; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      setData(await invokeAppApi("catalogProduction.workflow.get", { workItemId: item.id }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [item.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);
  useEffect(() => {
    let timer = 0;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(true), 250);
    };
    const channel = supabase.channel(`catalog-production-detail:${item.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "catalog_work_items", filter: `id=eq.${item.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "catalog_work_item_events", filter: `work_item_id=eq.${item.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "catalog_pose_asset_versions", filter: `work_item_id=eq.${item.id}` }, refresh)
      .subscribe();
    return () => { window.clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [item.id, load]);

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-[#111827]/75 p-2 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-label={`Live workflow for ${item.sku_name}`}>
      <div className="mx-auto min-h-full max-w-[1600px]">
        {loading ? <div className="grid min-h-[70vh] place-items-center rounded-3xl bg-white"><span className="inline-flex items-center gap-3 text-sm font-semibold text-secondary"><Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading live workflow…</span></div>
          : error ? <div className="grid min-h-[70vh] place-items-center rounded-3xl bg-white p-6"><div className="max-w-md text-center"><AlertCircle className="mx-auto h-8 w-8 text-red-600" /><h2 className="mt-3 text-lg font-bold text-on-surface">Could not load workflow</h2><p className="mt-2 text-sm text-secondary">{error}</p><div className="mt-5 flex justify-center gap-2"><button onClick={() => void load()} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white">Retry</button><button onClick={onClose} className="inline-flex items-center gap-2 rounded-xl border border-outline-variant px-4 py-2 text-sm font-bold text-secondary"><X className="h-4 w-4" /> Close</button></div></div></div>
            : <OperationalWorkflowView data={data} onRefresh={() => load(true)} onBack={onClose} />}
      </div>
    </div>
  );
}
