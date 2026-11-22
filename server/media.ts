import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import { one, rows, type Database, type Statement } from "../lib/database.ts";
import type { Identity, MediaAsset, Member } from "../lib/types.ts";
import { appPath, basePathFromUrl, type AppBasePath } from "../lib/paths.ts";
import { addDays, todayInZone } from "../lib/dates.ts";

export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_MAX_PHOTOS = 5;
export const MEDIA_BODY_LIMIT = MEDIA_MAX_BYTES + 64 * 1024;
const PIXEL_LIMIT = 40_000_000;
type MediaKind = "activity" | "avatar" | "award";
interface MediaRow {
  id: string;
  course_id: string;
  member_id: string;
  kind: MediaKind;
  resource_id: string | null;
  storage_name: string;
  mime_type: string;
  bytes: number;
  width: number;
  height: number;
  created_at: string;
}
export interface MediaConfig {
  courseId?: string;
  siteUrl?: string;
  mediaDirectory?: string;
  trustedOrigins?: string[];
  now?: () => Date;
}
export class MediaError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "MediaError";
    this.status = status;
  }
}
function fail(status: number, message: string): never {
  throw new MediaError(status, message);
}
export function mediaDirectoryFromEnv(env = process.env): string {
  return resolve(
    env.MEDIA_DIRECTORY ||
      resolve(
        dirname(env.DATABASE_PATH || ".data/cestou-zimy.sqlite"),
        "media",
      ),
  );
}
export function mediaUrl(id: string, basePath?: AppBasePath): string {
  return appPath(`/api/media/${encodeURIComponent(id)}`, basePath);
}
const asset = (row: MediaRow, basePath?: AppBasePath): MediaAsset => ({
  id: row.id,
  url: mediaUrl(row.id, basePath),
  width: row.width,
  height: row.height,
  mimeType: row.mime_type,
  bytes: row.bytes,
});
export async function memberAvatarUrl(
  db: Database,
  courseId: string,
  memberId: string,
  basePath?: AppBasePath,
) {
  const row = await one<MediaRow>(
    db,
    "SELECT * FROM media WHERE course_id=? AND kind='avatar' AND resource_id=?",
    courseId,
    memberId,
  );
  return row ? mediaUrl(row.id, basePath) : null;
}
export async function listActivityMedia(
  db: Database,
  courseId: string,
  activityId: string,
  basePath?: AppBasePath,
): Promise<MediaAsset[]> {
  return (
    await rows<MediaRow>(
      db,
      "SELECT * FROM media WHERE course_id=? AND kind='activity' AND resource_id=? ORDER BY created_at,id",
      courseId,
      activityId,
    )
  ).map((row) => asset(row, basePath));
}
/** Validate before the caller's activity transaction. These statements are included
 * in the same batch as the activity write, so invalid photos cannot save a partial edit. */
