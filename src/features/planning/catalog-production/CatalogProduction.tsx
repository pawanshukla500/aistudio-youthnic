import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { ProductionOverview } from "./ProductionOverview";
import { ProductionBoard } from "./ProductionBoard";
import { ProductionTable } from "./ProductionTable";

export function CatalogProduction() {
  const [activeTab, setActiveTab] = useState<"overview" | "workflow" | "table">("table");
  const [workItems, setWorkItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWorkItems();
  }, []);

  const fetchWorkItems = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("catalog_work_items")
      .select(`
        *,
        generation_assigned_member:generation_assigned_member_id (id, full_name, email),
        listing_assigned_member:listing_assigned_member_id (id, full_name, email)
      `)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setWorkItems(data);
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-full bg-transparent overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-outline-variant/40">
        <h2 className="text-lg font-semibold text-on-surface">Catalog Production</h2>
        <div className="flex items-center space-x-2">
          <button 
            onClick={() => setActiveTab("overview")}
            className={`px-3 py-1.5 text-sm font-medium rounded-md ${activeTab === "overview" ? "bg-primary/10 text-primary" : "text-secondary hover:bg-surface-container"}`}
          >
            Overview
          </button>
          <button 
            onClick={() => setActiveTab("workflow")}
            className={`px-3 py-1.5 text-sm font-medium rounded-md ${activeTab === "workflow" ? "bg-primary/10 text-primary" : "text-secondary hover:bg-surface-container"}`}
          >
            Workflow
          </button>
          <button 
            onClick={() => setActiveTab("table")}
            className={`px-3 py-1.5 text-sm font-medium rounded-md ${activeTab === "table" ? "bg-primary/10 text-primary" : "text-secondary hover:bg-surface-container"}`}
          >
            Table
          </button>
          <div className="ml-4 flex items-center gap-2">
            <button className="px-4 py-1.5 text-sm font-medium text-primary border border-primary hover:bg-primary/5 rounded-md shadow-sm transition-colors">
              Download Excel
            </button>
            <button className="px-4 py-1.5 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-md shadow-sm transition-colors">
              Upload Excel
            </button>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-gray-500">Loading catalog items...</span>
          </div>
        ) : (
          <>
            {activeTab === "overview" && <ProductionOverview items={workItems} />}
            {activeTab === "workflow" && <ProductionBoard items={workItems} />}
            {activeTab === "table" && <ProductionTable items={workItems} />}
          </>
        )}
      </div>
    </div>
  );
}
