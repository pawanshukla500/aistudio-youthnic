import { useMemo, useState } from "react";
import { api, useAction, useMutation, useQuery } from "../../lib/backend";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  Clock3,
  Loader2,
  MapPin,
  Mail,
  Plus,
  RefreshCcw,
  Search,
  Sparkles,
  Store,
  Wand2,
  X,
} from "lucide-react";
import { useWorkspace } from "../../lib/WorkspaceContext";
import { getErrorMessage } from "../../lib/errors";

type RoadmapEvent = Record<string, any> & {
  _id: string; name: string; type: string; date: number; prepDeadline: number; daysUntil: number; prepDaysLeft: number;
  campaignSeason?: string; description?: string; marketplace?: string; region?: string; confidence?: number; confirmed?: boolean;
  source?: string; priority?: string; themes?: string[]; colorPalette?: string[]; mood?: string; brief?: string;
  states?: string[]; marketplaces?: string[]; verificationStatus?: string; sourceUrls?: string[];
};
type Roadmap = { events: RoadmapEvent[]; capabilities: { canManage: boolean }; lastRun: any | null };
type Busy = "research" | "seed" | "digest" | null;

const DAY = 86_400_000;
const dateFmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

function priorityBadge(priority?: string) {
  if (priority === "urgent") return "bg-danger-surface text-danger";
  if (priority === "high") return "bg-warning-surface text-warning";
  return "bg-surface-container-high text-secondary";
}

