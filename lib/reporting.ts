import type {
  Activity,
  Award,
  ColdEntry,
  Member,
  PersonalAwardGrant,
} from "./types.ts";
import { validDate, weekStart } from "./dates.ts";

export interface ReportCompletion {
  id?: string;
  memberId: string;
  challengeId: string;
  date: string;
  name?: string;
  note?: string;
}
export interface AdminReportingData {
  activities: Activity[];
  members: Member[];
  awards: Award[];
  completions: ReportCompletion[];
  coldEntries: ColdEntry[];
  personalAwards: PersonalAwardGrant[];
}
export interface ReportRange {
  startDate?: string;
  endDate?: string;
  includeInactive?: boolean;
}
export interface ReportCandidate {
  memberId: string;
  nickname: string;
  active: boolean;
  value: number;
}
export interface ReportCategory {
  id: string;
  name: string;
  definition: string;
  unit: string;
  kind: "leader" | "nomination";
  /** Only tied maxima for a leader; all eligible people for a nomination. */
  candidates: ReportCandidate[];
  ranking: ReportCandidate[];
}
export interface MemberReport {
  memberId: string;
  nickname: string;
  active: boolean;
  activities: number;
  activeDays: number;
  activeWeeks: number;
  activeMonths: number;
  minutes: number;
  missingMinutes: number;
  distance: number;
  missingDistance: number;
  distinctTypes: number;
  weekendDays: number;
  weekdayDays: number;
  calendarWeekdays: number;
  mondayDays: number;
  sundayDays: number;
  shortActivityDays: number;
  footAndExerciseDays: number;
  exactThirtyActivities: number;
  sameDurationTypes: number;
  photos: number;
  photoActivities: number;
  footActivities: number;
  exerciseActivities: number;
  awards: number;
  personalAwards: number;
  completedTasks: number;
  coldDays: number;
  byType: Record<
    string,
    { name: string; count: number; minutes: number; distance: number }
  >;
  byRule: Record<string, { name: string; count: number }>;
  byMonth: Record<string, { days: number; weeks: number; activities: number }>;
}
export interface AdminStatisticsReport {
  range: ReportRange;
  people: MemberReport[];
  leaders: ReportCategory[];
  nominations: ReportCategory[];
  totals: {
    members: number;
    activities: number;
    activeMembers: number;
    missingMinutes: number;
    missingDistance: number;
  };
}

const within = (date: string, range: ReportRange) =>
  validDate(date) &&
  (!range.startDate || date >= range.startDate) &&
  (!range.endDate || date <= range.endDate);
const numberValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
const round = (value: number) => Math.round(value * 100) / 100;
const unique = <T extends { id: string }>(items: T[]) => [
  ...new Map(items.map((item) => [item.id, item])).values(),
];
const orderPeople = (a: ReportCandidate, b: ReportCandidate) =>
  b.value - a.value ||
  a.nickname.localeCompare(b.nickname, "sk") ||
  a.memberId.localeCompare(b.memberId);
