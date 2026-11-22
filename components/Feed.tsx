"use client";
import { useState } from "react";
import { Heart, MessageCircle, Pencil, Trash2, Send } from "lucide-react";
import type { Activity, AppState, Comment } from "../lib/types";
import { Avatar, SportIcon, fmt, Empty, Modal, type Action } from "./ui";
import "./media.css";
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
    [photoIndex, setPhotoIndex] = useState<number | null>(null),
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
  const photos = a.photos || [];
  const latestComment = a.comments?.[a.comments.length - 1];
  const avatarFor = (id: string) =>
    state.members.find((member) => member.id === id)?.avatarUrl;
  return (
    <article className="feed-card">
      <div className="feed-card-head">
        <Avatar
          name={a.nickname || "Účastník"}
          imageUrl={avatarFor(a.memberId)}
        />
        <div className="feed-author">
          <strong>{a.nickname || "Účastník"}</strong>
          <span>
            {fmt(a.date, { weekday: "short", day: "numeric", month: "long" })}
          </span>
        </div>
        <span className={`sport-label ${a.group}`}>
          <SportIcon group={a.group} typeName={a.typeName} />
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
              <strong>{a.minutes.toLocaleString("sk-SK")}</strong> min
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
        {photos.length > 0 && (
          <div
            className={`feed-photo-grid ${photos.length === 1 ? "single" : ""}`}
          >
            {photos.slice(0, 2).map((photo, index) => (
              <button
                key={photo.id}
                type="button"
                className="feed-photo-button"
                aria-label={`Otvoriť fotografiu ${index + 1} z ${photos.length}`}
                onClick={() => setPhotoIndex(index)}
              >
                <img
                  src={photo.url}
                  width={photo.width}
                  height={photo.height}
                  loading="lazy"
                  alt={`${a.typeName} · fotografia ${index + 1}`}
                />
                {index === 1 && photos.length > 2 && (
                  <span className="feed-photo-count">+{photos.length - 2}</span>
                )}
              </button>
            ))}
          </div>
        )}
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
          aria-label={
            showComments
              ? "Skryť komentáre"
              : `Zobraziť všetky komentáre (${a.comments?.length || 0})`
          }
        >
          <MessageCircle size={17} />
          {a.comments?.length || 0}
          <span className="comment-label">Komentáre</span>
        </button>
      </div>
      {!showComments && latestComment && (
        <button
          type="button"
          className="comment-preview"
          onClick={() => setShowComments(true)}
          aria-label={`Zobraziť všetky komentáre (${a.comments?.length || 0})`}
        >
          <Avatar
            name={latestComment.nickname}
            size="small"
            imageUrl={avatarFor(latestComment.memberId)}
          />
          <span className="comment-preview-text">
            <strong>{latestComment.nickname}</strong>
            <span className="comment-preview-body">{latestComment.body}</span>
            <span className="comment-preview-more">
              Zobraziť všetky komentáre ({a.comments?.length || 0})
            </span>
          </span>
        </button>
      )}
      {showComments && (
        <div className="comments">
          {a.comments?.map((c) => (
            <div key={c.id} className="comment">
              <Avatar
                name={c.nickname}
                size="small"
                imageUrl={avatarFor(c.memberId)}
              />
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
export default function Feed({
  state,
  activities,
  onEdit,
  onAction,
  compact = false,
  limit,
  allowModeration = true,
  personal = false,
}: {
  state: AppState;
  activities: Activity[];
  onEdit: (a: Activity) => void;
  onAction: Action;
  compact?: boolean;
  limit?: number;
  allowModeration?: boolean;
  personal?: boolean;
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
          <p className="eyebrow">
            {personal ? "TVOJE ZÁPISY" : "SPOLU NA CESTE"}
          </p>
          <h2>
            {personal
              ? "Tvoje aktivity"
              : limit
                ? "Posledné zápisy"
                : compact
                  ? "Zápisy"
                  : "Denník skupiny"}
          </h2>
        </div>
        <span className="pill neutral">{visible.length} zápisov</span>
      </div>
      {!compact && (
        <div className="filters">
          {!personal && (
            <>
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
            </>
          )}
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
