import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const media = sqliteTable(
  "media",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    memberId: text("member_id").notNull(),
    kind: text("kind", { enum: ["activity", "avatar", "award"] }).notNull(),
    resourceId: text("resource_id"),
    storageName: text("storage_name").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("media_course_resource").on(
      table.courseId,
      table.kind,
      table.resourceId,
    ),
    index("media_owner_staging").on(
      table.courseId,
      table.memberId,
      table.createdAt,
    ),
    uniqueIndex("media_one_avatar")
      .on(table.courseId, table.resourceId)
      .where(sql`${table.kind}='avatar' AND ${table.resourceId} IS NOT NULL`),
  ],
);