const monthName = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString("sk-SK", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/** Pure aggregation. Activity dates, never upload timestamps, determine days. */
export function buildAdminStatistics(
  data: AdminReportingData,
  range: ReportRange = {},
): AdminStatisticsReport {
  if (
    (range.startDate && !validDate(range.startDate)) ||
    (range.endDate && !validDate(range.endDate)) ||
    (range.startDate && range.endDate && range.startDate > range.endDate)
  ) {
    throw new Error("Vyber platné obdobie od začiatku po koniec.");
  }
  const members = unique(data.members).filter(
    (member) => range.includeInactive !== false || member.active,
  );
  const allowed = new Set(members.map((member) => member.id));
  const activities = unique(data.activities).filter(
    (activity) =>
      allowed.has(activity.memberId) &&
      activity.group !== "task" &&
      within(activity.date, range),
  );
  const awards = unique(data.awards).filter(
    (award) => allowed.has(award.memberId) && within(award.periodEnd, range),
  );
  const personalAwards = unique(data.personalAwards).filter(
    (award) => allowed.has(award.memberId) && within(award.date, range),
  );
  const completions = data.completions.filter(
    (item) => allowed.has(item.memberId) && within(item.date, range),
  );
  const coldEntries = unique(data.coldEntries).filter(
    (item) => allowed.has(item.memberId) && within(item.date, range),
  );
  const people: MemberReport[] = members
    .map((member) => {
      const rows = activities.filter(
        (activity) => activity.memberId === member.id,
      );
      const days = new Set(rows.map((activity) => activity.date));
      const memberAwards = awards.filter(
        (award) => award.memberId === member.id,
      );
      const byType: MemberReport["byType"] = {};
      const byRule: MemberReport["byRule"] = {};
      const byMonth: MemberReport["byMonth"] = {};
      for (const row of rows) {
        const item = (byType[row.typeId] ||= {
          name: row.typeName,
          count: 0,
          minutes: 0,
          distance: 0,
        });
        item.count += 1;
        item.minutes = round(item.minutes + numberValue(row.minutes));
        item.distance = round(item.distance + numberValue(row.distance));
      }
      for (const award of memberAwards) {
        const item = (byRule[award.ruleKey] ||= { name: award.name, count: 0 });
        item.count += 1;
      }
      for (const month of new Set(rows.map((row) => row.date.slice(0, 7)))) {
        const monthRows = rows.filter((row) => row.date.startsWith(month));
        byMonth[month] = {
          days: new Set(monthRows.map((row) => row.date)).size,
          weeks: new Set(monthRows.map((row) => weekStart(row.date))).size,
          activities: monthRows.length,
        };
      }
      const weekday = (date: string) =>
        new Date(`${date}T12:00:00Z`).getUTCDay();
      const weekendDays = [...days].filter((date) =>
        [0, 6].includes(weekday(date)),
      ).length;
      const typesByDuration = new Map<number, Set<string>>();
      for (const row of rows) {
        if (
          row.minutes === null ||
          !Number.isFinite(row.minutes) ||
          row.minutes <= 0
        )
          continue;
        const types = typesByDuration.get(row.minutes) || new Set<string>();
        types.add(row.typeId);
        typesByDuration.set(row.minutes, types);
      }
      return {
        memberId: member.id,
        nickname: member.nickname,
        active: member.active,
        activities: rows.length,
        activeDays: days.size,
        activeWeeks: new Set(rows.map((row) => weekStart(row.date))).size,
        activeMonths: Object.keys(byMonth).length,
        minutes: round(
          rows.reduce((sum, row) => sum + numberValue(row.minutes), 0),
        ),
        missingMinutes: rows.filter((row) => row.minutes === null).length,
        distance: round(
          rows.reduce((sum, row) => sum + numberValue(row.distance), 0),
        ),
        missingDistance: rows.filter((row) => row.distance === null).length,
        distinctTypes: Object.keys(byType).length,
        weekendDays,
        weekdayDays: days.size - weekendDays,
        calendarWeekdays: new Set([...days].map(weekday)).size,
        mondayDays: [...days].filter((date) => weekday(date) === 1).length,
        sundayDays: [...days].filter((date) => weekday(date) === 0).length,
        shortActivityDays: new Set(
          rows
            .filter(
              (row) =>
                row.minutes !== null && row.minutes >= 5 && row.minutes <= 30,
            )
            .map((row) => row.date),
        ).size,
        footAndExerciseDays: [...days].filter(
          (date) =>
            rows.some((row) => row.date === date && row.group === "foot") &&
            rows.some((row) => row.date === date && row.group === "exercise"),
        ).length,
        exactThirtyActivities: rows.filter((row) => row.minutes === 30).length,
        sameDurationTypes: Math.max(
          0,
          ...[...typesByDuration.values()].map((types) => types.size),
        ),
        photos: rows.reduce(
          (sum, row) =>
            sum + new Set((row.photos || []).map((photo) => photo.id)).size,
          0,
        ),
        photoActivities: rows.filter((row) => row.photos?.length).length,
        footActivities: rows.filter((row) => row.group === "foot").length,
        exerciseActivities: rows.filter((row) => row.group === "exercise")
          .length,
        awards: memberAwards.length,
        personalAwards: personalAwards.filter(
          (award) => award.memberId === member.id,
        ).length,
        completedTasks: new Set(
          completions
            .filter((item) => item.memberId === member.id)
            .map((item) => item.challengeId),
        ).size,
        coldDays: new Set(
          coldEntries
            .filter((item) => item.memberId === member.id)
            .map((item) => item.date),
        ).size,
        byType,
        byRule,
        byMonth,
      };
    })
    .sort(
      (a, b) =>
        a.nickname.localeCompare(b.nickname, "sk") ||
        a.memberId.localeCompare(b.memberId),
    );
  const candidate = (person: MemberReport, value: number): ReportCandidate => ({
    memberId: person.memberId,
    nickname: person.nickname,
    active: person.active,
    value: round(value),
  });
  const leaders: ReportCategory[] = [];
  const leader = (
    id: string,
    name: string,
    definition: string,
    unit: string,
    value: (person: MemberReport) => number,
  ) => {
    const ranking = people
      .map((person) => candidate(person, value(person)))
      .filter((person) => person.value > 0)
      .sort(orderPeople);
    if (!ranking.length) return;
    leaders.push({
      id,
      name,
      definition,
      unit,
      kind: "leader",
      ranking,
      candidates: ranking.filter((person) => person.value === ranking[0].value),
    });
  };
  leader(
    "activities",
    "Najviac zápisov pohybu",
    "Počet samostatných pohybových aktivít. Praktické úlohy a otužovanie sa nepočítajú.",
    "zápisov",
    (p) => p.activities,
  );
  leader(
    "days",
    "Najviac pohybových dní",
    "Počet rôznych dátumov s aspoň jednou pohybovou aktivitou. Viac zápisov v ten istý deň je jeden deň.",
    "dní",
    (p) => p.activeDays,
  );
  leader(
    "weeks",
    "Najviac aktívnych týždňov",
    "Počet týždňov od pondelka do nedele s aspoň jedným pohybovým dňom. Týždne nemusia nasledovať po sebe.",
    "týždňov",
    (p) => p.activeWeeks,
  );
  leader(
    "minutes",
    "Najviac zapísaného času",
    "Súčet vyplnených minút pri pohybových aktivitách. Chýbajúci čas sa nedopočítava.",
    "min",
    (p) => p.minutes,
  );
  leader(
    "distance",
    "Najviac zapísanej vzdialenosti",
    "Súčet vyplnených kilometrov naprieč druhmi pohybu; nejde o porovnanie náročnosti športov.",
    "km",
    (p) => p.distance,
  );
  leader(
    "variety",
    "Najviac druhov pohybu",
    "Počet rôznych typov pohybových aktivít s aspoň jedným zápisom.",
    "druhov",
    (p) => p.distinctTypes,
  );
  leader(
    "weekends",
    "Najviac víkendových dní",
    "Počet rôznych sobôt a nedieľ s pohybom podľa dátumu aktivity.",
    "dní",
    (p) => p.weekendDays,
  );
  leader(
    "weekdays",
    "Najviac dní cez týždeň",
    "Počet rôznych pondelkov až piatkov s pohybom podľa dátumu aktivity.",
    "dní",
    (p) => p.weekdayDays,
  );
  leader(
    "photos",
    "Najviac pridaných fotiek",
    "Počet fotografií pri pohybových aktivitách. Počet reakcií ani komentárov sa nehodnotí.",
    "fotiek",
    (p) => p.photos,
  );
  leader(
    "photo-days",
    "Najviac zápisov s fotkou",
    "Počet pohybových aktivít s aspoň jednou fotografiou; viac fotiek pri jednom zápise nezvyšuje počet.",
    "zápisov",
    (p) => p.photoActivities,
  );
  leader(
    "awards",
    "Najviac základných odmien",
    "Počet získaných základných odmien, ktorých hodnotené obdobie sa končí vo vybranom rozsahu.",
    "odmien",
    (p) => p.awards,
  );
  const types = new Map(
    people.flatMap((person) =>
      Object.entries(person.byType).map(
        ([id, value]) => [id, value.name] as const,
      ),
    ),
  );
  for (const [id, name] of [...types].sort((a, b) =>
    a[1].localeCompare(b[1], "sk"),
  )) {
    leader(
      `type:${id}:count`,
      `${name}: najviac zápisov`,
      `Počet pohybových aktivít typu „${name}“.`,
      "zápisov",
      (p) => p.byType[id]?.count || 0,
    );
    leader(
      `type:${id}:minutes`,
      `${name}: zapísaný čas`,
      `Súčet vyplnených minút pri aktivitách typu „${name}“.`,
      "min",
      (p) => p.byType[id]?.minutes || 0,
    );
    leader(
      `type:${id}:distance`,
      `${name}: zapísaná vzdialenosť`,
      `Súčet vyplnených kilometrov pri aktivitách typu „${name}“.`,
      "km",
      (p) => p.byType[id]?.distance || 0,
    );
  }
  const rules = new Map(
    people.flatMap((person) =>
      Object.entries(person.byRule).map(
        ([id, value]) => [id, value.name] as const,
      ),
    ),
  );
  for (const [id, name] of [...rules].sort((a, b) =>
    a[1].localeCompare(b[1], "sk"),
  )) {
    leader(
      `rule:${id}`,
      `${name}: najviac získaní`,
      `Počet základných odmien „${name}“ podľa konca hodnoteného obdobia.`,
      "odmien",
      (p) => p.byRule[id]?.count || 0,
    );
  }
  const months = [
    ...new Set(people.flatMap((person) => Object.keys(person.byMonth))),
  ].sort();
  for (const month of months) {
    leader(
      `month:${month}:weeks`,
      `${monthName(month)}: pravidelnosť`,
      "Počet rôznych kalendárnych týždňov s pohybom v danom mesiaci. Počíta sa iba časť mesiaca vo vybranom rozsahu.",
      "týždňov",
      (p) => p.byMonth[month]?.weeks || 0,
    );
    leader(
      `month:${month}:days`,
      `${monthName(month)}: pohybové dni`,
      "Počet rôznych pohybových dní v danom mesiaci a vybranom rozsahu.",
      "dní",
      (p) => p.byMonth[month]?.days || 0,
    );
  }
  const nominations: ReportCategory[] = [];
  const nominate = (
    id: string,
    name: string,
    definition: string,
    eligible: (person: MemberReport) => boolean,
  ) => {
    const candidates = people
      .filter(eligible)
      .map((person) => candidate(person, 1));
    nominations.push({
      id,
      name,
      definition,
      unit: "splnené",
      kind: "nomination",
      candidates,
      ranking: candidates,
    });
  };
  nominate(
    "first-step",
    "Prvý krok",
    "Aspoň jeden zapísaný pohyb. Všetci, ktorí podmienku splnili, sú rovnocenní kandidáti.",
    (p) => p.activities >= 1,
  );
  nominate(
    "varied-paths",
    "Rôzne chodníky",
    "Aspoň tri rôzne typy pohybu počas vybraného obdobia.",
    (p) => p.distinctTypes >= 3,
  );
  nominate(
    "weekend",
    "Víkendový yeti",
    "Pohyb počas aspoň dvoch rôznych víkendových dní.",
    (p) => p.weekendDays >= 2,
  );
  nominate(
    "weekday",
    "Miesto v bežnom dni",
    "Pohyb v aspoň troch rôznych pracovných dňoch (pondelok až piatok, bez posudzovania sviatkov).",
    (p) => p.weekdayDays >= 3,
  );
  nominate(
    "several-weeks",
    "Tichý ťahúň",
    "Pohyb v aspoň troch rôznych týždňoch. Nemusia nasledovať po sebe.",
    (p) => p.activeWeeks >= 3,
  );
  nominate(
    "steps-strength",
    "Kroky aj sila",
    "Aspoň jeden zápis zo skupiny chôdza/turistika/beh a jeden zo skupiny cvičenie.",
    (p) => p.footActivities >= 1 && p.exerciseActivities >= 1,
  );
  nominate(
    "camera",
    "Obrázok z prípravy",
    "Aspoň jedna pohybová aktivita s fotkou. Kvalitu, obsah ani popularitu fotografie automaticky neposudzujeme.",
    (p) => p.photoActivities >= 1,
  );
  nominate(
    "calendar",
    "Sedem tvárí týždňa",
    "Počas celého obdobia aspoň jeden pohyb v každom dni týždňa. Nevyžaduje sa sedem dní za sebou.",
    (p) => p.calendarWeekdays === 7,
  );
  nominate(
    "practical",
    "Šikovné ruky",
    "Aspoň jedna potvrdená praktická úloha. Otužovanie sa do tejto podmienky nepočíta.",
    (p) => p.completedTasks >= 1,
  );
  nominate(
    "seasons",
    "Cez hranicu mesiaca",
    "Pohyb aspoň v dvoch rôznych kalendárnych mesiacoch.",
    (p) => p.activeMonths >= 2,
  );
  nominate(
    "monday-starter",
    "Pondelkový štartér",
    "Pohyb v aspoň dvoch rôznych pondelkoch podľa dátumu aktivity. Viac zápisov v jednom pondelku je jeden deň.",
    (p) => p.mondayDays >= 2,
  );
  nominate(
    "sunday-wanderer",
    "Nedeľný tulák",
    "Pohyb v aspoň dvoch rôznych nedeliach podľa dátumu aktivity; miesto ani druh pohybu nerozhoduje.",
    (p) => p.sundayDays >= 2,
  );
  nominate(
    "small-adventures",
    "Majster malých výprav",
    "Aspoň tri rôzne dni, v každom aspoň jedna pohybová aktivita so zapísaným trvaním 5 až 30 minút vrátane. Počíta sa aj pohyb doma.",
    (p) => p.shortActivityDays >= 3,
  );
  nominate(
    "double-life",
    "Dvojitý život",
    "Aspoň v jeden deň zápis zo skupiny chôdza/turistika/beh aj samostatný zápis zo skupiny cvičenie. Čas nie je podmienkou.",
    (p) => p.footAndExerciseDays >= 1,
  );
  nominate(
    "exact-thirty",
    "Presný tridsiatnik",
    "Aspoň jedna pohybová aktivita so zapísaným trvaním presne 30 minút. Názov neoznačuje vek účastníka.",
    (p) => p.exactThirtyActivities >= 1,
  );
  nominate(
    "time-twin",
    "Časový dvojník",
    "Dva rôzne typy pohybu s rovnakým kladným zapísaným trvaním v minútach. Môžu byť v rôznych dňoch; chýbajúce trvanie sa nepočíta.",
    (p) => p.sameDurationTypes >= 2,
  );
  for (const month of months) {
    nominate(
      `month:${month}`,
      `Pravidelne: ${monthName(month)}`,
      "Aspoň tri rôzne kalendárne týždne s pohybom v tomto mesiaci a zvolenom rozsahu.",
      (p) => (p.byMonth[month]?.weeks || 0) >= 3,
    );
  }
  if (range.startDate && range.endDate) {
    const weekCount =
      Math.floor(
        (Date.parse(weekStart(range.endDate)) -
          Date.parse(weekStart(range.startDate))) /
          604800000,
      ) + 1;
    if (weekCount >= 2)
      nominate(
        "each-week",
        "Každý týždeň kúsok",
        `Aspoň jeden pohyb v každom z ${weekCount} kalendárnych týždňov, ktoré zasahujú do vybraného obdobia.`,
        (p) => p.activeWeeks === weekCount,
      );
  }
  return {
    range,
    people,
    leaders,
    nominations,
    totals: {
      members: people.length,
      activities: activities.length,
      activeMembers: people.filter((person) => person.activities > 0).length,
      missingMinutes: people.reduce((sum, p) => sum + p.missingMinutes, 0),
      missingDistance: people.reduce((sum, p) => sum + p.missingDistance, 0),
    },
  };
}

/**
 * Maximum bipartite matching first maximizes the number of different recipients.
 * Remaining categories use an eligible candidate with the fewest assignments.
 * A statistical category contains only its tied maxima, so spreading can never
 * silently turn a runner-up into the person with "the most".
 */
export function assignAwardCandidates(
  categories: ReportCategory[],
  spread: boolean,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!spread) {
    for (const category of categories)
      if (category.candidates[0])
        result[category.id] = category.candidates[0].memberId;
    return result;
  }
  const memberMatch = new Map<string, string>();
  const byId = new Map(categories.map((category) => [category.id, category]));
  const ordered = [...categories].sort(
    (a, b) =>
      a.candidates.length - b.candidates.length || a.id.localeCompare(b.id),
  );
  const place = (categoryId: string, seen: Set<string>): boolean => {
    for (const person of byId.get(categoryId)?.candidates || []) {
      if (seen.has(person.memberId)) continue;
      seen.add(person.memberId);
      const previous = memberMatch.get(person.memberId);
      if (!previous || place(previous, seen)) {
        memberMatch.set(person.memberId, categoryId);
        return true;
      }
    }
    return false;
  };
  for (const category of ordered) place(category.id, new Set());
  for (const [memberId, categoryId] of memberMatch)
    result[categoryId] = memberId;
  const counts = new Map<string, number>();
  for (const id of Object.values(result))
    counts.set(id, (counts.get(id) || 0) + 1);
  for (const category of ordered) {
    if (result[category.id]) continue;
    const candidate = [...category.candidates].sort(
      (a, b) =>
        (counts.get(a.memberId) || 0) - (counts.get(b.memberId) || 0) ||
        orderPeople(a, b),
    )[0];
    if (candidate) {
      result[category.id] = candidate.memberId;
      counts.set(candidate.memberId, (counts.get(candidate.memberId) || 0) + 1);
    }
  }
  return result;
}

