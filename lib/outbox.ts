import { one, rows, run, type Database } from "./database.ts";
import {
  sendInvitation,
  sendPush,
  normalizeApplicationUrl,
  type SendResult,
} from "./push.ts";
import type { ServerConfig } from "./server.ts";

type Delivery = {
  status: "accepted" | "expired" | "retry" | "failed" | "cancelled";
  at: string;
  httpStatus?: number | null;
  reason?: string;
};
interface Job {
  id: string;
  course_id: string;
  member_id: string;
  kind: string;
  reference_id: string;
  payload: string;
  status: string;
  attempts: number;
  next_attempt: string;
}
export type OutboxConfig = ServerConfig & {
  invitationSender?: (payload: {
    to: string;
    nickname: string;
    courseName: string;
    siteUrl: string;
    idempotencyKey: string;
  }) => Promise<SendResult>;
};
export interface DrainSummary {
  processed: number;
  accepted: number;
  retried: number;
  failed: number;
  cancelled: number;
  skipped: number;
}
const MAX_ATTEMPTS = 8;
const LEASE_MS = 5 * 60 * 1000;
const timestamp = (cfg: ServerConfig) => cfg.now?.() ?? new Date();
const decode = (value: string): Record<string, any> => {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Neplatný záznam odosielania.");
  return parsed;
};

