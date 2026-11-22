import test from "node:test";
import assert from "node:assert/strict";
import {
  assignAwardCandidates,
  buildAdminStatistics,
  statisticsCsv,
  type AdminReportingData,
  type ReportCategory,
} from "../lib/reporting.ts";
import type { Activity, Member } from "../lib/types.ts";

const member = (id: string, active = true): Member => ({
  id,
  nickname: id,
  active,
  courseId: "course",
  userId: id,
  role: "participant",
  animations: true,
  joinedAt: "2026-12-01",
});
const activity = (
  id: string,
  memberId: string,
  date: string,
  override: Partial<Activity> = {},
): Activity => ({
  id,
  memberId,
  date,
  courseId: "course",
  typeId: "walk",
  typeName: "Chôdza",
  group: "foot",
  minutes: null,
  distance: null,
  note: "",
  createdAt: "2026-12-06T03:00:00Z",
  updatedAt: "2026-12-06T03:00:00Z",
  ...override,
});
const data = (
  override: Partial<AdminReportingData> = {},
): AdminReportingData => ({
  members: [member("Ada"), member("Bela"), member("Cyril", false)],
  activities: [],
  awards: [],
  completions: [],
  coldEntries: [],
  personalAwards: [],
  ...override,
});
const category = (id: string, ids: string[]): ReportCategory => ({
  id,
  name: id,
  definition: "splnené",
  unit: "",
  kind: "nomination",
  ranking: [],
  candidates: ids.map((memberId) => ({
    memberId,
    nickname: memberId,
    active: true,
    value: 1,
  })),
});

test("date boundaries, inactive members, duplicate activities and practical tasks remain distinct", () => {
  const first = activity("a", "Ada", "2026-12-01", { minutes: 30 });
  const report = buildAdminStatistics(
    data({
      activities: [
        first,
        first,
        activity("b", "Ada", "2026-12-01"),
        activity("c", "Cyril", "2026-12-02"),
        activity("before", "Ada", "2026-11-30"),
        activity("after", "Ada", "2026-12-04"),
        activity("task", "Ada", "2026-12-02", { group: "task" }),
      ],
    }),
    { startDate: "2026-12-01", endDate: "2026-12-03" },
  );
  assert.equal(report.totals.activities, 3);
  assert.equal(report.people[0].activities, 2);
  assert.equal(report.people[0].activeDays, 1);
  assert.equal(report.people[0].minutes, 30);
  assert.equal(report.people[0].missingMinutes, 1);
  assert.equal(
    report.people.find((person) => person.memberId === "Cyril")?.active,
    false,
  );
  const activeOnly = buildAdminStatistics(
    data({ activities: [activity("c", "Cyril", "2026-12-02")] }),
    { includeInactive: false },
  );
  assert.equal(activeOnly.people.length, 2);
  assert.equal(activeOnly.totals.activities, 0);
});

test("weekday and monthly regularity use the activity date, not createdAt, with Monday week boundaries", () => {
  const report = buildAdminStatistics(
    data({
      activities: [
        activity("sun", "Ada", "2026-12-06"),
        activity("mon", "Ada", "2026-12-07"),
        activity("same-day", "Ada", "2026-12-07"),
        activity("next-month", "Ada", "2027-01-04"),
      ],
    }),
  );
  const ada = report.people[0];
  assert.equal(ada.weekendDays, 1);
  assert.equal(ada.weekdayDays, 2);
  assert.equal(ada.activeWeeks, 3);
  assert.equal(ada.byMonth["2026-12"].weeks, 2);
  assert.equal(ada.byMonth["2026-12"].days, 2);
  assert.equal(ada.activeMonths, 2);
});

test("ties retain every maximum and are never replaced with a lower statistical value", () => {
  const report = buildAdminStatistics(
    data({
      activities: [
        activity("a", "Ada", "2026-12-01", { minutes: 20 }),
        activity("b", "Bela", "2026-12-01", { minutes: 20 }),
        activity("c", "Cyril", "2026-12-01", { minutes: 10 }),
      ],
    }),
  );
  const minutes = report.leaders.find((item) => item.id === "minutes")!;
  assert.deepEqual(
    minutes.candidates.map((item) => item.memberId),
    ["Ada", "Bela"],
  );
  assert.equal(minutes.ranking.length, 3);
  const picks = assignAwardCandidates(report.leaders, true);
  for (const item of report.leaders)
    assert.ok(
      item.candidates.some((person) => person.memberId === picks[item.id]),
    );
  assert.notEqual(picks.minutes, "Cyril");
});

test("distribution maximizes distinct eligible recipients even when an earlier choice needs reassignment", () => {
  const categories = [
    category("a", ["1", "2"]),
    category("b", ["1", "3"]),
    category("c", ["1", "3"]),
    category("d", []),
  ];
  const picks = assignAwardCandidates(categories, true);
  assert.equal(new Set(Object.values(picks)).size, 3);
  assert.equal(Object.keys(picks).length, 3);
  for (const item of categories.filter((item) => item.candidates.length))
    assert.ok(
      item.candidates.some((person) => person.memberId === picks[item.id]),
    );
  assert.deepEqual(assignAwardCandidates(categories, false), {
    a: "1",
    b: "1",
    c: "1",
  });
  const repeated = assignAwardCandidates(
    [category("a", ["1"]), category("b", ["1"]), category("c", ["1", "2"])],
    true,
  );
  assert.equal(new Set(Object.values(repeated)).size, 2);
  assert.equal(repeated.a, "1");
  assert.equal(repeated.b, "1");
});

