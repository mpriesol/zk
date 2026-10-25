import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";
import { Writable } from "node:stream";
import { SQLiteDatabase, migrateApp } from "../server/sqlite.ts";
import {
  authSettingsFromEnv,
  createAuth,
  migrateAuth,
} from "../server/auth.ts";
import { createInitialPasswordAdmin } from "../server/accounts.ts";

async function credentials(): Promise<{ username: string; password: string }> {
  const interactive = !!stdin.isTTY && !!stdout.isTTY;
  if (!interactive) {
    // A pipe is accepted only by isolated automated tests. Operators must use a
    // terminal so a password never becomes a shell argument or environment value.
    if (process.env.NODE_ENV !== "test")
      throw new Error(
        "Spusti tento príkaz v termináli: docker compose --env-file zk.env -p cestou-zimy exec -it zk-app node --experimental-strip-types scripts/create-admin.ts",
      );
    let input = "";
    for await (const chunk of stdin) {
      input += chunk.toString();
      if (input.length > 4096) throw new Error("Príliš dlhý vstup.");
    }
    const lines = input.split(/\r?\n/);
    const [username, password, confirmation] = lines;
    if (!username || !password || confirmation === undefined)
      throw new Error("Chýba používateľské meno alebo potvrdenie hesla.");
    if (password !== confirmation) throw new Error("Heslá sa nezhodujú.");
    return { username, password };
  }

  let hidden = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!hidden) stdout.write(chunk, encoding);
      callback();
    },
  });
  const reader = createInterface({ input: stdin, output, terminal: true });
  const controller = new AbortController();
  reader.on("SIGINT", () => controller.abort());
  reader.on("close", () => controller.abort());
  async function question(label: string, secret = false): Promise<string> {
    hidden = secret;
    if (secret) stdout.write(label);
    try {
      return await reader.question(secret ? "" : label, {
        signal: controller.signal,
      });
    } finally {
      hidden = false;
      if (secret) stdout.write("\n");
    }
  }
  try {
    const username = await question("Používateľské meno prvého organizátora: ");
    const password = await question(
      "Heslo (aspoň 10 znakov, nezobrazuje sa): ",
      true,
    );
    const confirmation = await question("Heslo ešte raz: ", true);
    if (password !== confirmation) throw new Error("Heslá sa nezhodujú.");
    return { username, password };
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("Vytvorenie účtu bolo zrušené.");
    throw error;
  } finally {
    reader.close();
    output.end();
  }
}

let db: SQLiteDatabase | undefined;
try {
  if (process.argv.length !== 2)
    throw new Error(
      "Príkaz neprijíma argumenty. Meno a heslo zadáš v termináli.",
    );
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const settings = authSettingsFromEnv();
  const input = await credentials();
  db = new SQLiteDatabase(
    process.env.DATABASE_PATH || ".data/cestou-zimy.sqlite",
  );
  migrateApp(db);
  const auth = createAuth(db, settings);
  await migrateAuth(auth);
  const created = await createInitialPasswordAdmin(db, auth, settings, input);
  stdout.write(
    `Prvý organizátor „${created.username}“ bol vytvorený. Prihlás sa v aplikácii.\n`,
  );
} catch (error) {
  stderr.write(
    (error instanceof Error ? error.message : "Účet sa nepodarilo vytvoriť.") +
      "\n",
  );
  process.exitCode = 1;
} finally {
  db?.close();
}
