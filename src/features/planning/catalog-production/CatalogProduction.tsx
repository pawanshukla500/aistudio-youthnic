import { useState, useEffect, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import { ProductionOverview } from "./ProductionOverview";
import { ProductionBoard } from "./ProductionBoard";
import { ProductionTable } from "./ProductionTable";
import { AssetViewerModal } from "./AssetViewerModal";

export function CatalogProduction() {
  const [activeTab, setActiveTab] = useState<"overview" | "workflow" | "table">("table");
  const [workItems, setWorkItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const sortedData = [...data].sort((a, b) => {
        const isACompleted = a.status === 'completed' || a.listing_status === 'completed';
        const isBCompleted = b.status === 'completed' || b.listing_status === 'completed';
        if (isACompleted && !isBCompleted) return 1;
        if (!isACompleted && isBCompleted) return -1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setWorkItems(sortedData);
    }
    setLoading(false);
  };

  const handleListingDone = async (id: string) => {
    const { error } = await supabase.from("catalog_work_items").update({ 
      listing_status: 'completed',
      status: 'completed', 
      listing_completed_at: new Date().toISOString()
    }).eq("id", id);
    if (!error) {
      fetchWorkItems();
    }
  };

  const downloadTemplate = async () => {
    try {
      const ExcelJS = (await import('exceljs')).default;
      const { saveAs } = await import('file-saver');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Fashion Catalog Studio_CSV');

      worksheet.columns = [
        { header: 'Request ID', key: 'reqId', width: 15 },
        { header: 'SKU Name', key: 'sku', width: 25 },
        { header: 'Priority', key: 'priority', width: 15 },
        { header: 'Theme', key: 'theme', width: 20 },
        { header: 'Generation Status', key: 'genStatus', width: 20 },
        { header: 'Listing Status', key: 'listingStatus', width: 20 },
        { header: 'Remarks', key: 'remarks', width: 30 },
        { header: 'AI Gen Remarks', key: 'aiRemarks', width: 30 },
        { header: 'Listing Team Remarks', key: 'listingRemarks', width: 30 },
        { header: 'Listing Action', key: 'listingAction', width: 20 },
        { header: 'In House Brand', key: 'inHouseBrand', width: 20 },
        { header: 'Myntra Brand', key: 'myntraBrand', width: 20 },
        { header: 'Links', key: 'links', width: 30 },
        { header: 'Reference Image', key: 'refImage', width: 30 },
      ];

      for (let i = 2; i <= 1000; i++) {
        worksheet.getCell(`C${i}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: ['"low,normal,high,urgent"']
        };
        worksheet.getCell(`E${i}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: ['"pending,completed,failed,not_required"']
        };
        worksheet.getCell(`F${i}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: ['"pending,completed,not_required"']
        };
      }

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, 'Youthnic_Catalog_Template.xlsx');
    } catch (error) {
      console.error('Error generating template:', error);
      alert('Failed to generate template.');
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      
      const worksheet = workbook.worksheets[0];
      if (!worksheet) throw new Error("No worksheets found in the Excel file.");

      const rows: any[] = [];
      const headers: string[] = [];

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          row.eachCell((cell, colNumber) => {
            headers[colNumber] = cell.value?.toString() || '';
          });
        } else {
          const rowData: any = {};
          row.eachCell((cell, colNumber) => {
            const header = headers[colNumber];
            if (header) {
              rowData[header] = cell.value;
            }
          });
          rows.push(rowData);
        }
      });

      if (rows.length === 0) {
        throw new Error("No data found in the uploaded file.");
      }

      const { data, error } = await supabase.functions.invoke('app-api', {
        body: { action: 'catalogProduction.importGoogleSheet', rows }
      });

      if (error) throw error;
      
      alert(`Upload successful! Inserted: ${data?.inserted || 0}, Skipped: ${data?.skipped || 0}`);
      fetchWorkItems();
    } catch (error: any) {
      console.error('Error uploading file:', error);
      alert(`Upload failed: ${error.message || 'Unknown error'}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
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
            <button 
              onClick={downloadTemplate}
              className="px-4 py-1.5 text-sm font-medium text-primary border border-primary hover:bg-primary/5 rounded-md shadow-sm transition-colors"
            >
              Download Excel
            </button>
            <input 
              type="file" 
              accept=".xlsx" 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
            />
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-4 py-1.5 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-md shadow-sm transition-colors disabled:opacity-50 flex items-center"
            >
              {uploading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Uploading...
                </>
              ) : (
                'Upload Excel'
              )}
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
            {activeTab === "workflow" && <ProductionBoard items={workItems} onListingDone={handleListingDone} onViewAssets={setViewingSessionId} />}
            {activeTab === "table" && <ProductionTable items={workItems} onListingDone={handleListingDone} onViewAssets={setViewingSessionId} />}
          </>
        )}
      </div>
      {viewingSessionId && (
        <AssetViewerModal sessionId={viewingSessionId} onClose={() => setViewingSessionId(null)} />
      )}
    </div>
  );
}
