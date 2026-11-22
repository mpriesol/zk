import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { TestDatabase } from "./helpers.ts";
import {
  mediaEndpoint,
  prepareActivityMedia,
  prepareAwardMedia,
  listActivityMedia,
  memberAvatarUrl,
  normalizeImage,
  MEDIA_MAX_BYTES,
  cleanupUnreferencedMedia,
} from "../server/media.ts";
import type { Identity, Member } from "../lib/types.ts";

const appUrl = "https://hub.biketrek.sk/zk";
const identity = (name: string): Identity => ({
  userId: `u-${name}`,
  email: `${name}@example.test`,
  emailVerified: true,
  displayName: name,
});
const actor = (
  name: string,
  role: "admin" | "participant" = "participant",
): Member => ({
  id: name,
  courseId: "course",
  userId: `u-${name}`,
  nickname: name,
  role,
  active: true,
  animations: true,
  joinedAt: "2026-11-01T00:00:00Z",
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "zk-media-")),
    db = new TestDatabase();
  db.sqlite.prepare("INSERT INTO courses(id,data) VALUES(?,?)").run(
    "course",
    JSON.stringify({
      id: "course",
      startDate: "2026-11-01",
      endDate: "2027-02-07",
      timezone: "Europe/Bratislava",
      coldUnlockDay: 8,
    }),
  );
  for (const [name, role, active, cid] of [
    ["alice", "participant", 1, "course"],
    ["bob", "participant", 1, "course"],
    ["admin", "admin", 1, "course"],
    ["pending", "participant", 0, "course"],
    ["outsider", "participant", 1, "elsewhere"],
  ]) {
    db.sqlite
      .prepare(
        "INSERT INTO members(id,course_id,user_id,email,nickname,role,active,animations,joined_at) VALUES(?,?,?,?,?,?,?,1,?)",
      )
      .run(
        name,
        cid,
        `u-${name}`,
        `${name}@example.test`,
        name,
        role,
        active,
        "2026-11-01T00:00:00Z",
      );
  }
  db.sqlite.exec(
    "INSERT INTO activity_types(id,course_id,name,group_name,hidden,active) VALUES('walk','course','Prechádzka','foot',0,1)",
  );
  const config = {
    courseId: "course",
    siteUrl: appUrl,
    mediaDirectory: directory,
    now: () => new Date("2026-11-10T12:00:00Z"),
  };
  const call = (
    id: string,
    name: string | null = "alice",
    method = "GET",
    suffix = "",
  ) =>
    mediaEndpoint(
      new Request(`${appUrl}/api/media/${id}${suffix}`, {
        method,
        headers: { origin: "https://hub.biketrek.sk" },
      }),
      `/api/media/${id}`,
      name ? identity(name) : null,
      db,
      config,
    ) as Promise<Response>;
  const upload = async (
    buffer: Buffer,
    kind = "activity",
    name: string | null = "alice",
    contentType = "image/png",
    extra: Record<string, string> = {},
    origin = "https://hub.biketrek.sk",
  ) => {
    const form = new FormData();
    form.set("kind", kind);
    form.set(
      "file",
      new File([new Uint8Array(buffer)], "untrusted-file-name.png", {
        type: contentType,
      }),
    );
    for (const [key, value] of Object.entries(extra)) form.set(key, value);
    return mediaEndpoint(
      new Request(appUrl + "/api/media", {
        method: "POST",
        headers: { origin },
        body: form,
      }),
      "/api/media",
      name ? identity(name) : null,
      db,
      config,
    ) as Promise<Response>;
  };
  const addActivity = (id = "activity-one", owner = "alice") =>
    db.sqlite
      .prepare(
        "INSERT INTO activities(id,course_id,member_id,type_id,date,minutes,distance,note,created_at,updated_at,idempotency_key) VALUES(?,'course',?,'walk','2026-11-03',90,NULL,'',?,?,?)",
      )
      .run(id, owner, "2026-11-03T12:00:00Z", "2026-11-03T12:00:00Z", id);
  return {
    db,
    directory,
    config,
    call,
    upload,
    addActivity,
    close() {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
const png = () =>
  sharp({
    create: { width: 180, height: 90, channels: 3, background: "#459ca0" },
  })
    .png()
    .toBuffer();

test("media routes require active same-course membership, staging stays private, and committed photos are private no-store", async () => {
  const f = fixture();
  try {
    const image = await png();
    assert.equal((await f.upload(image, "activity", null)).status, 401);
    assert.equal((await f.upload(image, "activity", "pending")).status, 403);
    assert.equal((await f.upload(image, "activity", "outsider")).status, 403);
    assert.equal(
      (
        await f.upload(
          image,
          "activity",
          "alice",
          "image/png",
          {},
          "https://evil.example",
        )
      ).status,
      403,
    );
    const response = await f.upload(image);
    assert.equal(response.status, 201, await response.clone().text());
    const { media } = await response.json();
    assert.equal(media.url, `/zk/api/media/${media.id}`);
    assert.equal((await f.call(media.id, "bob")).status, 404);
    assert.equal((await f.call(media.id, null)).status, 401);
    assert.equal((await f.call(media.id, "pending")).status, 403);
    assert.equal((await f.call(media.id, "outsider")).status, 403);
    f.addActivity();
    await f.db.batch(
      await prepareActivityMedia(
        f.db,
        "course",
        actor("alice"),
        "activity-one",
        [media.id],
      ),
    );
    const shown = await f.call(media.id, "bob");
    assert.equal(shown.status, 200);
    assert.match(shown.headers.get("cache-control") || "", /no-store/);
    assert.equal(shown.headers.get("content-type"), "image/webp");
    assert.equal(
      shown.headers.get("cross-origin-resource-policy"),
      "same-origin",
    );
    assert.equal(
      (await listActivityMedia(f.db, "course", "activity-one", "/zk"))[0].id,
      media.id,
    );
    f.db.sqlite.exec("UPDATE activity_types SET hidden=1 WHERE id='walk'");
    assert.equal((await f.call(media.id, "bob")).status, 404);
  } finally {
    f.close();
  }
});
test("image decoding checks file bytes, bounds uploads, rotates orientation and strips source metadata", async () => {
  const jpeg = await sharp({
    create: { width: 3000, height: 1500, channels: 3, background: "#97c9c1" },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const result = await normalizeImage(jpeg, "activity"),
    metadata = await sharp(result.data).metadata();
  assert.equal(result.info.width, 1024);
  assert.equal(result.info.height, 2048);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.format, "webp");
  await assert.rejects(
    normalizeImage(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      "avatar",
    ),
    { status: 415 },
  );
  await assert.rejects(
    normalizeImage(Buffer.from([255, 216, 255, 0, 1]), "activity"),
    { status: 415 },
  );
  await assert.rejects(
    normalizeImage(Buffer.alloc(MEDIA_MAX_BYTES + 1), "activity"),
    { status: 413 },
  );
  await assert.rejects(
    normalizeImage(Buffer.from("0000ftypheic00000000"), "activity"),
    /HEIC\/HEIF/,
  );
});
test("association validates ownership, kind, resource and max five before mutating any media", async () => {
  const f = fixture();
  try {
    const image = await png(),
      { media } = await (await f.upload(image)).json();
    f.addActivity();
    f.addActivity("another");
    await assert.rejects(
      prepareActivityMedia(f.db, "course", actor("bob"), "activity-one", [
        media.id,
      ]),
      { status: 403 },
    );
    await assert.rejects(
      prepareActivityMedia(
        f.db,
        "course",
        actor("alice"),
        "activity-one",
        Array(6).fill(media.id),
      ),
      { status: 400 },
    );
    await f.db.batch(
      await prepareActivityMedia(
        f.db,
        "course",
        actor("alice"),
        "activity-one",
        [media.id],
      ),
    );
    await assert.rejects(
      prepareActivityMedia(f.db, "course", actor("alice"), "another", [
        media.id,
      ]),
      { status: 403 },
    );
    assert.equal(
      f.db.sqlite
        .prepare("SELECT resource_id FROM media WHERE id=?")
        .get(media.id)!.resource_id,
      "activity-one",
    );
    const avatar = await (await f.upload(image, "avatar")).json();
    await assert.rejects(
      prepareActivityMedia(f.db, "course", actor("alice"), "activity-one", [
        avatar.media.id,
      ]),
      { status: 403 },
    );
  } finally {
    f.close();
  }
});
test("ambiguous activity save success followed by form cleanup cannot delete an already attached photo", async () => {
  const f = fixture();
  try {
    const { media } = await (await f.upload(await png())).json();
    f.addActivity();
    await f.db.batch(
      await prepareActivityMedia(
        f.db,
        "course",
        actor("alice"),
        "activity-one",
        [media.id],
      ),
    );
    const cancelled = await f.call(
      media.id,
      "alice",
      "DELETE",
      "?onlyUnattached=1",
    );
    assert.equal(cancelled.status, 200);
    assert.deepEqual(await cancelled.json(), { ok: true, removed: false });
    assert.equal((await f.call(media.id, "bob")).status, 200);
    assert.ok(readFileSync(join(f.directory, `${media.id}.webp`)).length > 0);
    assert.equal(
      (await f.call(media.id, "alice", "DELETE")).status,
      409,
      "attached photos change only with their activity transaction",
    );
    await f.db.batch(
      await prepareActivityMedia(
        f.db,
        "course",
        actor("alice"),
        "activity-one",
        [],
      ),
    );
    assert.equal((await f.call(media.id, "bob")).status, 404);
    assert.equal(
      (await f.call(media.id, "alice", "DELETE", "?onlyUnattached=1")).status,
      200,
    );
    assert.equal(
      readdirSync(f.directory).filter((name) => name.endsWith(".webp")).length,
      0,
    );
  } finally {
    f.close();
  }
});
test("avatar replacement is square, removes superseded storage and cannot modify another member", async () => {
  const f = fixture();
  try {
    const first = await (await f.upload(await png(), "avatar")).json(),
      second = await (
        await f.upload(await png(), "avatar", "alice", "image/png", {
          focusX: "1",
          focusY: "0",
        })
      ).json();
    assert.equal(second.media.width, second.media.height);
    assert.equal(
      await memberAvatarUrl(f.db, "course", "alice", "/zk"),
      second.media.url,
    );
    assert.equal((await f.call(first.media.id)).status, 404);
    assert.equal(
      readdirSync(f.directory).filter((name) => name.endsWith(".webp")).length,
      1,
    );
    assert.equal((await f.call(second.media.id, "bob", "DELETE")).status, 403);
    assert.equal(
      (await f.call(second.media.id, "alice", "DELETE")).status,
      200,
    );
    assert.equal(await memberAvatarUrl(f.db, "course", "alice", "/zk"), null);
  } finally {
    f.close();
  }
});
test("draft and time-locked award images do not leak to participants; published definitions are readable", async () => {
  const f = fixture();
  try {
    assert.equal((await f.upload(await png(), "award", "alice")).status, 403);
    const { media } = await (
      await f.upload(await png(), "award", "admin")
    ).json();
    const definition = {
      id: "personal",
      name: "Pomoc",
      visual: { kind: "image", value: media.id },
    };
    f.db.sqlite
      .prepare(
        "INSERT INTO personal_award_definitions(id,course_id,data,status) VALUES('personal','course',?,'draft')",
      )
      .run(JSON.stringify(definition));
    await f.db.batch(
      await prepareAwardMedia(
        f.db,
        "course",
        actor("admin", "admin"),
        "personal",
        media.id,
      ),
    );
    assert.equal((await f.call(media.id, "bob")).status, 404);
    assert.equal((await f.call(media.id, "admin")).status, 200);
    f.db.sqlite.exec(
      "UPDATE personal_award_definitions SET status='published' WHERE id='personal'",
    );
    assert.equal((await f.call(media.id, "bob")).status, 200);
    const cold = await (await f.upload(await png(), "award", "admin")).json();
    f.db.sqlite
      .prepare(
        "INSERT INTO challenges(id,course_id,data,status,hidden) VALUES('course-cold','course',?,'published',0)",
      )
      .run(
        JSON.stringify({
          id: "course-cold",
          kind: "cold",
          startDate: "2026-11-20",
          visual: { kind: "image", value: cold.media.id },
        }),
      );
    await f.db.batch(
      await prepareAwardMedia(
        f.db,
        "course",
        actor("admin", "admin"),
        "course-cold",
        cold.media.id,
      ),
    );
    assert.equal((await f.call(cold.media.id, "bob")).status, 404);
    f.config.now = () => new Date("2026-11-21T12:00:00Z");
    assert.equal((await f.call(cold.media.id, "bob")).status, 200);
  } finally {
    f.close();
  }
});
test("deleted activity files are cleaned only after references are removed", async () => {
  const f = fixture();
  try {
    const { media } = await (await f.upload(await png())).json();
    f.addActivity();
    await f.db.batch(
      await prepareActivityMedia(
        f.db,
        "course",
        actor("alice"),
        "activity-one",
        [media.id],
      ),
    );
    await cleanupUnreferencedMedia(f.db, f.directory);
    assert.equal((await f.call(media.id)).status, 200);
    f.db.sqlite.exec("DELETE FROM activities WHERE id='activity-one'");
    await cleanupUnreferencedMedia(f.db, f.directory);
    assert.equal((await f.call(media.id)).status, 404);
    assert.equal(
      readdirSync(f.directory).filter((name) => name.endsWith(".webp")).length,
      0,
    );
  } finally {
    f.close();
  }
});
