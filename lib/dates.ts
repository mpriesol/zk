/** Calendar-only ISO dates. UTC arithmetic deliberately avoids DST day length. */
const DAY = 86_400_000;

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return (
    Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function calendarDate(value: string): Date {
  if (!validDate(value)) throw new RangeError("Neplatný kalendárny dátum.");
  return new Date(`${value}T12:00:00.000Z`);
}

export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days))
    throw new RangeError("Počet dní musí byť celé číslo.");
  return new Date(calendarDate(date).valueOf() + days * DAY)
    .toISOString()
    .slice(0, 10);
}

export function weekStart(date: string): string {
  const weekday = calendarDate(date).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export function todayInZone(
  timezone: string,
  instant: Date = new Date(),
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (kind: string) => parts.find((part) => part.type === kind)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Monday identifiers of every intersecting week, including partial boundary weeks. */
export function periodWeeks(start: string, end: string): string[] {
  calendarDate(start);
  calendarDate(end);
  if (start > end) return [];
  const weeks: string[] = [];
  for (
    let cursor = weekStart(start);
    cursor <= end;
    cursor = addDays(cursor, 7)
  ) {
    weeks.push(cursor);
  }
  return weeks;
}
