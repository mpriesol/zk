"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  Diamond,
  Footprints,
  Clock,
  Plus,
  MountainSnow,
} from "lucide-react";
import type { Activity, AppState } from "../lib/types";
import { summarize } from "../lib/gamification";
import { calendarBounds, type CalendarRange } from "../lib/calendar";
import { add, monday, fmt, type Action } from "./ui";
import { usePreference } from "./preferences";
import ActivityCalendar, { CalendarControls } from "./ActivityCalendar";
import AwardArt from "./AwardArt";
import ColdPanel from "./ColdPanel";
import Feed from "./Feed";
import Stats from "./Stats";
import { RuleCard } from "./Rewards";

export default function HomeDashboard({
  state,
  onAction,
  onAdd,
  onEdit,
  onDay,
  onNavigate,
  onMessage,
  allowModeration,
}: {
  state: AppState;
  onAction: Action;
  onAdd: () => void;
  onEdit: (a: Activity) => void;
  onDay: (day: string) => void;
  onNavigate: (view: string) => void;
  onMessage: (id: string) => void;
  allowModeration: boolean;
}) {
  const [range, setRange] = usePreference<CalendarRange>(
    `cz-home-range-${state.course.id}-${state.me.id}`,
    "week",
    ["week", "month"],
  );
  const [anchor, setAnchor] = useState(state.today);
  const [archiveBusy, setArchiveBusy] = useState(false),
    [error, setError] = useState("");
  const own = state.activities.filter((a) => a.memberId === state.me.id);
  const { start, end } = calendarBounds(range, anchor);
  const summary = summarize(
    own.filter((a) => a.date >= start && a.date <= end),
  );
  const rules = state.rules.filter(
    (r) =>
      (r.periodStart <= state.today && r.periodEnd >= state.today) ||
      r.rule.period === "course",
  );
  const ownAwards = state.awards.filter((a) => a.memberId === state.me.id);
  const personal = (state.personalAwards || []).filter(
    (a) => a.memberId === state.me.id,
  );
  const pinned = state.messages.find(
    (m) => m.status === "sent" && m.important && m.pinned && !m.archivedAt,
  );
  const chart: { date: string; value: number | null }[] = [];
  for (
    let cursor = range === "week" ? start : monday(start);
    cursor <= end;
    cursor = add(cursor, range === "week" ? 1 : 7)
  ) {
    const from = cursor < start ? start : cursor;
    const until =
      range === "week" ? cursor : add(cursor, 6) > end ? end : add(cursor, 6);
    const bucket = summarize(
      own.filter((a) => a.date >= from && a.date <= until),
    );
    chart.push({
      date: cursor,
      value: range === "week" ? bucket.minutes : bucket.movementDays,
    });
  }
  const chartMaximum = Math.max(1, ...chart.map((entry) => entry.value || 0));
  const upcoming = state.challenges.filter(
    (c) =>
      !c.hidden &&
      c.kind !== "cold" &&
      c.status === "published" &&
      c.endDate >= state.today,
  );
  const nextRule = rules.find((r) => !r.progress.complete);
  return (
    <>
      <section className="home-entry" aria-label="Dnešné motto a nová aktivita">
        {state.motto ? (
          <blockquote className="daily-motto">
            <p>„{state.motto.text}“</p>
            <footer>
              <span>{state.motto.author}</span>
              <a href={state.motto.sourceUrl} target="_blank" rel="noreferrer">
                {state.motto.translation
                  ? "zdroj · slovenský preklad"
                  : "zdroj"}
                <ArrowUpRight size={11} />
              </a>
            </footer>
          </blockquote>
        ) : (
          <div className="preparation-period">
            <CalendarDays size={19} />
            <span>
              Príprava {fmt(state.course.startDate)} –{" "}
              {fmt(state.course.endDate, {
                day: "numeric",
                month: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        )}
        <div className="home-entry-action">
          <button
            className="button primary add-activity"
            onClick={onAdd}
            disabled={state.today < state.course.startDate}
          >
            <Plus size={20} />
            Pridať aktivitu
          </button>
          {state.today < state.course.startDate && (
            <small>Začíname {fmt(state.course.startDate)}.</small>
          )}
        </div>
      </section>
      <div className="overview-layout home-dashboard">
        <div className="overview-main">
          {pinned && (
            <section className="pinned-note">
              <button
                className="pinned-message"
                onClick={() => onMessage(pinned.id)}
              >
                <Bell size={21} />
                <span>
                  <small>DÔLEŽITÉ OD ORGANIZÁTOROV</small>
                  <strong>{pinned.title}</strong>
                  <span>
                    {pinned.body.slice(0, 130)}
                    {pinned.body.length > 130 ? "…" : ""}
                  </span>
                </span>
                <ArrowUpRight size={18} />
              </button>
              <button
                className="text-button"
                disabled={archiveBusy}
                onClick={async () => {
                  setArchiveBusy(true);
                  setError("");
                  try {
                    await onAction("archiveMessage", {
                      id: pinned.id,
                      archived: true,
                    });
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Správu sa nepodarilo archivovať.",
                    );
                  } finally {
                    setArchiveBusy(false);
                  }
                }}
              >
                <Check size={15} />
                {archiveBusy
                  ? "Ukladám…"
                  : "Beriem na vedomie · presunúť do archívu"}
              </button>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </section>
          )}
          <section className="panel personal-calendar">
            <div className="section-head">
              <div>
                <p className="eyebrow">TVOJ ZAZNAMENANÝ POHYB</p>
                <h2>{range === "week" ? "Tvoj týždeň" : "Tvoj mesiac"}</h2>
              </div>
              <CalendarDays size={22} />
            </div>
            <CalendarControls
              range={range}
              anchor={anchor}
              today={state.today}
              startDate={state.course.startDate}
              onRange={setRange}
              onAnchor={setAnchor}
            />
            <div className="personal-stat-strip">
              <div>
                <Footprints size={19} />
                <strong>{summary.movementDays}</strong>
                <span>pohybové dni</span>
              </div>
              <div>
                <Clock size={19} />
                <strong>
                  {summary.minutes === null ? "—" : summary.minutes}
                </strong>
                <span>zapísané minúty</span>
              </div>
              <div>
                <Diamond size={19} />
                <strong>
                  {ownAwards.filter(
                    (a) =>
                      a.earnedAt.slice(0, 10) >= start &&
                      a.earnedAt.slice(0, 10) <= end,
                  ).length +
                    personal.filter((a) => a.date >= start && a.date <= end)
                      .length}
                </strong>
                <span>nové odmeny</span>
              </div>
            </div>
            <ActivityCalendar
              range={range}
              anchor={anchor}
              activities={own}
              today={state.today}
              cold={state.cold?.calendar}
              memberId={state.me.id}
              onDay={onDay}
            />
            {summary.missingMinutes > 0 && (
              <p className="small muted">
                {summary.missingMinutes} pohybových zápisov nemá vyplnené
                trvanie; súčet minút je neúplný.
              </p>
            )}
            <div className="home-mini-chart">
              <span>
                {range === "week" ? "Zapísané minúty" : "Pohybové dni"}
                <small>
                  {range === "week"
                    ? "po dňoch vybraného týždňa"
                    : "po týždňoch vybraného mesiaca"}
                </small>
              </span>
              <div
                className="mini-weeks"
                role="img"
                aria-label={chart
                  .map(
                    (entry) =>
                      `${fmt(entry.date)}: ${entry.value ?? "trvanie neuvedené"}${entry.value === null ? "" : range === "week" ? " minút" : " dní"}`,
                  )
                  .join("; ")}
              >
                {chart.map((entry) => (
                  <div key={entry.date}>
                    <strong>{entry.value ?? "—"}</strong>
                    <i
                      style={{
                        height: `${5 + ((entry.value || 0) / chartMaximum) * 35}px`,
                      }}
                    />
                    <small>{fmt(entry.date)}</small>
                  </div>
                ))}
              </div>
            </div>
            <details className="personal-details">
              <summary>Podrobné štatistiky mojej prípravy</summary>
              <Stats
                activities={own}
                today={state.today}
                startDate={state.course.startDate}
                showCalendar={false}
                preferenceKey={`home-stats-${state.me.id}`}
              />
            </details>
          </section>
          <div className="home-cold">
            <ColdPanel state={state} onAction={onAction} />
          </div>
          <Feed
            personal
            state={state}
            activities={own}
            onEdit={onEdit}
            onAction={onAction}
            allowModeration={allowModeration}
          />
        </div>
        <aside className="overview-aside">
          <section className="panel collection-preview">
            <div className="section-head">
              <div>
                <p className="eyebrow">ZA MALÉ AJ VEĽKÉ KROKY</p>
                <h2>Tvoja zbierka</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Otvoriť výzvy a odmeny"
                onClick={() => onNavigate("challenges")}
              >
                <ArrowUpRight size={20} />
              </button>
            </div>
            <div className="gem-line">
              {rules.map((r) => (
                <button
                  key={r.rule.id}
                  title={`${r.rule.name}: ${r.progress.complete ? "získané" : r.progress.missing}`}
                  onClick={() => onNavigate("challenges")}
                >
                  <AwardArt
                    visual={r.rule.visual}
                    rewardKey={r.rule.key}
                    earned={r.progress.complete}
                  />
                  <span>{r.rule.name}</span>
                </button>
              ))}
            </div>
            {personal.length > 0 && (
              <div className="personal-collection-mini">
                {personal.slice(-4).map((a) => (
                  <span key={a.id} title={a.snapshot.name}>
                    <AwardArt
                      visual={a.snapshot.visual}
                      rewardKey={a.definitionId}
                      earned
                    />
                  </span>
                ))}
                <small>{personal.length} osobných ocenení</small>
              </div>
            )}
            <button
              className="text-button teal"
              onClick={() => onNavigate("challenges")}
            >
              Výzvy a odmeny <ArrowRight size={15} />
            </button>
          </section>
          {nextRule && (
            <RuleCard
              item={nextRule}
              index={0}
              state={state}
              onAction={onAction}
              small
            />
          )}
          {upcoming.length > 0 && (
            <section className="panel challenge-preview">
              <p className="eyebrow">OD ORGANIZÁTOROV</p>
              <h2>{upcoming[0].name}</h2>
              <p>{upcoming[0].description.slice(0, 170)}</p>
              <button
                className="text-button teal"
                onClick={() => onNavigate("challenges")}
              >
                Pozrieť výzvu <ArrowRight size={15} />
              </button>
            </section>
          )}
          <div className="course-dates-note">
            <MountainSnow size={23} />
            <div>
              <strong>
                Zimný kurz{" "}
                {state.course.year || state.course.endDate.slice(0, 4)}
              </strong>
              {state.course.eventStartDate && state.course.eventEndDate && (
                <span>
                  {fmt(state.course.eventStartDate)} –{" "}
                  {fmt(state.course.eventEndDate, {
                    day: "numeric",
                    month: "numeric",
                    year: "numeric",
                  })}
                </span>
              )}
              <a href="https://zimnykurz.sk/" target="_blank" rel="noreferrer">
                O kurze <ArrowUpRight size={12} />
              </a>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
