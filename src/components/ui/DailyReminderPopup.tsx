import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useWorkspace } from "../../lib/WorkspaceContext";

export function DailyReminderPopup() {
  const { organization, permissions, isAdmin } = useWorkspace();
  const [pendingCount, setPendingCount] = useState(0);
  const [show, setShow] = useState(false);

  const canGenerate = isAdmin || permissions.includes("planning.generate_images");

  useEffect(() => {
    // Only show to users who have permission to generate
    if (!canGenerate) return;

    const today = new Date().toLocaleDateString();
    const lastSeen = localStorage.getItem("dailyReminder.lastSeen");

    // If already seen today, don't show again
    if (lastSeen === today) return;

    const checkPendingWork = async () => {
      try {
        const { count, error } = await supabase
          .from("catalog_work_items")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", organization.id)
          .in("generation_status", ["pending", "ready"])
          .is("archived_at", null);

        if (!error && count && count > 0) {
          setPendingCount(count);
          setShow(true);
        }
      } catch {
        // Silently fail if network issue
      }
    };

    checkPendingWork();
  }, [organization.id, canGenerate]);

  const handleDismiss = () => {
    setShow(false);
    localStorage.setItem("dailyReminder.lastSeen", new Date().toLocaleDateString());
  };

  if (!show || pendingCount === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-sm animate-in slide-in-from-bottom-5 fade-in duration-300">
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-white p-5 shadow-2xl">
        <div className="absolute left-0 top-0 h-1 w-full bg-primary" />
        
        <button 
          onClick={handleDismiss}
          className="absolute right-3 top-3 text-secondary hover:text-on-surface"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-on-surface">Daily Generation Reminder</h3>
            <p className="mt-1 text-xs text-secondary leading-relaxed">
              You have <strong>{pendingCount}</strong> SKU{pendingCount === 1 ? "" : "s"} due for generation today.
            </p>
            
            <div className="mt-4 flex items-center gap-3">
              <Link 
                to="/planning?view=list"
                onClick={handleDismiss}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-primary/90 transition-colors"
              >
                Go to Catalog <ArrowRight className="h-3 w-3" />
              </Link>
              <button 
                onClick={handleDismiss}
                className="text-xs font-semibold text-secondary hover:text-on-surface"
              >
                Remind me tomorrow
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
