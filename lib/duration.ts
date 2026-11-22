export type DurationUnit = "min" | "hour";
export function parseDuration(text: string, unit: DurationUnit): number | null {
  const value = text.trim().replace(",", ".");
  if (!value) return null;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))
    throw new Error("Trvanie zadaj ako číslo, napríklad 45 min alebo 1,5 hod.");
  const minutes = Number(value) * (unit === "hour" ? 60 : 1);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440)
    throw new Error("Trvanie musí byť väčšie ako nula a najviac 24 hodín.");
  return minutes;
}
/** A unit switch only changes the display. The form retains canonical minutes;
 * repeating decimal hours (e.g. one minute) must not change a stored duration. */
export function displayDuration(
  minutes: number | null,
  unit: DurationUnit,
): string {
  return minutes === null
    ? ""
    : Number((minutes / (unit === "hour" ? 60 : 1)).toPrecision(12))
        .toString()
        .replace(".", ",");
}
