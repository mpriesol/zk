"use client";
import { useMemo, useState } from "react";
import type { Activity } from "../lib/types";
import { summarize } from "../lib/gamification";
import { fmt, add, monday, Empty } from "./ui";
export default function Stats({
  activities,
  today,
  group = false,
  onDay,
  startDate,
}: {
  activities: Activity[];
  today: string;
  startDate?: string;
  group?: boolean;
  onDay?: (day: string) => void;
}) {
  const [range, setRange] = useState("recent");
  const start =
    range === "week"
      ? monday(today)
      : range === "recent"
        ? add(monday(today), -21)
        : "";
  const rows = useMemo(
    () => activities.filter((a) => !start || a.date >= start),
    [activities, start],
  );
  const s = useMemo(() => summarize(rows), [rows]);
  const chartStart =
    start ||
    monday(startDate || activities.map((a) => a.date).sort()[0] || today);
  const weeks = [];
  for (let w = chartStart; w <= monday(today); w = add(w, 7)) {
    weeks.push(
      s.weeks.find((x) => x.week === w) || {
        week: w,
        activities: 0,
        movementDays: 0,
        minutes: null,
        missingMinutes: 0,
        people: 0,
      },
    );
  }
  const maxDays = Math.max(...weeks.map((w) => w.movementDays), 1),
    maxMinutes = Math.max(...weeks.map((w) => w.minutes || 0), 1),
    maxPeople = Math.max(...weeks.map((w) => w.people), 1);
  const days = Array.from({ length: 28 }, (_, i) => add(today, i - 27));
  return (
    <section className="panel stats-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">
            {group ? "NAŠE ZÁPISY" : "TVÔJ ZAZNAMENANÝ POHYB"}
          </p>
          <h2>{group ? "Spoločný prehľad" : "Každý týždeň má svoj príbeh"}</h2>
        </div>
        <label
          className="sr-only"
          htmlFor={group ? "group-range" : "own-range"}
        >
          Obdobie grafov
        </label>
        <select
          id={group ? "group-range" : "own-range"}
          value={range}
          onChange={(e) => setRange(e.target.value)}
        >
          <option value="week">Tento týždeň</option>
          <option value="recent">Posledné 4 týždne</option>
          <option value="all">Celá príprava</option>
        </select>
      </div>
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
        {s.missingMinutes > 0
          ? `${s.missingMinutes} pohybových zápisov nemá uvedené trvanie. Súhrn minút je preto neúplný.`
          : "Minúty vychádzajú z vyplneného trvania pohybových aktivít."}{" "}
        Dve aktivity v ten istý deň sú jeden pohybový deň človeka.
      </p>
      {rows.length === 0 ? (
        <Empty title="V tomto období zatiaľ bez zápisu">
          Grafy sa vytvoria z tvojich skutočných záznamov.
        </Empty>
      ) : (
        <>
          <div className="chart-grid">
            <div className="chart">
              <h3>Pohybové dni po týždňoch</h3>
              <div
                className="bar-chart"
                role="img"
                aria-label={weeks
                  .map(
                    (w) =>
                      `Týždeň ${fmt(w.week)}: ${w.movementDays} pohybových dní`,
                  )
                  .join("; ")}
              >
                {weeks.map((w) => (
                  <div className="bar-col" key={w.week}>
                    <span>{w.movementDays}</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{
                          height: `${Math.max(2, (w.movementDays / maxDays) * 100)}%`,
                        }}
                        title={`${fmt(w.week)}: ${w.movementDays} dní`}
                      />
                    </div>
                    <small>{fmt(w.week)}</small>
                  </div>
                ))}
              </div>
            </div>
            <div className="chart">
              <h3>Zapísané minúty po týždňoch</h3>
              <div
                className="bar-chart"
                role="img"
                aria-label={weeks
                  .map(
                    (w) =>
                      `Týždeň ${fmt(w.week)}: ${w.minutes === null ? "čas neuvedený" : w.minutes + " minút"}`,
                  )
                  .join("; ")}
              >
                {weeks.map((w) => (
                  <div className="bar-col" key={w.week}>
                    <span>{w.minutes === null ? "—" : w.minutes}</span>
                    <div className="bar-track">
                      <div
                        className={`bar-fill light ${w.minutes === null ? "unknown" : ""}`}
                        style={{
                          height: `${w.minutes === null ? 3 : Math.max(2, (w.minutes / maxMinutes) * 100)}%`,
                        }}
                        title={
                          w.minutes === null
                            ? "Trvanie neuvedené"
                            : `${w.minutes} minút`
                        }
                      />
                    </div>
                    <small>{fmt(w.week)}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="chart-grid">
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
            {group ? (
              <div className="distribution">
                <h3>Ľudia a zápisy po týždňoch</h3>
                <div className="mini-table">
                  <div>
                    <strong>Týždeň od</strong>
                    <strong>Ľudia</strong>
                    <strong>Zápisy</strong>
                  </div>
                  {weeks.map((w) => (
                    <div key={w.week}>
                      <span>{fmt(w.week)}</span>
                      <span>{w.people}</span>
                      <span>{w.activities}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <h3>Posledných 28 dní</h3>
                <div className="heatmap">
                  {days.map((d) => {
                    const n = activities.filter((a) => a.date === d).length;
                    return (
                      <button
                        key={d}
                        className={`heat-cell level-${Math.min(n, 3)}`}
                        title={`${fmt(d)}: ${n ? "počet zápisov " + n : "bez zápisu"}`}
                        aria-label={`${fmt(d)}: ${n ? "počet zápisov " + n : "bez zápisu"}`}
                        onClick={() => onDay?.(d)}
                      >
                        {Number(d.slice(-2))}
                        {n > 1 && <sup>{n}</sup>}
                      </button>
                    );
                  })}
                </div>
                <p className="small muted heat-legend">
                  <span className="legend-square" /> bez zápisu{" "}
                  <span className="legend-square filled" /> 1 zápis · číslo
                  navyše = viac zápisov
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
