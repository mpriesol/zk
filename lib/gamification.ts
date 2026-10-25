import type {
  Activity,
  ActivityGroup,
  Condition,
  Course,
  Progress,
  Rule,
  RuleProgress,
  Summary,
  WeekStat,
} from "./types.ts";
import { addDays, periodWeeks, weekStart } from "./dates.ts";

const GROUP_LABELS: Record<ActivityGroup, string> = {
  foot: "pohyb po vlastných",
  exercise: "cvičenie",
  other: "iný pohyb",
  task: "dobrovoľná úloha",
};

/** Initial server seed. No hidden task names or configuration belong in this module. */
export function defaultRules(startDate: string): Rule[] {
  const base = { version: 1, effectiveFrom: startDate, active: true };
  return [
    {
      ...base,
      id: "rhythm-v1",
      key: "rhythm",
      name: "Pravidelnosť",
      gem: "kristal",
      period: "week",
      description:
        "Zaznamenaj pohyb v troch rôznych dňoch jedného týždňa. Každý druh pohybu sa počíta; dni nemusia nasledovať za sebou. Raz za týždeň.",
      condition: { kind: "days", count: 3 },
    },
    {
      ...base,
      id: "foot-v1",
      key: "foot",
      name: "Pohyb",
      gem: "smaragd",
      period: "week",
      description:
        "Dve prechádzky, túry alebo behy po aspoň 30 minút v jednom týždni. Chôdza je plnohodnotná cesta. Raz za týždeň.",
      condition: {
        kind: "activities",
        count: 2,
        groups: ["foot"],
        minMinutes: 30,
      },
    },
    {
      ...base,
      id: "support-v1",
      key: "support",
      name: "Sila",
      gem: "jantar",
      period: "week",
      description:
        "Dve cvičenia po aspoň 15 minút v jednom týždni. Stačí domáce cvičenie s vlastnou váhou alebo mobilita. Raz za týždeň.",
      condition: {
        kind: "activities",
        count: 2,
        groups: ["exercise"],
        minMinutes: 15,
      },
    },
    {
      ...base,
      id: "variety-v1",
      key: "variety",
      name: "Pestrosť",
      gem: "ametyst",
      period: "course",
      description:
        "Počas prípravy spoj tri pohyby po vlastných po aspoň 30 minút s tromi cvičeniami po aspoň 15 minút. Vyváženie dvoch oblastí, nie súťaž v objeme. Raz za prípravu.",
      condition: {
        kind: "combination",
        conditions: [
          { kind: "activities", count: 3, groups: ["foot"], minMinutes: 30 },
          {
            kind: "activities",
            count: 3,
            groups: ["exercise"],
            minMinutes: 15,
          },
        ],
      },
    },
    {
      ...base,
      id: "equipment-v1",
      key: "equipment",
      name: "Výbava",
      gem: "zafir",
      period: "course",
      description:
        "Prejdi zoznam výbavy, skontroluj vrstvy oblečenia a priprav plán doplnenia alebo požičania chýbajúcich vecí. Potvrď dokončenie praktickej úlohy. Nákup sa nevyžaduje. Raz za prípravu.",
      condition: { kind: "manual", count: 1 },
    },
  ];
}

