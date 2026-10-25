"use client";
import { useState } from "react";
import {
  Heart,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Trash2,
  Send,
} from "lucide-react";
import type { Activity, AppState, Comment } from "../lib/types";
import { Avatar, SportIcon, fmt, Empty, type Action } from "./ui";
function FeedCard({
  activity: a,
  state,
  onEdit,
  onAction,
  allowModeration,
}: {
  activity: Activity;
  state: AppState;
  onEdit: (a: Activity) => void;
  onAction: Action;
  allowModeration: boolean;
}) {
  const [showComments, setShowComments] = useState(false),
    [text, setText] = useState(""),
    [editing, setEditing] = useState<Comment | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
  return (
    <article className="feed-card">
      <div className="feed-card-head">
        <Avatar name={a.nickname || "Účastník"} />
        <div className="feed-author">
          <strong>{a.nickname || "Účastník"}</strong>
          <span>
            {fmt(a.date, { weekday: "short", day: "numeric", month: "long" })}
          </span>
        </div>
        <span className={`sport-label ${a.group}`}>
          <SportIcon group={a.group} />
          <span>{a.typeName}</span>
        </span>
        {own && (
          <button
            className="icon-button"
            onClick={() => onEdit(a)}
            aria-label={`Upraviť aktivitu ${a.typeName}`}
          >
            <Pencil size={16} />
          </button>
        )}
        {(own || moderator) && (
          <button
            className="icon-button quiet-danger"
            aria-label="Odstrániť aktivitu"
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  own
                    ? "Odstrániť tento zápis? Odmeny a súhrny sa prepočítajú."
                    : "Moderátorsky odstrániť tento zápis? Zásah sa zaznamená.",
                )
              )
                void run("deleteActivity", { id: a.id });
            }}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      <div className="feed-body">
        <div className="activity-values">
          {a.minutes !== null && (
            <span>
              <strong>{a.minutes}</strong> min
            </span>
          )}
          {a.distance !== null && (
            <span>
              <strong>{a.distance.toLocaleString("sk-SK")}</strong> km
            </span>
          )}
          {a.minutes === null && a.group !== "task" && (
            <span className="muted">trvanie neuvedené</span>
          )}
        </div>
        {a.note && <p className="pre-wrap">{a.note}</p>}
      </div>
      <div className="feed-actions">
        <button
          className={`text-button reaction ${a.reactions?.includes(state.me.id) ? "reacted" : ""}`}
          aria-pressed={a.reactions?.includes(state.me.id) || false}
          disabled={busy}
          onClick={() => void run("reaction", { activityId: a.id })}
        >
          <Heart
            size={17}
            fill={a.reactions?.includes(state.me.id) ? "currentColor" : "none"}
          />
          <span>{a.reactions?.length || 0}</span>
          <span className="sr-only">Podporiť</span>
        </button>
        <button
          className="text-button"
          onClick={() => setShowComments(!showComments)}
          aria-expanded={showComments}
        >
          <MessageCircle size={17} />
          {a.comments?.length || 0}
          <span className="comment-label">Komentáre</span>
        </button>
      </div>
      {showComments && (
        <div className="comments">
          {a.comments?.map((c) => (
            <div key={c.id} className="comment">
              <Avatar name={c.nickname} size="small" />
              <div>
                <strong>{c.nickname}</strong>
                <p className="pre-wrap">{c.body}</p>
                {(c.memberId === state.me.id || moderator) && (
                  <div className="comment-tools">
                    {c.memberId === state.me.id && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setEditing(c);
                          setText(c.body);
                        }}
                      >
                        Upraviť
                      </button>
                    )}
                    <button
                      className="text-button"
                      onClick={() => {
                        if (confirm("Odstrániť komentár?"))
                          void run("deleteComment", { id: c.id });
                      }}
                    >
                      Odstrániť
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          <form
            className="comment-form"
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
              id={`comment-${a.id}`}
              maxLength={1000}
              placeholder={
                editing ? "Upraviť komentár…" : "Napíš niečo povzbudivé…"
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
            />
            <button
              className="icon-button"
              disabled={busy || !text.trim()}
              aria-label="Uložiť komentár"
            >
              <Send size={18} />
            </button>
            {editing && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setEditing(null);
                  setText("");
                }}
              >
                Zrušiť
              </button>
            )}
          </form>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </article>
  );
}
export default function Feed({
  state,
  activities,
  onEdit,
  onAction,
  compact = false,
  limit,
  allowModeration = true,
}: {
  state: AppState;
  activities: Activity[];
  onEdit: (a: Activity) => void;
  onAction: Action;
  compact?: boolean;
  limit?: number;
  allowModeration?: boolean;
}) {
  const [person, setPerson] = useState(""),
    [type, setType] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const visible = activities
    .filter(
      (a) =>
        (!person || a.memberId === person) &&
        (!type || a.typeId === type) &&
        (!from || a.date >= from) &&
        (!to || a.date <= to),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    );
  return (
    <section className="feed-section">
      <div className="section-head">
        <div>
          <p className="eyebrow">SPOLU NA CESTE</p>
          <h2>
            {limit ? "Posledné zápisy" : compact ? "Zápisy" : "Denník skupiny"}
          </h2>
        </div>
        <span className="pill neutral">{visible.length} zápisov</span>
      </div>
      {!compact && (
        <div className="filters">
          <label className="sr-only" htmlFor="feed-person">
            Človek
          </label>
          <select
            id="feed-person"
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
          <label className="sr-only" htmlFor="feed-type">
            Typ aktivity
          </label>
          <select
            id="feed-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">Všetky aktivity</option>
            {state.types
              .filter((t) => !t.hidden)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          <label className="date-filter">
            Od
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="date-filter">
            Do
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          {(person || type || from || to) && (
            <button
              className="text-button"
              onClick={() => {
                setPerson("");
                setType("");
                setFrom("");
                setTo("");
              }}
            >
              Zrušiť filtre
            </button>
          )}
        </div>
      )}
      {visible.length === 0 ? (
        <Empty title="Zatiaľ bez zápisu">
          Keď pribudnú aktivity, nájdeš ich tu. Prázdny denník nehovorí nič o
          tom, koľko sa kto hýbal.
        </Empty>
      ) : (
        <div className="feed-list">
          {(limit ? visible.slice(0, limit) : visible).map((a) => (
            <FeedCard
              key={a.id}
              activity={a}
              state={state}
              onEdit={onEdit}
              onAction={onAction}
              allowModeration={allowModeration}
            />
          ))}
        </div>
      )}
    </section>
  );
}
