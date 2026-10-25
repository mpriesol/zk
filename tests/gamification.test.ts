import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultRules,
  evaluateCondition,
  evaluateRule,
  summarize,
} from "../lib/gamification.ts";
import {
  addDays,
  periodWeeks,
  todayInZone,
  validDate,
  weekStart,
} from "../lib/dates.ts";
import type { Activity, ActivityGroup, Course } from "../lib/types.ts";

const course: Course = {
  id: "test-course",
  name: "Testovací kurz",
  startDate: "2026-10-19",
  endDate: "2026-12-20",
  timezone: "Europe/Bratislava",
  squirrelLimit: 2,
  testMode: true,
};
let serial = 0;
function activity(
  date: string,
  group: ActivityGroup = "foot",
  minutes: number | null = 30,
  extra: Partial<Activity> = {},
): Activity {
  return {
    id: `a-${++serial}`,
    courseId: course.id,
    memberId: "alice",
    typeId: group,
    typeName: group,
    date,
    group,
    minutes,
    distance: null,
    note: "",
    createdAt: "2026-11-02T12:00:00Z",
    updatedAt: "2026-11-02T12:00:00Z",
    ...extra,
  };
}
function progress(
  key: string,
  records: Activity[],
  day = "2026-10-25",
  manualCount = 0,
) {
  const rule = defaultRules(course.startDate).find(
    (candidate) => candidate.key === key,
  )!;
  return evaluateRule(rule, records, course, day, manualCount);
}

test("non-runner can earn every basic reward with walks, home exercise and practical preparation", () => {
  const records = [
    activity("2026-10-19"),
    activity("2026-10-21"),
    activity("2026-10-23"),
    activity("2026-10-20", "exercise", 15),
    activity("2026-10-22", "exercise", 15),
    activity("2026-10-24", "exercise", 15),
  ];
  for (const rule of defaultRules(course.startDate)) {
    assert.equal(
      evaluateRule(rule, records, course, "2026-10-25", 1)[0].progress.complete,
      true,
      rule.name,
    );
  }
  assert.equal(
    records.some((record) => record.typeId === "run"),
    false,
  );
});

test("regular 90-minute runner earns regularity and the single foot reward, not exercise or variety", () => {
  const records = ["2026-10-19", "2026-10-21", "2026-10-23"].map((date) =>
    activity(date, "foot", 90, { typeId: "run" }),
  );
  assert.equal(progress("rhythm", records)[0].progress.complete, true);
  assert.equal(progress("foot", records)[0].progress.complete, true);
  assert.equal(progress("support", records)[0].progress.complete, false);
  assert.equal(progress("variety", records)[0].progress.complete, false);
  assert.equal(
    defaultRules(course.startDate).filter((rule) => rule.key === "foot").length,
    1,
  );
});

test("return after an empty week preserves earlier results and allows a new independent week", () => {
  const records = [
    "2026-10-19",
    "2026-10-21",
    "2026-10-23",
    "2026-11-02",
    "2026-11-04",
    "2026-11-06",
  ].map((date) => activity(date));
  const weeks = progress("rhythm", records, "2026-11-08");
  assert.deepEqual(
    weeks.map((week) => week.progress.complete),
    [true, false, true],
  );
  assert.equal(weeks[0].progress.current, 3);
  assert.equal(weeks[2].progress.current, 3);
});

test("single Saturday hike contributes one day and one foot activity, grants no duplicated sport reward", () => {
  const records = [activity("2026-10-24", "foot", 240, { typeId: "hike" })];
  assert.equal(progress("rhythm", records)[0].progress.current, 1);
  assert.equal(progress("foot", records)[0].progress.current, 1);
  assert.equal(progress("foot", records)[0].progress.complete, false);
  assert.equal(progress("support", records)[0].progress.current, 0);
  assert.equal(progress("variety", records)[0].progress.complete, false);
  assert.equal(progress("variety", records)[0].progress.parts?.[0].current, 1);
});

test("longer duration never invalidates a previously qualifying activity", () => {
  const records = [
    activity("2026-10-19", "foot", 30),
    activity("2026-10-20", "foot", 30),
  ];
  const before = progress("foot", records)[0].progress;
  const after = progress(
    "foot",
    records.map((record) => ({ ...record, minutes: 300 })),
  )[0].progress;
  assert.deepEqual(after, before);
});

test("two activities on the same day are two records but one movement day", () => {
  const records = [
    activity("2026-10-19"),
    activity("2026-10-19", "exercise", 15),
  ];
  const result = summarize(records);
  assert.equal(result.activities, 2);
  assert.equal(result.movementDays, 1);
  assert.equal(result.minutes, 45);
  assert.equal(progress("rhythm", records)[0].progress.current, 1);
});

test("missing duration remains unknown and cannot pass a minimum-duration rule", () => {
  const records = [activity("2026-10-19", "foot", null)];
  assert.equal(progress("foot", records)[0].progress.current, 0);
  assert.equal(progress("rhythm", records)[0].progress.current, 1);
  assert.equal(summarize(records).minutes, null);
  assert.equal(summarize(records).missingMinutes, 1);
  const mixed = summarize([...records, activity("2026-10-20", "exercise", 15)]);
  assert.equal(mixed.minutes, 15);
  assert.equal(mixed.missingMinutes, 1);
});

test("voluntary tasks never count as training minutes or movement days even if malformed data includes minutes", () => {
  const records = [activity("2026-10-19", "task", 999)];
  assert.equal(summarize(records).movementDays, 0);
  assert.equal(summarize(records).minutes, null);
  assert.equal(summarize(records).missingMinutes, 0);
  assert.equal(summarize(records).activities, 1);
  assert.equal(progress("rhythm", records)[0].progress.current, 0);
  assert.equal(
    evaluateCondition(
      { kind: "activities", count: 1, groups: ["task"] },
      records,
    ).current,
    0,
  );
});

