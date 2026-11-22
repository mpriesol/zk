"use client";
import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Snowflake,
} from "lucide-react";
import type { Activity, ColdEntry } from "../lib/types";
import {
  calendarBounds,
  calendarDays,
  moveCalendar,
  type CalendarRange,
} from "../lib/calendar";
import { fmt, SportIcon } from "./ui";

export function CalendarControls({
  range,
  anchor,
  today,
  startDate,
  onRange,
  onAnchor,
}: {
  range: CalendarRange;
  anchor: string;
  today: string;
  startDate?: string;
  onRange: (range: CalendarRange) => void;
  onAnchor: (date: string) => void;
}) {
  const { start, end } = calendarBounds(range, anchor);
  const previous = calendarBounds(range, moveCalendar(range, anchor, -1));
  const next = calendarBounds(range, moveCalendar(range, anchor, 1));
  return (
    <div className="calendar-controls">
      <div className="segmented" role="group" aria-label="Obdobie prehľadu">
        <button aria-pressed={range === "week"} onClick={() => onRange("week")}>
          Týždeň
        </button>
        <button
          aria-pressed={range === "month"}
          onClick={() => onRange("month")}
        >
          Mesiac
        </button>
      </div>
      <div className="calendar-period">
        <button
          className="icon-button"
          aria-label={`Predchádzajúci ${range === "week" ? "týždeň" : "mesiac"}`}
          disabled={!!startDate && previous.end < startDate}
          onClick={() => onAnchor(moveCalendar(range, anchor, -1))}
        >
          <ChevronLeft size={18} />
        </button>
        <strong aria-live="polite">
          {range === "month"
            ? fmt(start, { month: "long", year: "numeric" })
            : `${fmt(start)} – ${fmt(end)}`}
        </strong>
        <button
          className="icon-button"
          aria-label={`Nasledujúci ${range === "week" ? "týždeň" : "mesiac"}`}
          disabled={next.start > today}
          onClick={() => onAnchor(moveCalendar(range, anchor, 1))}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      {!(start <= today && end >= today) && (
        <button className="text-button" onClick={() => onAnchor(today)}>
          Dnes
        </button>
      )}
    </div>
  );
}

export function ActivityDay({
  date,
  activities,
  today,
  cold = false,
  outside = false,
  disabled = false,
  onClick,
  memberName = "",
}: {
  date: string;
  activities: Activity[];
  today: string;
  cold?: boolean;
  outside?: boolean;
  disabled?: boolean;
  onClick: () => void;
  memberName?: string;
}) {
  const comments = activities.reduce(
    (n, a) => n + (a.comments?.length || 0),
    0,
  );
  const names = activities.map((a) => a.typeName).join(", ");
  const label = `${memberName ? memberName + ", " : ""}${fmt(date, { day: "numeric", month: "long", year: "numeric" })}: ${activities.length ? names : "bez pohybového zápisu"}${cold ? ", otužovanie" : ""}${comments ? `, ${comments} komentárov` : ""}`;
  return (
    <button
      className={`activity-day ${activities.length ? "has-activity" : ""} ${cold ? "has-cold" : ""} ${date === today ? "is-today" : ""} ${outside ? "outside-month" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="day-number">{Number(date.slice(-2))}</span>
      <span
        className={`day-sports ${activities.length === 1 ? "single" : "multiple"}`}
      >
        {activities.slice(0, 3).map((activity) => (
          <SportIcon
            key={activity.id}
            group={activity.group}
            typeName={activity.typeName}
            size={activities.length === 1 ? 25 : 15}
          />
        ))}
        {activities.length > 3 && <small>+{activities.length - 3}</small>}
      </span>
      {cold && (
        <Snowflake size={13} className="day-snowflake" aria-hidden="true" />
      )}
      {comments > 0 && (
        <span className="day-comments">
          <MessageCircle size={12} />
          <span className="sr-only">Komentáre</span>
        </span>
      )}
    </button>
  );
}

export default function ActivityCalendar({
  activities,
  range,
  anchor,
  today,
  cold = [],
  memberId,
  onDay,
}: {
  activities: Activity[];
  range: CalendarRange;
  anchor: string;
  today: string;
  cold?: Pick<ColdEntry, "memberId" | "date">[];
  memberId?: string;
  onDay: (date: string) => void;
}) {
  const { start, end, days } = calendarDays(range, anchor);
  return (
    <div className={`activity-calendar range-${range}`}>
      <div className="calendar-weekdays" aria-hidden="true">
        {["Po", "Ut", "St", "Št", "Pi", "So", "Ne"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {days.map((date) => (
          <ActivityDay
            key={date}
            date={date}
            activities={activities.filter((a) => a.date === date)}
            today={today}
            cold={cold.some(
              (c) => c.date === date && (!memberId || c.memberId === memberId),
            )}
            outside={date < start || date > end}
            disabled={date > today}
            onClick={() => onDay(date)}
          />
        ))}
      </div>
      <p className="calendar-legend">
        <span>Ikony = aktivity</span>
        <span>
          <MessageCircle size={12} /> komentár
        </span>
        {cold.length > 0 && (
          <span>
            <Snowflake size={12} /> otužovanie
          </span>
        )}
      </p>
    </div>
  );
}