function qualifying(
  condition: Extract<Condition, { kind: "days" | "activities" }>,
  activities: Activity[],
): Activity[] {
  // A real record is counted once even if a caller accidentally repeats a join row.
  const distinct = new Map(
    activities.map((activity) => [activity.id, activity]),
  );
  return [...distinct.values()]
    .filter((activity) => {
      if (activity.group === "task") return false;
      if (
        condition.groups?.length &&
        !condition.groups.includes(activity.group)
      )
        return false;
      if (
        condition.minMinutes !== undefined &&
        (activity.minutes === null ||
          !Number.isFinite(activity.minutes) ||
          activity.minutes < condition.minMinutes)
      )
        return false;
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function conditionDescription(
  condition: Extract<Condition, { kind: "days" | "activities" }>,
): string {
  const subject = condition.kind === "days" ? "rôzne pohybové dni" : "aktivity";
  const groups = condition.groups?.length
    ? ` (${condition.groups.map((group) => GROUP_LABELS[group]).join(", ")})`
    : "";
  const duration =
    condition.minMinutes !== undefined
      ? `; každá započítaná aktivita aspoň ${condition.minMinutes} min`
      : "";
  return `${condition.count} ${subject}${groups}${duration}`;
}

/** Pure deterministic evaluation. Caller must scope activities to an authorized member and period. */
export function evaluateCondition(
  condition: Condition,
  activities: Activity[],
  manualCount = 0,
): Progress {
  if (condition.kind === "combination") {
    if (!condition.conditions.length)
      throw new RangeError("Kombinácia potrebuje aspoň jednu podmienku.");
    const parts = condition.conditions.map((part) =>
      evaluateCondition(part, activities, manualCount),
    );
    const complete = parts.every((part) => part.complete);
    return {
      current: parts.filter((part) => part.complete).length,
      target: parts.length,
      complete,
      explanation: parts.map((part) => part.explanation).join(" + "),
      countedActivityIds: [
        ...new Set(parts.flatMap((part) => part.countedActivityIds)),
      ].sort(),
      missing: complete
        ? "Splnené všetky časti."
        : parts
            .filter((part) => !part.complete)
            .map((part) => part.missing)
            .join(" · "),
      parts,
    };
  }
  if (!Number.isInteger(condition.count) || condition.count < 1)
    throw new RangeError("Cieľ musí byť kladné celé číslo.");
  if (condition.kind === "manual") {
    const current = Math.min(
      condition.count,
      Math.max(0, Math.floor(manualCount)),
    );
    return {
      current,
      target: condition.count,
      complete: current >= condition.count,
      explanation: `${condition.count} potvrdená praktická úloha`,
      countedActivityIds: [],
      missing:
        current >= condition.count
          ? "Praktická úloha je potvrdená."
          : `Zostáva potvrdiť: ${condition.count - current}.`,
    };
  }
  if (
    condition.minMinutes !== undefined &&
    (!Number.isFinite(condition.minMinutes) || condition.minMinutes < 0)
  ) {
    throw new RangeError("Minimálne trvanie nesmie byť záporné.");
  }
  const included = qualifying(condition, activities);
  const count =
    condition.kind === "days"
      ? new Set(included.map((activity) => activity.date)).size
      : included.length;
  const current = Math.min(count, condition.count);
  const complete = count >= condition.count;
  const explanation = conditionDescription(condition);
  return {
    current,
    target: condition.count,
    complete,
    explanation,
    countedActivityIds: included.map((activity) => activity.id),
    missing: complete
      ? "Podmienka splnená."
      : `Zostáva ${condition.count - count} ${condition.kind === "days" ? "pohybových dní" : "aktivít"}: ${explanation}.`,
  };
}

/**
 * Evaluates one rule version over calendar periods. The server selects the correct
 * version per period and stores its snapshot; this function never rewrites history.
 */
export function evaluateRule(
  rule: Rule,
  activities: Activity[],
  course: Course,
  today: string,
  manualCount = 0,
): RuleProgress[] {
  if (
    !rule.active ||
    course.startDate > today ||
    course.startDate > course.endDate
  )
    return [];
  const through = today < course.endDate ? today : course.endDate;
  const scope = activities.filter(
    (activity) =>
      activity.courseId === course.id &&
      activity.date >= course.startDate &&
      activity.date <= through,
  );
  const periods =
    rule.period === "week"
      ? periodWeeks(course.startDate, through).map((start) => ({
          start,
          end: addDays(start, 6),
        }))
      : [{ start: course.startDate, end: course.endDate }];
  return periods.map(({ start, end }) => ({
    rule,
    periodStart: start,
    periodEnd: end,
    progress: evaluateCondition(
      rule.condition,
      scope.filter(
        (activity) => activity.date >= start && activity.date <= end,
      ),
      manualCount,
    ),
  }));
}

function aggregate(activities: Activity[]): Omit<WeekStat, "week"> {
  const movement = activities.filter((activity) => activity.group !== "task");
  const withMinutes = movement.filter(
    (activity) =>
      activity.minutes !== null && Number.isFinite(activity.minutes),
  );
  return {
    activities: activities.length,
    movementDays: new Set(
      movement.map((activity) => `${activity.memberId}:${activity.date}`),
    ).size,
    minutes: withMinutes.length
      ? withMinutes.reduce((sum, activity) => sum + activity.minutes!, 0)
      : null,
    missingMinutes: movement.length - withMinutes.length,
    people: new Set(activities.map((activity) => activity.memberId)).size,
  };
}

/** Caller passes only visible, authorized records, already filtered to selected dates. */
export function summarize(activities: Activity[]): Summary {
  const distinct = [
    ...new Map(activities.map((activity) => [activity.id, activity])).values(),
  ];
  const byType = new Map<
    string,
    { typeId: string; name: string; count: number }
  >();
  const byWeek = new Map<string, Activity[]>();
  for (const activity of distinct) {
    const group = byType.get(activity.typeId) ?? {
      typeId: activity.typeId,
      name: activity.typeName,
      count: 0,
    };
    group.count += 1;
    byType.set(activity.typeId, group);
    const week = weekStart(activity.date);
    byWeek.set(week, [...(byWeek.get(week) ?? []), activity]);
  }
  const weeks = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, records]) => ({ week, ...aggregate(records) }));
  return {
    ...aggregate(distinct),
    byType: [...byType.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "sk"),
    ),
    weeks,
  };
}
