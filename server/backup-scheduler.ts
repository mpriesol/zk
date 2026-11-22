import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface BackupScheduleOptions {
  mode: "internal" | "external" | "off";
  time?: string;
  getTimezone: () => string | Promise<string>;
  runSnapshot: (day: string, timezone: string) => Promise<unknown>;
  now?: () => Date;
  intervalMs?: number;
  log?: (message: string) => void;
}
export function schedulerMode(
  env: NodeJS.ProcessEnv,
  directory: string,
): "internal" | "external" | "off" {
  const configured =
    env.BACKUP_SCHEDULER ||
    (env.NODE_ENV === "production" ? "internal" : "off");
  if (!["internal", "external", "off"].includes(configured))
    throw new Error("BACKUP_SCHEDULER musí byť internal, external alebo off.");
  if (
    configured === "internal" &&
    existsSync(resolve(directory, ".external-scheduler"))
  )
    return "external";
  return configured as "internal" | "external" | "off";
}
export function dueBackupDay(
  now: Date,
  timezone: string,
  time = "03:15",
): string | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error("BACKUP_TIME musí mať tvar HH:MM.");
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.hour}:${parts.minute}` >= time
    ? `${parts.year}-${parts.month}-${parts.day}`
    : null;
}
export function startBackupScheduler(options: BackupScheduleOptions) {
  const log = options.log || console.log;
  let running: Promise<void> | null = null,
    completedDay: string | null = null,
    retryAt = 0,
    stopped = false;
  const tick = async () => {
    if (options.mode !== "internal" || stopped) return;
    if (running) return running;
    const now = options.now?.() || new Date();
    if (now.getTime() < retryAt) return;
    running = (async () => {
      try {
        const zone = await options.getTimezone(),
          day = dueBackupDay(now, zone, options.time);
        if (!day || completedDay === day) return;
        await options.runSnapshot(day, zone);
        completedDay = day;
        retryAt = 0;
        log(`Denná záloha overená: ${day} (${zone}).`);
      } catch (error) {
        retryAt = now.getTime() + 5 * 60_000;
        log(
          `Denná záloha zlyhala; zopakujem ju: ${error instanceof Error ? error.message : "neznáma chyba"}`,
        );
      }
    })().finally(() => {
      running = null;
    });
    await running;
  };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(options.time || "03:15"))
    throw new Error("BACKUP_TIME musí mať tvar HH:MM.");
  log(`Plánovač záloh: ${options.mode}; čas ${options.time || "03:15"}.`);
  const timer =
    options.mode === "internal"
      ? setInterval(() => void tick(), options.intervalMs || 30_000)
      : null;
  timer?.unref();
  if (options.mode === "internal") void tick();
  return {
    tick,
    stop: async () => {
      stopped = true;
      if (timer) clearInterval(timer);
      await running;
    },
  };
}
