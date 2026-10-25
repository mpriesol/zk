"use client";

import { Check, ChevronDown } from "lucide-react";
import type { Activity, Award, Condition, RuleProgress } from "../lib/types";
import { Empty, Gem, fmt } from "./ui";

export interface AwardHistoryProps {
  awards: Award[];
  activities: Activity[];
  /** Server-calculated details for the same member. No entitlement is calculated in this component. */
  progress: RuleProgress[];
}

const groupNames = {
  foot: "chôdza, turistika alebo beh",
  exercise: "cvičenie",
  other: "iný pohyb",
  task: "praktická úloha",
};
const gemIndexes: Record<string, number> = {
  rhythm: 0,
  foot: 1,
  support: 2,
  variety: 3,
  equipment: 4,
};

/** Presentation of the saved condition, not a new calculation or latest-rule lookup. */
function conditionText(condition: Condition): string[] {
  if (condition.kind === "combination")
    return condition.conditions.flatMap(conditionText);
  if (condition.kind === "manual")
    return [`Potvrdené praktické úlohy: ${condition.count}.`];
  const subject =
    condition.kind === "days" ? "Rôzne pohybové dni" : "Vhodné aktivity";
  const groups = condition.groups?.length
    ? ` Druh pohybu: ${condition.groups.map((group) => groupNames[group]).join("; ")}.`
    : " Započítava sa ľubovoľný pohyb.";
  const minutes =
    condition.minMinutes === undefined
      ? ""
      : ` Započítaná aktivita trvá aspoň ${condition.minMinutes} minút.`;
  return [`${subject}: ${condition.count}.${groups}${minutes}`];
}
function containsManual(condition: Condition): boolean {
  return (
    condition.kind === "manual" ||
    (condition.kind === "combination" &&
      condition.conditions.some(containsManual))
  );
}

export default function AwardHistory({
  awards,
  activities,
  progress,
}: AwardHistoryProps) {
  if (!awards.length)
    return (
      <Empty title="Zatiaľ bez odmeny">
        Podmienky a svoj progres nájdeš vo Výzvach.
      </Empty>
    );

  const ordered = [...awards].sort(
    (left, right) =>
      right.periodStart.localeCompare(left.periodStart) ||
      left.snapshot.name.localeCompare(right.snapshot.name, "sk"),
  );

  return (
    <div className="reward-grid">
      {ordered.map((award) => {
        const snapshot = award.snapshot;
        // Award identity + owner + exact saved version prevent matching another
        // participant's progress or substituting today's rules for old conditions.
        const detail = progress.find(
          (entry) =>
            entry.award?.id === award.id &&
            entry.award.memberId === award.memberId &&
            entry.rule.key === award.ruleKey &&
            entry.rule.version === award.ruleVersion &&
            entry.periodStart === award.periodStart &&
            entry.periodEnd === award.periodEnd,
        );
        const calculation = detail?.progress.complete
          ? detail.progress
          : undefined;
        const ids = [...new Set(calculation?.countedActivityIds ?? [])];
        const counted = ids
          .map((id) =>
            activities.find(
              (activity) =>
                activity.id === id &&
                activity.memberId === award.memberId &&
                activity.date >= award.periodStart &&
                activity.date <= award.periodEnd,
            ),
          )
          .filter((activity): activity is Activity => !!activity)
          .sort(
            (left, right) =>
              left.date.localeCompare(right.date) ||
              left.typeName.localeCompare(right.typeName, "sk"),
          );
        const unavailable = ids.length - counted.length;
        return (
          <article className="reward-card complete" key={award.id}>
            <div className="reward-title">
              <Gem earned index={gemIndexes[award.ruleKey] ?? 0} />
              <div>
                <span className="eyebrow">ZÍSKANÁ ODMENA</span>
                <h3>{snapshot.name}</h3>
              </div>
              <span className="pill success">
                <Check size={12} aria-hidden="true" /> Splnené
              </span>
            </div>
            <p className="small muted">
              {fmt(award.periodStart)} – {fmt(award.periodEnd)} vrátane ·
              pravidlá v{award.ruleVersion}
            </p>
            <p>{snapshot.description}</p>
            <p className="small">
              Odmena je udelená. Na jej získanie už nič nechýba.
            </p>
            <details className="rule-explanation">
              <summary className="text-button reward-detail">
                Za čo a ktoré záznamy
                <ChevronDown size={14} aria-hidden="true" />
              </summary>
              <p className="small">Podmienky uložené pri udelení odmeny:</p>
              <ul className="small">
                {conditionText(snapshot.condition).map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
              <p className="small muted">
                {snapshot.period === "week"
                  ? "Najviac jedna odmena za týždeň."
                  : "Najviac jedna odmena za prípravu."}
              </p>
              {calculation ? (
                <>
                  <p>
                    <strong>Čo sa započítalo</strong>
                  </p>
                  {calculation.parts && (
                    <ul className="small">
                      {calculation.parts.map((part, index) => (
                        <li key={index}>
                          {part.explanation} · {part.current}/{part.target} ·
                          splnené
                        </li>
                      ))}
                    </ul>
                  )}
                  {counted.length > 0 && (
                    <ul className="small">
                      {counted.map((activity) => (
                        <li key={activity.id}>
                          <time dateTime={activity.date}>
                            {fmt(activity.date)}
                          </time>{" "}
                          · {activity.typeName}
                          {activity.minutes !== null
                            ? ` · ${activity.minutes} min`
                            : " · trvanie neuvedené"}
                        </li>
                      ))}
                    </ul>
                  )}
                  {containsManual(snapshot.condition) && (
                    <p className="small">
                      Započítané je potvrdenie praktickej úlohy. Nevytvára
                      pohybové minúty ani pohybový deň.
                    </p>
                  )}
                  {unavailable > 0 && (
                    <p className="small muted">
                      Počet započítaných záznamov mimo načítaného prehľadu:{" "}
                      {unavailable}. Ich podrobnosti tu nezobrazujeme.
                    </p>
                  )}
                </>
              ) : (
                <p className="small muted">
                  Odmena a jej pôvodné podmienky sú uložené. Podrobný serverový
                  výpočet sa v tomto prehľade nenačítal; obnov prehľad a skús to
                  znova.
                </p>
              )}
              <p className="small muted">
                Udelené {fmt(award.earnedAt)}. Prípadná oprava zápisu používa
                pravidlá príslušného obdobia.
              </p>
            </details>
          </article>
        );
      })}
    </div>
  );
}