/** Quotes every cell and neutralizes formula prefixes before spreadsheet import. */
export function csvCell(value: string | number | boolean): string {
  let text = String(value);
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
export function statisticsCsv(
  report: AdminStatisticsReport,
  selections: Record<string, string> = {},
): string {
  const rows: Array<Array<string | number>> = [
    [
      "Sekcia",
      "Kategória",
      "Presná podmienka",
      "Účastník",
      "Členstvo",
      "Hodnota",
      "Jednotka",
      "Výsledok",
      "Návrh organizátora",
      "Od",
      "Do",
    ],
  ];
  for (const category of [...report.leaders, ...report.nominations]) {
    for (const person of category.ranking)
      rows.push([
        category.kind === "leader"
          ? "Najviac – štatistika"
          : "Nominácia – splnená podmienka",
        category.name,
        category.definition,
        person.nickname,
        person.active ? "Aktívne" : "Neaktívne",
        category.kind === "leader" ? person.value : "splnené",
        category.unit,
        category.kind === "nomination"
          ? "Oprávnený kandidát"
          : category.candidates.some(
                (item) => item.memberId === person.memberId,
              )
            ? category.candidates.length > 1
              ? "Spoločné maximum"
              : "Maximum"
            : "Ďalší záznam",
        selections[category.id] === person.memberId ? "Vybraný návrh" : "",
        report.range.startDate || "",
        report.range.endDate || "",
      ]);
  }
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}
