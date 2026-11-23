"use client";
import { useState } from "react";
import { Bell, Check, ChevronRight, Snowflake } from "lucide-react";
import type { Activity, AppState, Member } from "../lib/types";
import { Avatar, SportIcon, fmt, add, monday, type Action } from "./ui";
import Feed, { plural } from "./Feed";
import { MemberDetail } from "./Overview";
import { SetupReminder } from "./AppSetup";

function TodaySummary({
  state,
  onPerson,
  onOverview,
}: {
  state: AppState;
  onPerson: (memberId: string) => void;
  onOverview: () => void;
}) {
  const today = state.today;
  const members = state.members.filter((m) => m.active);
  const movement = state.activities.filter((a) => a.group !== "task");
  const todays = movement.filter((a) => a.date === today);
  const peopleIds = [...new Set(todays.map((a) => a.memberId))];
  const byType = new Map<
    string,
    { name: string; group: Activity["group"]; count: number }
  >();
  for (const a of todays) {
    const item = byType.get(a.typeId) || {
      name: a.typeName,
      group: a.group,
      count: 0,
    };
    item.count += 1;
    byType.set(a.typeId, item);
  }
  const types = [...byType.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, "sk"),
  );
  const coldToday = state.cold?.daily.find((d) => d.date === today)?.people;
  const week = monday(today);
  const weekDays = Array.from({ length: 7 }, (_, i) => add(week, i));
  const weekMovement = movement.filter(
    (a) => a.date >= week && a.date <= today,
  );
  const weekPeople = new Set(weekMovement.map((a) => a.memberId)).size;
  const perDay = weekDays.map(
    (d) =>
      new Set(movement.filter((a) => a.date === d).map((a) => a.memberId)).size,
  );
  const max = Math.max(1, ...perDay);
  const people = peopleIds
    .map(
      (id) =>
        members.find((m) => m.id === id) ||
        state.members.find((m) => m.id === id),
    )
    .filter((m): m is Member => !!m)
    .sort((a, b) => (a.id === state.me.id ? -1 : b.id === state.me.id ? 1 : 0));
  const names = people.map((m) => (m.id === state.me.id ? "ty" : m.nickname));
  const namesText =
    names.length <= 3
      ? names.join(", ").replace(/, ([^,]*)$/, " a $1")
      : `${names.slice(0, 2).join(", ")} a ${plural(names.length - 2, "ďalší", "ďalší", "ďalších")} ${names.length - 2}`;
  return (
    <section className="cz-block cz-today" aria-label="Dnes v skupine">
      <div className="cz-today-head">
        <h2>Dnes v skupine</h2>
        <span>
          {fmt(today, { weekday: "long", day: "numeric", month: "numeric" })}
        </span>
      </div>
      <div className="cz-numbers">
        <div>
          <strong>{peopleIds.length}</strong>
          <small>
            {plural(
              peopleIds.length,
              "účastník sa hýbal",
              "účastníci sa hýbali",
              "účastníkov sa hýbalo",
            )}
          </small>
        </div>
        <div>
          <strong>{todays.length}</strong>
          <small>
            {plural(todays.length, "aktivita", "aktivity", "aktivít")}
          </small>
        </div>
        {coldToday !== undefined && (
          <div className="cold">
            <strong>{coldToday}</strong>
            <small>otužovanie</small>
          </div>
        )}
      </div>
      {types.length > 0 && (
        <div className="cz-type-chips">
          {types.map((t) => (
            <span key={t.name} className={`cz-type-chip g-${t.group}`}>
              <SportIcon group={t.group} typeName={t.name} size={16} />
              {t.name} {t.count}
            </span>
          ))}
          {!!coldToday && (
            <span className="cz-type-chip cold">
              <Snowflake size={16} aria-hidden="true" />
              Otužovanie {coldToday}
            </span>
          )}
        </div>
      )}
      {people.length > 0 ? (
        <div className="cz-today-people">
          <span className="cz-stack">
            {people.slice(0, 6).map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => onPerson(m.id)}
                aria-label={`Príprava: ${m.nickname}`}
              >
                <Avatar name={m.nickname} imageUrl={m.avatarUrl} size="small" />
              </button>
            ))}
          </span>
          <span>
            {namesText.charAt(0).toLocaleUpperCase("sk") + namesText.slice(1)}
          </span>
        </div>
      ) : (
        <p className="cz-muted">Dnes ešte nikto nič nezapísal.</p>
      )}
      <button type="button" className="cz-week-line" onClick={onOverview}>
        <span>
          <strong>
            Tento týždeň {weekPeople} z {members.length}{" "}
            {plural(members.length, "účastníka", "účastníkov", "účastníkov")}
          </strong>
          <small>
            sa aspoň raz hýbalo · {weekMovement.length}{" "}
            {plural(weekMovement.length, "aktivita", "aktivity", "aktivít")}
          </small>
        </span>
        <span
          className="cz-bars"
          role="img"
          aria-label={`Počet účastníkov s pohybom po dňoch: ${weekDays.map((d, i) => `${fmt(d, { weekday: "short" })} ${perDay[i]}`).join(", ")}`}
        >
          {weekDays.map((d, i) => (
            <span
              key={d}
              className={d === today ? "today" : d > today ? "future" : ""}
            >
              <i style={{ height: `${4 + (perDay[i] / max) * 26}px` }} />
              <small>{["P", "U", "S", "Š", "P", "S", "N"][i]}</small>
            </span>
          ))}
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </section>
  );
}

