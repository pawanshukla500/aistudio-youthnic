import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Bell, Calendar as CalendarIcon, CalendarDays, ChevronLeft, ChevronRight, History, LayoutDashboard, Loader2, LogOut, Menu, Pencil, Shield, Wand2, X } from "lucide-react";
import { api, useMutation, useQuery } from "../../lib/backend";
import { useFirebaseAuth } from "../../lib/FirebaseAuthContext";
import { useWorkspace } from "../../lib/WorkspaceContext";
import { ErrorBoundary } from "./ErrorBoundary";

export function Layout() {
  const { organization, user, membership, permissions, roles, isAdmin } = useWorkspace();
  const { signOut } = useFirebaseAuth();
  const location = useLocation();
  const { data: notifications } = useQuery(api.notifications.list, { organizationId: organization._id }) as { data: any[] | undefined, error: any };
  const unread = notifications?.filter((notification) => !notification.readAt).length || 0;
  const can = (permission: string) => isAdmin || permissions.includes(permission);
  const canAdmin = isAdmin || permissions.some((permission) => permission.startsWith("admin."));

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar.collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const updateProfile = useMutation(api.profile.update);
  const memberProfile = membership.profile && typeof membership.profile === "object" ? membership.profile : {};
  const memberNotificationPreferences = membership.notification_preferences && typeof membership.notification_preferences === "object" ? membership.notification_preferences : {};
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileDraft, setProfileDraft] = useState({
    displayName: user.displayName,
    jobTitle: String(memberProfile.jobTitle || ""),
    phone: String(memberProfile.phone || ""),
    catalogAssignmentsInApp: memberNotificationPreferences.catalog_assignments_in_app !== false,
    catalogHandoffEmail: memberNotificationPreferences.catalog_handoff_email !== false,
  });
  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setProfileSaving(true);
    setProfileError("");
    try {
      await updateProfile(profileDraft);
      setProfileOpen(false);
      window.dispatchEvent(new Event("workspace-refresh"));
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : "Could not update your profile.");
    } finally { setProfileSaving(false); }
  };
  const toggle = () =>
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem("sidebar.collapsed", next ? "1" : "0");
      } catch {
        // ignore storage failures
      }
      return next;
    });

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `relative flex items-center gap-3 rounded-xl px-4 py-3 text-[14px] transition ${collapsed ? "lg:justify-center lg:gap-0 lg:px-0" : ""} ${isActive ? "bg-soft-blush font-bold text-primary" : "font-medium text-secondary hover:bg-paper-canvas hover:text-on-surface"}`;

  const items: Array<{ to: string; icon: any; label: string; show: boolean; badge?: number }> = [
    { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard", show: can("reports.view") },
    { to: "/studio", icon: Wand2, label: "Studio", show: can("studio.view") },
    { to: "/planning", icon: CalendarDays, label: "Planning", show: can("planning.view") },
    { to: "/events", icon: CalendarIcon, label: "Events", show: can("planning.view") },
    { to: "/history", icon: History, label: "History", show: can("studio.view") },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background font-manrope text-on-background">
      {mobileNavOpen && <button className="fixed inset-0 z-40 bg-[#111827]/45 backdrop-blur-sm lg:hidden" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation overlay" />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-outline-variant bg-surface-container-lowest shadow-2xl transition-all duration-200 lg:static lg:z-auto lg:translate-x-0 lg:shadow-none ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"} ${collapsed ? "lg:w-20" : "lg:w-sidebar-expanded"}`}>
        <div className={`flex h-20 items-center gap-3 px-6 ${collapsed ? "lg:justify-center lg:px-0" : ""}`}>
          <img src="/logo.png" alt="Youthnic" className="h-11 w-11 object-contain" />
          {(!collapsed || mobileNavOpen) && (
            <div>
              <p className="font-syne text-lg font-bold leading-none text-on-surface">Youthnic</p>
              <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.2em] text-primary">AI Studio</p>
            </div>
          )}
          <button onClick={() => setMobileNavOpen(false)} className="ml-auto rounded-lg p-2 text-secondary hover:bg-surface-container lg:hidden" aria-label="Close navigation"><X className="h-5 w-5" /></button>
        </div>

        {(!collapsed || mobileNavOpen) && (
          <div className="mx-4 rounded-xl border border-outline-variant/50 bg-surface-container-low p-3">
            <p className="truncate text-xs font-bold text-on-surface">{organization.name}</p>
            <p className="mt-1 truncate text-[10px] text-secondary">Secure production workspace</p>
          </div>
        )}

        <nav className="flex-1 space-y-1 px-4 py-5">
          {items.filter((item) => item.show).map((item) => (
            <NavLink key={item.to} to={item.to} onClick={() => setMobileNavOpen(false)} title={collapsed ? item.label : undefined} className={navClass}>
              <item.icon className="h-5 w-5 shrink-0" />
              {(!collapsed || mobileNavOpen) && <span>{item.label}</span>}
              {(!collapsed || mobileNavOpen) && item.badge ? (
                <span className="ml-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-[10px] font-bold text-white">{item.badge}</span>
              ) : null}
              {collapsed && !mobileNavOpen && item.badge ? <span className="absolute right-2.5 top-2 h-2 w-2 rounded-full bg-primary" /> : null}
            </NavLink>
          ))}
          {canAdmin && (
            <>
              <div className="mx-3 my-4 border-t border-outline-variant/50" />
              <NavLink to="/admin" onClick={() => setMobileNavOpen(false)} title={collapsed ? "Administration" : undefined} className={navClass}>
                <Shield className="h-5 w-5 shrink-0" />
                {(!collapsed || mobileNavOpen) && <span>Administration</span>}
              </NavLink>
            </>
          )}
        </nav>

        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`mx-4 mb-2 hidden items-center rounded-xl py-2.5 text-secondary transition hover:bg-paper-canvas hover:text-on-surface lg:flex ${collapsed ? "justify-center px-0" : "gap-3 px-4"}`}
        >
          <ChevronLeft className={`h-5 w-5 shrink-0 transition-transform ${collapsed ? "rotate-180" : ""}`} />
          {!collapsed && <span className="text-[13px] font-semibold">Collapse</span>}
        </button>

        <div className="border-t border-outline-variant/60 p-4">
          <div className={`flex items-center rounded-xl p-2 ${collapsed ? "justify-center" : "gap-3"}`}>
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-container text-sm font-bold text-on-primary-container">
              {user.displayName.slice(0, 1).toUpperCase()}
            </div>
            {(!collapsed || mobileNavOpen) && (
              <>
                <button onClick={() => { setProfileDraft({ displayName: user.displayName, jobTitle: String(memberProfile.jobTitle || ""), phone: String(memberProfile.phone || ""), catalogAssignmentsInApp: memberNotificationPreferences.catalog_assignments_in_app !== false, catalogHandoffEmail: memberNotificationPreferences.catalog_handoff_email !== false }); setProfileOpen(true); }} className="min-w-0 flex-1 rounded-lg text-left hover:text-primary" title="Edit your profile">
                  <p className="truncate text-xs font-bold text-on-surface">{user.displayName}</p>
                  <p className="truncate text-[10px] text-secondary">{String(memberProfile.jobTitle || roles.map((role) => role.name).join(", ") || "Member")}</p>
                </button>
                <button onClick={() => void signOut()} title="Sign out" className="rounded-lg p-2 text-secondary transition hover:bg-danger-surface hover:text-danger">
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
          {collapsed && !mobileNavOpen && (
            <button onClick={() => void signOut()} title="Sign out" className="mt-2 flex w-full justify-center rounded-lg p-2 text-secondary transition hover:bg-danger-surface hover:text-danger">
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-background">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-outline-variant/50 bg-surface-container-lowest px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2 text-xs text-secondary">
            <button onClick={() => setMobileNavOpen(true)} className="mr-1 rounded-lg p-2 text-secondary hover:bg-surface-container lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
            <span>{organization.name}</span>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="font-semibold text-on-surface">Production workspace</span>
          </div>
          <div className="flex items-center gap-3">
            <NavLink to="/notifications" title="Notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative rounded-xl p-2 text-secondary transition hover:bg-surface-container hover:text-primary">
              <Bell className="h-5 w-5" />
              {unread > 0 && <span className="absolute right-1 top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
            </NavLink>
            <div className="hidden text-right sm:block">
              <p className="text-xs font-semibold text-on-surface">{user.displayName}</p>
              <p className="text-[10px] text-secondary">{user.email}</p>
            </div>
          </div>
        </header>
        <div className="flex-1 p-3 sm:p-5 lg:p-8">
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
      {profileOpen && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-[#20161b]/45 p-4 backdrop-blur-sm" onClick={() => setProfileOpen(false)}>
          <form onSubmit={saveProfile} onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl">
            <div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Your profile</p><h2 className="mt-2 font-syne text-2xl font-bold text-on-surface">Edit personal details</h2><p className="mt-1 text-sm text-secondary">These details belong to your own account.</p></div><button type="button" onClick={() => setProfileOpen(false)} className="rounded-lg p-2 text-secondary hover:bg-surface-container"><X className="h-5 w-5" /></button></div>
            <div className="mt-6 space-y-4">
              <label className="block text-xs font-bold uppercase tracking-wider text-secondary">Full name<input required minLength={2} maxLength={80} value={profileDraft.displayName} onChange={(event) => setProfileDraft({ ...profileDraft, displayName: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-outline-variant px-3 text-sm normal-case tracking-normal text-on-surface outline-none focus:border-primary" /></label>
              <label className="block text-xs font-bold uppercase tracking-wider text-secondary">Job title<input maxLength={100} value={profileDraft.jobTitle} onChange={(event) => setProfileDraft({ ...profileDraft, jobTitle: event.target.value })} placeholder="Catalog manager" className="mt-2 h-11 w-full rounded-xl border border-outline-variant px-3 text-sm normal-case tracking-normal text-on-surface outline-none focus:border-primary" /></label>
              <label className="block text-xs font-bold uppercase tracking-wider text-secondary">Phone<input maxLength={30} value={profileDraft.phone} onChange={(event) => setProfileDraft({ ...profileDraft, phone: event.target.value })} placeholder="Optional" className="mt-2 h-11 w-full rounded-xl border border-outline-variant px-3 text-sm normal-case tracking-normal text-on-surface outline-none focus:border-primary" /></label>
              <fieldset className="rounded-2xl border border-outline-variant/60 p-4"><legend className="px-1 text-xs font-bold uppercase tracking-wider text-secondary">Catalog notifications</legend><label className="mt-1 flex items-start justify-between gap-4 text-sm text-on-surface"><span><span className="block font-semibold">Assignment alerts</span><span className="mt-0.5 block text-xs text-secondary">Show an in-app alert when a generation or listing task is assigned to you.</span></span><input type="checkbox" checked={profileDraft.catalogAssignmentsInApp} onChange={(event) => setProfileDraft({ ...profileDraft, catalogAssignmentsInApp: event.target.checked })} className="mt-1 h-4 w-4 shrink-0 accent-primary" /></label><label className="mt-4 flex items-start justify-between gap-4 border-t border-outline-variant/40 pt-4 text-sm text-on-surface"><span><span className="block font-semibold">Listing handoff email</span><span className="mt-0.5 block text-xs text-secondary">Receive consolidated handoff emails when you belong to the selected operational team.</span></span><input type="checkbox" checked={profileDraft.catalogHandoffEmail} onChange={(event) => setProfileDraft({ ...profileDraft, catalogHandoffEmail: event.target.checked })} className="mt-1 h-4 w-4 shrink-0 accent-primary" /></label></fieldset>
            </div>
            {profileError && <p className="mt-4 rounded-xl bg-danger-surface p-3 text-sm text-danger">{profileError}</p>}
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setProfileOpen(false)} className="rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-bold text-secondary">Cancel</button><button disabled={profileSaving} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{profileSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}Save profile</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
