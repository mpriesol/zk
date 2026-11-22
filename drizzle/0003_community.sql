ALTER TABLE recipients ADD COLUMN archived_at TEXT;
ALTER TABLE recipients ADD COLUMN acknowledged_at TEXT;

CREATE TABLE cold_entries (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('shower','outdoor')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  legacy_source TEXT
);
CREATE UNIQUE INDEX cold_member_day ON cold_entries(course_id,member_id,date);
CREATE INDEX cold_course_date ON cold_entries(course_id,date);

CREATE TABLE personal_award_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL,
  data TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','published'))
);
CREATE TABLE personal_award_grants (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  date TEXT NOT NULL,
  reason TEXT NOT NULL,
  granted_by TEXT,
  source TEXT NOT NULL CHECK(source IN ('self','organizer')),
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX personal_award_once ON personal_award_grants(course_id,definition_id,member_id);
CREATE TABLE mottos (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL,
  data TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE motto_daily (
  course_id TEXT NOT NULL,
  date TEXT NOT NULL,
  motto_id TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  PRIMARY KEY(course_id,date)
);
CREATE TABLE community_seed_versions (
  course_id TEXT NOT NULL,
  version TEXT NOT NULL,
  PRIMARY KEY(course_id,version)
);
CREATE TABLE preparation_previews (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  data TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
-- An atomic transaction guard: a stale preview cannot apply any destructive statement.
CREATE TABLE preparation_guards (
  id TEXT PRIMARY KEY NOT NULL,
  valid INTEGER NOT NULL CHECK(valid=1)
);

-- Metadata only: no preparation dates, identities, activities or results are reset.
UPDATE courses SET data=json_set(data,
  '$.name','Cestou Zimy 2027', '$.year',2027,
  '$.eventStartDate','2027-02-03', '$.eventEndDate','2027-02-07')
WHERE json_extract(data,'$.name') IN
 ('Cestou Zimy · testovací ročník','TESTOVACÍ ROČNÍK','testovací ročník');

UPDATE challenges SET data=json_set(data,
  '$.name','Studená sprcha alebo otužovanie', '$.kind','cold',
  '$.visual',json('{"kind":"icon","value":"snowflake","color":"#5eb7db"}'))
WHERE id=course_id||'-cold';
UPDATE activity_types SET name='Studená sprcha alebo otužovanie'
WHERE id=course_id||'-cold' AND group_name='task';

-- Preserve earlier cold task history; one person-day regardless of source/duplicates.
INSERT OR IGNORE INTO cold_entries
 (id,course_id,member_id,date,kind,note,created_at,updated_at,legacy_source)
SELECT 'legacy-completion-'||id,course_id,member_id,date,'shower',note,created_at,created_at,'completion:'||id
FROM completions WHERE challenge_id=course_id||'-cold' ORDER BY created_at,id;
INSERT OR IGNORE INTO cold_entries
 (id,course_id,member_id,date,kind,note,created_at,updated_at,legacy_source)
SELECT 'legacy-activity-'||a.id,a.course_id,a.member_id,a.date,'shower',a.note,a.created_at,a.updated_at,'activity:'||a.id
FROM activities a JOIN activity_types t ON t.id=a.type_id AND t.course_id=a.course_id
WHERE t.group_name='task' AND (t.id=t.course_id||'-cold' OR t.challenge_id=t.course_id||'-cold')
ORDER BY a.created_at,a.id;