test("cold records are a neutral day count and cannot create movement, duration or practical nominations", () => {
  const report = buildAdminStatistics(
    data({
      coldEntries: [
        {
          id: "cold",
          memberId: "Ada",
          date: "2026-12-01",
          kind: "shower",
          note: "",
          createdAt: "2026-12-01T00:00:00Z",
        },
      ],
    }),
  );
  assert.equal(report.people[0].coldDays, 1);
  assert.equal(report.people[0].activities, 0);
  assert.equal(report.leaders.length, 0);
  assert.ok(report.nominations.every((item) => item.candidates.length === 0));
});

test("missing values, nominations and CSV remain explicit and safe to open in a spreadsheet", () => {
  const dangerous = member('=HYPERLINK("bad")');
  const report = buildAdminStatistics(
    data({
      members: [dangerous],
      activities: [activity("one", dangerous.id, "2026-12-01")],
    }),
    { startDate: "2026-12-01", endDate: "2026-12-31" },
  );
  assert.equal(
    report.leaders.some((item) => item.id === "minutes"),
    false,
  );
  assert.equal(report.totals.missingMinutes, 1);
  assert.equal(
    report.nominations.find((item) => item.id === "first-step")?.candidates
      .length,
    1,
  );
  const csv = statisticsCsv(report);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("'" + '=HYPERLINK(""bad"")'));
  assert.ok(csv.includes("Nominácia – splnená podmienka"));
  assert.throws(
    () =>
      buildAdminStatistics(data(), {
        startDate: "2026-12-31",
        endDate: "2026-12-01",
      }),
    /obdobie/,
  );
  assert.throws(
    () => buildAdminStatistics(data(), { startDate: "2026-02-30" }),
    /obdobie/,
  );
});

test("playful nominations count distinct activity dates and exact duration boundaries without guessing from upload timestamps", () => {
  const report = buildAdminStatistics(
    data({
      activities: [
        activity("a-mon-1", "Ada", "2026-12-07", { minutes: 5 }),
        activity("a-exercise", "Ada", "2026-12-07", {
          typeId: "exercise",
          typeName: "Cvičenie",
          group: "exercise",
          minutes: 5,
        }),
        activity("a-mon-2", "Ada", "2026-12-14", { minutes: 15 }),
        activity("a-sun-1", "Ada", "2026-12-06", { minutes: 30 }),
        activity("a-sun-2", "Ada", "2026-12-13", { minutes: 90 }),
        // Two duplicate-date walks cannot make two Mondays or three short days.
        activity("b-mon-1", "Bela", "2026-12-07", { minutes: 5 }),
        activity("b-mon-2", "Bela", "2026-12-07", { minutes: 5 }),
        activity("b-tue", "Bela", "2026-12-08", { minutes: 15 }),
        activity("b-below", "Bela", "2026-12-09", { minutes: 4.99 }),
        activity("b-above", "Bela", "2026-12-10", { minutes: 30.01 }),
        activity("b-exercise", "Bela", "2026-12-11", {
          typeId: "exercise",
          typeName: "Cvičenie",
          group: "exercise",
          minutes: null,
        }),
        activity("b-task", "Bela", "2026-12-13", {
          group: "task",
          minutes: 30,
        }),
        activity("b-invalid", "Bela", "2026-02-30", {
          minutes: 30,
          createdAt: "2026-12-14T12:00:00Z",
        }),
        activity("b-outside", "Bela", "2027-01-04", { minutes: 30 }),
        // createdAt is a Sunday in the fixture, but both actual dates are Saturdays.
        activity("c-sat-1", "Cyril", "2026-12-05"),
        activity("c-sat-2", "Cyril", "2026-12-12"),
      ],
    }),
    { startDate: "2026-12-01", endDate: "2026-12-31" },
  );
  for (const id of [
    "monday-starter",
    "sunday-wanderer",
    "small-adventures",
    "double-life",
    "exact-thirty",
    "time-twin",
  ]) {
    assert.deepEqual(
      report.nominations
        .find((item) => item.id === id)
        ?.candidates.map((item) => item.memberId),
      ["Ada"],
      id,
    );
  }
  assert.equal(
    report.people.find((person) => person.memberId === "Ada")
      ?.shortActivityDays,
    3,
  );
  assert.equal(
    report.people.find((person) => person.memberId === "Bela")
      ?.shortActivityDays,
    2,
  );
  assert.equal(
    report.nominations.find((item) => item.id === "weekend")?.name,
    "Víkendový yeti",
  );
  assert.equal(
    report.nominations.find((item) => item.id === "several-weeks")?.name,
    "Tichý ťahúň",
  );
  assert.equal(
    report.nominations.find((item) => item.id === "calendar")?.name,
    "Sedem tvárí týždňa",
  );
});
