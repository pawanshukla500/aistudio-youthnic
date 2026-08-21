import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { saveAs } from "file-saver";
import {
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  Flame,
  LayoutGrid,
  Loader2,
  Mail,
  MapPin,
  Plus,
  RefreshCcw,
  Rows3,
  Search,
  Send,
  Sparkles,
  Store,
  Table2,
  Wand2,
  X,
} from "lucide-react";
import { api, useAction, useMutation, useQuery } from "../../lib/backend";
import { useWorkspace } from "../../lib/WorkspaceContext";
import { getErrorMessage } from "../../lib/errors";

type RoadmapEvent = Record<string, any> & {
  _id: string; name: string; type: string; date: number; endDate?: number; prepDeadline: number; daysUntil: number; prepDaysLeft: number;
  startDateIso?: string; endDateIso?: string; prepDeadlineIso?: string;
  campaignSeason?: string; description?: string; marketplace?: string; region?: string; confidence?: number; confirmed?: boolean;
  source?: string; sourceDetail?: string; priority?: string; themes?: string[]; colorPalette?: string[]; mood?: string; brief?: string;
  states?: string[]; marketplaces?: string[]; recommendedCategories?: string[]; stylingProps?: string[];
  verificationStatus?: string; sourceUrls?: string[]; planningWindow?: string; planningLeadDays?: number;
};
type Roadmap = { events: RoadmapEvent[]; capabilities: { canManage: boolean }; lastRun: any | null };
type Busy = "research" | "seed" | "email" | "export" | null;
type View = "timeline" | "grid" | "table";

const DAY = 86_400_000;
const dateFmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });
const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit" });
const shortMonthFmt = new Intl.DateTimeFormat("en-IN", { month: "short" });
const weekdayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short" });
const weekdayLongFmt = new Intl.DateTimeFormat("en-IN", { weekday: "long" });
const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });

const HORIZONS = [
  { value: "30", label: "Next 30 days", days: 30 },
  { value: "60", label: "Next 60 days", days: 60 },
  { value: "90", label: "Next 90 days", days: 90 },
  { value: "180", label: "Next 6 months", days: 180 },
  { value: "365", label: "Next 12 months", days: 365 },
  { value: "all", label: "All upcoming", days: 0 },
  { value: "past", label: "Past events", days: -1 },
];

const TYPE_OPTIONS = [
  { value: "festival", label: "Festival" },
  { value: "marketplace_sale", label: "Marketplace sale" },
  { value: "seasonal", label: "Seasonal" },
  { value: "shopping", label: "Shopping" },
  { value: "launch", label: "Launch" },
];

const inputClass = "h-10 rounded-lg border border-outline-variant bg-white px-3 text-sm text-on-surface outline-none transition focus:border-primary";

function priorityBadge(priority?: string) {
  if (priority === "urgent") return "bg-danger-surface text-danger";
  if (priority === "high") return "bg-warning-surface text-warning";
  return "bg-surface-container-high text-secondary";
}

function prepTone(prepDaysLeft: number) {
  if (prepDaysLeft < 0) return "bg-danger-surface text-danger";
  if (prepDaysLeft <= 14) return "bg-warning-surface text-warning";
  return "bg-success-surface text-success";
}

function prepStatusLabel(prepDaysLeft: number) {
  if (prepDaysLeft < 0) return "Overdue";
  if (prepDaysLeft <= 14) return "Due now";
  return "On track";
}

function typeLabel(type: string) {
  return type.replace(/_/g, " ");
}

