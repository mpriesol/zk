import { addDays, weekStart as mondayOf } from "./dates.ts";

export type CalendarRange = "week" | "month";
export function calendarBounds(range: CalendarRange, anchor: string) {
  if (range === "week") {
    const start = mondayOf(anchor);
    return { start, end: addDays(start, 6) };
  }
  const start = anchor.slice(0, 7) + "-01";
  const next = new Date(`${start}T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { start, end: addDays(next.toISOString().slice(0, 10), -1) };
}
export function moveCalendar(
  range: CalendarRange,
  anchor: string,
  direction: number,
) {
  if (range === "week") return addDays(anchor, direction * 7);
  const date = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + direction);
  return date.toISOString().slice(0, 10);
}
export function calendarDays(range: CalendarRange, anchor: string) {
  const bounds = calendarBounds(range, anchor);
  const first = mondayOf(bounds.start);
  const last = addDays(mondayOf(bounds.end), 6);
  const days: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return { ...bounds, days };
}
