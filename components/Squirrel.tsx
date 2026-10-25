"use client";
import { appPath } from "../lib/paths";
import { useEffect, useState } from "react";
import type { AppState } from "../lib/types";
import { chooseSquirrelEvent } from "./squirrel-events";
export default function Squirrel({
  state,
  blocked,
  onNavigate,
}: {
  state: AppState;
  blocked: boolean;
  onNavigate: (view: string) => void;
}) {
  const [peek, setPeek] = useState<{ text: string; view: string } | null>(null);
  useEffect(() => {
    if (
      peek ||
      blocked ||
      !state.me.animations ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    let timer: ReturnType<typeof setTimeout>;
    const memberKey = `cz-squirrel-${state.course.id}-${state.me.id}`,
      countKey = `${memberKey}-count`;
    try {
      const seen: string[] = JSON.parse(
        localStorage.getItem(memberKey) || "[]",
      );
      const count = Number(sessionStorage.getItem(countKey) || 0);
      if (count >= state.course.squirrelLimit) return;
      const event = chooseSquirrelEvent(state, seen, count, {
        blocked,
        reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
      if (!event) return;
      timer = setTimeout(() => {
        const focus = document.activeElement?.tagName;
        if (
          document.querySelector("dialog[open]") ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(focus || "")
        )
          return;
        localStorage.setItem(
          memberKey,
          JSON.stringify([...seen, ...event.ids].slice(-400)),
        );
        sessionStorage.setItem(countKey, String(count + 1));
        setPeek(event);
      }, 1800);
    } catch {}
    return () => {
      clearTimeout(timer);
    };
  }, [state, blocked, peek]);
  useEffect(() => {
    if (!peek) return;
    const timeout = setTimeout(() => setPeek(null), 5500);
    return () => clearTimeout(timeout);
  }, [peek]);
  useEffect(() => {
    if (blocked || !state.me.animations) setPeek(null);
  }, [blocked, state.me.animations]);
  useEffect(() => {
    const hideOnInput = () => {
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName || "",
        )
      )
        setPeek(null);
    };
    document.addEventListener("focusin", hideOnInput);
    return () => document.removeEventListener("focusin", hideOnInput);
  }, []);
  return (
    <aside
      className={`squirrel ${peek ? "is-peeking" : ""} ${blocked ? "is-blocked" : ""}`}
      aria-label="Lesný sprievodca"
    >
      <img
        src={appPath(
          peek ? "/brand/original-frame-1.png" : "/brand/original-frame-0.png",
        )}
        width="166"
        height="235"
        alt=""
      />
      {peek && (
        <button
          className="squirrel-bubble"
          onClick={() => {
            onNavigate(peek.view);
            setPeek(null);
          }}
        >
          {peek.text}
          <span>Pozrieť →</span>
        </button>
      )}
    </aside>
  );
}