export async function prepareActivityMedia(
  db: Database,
  courseId: string,
  actor: Member,
  activityId: string,
  input: unknown,
): Promise<Statement[]> {
  if (
    !Array.isArray(input) ||
    input.length > MEDIA_MAX_PHOTOS ||
    input.some((id) => typeof id !== "string") ||
    new Set(input).size !== input.length
  )
    fail(
      400,
      `K aktivite môžeš pridať najviac ${MEDIA_MAX_PHOTOS} rôznych fotografií.`,
    );
  const ids = input as string[];
  for (const id of ids) {
    const row = await one<MediaRow>(
      db,
      "SELECT * FROM media WHERE id=? AND course_id=?",
      id,
      courseId,
    );
    if (
      !row ||
      row.kind !== "activity" ||
      row.member_id !== actor.id ||
      (row.resource_id !== null && row.resource_id !== activityId)
    )
      fail(403, "Fotografia nepatrí k tvojmu zápisu. Vyber ju znova.");
  }
  return [
    db
      .prepare(
        "UPDATE media SET resource_id=NULL WHERE course_id=? AND kind='activity' AND resource_id=?",
      )
      .bind(courseId, activityId),
    ...ids.map((id) =>
      db
        .prepare(
          "UPDATE media SET resource_id=? WHERE id=? AND course_id=? AND member_id=? AND kind='activity'",
        )
        .bind(activityId, id, courseId, actor.id),
    ),
  ];
}
export async function prepareAwardMedia(
  db: Database,
  courseId: string,
  actor: Member,
  ruleKey: string,
  id: string | null,
): Promise<Statement[]> {
  if (actor.role !== "admin")
    fail(403, "Obrázok odmeny môže zmeniť organizátor.");
  if (!id) return [];
  const row = await one<MediaRow>(
    db,
    "SELECT * FROM media WHERE id=? AND course_id=?",
    id,
    courseId,
  );
  if (
    !row ||
    row.kind !== "award" ||
    (row.resource_id !== null && row.resource_id !== ruleKey)
  )
    fail(400, "Obrázok odmeny sa nenašiel alebo patrí inej odmene.");
  return [
    db
      .prepare(
        "UPDATE media SET resource_id=? WHERE id=? AND course_id=? AND kind='award'",
      )
      .bind(ruleKey, id, courseId),
  ];
}
export async function associateAwardMedia(
  db: Database,
  courseId: string,
  actor: Member,
  ruleKey: string,
  id: string | null,
) {
  const statements = await prepareAwardMedia(db, courseId, actor, ruleKey, id);
  if (statements.length) await db.batch(statements);
}
export function sniffImage(buffer: Buffer): "jpeg" | "png" | "webp" | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  )
    return "jpeg";
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  return null;
}
/** Decode and re-encode all images: filenames/MIME headers are not trusted and
 * no source metadata, GPS, animation, or original payload is retained. */
