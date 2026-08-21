import { useState, useEffect } from "react";
import { supabase } from "../../shared/supabase/supabaseClient";
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
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b dark:border-gray-800">
        <h2 className="text-lg font-semibold dark:text-white">Catalog Production</h2>
        <div className="flex items-center space-x-2">
          <button 
            onClick={() => setActiveTab("overview")}
            className={`px-3 py-1.5 text-sm font-medium rounded-md ${activeTab === "overview" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}
          >
            Overview
          </button>
          <button 
            onClick={() => setActiveTab("workflow")}
            className={`px-3 py-1.5 text-sm font-medium rounded-md ${activeTab === "workflow" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}
          >
            Workflow
          </button>
          <button 
            onClick={() => setActiveTab("table")}
            className={`px-3 py-1.5 text-sm font-medium rounded-md ${activeTab === "table" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}
          >
            Table
          </button>
          <button className="ml-4 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors">
            Import Google Sheet
          </button>
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
            {activeTab === "workflow" && <ProductionBoard items={workItems} refresh={fetchWorkItems} />}
            {activeTab === "table" && <ProductionTable items={workItems} refresh={fetchWorkItems} />}
          </>
        )}
      </div>
    </div>
  );
}