/** Persistent lease and per-device receipts. Runs from the Node timer, not a browser. */
export async function drainOutbox(
  db: Database,
  cfg: OutboxConfig,
  transport: typeof fetch = fetch,
): Promise<DrainSummary> {
  const summary: DrainSummary = {
    processed: 0,
    accepted: 0,
    retried: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
  };
  const now = timestamp(cfg).toISOString();
  // A crashed worker's lease expires. Attempts distinguish stale writers from a new claimant.
  await run(
    db,
    "UPDATE outbox SET status='pending' WHERE status='processing' AND next_attempt<=?",
    now,
  );
  const candidates = await rows<Job>(
    db,
    "SELECT * FROM outbox WHERE status='pending' AND next_attempt<=? ORDER BY created_at,id LIMIT 20",
    now,
  );
  for (const candidate of candidates) {
    const leaseUntil = new Date(
      timestamp(cfg).getTime() + LEASE_MS,
    ).toISOString();
    const job = await one<Job>(
      db,
      "UPDATE outbox SET status='processing',attempts=attempts+1,next_attempt=? WHERE id=? AND status='pending' AND next_attempt<=? RETURNING *",
      leaseUntil,
      candidate.id,
      now,
    );
    if (!job) continue;
    summary.processed++;
    let payload: Record<string, any> = {};
    const persist = async () =>
      run(
        db,
        "UPDATE outbox SET payload=? WHERE id=? AND status='processing' AND attempts=?",
        JSON.stringify(payload),
        job.id,
        job.attempts,
      );
    const finish = async (
      status: string,
      error: string | null = null,
      next = now,
    ) => {
      await run(
        db,
        "UPDATE outbox SET status=?,payload=?,last_error=?,next_attempt=? WHERE id=? AND status='processing' AND attempts=?",
        status,
        JSON.stringify(payload),
        error,
        next,
        job.id,
        job.attempts,
      );
      if (status === "accepted") summary.accepted++;
      else if (status === "pending") summary.retried++;
      else if (status === "failed") summary.failed++;
      else if (status === "cancelled") summary.cancelled++;
      else summary.skipped++;
    };
    const retry = async (reason: string, providerSeconds = 0) => {
      if (job.attempts >= MAX_ATTEMPTS) {
        await finish("failed", `Po ${MAX_ATTEMPTS} pokusoch: ${reason}`);
        return;
      }
      const seconds = Math.max(
        Math.min(3600, 60 * 2 ** (job.attempts - 1)),
        providerSeconds,
      );
      await finish(
        "pending",
        reason,
        new Date(timestamp(cfg).getTime() + seconds * 1000).toISOString(),
      );
    };
    try {
      payload = decode(job.payload);
      if (job.attempts > MAX_ATTEMPTS) {
        await finish("failed", "Bol dosiahnutý limit pokusov.");
        continue;
      }
      const member = await one(
        db,
        "SELECT id,email,nickname,active FROM members WHERE id=? AND course_id=?",
        job.member_id,
        job.course_id,
      );
      if (!member?.active) {
        await finish("cancelled", "Členstvo už nie je aktívne.");
        continue;
      }
      if (job.kind === "email") {
        const course = await one(
          db,
          "SELECT data FROM courses WHERE id=?",
          job.course_id,
        );
        if (!course) {
          await finish("cancelled", "Kurz už neexistuje.");
          continue;
        }
        if (
          payload.to &&
          String(payload.to).toLowerCase() !== member.email.toLowerCase()
        ) {
          await finish("failed", "Adresa pozvánky sa nezhoduje s členstvom.");
          continue;
        }
        const invitation = {
          to: member.email,
          nickname: member.nickname,
          courseName: decode(course.data).name || "Cestou Zimy",
          idempotencyKey: `cz-invite-${job.id}`,
          siteUrl: cfg.siteUrl || "",
        };
        const result = cfg.invitationSender
          ? await cfg.invitationSender(invitation)
          : await sendInvitation(
              invitation.to,
              invitation.nickname,
              invitation.courseName,
              invitation.idempotencyKey,
              {
                apiKey: cfg.emailApiKey || "",
                from: cfg.emailFrom || "",
                siteUrl: invitation.siteUrl,
              },
              transport,
            );
        if (result.status === "retry") {
          await retry(result.reason, result.retryAfterSeconds);
          continue;
        }
        await finish(
          result.status === "accepted" ? "accepted" : "failed",
          result.status === "failed"
            ? result.reason
            : result.status === "expired"
              ? "E-mailový poskytovateľ odmietol adresu."
              : null,
        );
        continue;
      }
      if (job.kind !== "push") {
        await finish("failed", "Neznámy kanál odosielania.");
        continue;
      }
      const recipient = await one(
        db,
        "SELECT r.id FROM recipients r JOIN messages m ON m.id=r.message_id WHERE r.message_id=? AND r.member_id=? AND m.course_id=? AND m.status='sent'",
        job.reference_id,
        job.member_id,
        job.course_id,
      );
      if (!recipient) {
        await finish(
          "cancelled",
          "Správa už nie je sprístupnená tomuto členovi.",
        );
        continue;
      }
      const allSubscriptions = await rows(
        db,
        "SELECT id,data FROM subscriptions WHERE member_id=? AND course_id=?",
        job.member_id,
        job.course_id,
      );
      const currentApplicationUrl = normalizeApplicationUrl(cfg.siteUrl);
      const subscriptions = [];
      for (const subscription of allSubscriptions) {
        let applicationUrl: string | null = null;
        try {
          applicationUrl = normalizeApplicationUrl(
            decode(subscription.data).applicationUrl,
          );
        } catch {
          /* malformed legacy subscription is stale */
        }
        if (
          !currentApplicationUrl ||
          applicationUrl !== currentApplicationUrl
        ) {
          await run(
            db,
            "DELETE FROM subscriptions WHERE id=? AND member_id=?",
            subscription.id,
            job.member_id,
          );
          continue;
        }
        subscriptions.push(subscription);
      }
      // Snapshot targets once: a device enrolled tomorrow does not receive yesterday's push.
      if (!Array.isArray(payload._targets)) {
        payload._targets = subscriptions.map((s) => s.id);
        payload._deliveries = {};
        await persist();
      }
      const deliveries: Record<string, Delivery> =
        payload._deliveries && typeof payload._deliveries === "object"
          ? payload._deliveries
          : {};
      payload._deliveries = deliveries;
      if (!payload._targets.length) {
        await finish(
          "skipped",
          "Člen nemá prihlásené zariadenie. Správa je dostupná v aplikácii.",
        );
        continue;
      }
      let retrySeconds = 0;
      for (const targetId of payload._targets as string[]) {
        if (deliveries[targetId] && deliveries[targetId].status !== "retry")
          continue;
        const lease = await one(
          db,
          "UPDATE outbox SET next_attempt=? WHERE id=? AND status='processing' AND attempts=? RETURNING id",
          new Date(timestamp(cfg).getTime() + LEASE_MS).toISOString(),
          job.id,
          job.attempts,
        );
        if (!lease) break;
        const stillActive = await one(
          db,
          "SELECT active FROM members WHERE id=? AND course_id=?",
          job.member_id,
          job.course_id,
        );
        if (!stillActive?.active) {
          await finish(
            "cancelled",
            "Členstvo bolo odobraté počas odosielania.",
          );
          break;
        }
        const subscription = await one(
          db,
          "SELECT id,data FROM subscriptions WHERE id=? AND member_id=? AND course_id=?",
          targetId,
          job.member_id,
          job.course_id,
        );
        if (!subscription) {
          deliveries[targetId] = {
            status: "cancelled",
            at: timestamp(cfg).toISOString(),
          };
          await persist();
          continue;
        }
        if (
          normalizeApplicationUrl(decode(subscription.data).applicationUrl) !==
          currentApplicationUrl
        ) {
          await run(
            db,
            "DELETE FROM subscriptions WHERE id=? AND member_id=?",
            targetId,
            job.member_id,
          );
          deliveries[targetId] = {
            status: "cancelled",
            at: timestamp(cfg).toISOString(),
            reason: "Adresa aplikácie sa zmenila; odber treba znova povoliť.",
          };
          await persist();
          continue;
        }
        let result: SendResult;
        try {
          result = await sendPush(
            decode(subscription.data),
            {
              messageId: job.reference_id,
              title: "Cestou Zimy",
              body: "Organizátor ti poslal novú správu. Otvor ju v aplikácii.",
            },
            {
              publicKey: cfg.vapidPublicKey || "",
              privateKey: cfg.vapidPrivateKey || "",
              subject: cfg.vapidSubject || "",
              applicationUrl: cfg.siteUrl,
            },
            transport,
          );
        } catch {
          result = {
            status: "retry",
            httpStatus: null,
            retryAfterSeconds: 60,
            reason: "Odosielanie bolo dočasne prerušené.",
          };
        }
        deliveries[targetId] = {
          status: result.status,
          at: timestamp(cfg).toISOString(),
          httpStatus: result.httpStatus,
          ...("reason" in result ? { reason: result.reason } : {}),
        };
        // Save every accepted device immediately so another device's retry cannot resend it.
        await persist();
        if (result.status === "expired")
          await run(
            db,
            "DELETE FROM subscriptions WHERE id=? AND member_id=?",
            targetId,
            job.member_id,
          );
        if (result.status === "retry")
          retrySeconds = Math.max(retrySeconds, result.retryAfterSeconds);
      }
      const held = await one(
        db,
        "SELECT id FROM outbox WHERE id=? AND status='processing' AND attempts=?",
        job.id,
        job.attempts,
      );
      if (!held) continue;
      const outcomes = Object.values(deliveries);
      if (outcomes.some((d) => d.status === "retry"))
        await retry(
          "Niektoré zariadenia čakajú na opakovanie odoslania.",
          retrySeconds,
        );
      else if (outcomes.some((d) => d.status === "failed"))
        await finish(
          "failed",
          "Poskytovateľ odmietol niektoré zariadenia. Úspešne prijaté zariadenia sa znovu neodosielajú.",
        );
      else if (outcomes.some((d) => d.status === "accepted"))
        await finish("accepted");
      else
        await finish(
          "skipped",
          "Žiadne z prihlásených zariadení už nemá platný odber. Správa ostáva v aplikácii.",
        );
    } catch (error) {
      await retry(
        error instanceof Error
          ? error.message.slice(0, 200)
          : "Dočasná chyba spracovania odosielania.",
      );
    }
  }
  return summary;
}
