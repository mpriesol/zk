import { randomUUID } from "node:crypto";
import type { SQLiteDatabase } from "./sqlite.ts";
import { appPath, basePathFromUrl } from "../lib/paths.ts";

/** Runs inside the registration transaction. Outbox failure never requires a
 * second registration; a durable message is available even without push. */
export function notifyPendingMembership(
  db: SQLiteDatabase,
  input: {
    courseId: string;
    requestId: string;
    nickname: string;
    appUrl: string;
    now: string;
  },
) {
  const { courseId, requestId, nickname, appUrl, now } = input;
  const messageId = `membership-${requestId}`;
  if (
    db.native
      .prepare("SELECT id FROM messages WHERE id=? AND course_id=?")
      .get(messageId, courseId)
  )
    return;
  const recipients = db.native
    .prepare(
      "SELECT id FROM members WHERE course_id=? AND active=1 AND role='admin'",
    )
    .all(courseId);
  const link = appPath(
    `/?view=admin&section=members&request=${encodeURIComponent(requestId)}`,
    basePathFromUrl(appUrl),
  );
  const message = {
    id: messageId,
    title: "Nová žiadosť o prístup",
    body: `${nickname} čaká na schválenie vstupu do kurzu.`,
    link,
    important: false,
    pinned: false,
    status: "sent",
    audience: "selected",
    createdAt: now,
    sentAt: now,
    kind: "membership_request",
    requestId,
  };
  db.native
    .prepare(
      "INSERT INTO messages(id,course_id,data,status,created_at,sent_at) VALUES(?,?,?,'sent',?,?)",
    )
    .run(messageId, courseId, JSON.stringify(message), now, now);
  for (const recipient of recipients) {
    db.native
      .prepare(
        "INSERT INTO recipients(id,message_id,member_id,read_at) VALUES(?,?,?,NULL)",
      )
      .run(randomUUID(), messageId, recipient.id);
    db.native
      .prepare(
        "INSERT OR IGNORE INTO outbox(id,course_id,member_id,kind,reference_id,payload,status,attempts,next_attempt,created_at) VALUES(?,?,?,'push',?,?,'pending',0,?,?)",
      )
      .run(
        randomUUID(),
        courseId,
        recipient.id,
        messageId,
        JSON.stringify({ notificationKind: "membership_request" }),
        now,
        now,
      );
  }
}
export function resolveMembershipNotification(
  db: SQLiteDatabase,
  courseId: string,
  requestId: string,
  status: "approved" | "rejected",
  now: string,
) {
  const id = `membership-${requestId}`;
  const row = db.native
    .prepare("SELECT data FROM messages WHERE id=? AND course_id=?")
    .get(id, courseId);
  if (!row) return;
  const data = JSON.parse(String(row.data));
  data.title =
    status === "approved"
      ? "Žiadosť bola schválená"
      : "Žiadosť bola zamietnutá";
  data.body =
    "Táto žiadosť je vybavená. Jej aktuálny stav nájdeš v administrácii.";
  db.native
    .prepare("UPDATE messages SET data=? WHERE id=? AND course_id=?")
    .run(JSON.stringify(data), id, courseId);
  db.native
    .prepare(
      "UPDATE recipients SET read_at=COALESCE(read_at,?) WHERE message_id=?",
    )
    .run(now, id);
  db.native
    .prepare(
      "UPDATE outbox SET status='cancelled',last_error='Žiadosť je už vybavená.' WHERE course_id=? AND reference_id=? AND kind='push' AND status IN ('pending','processing')",
    )
    .run(courseId, id);
}