function relativeTime(timestamp: number) {
  const days = Math.round((Date.now() - timestamp) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function planHref(event: RoadmapEvent) {
  const season = encodeURIComponent(event.campaignSeason || event.name);
  return `/planning?season=${season}&eventId=${event._id}&date=${event.prepDeadline}&openBulk=1`;
}

function EventCard({ event }: { event: RoadmapEvent }) {
  const prepOverdue = event.prepDaysLeft <= 0;
  const prepSoon = event.prepDaysLeft > 0 && event.prepDaysLeft <= 14;
  return (
    <article className="flex flex-col rounded-xl border border-outline-variant/40 bg-white p-5 shadow-sm transition hover:-translate-y-px hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-soft-blush text-primary">
          <CalendarDays className="h-5 w-5" />
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="rounded-full bg-info-surface px-2 py-1 text-[10px] font-bold uppercase text-info">
            {event.daysUntil <= 0 ? "today" : `${event.daysUntil} days`}
          </span>
          {event.priority && (
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${priorityBadge(event.priority)}`}>
              {event.priority}
            </span>
          )}
        </div>
      </div>

      <h4 className="mt-4 font-syne text-lg font-bold leading-tight text-on-surface">{event.name}</h4>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-secondary">
        {event.campaignSeason || event.type.replace(/_/g, " ")}
      </p>
      {event.description && (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-secondary">{event.description}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {event.marketplace && (
          <span className="inline-flex items-center gap-1 rounded-md bg-surface-container-low px-2 py-1 text-[10px] font-semibold text-secondary">
            <Store className="h-3 w-3" /> {event.marketplace}
          </span>
        )}
        {event.region && (
          <span className="inline-flex items-center gap-1 rounded-md bg-surface-container-low px-2 py-1 text-[10px] font-semibold text-secondary">
            <MapPin className="h-3 w-3" /> {event.region}
          </span>
        )}
        {typeof event.confidence === "number" && (
          <span className="inline-flex items-center rounded-md bg-surface-container-low px-2 py-1 text-[10px] font-semibold text-secondary">
            {Math.round(event.confidence * 100)}% conf.
          </span>
        )}
        {event.confirmed === true ? (
          <span className="inline-flex items-center rounded-md bg-success-surface px-2 py-1 text-[10px] font-semibold text-success">confirmed</span>
        ) : event.source === "gemini" ? (
          <span className="inline-flex items-center rounded-md bg-surface-container-low px-2 py-1 text-[10px] font-semibold text-secondary">estimated</span>
        ) : null}
        {event.sourceUrls?.[0] && <a href={event.sourceUrls[0]} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md bg-surface-container-low px-2 py-1 text-[10px] font-semibold text-primary hover:underline">Source</a>}
      </div>

      {event.themes && event.themes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {event.themes.slice(0, 4).map((theme) => (
            <span key={theme} className="rounded-full bg-soft-blush px-2 py-0.5 text-[9px] font-semibold text-primary">{theme}</span>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-2 border-t border-outline-variant/30 pt-4 text-[12px]">
        <div className="flex justify-between">
          <span className="text-secondary">Event date</span>
          <span className="font-semibold text-on-surface">{dateFmt.format(event.date)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-secondary">Prep deadline</span>
          <span className={`font-semibold ${prepOverdue ? "text-danger" : prepSoon ? "text-warning" : "text-on-surface"}`}>
            {dateFmt.format(event.prepDeadline)}
            {prepOverdue ? " · overdue" : prepSoon ? ` · ${event.prepDaysLeft}d left` : ""}
          </span>
        </div>
      </div>

      <Link
        to={planHref(event)}
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs font-bold text-primary transition hover:bg-primary/20"
      >
        <Sparkles className="h-3.5 w-3.5" /> Plan catalog
      </Link>
    </article>
  );
}

export function Events() {
  const { organization } = useWorkspace();
  const data = useQuery(api.eventIntelligence.roadmap, { organizationId: organization._id }) as Roadmap | undefined;
  const createEvent = useMutation(api.events.create);
  const runResearch = useAction(api.eventIntelligence.runResearch);
  const seedCalendar = useMutation(api.eventIntelligence.seedCalendar);
  const sendDigestNow = useAction(api.eventDigest.sendDigestNow);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [marketFilter, setMarketFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({ name: "", type: "festival", date: "", planningLeadDays: 21 });

  const events = useMemo(() => data?.events ?? [], [data]);
  const canManage = data?.capabilities.canManage ?? false;
  const lastRun = data?.lastRun ?? null;
  const availableStates = useMemo(() => [...new Set(events.flatMap((event) => event.states || []))].sort(), [events]);

  const filtered = useMemo(
    () =>
      events.filter((event) => {
        const matchesText = `${event.name} ${event.type} ${event.marketplace ?? ""} ${event.region ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchesType = !typeFilter || event.type === typeFilter;
        const matchesMarket = !marketFilter || event.marketplace === marketFilter || (event.marketplaces || []).includes(marketFilter);
        const matchesState = !stateFilter || (event.states || []).includes(stateFilter) || (event.states || []).includes("Pan-India");
        return matchesText && matchesType && matchesMarket && matchesState;
      }),
    [events, search, typeFilter, marketFilter, stateFilter],
  );
  const upcoming = filtered.filter((event) => event.daysUntil >= 0);
  const prepDue = upcoming.filter((event) => event.prepDaysLeft <= 14);
  const past = filtered.filter((event) => event.daysUntil < 0).reverse();

  const withGuard = async (kind: Busy, run: () => Promise<string>) => {
    setBusy(kind);
    setNotice(null);
    try {
      setNotice({ tone: "success", text: await run() });
    } catch (reason) {
      setNotice({ tone: "error", text: getErrorMessage(reason, "Action failed.") });
    } finally {
      setBusy(null);
    }
  };

  const handleResearch = () =>
    withGuard("research", async () => {
      const result = await runResearch({ organizationId: organization._id });
      return `Research complete — ${result.created} new and ${result.updated} updated events.`;
    });

  const handleSeed = () =>
    withGuard("seed", async () => {
      const result = await seedCalendar({ organizationId: organization._id });
      return result.created
        ? `Seeded ${result.created} baseline events.`
        : "Calendar already seeded — nothing to add.";
    });

  const handleDigest = () =>
    withGuard("digest", async () => {
      const result = await sendDigestNow({ organizationId: organization._id });
      if (!result.sent) throw new Error(result.error || "Digest could not be sent.");
      return `Digest emailed to ${result.recipients.length} recipient${result.recipients.length === 1 ? "" : "s"}.`;
    });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await createEvent({
        organizationId: organization._id,
        name: form.name.trim(),
        type: form.type,
        date: new Date(`${form.date}T12:00:00`).getTime(),
        planningLeadDays: Number(form.planningLeadDays),
      });
      setShowCreate(false);
      setForm({ name: "", type: "festival", date: "", planningLeadDays: 21 });
      setNotice({ tone: "success", text: "Event added to the roadmap." });
    } catch (reason) {
      setNotice({ tone: "error", text: getErrorMessage(reason, "Could not add event.") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-8">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="mb-1 text-[11px] font-label-caps uppercase tracking-widest text-secondary">Campaign intelligence</p>
          <h2 className="text-display-md text-on-surface">Events roadmap</h2>
          <p className="mt-1 text-sm text-secondary">
            Plan catalog work backward from festivals and marketplace sale windows.
            {lastRun && (
              <span className="ml-1">
                Last researched {relativeTime(lastRun.startedAt)}
                {lastRun.status === "failed" ? " (failed)" : lastRun.status === "running" ? " (running…)" : ""}.
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search events…"
              className="h-10 rounded-lg border border-outline-variant bg-white pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="h-10 rounded-lg border border-outline-variant bg-white px-3 text-sm outline-none focus:border-primary"
          >
            <option value="">All types</option>
            <option value="festival">Festival</option>
            <option value="marketplace_sale">Marketplace sale</option>
            <option value="seasonal">Seasonal</option>
            <option value="shopping">Shopping</option>
            <option value="launch">Launch</option>
          </select>
          <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} className="h-10 max-w-48 rounded-lg border border-outline-variant bg-white px-3 text-sm outline-none focus:border-primary">
            <option value="">All states</option>
            {availableStates.map((state) => <option key={state} value={state}>{state}</option>)}
          </select>
          <select
            value={marketFilter}
            onChange={(event) => setMarketFilter(event.target.value)}
            className="h-10 rounded-lg border border-outline-variant bg-white px-3 text-sm outline-none focus:border-primary"
          >
            <option value="">All marketplaces</option>
            <option value="Myntra">Myntra</option>
            <option value="Amazon">Amazon</option>
            <option value="Flipkart">Flipkart</option>
            <option value="All">All / multi</option>
          </select>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> Add event
          </button>
        </div>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
          <span className="mr-1 text-[11px] font-bold uppercase tracking-widest text-secondary">Intelligence</span>
          <button
            onClick={handleResearch}
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs font-bold text-primary transition hover:bg-primary/20 disabled:opacity-50"
          >
            {busy === "research" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Refresh research (Gemini)
          </button>
          <button
            onClick={handleSeed}
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-lg border border-outline-variant px-3 py-2 text-xs font-bold text-secondary transition hover:bg-surface-container disabled:opacity-50"
          >
            {busy === "seed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
            Seed calendar
          </button>
          <button
            onClick={handleDigest}
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-lg border border-outline-variant px-3 py-2 text-xs font-bold text-secondary transition hover:bg-surface-container disabled:opacity-50"
          >
            {busy === "digest" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
            Send digest now
          </button>
        </div>
      )}

      {notice && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-sm ${notice.tone === "success" ? "border-success/20 bg-success-surface text-success" : "border-danger/20 bg-danger-surface text-danger"}`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {prepDue.length > 0 && (
        <section>
          <h3 className="mb-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-warning">
            <AlertTriangle className="h-4 w-4" /> Prep due within two weeks
          </h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {prepDue.map((event) => (
              <EventCard key={event._id} event={event} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-4 text-[11px] font-bold uppercase tracking-widest text-secondary">Upcoming milestones</h3>
        {data === undefined ? (
          <div className="rounded-xl border border-outline-variant/30 bg-white p-10 text-center text-sm text-secondary">
            Loading roadmap…
          </div>
        ) : upcoming.length ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((event) => (
              <EventCard key={event._id} event={event} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-outline-variant/50 bg-white p-10 text-center text-sm text-secondary">
            No upcoming events.{" "}
            {canManage ? "Run research or seed the calendar to populate the roadmap." : "Ask a planning manager to run event research."}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <h3 className="mb-4 text-[11px] font-bold uppercase tracking-widest text-secondary">Past events</h3>
          <div className="divide-y divide-outline-variant/30 overflow-hidden rounded-xl border border-outline-variant/30 bg-white">
            {past.slice(0, 12).map((event) => (
              <div key={event._id} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <Clock3 className="h-4 w-4 text-secondary" />
                  <div>
                    <p className="text-sm font-semibold text-on-surface">{event.name}</p>
                    <p className="text-[11px] uppercase text-secondary">{event.type.replace(/_/g, " ")}</p>
                  </div>
                </div>
                <span className="text-xs text-secondary">{dateFmt.format(event.date)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-soft/45 p-4">
          <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-primary">Campaign calendar</p>
                <h3 className="font-syne text-xl font-bold">Add event</h3>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} className="rounded p-2 text-secondary hover:bg-surface-container">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <label className="block text-sm font-semibold text-secondary">
                Event name
                <input
                  required
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="mt-1.5 h-10 w-full rounded-lg border border-outline-variant px-3 text-on-surface outline-none focus:border-primary"
                />
              </label>
              <label className="block text-sm font-semibold text-secondary">
                Type
                <select
                  value={form.type}
                  onChange={(event) => setForm({ ...form, type: event.target.value })}
                  className="mt-1.5 h-10 w-full rounded-lg border border-outline-variant px-3 text-on-surface"
                >
                  <option value="festival">Festival</option>
                  <option value="marketplace_sale">Marketplace sale</option>
                  <option value="seasonal">Seasonal</option>
                  <option value="launch">Product launch</option>
                </select>
              </label>
              <label className="block text-sm font-semibold text-secondary">
                Event date
                <input
                  required
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm({ ...form, date: event.target.value })}
                  className="mt-1.5 h-10 w-full rounded-lg border border-outline-variant px-3 text-on-surface"
                />
              </label>
              <label className="block text-sm font-semibold text-secondary">
                Planning lead days
                <input
                  required
                  min={1}
                  max={365}
                  type="number"
                  value={form.planningLeadDays}
                  onChange={(event) => setForm({ ...form, planningLeadDays: Number(event.target.value) })}
                  className="mt-1.5 h-10 w-full rounded-lg border border-outline-variant px-3 text-on-surface"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold">
                Cancel
              </button>
              <button disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {saving ? "Saving…" : "Add event"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
