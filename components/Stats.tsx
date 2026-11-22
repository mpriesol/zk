"use client";
import { useState } from "react";
import type { Activity, ColdEntry } from "../lib/types";
import { summarize } from "../lib/gamification";
import { calendarBounds } from "../lib/calendar";
import { fmt, add, monday, Empty } from "./ui";
import ActivityCalendar, { CalendarControls } from "./ActivityCalendar";
import { usePreference } from "./preferences";

export default function Stats({
  activities,
  today,
  group = false,
  onDay,
  startDate,
  showCalendar = true,
  cold = [],
  memberId,
  preferenceKey = "stats",
}: {
  activities: Activity[];
  today: string;
  startDate?: string;
  group?: boolean;
  onDay?: (day: string) => void;
  showCalendar?: boolean;
  cold?: Pick<ColdEntry, "memberId" | "date">[];
  memberId?: string;
  preferenceKey?: string;
}) {
  const [range, setRange] = usePreference<"week" | "month" | "all">(
    `cz-${preferenceKey}-range`,
    "month",
    ["week", "month", "all"],
  );
  const [anchor, setAnchor] = useState(today);
  const bounds =
    range === "all"
      ? {
          start: startDate || activities.map((a) => a.date).sort()[0] || today,
          end: today,
        }
      : calendarBounds(range, anchor);
  const rows = activities.filter(
    (a) => a.date >= bounds.start && a.date <= bounds.end,
  );
  const s = summarize(rows);
  const weeks: {
    week: string;
    movementDays: number;
    minutes: number | null;
    activities: number;
    people: number;
  }[] = [];
  for (let w = monday(bounds.start); w <= monday(bounds.end); w = add(w, 7))
    weeks.push(
      s.weeks.find((x) => x.week === w) || {
        week: w,
        movementDays: 0,
        minutes: null,
        activities: 0,
        people: 0,
      },
    );
  const maxDays = Math.max(1, ...weeks.map((w) => w.movementDays));
  const maxMinutes = Math.max(1, ...weeks.map((w) => w.minutes || 0));
  return (
    <section className="panel stats-panel">
      <div className="section-head">
        <div>
          <h2>{group ? "Spoločný prehľad" : "Prehľad prípravy"}</h2>
        </div>
        <label>
          <span className="sr-only">Obdobie štatistík</span>
          <select
            value={range}
            onChange={(e) =>
              setRange(e.target.value as "week" | "month" | "all")
            }
          >
            <option value="week">Týždeň</option>
            <option value="month">Kalendárny mesiac</option>
            <option value="all">Celá príprava</option>
          </select>
        </label>
      </div>
      {range !== "all" && (
        <CalendarControls
          range={range}
          anchor={anchor}
          today={today}
          startDate={startDate}
          onRange={setRange}
          onAnchor={setAnchor}
        />
      )}
      <div className="stat-strip">
        <div>
          <strong>{s.activities}</strong>
          <span>zápisov</span>
        </div>
        <div>
          <strong>{s.movementDays}</strong>
          <span>{group ? "pohybových dní členov" : "pohybových dní"}</span>
        </div>
        <div>
          <strong>{s.minutes === null ? "—" : s.minutes}</strong>
          <span>zapísaných minút</span>
        </div>
        {group && (
          <div>
            <strong>{s.people}</strong>
            <span>ľudí so zápisom</span>
          </div>
        )}
      </div>
      <p className="small muted">
        {s.missingMinutes
          ? `${s.missingMinutes} pohybových zápisov nemá uvedené trvanie. Súčet minút je neúplný.`
          : "Minúty vychádzajú z vyplneného trvania pohybových aktivít."}{" "}
        Viac aktivít v rovnaký deň tvorí jeden pohybový deň človeka.
      </p>
      {showCalendar && !group && range !== "all" && (
        <ActivityCalendar
          activities={activities}
          range={range}
          anchor={anchor}
          today={today}
          cold={cold}
          memberId={memberId}
          onDay={(date) => onDay?.(date)}
        />
      )}
      {rows.length === 0 ? (
        <Empty title="V tomto období zatiaľ bez zápisu">
          Prehľad sa doplní z uložených aktivít.
        </Empty>
      ) : (
        <>
          <div className="chart-grid">
            {(["days", "minutes"] as const).map((kind) => (
              <div className="chart" key={kind}>
                <h3>
                  {kind === "days"
                    ? "Pohybové dni po týždňoch"
                    : "Zapísané minúty po týždňoch"}
                </h3>
                <div
                  className="bar-chart"
                  role="img"
                  aria-label={weeks
                    .map(
                      (w) =>
                        `${fmt(w.week)}: ${kind === "days" ? w.movementDays + " dní" : w.minutes === null ? "čas neuvedený" : w.minutes + " minút"}`,
                    )
                    .join("; ")}
                >
                  {weeks.map((w) => {
                    const value = kind === "days" ? w.movementDays : w.minutes;
                    return (
                      <div className="bar-col" key={w.week}>
                        <span>{value ?? "—"}</span>
                        <div className="bar-track">
                          <div
                            className={`bar-fill ${kind === "minutes" ? "light" : ""} ${value === null ? "unknown" : ""}`}
                            style={{
                              height: `${Math.max(2, ((value || 0) / (kind === "days" ? maxDays : maxMinutes)) * 100)}%`,
                            }}
                          />
                        </div>
                        <small>{fmt(w.week)}</small>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="distribution">
            <h3>
              Aktivity podľa typu <small>počet zápisov</small>
            </h3>
            {s.byType.map((t) => (
              <div key={t.typeId} className="distribution-row">
                <span>{t.name}</span>
                <div>
                  <i
                    style={{
                      width: `${(t.count / Math.max(1, s.activities)) * 100}%`,
                    }}
                  />
                </div>
                <strong>{t.count}</strong>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
