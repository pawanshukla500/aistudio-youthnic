import { Link } from "react-router-dom";
import { Activity, AlertTriangle, CalendarClock, CalendarRange, CheckCircle, Clock3, History, Image as ImageIcon, Loader2, XCircle } from "lucide-react";
import { useSupabaseDashboardSummary } from "../../lib/useSupabaseDashboard";

function relativeTime(timestamp: number) {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const statusStyle: Record<string, { className: string; icon: typeof CheckCircle }> = {
  completed: { className: "bg-success-surface text-success", icon: CheckCircle },
  failed: { className: "bg-danger-surface text-danger", icon: XCircle },
  processing: { className: "bg-info-surface text-info", icon: Loader2 },
  queued: { className: "bg-warning-surface text-warning", icon: Clock3 },
};

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-IN", { notation: value >= 1000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

type AnalyticsDay = { date: string; label: string; generations: number; tokens: number; costUsd: number };

function BarChart({ data, field, color, format = compactNumber }: { data: AnalyticsDay[]; field: "generations" | "tokens" | "costUsd"; color: string; format?: (value: number) => string }) {
  const max = Math.max(1, ...data.map((item) => Number(item[field] || 0)));
  return (
    <div className="mt-5">
      <div className="grid h-40 grid-cols-[repeat(14,minmax(0,1fr))] items-end gap-1.5" role="img" aria-label={`Last 14 days ${field} chart`}>
        {data.map((item) => {
          const value = Number(item[field] || 0);
          return <div key={item.date} className="group relative flex h-full items-end"><div title={`${item.label}: ${format(value)}`} className="w-full min-w-0 rounded-t-md transition-all group-hover:opacity-80" style={{ height: `${Math.max(value ? 6 : 2, (value / max) * 100)}%`, backgroundColor: color }} /><span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-on-surface px-2 py-1 text-[9px] font-bold text-white group-hover:block">{format(value)}</span></div>;
        })}
      </div>
      <div className="mt-2 grid grid-cols-7 text-center text-[9px] text-secondary">{data.filter((_, index) => index % 2 === 0).map((item) => <span key={item.date}>{item.label}</span>)}</div>
    </div>
  );
}

export function Dashboard() {
  const { summary, error } = useSupabaseDashboardSummary();

  if (error) return <div className="grid min-h-[50vh] place-items-center px-6 text-center text-sm font-semibold text-danger">{error}</div>;
  if (!summary) return <div className="grid min-h-[50vh] place-items-center text-sm font-semibold text-secondary">Loading live operations…</div>;
  const current = summary.jobs.current;
  const progress = current ? Math.round((((current.completedPoses ?? 0) + (current.failedPoses ?? 0)) / Math.max(1, current.totalPoses ?? 0)) * 100) : 0;

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
        <p className="mb-1 text-[11px] font-label-caps uppercase tracking-widest text-secondary">Operations summary</p>
        <h2 className="text-display-md text-on-surface">Dashboard</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">Live generation health, output volume, token telemetry, and authoritative organization cost in one view.</p>
        </div>
        <span className="w-fit rounded-full border border-outline-variant/50 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-secondary">14-day window</span>
      </div>

      <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {[{ label: "Generations", value: compactNumber(summary.analytics.totals.generations), detail: "Jobs started" }, { label: "Provider tokens", value: compactNumber(summary.analytics.totals.tokens), detail: "Reported by image responses" }, { label: "Generation cost", value: `$${summary.analytics.totals.costUsd.toFixed(4)}`, detail: summary.analytics.costSource === "openai_admin" ? "OpenAI Admin API actual" : "Provider-response actual" }].map((metric) => <div key={metric.label} className="rounded-2xl border border-outline-variant/40 bg-white p-5 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">{metric.label}</p><p className="mt-2 font-syne text-2xl font-bold text-on-surface">{metric.value}</p><p className="mt-1 text-xs text-secondary">{metric.detail}</p></div>)}
        </div>
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="rounded-2xl border border-outline-variant/40 bg-white p-5 shadow-sm xl:col-span-2"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-wider text-secondary">Generation volume</p><h3 className="mt-1 font-syne text-lg font-bold">Last 14 days</h3></div><span className="text-xs font-semibold text-primary">{summary.analytics.totals.generations} total</span></div><BarChart data={summary.analytics.days} field="generations" color="#b00055" /></div>
          <div className="rounded-2xl border border-outline-variant/40 bg-white p-5 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-wider text-secondary">Generation types</p><h3 className="mt-1 font-syne text-lg font-bold">Studio vs catalog</h3><div className="mt-8 space-y-5">{summary.analytics.types.map((type, index) => { const total = Math.max(1, summary.analytics.totals.generations); const percent = Math.round((type.value / total) * 100); return <div key={type.label}><div className="mb-2 flex items-center justify-between text-xs"><span className="font-bold text-on-surface">{type.label}</span><span className="text-secondary">{type.value} · {percent}%</span></div><div className="h-2 rounded-full bg-surface-container-high"><div className="h-2 rounded-full" style={{ width: `${percent}%`, backgroundColor: index ? "#76556a" : "#b00055" }} /></div></div>; })}</div></div>
          <div className="rounded-2xl border border-outline-variant/40 bg-white p-5 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-wider text-secondary">Token usage</p><h3 className="mt-1 font-syne text-lg font-bold">Provider-reported</h3><BarChart data={summary.analytics.days} field="tokens" color="#73556a" /></div>
          <div className="rounded-2xl border border-outline-variant/40 bg-white p-5 shadow-sm xl:col-span-2"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-wider text-secondary">Generation cost</p><h3 className="mt-1 font-syne text-lg font-bold">Daily USD</h3></div><span className="text-xs text-secondary">{summary.analytics.costSource === "openai_admin" ? "Organization Costs API" : "Generation responses"}</span></div><BarChart data={summary.analytics.days} field="costUsd" color="#0b8077" format={(value) => `$${value.toFixed(3)}`} /></div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-6 shadow-sm">
          <div className="mb-6 flex items-start justify-between">
            <div><span className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-info">Generating now</span><h3 className="font-mono text-lg font-medium text-on-surface">{current?.skuId || "Queue is clear"}</h3></div>
            <Activity className="h-6 w-6 text-secondary" />
          </div>
          {current ? <><div className="mb-2 flex items-end justify-between"><span className="text-[13px] font-semibold text-secondary">Pose generation</span><span className="text-[15px] font-bold text-on-surface">{(current.completedPoses ?? 0) + (current.failedPoses ?? 0)} of {current.totalPoses ?? 0}</span></div><div className="h-1.5 w-full rounded-full bg-surface-container-high"><div className="h-1.5 rounded-full bg-info transition-all" style={{ width: `${progress}%` }} /></div></> : <p className="text-sm text-secondary">New Studio jobs will appear here in real time.</p>}
        </div>
        <div className={`rounded-xl border p-6 ${summary.planning.active ? "border-info/20 bg-info-surface" : "border-success/20 bg-success-surface"}`}>
          <div className="flex gap-4"><div className="grid h-10 w-10 place-items-center rounded-full bg-white/60"><AlertTriangle className={`h-5 w-5 ${summary.planning.active ? "text-info" : "text-success"}`} /></div><div><h3 className="font-syne text-lg font-bold text-on-surface">{summary.planning.active ? `${summary.planning.active} catalog${summary.planning.active === 1 ? "" : "s"} generating` : "No catalogs generating"}</h3><p className="mt-1 text-sm text-secondary">{summary.planning.active ? "Colourways are generating in the background." : `${summary.planning.drafts} draft${summary.planning.drafts === 1 ? "" : "s"} waiting to schedule.`}</p></div></div>
          <div className="mt-6 flex justify-end"><Link to="/planning" className="rounded-lg border border-outline-variant bg-white px-4 py-2 text-[13px] font-semibold text-secondary">Open Planning</Link></div>
        </div>
      </div>

      <section>
        <h3 className="mb-4 text-[11px] font-label-caps uppercase tracking-widest text-secondary">Catalog snapshot</h3>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-outline-variant/50 bg-outline-variant/30 shadow-sm sm:grid-cols-5">
          {[['Catalogs', summary.planning.catalogs, 'text-on-surface'], ['Active', summary.planning.active, 'text-info'], ['Colourways', summary.planning.colourways, 'text-on-surface'], ['Completed', summary.planning.completed, 'text-success'], ['Failed', summary.planning.failed, 'text-danger']].map(([label, value, color]) => <div key={String(label)} className="bg-white p-5"><span className="block text-[12px] font-semibold text-secondary">{label}</span><span className={`mt-1 block font-syne text-2xl font-bold ${color}`}>{value}</span></div>)}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="lg:col-span-8">
          <div className="mb-4 flex items-end justify-between"><h3 className="text-[11px] font-label-caps uppercase tracking-widest text-secondary">Generation activity</h3><Link to="/history" className="text-[13px] font-semibold text-tertiary hover:underline">View history</Link></div>
          <div className="overflow-hidden rounded-xl border border-outline-variant/50 bg-white shadow-sm">
            {summary.jobs.recent.length ? summary.jobs.recent.map((job) => { const style = statusStyle[job.status] || statusStyle.queued; const Icon = style.icon; return <div key={job._id} className="grid grid-cols-12 items-center gap-4 border-b border-outline-variant/30 p-4 last:border-0"><div className="col-span-4 sm:col-span-3"><span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${style.className}`}><Icon className={`h-3.5 w-3.5 ${job.status === 'processing' ? 'animate-spin' : ''}`} />{job.status}</span></div><div className="col-span-5"><div className="font-mono text-[12px] font-medium text-on-surface">{job.skuId}</div><div className="mt-0.5 text-[11px] text-secondary">{job.skuName || `${job.totalPoses} pose set`}</div></div><div className="col-span-3 text-right text-[12px] text-secondary">{relativeTime(job.createdAt)}</div></div> }) : <div className="p-8 text-center text-sm text-secondary">No generation jobs yet. Start the first one in Studio.</div>}
          </div>
        </section>

        <section className="lg:col-span-4">
          <h3 className="mb-4 text-[11px] font-label-caps uppercase tracking-widest text-secondary">Quick actions</h3>
          <div className="grid grid-cols-2 gap-4">
            {[["/planning", CalendarRange, "Open planning"], ["/studio", ImageIcon, "New generation"], ["/history", History, "History"], ["/events", CalendarClock, "Events"]].map(([to, Icon, label]) => <Link key={String(to)} to={String(to)} className="group flex min-h-28 flex-col items-center justify-center gap-3 rounded-xl border border-outline-variant/50 bg-white p-4 text-center transition hover:-translate-y-px hover:bg-surface-container"><Icon className="h-6 w-6 text-secondary group-hover:text-primary" /><span className="text-[13px] font-semibold text-on-surface">{String(label)}</span></Link>)}
          </div>
        </section>
      </div>
    </div>
  );
}
