export type CatalogMember = {
  id: string;
  display_name: string;
  email: string;
};

export type CatalogWorkItem = {
  id: string;
  request_code: string;
  request_date: string;
  created_at: string;
  updated_at: string;
  sku_name: string;
  color_label?: string | null;
  priority: string;
  theme?: string | null;
  portal?: string | null;
  marketplace_brand?: string | null;
  remarks?: string | null;
  work_type: string;
  status: string;
  generation_status: string;
  qc_status: string;
  listing_status: string;
  workflow_stage?: string;
  workflow_progress?: number;
  current_step?: string;
  next_action?: string;
  stage_started_at?: string | null;
  deadline_at?: string | null;
  marketplaces?: string[];
  special_instructions?: string;
  campaign_season?: string | null;
  blocked_reason?: string;
  failure_code?: string;
  final_approved_at?: string | null;
  listing_sent_at?: string | null;
  generation_assigned_member_id?: string | null;
  listing_assigned_member_id?: string | null;
  generation_assigned_member?: CatalogMember | null;
  listing_assigned_member?: CatalogMember | null;
  generation_started_at?: string | null;
  generation_completed_at?: string | null;
  listing_started_at?: string | null;
  listing_completed_at?: string | null;
  completed_at?: string | null;
  planning_request_id?: string | null;
  generation_job_id?: string | null;
  catalog_session_id?: string | null;
  reference_image_url?: string | null;
  back_reference_image_url?: string | null;
  legacy_external_link?: string | null;
  external_link?: string | null;
};

export type PlanningSku = {
  id: string;
  request_code: string;
  sku_name: string;
  color_label?: string | null;
  generation_status: string;
  updated_at: string;
  planning_batches?: { name?: string | null } | null;
};

export type ProductionActionProps = {
  items: CatalogWorkItem[];
  members: CatalogMember[];
  canAssign: boolean;
  canGenerate: boolean;
  canReviewQc: boolean;
  canCompleteListing: boolean;
  busyKey: string;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onAssign: (id: string, assignment: "generation" | "listing", memberId: string) => void | Promise<void>;
  onQc: (id: string, decision: "passed" | "rejected") => void | Promise<void>;
  onListingDone: (id: string) => void | Promise<void>;
  onListingStarted: (id: string) => void | Promise<void>;
  onViewAssets: (item: CatalogWorkItem) => void;
  onViewWorkflow: (item: CatalogWorkItem) => void;
};

export function isCompleted(item: CatalogWorkItem) {
  return item.workflow_stage === "listed" || item.status === "completed" || item.listing_status === "completed";
}

export function canQueueGeneration(item: CatalogWorkItem) {
  if (isCompleted(item)) return false;
  if (!item.planning_request_id && (!item.reference_image_url || !item.back_reference_image_url)) return false;
  if (item.generation_status === "completed" && item.qc_status !== "rejected" && item.workflow_stage !== "regeneration_required") return false;
  return !["queued", "generating", "processing"].includes(item.generation_status);
}

export function sortProductionItems(items: CatalogWorkItem[]) {
  return [...items].sort((left, right) => {
    const completionOrder = Number(isCompleted(left)) - Number(isCompleted(right));
    if (completionOrder) return completionOrder;
    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    const priorityDifference = (priorityOrder[left.priority] ?? 4) - (priorityOrder[right.priority] ?? 4);
    if (priorityDifference && !isCompleted(left)) return priorityDifference;
    const leftDate = Date.parse(isCompleted(left) ? left.completed_at || left.updated_at : left.created_at);
    const rightDate = Date.parse(isCompleted(right) ? right.completed_at || right.updated_at : right.created_at);
    return rightDate - leftDate;
  });
}

export function formatDuration(startedAt?: string | null, completedAt?: string | null) {
  if (!startedAt) return "Not started";
  const start = Date.parse(startedAt);
  const end = completedAt ? Date.parse(completedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "Not recorded";
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", `${seconds}s`].filter(Boolean).join(" ");
}

export function productionStage(item: CatalogWorkItem) {
  if (isCompleted(item)) return "completed";
  if (["blocked_failed", "regeneration_required"].includes(item.workflow_stage || "") || item.status === "blocked" || item.generation_status === "failed" || item.qc_status === "rejected") return "blocked";
  if (item.generation_status === "completed" && item.qc_status !== "passed") return "qc";
  if (["ready_for_listing", "sent_to_listing_team", "listing_in_progress"].includes(item.workflow_stage || "") || item.qc_status === "passed" || ["pending", "ready", "in_progress"].includes(item.listing_status)) return "listing";
  if (["ready", "queued", "generating", "processing"].includes(item.generation_status)) return "generation";
  return "requested";
}
