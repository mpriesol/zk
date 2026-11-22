"use client";
import { useRef, useState } from "react";
import {
  Camera,
  ChevronRight,
  Heart,
  MessageCircle,
  Snowflake,
} from "lucide-react";
import type { AppState, Activity, Member } from "../lib/types";
import {
  calendarBounds,
  calendarDays,
  moveCalendar,
  type CalendarRange,
} from "../lib/calendar";
import { Avatar, SportIcon, fmt, add, Modal, type Action } from "./ui";
import { usePreference } from "./preferences";
import { CalendarControls } from "./ActivityCalendar";
import AwardArt from "./AwardArt";
import ColdPanel from "./ColdPanel";
import Feed, { plural } from "./Feed";
import Stats from "./Stats";

/** Sport icons for one day: one large icon, two small ones, or two and "+N". */
export function DayIcons({ items }: { items: Activity[] }) {
  if (!items.length) return null;
  if (items.length === 1)
    return (
      <SportIcon
        group={items[0].group}
        typeName={items[0].typeName}
        size={16}
      />
    );
  return (
    <span className="cz-day-icons">
      {items.slice(0, 2).map((a) => (
        <SportIcon key={a.id} group={a.group} typeName={a.typeName} size={12} />
      ))}
      {items.length > 2 && <small>+{items.length - 2}</small>}
    </span>
  );
}
/** Corner marks: snowflake, photo, comment and own support. */
export function DayMarks({
  items,
  cold,
  meId,
}: {
  items: Activity[];
  cold: boolean;
  meId: string;
}) {
  const photo = items.some((a) => (a.photos?.length || 0) > 0);
  const comment = items.some((a) => (a.comments?.length || 0) > 0);
  const liked = items.some((a) => a.reactions?.includes(meId));
  return (
    <>
      {cold && (
        <span className="cz-mark tr cold" aria-hidden="true">
          <Snowflake size={9} />
        </span>
      )}
      {photo && (
        <span className="cz-mark tl" aria-hidden="true">
          <Camera size={9} />
        </span>
      )}
      {comment && (
        <span className="cz-mark bl" aria-hidden="true">
          <MessageCircle size={9} />
        </span>
      )}
      {liked && (
        <span className="cz-mark br liked" aria-hidden="true">
          <Heart size={9} fill="currentColor" />
        </span>
      )}
    </>
  );
}
/** Horizontal swipe on touch screens: right = earlier period, left = later. */
function useSwipe(onPrevious: () => void, onNext: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (event: React.TouchEvent) => {
      const t = event.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
    },
    onTouchEnd: (event: React.TouchEvent) => {
      const from = start.current;
      start.current = null;
      if (!from) return;
      const t = event.changedTouches[0];
      const dx = t.clientX - from.x,
        dy = t.clientY - from.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx > 0) onPrevious();
      else onNext();
    },
  };
}

