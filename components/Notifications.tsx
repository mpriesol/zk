"use client";
import { useEffect, useState } from "react";
import { Heart, MessageCircle } from "lucide-react";
import type { AppState, SocialNotification } from "../lib/types";
import { Avatar, Empty, add, fmt } from "./ui";

const EVENT = "cz-notifications-seen";
const storageKey = (state: AppState) =>
  `cz-notifications-seen-${state.course.id}-${state.me.id}`;

function readSeen(state: AppState): Set<string> | null {
  try {
    const raw = localStorage.getItem(storageKey(state));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id) => typeof id === "string"))
      : null;
  } catch {
    return null;
  }
}
function writeSeen(state: AppState, ids: Iterable<string>) {
  try {
    localStorage.setItem(
      storageKey(state),
      JSON.stringify([...ids].slice(-1500)),
    );
  } catch {
    /* The badge then resets on the next visit; nothing else depends on it. */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Ids of notifications the person has not opened yet on this device. */
export function useUnreadNotifications(state: AppState | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const update = () => setTick((t) => t + 1);
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  if (!state || typeof window === "undefined") return [];
  const list = state.notifications || [];
  let seen = readSeen(state);
  if (!seen) {
    // First visit on this device: older events are not "new".
    seen = new Set(list.map((n) => n.id));
    writeSeen(state, seen);
  }
  return list.filter((n) => !seen!.has(n.id)).map((n) => n.id);
}

function when(n: SocialNotification, today: string) {
  if (!n.at) return "skôr";
  const date = n.at.slice(0, 10);
  const time = new Date(n.at).toLocaleTimeString("sk-SK", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (date === today) return `dnes ${time}`;
  if (date === add(today, -1)) return `včera ${time}`;
  return fmt(date);
}

export default function Notifications({
  state,
  onOpenActivity,
}: {
  state: AppState;
  onOpenActivity: (activityId: string) => void;
}) {
  const list = state.notifications || [];
  const unread = useUnreadNotifications(state);
  // Keep the "new" marks visible while the list is open, then remember them.
  const [fresh] = useState(() => new Set(unread));
  useEffect(() => {
    const seen = readSeen(state) || new Set<string>();
    for (const n of list) seen.add(n.id);
    writeSeen(state, seen);
  }, [list.length]);
  if (!list.length)
    return (
      <Empty title="Zatiaľ bez notifikácií">
        Keď niekto podporí alebo okomentuje tvoju aktivitu, uvidíš to tu – aj
        bez zapnutých upozornení v telefóne.
      </Empty>
    );
  const avatarOf = (id: string) =>
    state.members.find((m) => m.id === id)?.avatarUrl;
  return (
    <div className="cz-block cz-notifications">
      {list.map((n) => (
        <button
          type="button"
          key={n.id}
          className={`cz-notification ${fresh.has(n.id) ? "fresh" : ""}`}
          onClick={() => onOpenActivity(n.activityId)}
        >
          <span className="cz-notification-avatar">
            <Avatar
              name={n.actorNickname}
              imageUrl={avatarOf(n.actorId)}
              size="small"
            />
            <span
              className={`cz-notification-kind ${n.kind}`}
              aria-hidden="true"
            >
              {n.kind === "reaction" ? (
                <Heart size={10} fill="currentColor" />
              ) : (
                <MessageCircle size={10} />
              )}
            </span>
          </span>
          <span className="cz-notification-text">
            <span>
              <strong>{n.actorNickname}</strong>{" "}
              {n.kind === "reaction"
                ? "podporuje tvoju aktivitu"
                : "komentuje tvoju aktivitu"}{" "}
              <strong>{n.typeName}</strong> {fmt(n.activityDate)}
            </span>
            {n.body && <q>{n.body}</q>}
            <small>
              {fresh.has(n.id) && <b className="cz-new">nové · </b>}
              {when(n, state.today)}
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}
