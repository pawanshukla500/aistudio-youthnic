import { useEffect, useMemo, useState } from "react";
import { api, useAction, useMutation, useQuery, type Id } from "../../lib/backend";
import {
  Activity,
  Brain,
  CalendarClock,
  Check,
  ChevronRight,
  Database,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  LockKeyhole,
  Plus,
  Mail,
  RefreshCcw,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { useWorkspace } from "../../lib/WorkspaceContext";
import { getErrorMessage } from "../../lib/errors";


type AdminRole = Record<string, any> & { _id: Id<"roles">; name: string; slug: string; description?: string; permissions: string[] };
type AdminMember = Record<string, any> & { _id: string; status: string; user: { displayName: string; email: string } | null; roles: AdminRole[] };
type AdminPermission = Record<string, any> & { key: string; module: string; description?: string };
type AdminOverview = {
  capabilities: Record<string, boolean>;
  health: Record<string, any>;
  members: AdminMember[];
  roles: AdminRole[];
  permissions: AdminPermission[];
  recentAuditLogs: any[];
  automationSettings?: Record<string, any> | null;
  recentEventDeliveries?: any[];
  openaiUsage?: { images: number; requests: number; costUsd: number; lastSyncedAt?: string | null };
};
type Tab = "users" | "roles" | "automation" | "system" | "flow";

function HealthCard({
  label,
  ok,
  icon: Icon,
  detail,
}: {
  label: string;
  ok: boolean;
  icon: typeof Database;
  detail: string;
}) {
  return (
    <div className="flex min-h-28 flex-col rounded-2xl border border-outline-variant/40 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <span className="text-[12px] font-semibold text-secondary">
          {label}
        </span>
        <Icon className="h-4 w-4 text-secondary" />
      </div>
      <div className="mt-auto flex items-center gap-2 pt-5">
        <span
          className={`h-2 w-2 rounded-full ${ok ? "bg-success" : "bg-warning"}`}
        />
        <span
          className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${ok ? "bg-success-surface text-success" : "bg-warning-surface text-warning"}`}
        >
          {ok ? "Ready" : "Needs setup"}
        </span>
        <span className="ml-auto text-[10px] text-secondary">{detail}</span>
      </div>
    </div>
  );
}

function MemberEditor({
  member,
  roles,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  member: AdminMember;
  roles: AdminRole[];
  saving: boolean;
  onClose: () => void;
  onSave: (
    roleIds: Id<"roles">[],
    status: "active" | "disabled",
    displayName?: string
  ) => Promise<void>;
  onDelete: (member: AdminMember) => Promise<void>;
}) {
  const [roleIds, setRoleIds] = useState<Set<Id<"roles">>>(
    new Set(member.roles.map((role) => role._id)),
  );
  const [status, setStatus] = useState<"active" | "disabled">(
    member.status === "disabled" ? "disabled" : "active",
  );
  const [displayName, setDisplayName] = useState(member.user?.displayName || "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState("");
  const toggle = (roleId: Id<"roles">) =>
    setRoleIds((current) => {
      const next = new Set(current);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#20161b]/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              Access control
            </p>
            <h3 className="mt-2 font-syne text-2xl font-bold text-on-surface">
              Edit member access
            </h3>
            <p className="mt-1 text-sm text-secondary">
              {member.user?.displayName} · {member.user?.email}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-secondary hover:bg-surface-container"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-6 space-y-4">
          <label className="block text-xs font-bold uppercase tracking-wider text-secondary">
            Full Name
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-outline-variant bg-white px-3 text-sm font-semibold text-on-surface outline-none focus:border-primary"
              placeholder="e.g. Jane Doe"
            />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wider text-secondary">
            Account status
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as "active" | "disabled")
              }
              className="mt-2 h-11 w-full rounded-xl border border-outline-variant bg-white px-3 text-sm font-semibold text-on-surface outline-none focus:border-primary"
            >
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
        </div>
        <div className="mt-6">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary">
            Assigned roles
          </p>
          <div className="mt-2 space-y-2">
            {roles.map((role) => (
              <label
                key={role._id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${roleIds.has(role._id) ? "border-primary/30 bg-soft-blush" : "border-outline-variant/40 hover:bg-surface-container-low"}`}
              >
                <input
                  type="checkbox"
                  checked={roleIds.has(role._id)}
                  onChange={() => toggle(role._id)}
                  className="mt-1 accent-primary"
                />
                <span>
                  <span className="block text-sm font-bold text-on-surface">
                    {role.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-secondary">
                    {role.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
        {error && (
          <div className="mt-4 rounded-xl bg-danger-surface p-3 text-sm text-danger">
            {error}
          </div>
        )}
        <div className="mt-7 flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (confirmingDelete) {
                setError("");
                void onDelete(member).catch((reason) => {
                  setConfirmingDelete(false);
                  setError(getErrorMessage(reason, "Could not delete user."));
                });
              } else {
                setConfirmingDelete(true);
              }
            }}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-50 ${confirmingDelete ? "bg-danger text-white" : "text-danger hover:bg-danger-surface"}`}
          >
            <Trash2 className="h-4 w-4" />
            {confirmingDelete ? "Confirm delete" : "Delete user"}
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-bold text-secondary"
            >
              Cancel
            </button>
            <button
              disabled={saving || !roleIds.size}
              onClick={() => {
                setError("");
                if (!displayName.trim()) {
                  setError("Full name cannot be empty.");
                  return;
                }
                void onSave([...roleIds], status, displayName.trim()).catch((reason) =>
                  setError(getErrorMessage(reason, "Could not update access.")),
                );
              }}
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save access
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Admin() {
  const { organization, user } = useWorkspace();
  const { data: overview, error: _overviewError } = useQuery(api.admin.overview, {
    organizationId: organization._id,
  }) as { data: AdminOverview | undefined, error: any };
  const createUser = useAction(api.authActions.createUser);
  const updateMemberAccess = useAction(api.authActions.updateMemberAccess);
  const deleteMember = useAction(api.authActions.deleteMember);
  const updateRolePermissions = useMutation(api.admin.updateRolePermissions);
  const updateAutomationSettings = useMutation(api.admin.updateAutomationSettings);
  const syncOpenAiUsage = useAction(api.admin.syncOpenAiUsage);
  const [tab, setTab] = useState<Tab>("users");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingMember, setEditingMember] = useState<AdminMember | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<Id<"roles"> | null>(
    null,
  );
  const [permissionDraft, setPermissionDraft] = useState<Set<string>>(
    new Set(),
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [createError, setCreateError] = useState("");
  const [createForm, setCreateForm] = useState({
    displayName: "",
    email: "",
    password: "",
    roleId: "",
  });
  const [automationDraft, setAutomationDraft] = useState({
    monthlyReportEnabled: true, monthlyReportDay: 1, reminderEnabled: true, reminderDaysBefore: 30,
    researchEnabled: true, reportRecipients: "", stateFilters: "Pan-India, All Indian states and union territories", timezone: "Asia/Kolkata",
  });

  const selectedRole =
    overview?.roles.find((role) => role._id === selectedRoleId) || null;
  useEffect(() => {
    if (!overview || selectedRoleId) return;
    const initial =
      overview.roles.find((role) => role.slug !== "admin") || overview.roles[0];
    if (initial) setSelectedRoleId(initial._id);
  }, [overview, selectedRoleId]);
  useEffect(() => {
    if (selectedRole) setPermissionDraft(new Set(selectedRole.permissions));
  }, [selectedRole]);
  useEffect(() => {
    if (!overview || createForm.roleId) return;
    const initial =
      overview.roles.find((role) => role.slug === "listing-team") ||
      overview.roles.find((role) => role.slug !== "admin") ||
      overview.roles[0];
    if (initial)
      setCreateForm((current) => ({ ...current, roleId: initial._id }));
  }, [overview, createForm.roleId]);
  useEffect(() => {
    const settings = overview?.automationSettings;
    if (!settings) return;
    setAutomationDraft({
      monthlyReportEnabled: settings.monthly_report_enabled !== false,
      monthlyReportDay: Number(settings.monthly_report_day || 1),
      reminderEnabled: settings.reminder_enabled !== false,
      reminderDaysBefore: Number(settings.reminder_days_before || 30),
      researchEnabled: settings.research_enabled !== false,
      reportRecipients: Array.isArray(settings.report_recipients) ? settings.report_recipients.join(", ") : "",
      stateFilters: Array.isArray(settings.state_filters) ? settings.state_filters.join(", ") : "Pan-India, All Indian states and union territories",
      timezone: String(settings.timezone || "Asia/Kolkata"),
    });
  }, [overview?.automationSettings]);

  const filteredMembers = useMemo(
    () =>
      (overview?.members || []).filter((member) =>
        `${member.user?.displayName} ${member.user?.email} ${member.roles.map((role) => role.name).join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [overview, search],
  );
  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, AdminPermission[]>();
    for (const permission of overview?.permissions || [])
      groups.set(permission.module, [
        ...(groups.get(permission.module) || []),
        permission,
      ]);
    return [...groups.entries()];
  }, [overview]);

  const submitUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    setCreateError("");
    try {
      const result = await createUser({
        organizationId: organization._id,
        displayName: createForm.displayName,
        email: createForm.email,
        password: createForm.password,
        roleIds: [createForm.roleId as Id<"roles">],
      });
      setShowCreate(false);
      setCreateForm({ displayName: "", email: "", password: "", roleId: "" });
      setNotice({
        tone: "success",
        text: result.welcomeEmailSent
          ? "User created and a welcome email was sent."
          : "User created. Welcome email was not sent — configure RESEND_API_KEY in Supabase Edge Function secrets.",
      });
    } catch (reason) {
      setCreateError(getErrorMessage(reason, "Could not create user."));
    } finally {
      setSaving(false);
    }
  };

  const saveMember = async (
    roleIds: Id<"roles">[],
    status: "active" | "disabled",
    displayName?: string
  ) => {
    if (!editingMember) return;
    setSaving(true);
    setNotice(null);
    try {
      await updateMemberAccess({
        organizationId: organization._id,
        memberId: editingMember._id,
        roleIds,
        status,
        displayName,
      });
      setEditingMember(null);
      setNotice({ tone: "success", text: "Member access updated." });
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async (member: AdminMember) => {
    setSaving(true);
    setNotice(null);
    try {
      await deleteMember({
        organizationId: organization._id,
        memberId: member._id,
      });
      setEditingMember(null);
      setNotice({
        tone: "success",
        text: `${member.user?.displayName || "User"} was removed from ${organization.name}.`,
      });
    } finally {
      setSaving(false);
    }
  };

  const saveRole = async () => {
    if (!selectedRole) return;
    setSaving(true);
    setNotice(null);
    try {
      await updateRolePermissions({
        organizationId: organization._id,
        roleId: selectedRole._id,
        permissionKeys: [...permissionDraft],
      });
      setNotice({
        tone: "success",
        text: `${selectedRole.name} permissions updated.`,
      });
    } catch (reason) {
      setNotice({
        tone: "error",
        text: getErrorMessage(reason, "Could not update role."),
      });
    } finally {
      setSaving(false);
    }
  };

  const saveAutomation = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await updateAutomationSettings({
        organizationId: organization._id, ...automationDraft,
        reportRecipients: automationDraft.reportRecipients.split(",").map((value) => value.trim()).filter(Boolean),
        stateFilters: automationDraft.stateFilters.split(",").map((value) => value.trim()).filter(Boolean),
      });
      setNotice({ tone: "success", text: "Event reports, reminders, state coverage, and schedule settings were saved." });
    } catch (reason) {
      setNotice({ tone: "error", text: getErrorMessage(reason, "Could not save automation settings.") });
    } finally { setSaving(false); }
  };

  const syncUsage = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const result = await syncOpenAiUsage({ days: 31 });
      setNotice({ tone: "success", text: `OpenAI organization usage synced: ${result.images || 0} images and $${Number(result.costUsd || 0).toFixed(4)} billed cost.` });
    } catch (reason) {
      setNotice({ tone: "error", text: getErrorMessage(reason, "Could not sync OpenAI organization usage.") });
    } finally { setSaving(false); }
  };

  if (!overview)
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );

  return (
    <div className="-m-8 min-h-[calc(100vh-64px)] bg-paper-canvas p-8">
      <div className="mx-auto max-w-[1400px] space-y-7">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
              Admin console
            </span>
            <h2 className="font-syne text-3xl font-bold text-on-surface">
              People, roles, and system access
            </h2>
            <p className="mt-1 text-sm text-secondary">
              Control exactly who can plan, generate, approve, and administer{" "}
              {organization.name}.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-outline-variant/40 bg-white p-3 shadow-sm">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-soft-blush text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-on-surface">
                Signed in as {user.displayName}
              </p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wider text-success">
                Full administrator access
              </p>
            </div>
          </div>
        </div>
        {notice && (
          <div
            className={`flex items-center justify-between rounded-xl border p-3 text-sm ${notice.tone === "success" ? "border-success/20 bg-success-surface text-success" : "border-danger/20 bg-danger-surface text-danger"}`}
          >
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex gap-1 rounded-xl border border-outline-variant/40 bg-white p-1 shadow-sm">
          {[
            ["users", Users, "Users & access"],
            ["roles", KeyRound, "Roles & permissions"],
            ["automation", CalendarClock, "Events & reporting"],
            ["system", Activity, "System & audit"],
          ].map(([value, Icon, label]) => (
            <button
              key={String(value)}
              onClick={() => setTab(value as Tab)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition ${tab === value ? "bg-primary text-white shadow-sm" : "text-secondary hover:bg-surface-container"}`}
            >
              <Icon className="h-4 w-4" />
              {String(label)}
            </button>
          ))}
        </div>

        {tab === "users" && (
          <section className="space-y-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h3 className="font-syne text-xl font-bold text-on-surface">
                  Organization members
                </h3>
                <p className="mt-1 text-sm text-secondary">
                  {overview.members.length} accounts · roles determine backend
                  permissions.
                </p>
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search users…"
                    className="h-10 rounded-xl border border-outline-variant bg-white pl-9 pr-3 text-sm outline-none focus:border-primary"
                  />
                </div>
                {overview.capabilities.canManageUsers && (
                  <button
                    onClick={() => {
                      setCreateError("");
                      setShowCreate(true);
                    }}
                    className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white"
                  >
                    <Plus className="h-4 w-4" />
                    Create user
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-outline-variant/40 bg-white shadow-sm">
              <div className="grid grid-cols-[minmax(240px,1.2fr)_minmax(220px,1fr)_120px_48px] border-b border-outline-variant/30 bg-surface-container-low px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-secondary">
                <span>Member</span>
                <span>Roles</span>
                <span>Status</span>
                <span />
              </div>
              {filteredMembers.map((member) => (
                <div
                  key={member._id}
                  className="grid grid-cols-[minmax(240px,1.2fr)_minmax(220px,1fr)_120px_48px] items-center border-b border-outline-variant/20 px-5 py-4 last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-container font-bold text-on-primary-container">
                      {member.user?.displayName.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-on-surface">
                        {member.user?.displayName || "Unknown user"}
                      </p>
                      <p className="truncate text-xs text-secondary">
                        {member.user?.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {member.roles.map((role) => (
                      <span
                        key={role._id}
                        className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${role.slug === "admin" ? "bg-primary text-white" : "bg-surface-container-high text-secondary"}`}
                      >
                        {role.name}
                      </span>
                    ))}
                  </div>
                  <span
                    className={`w-fit rounded-full px-2 py-1 text-[9px] font-bold uppercase ${member.status === "active" ? "bg-success-surface text-success" : "bg-danger-surface text-danger"}`}
                  >
                    {member.status}
                  </span>
                  <button
                    aria-label={`Edit ${member.user?.displayName || "member"}`}
                    disabled={!overview.capabilities.canManageUsers}
                    onClick={() => setEditingMember(member)}
                    className="rounded-lg p-2 text-secondary hover:bg-soft-blush hover:text-primary disabled:opacity-30"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "roles" && (
          <section className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-2xl border border-outline-variant/40 bg-white shadow-sm">
              <div className="border-b border-outline-variant/30 p-4">
                <h3 className="font-syne text-lg font-bold text-on-surface">
                  Organization roles
                </h3>
                <p className="mt-1 text-xs text-secondary">
                  Select a role to define access.
                </p>
              </div>
              <div className="p-2">
                {overview.roles.map((role) => (
                  <button
                    key={role._id}
                    onClick={() => setSelectedRoleId(role._id)}
                    className={`mb-1 w-full rounded-xl p-3 text-left transition ${selectedRoleId === role._id ? "bg-soft-blush" : "hover:bg-surface-container-low"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-sm font-bold ${selectedRoleId === role._id ? "text-primary" : "text-on-surface"}`}
                      >
                        {role.name}
                      </span>
                      <span className="text-[10px] text-secondary">
                        {role.permissions.length} rules
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-secondary">
                      {role.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>
            {selectedRole && (
              <div className="rounded-2xl border border-outline-variant/40 bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Shield className="h-5 w-5 text-primary" />
                      <h3 className="font-syne text-xl font-bold text-on-surface">
                        {selectedRole.name}
                      </h3>
                    </div>
                    <p className="mt-2 max-w-2xl text-sm text-secondary">
                      {selectedRole.description}
                    </p>
                  </div>
                  <button
                    disabled={
                      saving ||
                      selectedRole.slug === "admin" ||
                      !overview.capabilities.canManageRoles
                    }
                    onClick={() => void saveRole()}
                    className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:bg-surface-container-high disabled:text-secondary"
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save
                    permissions
                  </button>
                </div>
                {selectedRole.slug === "admin" && (
                  <div className="mt-5 flex items-center gap-3 rounded-xl border border-primary/15 bg-soft-blush p-4 text-sm text-primary">
                    <LockKeyhole className="h-4 w-4" />
                    The Admin role is permanently granted every permission.
                  </div>
                )}
                <div className="mt-6 space-y-6">
                  {groupedPermissions.map(([module, permissions]) => (
                    <div key={module}>
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">
                        {module}
                      </p>
                      <div className="grid gap-2 md:grid-cols-2">
                        {permissions.map((permission) => {
                          const enabled =
                            selectedRole.slug === "admin" ||
                            permissionDraft.has(permission.key);
                          return (
                            <button
                              key={permission.key}
                              disabled={
                                selectedRole.slug === "admin" ||
                                !overview.capabilities.canManageRoles
                              }
                              onClick={() =>
                                setPermissionDraft((current) => {
                                  const next = new Set(current);
                                  if (next.has(permission.key))
                                    next.delete(permission.key);
                                  else next.add(permission.key);
                                  return next;
                                })
                              }
                              className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${enabled ? "border-primary/25 bg-soft-blush" : "border-outline-variant/40"}`}
                            >
                              <span
                                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border ${enabled ? "border-primary bg-primary text-white" : "border-outline-variant bg-white"}`}
                              >
                                {enabled && <Check className="h-3.5 w-3.5" />}
                              </span>
                              <span>
                                <span className="block font-mono text-[11px] font-bold text-on-surface">
                                  {permission.key}
                                </span>
                                <span className="mt-1 block text-[11px] leading-4 text-secondary">
                                  {permission.description}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {tab === "automation" && (
          <section className="space-y-6">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-2xl border border-outline-variant/40 bg-white p-6 shadow-sm">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Event automation</p>
                    <h3 className="mt-2 font-syne text-xl font-bold text-on-surface">Monthly reports and planning reminders</h3>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-secondary">Supabase Cron runs an idempotent mail workflow. The default sends the full report on day 1 and a reminder 30 days before each event.</p>
                  </div>
                  <button disabled={saving || !overview.capabilities.canManageSettings} onClick={() => void saveAutomation()} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Save settings</button>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <label className="rounded-xl border border-outline-variant/40 p-4"><span className="flex items-center justify-between text-sm font-bold text-on-surface">Monthly report<input type="checkbox" checked={automationDraft.monthlyReportEnabled} onChange={(event) => setAutomationDraft({ ...automationDraft, monthlyReportEnabled: event.target.checked })} className="h-4 w-4 accent-primary" /></span><span className="mt-2 block text-xs text-secondary">Complete event calendar emailed every month.</span></label>
                  <label className="rounded-xl border border-outline-variant/40 p-4"><span className="flex items-center justify-between text-sm font-bold text-on-surface">Event reminders<input type="checkbox" checked={automationDraft.reminderEnabled} onChange={(event) => setAutomationDraft({ ...automationDraft, reminderEnabled: event.target.checked })} className="h-4 w-4 accent-primary" /></span><span className="mt-2 block text-xs text-secondary">Advance readiness email for each event.</span></label>
                  <label className="text-xs font-bold uppercase tracking-wider text-secondary">Monthly report day<input type="number" min={1} max={28} value={automationDraft.monthlyReportDay} onChange={(event) => setAutomationDraft({ ...automationDraft, monthlyReportDay: Number(event.target.value) })} className="mt-2 h-11 w-full rounded-xl border border-outline-variant px-3 text-sm text-on-surface outline-none focus:border-primary" /></label>
                  <label className="text-xs font-bold uppercase tracking-wider text-secondary">Reminder lead time<input type="number" min={1} max={180} value={automationDraft.reminderDaysBefore} onChange={(event) => setAutomationDraft({ ...automationDraft, reminderDaysBefore: Number(event.target.value) })} className="mt-2 h-11 w-full rounded-xl border border-outline-variant px-3 text-sm text-on-surface outline-none focus:border-primary" /></label>
                  <label className="sm:col-span-2 text-xs font-bold uppercase tracking-wider text-secondary">Report recipients<input value={automationDraft.reportRecipients} onChange={(event) => setAutomationDraft({ ...automationDraft, reportRecipients: event.target.value })} placeholder="ops@example.com, owner@example.com" className="mt-2 h-11 w-full rounded-xl border border-outline-variant px-3 text-sm normal-case tracking-normal text-on-surface outline-none focus:border-primary" /><span className="mt-1 block text-[10px] font-normal normal-case tracking-normal">Comma-separated. Secrets remain server-only; recipients are organization data in Supabase.</span></label>
                  <label className="sm:col-span-2 text-xs font-bold uppercase tracking-wider text-secondary">States and regions to research<input value={automationDraft.stateFilters} onChange={(event) => setAutomationDraft({ ...automationDraft, stateFilters: event.target.value })} placeholder="Pan-India, Rajasthan, Gujarat" className="mt-2 h-11 w-full rounded-xl border border-outline-variant px-3 text-sm normal-case tracking-normal text-on-surface outline-none focus:border-primary" /></label>
                  <label className="text-xs font-bold uppercase tracking-wider text-secondary">Timezone<input value={automationDraft.timezone} onChange={(event) => setAutomationDraft({ ...automationDraft, timezone: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-outline-variant px-3 text-sm normal-case tracking-normal text-on-surface outline-none focus:border-primary" /></label>
                  <label className="rounded-xl border border-outline-variant/40 p-4"><span className="flex items-center justify-between text-sm font-bold normal-case tracking-normal text-on-surface">Monthly grounded research<input type="checkbox" checked={automationDraft.researchEnabled} onChange={(event) => setAutomationDraft({ ...automationDraft, researchEnabled: event.target.checked })} className="h-4 w-4 accent-primary" /></span><span className="mt-2 block text-xs font-normal normal-case tracking-normal text-secondary">Refresh state-wise events with Gemini Google Search.</span></label>
                </div>
              </div>
              <aside className="space-y-4">
                <div className="rounded-2xl border border-outline-variant/40 bg-white p-5 shadow-sm"><Mail className="h-5 w-5 text-primary" /><h3 className="mt-3 font-syne text-lg font-bold">Email readiness</h3><p className="mt-1 text-sm text-secondary">{overview.health.emailConfigured ? "Resend secrets are configured." : "Add RESEND_API_KEY and RESEND_FROM as Supabase Edge Function secrets."}</p><span className={`mt-4 inline-flex rounded-full px-2 py-1 text-[10px] font-bold uppercase ${overview.health.emailConfigured ? "bg-success-surface text-success" : "bg-warning-surface text-warning"}`}>{overview.health.emailConfigured ? "Ready" : "Needs setup"}</span></div>
                <div className="rounded-2xl border border-outline-variant/40 bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-wider text-secondary">OpenAI organization billing</p><p className="mt-2 font-syne text-2xl font-bold">${Number(overview.openaiUsage?.costUsd || 0).toFixed(4)}</p><p className="mt-1 text-xs text-secondary">{overview.openaiUsage?.images || 0} images · {overview.openaiUsage?.requests || 0} requests</p></div><button disabled={saving || !overview.health.openaiAdminConfigured} onClick={() => void syncUsage()} title="Sync the last 31 days" className="rounded-xl border border-outline-variant p-2 text-primary disabled:opacity-30"><RefreshCcw className={`h-4 w-4 ${saving ? "animate-spin" : ""}`} /></button></div><p className="mt-4 text-xs leading-5 text-secondary">{overview.health.openaiAdminConfigured ? `Last synced ${overview.openaiUsage?.lastSyncedAt ? new Date(overview.openaiUsage.lastSyncedAt).toLocaleString("en-IN") : "never"}.` : "Add OPENAI_ADMIN_KEY to fetch authoritative Usage and Costs API totals."}</p></div>
              </aside>
            </div>
            <div className="overflow-hidden rounded-2xl border border-outline-variant/40 bg-white shadow-sm"><div className="border-b border-outline-variant/30 p-5"><h3 className="font-syne text-lg font-bold">Recent email deliveries</h3><p className="mt-1 text-xs text-secondary">Idempotent audit trail for reports and reminders.</p></div>{overview.recentEventDeliveries?.length ? overview.recentEventDeliveries.map((delivery) => <div key={delivery.id} className="grid gap-2 border-b border-outline-variant/20 px-5 py-3 text-xs last:border-0 sm:grid-cols-[170px_1fr_120px_180px]"><span className="font-bold text-on-surface">{String(delivery.delivery_kind).replace(/_/g, " ")}</span><span className="truncate text-secondary">{delivery.subject}</span><span className={delivery.status === "sent" ? "text-success" : delivery.status === "failed" ? "text-danger" : "text-warning"}>{delivery.status}</span><span className="text-secondary">{new Date(delivery.created_at).toLocaleString("en-IN")}</span></div>) : <div className="p-8 text-center text-sm text-secondary">No report or reminder has been sent yet.</div>}</div>
          </section>
        )}

        {tab === "system" && (
          <section className="space-y-7">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
              <HealthCard
                label="Supabase business backend"
                ok={overview.health.supabase}
                icon={Database}
                detail="Data & orchestration"
              />
              <HealthCard
                label="Firebase Auth + Storage"
                ok={overview.health.firebaseConfigured}
                icon={Shield}
                detail="Identity & media"
              />
              <HealthCard
                label="OpenAI image provider"
                ok={overview.health.openaiConfigured}
                icon={ImageIcon}
                detail="Server only"
              />
              <HealthCard
                label="Gemini analysis & QA"
                ok={overview.health.geminiConfigured}
                icon={Brain}
                detail="Server only"
              />
              <HealthCard
                label="Organization users"
                ok={overview.health.memberCount > 0}
                icon={Users}
                detail={`${overview.health.memberCount} members`}
              />
            </div>
            <div>
              <div className="mb-4">
                <h3 className="font-syne text-xl font-bold text-on-surface">
                  Recent audit activity
                </h3>
                <p className="mt-1 text-sm text-secondary">
                  Security, planning, and generation changes recorded in Supabase.
                </p>
              </div>
              <div className="overflow-hidden rounded-2xl border border-outline-variant/40 bg-white shadow-sm">
                <div className="grid grid-cols-[210px_1fr_170px] border-b border-outline-variant/30 bg-surface-container-low px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-secondary">
                  <span>Action</span>
                  <span>Entity</span>
                  <span>Time</span>
                </div>
                {overview.recentAuditLogs.length ? (
                  overview.recentAuditLogs.map((log) => (
                    <div
                      key={log._id}
                      className="grid grid-cols-[210px_1fr_170px] border-b border-outline-variant/20 px-5 py-3 text-[12px] last:border-0"
                    >
                      <span className="font-semibold text-on-surface">
                        {log.action}
                      </span>
                      <span className="font-mono text-secondary">
                        {log.entityType} · {String(log.entityId).slice(-10)}
                      </span>
                      <span className="text-secondary">
                        {new Intl.DateTimeFormat("en-IN", {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(log.timestamp)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="p-10 text-center text-sm text-secondary">
                    No audited changes yet.
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-start gap-4 rounded-2xl border border-outline-variant/40 bg-white p-5">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-success-surface text-success">
                <UserCog className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-syne text-lg font-bold text-on-surface">
                  Secure configuration boundary
                </h3>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-secondary">
                  Firebase Auth owns passwords, sessions, identity tokens, and
                  account disabling. Firebase Storage owns source and generated
                  media. Supabase stores business records, organization roles,
                  generation sessions, and audit logs; provider keys remain
                  server-only.
                </p>
              </div>
            </div>
          </section>
        )}

      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#20161b]/45 p-4 backdrop-blur-sm">
          <form
            onSubmit={submitUser}
            className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                  New team member
                </p>
                <h3 className="mt-2 font-syne text-2xl font-bold text-on-surface">
                  Create user account
                </h3>
                <p className="mt-1 text-sm text-secondary">
                  The user can sign in immediately with the password you set.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg p-2 text-secondary hover:bg-surface-container"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-7 space-y-4">
              <label className="block text-sm font-semibold text-on-surface">
                Full name
                <input
                  required
                  value={createForm.displayName}
                  onChange={(event) =>
                    setCreateForm({
                      ...createForm,
                      displayName: event.target.value,
                    })
                  }
                  className="mt-2 h-11 w-full rounded-xl border border-outline-variant px-3 outline-none focus:border-primary"
                />
              </label>
              <label className="block text-sm font-semibold text-on-surface">
                Email address
                <input
                  required
                  type="email"
                  autoComplete="off"
                  value={createForm.email}
                  onChange={(event) =>
                    setCreateForm({ ...createForm, email: event.target.value })
                  }
                  className="mt-2 h-11 w-full rounded-xl border border-outline-variant px-3 outline-none focus:border-primary"
                />
              </label>
              <label className="block text-sm font-semibold text-on-surface">
                Temporary password
                <input
                  required
                  minLength={8}
                  type="password"
                  autoComplete="new-password"
                  value={createForm.password}
                  onChange={(event) =>
                    setCreateForm({
                      ...createForm,
                      password: event.target.value,
                    })
                  }
                  className="mt-2 h-11 w-full rounded-xl border border-outline-variant px-3 outline-none focus:border-primary"
                />
                <span className="mt-1 block text-[10px] font-normal text-secondary">
                  Minimum 8 characters. Share it through a secure channel.
                </span>
              </label>
              <label className="block text-sm font-semibold text-on-surface">
                Initial role
                <select
                  required
                  value={createForm.roleId}
                  onChange={(event) =>
                    setCreateForm({ ...createForm, roleId: event.target.value })
                  }
                  className="mt-2 h-11 w-full rounded-xl border border-outline-variant bg-white px-3 outline-none focus:border-primary"
                >
                  {overview.roles.map((role) => (
                    <option key={role._id} value={role._id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {createError && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-danger/15 bg-danger-surface p-3 text-sm text-danger"
              >
                {createError}
              </div>
            )}
            <div className="mt-7 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-bold text-secondary"
              >
                Cancel
              </button>
              <button
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Create account
              </button>
            </div>
          </form>
        </div>
      )}
      {editingMember && (
        <MemberEditor
          member={editingMember}
          roles={overview.roles}
          saving={saving}
          onClose={() => setEditingMember(null)}
          onSave={saveMember}
          onDelete={removeMember}
        />
      )}
    </div>
  );
}