test("Sunday entered on Monday remains in the Sunday calendar week", () => {
  const sunday = activity("2026-10-25", "foot", 30, {
    createdAt: "2026-10-26T10:00:00Z",
  });
  const weeks = progress("foot", [sunday], "2026-10-26");
  assert.equal(weeks[0].periodStart, "2026-10-19");
  assert.equal(weeks[0].periodEnd, "2026-10-25");
  assert.equal(weeks[0].progress.current, 1);
  assert.equal(weeks[1].progress.current, 0);
});

test("editing date across weeks and deleting records gives consistent recomputation", () => {
  const first = activity("2026-10-25");
  const records = [first, activity("2026-10-24")];
  assert.deepEqual(
    progress("foot", records, "2026-11-01").map(
      (week) => week.progress.complete,
    ),
    [true, false],
  );
  const moved = records.map((record) =>
    record.id === first.id ? { ...record, date: "2026-10-26" } : record,
  );
  assert.deepEqual(
    progress("foot", moved, "2026-11-01").map((week) => week.progress.current),
    [1, 1],
  );
  assert.equal(
    summarize(moved.filter((record) => record.id !== first.id)).activities,
    1,
  );
});

test("course boundary and future dates are excluded; boundary dates are inclusive", () => {
  const restricted = {
    ...course,
    startDate: "2026-10-21",
    endDate: "2026-10-23",
  };
  const records = [
    "2026-10-20",
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
    "2026-10-24",
  ].map((date) => activity(date));
  const rule = defaultRules(restricted.startDate)[0];
  assert.equal(
    evaluateRule(rule, records, restricted, "2026-10-25")[0].progress.current,
    3,
  );
  assert.equal(
    evaluateRule(rule, records, restricted, "2026-10-22")[0].progress.current,
    2,
  );
  assert.deepEqual(evaluateRule(rule, records, restricted, "2026-10-20"), []);
});

test("records from another course never contribute", () => {
  const records = [activity("2026-10-19", "foot", 90, { courseId: "foreign" })];
  assert.equal(progress("foot", records)[0].progress.current, 0);
});

test("repeated evaluation and duplicate query join rows are deterministic", () => {
  const records = [activity("2026-10-19"), activity("2026-10-20")];
  const result = progress("foot", records);
  assert.deepEqual(progress("foot", [...records].reverse()), result);
  assert.deepEqual(progress("foot", [...records, ...records]), result);
  assert.equal(summarize([...records, ...records]).activities, 2);
});

test("group movement days count person-days, not only calendar dates", () => {
  const records = [
    activity("2026-10-19"),
    activity("2026-10-19", "foot", 30, { memberId: "bob" }),
  ];
  assert.equal(summarize(records).movementDays, 2);
  assert.equal(summarize(records).people, 2);
  assert.equal(summarize(records).weeks[0].people, 2);
});

test("calendar arithmetic crosses DST without dropping or repeating a day", () => {
  assert.equal(addDays("2026-03-28", 1), "2026-03-29");
  assert.equal(addDays("2026-03-29", 1), "2026-03-30");
  assert.equal(addDays("2026-10-25", 1), "2026-10-26");
  assert.equal(weekStart("2026-10-25"), "2026-10-19");
  assert.equal(weekStart("2026-10-26"), "2026-10-26");
  assert.deepEqual(periodWeeks("2026-10-21", "2026-11-02"), [
    "2026-10-19",
    "2026-10-26",
    "2026-11-02",
  ]);
  assert.equal(
    todayInZone("Europe/Bratislava", new Date("2026-10-24T22:30:00Z")),
    "2026-10-25",
  );
  assert.equal(
    todayInZone("Europe/Bratislava", new Date("2026-10-25T23:30:00Z")),
    "2026-10-26",
  );
});

test("invalid calendar dates and invalid rule conditions fail explicitly", () => {
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2026-2-03"), false);
  assert.equal(validDate("2028-02-29"), true);
  assert.throws(() => weekStart("2026-02-30"), RangeError);
  assert.throws(
    () => evaluateCondition({ kind: "days", count: 0 }, []),
    RangeError,
  );
  assert.throws(
    () => evaluateCondition({ kind: "combination", conditions: [] }, []),
    RangeError,
  );
});

test("empty summaries are honest empty states, not invented minutes or participants", () => {
  assert.deepEqual(summarize([]), {
    activities: 0,
    movementDays: 0,
    minutes: null,
    missingMinutes: 0,
    people: 0,
    byType: [],
    weeks: [],
  });
});

test("manual basic task does not rely on hidden bonus activities or movement minutes", () => {
  assert.equal(
    progress("equipment", [], "2026-10-25", 0)[0].progress.complete,
    false,
  );
  assert.equal(
    progress("equipment", [], "2026-10-25", 1)[0].progress.complete,
    true,
  );
  assert.equal(
    progress("equipment", [activity("2026-10-19", "task")], "2026-10-25", 0)[0]
      .progress.complete,
    false,
  );
});

test("visible names use the agreed direct labels while stable rule keys are preserved", () => {
  const rules = defaultRules(course.startDate);
  assert.deepEqual(
    rules.map((rule) => [rule.key, rule.name]),
    [
      ["rhythm", "Pravidelnosť"],
      ["foot", "Pohyb"],
      ["support", "Sila"],
      ["variety", "Pestrosť"],
      ["equipment", "Výbava"],
    ],
  );
});
