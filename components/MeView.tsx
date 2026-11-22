"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  Bell,
  ChevronRight,
  HelpCircle,
  KeyRound,
  LogOut,
  Settings,
  Snowflake,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { Activity, AppState } from "../lib/types";
import { summarize } from "../lib/gamification";
import {
  calendarBounds,
  calendarDays,
  type CalendarRange,
} from "../lib/calendar";
import { Avatar, SportIcon, fmt, add, monday, Modal, type Action } from "./ui";
import { usePreference } from "./preferences";
import ActivityCalendar, { CalendarControls } from "./ActivityCalendar";
import Feed, { formatMinutes, plural } from "./Feed";
import Stats from "./Stats";

function MyWeek({
  state,
  onDay,
}: {
  state: AppState;
  onDay: (day: string) => void;
}) {
  const [range, setRange] = usePreference<CalendarRange>(
    `cz-home-range-${state.course.id}-${state.me.id}`,
    "week",
    ["week", "month"],
  );
  const [anchor, setAnchor] = useState(state.today);
  const own = state.activities.filter((a) => a.memberId === state.me.id);
  const { start, end } = calendarBounds(range, anchor);
  const summary = summarize(
    own.filter((a) => a.date >= start && a.date <= end),
  );
  const newAwards =
    state.awards.filter(
      (a) =>
        a.memberId === state.me.id &&
        a.earnedAt.slice(0, 10) >= start &&
        a.earnedAt.slice(0, 10) <= end,
    ).length +
    (state.personalAwards || []).filter(
      (a) => a.memberId === state.me.id && a.date >= start && a.date <= end,
    ).length;
  const days = calendarDays("week", anchor).days;
  const cold = state.cold?.calendar || [];
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
  return (
    <section className="cz-block cz-myweek" aria-label="Moja príprava">
      <CalendarControls
        range={range}
        anchor={anchor}
        today={state.today}
        startDate={state.course.startDate}
        onRange={setRange}
        onAnchor={setAnchor}
      />
      <div className="cz-numbers">
        <div>
          <strong>{summary.movementDays}</strong>
          <small>
            {plural(
              summary.movementDays,
              "pohybový deň",
              "pohybové dni",
              "pohybových dní",
            )}
          </small>
        </div>
        <div>
          <strong>{summary.minutes === null ? "—" : summary.minutes}</strong>
          <small>minút</small>
        </div>
        <div>
          <strong>{newAwards}</strong>
          <small>
            {plural(newAwards, "nová odmena", "nové odmeny", "nových odmien")}
          </small>
        </div>
      </div>
      {range === "week" ? (
        <div className="cz-week-dots">
          {days.map((date, i) => {
            const items = own.filter(
              (a) => a.date === date && a.group !== "task",
            );
            const isCold = cold.some(
              (c) => c.memberId === state.me.id && c.date === date,
            );
            const label = `${fmt(date, { weekday: "long", day: "numeric", month: "numeric" })}: ${items.length ? items.map((a) => a.typeName).join(", ") : "bez zápisu"}${isCold ? ", otužovanie" : ""}`;
            return (
              <button
                type="button"
                key={date}
                className={`${date === state.today ? "today" : ""}`}
                disabled={date > state.today}
                aria-label={label}
                title={label}
                onClick={() => onDay(date)}
              >
                <span
                  className={`cz-dot ${items.length ? `g-${items.length > 1 ? "mix" : items[0].group}` : "is-empty"}`}
                >
                  {items.length === 1 && (
                    <SportIcon
                      group={items[0].group}
                      typeName={items[0].typeName}
                      size={17}
                    />
                  )}
                  {items.length > 1 && <b>{items.length}</b>}
                  {isCold && (
                    <span className="cz-cell-cold" aria-hidden="true">
                      <Snowflake size={10} />
                    </span>
                  )}
                </span>
                <small>{["Po", "Ut", "St", "Št", "Pi", "So", "Ne"][i]}</small>
              </button>
            );
          })}
        </div>
      ) : (
        <ActivityCalendar
          range="month"
          anchor={anchor}
          activities={own}
          today={state.today}
          cold={cold}
          memberId={state.me.id}
          onDay={onDay}
        />
      )}
      {summary.missingMinutes > 0 && (
        <p className="cz-muted">
          {summary.missingMinutes}{" "}
          {plural(
            summary.missingMinutes,
            "zápis nemá",
            "zápisy nemajú",
            "zápisov nemá",
          )}{" "}
          vyplnené trvanie, súčet minút je neúplný.
        </p>
      )}
      <details className="cz-details inner">
        <summary>Podrobné štatistiky a graf</summary>
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
        <Stats
          activities={own}
          today={state.today}
          startDate={state.course.startDate}
          showCalendar={false}
          preferenceKey={`home-stats-${state.me.id}`}
        />
      </details>
    </section>
  );
}

