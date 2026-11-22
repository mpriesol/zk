"use client";
import { useState } from "react";
import { ArrowUpRight, Snowflake } from "lucide-react";
import type { AppState, Activity, Member } from "../lib/types";
import {
  calendarBounds,
  calendarDays,
  type CalendarRange,
} from "../lib/calendar";
import { Avatar, fmt, Modal, type Action } from "./ui";
import { usePreference } from "./preferences";
import ActivityCalendar, {
  ActivityDay,
  CalendarControls,
} from "./ActivityCalendar";
import AwardArt from "./AwardArt";
import Feed from "./Feed";
import Stats from "./Stats";

export default function Group({
  state,
  onEdit,
  onAction,
  allowModeration = true,
}: {
  state: AppState;
  onEdit: (a: Activity) => void;
  onAction: Action;
  allowModeration?: boolean;
}) {
  const key = `${state.course.id}-${state.me.id}`;
  const [tab, setTab] = usePreference<"activities" | "overview">(
    `cz-group-tab-${key}`,
    "activities",
    ["activities", "overview"],
  );
  const [range, setRange] = usePreference<CalendarRange>(
    `cz-group-range-${key}`,
    "week",
    ["week", "month"],
  );
  const [anchor, setAnchor] = useState(state.today);
  const [detail, setDetail] = useState<{
    member: Member;
    date?: string;
  } | null>(null);
  const days = calendarDays("week", anchor).days;
  const { start, end } = calendarBounds(range, anchor);
  const members = [...state.members]
    .filter((m) => m.active)
    .sort((a, b) => a.nickname.localeCompare(b.nickname, "sk"));
  function name(member: Member) {
    return (
      <button className="person-heading" onClick={() => setDetail({ member })}>
        <Avatar name={member.nickname} imageUrl={member.avatarUrl} />
        <span>
          <strong>
            {member.nickname}
            {member.id === state.me.id && <small> · ty</small>}
          </strong>
          <small>Pozrieť prípravu</small>
        </span>
        <ArrowUpRight size={16} />
      </button>
    );
  }
  return (
    <>
      <div className="group-navigation">
        <div
          className="segmented large"
          role="group"
          aria-label="Zobrazenie skupiny"
        >
          <button
            aria-pressed={tab === "activities"}
            onClick={() => setTab("activities")}
          >
            Aktivity
          </button>
          <button
            aria-pressed={tab === "overview"}
            onClick={() => setTab("overview")}
          >
            Prehľad
          </button>
        </div>
        <span className="small muted">
          {members.length} ľudí na spoločnej ceste
        </span>
      </div>
      {tab === "activities" ? (
        <Feed
          state={state}
          activities={state.activities}
          onEdit={onEdit}
          onAction={onAction}
          allowModeration={allowModeration}
        />
      ) : (
        <>
          <section className="panel group-calendar-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">KAŽDÝ SVOJÍM TEMPOM</p>
                <h2>Naša skupina</h2>
              </div>
            </div>
            <CalendarControls
              range={range}
              anchor={anchor}
              today={state.today}
              startDate={state.course.startDate}
              onRange={setRange}
              onAnchor={setAnchor}
            />
            <p className="small muted">
              Ľudia sú zoradení podľa prezývky. Klepnutím na deň otvoríš
              aktivity a komentáre.
            </p>
            {range === "week" ? (
              <div className="people-week-grid">
                <div className="people-week-head">
                  <span>Účastník</span>
                  {days.map((d, i) => (
                    <span key={d}>
                      {["Po", "Ut", "St", "Št", "Pi", "So", "Ne"][i]}
                      <small>{fmt(d)}</small>
                    </span>
                  ))}
                </div>
                {members.map((member) => (
                  <div className="person-week" key={member.id}>
                    {name(member)}
                    <div className="person-week-days">
                      {days.map((date) => (
                        <ActivityDay
                          key={date}
                          date={date}
                          today={state.today}
                          memberName={member.nickname}
                          activities={state.activities.filter(
                            (a) => a.memberId === member.id && a.date === date,
                          )}
                          cold={state.cold?.calendar.some(
                            (c) => c.memberId === member.id && c.date === date,
                          )}
                          disabled={date > state.today}
                          onClick={() => setDetail({ member, date })}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="people-month-grid">
                {members.map((member) => {
                  const activities = state.activities.filter(
                    (a) => a.memberId === member.id,
                  );
                  const count = new Set(
                    activities
                      .filter(
                        (a) =>
                          a.group !== "task" &&
                          a.date >= start &&
                          a.date <= end,
                      )
                      .map((a) => a.date),
                  ).size;
                  return (
                    <section className="person-month" key={member.id}>
                      {name(member)}
                      <ActivityCalendar
                        activities={activities}
                        range="month"
                        anchor={anchor}
                        today={state.today}
                        cold={state.cold?.calendar}
                        memberId={member.id}
                        onDay={(date) => setDetail({ member, date })}
                      />
                      <p className="small muted">
                        Pohybové dni v mesiaci: {count}
                      </p>
                    </section>
                  );
                })}
              </div>
            )}
          </section>
          <details className="panel group-details">
            <summary>Spoločné štatistiky prípravy</summary>
            <Stats
              startDate={state.course.startDate}
              activities={state.activities}
              today={state.today}
              group
              preferenceKey={`group-stats-${key}`}
            />
          </details>
        </>
      )}
      {detail && (
        <Modal
          title={`${detail.member.nickname}${detail.date ? " · " + fmt(detail.date) : ""}`}
          onClose={() => setDetail(null)}
          wide
        >
          {detail.date &&
            state.cold?.calendar.some(
              (c) => c.memberId === detail.member.id && c.date === detail.date,
            ) && (
              <p className="cold-day-note">
                <Snowflake size={18} />V tento deň pribudla aj vločka za
                otužovanie.
              </p>
            )}
          {!detail.date && (
            <>
              <Stats
                startDate={state.course.startDate}
                activities={state.activities.filter(
                  (a) => a.memberId === detail.member.id,
                )}
                today={state.today}
                cold={state.cold?.calendar}
                memberId={detail.member.id}
                preferenceKey={`member-${key}-${detail.member.id}`}
                onDay={(date) => setDetail({ ...detail, date })}
              />
              <section className="panel member-awards">
                <h3>Získané odmeny</h3>
                <div className="award-history">
                  {state.awards
                    .filter((a) => a.memberId === detail.member.id)
                    .map((award) => (
                      <div key={award.id}>
                        <AwardArt
                          earned
                          visual={award.visual || award.snapshot.visual}
                          rewardKey={award.ruleKey}
                        />
                        <span>
                          <strong>{award.name}</strong>
                          <small>
                            {fmt(award.periodStart)} – {fmt(award.periodEnd)}
                          </small>
                          <p className="small muted">
                            {award.snapshot.description}
                          </p>
                        </span>
                      </div>
                    ))}
                  {(state.personalAwards || [])
                    .filter((a) => a.memberId === detail.member.id)
                    .map((award) => (
                      <div key={award.id}>
                        <AwardArt
                          earned
                          visual={award.snapshot.visual}
                          rewardKey={award.definitionId}
                        />
                        <span>
                          <strong>{award.snapshot.name}</strong>
                          <small>{fmt(award.date)}</small>
                          <p className="small muted">
                            {award.reason || award.snapshot.description}
                          </p>
                        </span>
                      </div>
                    ))}
                  {!state.awards.some((a) => a.memberId === detail.member.id) &&
                    !(state.personalAwards || []).some(
                      (a) => a.memberId === detail.member.id,
                    ) && (
                      <p className="small muted">Zatiaľ bez získanej odmeny.</p>
                    )}
                </div>
              </section>
            </>
          )}
          <Feed
            state={state}
            activities={state.activities.filter(
              (a) =>
                a.memberId === detail.member.id &&
                (!detail.date || a.date === detail.date),
            )}
            onEdit={(activity) => {
              setDetail(null);
              onEdit(activity);
            }}
            onAction={onAction}
            allowModeration={allowModeration}
            compact
          />
        </Modal>
      )}
    </>
  );
}
