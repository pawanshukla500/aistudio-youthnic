import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  Loader2,
  MailCheck,
  RefreshCw,
  Save,
  Send,
  Settings2,
  XCircle,
} from "lucide-react";
import { invokeAppApi } from "../../../lib/backend";
import { supabase } from "../../../lib/supabase";

type AdminData = {
  settings: Record<string, any>;
  recipientGroups: Array<{ slug: string; name: string; description?: string }>;
  preview: { reportDate: string; recipients: string[]; rows: Array<Record<string, any>>; subject: string };
  deliveries: Array<Record<string, any> & { attempts: Array<Record<string, any>>; itemCount: number }>;
};

const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dateTime(value: unknown) {
  if (!value) return "—";
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function statusTone(status: string) {
  if (status === "sent") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === "failed") return "bg-red-50 text-red-700 ring-red-200";
  if (status === "pending") return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-surface-container text-secondary ring-outline-variant";
}

export function HandoffAdmin() {
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [expandedDelivery, setExpandedDelivery] = useState("");
  const [settings, setSettings] = useState({
    enabled: true,
    timezone: "Asia/Kolkata",
    sendLocalTime: "10:00",
    recipientMode: "listing_team",
    recipientRoleSlug: "listing-team",
    customRecipients: "",
    businessWeekdays: [1, 2, 3, 4, 5],
    holidayDates: "",
  });

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const next = await invokeAppApi<AdminData>("catalogProduction.handoffs.admin", {});
      setData(next);
      const source = next.settings || {};
      setSettings({
        enabled: source.enabled !== false,
        timezone: source.timezone || "Asia/Kolkata",
        sendLocalTime: String(source.send_local_time || "10:00").slice(0, 5),
        recipientMode: source.recipient_mode || "listing_team",
        recipientRoleSlug: source.recipient_role_slug || "listing-team",
        customRecipients: Array.isArray(source.custom_recipients) ? source.custom_recipients.join(", ") : "",
        businessWeekdays: Array.isArray(source.business_weekdays) ? source.business_weekdays.map(Number) : [1, 2, 3, 4, 5],
        holidayDates: Array.isArray(source.holiday_dates) ? source.holiday_dates.join("\n") : "",
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load(true);
    const channel = supabase.channel("catalog-handoff-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "catalog_report_deliveries" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "catalog_report_delivery_attempts" }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load]);

  const run = async (key: string, task: () => Promise<unknown>, message: string) => {
    setBusy(key); setError(""); setSuccess("");
    try { await task(); setSuccess(message); await load(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(""); }
  };

  const saveSettings = () => run("settings", () => invokeAppApi("catalogProduction.handoffs.updateSettings", {
    ...settings,
    customRecipients: settings.customRecipients.split(/[\n,;]/).map((entry) => entry.trim()).filter(Boolean),
    holidayDates: settings.holidayDates.split(/[\n,;]/).map((entry) => entry.trim()).filter(Boolean),
  }), "Handoff schedule and recipients saved.");

  const sendNow = () => {
    if (!data?.preview.rows.length || !window.confirm(`Send ${data.preview.rows.length} approved SKU package${data.preview.rows.length === 1 ? "" : "s"} now?`)) return;
    void run("send", () => invokeAppApi("catalogProduction.handoffs.send", {}), "Consolidated Listing Team handoff sent.");
  };

  const nextSendSummary = useMemo(() => `${settings.sendLocalTime} · ${settings.timezone} · ${settings.businessWeekdays.map((day) => weekdayLabels[day - 1]).join(", ")}`, [settings]);

  if (loading) return <div className="grid min-h-80 place-items-center"><span className="inline-flex items-center gap-3 text-sm font-semibold text-secondary"><Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading handoff administration…</span></div>;
  if (!data) return <div className="grid min-h-80 place-items-center rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm font-semibold text-red-700"><div><AlertCircle className="mx-auto mb-3 h-7 w-7" />{error || "Handoff administration is unavailable."}<button onClick={() => void load()} className="mx-auto mt-4 block rounded-lg bg-red-700 px-4 py-2 text-white">Retry</button></div></div>;

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      {(error || success) && <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}<span className="flex-1">{error || success}</span><button onClick={() => { setError(""); setSuccess(""); }}>{error ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}</button></div>}

      <section className="overflow-hidden rounded-2xl border border-outline-variant/35 bg-white shadow-sm">
        <div className="grid lg:grid-cols-[minmax(0,1.2fr)_430px]">
          <div className="bg-[#182033] p-6 text-white sm:p-7">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-pink-200"><MailCheck className="h-4 w-4" /> Approval handoff preview</div>
            <h3 className="mt-3 font-syne text-2xl font-bold">{data.preview.rows.length} approved SKU package{data.preview.rows.length === 1 ? "" : "s"} ready</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">Only final human approvals appear here. Empty digests are never sent, and every SKU handoff can enter a successful delivery only once.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-white/10 p-3"><p className="text-[10px] uppercase tracking-wide text-white/50">Business date</p><p className="mt-1 text-sm font-bold">{data.preview.reportDate}</p></div><div className="rounded-xl bg-white/10 p-3"><p className="text-[10px] uppercase tracking-wide text-white/50">Recipients</p><p className="mt-1 text-sm font-bold">{data.preview.recipients.length}</p></div><div className="rounded-xl bg-white/10 p-3"><p className="text-[10px] uppercase tracking-wide text-white/50">Next schedule</p><p className="mt-1 truncate text-sm font-bold">{nextSendSummary}</p></div></div>
            <button onClick={sendNow} disabled={!data.preview.rows.length || Boolean(busy)} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#182033] disabled:opacity-40">{busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send consolidated handoff now</button>
          </div>
          <div className="max-h-[410px] overflow-y-auto p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-secondary">Included SKUs</p>
            <div className="mt-3 space-y-2">{data.preview.rows.map((row) => <div key={row.handoffId} className="rounded-xl border border-outline-variant/30 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-on-surface">{row.skuCode} · {row.skuName}</p><p className="mt-1 truncate text-[11px] text-secondary">{row.batchName} · {row.campaign || "No campaign"}</p></div><span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">5 poses</span></div>{row.folderLink && <a href={row.folderLink} className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-primary">Open package <ExternalLink className="h-3 w-3" /></a>}</div>)}{!data.preview.rows.length && <div className="rounded-xl border-2 border-dashed border-outline-variant/40 py-12 text-center"><MailCheck className="mx-auto h-6 w-6 text-outline" /><p className="mt-2 text-sm font-semibold text-on-surface">Nothing waiting for handoff</p><p className="mt-1 text-xs text-secondary">The next final approval will appear here.</p></div>}</div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[480px_minmax(0,1fr)]">
        <form onSubmit={(event) => { event.preventDefault(); void saveSettings(); }} className="h-fit rounded-2xl border border-outline-variant/35 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-primary" /><h3 className="text-sm font-bold text-on-surface">Schedule and recipients</h3></div>
          <label className="mt-5 flex items-center justify-between rounded-xl bg-surface-container/45 p-3 text-sm font-semibold text-on-surface"><span><span className="block">Automatic daily handoff</span><span className="mt-0.5 block text-[10px] font-normal text-secondary">Runs only on configured business days</span></span><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} className="h-4 w-4 accent-primary" /></label>
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-secondary">Timezone<input value={settings.timezone} onChange={(event) => setSettings({ ...settings, timezone: event.target.value })} className="mt-1.5 h-10 w-full rounded-xl border border-outline-variant px-3 text-sm font-normal text-on-surface" /></label><label className="text-xs font-bold text-secondary">Send time<input type="time" value={settings.sendLocalTime} onChange={(event) => setSettings({ ...settings, sendLocalTime: event.target.value })} className="mt-1.5 h-10 w-full rounded-xl border border-outline-variant px-3 text-sm font-normal text-on-surface" /></label></div>
          <div className="mt-4"><p className="text-xs font-bold text-secondary">Business weekdays</p><div className="mt-2 flex flex-wrap gap-2">{weekdayLabels.map((label, index) => { const day = index + 1; const active = settings.businessWeekdays.includes(day); return <button key={label} type="button" onClick={() => setSettings({ ...settings, businessWeekdays: active ? settings.businessWeekdays.filter((value) => value !== day) : [...settings.businessWeekdays, day].sort() })} className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ${active ? "bg-primary text-white" : "bg-surface-container text-secondary"}`}>{label}</button>; })}</div></div>
          <label className="mt-4 block text-xs font-bold text-secondary">Recipient mode<select value={settings.recipientMode} onChange={(event) => setSettings({ ...settings, recipientMode: event.target.value })} className="mt-1.5 h-10 w-full rounded-xl border border-outline-variant px-3 text-sm font-normal text-on-surface"><option value="listing_team">Workspace group</option><option value="custom">Custom recipients</option><option value="listing_team_and_custom">Workspace group + custom</option></select></label>
          {settings.recipientMode !== "custom" && <label className="mt-4 block text-xs font-bold text-secondary">Recipient group<select value={settings.recipientRoleSlug} onChange={(event) => setSettings({ ...settings, recipientRoleSlug: event.target.value })} className="mt-1.5 h-10 w-full rounded-xl border border-outline-variant px-3 text-sm font-normal text-on-surface">{data.recipientGroups.map((group) => <option key={group.slug} value={group.slug}>{group.name}</option>)}</select><span className="mt-1 block text-[10px] font-normal text-secondary">Active members can opt out with their catalog handoff email preference.</span></label>}
          <label className="mt-4 block text-xs font-bold text-secondary">Custom recipients<textarea rows={2} value={settings.customRecipients} onChange={(event) => setSettings({ ...settings, customRecipients: event.target.value })} placeholder="listing@example.com, manager@example.com" className="mt-1.5 w-full rounded-xl border border-outline-variant px-3 py-2 text-sm font-normal text-on-surface" /></label>
          <label className="mt-4 block text-xs font-bold text-secondary">Holiday dates <span className="font-normal">(one YYYY-MM-DD per line)</span><textarea rows={3} value={settings.holidayDates} onChange={(event) => setSettings({ ...settings, holidayDates: event.target.value })} placeholder="2026-10-20" className="mt-1.5 w-full rounded-xl border border-outline-variant px-3 py-2 font-mono text-xs font-normal text-on-surface" /></label>
          <button disabled={Boolean(busy)} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">{busy === "settings" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save handoff settings</button>
        </form>

        <div className="rounded-2xl border border-outline-variant/35 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Delivery history</p><h3 className="mt-1 text-base font-bold text-on-surface">Email status, attempts and errors</h3></div><button onClick={() => void load(true)} disabled={Boolean(busy)} className="rounded-lg p-2 text-secondary hover:bg-surface-container" aria-label="Refresh delivery history"><RefreshCw className="h-4 w-4" /></button></div>
          <div className="mt-4 space-y-2.5">{data.deliveries.map((delivery) => { const open = expandedDelivery === delivery.id; return <article key={delivery.id} className="overflow-hidden rounded-xl border border-outline-variant/30"><button onClick={() => setExpandedDelivery(open ? "" : delivery.id)} className="flex w-full items-center gap-3 p-3 text-left"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 ${statusTone(delivery.status)}`}>{delivery.status === "sent" ? <MailCheck className="h-4 w-4" /> : delivery.status === "failed" ? <AlertCircle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-on-surface">{delivery.subject || `Catalog handoff ${delivery.report_date}`}</p><p className="mt-1 text-[10px] text-secondary">{delivery.itemCount} SKU · {delivery.attempt_count} attempt{delivery.attempt_count === 1 ? "" : "s"} · {dateTime(delivery.sent_at || delivery.created_at)}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold capitalize ring-1 ${statusTone(delivery.status)}`}>{delivery.status}</span><ChevronDown className={`h-4 w-4 text-secondary transition ${open ? "rotate-180" : ""}`} /></button>{open && <div className="border-t border-outline-variant/25 bg-surface-container/25 p-3"><div className="grid gap-2 text-[11px] sm:grid-cols-3"><p><span className="text-secondary">Recipients</span><br /><strong>{(delivery.recipients || []).join(", ") || "None"}</strong></p><p><span className="text-secondary">Provider ID</span><br /><strong>{delivery.provider_message_id || "—"}</strong></p><p><span className="text-secondary">Next retry</span><br /><strong>{dateTime(delivery.next_retry_at)}</strong></p></div>{delivery.error_message && <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{delivery.error_message}</p>}<div className="mt-3 space-y-1.5">{delivery.attempts.map((attempt: any) => <div key={attempt.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-[10px]"><span className="font-bold">Attempt {attempt.attempt_number} · {attempt.trigger_type}</span><span className="capitalize text-secondary">{attempt.status}</span><span className="text-secondary">{dateTime(attempt.completed_at || attempt.started_at)}</span></div>)}</div><button onClick={() => { if (window.confirm("Resend this exact delivery and record a new attempt?")) void run(`resend:${delivery.id}`, () => invokeAppApi("catalogProduction.handoffs.send", { deliveryId: delivery.id }), "Delivery resent and attempt recorded."); }} disabled={Boolean(busy)} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-primary px-3 py-2 text-xs font-bold text-primary disabled:opacity-40">{busy === `resend:${delivery.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Resend</button></div>}</article>; })}{!data.deliveries.length && <div className="rounded-xl border-2 border-dashed border-outline-variant/40 py-12 text-center"><CalendarDays className="mx-auto h-6 w-6 text-outline" /><p className="mt-2 text-sm text-secondary">No delivery attempts yet.</p></div>}</div>
        </div>
      </section>
    </div>
  );
}