export async function normalizeImage(
  buffer: Buffer,
  kind: MediaKind,
  focusX = 0.5,
  focusY = 0.5,
) {
  if (!buffer.length || buffer.length > MEDIA_MAX_BYTES)
    fail(413, "Fotografia môže mať najviac 10 MB.");
  if (!sniffImage(buffer)) {
    if (buffer.toString("ascii", 4, 12).includes("ftyp"))
      fail(
        415,
        "Fotografie HEIC/HEIF zatiaľ nepodporujeme. Vyber alebo exportuj fotografiu ako JPEG, PNG alebo WebP.",
      );
    fail(415, "Vyber skutočnú fotografiu vo formáte JPEG, PNG alebo WebP.");
  }
  try {
    const decoder = sharp(buffer, {
      limitInputPixels: PIXEL_LIMIT,
      failOn: "error",
    });
    const metadata = await decoder.metadata();
    if ((metadata.pages || 1) > 1)
      fail(
        415,
        "Animované obrázky nie sú podporované. Vyber jednu fotografiu.",
      );
    const resized = await decoder
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 84 })
      .toBuffer({ resolveWithObject: true });
    if (kind !== "avatar") return resized;
    const side = Math.min(resized.info.width, resized.info.height);
    return await sharp(resized.data)
      .extract({
        left: Math.round(
          (resized.info.width - side) * Math.min(1, Math.max(0, focusX)),
        ),
        top: Math.round(
          (resized.info.height - side) * Math.min(1, Math.max(0, focusY)),
        ),
        width: side,
        height: side,
      })
      .resize({ width: 512, height: 512, withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    if (error instanceof MediaError) throw error;
    fail(
      415,
      "Fotografiu sa nepodarilo otvoriť. Skús menší alebo iný obrázok JPEG, PNG alebo WebP (najviac 40 megapixelov).",
    );
  }
}
async function boundedForm(request: Request): Promise<FormData> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MEDIA_BODY_LIMIT)
    fail(413, "Fotografia môže mať najviac 10 MB.");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "Vyber fotografiu.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const value = await reader!.read();
    if (value.done) break;
    size += value.value.byteLength;
    if (size > MEDIA_BODY_LIMIT) {
      await reader!.cancel();
      fail(413, "Fotografia môže mať najviac 10 MB.");
    }
    chunks.push(value.value);
  }
  try {
    return await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
  } catch {
    fail(400, "Fotografiu sa nepodarilo prijať. Vyber ju znova.");
  }
}
async function activeMember(
  db: Database,
  identity: Identity | null,
  courseId: string,
): Promise<Member> {
  if (!identity) fail(401, "Najprv sa prihlás.");
  const member = await one<any>(
    db,
    "SELECT * FROM members WHERE course_id=? AND active=1 AND (user_id=? OR (user_id IS NULL AND email=? AND ?=1))",
    courseId,
    identity!.userId,
    identity!.email.toLowerCase(),
    identity!.emailVerified ? 1 : 0,
  );
  if (!member) fail(403, "Prístup k fotografiám majú aktívni členovia kurzu.");
  return {
    id: member.id,
    courseId: member.course_id,
    userId: member.user_id,
    nickname: member.nickname,
    role: member.role,
    active: true,
    animations: !!member.animations,
    joinedAt: member.joined_at,
  };
}
async function canRead(
  db: Database,
  row: MediaRow,
  actor: Member,
  now = new Date(),
) {
  if (row.resource_id === null)
    return row.member_id === actor.id || actor.role === "admin";
  if (actor.role === "admin") return true;
  if (row.kind === "avatar")
    return !!(await one(
      db,
      "SELECT id FROM members WHERE id=? AND course_id=?",
      row.resource_id,
      actor.courseId,
    ));
  if (row.kind === "activity")
    return !!(await one(
      db,
      "SELECT a.id FROM activities a JOIN activity_types t ON t.id=a.type_id AND t.course_id=a.course_id WHERE a.id=? AND a.course_id=? AND t.hidden=0",
      row.resource_id,
      actor.courseId,
    ));
  const courseRow = await one<{ data: string }>(
    db,
    "SELECT data FROM courses WHERE id=?",
    actor.courseId,
  );
  if (!courseRow) return false;
  const course = JSON.parse(courseRow.data),
    today = todayInZone(course.timezone || "Europe/Bratislava", now);
  const usesImage = (data: any) =>
    data?.imageMediaId === row.id ||
    (data?.visual?.kind === "image" && data.visual.value === row.id);
  const historic = await one(
    db,
    "SELECT id FROM awards WHERE course_id=? AND (json_extract(snapshot,'$.imageMediaId')=? OR (json_extract(snapshot,'$.visual.kind')='image' AND json_extract(snapshot,'$.visual.value')=?)) LIMIT 1",
    actor.courseId,
    row.id,
    row.id,
  );
  if (historic) return true;
  const rules = await rows<{ data: string }>(
    db,
    "SELECT data FROM rules WHERE course_id=? AND key=? AND effective_from<=?",
    actor.courseId,
    row.resource_id,
    today,
  );
  if (
    rules.some((entry) => {
      const rule = JSON.parse(entry.data);
      return rule.active && usesImage(rule);
    })
  )
    return true;
  const definition = await one<{ data: string }>(
    db,
    "SELECT data FROM personal_award_definitions WHERE id=? AND course_id=? AND status='published'",
    row.resource_id,
    actor.courseId,
  );
  if (definition && usesImage(JSON.parse(definition.data))) return true;
  const historicPersonal = await one(
    db,
    "SELECT id FROM personal_award_grants WHERE course_id=? AND json_extract(snapshot,'$.visual.kind')='image' AND json_extract(snapshot,'$.visual.value')=? LIMIT 1",
    actor.courseId,
    row.id,
  );
  if (historicPersonal) return true;
  const challengeRow = await one<{ data: string }>(
    db,
    "SELECT data FROM challenges WHERE id=? AND course_id=? AND hidden=0 AND status!='draft'",
    row.resource_id,
    actor.courseId,
  );
  if (!challengeRow) return false;
  const challenge = JSON.parse(challengeRow.data);
  if (!usesImage(challenge)) return false;
  if (challenge.kind === "cold" || challenge.id === actor.courseId + "-cold") {
    const unlock = addDays(
      course.startDate,
      Math.max(8, Number(course.coldUnlockDay) || 8) - 1,
    );
    if (today < unlock || today < challenge.startDate) return false;
  }
  return true;
}
const privateHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
};
/** Called after Better Auth session verification. Media never enters static files. */
export async function mediaEndpoint(
  request: Request,
  path: string,
  identity: Identity | null,
  db: Database,
  config: MediaConfig,
): Promise<Response | null> {
  if (path !== "/api/media" && !path.startsWith("/api/media/")) return null;
  try {
    const cid = config.courseId || "cestou-zimy",
      actor = await activeMember(db, identity, cid);
    const directory = resolve(config.mediaDirectory || mediaDirectoryFromEnv());
    const basePath = config.siteUrl
      ? basePathFromUrl(config.siteUrl)
      : undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const origins = [
        new URL(config.siteUrl || request.url).origin,
        ...(config.trustedOrigins || []),
      ];
      if (
        !origins.includes(request.headers.get("origin") || "") ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        fail(403, "Táto požiadavka nepochádza z aplikácie.");
    }
    if (path === "/api/media" && request.method === "POST") {
      if (
        !request.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("multipart/form-data;")
      )
        fail(415, "Fotografiu odošli cez nahrávací formulár.");
      const form = await boundedForm(request),
        kind = form.get("kind"),
        file = form.get("file");
      if (
        !["activity", "avatar", "award"].includes(String(kind)) ||
        !(file instanceof File) ||
        form.getAll("file").length !== 1
      )
        fail(400, "Vyber jednu fotografiu a jej účel.");
      if (kind === "award" && actor.role !== "admin")
        fail(403, "Obrázky odmien môže pridávať organizátor.");
      if ((file as File).size > MEDIA_MAX_BYTES)
        fail(413, "Fotografia môže mať najviac 10 MB.");
      await cleanupUnreferencedMedia(db, directory);
      const pending = await one<{ count: number }>(
        db,
        "SELECT count(*) count FROM media WHERE course_id=? AND member_id=? AND resource_id IS NULL",
        cid,
        actor.id,
      );
      if ((pending?.count || 0) >= 30)
        fail(
          429,
          "Máš viac rozpracovaných fotografií. Ulož alebo odstráň predchádzajúci výber a skús to znova.",
        );
      const focus = (name: string) => {
        const value = Number(form.get(name) ?? 0.5);
        return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
      };
      const normalized = await normalizeImage(
        Buffer.from(await (file as File).arrayBuffer()),
        kind as MediaKind,
        focus("focusX"),
        focus("focusY"),
      );
      const id = randomUUID(),
        storageName = `${id}.webp`,
        output = resolve(directory, storageName),
        temporary = `${output}.tmp`;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(temporary, normalized.data, { flag: "wx", mode: 0o600 });
      await rename(temporary, output);
      const now = new Date().toISOString();
      const row: MediaRow = {
        id,
        course_id: cid,
        member_id: actor.id,
        kind: kind as MediaKind,
        resource_id: kind === "avatar" ? actor.id : null,
        storage_name: storageName,
        mime_type: "image/webp",
        bytes: normalized.data.length,
        width: normalized.info.width,
        height: normalized.info.height,
        created_at: now,
      };
      const oldAvatars =
        kind === "avatar"
          ? await rows<MediaRow>(
              db,
              "SELECT * FROM media WHERE course_id=? AND kind='avatar' AND resource_id=?",
              cid,
              actor.id,
            )
          : [];
      try {
        await db.batch([
          ...(kind === "avatar"
            ? [
                db
                  .prepare(
                    "DELETE FROM media WHERE course_id=? AND kind='avatar' AND resource_id=?",
                  )
                  .bind(cid, actor.id),
              ]
            : []),
          db
            .prepare(
              "INSERT INTO media(id,course_id,member_id,kind,resource_id,storage_name,mime_type,bytes,width,height,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(
              id,
              cid,
              actor.id,
              kind,
              row.resource_id,
              storageName,
              row.mime_type,
              row.bytes,
              row.width,
              row.height,
              now,
            ),
        ]);
      } catch (error) {
        await rm(output, { force: true });
        throw error;
      }
      for (const old of oldAvatars)
        await removeStoredFile(directory, old.storage_name);
      return Response.json(
        { media: asset(row, basePath) },
        { status: 201, headers: privateHeaders },
      );
    }
    const id = path.slice("/api/media/".length);
    if (!/^[a-f0-9-]{36}$/.test(id)) fail(404, "Fotografia sa nenašla.");
    const row = await one<MediaRow>(
      db,
      "SELECT * FROM media WHERE id=? AND course_id=?",
      id,
      cid,
    );
    if (!row || !(await canRead(db, row, actor, config.now?.())))
      fail(404, "Fotografia sa nenašla.");
    if (request.method === "DELETE") {
      if (row.member_id !== actor.id && actor.role !== "admin")
        fail(403, "Odstrániť môžeš iba vlastnú fotografiu.");
      const onlyUnattached =
        new URL(request.url).searchParams.get("onlyUnattached") === "1";
      if (onlyUnattached && row.resource_id !== null)
        return Response.json(
          { ok: true, removed: false },
          { headers: privateHeaders },
        );
      if (row.kind === "activity" && row.resource_id !== null)
        fail(409, "Priradenú fotografiu odober cez úpravu aktivity.");
      if (row.kind === "award" && row.resource_id !== null)
        fail(
          409,
          "Obrázok patrí odmene a jej histórii. Zmeň ho cez nastavenie odmeny.",
        );
      await db.batch([
        db
          .prepare(
            "DELETE FROM media WHERE id=? AND course_id=? AND (?=0 OR resource_id IS NULL)",
          )
          .bind(id, cid, onlyUnattached ? 1 : 0),
        db
          .prepare(
            "INSERT INTO audit(id,course_id,member_id,action,details,created_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM media WHERE id=? AND course_id=?)",
          )
          .bind(
            randomUUID(),
            cid,
            actor.id,
            "media.delete",
            JSON.stringify({ id, owner: row.member_id, kind: row.kind }),
            new Date().toISOString(),
            id,
            cid,
          ),
      ]);
      const remaining = await one(
        db,
        "SELECT id FROM media WHERE id=? AND course_id=?",
        id,
        cid,
      );
      if (!remaining) await removeStoredFile(directory, row.storage_name);
      return Response.json(
        { ok: true, removed: !remaining },
        { headers: privateHeaders },
      );
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      fail(405, "Nepodporovaná operácia.");
    if (!/^[a-f0-9-]{36}\.webp$/.test(row.storage_name))
      fail(404, "Fotografia sa nenašla.");
    let content: Buffer;
    try {
      content = await readFile(resolve(directory, row.storage_name));
    } catch {
      fail(404, "Fotografia sa nenašla.");
    }
    return new Response(
      request.method === "HEAD" ? null : new Uint8Array(content!),
      {
        headers: {
          ...privateHeaders,
          "Content-Type": row.mime_type,
          "Content-Length": String(content!.byteLength),
          "Content-Disposition": "inline",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof MediaError
            ? error.message
            : "Fotografiu sa nepodarilo spracovať. Skús to znova.",
      },
      {
        status: error instanceof MediaError ? error.status : 500,
        headers: privateHeaders,
      },
    );
  }
}
async function removeStoredFile(directory: string, name: string) {
  if (/^[a-f0-9-]{36}\.webp$/.test(name))
    await rm(resolve(directory, name), { force: true });
}
/** Run while holding the shared DB operation lock, after successful commits.
 * File deletion never precedes the removal of its DB reference. */
export async function cleanupUnreferencedMedia(
  db: Database,
  directory: string,
  now = new Date(),
) {
  const staleBefore = new Date(
    now.getTime() - 24 * 60 * 60 * 1000,
  ).toISOString();
  await db.batch([
    db
      .prepare("DELETE FROM media WHERE resource_id IS NULL AND created_at<?")
      .bind(staleBefore),
    db.prepare(
      "DELETE FROM media WHERE kind='activity' AND resource_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM activities WHERE activities.id=media.resource_id AND activities.course_id=media.course_id)",
    ),
  ]);
  const keep = new Set(
    (
      await rows<{ storage_name: string }>(db, "SELECT storage_name FROM media")
    ).map((r) => r.storage_name),
  );
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const name of names) {
    if (/^[a-f0-9-]{36}\.webp$/.test(name) && !keep.has(name))
      await removeStoredFile(directory, name);
    else if (
      /^[a-f0-9-]{36}\.webp\.tmp$/.test(name) &&
      (await stat(resolve(directory, name))).mtimeMs < now.getTime() - 3_600_000
    )
      await rm(resolve(directory, name), { force: true });
  }
}
