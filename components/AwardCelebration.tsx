"use client";
import { useEffect, useRef, useState } from "react";
import { Snowflake, X } from "lucide-react";
import type { AppState, RewardVisual } from "../lib/types";
import AwardArt from "./AwardArt";

export default function AwardCelebration({
  state,
  blocked,
  onOpen,
}: {
  state: AppState;
  blocked: boolean;
  onOpen: () => void;
}) {
  const [award, setAward] = useState<{
    name: string;
    key: string;
    visual?: RewardVisual;
  } | null>(null);
  const memory = useRef<Set<string> | null>(null);
  const identity = `${state.course.id}-${state.me.id}-${state.course.preparationStartedAt || state.course.startDate}`;
  const oldIdentity = useRef(identity);
  useEffect(() => {
    const all = [
      ...state.awards
        .filter((a) => a.memberId === state.me.id)
        .map((a) => ({
          id: `rule:${a.id}`,
          name: a.name,
          key: a.ruleKey,
          visual: a.visual || a.snapshot.visual,
        })),
      ...(state.personalAwards || [])
        .filter((a) => a.memberId === state.me.id)
        .map((a) => ({
          id: `personal:${a.id}`,
          name: a.snapshot.name,
          key: a.definitionId,
          visual: a.snapshot.visual,
        })),
      ...state.challenges
        .filter((c) => c.completed && c.kind !== "cold")
        .map((c) => ({
          id: `challenge:${c.id}`,
          name: c.reward || c.name,
          key: c.id,
          visual: c.visual,
        })),
    ];
    const key = `cz-awards-seen-${identity}`;
    if (identity !== oldIdentity.current) {
      memory.current = null;
      oldIdentity.current = identity;
      setAward(null);
    }
    if (!memory.current) {
      try {
        const stored = localStorage.getItem(key);
        const parsed = stored ? JSON.parse(stored) : null;
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
    const fresh = all.find((a) => !memory.current!.has(a.id));
    if (fresh) {
      memory.current.add(fresh.id);
      setAward(fresh);
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
    const timeout = setTimeout(() => setAward(null), 8000);
    return () => clearTimeout(timeout);
  }, [award]);
  if (!award || blocked) return null;
  return (
    <aside className="award-celebration" role="status" aria-live="polite">
      {state.me.animations && (
        <div className="snow-confetti" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => (
            <Snowflake
              key={i}
              size={12 + (i % 4) * 3}
              style={
                {
                  "--flake-x": `${((i * 47) % 340) - 170}px`,
                  "--flake-delay": `${(i % 6) * 0.09}s`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}
      <AwardArt visual={award.visual} rewardKey={award.key} earned />
      <button
        className="celebration-text"
        onClick={() => {
          setAward(null);
          onOpen();
        }}
      >
        <small>NOVÁ ODMENA V ZBIERKE</small>
        <strong>{award.name}</strong>
        <span>Pozrieť odmenu →</span>
      </button>
      <button
        className="icon-button"
        aria-label="Zavrieť oznámenie o odmene"
        onClick={() => setAward(null)}
      >
        <X size={17} />
      </button>
    </aside>
  );
}
