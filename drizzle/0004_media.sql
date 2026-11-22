CREATE TABLE media (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('activity','avatar','award')),
  resource_id TEXT,
  storage_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX media_course_resource ON media(course_id,kind,resource_id);
CREATE INDEX media_owner_staging ON media(course_id,member_id,created_at);
CREATE UNIQUE INDEX media_one_avatar ON media(course_id,resource_id) WHERE kind='avatar' AND resource_id IS NOT NULL;
