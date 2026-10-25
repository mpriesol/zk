import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("../", import.meta.url));
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "cz-create-admin-"));
  const database = join(directory, "app.sqlite");
  return {
    database,
    run(input: string, production = false, args: string[] = []) {
      return spawnSync(
        process.execPath,
        ["--experimental-strip-types", "scripts/create-admin.ts", ...args],
        {
          cwd: root,
          encoding: "utf8",
          input,
          timeout: 20_000,
          env: {
            ...process.env,
            NODE_ENV: production ? "production" : "test",
            AUTH_MODE: "password",
            AUTH_MAIL_MODE: "smtp",
            APP_URL: "https://hub.biketrek.sk/zk",
            COURSE_ID: "cli-test",
            DATABASE_PATH: database,
            BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
            BOOTSTRAP_ADMIN_EMAIL: "",
            SMTP_HOST: "",
            MAIL_FROM: "",
          },
        },
      );
    },
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("admin CLI creates one real password organizer without printing the password", () => {
  const f = fixture();
  const password = "Test-" + randomBytes(12).toString("hex");
  try {
    const result = f.run(`Organizátor Test\n${password}\n${password}\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Prvý organizátor/);
    assert(!result.stdout.includes(password));
    assert(!result.stderr.includes(password));
    const db = new DatabaseSync(f.database);
    try {
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) count FROM members WHERE role='admin' AND active=1",
          )
          .get()?.count,
        1,
      );
      const member = db.prepare("SELECT nickname FROM members").get();
      assert.equal(member?.nickname, "Organizátor Test");
      const account = db
        .prepare("SELECT password FROM account WHERE providerId='credential'")
        .get();
      assert.equal(typeof account?.password, "string");
      assert.notEqual(account?.password, password);
      assert.equal(
        db.prepare('SELECT COUNT(*) count FROM "session"').get()?.count,
        0,
      );
    } finally {
      db.close();
    }
    assert(!readFileSync(f.database).includes(Buffer.from(password)));
    const second = f.run(`Druhý Organizátor\n${password}\n${password}\n`);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /už existuje/);
    const checked = new DatabaseSync(f.database);
    try {
      assert.equal(
        checked.prepare('SELECT COUNT(*) count FROM "user"').get()?.count,
        1,
      );
      assert.equal(
        checked.prepare("SELECT COUNT(*) count FROM members").get()?.count,
        1,
      );
    } finally {
      checked.close();
    }
  } finally {
    f.cleanup();
  }
});

test("admin CLI rejects mismatched confirmation before creating a database", () => {
  const f = fixture();
  try {
    const result = f.run(
      "Organizer\nfirst-password-test\ndifferent-password-test\n",
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Heslá sa nezhodujú/);
    assert(!existsSync(f.database));
    assert(!result.stderr.includes("first-password-test"));
  } finally {
    f.cleanup();
  }
});

test("production admin CLI refuses piped credentials and credential arguments", () => {
  const f = fixture();
  try {
    const piped = f.run(
      "Organizer\nprivate-password-test\nprivate-password-test\n",
      true,
    );
    assert.equal(piped.status, 1);
    assert.match(piped.stderr, /Spusti tento príkaz v termináli/);
    assert(!existsSync(f.database));
    assert(!piped.stdout.includes("private-password-test"));
    const argument = f.run("", true, ["not-accepted"]);
    assert.equal(argument.status, 1);
    assert.match(argument.stderr, /neprijíma argumenty/);
    assert(!existsSync(f.database));
  } finally {
    f.cleanup();
  }
});
