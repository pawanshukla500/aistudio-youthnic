import { api, useMutation, useQuery } from "../../lib/backend";
import { AlertCircle, AlertTriangle, Bell, Check, Info } from "lucide-react";
import { useWorkspace } from "../../lib/WorkspaceContext";

function formatTime(value: number) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

export function Notifications() {
  const { organization} = useWorkspace();
  const notifications = useQuery(api.notifications.list, {  organizationId: organization._id }) as any[] | undefined;
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const icons = { success: Check, warning: AlertTriangle, error: AlertCircle, info: Info };

  return (
    <div className="mx-auto min-h-[calc(100vh-80px)] max-w-[800px] space-y-6 bg-paper-canvas p-8">
      <div className="flex items-end justify-between border-b border-outline-variant/30 pb-4"><h2 className="flex items-center gap-3 font-syne text-3xl font-bold text-on-surface"><Bell className="h-8 w-8 text-primary" /> Notifications</h2><button onClick={() => markAllRead({  organizationId: organization._id })} className="text-[13px] font-semibold text-primary hover:underline">Mark all as read</button></div>
      <div className="space-y-3">
        {notifications === undefined && <div className="p-8 text-center text-sm text-secondary">Loading notifications…</div>}
        {notifications?.length === 0 && <div className="rounded-xl border border-outline-variant/30 bg-white p-10 text-center text-sm text-secondary">No notifications yet.</div>}
        {notifications?.map((notification) => { const Icon = icons[notification.type as keyof typeof icons] || Info; const unread = !notification.readAt; return <button key={notification._id} onClick={() => unread && markRead({  notificationId: notification._id })} className={`flex w-full gap-4 rounded-xl border p-4 text-left ${unread ? 'border-primary bg-white shadow-sm' : 'border-outline-variant/30 bg-surface opacity-75'}`}><div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-surface-container"><Icon className="h-5 w-5 text-primary" /></div><div className="flex-1"><div className="flex items-start justify-between gap-4"><h4 className="text-[15px] font-bold text-on-surface">{notification.title}</h4><span className="whitespace-nowrap font-mono text-[10px] text-secondary">{formatTime(notification.createdAt)}</span></div><p className="mt-1 text-[13px] text-secondary">{notification.message}</p></div></button> })}
      </div>
    </div>
  );
}
