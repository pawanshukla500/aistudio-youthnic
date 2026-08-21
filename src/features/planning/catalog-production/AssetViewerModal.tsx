import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { saveAs } from "file-saver";

interface AssetViewerModalProps {
  sessionId: string;
  onClose: () => void;
}

export function AssetViewerModal({ sessionId, onClose }: AssetViewerModalProps) {
  const [generations, setGenerations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGenerations();
  }, [sessionId]);

  const fetchGenerations = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("session_generations")
      .select("*")
      .eq("session_id", sessionId)
      .order("pose_index");

    if (!error && data) {
      setGenerations(data);
    }
    setLoading(false);
  };

  const handleDownloadAll = async () => {
    // We will download each image sequentially.
    for (const gen of generations) {
      if (gen.result_url) {
        try {
          const response = await fetch(gen.result_url);
          const blob = await response.blob();
          saveAs(blob, `Pose_${gen.pose_index + 1}_${sessionId.slice(0, 8)}.jpg`);
        } catch (err) {
          console.error("Failed to download image", err);
        }
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-outline-variant/40 bg-surface">
          <h2 className="text-xl font-semibold text-on-surface">Generated Assets</h2>
          <div className="flex gap-2">
            <button 
              onClick={handleDownloadAll}
              disabled={loading || generations.length === 0}
              className="px-4 py-1.5 bg-primary text-white text-sm font-medium rounded hover:bg-primary/90 disabled:opacity-50"
            >
              Download All
            </button>
            <button 
              onClick={onClose}
              className="p-2 text-secondary hover:bg-surface-container rounded-full"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 bg-surface-container/20">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <span className="text-secondary">Loading assets...</span>
            </div>
          ) : generations.length === 0 ? (
            <div className="flex items-center justify-center h-48">
              <span className="text-secondary">No generation assets found for this session.</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {generations.map((gen, idx) => (
                <div key={gen.id || idx} className="bg-white border border-outline-variant/40 rounded-lg overflow-hidden shadow-sm flex flex-col">
                  <div className="aspect-[3/4] bg-surface-container relative">
                    {gen.result_url ? (
                      <img src={gen.result_url} alt={`Pose ${gen.pose_index + 1}`} className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex items-center justify-center h-full text-secondary text-sm">No Image</div>
                    )}
                    <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
                      Pose {gen.pose_index + 1}
                    </div>
                  </div>
                  <div className="p-3 flex-1 flex flex-col">
                    <p className="text-xs text-secondary line-clamp-4 flex-1 mb-2">
                      {gen.prompt || "No prompt available."}
                    </p>
                    {gen.result_url && (
                      <button 
                        onClick={async () => {
                          const res = await fetch(gen.result_url);
                          const blob = await res.blob();
                          saveAs(blob, `Pose_${gen.pose_index + 1}.jpg`);
                        }}
                        className="w-full py-1.5 border border-outline-variant text-secondary text-xs font-medium rounded hover:bg-surface-container"
                      >
                        Download Image
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