export default function Together({
  state,
  onEdit,
  onAction,
  allowModeration,
  onMessage,
  onNavigate,
  focusActivity = null,
}: {
  state: AppState;
  onEdit: (a: Activity) => void;
  onAction: Action;
  allowModeration: boolean;
  onMessage: (id: string) => void;
  onNavigate: (view: string) => void;
  focusActivity?: string | null;
}) {
  const missingFocus =
    !!focusActivity && !state.activities.some((a) => a.id === focusActivity);
  const [detail, setDetail] = useState<{
    member: Member;
    date?: string;
  } | null>(null);
  const [archiving, setArchiving] = useState(false),
    [archiveError, setArchiveError] = useState("");
  const pinned = state.messages.find(
    (m) => m.status === "sent" && m.important && m.pinned && !m.archivedAt,
  );
  const openPerson = (memberId: string) => {
    const member = state.members.find((m) => m.id === memberId);
    if (member) setDetail({ member });
  };
  return (
    <div className="cz-together">
      {pinned && (
        <div className="cz-pinned-wrap">
          <button
            type="button"
            className="cz-pinned"
            onClick={() => onMessage(pinned.id)}
          >
            <Bell size={18} aria-hidden="true" />
            <span>
              <strong>Od organizátorov:</strong> {pinned.title}
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="cz-pinned-archive"
            disabled={archiving}
            aria-label="Beriem na vedomie, presunúť do môjho archívu"
            title="Beriem na vedomie · do archívu"
            onClick={async () => {
              setArchiving(true);
              setArchiveError("");
              try {
                await onAction("archiveMessage", {
                  id: pinned.id,
                  archived: true,
                });
              } catch (e) {
                setArchiveError(
                  e instanceof Error
                    ? e.message
                    : "Správu sa nepodarilo archivovať.",
                );
              } finally {
                setArchiving(false);
              }
            }}
          >
            <Check size={18} aria-hidden="true" />
          </button>
        </div>
      )}
      {archiveError && (
        <p className="error" role="alert">
          {archiveError}
        </p>
      )}
      <SetupReminder state={state} onOpen={() => onNavigate("ja#appka")} />
      <TodaySummary
        state={state}
        onPerson={openPerson}
        onOverview={() => onNavigate("prehlad")}
      />
      {state.motto && (
        <p className="cz-motto">
          <q>{state.motto.text}</q> · {state.motto.author}
        </p>
      )}
      {missingFocus && (
        <p className="info-note" role="status">
          Táto aktivita už nie je dostupná. Možno ju autor medzitým zmazal.
        </p>
      )}
      <Feed
        stream
        focusId={focusActivity}
        state={state}
        activities={state.activities}
        onEdit={onEdit}
        onAction={onAction}
        allowModeration={allowModeration}
        onPerson={openPerson}
        emptyTitle="Zatiaľ bez spoločných zápisov"
      />
      {detail && (
        <MemberDetail
          state={state}
          member={detail.member}
          date={detail.date}
          onDate={(date) => setDetail({ ...detail, date })}
          onClose={() => setDetail(null)}
          onEdit={onEdit}
          onAction={onAction}
          allowModeration={allowModeration}
        />
      )}
    </div>
  );
}