/** One member's preparation: stats, calendar, awards and entries. */
export function MemberDetail({
  state,
  member,
  date,
  onDate,
  onClose,
  onEdit,
  onAction,
  allowModeration,
}: {
  state: AppState;
  member: Member;
  date?: string;
  onDate: (date?: string) => void;
  onClose: () => void;
  onEdit: (a: Activity) => void;
  onAction: Action;
  allowModeration: boolean;
}) {
  const key = `${state.course.id}-${state.me.id}`;
  const awards = state.awards.filter((a) => a.memberId === member.id);
  const personal = (state.personalAwards || []).filter(
    (a) => a.memberId === member.id,
  );
  return (
    <Modal
      title={`${member.nickname}${date ? " · " + fmt(date, { weekday: "short", day: "numeric", month: "numeric" }) : ""}`}
      onClose={onClose}
      wide
    >
      {date && (
        <button type="button" className="cz-link" onClick={() => onDate()}>
          ← Celá príprava
        </button>
      )}
      {date &&
        state.cold?.calendar.some(
          (c) => c.memberId === member.id && c.date === date,
        ) && (
          <p className="cold-day-note">
            <Snowflake size={18} />V tento deň pribudla aj vločka za otužovanie.
          </p>
        )}
      {!date && (
        <>
          <Stats
            startDate={state.course.startDate}
            activities={state.activities.filter(
              (a) => a.memberId === member.id,
            )}
            today={state.today}
            cold={state.cold?.calendar}
            memberId={member.id}
            preferenceKey={`member-${key}-${member.id}`}
            onDay={(day) => onDate(day)}
          />
          <section className="cz-member-awards">
            <h3>Získané odmeny</h3>
            {awards.length + personal.length === 0 ? (
              <p className="small muted">Zatiaľ bez získanej odmeny.</p>
            ) : (
              <div className="award-history">
                {awards.map((award) => (
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
                    </span>
                  </div>
                ))}
                {personal.map((award) => (
                  <div key={award.id}>
                    <AwardArt
                      earned
                      visual={award.snapshot.visual}
                      rewardKey={award.definitionId}
                    />
                    <span>
                      <strong>{award.snapshot.name}</strong>
                      <small>{fmt(award.date)}</small>
                      {award.reason && (
                        <p className="small muted">{award.reason}</p>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      <Feed
        state={state}
        activities={state.activities.filter(
          (a) => a.memberId === member.id && (!date || a.date === date),
        )}
        onEdit={(activity) => {
          onClose();
          onEdit(activity);
        }}
        onAction={onAction}
        allowModeration={allowModeration}
        emptyTitle={date ? "V tento deň bez zápisu" : "Zatiaľ bez zápisu"}
      />
    </Modal>
  );
}

export default function Overview({
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
  const { start, end } = calendarBounds(range, anchor);
  const previous = calendarBounds(range, moveCalendar(range, anchor, -1));
  const next = calendarBounds(range, moveCalendar(range, anchor, 1));
  const [slide, setSlide] = useState("");
  const swipe = useSwipe(
    () => {
      if (previous.end < state.course.startDate) return;
      setSlide("from-left");
      setAnchor(moveCalendar(range, anchor, -1));
    },
    () => {
      if (next.start > state.today) return;
      setSlide("from-right");
      setAnchor(moveCalendar(range, anchor, 1));
    },
  );
  const weekDays = calendarDays("week", anchor).days;
  const monthDays: string[] = [];
  for (let d = start; d <= end; d = add(d, 1)) monthDays.push(d);
  const members = [...state.members]
    .filter((m) => m.active)
    .sort((a, b) => a.nickname.localeCompare(b.nickname, "sk"));
  const inRange = state.activities.filter(
    (a) => a.date >= start && a.date <= end && a.group !== "task",
  );
  const activePeople = new Set(inRange.map((a) => a.memberId)).size;
  const coldPeople = new Set(
    (state.cold?.calendar || [])
      .filter((c) => c.date >= start && c.date <= end)
      .map((c) => c.memberId),
  ).size;
  const hasCold = (memberId: string, date: string) =>
    !!state.cold?.calendar.some(
      (c) => c.memberId === memberId && c.date === date,
    );
  return (
    <div className="cz-overview">
      <section className="cz-block cz-overview-head">
        <CalendarControls
          range={range}
          anchor={anchor}
          today={state.today}
          startDate={state.course.startDate}
          onRange={setRange}
          onAnchor={setAnchor}
        />
        <p className="cz-overview-summary">
          <strong>
            {activePeople} z {members.length}{" "}
            {plural(members.length, "človeka", "ľudí", "ľudí")}
          </strong>{" "}
          sa {range === "week" ? "tento týždeň" : "tento mesiac"} hýbalo ·{" "}
          {inRange.length}{" "}
          {plural(inRange.length, "aktivita", "aktivity", "aktivít")}
          {state.cold && (
            <>
              <br />
              <span className="cz-cold-text">
                Otužovanie: {coldPeople}{" "}
                {plural(coldPeople, "človek", "ľudia", "ľudí")}
              </span>
            </>
          )}
        </p>
      </section>
      {range === "week" ? (
        <section
          className={`cz-block cz-people ${slide}`}
          key={`week-${start}`}
          aria-label="Týždeň po ľuďoch"
          onAnimationEnd={() => setSlide("")}
          {...swipe}
        >
          <div className="cz-people-head" aria-hidden="true">
            <span>Podľa mena</span>
            {weekDays.map((d, i) => (
              <span key={d} className={d === state.today ? "today" : ""}>
                {["Po", "Ut", "St", "Št", "Pi", "So", "Ne"][i]}
              </span>
            ))}
            <span>dni</span>
          </div>
          {members.map((member) => {
            const own = state.activities.filter(
              (a) => a.memberId === member.id && a.group !== "task",
            );
            const days = new Set(
              own.filter((a) => weekDays.includes(a.date)).map((a) => a.date),
            ).size;
            return (
              <div className="cz-person-row" key={member.id}>
                <button
                  type="button"
                  className="cz-person-name"
                  onClick={() => setDetail({ member })}
                >
                  <Avatar
                    name={member.nickname}
                    imageUrl={member.avatarUrl}
                    size="small"
                  />
                  <span>
                    {member.nickname}
                    {member.id === state.me.id && <small> · ty</small>}
                  </span>
                </button>
                {weekDays.map((date) => {
                  const items = own.filter((a) => a.date === date);
                  const cold = hasCold(member.id, date);
                  const label = `${member.nickname}, ${fmt(date, { weekday: "long", day: "numeric", month: "numeric" })}: ${items.length ? items.map((a) => a.typeName).join(", ") : "bez zápisu"}${cold ? ", otužovanie" : ""}`;
                  const group = items[0]?.group || "none";
                  return (
                    <button
                      type="button"
                      key={date}
                      className={`cz-cell ${items.length ? `g-${items.every((a) => a.group === group) ? group : "mix"}` : "is-empty"} ${date === state.today ? "today" : ""}`}
                      disabled={date > state.today}
                      aria-label={label}
                      title={label}
                      onClick={() => setDetail({ member, date })}
                    >
                      <DayIcons items={items} />
                      <DayMarks items={items} cold={cold} meId={state.me.id} />
                    </button>
                  );
                })}
                <strong className="cz-days">{days || "–"}</strong>
              </div>
            );
          })}
        </section>
      ) : (
        <section
          className="cz-block cz-people month"
          aria-label="Mesiac po ľuďoch"
        >
          {members.map((member) => {
            const own = new Set(
              state.activities
                .filter(
                  (a) =>
                    a.memberId === member.id &&
                    a.group !== "task" &&
                    a.date >= start &&
                    a.date <= end,
                )
                .map((a) => a.date),
            );
            return (
              <button
                type="button"
                className="cz-month-row"
                key={member.id}
                onClick={() => setDetail({ member })}
              >
                <span className="cz-person-name">
                  <Avatar
                    name={member.nickname}
                    imageUrl={member.avatarUrl}
                    size="small"
                  />
                  <span>
                    {member.nickname}
                    {member.id === state.me.id && <small> · ty</small>}
                  </span>
                </span>
                <span
                  className="cz-strip"
                  role="img"
                  aria-label={`Pohybové dni v mesiaci: ${own.size}`}
                >
                  {monthDays.map((d) => (
                    <i
                      key={d}
                      className={`${own.has(d) ? "on" : ""} ${hasCold(member.id, d) ? "cold" : ""} ${d > state.today ? "future" : ""}`}
                    />
                  ))}
                </span>
                <strong className="cz-days">{own.size || "–"}</strong>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            );
          })}
        </section>
      )}
      <p className="cz-legend">
        <span className="cz-swipe-hint">
          Potiahni prstom doľava alebo doprava pre iný{" "}
          {range === "week" ? "týždeň" : "mesiac"}.
        </span>
        <span>
          <i className="g-foot" /> pohyb po vlastných
        </span>
        <span>
          <i className="g-exercise" /> cvičenie
        </span>
        <span>
          <i className="g-other" /> iné
        </span>
        {state.cold && (
          <span className="cz-cold-text">
            <Snowflake size={12} /> otužovanie
          </span>
        )}
        <span>
          <Camera size={12} /> fotka
        </span>
        <span>
          <MessageCircle size={12} /> komentár
        </span>
        <span>
          <Heart size={12} fill="currentColor" className="cz-liked" /> tvoja
          podpora
        </span>
      </p>
      {state.cold && (
        <div className="cz-block-wrap">
          <ColdPanel state={state} onAction={onAction} />
        </div>
      )}
      <details className="cz-block cz-details">
        <summary>Spoločné štatistiky prípravy</summary>
        <Stats
          startDate={state.course.startDate}
          activities={state.activities}
          today={state.today}
          group
          preferenceKey={`group-stats-${key}`}
        />
      </details>
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
