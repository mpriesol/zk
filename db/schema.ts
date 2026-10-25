import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
export const courses = sqliteTable("courses", {
  id: text("id").primaryKey(),
  data: text("data").notNull(),
});
export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    userId: text("user_id"),
    email: text("email").notNull(),
    nickname: text("nickname").notNull(),
    role: text("role").notNull(),
    active: integer("active").notNull().default(1),
    animations: integer("animations").notNull().default(1),
    joinedAt: text("joined_at").notNull(),
  },
  (t) => [
    uniqueIndex("member_email").on(t.courseId, t.email),
    uniqueIndex("member_identity").on(t.courseId, t.userId),
  ],
);
export const activityTypes = sqliteTable("activity_types", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull(),
  name: text("name").notNull(),
  group: text("group_name").notNull(),
  hidden: integer("hidden").notNull().default(0),
  active: integer("active").notNull().default(1),
  challengeId: text("challenge_id"),
});
export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    memberId: text("member_id").notNull(),
    typeId: text("type_id").notNull(),
    date: text("date").notNull(),
    minutes: real("minutes"),
    distance: real("distance"),
    note: text("note").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (t) => [
    uniqueIndex("activity_idempotency").on(
      t.courseId,
      t.memberId,
      t.idempotencyKey,
    ),
  ],
);
export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  activityId: text("activity_id").notNull(),
  memberId: text("member_id").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
});
export const reactions = sqliteTable(
  "reactions",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id").notNull(),
    memberId: text("member_id").notNull(),
  },
  (t) => [uniqueIndex("reaction_unique").on(t.activityId, t.memberId)],
);
export const rules = sqliteTable(
  "rules",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    data: text("data").notNull(),
  },
  (t) => [uniqueIndex("rule_version").on(t.courseId, t.key, t.version)],
);
export const awards = sqliteTable(
  "awards",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    memberId: text("member_id").notNull(),
    ruleKey: text("rule_key").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    ruleVersion: integer("rule_version").notNull(),
    earnedAt: text("earned_at").notNull(),
    snapshot: text("snapshot").notNull(),
  },
  (t) => [
    uniqueIndex("award_unique").on(
      t.courseId,
      t.memberId,
      t.ruleKey,
      t.periodStart,
    ),
  ],
);
export const challenges = sqliteTable("challenges", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull(),
  data: text("data").notNull(),
  status: text("status").notNull(),
  hidden: integer("hidden").notNull().default(0),
});
export const completions = sqliteTable(
  "completions",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    memberId: text("member_id").notNull(),
    challengeId: text("challenge_id").notNull(),
    date: text("date").notNull(),
    note: text("note").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("completion_unique").on(t.courseId, t.memberId, t.challengeId),
  ],
);
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull(),
  data: text("data").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  sentAt: text("sent_at"),
});
export const recipients = sqliteTable(
  "recipients",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull(),
    memberId: text("member_id").notNull(),
    readAt: text("read_at"),
  },
  (t) => [uniqueIndex("recipient_unique").on(t.messageId, t.memberId)],
);
export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull(),
  memberId: text("member_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  data: text("data").notNull(),
  createdAt: text("created_at").notNull(),
});
export const outbox = sqliteTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    memberId: text("member_id").notNull(),
    kind: text("kind").notNull(),
    referenceId: text("reference_id").notNull(),
    payload: text("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttempt: text("next_attempt").notNull(),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("outbox_unique").on(t.kind, t.referenceId, t.memberId)],
);
export const audit = sqliteTable("audit", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull(),
  memberId: text("member_id").notNull(),
  action: text("action").notNull(),
  details: text("details").notNull(),
  createdAt: text("created_at").notNull(),
});
export const recalculationPreviews = sqliteTable("recalculation_previews", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull(),
  memberId: text("member_id").notNull(),
  ruleKey: text("rule_key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const membershipRequests = sqliteTable(
  "membership_requests",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    userId: text("user_id").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    reviewedAt: text("reviewed_at"),
    reviewedBy: text("reviewed_by"),
  },
  (t) => [uniqueIndex("membership_request_user").on(t.courseId, t.userId)],
);
export const registrationInvites = sqliteTable("registration_invites", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label").notNull(),
  expiresAt: text("expires_at").notNull(),
  maxUses: integer("max_uses").notNull(),
  uses: integer("uses").notNull().default(0),
  revoked: integer("revoked").notNull().default(0),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
});
export const passwordResets = sqliteTable("password_resets", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
});
export const authRateLimits = sqliteTable("auth_rate_limits", {
  id: text("id").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
});

// Only the trusted operator CLI writes this provenance. Public registrations
// always use an internal email and can never acquire this exception.
export const operatorPasswordAccounts = sqliteTable(
  "operator_password_accounts",
  {
    userId: text("user_id").primaryKey(),
    accountId: text("account_id").notNull().unique(),
    email: text("email").notNull(),
    createdAt: text("created_at").notNull(),
  },
);
