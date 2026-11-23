"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Heart,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Trash2,
  Send,
  SlidersHorizontal,
} from "lucide-react";
import type { Activity, AppState, Comment } from "../lib/types";
import { Avatar, SportIcon, fmt, add, Empty, Modal, type Action } from "./ui";
import "./media.css";

/** Slovak plural: 1 komentár, 2–4 komentáre, 0 a 5+ komentárov. */
export function plural(n: number, one: string, few: string, many: string) {
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}
export function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes.toLocaleString("sk-SK")} min`;
  const h = Math.floor(minutes / 60),
    m = Math.round(minutes - h * 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}
/** "Dnes", "Včera" or "piatok 20. 11." for day dividers. */
export function dayLabel(date: string, today: string) {
  if (date === today) return "Dnes";
  if (date === add(today, -1)) return "Včera";
  const weekday = fmt(date, { weekday: "long" });
  return `${weekday.charAt(0).toLocaleUpperCase("sk")}${weekday.slice(1)} ${fmt(date)}`;
}
function shortDay(date: string, today: string) {
  if (date === today) return "dnes";
  if (date === add(today, -1)) return "včera";
  return `${fmt(date, { weekday: "short" })} ${fmt(date)}`;
}
function supportText(ids: string[], state: AppState) {
  const names = ids.map((id) =>
    id === state.me.id
      ? "ty"
      : state.members.find((m) => m.id === id)?.nickname || "účastník",
  );
  const mineFirst = [...names].sort((a, b) =>
    a === "ty" ? -1 : b === "ty" ? 1 : 0,
  );
  const text =
    mineFirst.length === 1
      ? mineFirst[0]
      : mineFirst.length === 2
        ? `${mineFirst[0]} a ${mineFirst[1]}`
        : `${mineFirst[0]}, ${mineFirst[1]} a ${plural(mineFirst.length - 2, "ďalší", "ďalší", "ďalších")} ${mineFirst.length - 2}`;
  return text.charAt(0).toLocaleUpperCase("sk") + text.slice(1);
}

export function FeedCard({
  activity: a,
  state,
  onEdit,
  onAction,
  allowModeration,
  onPerson,
  expanded = false,
  focused = false,
}: {
  activity: Activity;
  state: AppState;
  onEdit: (a: Activity) => void;
  onAction: Action;
  allowModeration: boolean;
  onPerson?: (memberId: string) => void;
  expanded?: boolean;
  /** Opened from a notification: scroll here, highlight, show the discussion. */
  focused?: boolean;
}) {
  const [showAll, setShowAll] = useState(expanded),
    [composing, setComposing] = useState(expanded),
    [longNote, setLongNote] = useState(false),
    [photoIndex, setPhotoIndex] = useState<number | null>(null),
    [text, setText] = useState(""),
    [editing, setEditing] = useState<Comment | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focused) return;
    setShowAll(true);
    setComposing(true);
    const timer = setTimeout(
      () =>
        article.current?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
          block: "start",
        }),
      120,
    );
    return () => clearTimeout(timer);
  }, [focused]);
  async function run(action: string, data: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await onAction(action, data);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Zmenu sa nepodarilo uložiť.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const own = a.memberId === state.me.id,
    moderator = allowModeration && state.me.role === "admin";
  const photos = a.photos || [];
  const comments = a.comments || [];
  const reactions = a.reactions || [];
  const reacted = reactions.includes(state.me.id);
  const visibleComments = showAll ? comments : comments.slice(-2);
  const avatarFor = (id: string) =>
    state.members.find((member) => member.id === id)?.avatarUrl;
  const name = a.nickname || "Účastník";
  const noteIsLong = a.note.length > 240 || a.note.split("\n").length > 4;
  function startComment() {
    setComposing(true);
    setTimeout(() => input.current?.focus(), 30);
  }
  function remove() {
    if (
      confirm(
        own
          ? "Odstrániť tento zápis? Odmeny a súhrny sa prepočítajú."
          : "Moderátorsky odstrániť tento zápis? Zásah sa zaznamená.",
      )
    )
      void run("deleteActivity", { id: a.id });
  }
  return (
    <article
      ref={article}
      id={`activity-${a.id}`}
      className={`cz-card ${focused ? "focused" : ""}`}
    >
      <header className="cz-card-head">
        <button
          type="button"
          className="cz-person"
          onClick={() => onPerson?.(a.memberId)}
          disabled={!onPerson}
          aria-label={onPerson ? `Príprava: ${name}` : undefined}
        >
          <Avatar name={name} imageUrl={avatarFor(a.memberId)} />
          <span>
            <strong>
              {name}
              {own && <small> · ty</small>}
            </strong>
            <small>
              {a.typeName} · {shortDay(a.date, state.today)}
            </small>
          </span>
        </button>
        <span className={`cz-type g-${a.group}`} aria-hidden="true">
          <SportIcon group={a.group} typeName={a.typeName} size={21} />
        </span>
        {(own || moderator) && (
          <details className="cz-more">
            <summary aria-label="Možnosti zápisu">
              <MoreHorizontal size={20} />
            </summary>
            <div>
              {own && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.closest("details")?.removeAttribute("open");
                    onEdit(a);
                  }}
                >
                  <Pencil size={16} /> Upraviť
                </button>
              )}
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={(e) => {
                  e.currentTarget.closest("details")?.removeAttribute("open");
                  remove();
                }}
              >
                <Trash2 size={16} />
                {own ? "Zmazať" : "Odstrániť (moderácia)"}
              </button>
            </div>
          </details>
        )}
      </header>
      {(a.minutes !== null || a.distance !== null || a.group !== "task") && (
        <div className="cz-stats">
          {a.group !== "task" && (
            <div>
              <small>Čas</small>
              <strong className={a.minutes === null ? "unknown" : ""}>
                {a.minutes === null ? "neuvedený" : formatMinutes(a.minutes)}
              </strong>
            </div>
          )}
          {a.distance !== null && (
            <div>
              <small>Vzdialenosť</small>
              <strong>{a.distance.toLocaleString("sk-SK")} km</strong>
            </div>
          )}
        </div>
      )}
      {a.note && (
        <div className="cz-note">
          <p className={`pre-wrap ${noteIsLong && !longNote ? "clamped" : ""}`}>
            {a.note}
          </p>
          {noteIsLong && (
            <button
              type="button"
              className="cz-link"
              onClick={() => setLongNote(!longNote)}
            >
              {longNote ? "menej" : "viac"}
            </button>
          )}
        </div>
      )}
      {photos.length > 0 && (
        <button
          type="button"
          className="cz-photo"
          aria-label={`Otvoriť fotografie (${photos.length})`}
          onClick={() => setPhotoIndex(0)}
        >
          <img
            src={photos[0].url}
            width={photos[0].width}
            height={photos[0].height}
            loading="lazy"
            alt={`${a.typeName} · fotografia 1`}
          />
          {photos.length > 1 && <span>1 / {photos.length}</span>}
        </button>
      )}
      {(reactions.length > 0 || comments.length > 0) && (
        <div className="cz-social">
          {reactions.length > 0 ? (
            <span className="cz-supporters">
              <Heart
                size={14}
                className="cz-supporters-heart"
                aria-label="Podporili"
              />
              <span className="cz-stack" aria-hidden="true">
                {reactions.slice(0, 3).map((id) => {
                  const m = state.members.find((member) => member.id === id);
                  return (
                    <Avatar
                      key={id}
                      name={m?.nickname || "?"}
                      imageUrl={m?.avatarUrl}
                      size="tiny"
                    />
                  );
                })}
              </span>
              <span>{supportText(reactions, state)}</span>
            </span>
          ) : (
            <span />
          )}
          {comments.length > 0 && (
            <button
              type="button"
              className="cz-link quiet"
              onClick={() => {
                setShowAll(true);
                setComposing(true);
              }}
            >
              {comments.length}{" "}
              {plural(comments.length, "komentár", "komentáre", "komentárov")}
            </button>
          )}
        </div>
      )}
      <div className="cz-actions">
        <button
          type="button"
          className={reacted ? "reacted" : ""}
          aria-pressed={reacted}
          disabled={busy}
          onClick={() => void run("reaction", { activityId: a.id })}
        >
          <Heart size={18} fill={reacted ? "currentColor" : "none"} />
          {reacted ? "Podporené" : "Podporiť"}
        </button>
        <button type="button" onClick={startComment}>
          <MessageCircle size={18} />
          Komentovať
        </button>
      </div>
      {(visibleComments.length > 0 || composing) && (
        <div className="cz-comments">
          {visibleComments.map((c) => (
            <div key={c.id} className="cz-comment" id={`comment-${c.id}`}>
              <Avatar
                name={c.nickname}
                size="tiny"
                imageUrl={avatarFor(c.memberId)}
              />
              <div>
                <p className="pre-wrap">
                  <strong>{c.nickname}</strong> {c.body}
                </p>
                {(c.memberId === state.me.id || moderator) && (
                  <span className="cz-comment-tools">
                    {c.memberId === state.me.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(c);
                          setText(c.body);
                          startComment();
                        }}
                      >
                        Upraviť
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("Odstrániť komentár?"))
                          void run("deleteComment", { id: c.id });
                      }}
                    >
                      Odstrániť
                    </button>
                  </span>
                )}
              </div>
            </div>
          ))}
          {!showAll && comments.length > 2 && (
            <button
              type="button"
              className="cz-link"
              onClick={() => setShowAll(true)}
            >
              Zobraziť všetky {comments.length}{" "}
              {plural(comments.length, "komentár", "komentáre", "komentárov")}
            </button>
          )}
          {composing && (
            <form
              className="cz-comment-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!text.trim()) return;
                if (
                  await run("saveComment", {
                    id: editing?.id,
                    activityId: a.id,
                    body: text,
                  })
                ) {
                  setText("");
                  setEditing(null);
                }
              }}
            >
              <label className="sr-only" htmlFor={`comment-${a.id}`}>
                Komentár
              </label>
              <input
                ref={input}
                id={`comment-${a.id}`}
                maxLength={1000}
                placeholder={editing ? "Upraviť komentár…" : "Pridať komentár…"}
                value={text}
                onChange={(e) => setText(e.target.value)}
                required
              />
              <button
                className="cz-send"
                disabled={busy || !text.trim()}
                aria-label="Uložiť komentár"
              >
                <Send size={18} />
              </button>
              {editing && (
                <button
                  type="button"
                  className="cz-link"
                  onClick={() => {
                    setEditing(null);
                    setText("");
                  }}
                >
                  Zrušiť
                </button>
              )}
            </form>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="error cz-error">
          {error}
        </p>
      )}
      {photoIndex !== null && photos[photoIndex] && (
        <Modal
          title={`Fotografia ${photoIndex + 1} z ${photos.length}`}
          onClose={() => setPhotoIndex(null)}
          wide
        >
          <div
            className="photo-lightbox"
            onKeyDown={(event) => {
              if (event.key === "ArrowRight")
                setPhotoIndex(Math.min(photos.length - 1, photoIndex + 1));
              if (event.key === "ArrowLeft")
                setPhotoIndex(Math.max(0, photoIndex - 1));
            }}
          >
            <img
              src={photos[photoIndex].url}
              alt={`${a.typeName} · fotografia ${photoIndex + 1}`}
            />
            {photos.length > 1 && (
              <div className="photo-lightbox-controls">
                <button
                  type="button"
                  className="button secondary"
                  disabled={photoIndex === 0}
                  onClick={() => setPhotoIndex(photoIndex - 1)}
                >
                  Predchádzajúca
                </button>
                <span>
                  {photoIndex + 1}/{photos.length}
                </span>
                <button
                  type="button"
                  className="button secondary"
                  disabled={photoIndex === photos.length - 1}
                  onClick={() => setPhotoIndex(photoIndex + 1)}
                >
                  Ďalšia
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </article>
  );
}

const PAGE = 20;

export default function Feed({
  state,
  activities,
  onEdit,
  onAction,
  allowModeration = true,
  onPerson,
  stream = false,
  emptyTitle = "Zatiaľ bez zápisu",
  focusId,
}: {
  state: AppState;
  activities: Activity[];
  onEdit: (a: Activity) => void;
  onAction: Action;
  allowModeration?: boolean;
  onPerson?: (memberId: string) => void;
  /** Group stream: day dividers, filters and paging. */
  stream?: boolean;
  emptyTitle?: string;
  focusId?: string | null;
}) {
  const [person, setPerson] = useState(""),
    [type, setType] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [filtersOpen, setFiltersOpen] = useState(false),
    [limit, setLimit] = useState(PAGE);
  const visible = useMemo(
    () =>
      activities
        .filter(
          (a) =>
            (!person || a.memberId === person) &&
            (!type || a.typeId === type) &&
            (!from || a.date >= from) &&
            (!to || a.date <= to),
        )
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            b.createdAt.localeCompare(a.createdAt),
        ),
    [activities, person, type, from, to],
  );
  const filterCount = [person, type, from, to].filter(Boolean).length;
  const focusIndex = focusId ? visible.findIndex((a) => a.id === focusId) : -1;
  const shown = stream
    ? visible.slice(0, Math.max(limit, focusIndex + 1))
    : visible;
  const days: { date: string; items: Activity[] }[] = [];
  for (const activity of shown) {
    const last = days[days.length - 1];
    if (last && last.date === activity.date) last.items.push(activity);
    else days.push({ date: activity.date, items: [activity] });
  }
  const card = (a: Activity) => (
    <FeedCard
      key={a.id}
      activity={a}
      state={state}
      onEdit={onEdit}
      onAction={onAction}
      allowModeration={allowModeration}
      onPerson={onPerson}
      focused={a.id === focusId}
    />
  );
  const tools = (
    <span className="cz-feed-tools">
      {filterCount > 0 && (
        <button
          type="button"
          className="cz-link"
          onClick={() => {
            setPerson("");
            setType("");
            setFrom("");
            setTo("");
          }}
        >
          Zrušiť filter
        </button>
      )}
      <button
        type="button"
        className={`cz-chip-button small ${filterCount ? "active" : ""}`}
        onClick={() => setFiltersOpen(true)}
      >
        <SlidersHorizontal size={15} />
        {filterCount ? `Filter (${filterCount})` : "Filtrovať"}
      </button>
    </span>
  );
  return (
    <section className={`cz-feed ${stream ? "stream" : "list"}`}>
      {stream && visible.length === 0 && (
        <div className="cz-day-head">
          <span />
          {tools}
        </div>
      )}
      {visible.length === 0 ? (
        <Empty title={filterCount ? "Filtru nič nezodpovedá" : emptyTitle}>
          {filterCount
            ? "Skús zrušiť alebo zmeniť filter."
            : "Keď pribudnú aktivity, nájdeš ich tu."}
        </Empty>
      ) : stream ? (
        <>
          {days.map((day, index) => (
            <div key={day.date} className="cz-day">
              <div className="cz-day-head">
                <h3 className="cz-day-label">
                  {dayLabel(day.date, state.today)}
                </h3>
                {index === 0 && tools}
              </div>
              <div className="cz-day-cards">{day.items.map(card)}</div>
            </div>
          ))}
          {visible.length > shown.length && (
            <button
              type="button"
              className="button secondary cz-more-button"
              onClick={() => setLimit(limit + PAGE)}
            >
              Zobraziť staršie ({visible.length - shown.length})
            </button>
          )}
        </>
      ) : (
        <div className="cz-day-cards">{shown.map(card)}</div>
      )}
      {filtersOpen && (
        <Modal title="Filtrovať aktivity" onClose={() => setFiltersOpen(false)}>
          <div className="stack">
            <label className="field">
              Účastník
              <select
                value={person}
                onChange={(e) => setPerson(e.target.value)}
              >
                <option value="">Všetci účastníci</option>
                {state.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nickname}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Typ aktivity
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">Všetky aktivity</option>
                {state.types
                  .filter((t) => !t.hidden)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="grid-two">
              <label className="field">
                Od
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label className="field">
                Do
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setPerson("");
                  setType("");
                  setFrom("");
                  setTo("");
                }}
              >
                Zrušiť filter
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  setLimit(PAGE);
                  setFiltersOpen(false);
                }}
              >
                Zobraziť {visible.length}{" "}
                {plural(visible.length, "zápis", "zápisy", "zápisov")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
