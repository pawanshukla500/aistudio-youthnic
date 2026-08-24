import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, Filter, MailCheck, Plus, RefreshCw, Search, Upload, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { invokeAppApi } from "../../../lib/backend";
import { supabase } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/WorkspaceContext";
import { ProductionOverview } from "./ProductionOverview";
import { ProductionBoard } from "./ProductionBoard";
import { ProductionTable } from "./ProductionTable";
import { AssetViewerModal } from "./AssetViewerModal";
import { WorkItemWorkflowModal } from "./WorkItemWorkflowModal";
import { HandoffAdmin } from "./HandoffAdmin";
import {
  canQueueGeneration,
  isCompleted,
  sortProductionItems,
  type CatalogMember,
  type CatalogWorkItem,
  type PlanningSku,
} from "./types";

type Tab = "overview" | "kanban" | "list" | "handoffs";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

export function CatalogProduction() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(params.get("view") === "handoffs" ? "handoffs" : "list");
  const [workItems, setWorkItems] = useState<CatalogWorkItem[]>([]);
  const [members, setMembers] = useState<CatalogMember[]>([]);
  const [planningSkus, setPlanningSkus] = useState<PlanningSku[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [viewingItem, setViewingItem] = useState<CatalogWorkItem | null>(null);
  const [workflowItem, setWorkflowItem] = useState<CatalogWorkItem | null>(null);
  const [showSkuPicker, setShowSkuPicker] = useState(false);
  const [selectedSkuIds, setSelectedSkuIds] = useState<Set<string>>(new Set());
  const [selectedTableIds, setSelectedTableIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    query: "",
    stage: "all",
    assignee: "all",
    campaign: "all",
    marketplace: "all",
    priority: "all",
    dateFrom: "",
    dateTo: "",
    sort: "active",
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canManage = workspace.isAdmin || workspace.permissions.includes("planning.manage");
  const canReviewQc = workspace.isAdmin || workspace.permissions.includes("planning.approve");
  const canCompleteListing = workspace.isAdmin
    || workspace.permissions.includes("planning.manage")
    || workspace.roles.some((role) => role.slug === "listing-team");

  const fetchWorkItems = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const workItemsQuery = supabase.from("catalog_work_items").select(`
      *,
      generation_assigned_member:generation_assigned_member_id (id, display_name, email),
      listing_assigned_member:listing_assigned_member_id (id, display_name, email)
    `);
    const requests = [
      workItemsQuery.order("created_at", { ascending: false }),
      supabase.from("organization_members").select("id,display_name,email").eq("organization_id", workspace.organization.id).eq("status", "active").order("display_name"),
      canManage
        ? supabase.from("planning_requests").select("id,request_code,sku_name,color_label,generation_status,updated_at,planning_batches(name)").eq("organization_id", workspace.organization.id).order("updated_at", { ascending: false }).limit(500)
        : Promise.resolve({ data: [], error: null }),
    ] as const;
    const [itemsResult, membersResult, skuResult] = await Promise.all(requests);
    const firstError = itemsResult.error || membersResult.error || skuResult.error;
    if (firstError) {
      setNotice({ tone: "error", message: firstError.message });
    } else {
      setWorkItems(sortProductionItems((itemsResult.data || []) as unknown as CatalogWorkItem[]));
      setMembers((membersResult.data || []) as CatalogMember[]);
      setPlanningSkus((skuResult.data || []) as unknown as PlanningSku[]);
    }
    if (!silent) setLoading(false);
  }, [canManage, workspace.organization.id]);

  useEffect(() => {
    void fetchWorkItems();
    let timer = 0;
    const refreshSoon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void fetchWorkItems(true), 250);
    };
    const channel = supabase.channel(`catalog-production:${workspace.organization.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "catalog_work_items", filter: `organization_id=eq.${workspace.organization.id}` }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "catalog_work_item_events", filter: `organization_id=eq.${workspace.organization.id}` }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "catalog_listing_handoffs", filter: `organization_id=eq.${workspace.organization.id}` }, refreshSoon)
      .subscribe();
    const interval = window.setInterval(() => void fetchWorkItems(true), 60_000);
    const refresh = () => void fetchWorkItems(true);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      void supabase.removeChannel(channel);
    };
  }, [fetchWorkItems, workspace.organization.id]);

  const trackedPlanningIds = useMemo(
    () => new Set(workItems.map((item) => item.planning_request_id).filter(Boolean)),
    [workItems],
  );
  const availableSkus = useMemo(
    () => planningSkus.filter((sku) => !trackedPlanningIds.has(sku.id)),
    [planningSkus, trackedPlanningIds],
  );
  useEffect(() => {
    const requestedWorkItemId = params.get("workItem");
    if (!requestedWorkItemId || workflowItem) return;
    const requested = workItems.find((item) => item.id === requestedWorkItemId);
    if (requested) setWorkflowItem(requested);
  }, [params, workItems, workflowItem]);

  const filterOptions = useMemo(() => ({
    stages: [...new Set(workItems.map((item) => item.workflow_stage || "requirement_created"))].sort(),
    campaigns: [...new Set(workItems.map((item) => item.campaign_season || "").filter(Boolean))].sort(),
    marketplaces: [...new Set(workItems.flatMap((item) => [
      ...(item.marketplaces || []),
      item.portal || "",
      item.marketplace_brand || "",
    ]).filter(Boolean))].sort(),
  }), [workItems]);

  const filteredWorkItems = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    const from = filters.dateFrom ? Date.parse(`${filters.dateFrom}T00:00:00`) : 0;
    const to = filters.dateTo ? Date.parse(`${filters.dateTo}T23:59:59`) : Number.POSITIVE_INFINITY;
    const filtered = workItems.filter((item) => {
      const searchable = [item.sku_name, item.request_code, item.color_label, item.campaign_season, item.theme, item.remarks, ...(item.marketplaces || [])].join(" ").toLowerCase();
      const itemDate = Date.parse(item.request_date || item.created_at);
      const assignees = [item.generation_assigned_member_id, item.listing_assigned_member_id].filter(Boolean);
      const marketplaces = [...(item.marketplaces || []), item.portal || "", item.marketplace_brand || ""];
      return (!query || searchable.includes(query))
        && (filters.stage === "all" || (item.workflow_stage || "requirement_created") === filters.stage)
        && (filters.assignee === "all" || (filters.assignee === "unassigned" ? !assignees.length : assignees.includes(filters.assignee)))
        && (filters.campaign === "all" || item.campaign_season === filters.campaign)
        && (filters.marketplace === "all" || marketplaces.includes(filters.marketplace))
        && (filters.priority === "all" || item.priority === filters.priority)
        && itemDate >= from && itemDate <= to;
    });
    if (filters.sort === "deadline") return [...filtered].sort((left, right) => Date.parse(left.deadline_at || "9999-12-31") - Date.parse(right.deadline_at || "9999-12-31"));
    if (filters.sort === "newest") return [...filtered].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
    if (filters.sort === "sku") return [...filtered].sort((left, right) => left.sku_name.localeCompare(right.sku_name));
    return sortProductionItems(filtered);
  }, [filters, workItems]);

  const activeFilterCount = Object.entries(filters).filter(([key, value]) => key !== "sort" && value && value !== "all").length;
  const activeCount = workItems.filter((item) => !isCompleted(item)).length;
  const completedCount = workItems.length - activeCount;
  const queueableIds = useMemo(
    () => new Set(workItems.filter(canQueueGeneration).map((item) => item.id)),
    [workItems],
  );
  const autoStartIds = useMemo(
    () => new Set(workItems.filter((item) => canQueueGeneration(item) && item.qc_status !== "rejected" && item.workflow_stage !== "regeneration_required").map((item) => item.id)),
    [workItems],
  );
  const visibleQueueableIds = useMemo(
    () => new Set(filteredWorkItems.filter(canQueueGeneration).map((item) => item.id)),
    [filteredWorkItems],
  );

  useEffect(() => {
    setSelectedTableIds((current) => {
      const next = new Set([...current].filter((id) => queueableIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [queueableIds]);

  const runAction = async (key: string, action: () => Promise<unknown>, successMessage: string) => {
    setBusyKey(key);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: "success", message: successMessage });
      await fetchWorkItems(true);
    } catch (error) {
      setNotice({ tone: "error", message: errorMessage(error) });
      throw error;
    } finally {
      setBusyKey("");
    }
  };

  const handleListingDone = async (id: string) => {
    await runAction(
      `listing:${id}`,
      () => invokeAppApi("catalogProduction.markListingDone", { workItemId: id }),
      "Listing marked complete. The item moved to the completed section.",
    ).catch(() => undefined);
  };

  const handleListingStarted = async (id: string) => {
    await runAction(
      `listing-start:${id}`,
      () => invokeAppApi("catalogProduction.startListing", { workItemId: id }),
      "Listing work started. The SKU remains in the active queue until the Listing Team marks it done.",
    ).catch(() => undefined);
  };

  const handleQc = async (id: string, decision: "passed" | "rejected") => {
    const comments = decision === "rejected"
      ? window.prompt("Describe what must change before re-generation:", "")
      : window.prompt("Optional approval comments for the Listing Team:", "");
    if (comments === null || (decision === "rejected" && !comments.trim())) return;
    await runAction(
      `qc:${id}`,
      () => invokeAppApi("catalogProduction.reviewQc", { workItemId: id, decision, comments }),
      decision === "passed" ? "QC passed. The SKU is ready for the Listing Team." : "QC rejected. The SKU moved to Blocked.",
    ).catch(() => undefined);
  };

  const openWorkflow = (item: CatalogWorkItem) => {
    setWorkflowItem(item);
    const next = new URLSearchParams(params);
    next.set("tab", "production");
    next.set("workItem", item.id);
    setParams(next, { replace: true });
  };

  const closeWorkflow = () => {
    setWorkflowItem(null);
    const next = new URLSearchParams(params);
    next.delete("workItem");
    setParams(next, { replace: true });
  };

  const handleAssign = async (id: string, assignment: "generation" | "listing", memberId: string) => {
    await runAction(
      `assign:${assignment}:${id}`,
      () => invokeAppApi("catalogProduction.assign", { workItemId: id, assignment, memberId: memberId || null }),
      `${assignment === "generation" ? "Generation" : "Listing"} owner updated.`,
    ).catch(() => undefined);
  };

  const handleCreateSelectedSkus = async () => {
    const requestIds = [...selectedSkuIds];
    if (!requestIds.length) return;
    await runAction(
      "create-skus",
      () => invokeAppApi("catalogProduction.createFromPlanning", { requestIds }),
      `${requestIds.length} selected SKU${requestIds.length === 1 ? "" : "s"} added to Catalog Production.`,
    ).then(() => {
      setSelectedSkuIds(new Set());
      setShowSkuPicker(false);
    }).catch(() => undefined);
  };

  const handleReconcile = async () => {
    await runAction(
      "reconcile",
      () => invokeAppApi("catalogProduction.reconcile"),
      "Generation links and statuses reconciled.",
    ).catch(() => undefined);
  };

  const downloadTemplate = async () => {
    try {
      const ExcelJS = (await import("exceljs")).default;
      const { saveAs } = await import("file-saver");
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Fashion Catalog Studio_CSV");
      worksheet.columns = [
        { header: "Request ID", key: "reqId", width: 15 },
        { header: "SKU Name", key: "sku", width: 25 },
        { header: "Priority", key: "priority", width: 15 },
        { header: "Theme", key: "theme", width: 20 },
        { header: "Generation Status", key: "genStatus", width: 20 },
        { header: "QC Status", key: "qcStatus", width: 20 },
        { header: "Listing Status", key: "listingStatus", width: 20 },
        { header: "Remarks", key: "remarks", width: 30 },
        { header: "AI Gen Remarks", key: "aiRemarks", width: 30 },
        { header: "Listing Team Remarks", key: "listingRemarks", width: 30 },
        { header: "Listing Action", key: "listingAction", width: 20 },
        { header: "In House Brand", key: "inHouseBrand", width: 20 },
        { header: "Myntra Brand", key: "myntraBrand", width: 20 },
        { header: "Links", key: "links", width: 30 },
        { header: "Front Reference Image", key: "frontRefImage", width: 34 },
        { header: "Back Reference Image", key: "backRefImage", width: 34 },
        { header: "Campaign / Event", key: "campaign", width: 24 },
        { header: "Marketplaces", key: "marketplaces", width: 24 },
        { header: "Deadline", key: "deadline", width: 20 },
        { header: "Special Instructions", key: "instructions", width: 36 },
        { header: "Generation Owner Email", key: "generationOwner", width: 30 },
        { header: "Listing Owner Email", key: "listingOwner", width: 30 },
        { header: "Desired Look and Mood", key: "lookMood", width: 32 },
        { header: "Model Direction", key: "modelDirection", width: 32 },
        { header: "Styling Requirements", key: "styling", width: 32 },
        { header: "Pose Direction", key: "poses", width: 36 },
        { header: "Background / Backdrop", key: "background", width: 30 },
        { header: "Lighting", key: "lighting", width: 28 },
        { header: "Composition", key: "composition", width: 28 },
        { header: "Marketplace Requirements", key: "marketplaceRequirements", width: 36 },
      ];
      for (let row = 2; row <= 1000; row++) {
        worksheet.getCell(`C${row}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"low,normal,high,urgent"'] };
        worksheet.getCell(`E${row}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"ready,queued,generating,completed,failed,not_required"'] };
        worksheet.getCell(`F${row}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"not_started,pending,needs_review,passed,rejected"'] };
        worksheet.getCell(`G${row}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"pending,completed,not_required"'] };
      }
      worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F2457" } };
      worksheet.views = [{ state: "frozen", ySplit: 1 }];
      worksheet.autoFilter = { from: "A1", to: `AD1000` };
      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "Youthnic_Catalog_Template.xlsx");
    } catch (error) {
      setNotice({ tone: "error", message: `Template download failed: ${errorMessage(error)}` });
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setNotice(null);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const worksheet = workbook.worksheets[0];
      if (!worksheet) throw new Error("No worksheets found in the Excel file.");
      const rows: Record<string, unknown>[] = [];
      const headers: string[] = [];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          row.eachCell((cell, column) => { headers[column] = cell.value?.toString().trim() || ""; });
          return;
        }
        const value: Record<string, unknown> = {};
        row.eachCell((cell, column) => {
          const header = headers[column];
          if (header) value[header] = cell.value;
        });
        if (Object.keys(value).length) rows.push(value);
      });
      if (!rows.length) throw new Error("No data found in the uploaded file.");
      const preview = await invokeAppApi<{ scanned: number; newRows: number; matchedRows: number; duplicates: number; invalidSkus: number; unknownStatuses: string[]; unknownAssigneeEmails: string[]; invalidDeadlines: number }>(
        "catalogProduction.importGoogleSheetDryRun",
        { rows },
      );
      const confirmed = window.confirm(
        `Import ${preview.newRows} new SKU${preview.newRows === 1 ? "" : "s"}?\n\n${preview.matchedRows} already tracked · ${preview.duplicates} duplicate rows · ${preview.invalidSkus} invalid SKU rows · ${preview.invalidDeadlines} invalid deadlines · ${preview.unknownAssigneeEmails.length} unknown assignee emails · ${preview.unknownStatuses.length} invalid priority values`,
      );
      if (!confirmed) return;
      const result = await invokeAppApi<{ inserted: number; skipped: number; errors: unknown[]; workItemIds: string[]; queueableWorkItemIds: string[] }>("catalogProduction.importGoogleSheet", { rows });
      
      let queuedMessage = "";
       if (result.queueableWorkItemIds.length > 0) {
          const autoStartConfirmed = window.confirm(`Import finished: ${result.inserted} inserted. Start generation now for ${result.queueableWorkItemIds.length} SKU${result.queueableWorkItemIds.length === 1 ? "" : "s"} with complete front and back references?`);
          if (autoStartConfirmed) {
             const queued = await invokeAppApi<{ queued: number }>("catalogProduction.bulkGenerate", { workItemIds: result.queueableWorkItemIds });
             queuedMessage = ` Started generation for ${queued.queued} SKU${queued.queued === 1 ? "" : "s"}.`;
          }
      }

      setNotice({
        tone: result.errors.length ? "error" : "success",
        message: `Import finished: ${result.inserted} inserted, ${result.skipped} skipped${result.errors.length ? `, ${result.errors.length} failed` : ""}.${queuedMessage}`,
      });
      await fetchWorkItems(true);
    } catch (error) {
      setNotice({ tone: "error", message: `Upload failed: ${errorMessage(error)}` });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const tableProps = {
    items: filteredWorkItems,
    members,
    canManage,
    canReviewQc,
    canCompleteListing,
    busyKey,
    onAssign: handleAssign,
    onQc: handleQc,
    onListingDone: handleListingDone,
    onListingStarted: handleListingStarted,
    onViewAssets: setViewingItem,
    onViewWorkflow: openWorkflow,
    selectedIds: selectedTableIds,
    onToggleSelect: (id: string) => setSelectedTableIds(prev => {
      if (!canManage || !queueableIds.has(id)) return prev;
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    }),
    onToggleSelectAll: () => setSelectedTableIds((current) => (
      visibleQueueableIds.size > 0 && [...visibleQueueableIds].every((id) => current.has(id))
        ? new Set([...current].filter((id) => !visibleQueueableIds.has(id)))
        : new Set([...current, ...visibleQueueableIds])
    )),
  };
  const handleBulkGenerate = async () => {
    if (!selectedTableIds.size) return;
    const confirmed = window.confirm(`Generate ${selectedTableIds.size} catalog item(s)?`);
    if (!confirmed) return;
    
    try {
      await runAction("bulkGenerate", () => invokeAppApi<{ queued: number }>("catalogProduction.bulkGenerate", {
        workItemIds: Array.from(selectedTableIds),
      }), "Bulk generation started successfully.");
      setSelectedTableIds(new Set());
    } catch {
      // runAction already surfaces the actionable backend error and preserves the
      // selection so the manager can fix the affected SKU and retry.
    }
  };

  const handleAutoStartPending = async () => {
    if (!autoStartIds.size) return;
    const confirmed = window.confirm(`Auto-start generation for all ${autoStartIds.size} ready catalog item(s)? Rejected items remain available for an intentional re-generation action.`);
    if (!confirmed) return;
    
    try {
      await runAction("autoStart", () => invokeAppApi<{ queued: number }>("catalogProduction.bulkGenerate", {
        workItemIds: Array.from(autoStartIds),
      }), `Started generation for ${autoStartIds.size} ready item(s).`);
      setSelectedTableIds(new Set());
    } catch {}
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
      <div className="border-b border-outline-variant/40 px-4 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-on-surface">Catalog Production</h2>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">{activeCount} active</span>
              <span className="rounded-full bg-surface-container px-2.5 py-1 text-xs font-bold text-secondary">{completedCount} completed</span>
            </div>
            <p className="mt-1 text-xs text-secondary">Generation syncs automatically. QC unlocks listing, and completed work stays below the active queue.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {([
              { id: "overview", label: "Overview" },
              { id: "kanban", label: "Kanban" },
              { id: "list", label: "List" },
              ...(canManage ? [{ id: "handoffs", label: "Handoffs" }] : []),
            ] as Array<{ id: Tab; label: string }>).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${activeTab === tab.id ? "bg-primary text-white" : "text-secondary hover:bg-surface-container"}`}
              >
                {tab.id === "handoffs" && <MailCheck className="h-3.5 w-3.5" />}{tab.label}
              </button>
            ))}
            {canManage && <span className="mx-1 hidden h-7 w-px bg-outline-variant/50 md:block" />}
            {canManage && (
              <button onClick={() => setShowSkuPicker(true)} className="inline-flex items-center gap-2 rounded-lg border border-primary px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/5">
                <Plus className="h-4 w-4" /> Select SKUs
              </button>
            )}
            {canManage && selectedTableIds.size > 0 && (
              <button onClick={handleBulkGenerate} disabled={busyKey === "bulkGenerate"} className="inline-flex items-center gap-2 rounded-lg border border-primary bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${busyKey === "bulkGenerate" ? "animate-spin" : ""}`} /> Generate Selected ({selectedTableIds.size})
              </button>
            )}
            {canManage && autoStartIds.size > 0 && selectedTableIds.size === 0 && (
              <button onClick={handleAutoStartPending} disabled={busyKey === "autoStart"} className="inline-flex items-center gap-2 rounded-lg border border-primary bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50 shadow-sm shadow-primary/20 transition-all hover:shadow-md">
                <RefreshCw className={`h-4 w-4 ${busyKey === "autoStart" ? "animate-spin" : ""}`} /> Auto-Start Ready ({autoStartIds.size})
              </button>
            )}
            {canManage && (
              <button onClick={handleReconcile} disabled={busyKey === "reconcile"} className="inline-flex items-center gap-2 rounded-lg border border-outline-variant px-3 py-2 text-sm font-semibold text-secondary hover:bg-surface-container disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${busyKey === "reconcile" ? "animate-spin" : ""}`} /> Reconcile
              </button>
            )}
            {canManage && (
              <button onClick={downloadTemplate} className="inline-flex items-center gap-2 rounded-lg border border-outline-variant px-3 py-2 text-sm font-semibold text-secondary hover:bg-surface-container">
                <Download className="h-4 w-4" /> Excel template
              </button>
            )}
            {canManage && (
              <>
                <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFileUpload} />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50">
                  <Upload className={`h-4 w-4 ${uploading ? "animate-pulse" : ""}`} /> {uploading ? "Uploading…" : "Upload Excel"}
                </button>
              </>
            )}
            <a href="/history?source=catalog" className="inline-flex items-center gap-2 rounded-lg border border-outline-variant px-3 py-2 text-sm font-semibold text-secondary hover:bg-surface-container">
              View Tasks in History
            </a>
          </div>
        </div>
        {notice && (
          <div className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
            {notice.tone === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="flex-1">{notice.message}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss message"><X className="h-4 w-4" /></button>
          </div>
        )}
        {activeTab !== "handoffs" && (
          <div className="mt-4 rounded-xl border border-outline-variant/35 bg-white p-3 shadow-sm">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <label className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-secondary" /><input value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="Search SKU, request, campaign, theme, remark or marketplace…" className="h-9 w-full rounded-lg border border-outline-variant bg-surface-container/20 pl-9 pr-3 text-sm text-on-surface outline-none focus:border-primary" /></label>
              <select value={filters.stage} onChange={(event) => setFilters({ ...filters, stage: event.target.value })} className="h-9 rounded-lg border border-outline-variant bg-white px-3 text-xs font-semibold text-secondary"><option value="all">All stages</option>{filterOptions.stages.map((stage) => <option key={stage} value={stage}>{stage.replaceAll("_", " ")}</option>)}</select>
              <select value={filters.assignee} onChange={(event) => setFilters({ ...filters, assignee: event.target.value })} className="h-9 rounded-lg border border-outline-variant bg-white px-3 text-xs font-semibold text-secondary"><option value="all">All assignees</option><option value="unassigned">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.display_name || member.email}</option>)}</select>
              <select value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value })} className="h-9 rounded-lg border border-outline-variant bg-white px-3 text-xs font-semibold text-secondary"><option value="active">Active first</option><option value="deadline">Deadline first</option><option value="newest">Newest first</option><option value="sku">SKU A–Z</option></select>
              <button onClick={() => setShowFilters((value) => !value)} className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-bold ${showFilters || activeFilterCount ? "border-primary bg-primary/5 text-primary" : "border-outline-variant text-secondary"}`}><Filter className="h-3.5 w-3.5" /> More filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}</button>
              <span className="shrink-0 text-xs font-semibold text-secondary">{filteredWorkItems.length} of {workItems.length}</span>
            </div>
            {showFilters && <div className="mt-3 grid gap-3 border-t border-outline-variant/25 pt-3 sm:grid-cols-2 lg:grid-cols-6"><label className="text-[10px] font-bold uppercase tracking-wide text-secondary">Priority<select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })} className="mt-1 h-9 w-full rounded-lg border border-outline-variant bg-white px-2 text-xs font-semibold normal-case tracking-normal"><option value="all">All priorities</option>{["urgent", "high", "normal", "low"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-[10px] font-bold uppercase tracking-wide text-secondary">Campaign<select value={filters.campaign} onChange={(event) => setFilters({ ...filters, campaign: event.target.value })} className="mt-1 h-9 w-full rounded-lg border border-outline-variant bg-white px-2 text-xs font-semibold normal-case tracking-normal"><option value="all">All campaigns</option>{filterOptions.campaigns.map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-[10px] font-bold uppercase tracking-wide text-secondary">Marketplace<select value={filters.marketplace} onChange={(event) => setFilters({ ...filters, marketplace: event.target.value })} className="mt-1 h-9 w-full rounded-lg border border-outline-variant bg-white px-2 text-xs font-semibold normal-case tracking-normal"><option value="all">All marketplaces</option>{filterOptions.marketplaces.map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-[10px] font-bold uppercase tracking-wide text-secondary">From<input type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} className="mt-1 h-9 w-full rounded-lg border border-outline-variant px-2 text-xs font-semibold normal-case tracking-normal" /></label><label className="text-[10px] font-bold uppercase tracking-wide text-secondary">To<input type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} className="mt-1 h-9 w-full rounded-lg border border-outline-variant px-2 text-xs font-semibold normal-case tracking-normal" /></label><button onClick={() => setFilters({ query: "", stage: "all", assignee: "all", campaign: "all", marketplace: "all", priority: "all", dateFrom: "", dateTo: "", sort: "active" })} className="mt-4 h-9 rounded-lg border border-outline-variant px-3 text-xs font-bold text-secondary hover:bg-surface-container">Clear filters</button></div>}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <div className="grid h-full min-h-64 place-items-center text-sm font-semibold text-secondary">
            <span className="inline-flex items-center gap-3"><RefreshCw className="h-5 w-5 animate-spin text-primary" /> Loading catalog production…</span>
          </div>
        ) : (
          <>
            {activeTab === "overview" && <ProductionOverview items={filteredWorkItems} />}
            {activeTab === "kanban" && <ProductionBoard {...tableProps} />}
            {activeTab === "list" && <ProductionTable {...tableProps} />}
            {activeTab === "handoffs" && canManage && <HandoffAdmin />}
          </>
        )}
      </div>

      {viewingItem && <AssetViewerModal item={viewingItem} onClose={() => setViewingItem(null)} />}
      {workflowItem && <WorkItemWorkflowModal item={workflowItem} onClose={closeWorkflow} />}

      {showSkuPicker && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4" onMouseDown={() => setShowSkuPicker(false)}>
          <div className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-outline-variant/40 p-5">
              <div>
                <h3 className="text-lg font-bold text-on-surface">Select catalog SKUs</h3>
                <p className="mt-1 text-sm text-secondary">Create production tasks from existing planning SKUs. Future generation status changes will sync automatically.</p>
              </div>
              <button onClick={() => setShowSkuPicker(false)} className="rounded-full p-2 text-secondary hover:bg-surface-container" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {availableSkus.length ? (
                <div className="space-y-2">
                  {availableSkus.map((sku) => {
                    const checked = selectedSkuIds.has(sku.id);
                    return (
                      <label key={sku.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${checked ? "border-primary bg-primary/5" : "border-outline-variant/50 hover:bg-surface-container/50"}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setSelectedSkuIds((current) => {
                            const next = new Set(current);
                            if (next.has(sku.id)) next.delete(sku.id); else next.add(sku.id);
                            return next;
                          })}
                          className="h-4 w-4 accent-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-on-surface">{sku.sku_name}{sku.color_label ? ` · ${sku.color_label}` : ""}</p>
                          <p className="mt-0.5 truncate text-xs text-secondary">{sku.request_code} · {sku.planning_batches?.name || "Standalone SKU"}</p>
                        </div>
                        <span className="rounded-full bg-surface-container px-2 py-1 text-xs font-semibold text-secondary">{sku.generation_status}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="grid min-h-48 place-items-center rounded-xl border-2 border-dashed border-outline-variant/50 text-center">
                  <div><p className="font-semibold text-on-surface">All planning SKUs are already tracked</p><p className="mt-1 text-sm text-secondary">New planning SKUs will appear here automatically.</p></div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-outline-variant/40 p-4">
              <button
                onClick={() => setSelectedSkuIds(selectedSkuIds.size === availableSkus.length ? new Set() : new Set(availableSkus.map((sku) => sku.id)))}
                className="text-sm font-semibold text-primary disabled:opacity-40"
                disabled={!availableSkus.length}
              >
                {selectedSkuIds.size === availableSkus.length && availableSkus.length ? "Clear all" : "Select all"}
              </button>
              <button
                onClick={handleCreateSelectedSkus}
                disabled={!selectedSkuIds.size || busyKey === "create-skus"}
                className="rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
              >
                {busyKey === "create-skus" ? "Creating…" : `Create ${selectedSkuIds.size || ""} task${selectedSkuIds.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
