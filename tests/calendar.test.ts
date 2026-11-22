import assert from "node:assert/strict";
import test from "node:test";
import { calendarBounds, calendarDays, moveCalendar } from "../lib/calendar.ts";

test("calendar months have real month boundaries, including leap February and year transitions", () => {
  assert.deepEqual(calendarBounds("month", "2027-02-22"), {
    start: "2027-02-01",
    end: "2027-02-28",
  });
  assert.deepEqual(calendarBounds("month", "2028-02-22"), {
    start: "2028-02-01",
    end: "2028-02-29",
  });
  assert.deepEqual(calendarBounds("month", "2026-12-31"), {
    start: "2026-12-01",
    end: "2026-12-31",
  });
  assert.equal(moveCalendar("month", "2026-12-31", 1), "2027-01-01");
  assert.equal(moveCalendar("month", "2027-03-31", -1), "2027-02-01");
});

test("calendar grid starts on Monday and contains every month day exactly once across DST", () => {
  const february = calendarDays("month", "2027-02-20");
  assert.equal(february.days.length, 28);
  const march = calendarDays("month", "2026-03-29");
  assert.equal(march.days[0], "2026-02-23");
  assert.equal(march.days.at(-1), "2026-04-05");
  assert.equal(march.days.length, 42);
  assert.equal(march.days.filter((d) => d.startsWith("2026-03")).length, 31);
  assert.equal(new Set(march.days).size, march.days.length);
  assert.deepEqual(calendarBounds("week", "2026-11-22"), {
    start: "2026-11-16",
    end: "2026-11-22",
  });
});
