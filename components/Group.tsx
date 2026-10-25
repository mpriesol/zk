"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight, ArrowUpRight } from "lucide-react";
import type { AppState, Activity, Member } from "../lib/types";
import { Avatar, fmt, add, monday, Gem, Modal, Empty, type Action } from "./ui";
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
  const [week, setWeek] = useState(monday(state.today));
  const [detail, setDetail] = useState<{
    member: Member;
    date?: string;
  } | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => add(week, i));
  const members = state.members
    .filter((m) => m.active)
    .sort((a, b) => a.nickname.localeCompare(b.nickname, "sk"));
  return (
    <>
      <section className="panel group-panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">KAŽDÝ SVOJÍM TEMPOM</p>
            <h2>
              Naša skupina{" "}
              <span className="count-text">{members.length} ľudí</span>
            </h2>
          </div>
          <div className="week-switch">
            <button
              className="icon-button"
              aria-label="Predchádzajúci týždeň"
              disabled={add(week, 6) < state.course.startDate}
              onClick={() => setWeek(add(week, -7))}
            >
              <ChevronLeft size={19} />
            </button>
            <strong>
              {fmt(week)} – {fmt(add(week, 6))}
            </strong>
            <button
              className="icon-button"
              aria-label="Nasledujúci týždeň"
              disabled={week >= monday(state.today)}
              onClick={() => setWeek(add(week, 7))}
            >
              <ChevronRight size={19} />
            </button>
          </div>
        </div>
        <p className="muted small">
          Zoradené podľa mena, nie podľa výkonu. Klikni na deň a otvor konkrétne
          zápisy.
        </p>
        <div className="group-matrix">
          <div className="matrix-head">
            <span>Účastník</span>
            {days.map((d, i) => (
              <span key={d}>
                {["Po", "Ut", "St", "Št", "Pi", "So", "Ne"][i]}
                <small>{fmt(d)}</small>
              </span>
            ))}
            <span>Prehľad</span>
          </div>
          {members.map((m) => {
            const acts = state.activities.filter((a) => a.memberId === m.id),
              inWeek = acts.filter(
                (a) => a.date >= week && a.date <= add(week, 6),
              ),
              count = new Set(
                inWeek.filter((a) => a.group !== "task").map((a) => a.date),
              ).size,
              awards = state.awards.filter((a) => a.memberId === m.id);
            return (
              <div className="matrix-row" key={m.id}>
                <button
                  className="member-name"
                  onClick={() => setDetail({ member: m })}
                >
                  <Avatar name={m.nickname} />
                  <span>
                    <strong>
                      {m.nickname}
                      {m.id === state.me.id && <small> ty</small>}
                    </strong>
                    <small>
                      {acts.length
                        ? "Posledný zápis " +
                          fmt(
                            acts
                              .map((a) => a.date)
                              .sort()
                              .at(-1)!,
                          )
                        : "Zatiaľ bez zápisu"}
                    </small>
                  </span>
                </button>
                <div className="mobile-day-labels">
                  {days.map((d, i) => (
                    <span key={d}>
                      {["Po", "Ut", "St", "Št", "Pi", "So", "Ne"][i]}
                    </span>
                  ))}
                </div>
                {days.map((d) => {
                  const n = inWeek.filter((a) => a.date === d).length;
                  return (
                    <button
                      className={`day-cell ${n ? "has-activity" : ""} ${d === state.today ? "today" : ""}`}
                      key={d}
                      aria-label={`${m.nickname}, ${fmt(d)}: ${n ? n + " zápisov" : "bez zápisu"}`}
                      title={`${fmt(d)}: ${n ? n + " zápisov" : "bez zápisu"}`}
                      onClick={() => setDetail({ member: m, date: d })}
                    >
                      {n || "·"}
                    </button>
                  );
                })}
                <div className="member-summary">
                  <strong>
                    {count}
                    <span> pohybové dni</span>
                  </strong>
                  <small>◇ {awards.length} odmien</small>
                </div>
              </div>
            );
          })}
        </div>
        <p className="small muted matrix-legend">
          Bodka = bez zápisu · číslo = počet aktivít v daný deň. Pohybový deň sa
          počíta raz, bez ohľadu na počet tréningov.
        </p>
      </section>
      <Stats
        startDate={state.course.startDate}
        activities={state.activities}
        today={state.today}
        group
      />
      <Feed
        state={state}
        activities={state.activities}
        onEdit={onEdit}
        onAction={onAction}
        allowModeration={allowModeration}
      />
      {detail && (
        <Modal
          title={`${detail.member.nickname}${detail.date ? " · " + fmt(detail.date) : ""}`}
          onClose={() => setDetail(null)}
          wide
        >
          {!detail.date && (
            <Stats
              startDate={state.course.startDate}
              activities={state.activities.filter(
                (a) => a.memberId === detail.member.id,
              )}
              today={state.today}
              onDay={(date) => setDetail({ ...detail, date })}
            />
          )}
          {!detail.date && (
            <section className="panel member-awards">
              <h3>Získané drahokamy</h3>
              {state.awards.some((a) => a.memberId === detail.member.id) ? (
                <div className="award-history">
                  {state.awards
                    .filter((a) => a.memberId === detail.member.id)
                    .map((award, index) => (
                      <div key={award.id}>
                        <Gem earned index={index} />
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
                </div>
              ) : (
                <p className="small muted">Zatiaľ bez získanej odmeny.</p>
              )}
            </section>
          )}
          <Feed
            state={state}
            activities={state.activities.filter(
              (a) =>
                a.memberId === detail.member.id &&
                (!detail.date || a.date === detail.date),
            )}
            onEdit={onEdit}
            onAction={onAction}
            allowModeration={allowModeration}
            compact
          />
        </Modal>
      )}
    </>
  );
}