export default function MeView({
  state,
  onAction,
  onEdit,
  onDay,
  onNavigate,
  onLogout,
  isAdmin,
}: {
  state: AppState;
  onAction: Action;
  onEdit: (a: Activity) => void;
  onDay: (day: string) => void;
  onNavigate: (view: string) => void;
  onLogout: () => void;
  isAdmin: boolean;
}) {
  const [all, setAll] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const own = state.activities
    .filter((a) => a.memberId === state.me.id)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    );
  const shown = all ? own : own.slice(0, 5);
  const openedActivity = own.find((a) => a.id === opened);
  const settings = [
    { view: "profil", label: "Profil, fotka a animácie", icon: UserRound },
    {
      view: "profil#upozornenia",
      label: "Upozornenia na telefóne",
      icon: Bell,
    },
    { view: "profil#heslo", label: "Heslo a prihlásenie", icon: KeyRound },
    { view: "help", label: "Ako na to · návod", icon: HelpCircle },
  ];
  return (
    <div className="cz-me">
      <button
        type="button"
        className="cz-block cz-profile-row"
        onClick={() => onNavigate("profil")}
      >
        <Avatar
          name={state.me.nickname}
          imageUrl={state.me.avatarUrl}
          size="large"
        />
        <span>
          <strong>{state.me.nickname}</strong>
          <small>Upraviť profil a fotku</small>
        </span>
        <ChevronRight size={20} aria-hidden="true" />
      </button>
      <MyWeek state={state} onDay={onDay} />
      <h2 className="cz-section-title">Moje zápisy</h2>
      <div className="cz-block cz-list">
        {own.length === 0 && (
          <p className="cz-muted cz-pad">
            Zatiaľ bez zápisu. Prvý pridáš tlačidlom +.
          </p>
        )}
        {shown.map((a) => {
          const comments = a.comments?.length || 0;
          const support = a.reactions?.length || 0;
          return (
            <button
              type="button"
              className="cz-list-row"
              key={a.id}
              onClick={() => setOpened(a.id)}
            >
              <span className={`cz-type g-${a.group}`} aria-hidden="true">
                <SportIcon group={a.group} typeName={a.typeName} size={18} />
              </span>
              <span>
                <strong>{a.typeName}</strong>
                {a.minutes !== null && ` · ${formatMinutes(a.minutes)}`}
                {a.distance !== null &&
                  ` · ${a.distance.toLocaleString("sk-SK")} km`}
                <small>
                  {fmt(a.date, {
                    weekday: "short",
                    day: "numeric",
                    month: "numeric",
                  })}
                  {support > 0 &&
                    ` · ${support} ${plural(support, "podpora", "podpory", "podpôr")}`}
                  {comments > 0 &&
                    ` · ${comments} ${plural(comments, "komentár", "komentáre", "komentárov")}`}
                </small>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          );
        })}
        {own.length > 5 && (
          <button
            type="button"
            className="cz-list-row more"
            onClick={() => setAll(!all)}
          >
            {all ? "Zobraziť menej" : `Všetky moje zápisy (${own.length})`}
          </button>
        )}
      </div>
      <h2 className="cz-section-title">Nastavenia</h2>
      <div className="cz-block cz-list">
        {settings.map((s) => (
          <button
            type="button"
            className="cz-list-row"
            key={s.view}
            onClick={() => onNavigate(s.view)}
          >
            <s.icon size={19} aria-hidden="true" />
            <span>{s.label}</span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        ))}
        {isAdmin && (
          <button
            type="button"
            className="cz-list-row"
            onClick={() => onNavigate("admin")}
          >
            <Settings size={19} aria-hidden="true" />
            <span>Administrácia</span>
            {!!state.pendingAccounts && (
              <span
                className="cz-badge"
                aria-label={`${state.pendingAccounts} čakajúcich žiadostí`}
              >
                {state.pendingAccounts}
              </span>
            )}
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        )}
        <button type="button" className="cz-list-row danger" onClick={onLogout}>
          <LogOut size={19} aria-hidden="true" />
          <span>Odhlásiť sa</span>
        </button>
      </div>
      <div className="cz-course-info">
        <Sparkles size={18} aria-hidden="true" />
        <span>
          Príprava {fmt(state.course.startDate)} –{" "}
          {fmt(state.course.endDate, {
            day: "numeric",
            month: "numeric",
            year: "numeric",
          })}
          {state.course.eventStartDate && state.course.eventEndDate && (
            <>
              <br />
              Zimný kurz {state.course.year || state.course.endDate.slice(0, 4)}
              : {fmt(state.course.eventStartDate)} –{" "}
              {fmt(state.course.eventEndDate, {
                day: "numeric",
                month: "numeric",
                year: "numeric",
              })}
            </>
          )}
          <br />
          <a href="https://zimnykurz.sk/" target="_blank" rel="noreferrer">
            O kurze na zimnykurz.sk{" "}
            <ArrowUpRight size={12} aria-hidden="true" />
          </a>
        </span>
      </div>
      {openedActivity && (
        <Modal title="Môj zápis" onClose={() => setOpened(null)}>
          <Feed
            state={state}
            activities={[openedActivity]}
            onEdit={(a) => {
              setOpened(null);
              onEdit(a);
            }}
            onAction={onAction}
            allowModeration={false}
          />
        </Modal>
      )}
    </div>
  );
}
