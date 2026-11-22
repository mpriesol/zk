"use client";
import { useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type {
  AppState,
  RuleProgress,
  Challenge,
  Condition,
  RewardVisual,
} from "../lib/types";
const hasManual = (c: Condition): boolean =>
  c.kind === "manual" ||
  (c.kind === "combination" && c.conditions.some(hasManual));
import { Gem, fmt, Modal, Empty, type Action } from "./ui";
import AwardArt from "./AwardArt";
import PersonalAwards from "./PersonalAwards";
import AwardHistory from "./AwardHistory";
export function RuleCard({
  item,
  index,
  state,
  onAction,
  small = false,
}: {
  item: RuleProgress;
  index: number;
  state: AppState;
  onAction: Action;
  small?: boolean;
}) {
  const [detail, setDetail] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const p = item.progress,
    r = item.rule;
  const combination =
    r.condition.kind === "combination" ? r.condition.conditions : [];
  const footPart = combination.find(
    (part) =>
      part.kind === "activities" &&
      part.groups?.length === 1 &&
      part.groups[0] === "foot",
  );
  const exercisePart = combination.find(
    (part) =>
      part.kind === "activities" &&
      part.groups?.length === 1 &&
      part.groups[0] === "exercise",
  );
  return (
    <article
      className={`reward-card ${p.complete ? "complete" : ""} ${small ? "small-card" : ""}`}
    >
      <div className="reward-title">
        <AwardArt earned={p.complete} visual={r.visual} rewardKey={r.key} />
        <div>
          <span className="cz-kicker">
            {r.period === "week" ? "Týždenná odmena" : "Raz za prípravu"}
          </span>
          <h3>{r.name}</h3>
        </div>
        {p.complete && (
          <span className="pill success">
            <Check size={12} /> Získané
          </span>
        )}
      </div>
      <p>{r.description}</p>
      {r.key === "variety" &&
        combination.length === 2 &&
        footPart?.kind === "activities" &&
        exercisePart?.kind === "activities" && (
          <p className="small muted">
            Potrebuješ {footPart.count} samostatné zápisy chôdze, turistiky
            alebo behu
            {footPart.minMinutes
              ? ` (aspoň ${footPart.minMinutes} min každý)`
              : ""}{" "}
            a {exercisePart.count} zápisy cvičenia
            {exercisePart.minMinutes
              ? ` (aspoň ${exercisePart.minMinutes} min každý)`
              : ""}
            . Rôzne športy sa nevyžadujú. Aktivity zo skupiny Iné sa do tejto
            odmeny nepočítajú.
          </p>
        )}
      <div className="progress-label">
        <span>{p.complete ? "Podmienka splnená" : p.missing}</span>
        <strong>
          {p.current} / {p.target}
        </strong>
      </div>
      <progress
        value={Math.min(p.current, p.target)}
        max={Math.max(1, p.target)}
        aria-label={`${r.name}: ${p.current} z ${p.target}`}
      />
      <button
        className="text-button reward-detail"
        onClick={() => setDetail(!detail)}
        aria-expanded={detail}
      >
        Za čo sa počíta <ChevronDown size={14} />
      </button>
      {detail && (
        <div className="rule-explanation">
          <p>{p.explanation}</p>
          <p className="small">
            Obdobie {fmt(item.periodStart)} – {fmt(item.periodEnd)} vrátane.{" "}
            {r.period === "week"
              ? "Najviac jedna odmena za týždeň."
              : "Najviac jedna odmena za prípravu."}
          </p>
          {p.countedActivityIds.length > 0 ? (
            <ul>
              {p.countedActivityIds.map((id) => {
                const a = state.activities.find((a) => a.id === id);
                return a ? (
                  <li key={id}>
                    {fmt(a.date)} · {a.typeName}
                    {a.minutes !== null ? ` · ${a.minutes} min` : ""}
                  </li>
                ) : null;
              })}
            </ul>
          ) : (
            <p className="small muted">
              Zatiaľ sa nezapočítal žiadny pohybový zápis.
            </p>
          )}
        </div>
      )}
      {r.condition.kind === "manual" && (
        <button
          className={`button ${p.complete ? "secondary" : "primary"} full-width`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onAction("completeGear", {
                completed: !p.complete,
                note: "Skontrolovaná osobná výbava a spísané chýbajúce alebo požičané veci.",
              });
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Zmenu sa nepodarilo uložiť.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? "Ukladám…"
            : p.complete
              ? "Zrušiť potvrdenie"
              : "Výbavu som skontroloval/a"}
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
function ChallengeCard({
  c,
  state,
  onAction,
}: {
  c: Challenge;
  state: AppState;
  onAction: Action;
}) {
  const [open, setOpen] = useState(false),
    [note, setNote] = useState(c.completion?.note || ""),
    [date, setDate] = useState(c.completion?.date || state.today),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const cancelled = c.status === "ended" && c.endDate < c.startDate,
    future = c.startDate > state.today,
    ended = c.status === "ended" || c.endDate < state.today,
    done = !cancelled && (c.progress?.complete || c.completed),
    manualDone =
      c.manualCompleted ?? (c.condition.kind === "manual" && !!c.completed);
  const countedActivities = state.activities
    .filter((activity) => c.progress?.countedActivityIds.includes(activity.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return (
    <article className={`challenge-card ${done ? "complete" : ""}`}>
      <div className="challenge-heading">
        <span
          className={`pill ${done ? "success" : future ? "neutral" : ended ? "neutral" : "soft"}`}
        >
          {cancelled
            ? "Zrušená pred začiatkom"
            : done
              ? "Splnené"
              : ended
                ? "Ukončená"
                : future
                  ? "Už čoskoro"
                  : "Otvorená výzva"}
        </span>
        {!cancelled && (
          <span className="small muted">
            {fmt(c.startDate)} – {fmt(c.endDate)}
          </span>
        )}
      </div>
      <h3>{c.name}</h3>
      <p className="pre-wrap">{c.description}</p>
      <div className="challenge-reward">
        <AwardArt earned={!!done} visual={c.visual} rewardKey={c.id} />
        <span>
          Bonusová odmena
          <br />
          <strong>{c.reward}</strong>
        </span>
      </div>
      {c.progress && !cancelled && (
        <>
          <div className="progress-label">
            <span>{c.progress.missing}</span>
            <strong>
              {c.progress.current} / {c.progress.target}
            </strong>
          </div>
          <progress
            value={Math.min(c.progress.current, c.progress.target)}
            max={Math.max(1, c.progress.target)}
            aria-label={`Progres výzvy ${c.name}`}
          />
          <p className="small muted">{c.progress.explanation}</p>
          <details className="rule-explanation">
            <summary>Čo sa započítalo</summary>
            {countedActivities.length > 0 ? (
              <ul>
                {countedActivities.map((activity) => (
                  <li key={activity.id}>
                    {fmt(activity.date)} · {activity.typeName}
                    {activity.minutes !== null
                      ? ` · ${activity.minutes} min`
                      : " · trvanie neuvedené"}
                    {activity.distance !== null
                      ? ` · ${activity.distance} km`
                      : ""}
                    {activity.note && (
                      <p className="small pre-wrap">{activity.note}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">
                {c.condition.kind === "manual"
                  ? "Táto praktická úloha sa plní vlastným potvrdením, nie pohybovými zápismi."
                  : "Zatiaľ sa nezapočítal žiadny pohybový zápis."}
              </p>
            )}
            {hasManual(c.condition) &&
              (manualDone && c.completion ? (
                <div>
                  <p>
                    <strong>Praktická časť potvrdená:</strong>{" "}
                    {fmt(c.completion.date)}
                  </p>
                  <p className="small pre-wrap">
                    {c.completion.note || "Bez poznámky."}
                  </p>
                </div>
              ) : (
                <p className="small muted">
                  Praktická časť zatiaľ nie je potvrdená.
                </p>
              ))}
            <p className="small">
              <strong>Čo ešte chýba:</strong>{" "}
              {c.progress.complete
                ? "Všetky podmienky sú splnené."
                : c.progress.missing}
            </p>
            <p className="small muted">
              Najviac jedna bonusová odmena za túto výzvu.
            </p>
          </details>
        </>
      )}
      <p className="small muted">
        {cancelled ? (
          "Táto výzva bola ukončená ešte pred začiatkom plnenia."
        ) : (
          <>
            Plnenie zahŕňa aj {fmt(c.endDate)}.{" "}
            {future && !ended
              ? "Výzvu si zatiaľ môžeš pozrieť; plnenie začne v uvedený deň."
              : ""}
          </>
        )}
      </p>
      {hasManual(c.condition) &&
        !future &&
        (c.status !== "ended" || manualDone) && (
          <button
            className="button secondary"
            onClick={() => {
              setNote(c.completion?.note || "");
              setDate(c.completion?.date || state.today);
              setOpen(true);
            }}
          >
            {manualDone
              ? "Upraviť potvrdenie"
              : c.condition.kind === "combination"
                ? "Potvrdiť praktickú časť"
                : "Označiť ako splnenú"}
          </button>
        )}
      {open && (
        <Modal title={c.name} onClose={() => setOpen(false)}>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await onAction("completeChallenge", {
                  id: c.id,
                  date,
                  note,
                  completed: true,
                });
                setOpen(false);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Nepodarilo sa uložiť.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>{c.description}</p>
            <label className="field">
              Deň splnenia
              <input
                type="date"
                value={date}
                min={c.startDate}
                max={state.today < c.endDate ? state.today : c.endDate}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </label>
            <label className="field">
              Poznámka · nepovinné
              <textarea
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              {manualDone && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onAction("completeChallenge", {
                        id: c.id,
                        completed: false,
                      });
                      setOpen(false);
                    } catch (e) {
                      setError(String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Zrušiť splnenie
                </button>
              )}
              <button className="button primary" disabled={busy}>
                {busy ? "Ukladám…" : "Potvrdzujem splnenie"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </article>
  );
}
function partLabel(condition: Condition, index: number) {
  if (condition.kind !== "combination") return "";
  const part = condition.conditions[index];
  if (part && part.kind !== "combination" && part.kind !== "manual") {
    if (part.groups?.length === 1 && part.groups[0] === "foot")
      return "Chôdza, túra, beh";
    if (part.groups?.length === 1 && part.groups[0] === "exercise")
      return "Cvičenie";
  }
  if (part?.kind === "manual") return "Praktická časť";
  return `Časť ${index + 1}`;
}
function RuleRow({ item, onOpen }: { item: RuleProgress; onOpen: () => void }) {
  const p = item.progress,
    r = item.rule;
  const parts = p.parts && p.parts.length > 1 ? p.parts : null;
  return (
    <button
      type="button"
      className={`cz-reward-row ${p.complete ? "done" : ""}`}
      onClick={onOpen}
    >
      <span className="cz-reward-art">
        <AwardArt earned={p.complete} visual={r.visual} rewardKey={r.key} />
      </span>
      <span className="cz-reward-text">
        <strong>{r.name}</strong>
        {parts ? (
          parts.map((part, index) => (
            <span className="cz-part" key={index}>
              <small>{partLabel(r.condition, index)}</small>
              <i aria-hidden="true">
                <b
                  style={{
                    width: `${Math.min(100, (part.current / Math.max(1, part.target)) * 100)}%`,
                  }}
                />
              </i>
              <small>
                {Math.min(part.current, part.target)}/{part.target}
              </small>
            </span>
          ))
        ) : (
          <small className={p.complete ? "ok" : ""}>
            {p.complete ? "Získané" : p.missing}
          </small>
        )}
        {parts && p.complete && <small className="ok">Získané</small>}
      </span>
      {!parts && (
        <span className="cz-reward-count">
          {Math.min(p.current, p.target)}/{p.target}
        </span>
      )}
      <ChevronRight size={18} aria-hidden="true" />
    </button>
  );
}
export default function Rewards({
  state,
  onAction,
}: {
  state: AppState;
  onAction: Action;
}) {
  const [filter, setFilter] = useState("current");
  const [openRule, setOpenRule] = useState<string | null>(null);
  const active = state.rules.filter(
    (r) =>
      (r.periodStart <= state.today && r.periodEnd >= state.today) ||
      r.rule.period === "course",
  );
  const weekly = active.filter((r) => r.rule.period === "week");
  const course = active.filter((r) => r.rule.period !== "week");
  const ruleKey = (r: RuleProgress) => r.rule.id + r.periodStart;
  const opened = active.find((r) => ruleKey(r) === openRule);
  const challenges = state.challenges
    .filter((c) => c.status !== "draft" && !c.hidden && c.kind !== "cold")
    .filter((c) =>
      filter === "all" || filter === "ended"
        ? filter === "all" || c.status === "ended" || c.endDate < state.today
        : c.status !== "ended" && c.endDate >= state.today,
    );
  const mine = state.awards.filter((a) => a.memberId === state.me.id);
  const collection = new Map<
    string,
    { name: string; visual?: RewardVisual; key: string; count: number }
  >();
  for (const award of mine) {
    const item = collection.get(award.ruleKey) || {
      name: award.name,
      visual: award.visual || award.snapshot.visual,
      key: award.ruleKey,
      count: 0,
    };
    item.count += 1;
    collection.set(award.ruleKey, item);
  }
  for (const award of (state.personalAwards || []).filter(
    (a) => a.memberId === state.me.id,
  )) {
    const item = collection.get("p:" + award.definitionId) || {
      name: award.snapshot.name,
      visual: award.snapshot.visual,
      key: award.definitionId,
      count: 0,
    };
    item.count += 1;
    collection.set("p:" + award.definitionId, item);
  }
  for (const c of state.challenges.filter(
    (c) => c.completed && c.kind !== "cold",
  )) {
    collection.set("c:" + c.id, {
      name: c.reward || c.name,
      visual: c.visual,
      key: c.id,
      count: 1,
    });
  }
  return (
    <div className="cz-rewards">
      {weekly.length > 0 && (
        <>
          <h2 className="cz-section-title">
            Tento týždeň{" "}
            <small>
              {fmt(weekly[0].periodStart)} – {fmt(weekly[0].periodEnd)}
            </small>
          </h2>
          <div className="cz-block cz-list">
            {weekly.map((r) => (
              <RuleRow
                key={ruleKey(r)}
                item={r}
                onOpen={() => setOpenRule(ruleKey(r))}
              />
            ))}
          </div>
        </>
      )}
      {course.length > 0 && (
        <>
          <h2 className="cz-section-title">Za celú prípravu</h2>
          <div className="cz-block cz-list">
            {course.map((r) => (
              <RuleRow
                key={ruleKey(r)}
                item={r}
                onOpen={() => setOpenRule(ruleKey(r))}
              />
            ))}
          </div>
        </>
      )}
      <p className="cz-muted cz-pad">
        Pohyb po vlastných je chôdza, turistika alebo beh; cvičenie je
        samostatná skupina. Klepnutím na odmenu uvidíš presné podmienky a
        započítané aktivity.
      </p>
      <PersonalAwards state={state} onAction={onAction} />
      <div className="cz-section-title with-tool">
        <h2>Výzvy od organizátorov</h2>
        <label className="sr-only" htmlFor="challenge-filter">
          Stav výziev
        </label>
        <select
          id="challenge-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="current">Aktuálne a budúce</option>
          <option value="ended">Ukončené</option>
          <option value="all">Všetky zverejnené</option>
        </select>
      </div>
      {challenges.length ? (
        <div className="challenge-grid cz-challenges">
          {challenges.map((c) => (
            <ChallengeCard key={c.id} c={c} state={state} onAction={onAction} />
          ))}
        </div>
      ) : (
        <Empty title="V tejto časti zatiaľ nie je výzva">
          Nové zverejnené výzvy sa objavia tu. Všetky sú dobrovoľné.
        </Empty>
      )}
      <h2 className="cz-section-title">Moja zbierka</h2>
      <section className="cz-block cz-collection">
        {collection.size === 0 ? (
          <p className="cz-muted">
            Zatiaľ prázdna. Prvý drahokam pribudne po splnení podmienky.
          </p>
        ) : (
          <div className="cz-collection-grid">
            {[...collection.values()].map((item) => (
              <span key={item.key + item.name} className="cz-collected">
                <AwardArt earned visual={item.visual} rewardKey={item.key} />
                <small>{item.name}</small>
                <b>×{item.count}</b>
              </span>
            ))}
          </div>
        )}
        <details className="cz-details inner">
          <summary>História získaných drahokamov</summary>
          <AwardHistory
            awards={mine}
            activities={state.activities.filter(
              (a) => a.memberId === state.me.id,
            )}
            progress={state.rules}
          />
        </details>
      </section>
      {opened && (
        <Modal title="Detail odmeny" onClose={() => setOpenRule(null)}>
          <RuleCard item={opened} index={0} state={state} onAction={onAction} />
        </Modal>
      )}
    </div>
  );
}
