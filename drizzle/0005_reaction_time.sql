-- When support was given; older rows stay NULL ("earlier").
ALTER TABLE reactions ADD COLUMN created_at TEXT;
