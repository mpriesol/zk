"use client";
import { useEffect, useRef, useState } from "react";
import { Snowflake, X } from "lucide-react";
import type { AppState, RewardVisual } from "../lib/types";
import AwardArt from "./AwardArt";

type Celebrated = {
  id: string;
  name: string;
  key: string;
  visual?: RewardVisual;
  when: string;
};
const FLAKES = Array.from({ length: 46 }, (_, i) => ({
  x: (i * 37 + (i % 7) * 11) % 100,
  delay: ((i * 13) % 20) / 10,
  duration: 3.2 + ((i * 7) % 18) / 10,
  size: 14 + ((i * 5) % 4) * 6,
  drift: ((i * 29) % 80) - 40,
  spin: (i % 2 ? 1 : -1) * (180 + ((i * 41) % 180)),
}));

export default function AwardCelebration({
  state,
  blocked,
  onOpen,
}: {
  state: AppState;
  blocked: boolean;
  onOpen: () => void;
}) {
  const [award, setAward] = useState<(Celebrated & { more: number }) | null>(
    null,
  );
  const memory = useRef<Set<string> | null>(null);
  const identity = `${state.course.id}-${state.me.id}-${state.course.preparationStartedAt || state.course.startDate}`;
  const oldIdentity = useRef(identity);
  useEffect(() => {
    // Stable keys: a recalculated award for the same rule and week is not "new".
    const all: Celebrated[] = [
      ...state.awards
        .filter((a) => a.memberId === state.me.id)
        .map((a) => ({
          id: `rule:${a.ruleKey}:${a.periodStart}`,
          name: a.name,
          key: a.ruleKey,
          visual: a.visual || a.snapshot.visual,
          when: a.earnedAt,
        })),
      ...(state.personalAwards || [])
        .filter((a) => a.memberId === state.me.id)
        .map((a) => ({
          id: `personal:${a.id}`,
          name: a.snapshot.name,
          key: a.definitionId,
          visual: a.snapshot.visual,
          when: a.date,
        })),
      ...state.challenges
        .filter((c) => c.completed && c.kind !== "cold")
        .map((c) => ({
          id: `challenge:${c.id}`,
          name: c.reward || c.name,
          key: c.id,
          visual: c.visual,
          when: c.completion?.date || "",
        })),
    ];
    const key = `cz-awards-seen-v2-${identity}`;
    if (identity !== oldIdentity.current) {
      memory.current = null;
      oldIdentity.current = identity;
      setAward(null);
    }
    if (!memory.current) {
      try {
        const stored = localStorage.getItem(key);
        const parsed = stored ? JSON.parse(stored) : null;
        // First visit on this device: everything already earned counts as seen.
        memory.current = new Set(
          Array.isArray(parsed)
            ? parsed.filter((s) => typeof s === "string")
            : all.map((a) => a.id),
        );
      } catch {
        memory.current = new Set(all.map((a) => a.id));
      }
    }
    if (blocked || award) return;
    const fresh = all
      .filter((a) => !memory.current!.has(a.id))
      .sort((a, b) => b.when.localeCompare(a.when));
    if (fresh.length) {
      // One celebration for everything new at once; older items never follow later.
      for (const item of fresh) memory.current.add(item.id);
      setAward({ ...fresh[0], more: fresh.length - 1 });
    }
    try {
      localStorage.setItem(
        key,
        JSON.stringify([...memory.current].slice(-2000)),
      );
    } catch {
      /* Session memory still prevents repeats. */
    }
  }, [state, identity, blocked, award]);
  useEffect(() => {
    if (!award) return;
    const timeout = setTimeout(() => setAward(null), 9000);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAward(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("keydown", onKey);
    };
  }, [award]);
  if (!award || blocked) return null;
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <div
      className="cz-celebration"
      role="status"
      aria-live="polite"
      onClick={(event) => {
        if (event.target === event.currentTarget) setAward(null);
      }}
    >
      {!reduced && (
        <div className="cz-snowfall" aria-hidden="true">
          {FLAKES.map((flake, i) => (
            <Snowflake
              key={i}
              size={flake.size}
              style={
                {
                  left: `${flake.x}%`,
                  "--fall-delay": `${flake.delay}s`,
                  "--fall-duration": `${flake.duration}s`,
                  "--fall-drift": `${flake.drift}px`,
                  "--fall-spin": `${flake.spin}deg`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}
      <div className="cz-celebration-card">
        <button
          type="button"
          className="cz-celebration-close"
          aria-label="Zavrieť oznámenie o odmene"
          onClick={() => setAward(null)}
        >
          <X size={20} />
        </button>
        <span className="cz-celebration-art">
          <AwardArt visual={award.visual} rewardKey={award.key} earned />
        </span>
        <small>Nová odmena v tvojej zbierke</small>
        <strong>{award.name}</strong>
        {award.more > 0 && (
          <span className="cz-muted">
            a {award.more === 1 ? "ešte jedna ďalšia" : `ďalšie ${award.more}`}
          </span>
        )}
        <button
          type="button"
          className="button primary cz-save"
          onClick={() => {
            setAward(null);
            onOpen();
          }}
        >
          Pozrieť zbierku
        </button>
      </div>
    </div>
  );
}