function relativeTime(timestamp: number) {
  const days = Math.round((Date.now() - timestamp) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function countdownLabel(daysUntil: number) {
  if (daysUntil < 0) return `${Math.abs(daysUntil)}d ago`;
  if (daysUntil === 0) return "today";
  if (daysUntil === 1) return "tomorrow";
  return `in ${daysUntil} days`;
}

function isoDate(event: RoadmapEvent, field: "start" | "end" | "prep") {
  const direct = field === "start" ? event.startDateIso : field === "end" ? event.endDateIso : event.prepDeadlineIso;
  if (direct) return direct;
  const timestamp = field === "start" ? event.date : field === "end" ? event.endDate || event.date : event.prepDeadline;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function monthKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 7);
}

function dateRangeLabel(event: RoadmapEvent) {
  const start = dateFmt.format(event.date);
  const end = event.endDate && event.endDate > event.date ? dateFmt.format(event.endDate) : "";
  return end ? `${start} → ${end}` : start;
}

function planHref(event: RoadmapEvent) {
  const season = encodeURIComponent(event.campaignSeason || event.name);
  return `/planning?season=${season}&eventId=${event._id}&date=${event.prepDeadline}&openBulk=1`;
}

// One row shape feeds the workbook sheets and mirrors the server-side report so
// a downloaded plan and an emailed plan always match.
function planningRow(event: RoadmapEvent, index: number) {
  return {
    index: index + 1,
    startDate: isoDate(event, "start"),
    dayLabel: weekdayLongFmt.format(event.date),
    endDate: isoDate(event, "end"),
    daysUntil: event.daysUntil,
    name: event.name,
    categoryLabel: typeLabel(event.type),
    priority: event.priority || "normal",
    prepDeadline: isoDate(event, "prep"),
    prepDaysLeft: event.prepDaysLeft,
    prepStatus: prepStatusLabel(event.prepDaysLeft),
    states: (event.states || []).join(", ") || "Pan-India",
    marketplaces: (event.marketplaces || []).join(", ") || "All",
    categories: (event.recommendedCategories || []).join(", "),
    themes: (event.themes || []).join(", "),
    palette: (event.colorPalette || []).join(", "),
    confidence: Math.round((event.confidence || 0) * 100),
    verification: event.verificationStatus || "estimated",
    source: event.source || "",
    description: event.description || "",
  };
}

async function buildWorkbook(organizationName: string, events: RoadmapEvent[]) {
  // Loaded on demand so the spreadsheet writer stays out of the initial bundle.
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Youthnic AI Studio";
  workbook.created = new Date();

  const calendar = workbook.addWorksheet("Planning calendar", { views: [{ state: "frozen", ySplit: 1 }] });
  calendar.columns = [
    { header: "#", key: "index", width: 5 },
    { header: "Event date", key: "startDate", width: 13 },
    { header: "Day", key: "dayLabel", width: 11 },
    { header: "Window ends", key: "endDate", width: 13 },
    { header: "Days until", key: "daysUntil", width: 11 },
    { header: "Event", key: "name", width: 34 },
    { header: "Type", key: "categoryLabel", width: 18 },
    { header: "Priority", key: "priority", width: 10 },
    { header: "Prep deadline", key: "prepDeadline", width: 14 },
    { header: "Prep days left", key: "prepDaysLeft", width: 14 },
    { header: "Prep status", key: "prepStatus", width: 12 },
    { header: "States / region", key: "states", width: 30 },
    { header: "Marketplaces", key: "marketplaces", width: 20 },
    { header: "Product focus", key: "categories", width: 28 },
    { header: "Visual themes", key: "themes", width: 30 },
    { header: "Colour palette", key: "palette", width: 26 },
    { header: "Confidence %", key: "confidence", width: 13 },
    { header: "Verification", key: "verification", width: 13 },
    { header: "Source", key: "source", width: 20 },
    { header: "Notes", key: "description", width: 60 },
  ];
  events.forEach((event, index) => calendar.addRow(planningRow(event, index)));

  const summary = workbook.addWorksheet("Month summary", { views: [{ state: "frozen", ySplit: 1 }] });
  summary.columns = [
    { header: "Month", key: "month", width: 20 },
    { header: "Events", key: "events", width: 10 },
    { header: "Festivals", key: "festivals", width: 11 },
    { header: "Marketplace sales", key: "marketplace", width: 18 },
    { header: "Urgent", key: "urgent", width: 9 },
    { header: "Prep due in window", key: "prepDue", width: 19 },
    { header: "First prep deadline", key: "firstPrep", width: 19 },
  ];
  for (const key of [...new Set(events.map((event) => monthKey(event.date)))]) {
    const monthEvents = events.filter((event) => monthKey(event.date) === key);
    summary.addRow({
      month: monthFmt.format(monthEvents[0].date),
      events: monthEvents.length,
      festivals: monthEvents.filter((event) => event.type === "festival").length,
      marketplace: monthEvents.filter((event) => event.type === "marketplace_sale").length,
      urgent: monthEvents.filter((event) => event.priority === "urgent").length,
      prepDue: monthEvents.filter((event) => event.prepDaysLeft <= 14).length,
      firstPrep: monthEvents.map((event) => isoDate(event, "prep")).sort()[0] || "",
    });
  }

  for (const sheet of [calendar, summary]) {
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF970046" } };
    header.alignment = { vertical: "middle", horizontal: "left" };
    header.height = 22;
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.alignment = { vertical: "top", wrapText: true };
      if (rowNumber % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBF1F5" } };
    });
  }
  calendar.getColumn("priority").eachCell((cell, rowNumber) => {
    if (rowNumber === 1) return;
    const value = String(cell.value || "");
    cell.font = { bold: value === "urgent", color: { argb: value === "urgent" ? "FFDC2626" : value === "high" ? "FFD97706" : "FF575F69" } };
  });
  calendar.getColumn("prepStatus").eachCell((cell, rowNumber) => {
    if (rowNumber === 1) return;
    const value = String(cell.value || "");
    cell.font = { bold: value !== "On track", color: { argb: value === "Overdue" ? "FFDC2626" : value === "Due now" ? "FFD97706" : "FF0F766E" } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const slug = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "youthnic";
  return {
    blob: new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename: `${slug}-event-plan-${new Date().toISOString().slice(0, 10)}.xlsx`,
  };
}

function StatCard({ label, value, hint, icon: Icon, tone = "text-primary" }: { label: string; value: string | number; hint?: string; icon: any; tone?: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/40 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-secondary">{label}</p>
        <Icon className={`h-4 w-4 ${tone}`} />
      </div>
      <p className={`mt-2 truncate font-syne text-2xl font-bold leading-none ${tone}`} title={String(value)}>{value}</p>
      {hint && <p className="mt-1.5 truncate text-[11px] text-secondary" title={hint}>{hint}</p>}
    </div>
  );
}

function Chip({ icon: Icon, children }: { icon?: any; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface-container-low px-2 py-1 text-[10px] font-semibold text-secondary">
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

function EventMeta({ event }: { event: RoadmapEvent }) {
  const states = event.states || [];
  return (
    <div className="flex flex-wrap gap-1.5">
      {(event.marketplaces || []).slice(0, 2).map((marketplace) => (
        <Chip key={marketplace} icon={Store}>{marketplace}</Chip>
      ))}
      {states.slice(0, 2).map((state) => (
        <Chip key={state} icon={MapPin}>{state}</Chip>
      ))}
      {states.length > 2 && <Chip>+{states.length - 2} states</Chip>}
      {event.verificationStatus === "verified" || event.confirmed ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-success-surface px-2 py-1 text-[10px] font-semibold text-success"><CheckCircle2 className="h-3 w-3" /> confirmed</span>
      ) : (
        <Chip>estimated · {Math.round((event.confidence || 0) * 100)}%</Chip>
      )}
    </div>
  );
}

function DateBlock({ event }: { event: RoadmapEvent }) {
  return (
    <div className="w-16 shrink-0 text-center">
      <div className="rounded-xl bg-soft-blush py-2">
        <p className="font-syne text-xl font-bold leading-none text-primary">{dayFmt.format(event.date)}</p>
        <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.14em] text-secondary">{shortMonthFmt.format(event.date)}</p>
      </div>
      <p className="mt-1 text-[10px] font-semibold text-secondary">{weekdayFmt.format(event.date)}</p>
    </div>
  );
}

function TimelineRow({ event, onOpen }: { event: RoadmapEvent; onOpen: () => void }) {
  return (
    <div className="flex gap-4 p-4 transition hover:bg-soft-blush/40">
      <DateBlock event={event} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onOpen} className="truncate text-left font-syne text-base font-bold text-on-surface hover:text-primary">{event.name}</button>
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${priorityBadge(event.priority)}`}>{event.priority || "normal"}</span>
          <span className="rounded-full bg-info-surface px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-info">{countdownLabel(event.daysUntil)}</span>
        </div>
        <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-primary">{typeLabel(event.type)}</p>
        <p className="mt-1 text-xs text-secondary">{dateRangeLabel(event)}</p>
        {event.description && <p className="mt-1 line-clamp-1 text-xs text-secondary">{event.description}</p>}
        <div className="mt-2"><EventMeta event={event} /></div>
      </div>
      <div className="hidden w-52 shrink-0 flex-col items-end gap-2 sm:flex">
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${prepTone(event.prepDaysLeft)}`}>
          {prepStatusLabel(event.prepDaysLeft)} · {event.prepDaysLeft < 0 ? `${Math.abs(event.prepDaysLeft)}d over` : `${event.prepDaysLeft}d left`}
        </span>
        <p className="text-[11px] text-secondary">Prep by <span className="font-semibold text-on-surface">{dateFmt.format(event.prepDeadline)}</span></p>
        <Link to={planHref(event)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary transition hover:bg-primary/20">
          <Sparkles className="h-3 w-3" /> Plan catalog
        </Link>
      </div>
    </div>
  );
}

function EventCard({ event, onOpen }: { event: RoadmapEvent; onOpen: () => void }) {
  return (
    <article className="flex flex-col rounded-xl border border-outline-variant/40 bg-white p-5 shadow-sm transition hover:-translate-y-px hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <DateBlock event={event} />
        <div className="flex flex-col items-end gap-1.5">
          <span className="rounded-full bg-info-surface px-2 py-1 text-[10px] font-bold uppercase text-info">{countdownLabel(event.daysUntil)}</span>
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${priorityBadge(event.priority)}`}>{event.priority || "normal"}</span>
        </div>
      </div>

      <button onClick={onOpen} className="mt-4 text-left font-syne text-lg font-bold leading-tight text-on-surface hover:text-primary">{event.name}</button>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-secondary">{event.campaignSeason || typeLabel(event.type)}</p>
      {event.description && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-secondary">{event.description}</p>}

      <div className="mt-3"><EventMeta event={event} /></div>

      {event.themes && event.themes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {event.themes.slice(0, 4).map((theme) => (
            <span key={theme} className="rounded-full bg-soft-blush px-2 py-0.5 text-[9px] font-semibold text-primary">{theme}</span>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-2 border-t border-outline-variant/30 pt-4 text-[12px]">
        <div className="flex justify-between gap-2">
          <span className="text-secondary">Event date</span>
          <span className="text-right font-semibold text-on-surface">{dateRangeLabel(event)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-secondary">Prep deadline</span>
          <span className={`text-right font-semibold ${event.prepDaysLeft < 0 ? "text-danger" : event.prepDaysLeft <= 14 ? "text-warning" : "text-on-surface"}`}>
            {dateFmt.format(event.prepDeadline)}
            {event.prepDaysLeft < 0 ? " · overdue" : event.prepDaysLeft <= 14 ? ` · ${event.prepDaysLeft}d left` : ""}
          </span>
        </div>
      </div>

      <Link to={planHref(event)} className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs font-bold text-primary transition hover:bg-primary/20">
        <Sparkles className="h-3.5 w-3.5" /> Plan catalog
      </Link>
    </article>
  );
}

function EventTable({ events, onOpen }: { events: RoadmapEvent[]; onOpen: (event: RoadmapEvent) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-outline-variant/30 bg-white">
      <table className="w-full min-w-[900px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-outline-variant/40 bg-surface-container-lowest text-[10px] uppercase tracking-widest text-secondary">
            <th className="p-3 font-bold">Date</th>
            <th className="p-3 font-bold">Event</th>
            <th className="p-3 font-bold">Type</th>
            <th className="p-3 font-bold">States / region</th>
            <th className="p-3 font-bold">Marketplaces</th>
            <th className="p-3 font-bold">Prep deadline</th>
            <th className="p-3 font-bold">Priority</th>
            <th className="p-3 font-bold" />
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant/25">
          {events.map((event) => (
            <tr key={event._id} className="align-top transition hover:bg-soft-blush/40">
              <td className="whitespace-nowrap p-3">
                <p className="font-semibold text-on-surface">{dateFmt.format(event.date)}</p>
                <p className="text-[11px] text-secondary">{weekdayFmt.format(event.date)} · {countdownLabel(event.daysUntil)}</p>
              </td>
              <td className="p-3">
                <button onClick={() => onOpen(event)} className="text-left font-semibold text-on-surface hover:text-primary">{event.name}</button>
                {event.description && <p className="line-clamp-1 max-w-md text-[11px] text-secondary">{event.description}</p>}
              </td>
              <td className="p-3 text-xs capitalize text-secondary">{typeLabel(event.type)}</td>
              <td className="max-w-[240px] p-3 text-xs text-secondary">{(event.states || []).join(", ") || "Pan-India"}</td>
              <td className="p-3 text-xs text-secondary">{(event.marketplaces || []).join(", ") || "All"}</td>
              <td className="whitespace-nowrap p-3">
                <p className="text-xs font-semibold text-on-surface">{dateFmt.format(event.prepDeadline)}</p>
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${prepTone(event.prepDaysLeft)}`}>{prepStatusLabel(event.prepDaysLeft)}</span>
              </td>
              <td className="p-3">
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${priorityBadge(event.priority)}`}>{event.priority || "normal"}</span>
              </td>
              <td className="whitespace-nowrap p-3 text-right">
                <Link to={planHref(event)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary transition hover:bg-primary/20">
                  <Sparkles className="h-3 w-3" /> Plan
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailDrawer({ event, onClose }: { event: RoadmapEvent; onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ["Event window", dateRangeLabel(event)],
    ["Weekday", weekdayLongFmt.format(event.date)],
    ["Countdown", countdownLabel(event.daysUntil)],
    ["Prep deadline", `${dateFmt.format(event.prepDeadline)} · ${prepStatusLabel(event.prepDaysLeft)}`],
    ["Planning lead", `${event.planningLeadDays || Math.max(1, Math.round((event.date - event.prepDeadline) / DAY))} days`],
    ["States / region", (event.states || []).join(", ") || "Pan-India"],
    ["Marketplaces", (event.marketplaces || []).join(", ") || "All"],
    ["Product focus", (event.recommendedCategories || []).join(", ") || "—"],
    ["Confidence", `${Math.round((event.confidence || 0) * 100)}% · ${event.verificationStatus || "estimated"}`],
    ["Source", event.sourceDetail || event.source || "—"],
  ];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-navy-soft/45" onClick={onClose}>
      <aside className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-2xl" onClick={(clickEvent) => clickEvent.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-outline-variant/40 bg-white p-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">{typeLabel(event.type)}</p>
            <h3 className="mt-1 font-syne text-xl font-bold text-on-surface">{event.name}</h3>
            <p className="mt-1 text-xs text-secondary">{dateRangeLabel(event)} · {countdownLabel(event.daysUntil)}</p>
          </div>
          <button onClick={onClose} className="rounded p-2 text-secondary transition hover:bg-surface-container"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-5 p-5">
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${priorityBadge(event.priority)}`}>{event.priority || "normal"} priority</span>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${prepTone(event.prepDaysLeft)}`}>{prepStatusLabel(event.prepDaysLeft)}</span>
          </div>

          {event.description && <p className="text-sm leading-relaxed text-secondary">{event.description}</p>}

          <dl className="divide-y divide-outline-variant/30 rounded-xl border border-outline-variant/40">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 px-4 py-2.5 text-[13px]">
                <dt className="shrink-0 text-secondary">{label}</dt>
                <dd className="text-right font-semibold text-on-surface">{value}</dd>
              </div>
            ))}
          </dl>

          {(event.themes || []).length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-secondary">Visual themes</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(event.themes || []).map((theme) => (
                  <span key={theme} className="rounded-full bg-soft-blush px-2.5 py-1 text-[11px] font-semibold text-primary">{theme}</span>
                ))}
              </div>
            </div>
          )}

          {(event.colorPalette || []).length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-secondary">Colour palette</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(event.colorPalette || []).map((colour) => (
                  <span key={colour} className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/50 px-2.5 py-1 text-[11px] font-semibold text-on-surface">
                    {/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colour) && <span className="h-3 w-3 rounded-full border border-outline-variant/60" style={{ background: colour }} />}
                    {colour}
                  </span>
                ))}
              </div>
            </div>
          )}

          {(event.stylingProps || []).length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-secondary">Styling props</p>
              <p className="mt-1.5 text-[13px] text-secondary">{(event.stylingProps || []).join(", ")}</p>
            </div>
          )}

          {(event.sourceUrls || []).length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-secondary">Research sources</p>
              <div className="mt-2 space-y-1.5">
                {(event.sourceUrls || []).slice(0, 6).map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 truncate text-[12px] font-semibold text-primary hover:underline">
                    <ExternalLink className="h-3 w-3 shrink-0" /> <span className="truncate">{url}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          <Link to={planHref(event)} className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:bg-primary-container">
            <Sparkles className="h-4 w-4" /> Plan catalog for this event
          </Link>
        </div>
      </aside>
    </div>
  );
}

export function Events() {
  const { organization } = useWorkspace();
  const { data: data, error: _dataError } = useQuery(api.eventIntelligence.roadmap, { organizationId: organization._id }) as { data: Roadmap | undefined, error: any };
  const createEvent = useMutation(api.events.create);
  const runResearch = useAction(api.eventIntelligence.runResearch);
  const seedCalendar = useMutation(api.eventIntelligence.seedCalendar);
  const sendReport = useAction(api.eventDigest.sendDigestNow);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [marketFilter, setMarketFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [horizon, setHorizon] = useState("365");
  const [view, setView] = useState<View>(() => {
    try {
      const stored = localStorage.getItem("events.view");
      return stored === "grid" || stored === "table" ? stored : "timeline";
    } catch {
      return "timeline";
    }
  });
  const [showCreate, setShowCreate] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [detail, setDetail] = useState<RoadmapEvent | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({ name: "", type: "festival", date: "", planningLeadDays: 21, priority: "normal", states: "Pan-India", marketplaces: "All", description: "" });
  const [emailForm, setEmailForm] = useState({ recipients: "", note: "" });

  useEffect(() => {
    try {
      localStorage.setItem("events.view", view);
    } catch {
      // View preference is a convenience only.
    }
  }, [view]);

  const events = useMemo(() => data?.events ?? [], [data]);
  const canManage = data?.capabilities.canManage ?? false;
  const lastRun = data?.lastRun ?? null;
  const availableStates = useMemo(() => [...new Set(events.flatMap((event) => event.states || []))].sort(), [events]);
  const availableMarketplaces = useMemo(() => [...new Set(events.flatMap((event) => event.marketplaces || []))].sort(), [events]);
  const horizonDays = HORIZONS.find((entry) => entry.value === horizon)?.days ?? 365;

  const filtered = useMemo(
    () =>
      events.filter((event) => {
        const matchesText = `${event.name} ${event.type} ${event.campaignSeason ?? ""} ${(event.marketplaces || []).join(" ")} ${(event.states || []).join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchesType = !typeFilter || event.type === typeFilter;
        const matchesMarket = !marketFilter || (event.marketplaces || []).includes(marketFilter) || (event.marketplaces || []).includes("All");
        const matchesState = !stateFilter || (event.states || []).includes(stateFilter) || (event.states || []).includes("Pan-India");
        return matchesText && matchesType && matchesMarket && matchesState;
      }),
    [events, search, typeFilter, marketFilter, stateFilter],
  );

  const visible = useMemo(() => {
    if (horizonDays < 0) return filtered.filter((event) => event.daysUntil < 0).sort((left, right) => right.date - left.date);
    const upcoming = filtered.filter((event) => event.daysUntil >= 0);
    const scoped = horizonDays === 0 ? upcoming : upcoming.filter((event) => event.daysUntil <= horizonDays);
    return scoped.sort((left, right) => left.date - right.date);
  }, [filtered, horizonDays]);

  const grouped = useMemo(() => {
    const map = new Map<string, RoadmapEvent[]>();
    for (const event of visible) {
      const key = monthKey(event.date);
      const bucket = map.get(key);
      if (bucket) bucket.push(event);
      else map.set(key, [event]);
    }
    return [...map.entries()];
  }, [visible]);

  const prepDue = visible.filter((event) => event.daysUntil >= 0 && event.prepDaysLeft <= 14);
  const nextEvent = visible.find((event) => event.daysUntil >= 0);
  const isPastView = horizonDays < 0;

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
        ? `Seeded ${result.created} dated events — ${result.festivals} state festivals, ${result.marketplaces} marketplace windows, ${result.baseline} fixed-calendar moments.`
        : "Calendar already seeded — nothing to add.";
    });

  const handleExport = () =>
    withGuard("export", async () => {
      if (!visible.length) throw new Error("There are no events in the current view to export.");
      const workbook = await buildWorkbook(organization.name, visible);
      saveAs(workbook.blob, workbook.filename);
      return `Exported ${visible.length} event${visible.length === 1 ? "" : "s"} to ${workbook.filename}.`;
    });

  const handleEmail = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    const scope = visible.filter((event) => event.daysUntil >= 0);
    await withGuard("email", async () => {
      if (!scope.length) throw new Error("Select a view with upcoming events before sending the report.");
      const result = await sendReport({
        organizationId: organization._id,
        recipients: emailForm.recipients.split(",").map((entry) => entry.trim()).filter(Boolean),
        note: emailForm.note.trim(),
        horizonDays: 730,
        eventIds: scope.map((event) => event._id),
        heading: "Event planning report",
      });
      if (!result.sent) throw new Error("The report could not be sent.");
      setShowEmail(false);
      setEmailForm({ recipients: "", note: "" });
      return `Report emailed to ${result.recipients.length} recipient${result.recipients.length === 1 ? "" : "s"} with ${result.eventCount} event${result.eventCount === 1 ? "" : "s"} and ${result.attachment} attached.`;
    });
  };

  const submit = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    setSaving(true);
    try {
      await createEvent({
        organizationId: organization._id,
        name: form.name.trim(),
        type: form.type,
        date: new Date(`${form.date}T12:00:00`).getTime(),
        planningLeadDays: Number(form.planningLeadDays),
        priority: form.priority,
        states: form.states.split(",").map((entry) => entry.trim()).filter(Boolean),
        marketplaces: form.marketplaces.split(",").map((entry) => entry.trim()).filter(Boolean),
        description: form.description.trim(),
      });
      setShowCreate(false);
      setForm({ name: "", type: "festival", date: "", planningLeadDays: 21, priority: "normal", states: "Pan-India", marketplaces: "All", description: "" });
      setNotice({ tone: "success", text: "Event added to the roadmap." });
    } catch (reason) {
      setNotice({ tone: "error", text: getErrorMessage(reason, "Could not add event.") });
    } finally {
      setSaving(false);
    }
  };

  const resetFilters = () => {
    setSearch("");
    setTypeFilter("");
    setMarketFilter("");
    setStateFilter("");
    setHorizon("365");
  };

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="mb-1 text-[11px] font-label-caps uppercase tracking-widest text-secondary">Campaign intelligence</p>
          <h2 className="text-display-md text-on-surface">Events roadmap</h2>
          <p className="mt-1 max-w-2xl text-sm text-secondary">
            State festivals, marketplace sale windows and seasonal peaks with dated prep deadlines, so catalog work is planned backward from every event.
            {lastRun && (
              <span className="ml-1">
                Last researched {relativeTime(lastRun.startedAt)}
                {lastRun.status === "failed" ? " (failed)" : lastRun.status === "running" ? " (running…)" : ""}.
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleExport}
            disabled={busy !== null || !visible.length}
            className="flex items-center gap-2 rounded-lg border border-outline-variant bg-white px-4 py-2 text-sm font-semibold text-on-surface transition hover:bg-surface-container disabled:opacity-50"
          >
            {busy === "export" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download Excel
          </button>
          {canManage && (
            <button
              onClick={() => setShowEmail(true)}
              disabled={busy !== null}
              className="flex items-center gap-2 rounded-lg border border-outline-variant bg-white px-4 py-2 text-sm font-semibold text-on-surface transition hover:bg-surface-container disabled:opacity-50"
            >
              <Mail className="h-4 w-4" /> Email report
            </button>
          )}
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-container">
            <Plus className="h-4 w-4" /> Add event
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Events in view" value={visible.length} hint={isPastView ? "Past events" : HORIZONS.find((entry) => entry.value === horizon)?.label} icon={CalendarRange} />
        <StatCard
          label="Next event"
          value={nextEvent ? nextEvent.name : "—"}
          hint={nextEvent ? `${dateFmt.format(nextEvent.date)} · ${countdownLabel(nextEvent.daysUntil)}` : "Nothing scheduled ahead"}
          icon={CalendarDays}
        />
        <StatCard label="Prep due ≤ 14 days" value={prepDue.length} hint={prepDue[0] ? `Next: ${prepDue[0].name}` : "No deadlines pressing"} icon={AlertTriangle} tone={prepDue.length ? "text-warning" : "text-success"} />
        <StatCard label="Festivals" value={visible.filter((event) => event.type === "festival").length} hint={`${availableStates.length} states covered`} icon={Flame} />
        <StatCard label="Marketplace sales" value={visible.filter((event) => event.type === "marketplace_sale").length} hint={availableMarketplaces.slice(0, 3).join(", ") || "No marketplaces tagged"} icon={Store} />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search events, states, marketplaces…" className={`${inputClass} w-full pl-9`} />
        </div>
        <select value={horizon} onChange={(event) => setHorizon(event.target.value)} className={inputClass}>
          {HORIZONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </select>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={inputClass}>
          <option value="">All types</option>
          {TYPE_OPTIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </select>
        <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} className={`${inputClass} max-w-48`}>
          <option value="">All states</option>
          {availableStates.map((state) => <option key={state} value={state}>{state}</option>)}
        </select>
        <select value={marketFilter} onChange={(event) => setMarketFilter(event.target.value)} className={inputClass}>
          <option value="">All marketplaces</option>
          {availableMarketplaces.map((marketplace) => <option key={marketplace} value={marketplace}>{marketplace}</option>)}
        </select>
        <button onClick={resetFilters} className="rounded-lg px-3 py-2 text-xs font-bold text-secondary transition hover:bg-surface-container hover:text-on-surface">Reset</button>
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-outline-variant bg-white p-1">
          {([["timeline", Rows3, "Timeline"], ["grid", LayoutGrid, "Cards"], ["table", Table2, "Table"]] as Array<[View, any, string]>).map(([value, Icon, label]) => (
            <button
              key={value}
              onClick={() => setView(value)}
              title={label}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-bold transition ${view === value ? "bg-soft-blush text-primary" : "text-secondary hover:text-on-surface"}`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
          <span className="mr-1 text-[11px] font-bold uppercase tracking-widest text-secondary">Intelligence</span>
          <button onClick={handleResearch} disabled={busy !== null} className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs font-bold text-primary transition hover:bg-primary/20 disabled:opacity-50">
            {busy === "research" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Refresh research (Gemini)
          </button>
          <button onClick={handleSeed} disabled={busy !== null} className="flex items-center gap-2 rounded-lg border border-outline-variant px-3 py-2 text-xs font-bold text-secondary transition hover:bg-surface-container disabled:opacity-50">
            {busy === "seed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
            Seed state & marketplace calendar
          </button>
          <span className="text-[11px] text-secondary">Seeding dates every state festival and marketplace sale window for the next twelve months; research then confirms the exact dates.</span>
        </div>
      )}

      {notice && (
        <div className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-sm ${notice.tone === "success" ? "border-success/20 bg-success-surface text-success" : "border-danger/20 bg-danger-surface text-danger"}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      {prepDue.length > 0 && !isPastView && (
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-warning">
            <AlertTriangle className="h-4 w-4" /> Prep due within two weeks
          </h3>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {prepDue.map((event) => <EventCard key={event._id} event={event} onOpen={() => setDetail(event)} />)}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-secondary">
          <Clock3 className="h-4 w-4" /> {isPastView ? "Past events" : "Planning calendar"}
          <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] text-secondary">{visible.length}</span>
        </h3>

        {_dataError ? (
          <div className="rounded-xl border border-dashed border-red-500/50 bg-red-50 p-10 text-center text-sm text-red-500">
            Failed to load roadmap data. {String(_dataError.message || _dataError)}
          </div>
        ) : data === undefined ? (
          <div className="space-y-3">
            {[0, 1, 2].map((row) => <div key={row} className="h-24 animate-pulse rounded-xl border border-outline-variant/30 bg-white" />)}
          </div>
        ) : !visible.length ? (
          <div className="rounded-xl border border-dashed border-outline-variant/50 bg-white p-10 text-center text-sm text-secondary">
            No events match this view.{" "}
            {canManage ? "Adjust the filters, seed the calendar, or run research to populate the roadmap." : "Adjust the filters or ask a planning manager to run event research."}
          </div>
        ) : view === "table" ? (
          <EventTable events={visible} onOpen={setDetail} />
        ) : view === "grid" ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((event) => <EventCard key={event._id} event={event} onOpen={() => setDetail(event)} />)}
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(([key, monthEvents]) => (
              <div key={key}>
                <div className="mb-2 flex items-baseline gap-3">
                  <h4 className="font-syne text-sm font-bold uppercase tracking-[0.18em] text-primary">{monthFmt.format(monthEvents[0].date)}</h4>
                  <span className="text-[11px] text-secondary">{monthEvents.length} event{monthEvents.length === 1 ? "" : "s"}</span>
                  <span className="h-px flex-1 bg-outline-variant/40" />
                </div>
                <div className="divide-y divide-outline-variant/30 overflow-hidden rounded-xl border border-outline-variant/30 bg-white">
                  {monthEvents.map((event) => <TimelineRow key={event._id} event={event} onOpen={() => setDetail(event)} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {detail && <DetailDrawer event={detail} onClose={() => setDetail(null)} />}

      {showEmail && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-soft/45 p-4">
          <form onSubmit={handleEmail} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-primary">Event reporting</p>
                <h3 className="font-syne text-xl font-bold">Email the planning report</h3>
                <p className="mt-1 text-xs text-secondary">
                  Sends the {visible.filter((event) => event.daysUntil >= 0).length} upcoming event{visible.filter((event) => event.daysUntil >= 0).length === 1 ? "" : "s"} in the current view, themed like this page, with the date-wise Excel plan attached.
                </p>
              </div>
              <button type="button" onClick={() => setShowEmail(false)} className="rounded p-2 text-secondary transition hover:bg-surface-container"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <label className="block text-sm font-semibold text-secondary">
                Recipients
                <input
                  value={emailForm.recipients}
                  onChange={(event) => setEmailForm({ ...emailForm, recipients: event.target.value })}
                  placeholder="ops@example.com, owner@example.com"
                  className={`${inputClass} mt-1.5 w-full`}
                />
                <span className="mt-1 block text-[11px] font-normal text-secondary">Leave blank to use the report recipients configured in Administration.</span>
              </label>
              <label className="block text-sm font-semibold text-secondary">
                Note (optional)
                <textarea
                  value={emailForm.note}
                  onChange={(event) => setEmailForm({ ...emailForm, note: event.target.value })}
                  rows={3}
                  placeholder="Context for the team — shoot priorities, catalog owners, deadlines…"
                  className="mt-1.5 w-full rounded-lg border border-outline-variant bg-white p-3 text-sm text-on-surface outline-none transition focus:border-primary"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowEmail(false)} className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold">Cancel</button>
              <button disabled={busy === "email"} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-container disabled:opacity-50">
                {busy === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send report
              </button>
            </div>
          </form>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-soft/45 p-4">
          <form onSubmit={submit} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-primary">Campaign calendar</p>
                <h3 className="font-syne text-xl font-bold">Add event</h3>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} className="rounded p-2 text-secondary transition hover:bg-surface-container"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-secondary sm:col-span-2">
                Event name
                <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={`${inputClass} mt-1.5 w-full`} />
              </label>
              <label className="block text-sm font-semibold text-secondary">
                Type
                <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className={`${inputClass} mt-1.5 w-full`}>
                  {TYPE_OPTIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold text-secondary">
                Priority
                <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} className={`${inputClass} mt-1.5 w-full`}>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <label className="block text-sm font-semibold text-secondary">
                Event date
                <input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className={`${inputClass} mt-1.5 w-full`} />
              </label>
              <label className="block text-sm font-semibold text-secondary">
                Planning lead days
                <input required min={1} max={365} type="number" value={form.planningLeadDays} onChange={(event) => setForm({ ...form, planningLeadDays: Number(event.target.value) })} className={`${inputClass} mt-1.5 w-full`} />
              </label>
              <label className="block text-sm font-semibold text-secondary">
                States / region
                <input value={form.states} onChange={(event) => setForm({ ...form, states: event.target.value })} placeholder="Pan-India, Rajasthan" className={`${inputClass} mt-1.5 w-full`} />
              </label>
              <label className="block text-sm font-semibold text-secondary">
                Marketplaces
                <input value={form.marketplaces} onChange={(event) => setForm({ ...form, marketplaces: event.target.value })} placeholder="Myntra, Amazon" className={`${inputClass} mt-1.5 w-full`} />
              </label>
              <label className="block text-sm font-semibold text-secondary sm:col-span-2">
                Description
                <textarea
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  rows={2}
                  className="mt-1.5 w-full rounded-lg border border-outline-variant bg-white p-3 text-sm text-on-surface outline-none transition focus:border-primary"
                />
              </label>
            </div>
            {form.date && (
              <p className="mt-4 rounded-lg bg-soft-blush px-3 py-2 text-[11px] font-semibold text-primary">
                Prep deadline lands on {dateFmt.format(new Date(`${form.date}T12:00:00`).getTime() - Number(form.planningLeadDays || 0) * DAY)}.
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold">Cancel</button>
              <button disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-container disabled:opacity-50">
                {saving ? "Saving…" : "Add event"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
