import { SQLiteDatabase, migrateApp } from "../server/sqlite.ts";
import {
  createAuth,
  authSettingsFromEnv,
  migrateAuth,
} from "../server/auth.ts";
try {
  process.loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const db = new SQLiteDatabase(
  process.env.DATABASE_PATH || ".data/cestou-zimy.sqlite",
);
try {
  const applied = migrateApp(db);
  const auth = createAuth(db, authSettingsFromEnv());
  await migrateAuth(auth);
  console.log(
    `Databáza pripravená. Nové aplikačné migrácie: ${applied.length}. Schéma prihlasovania je aktuálna.`,
  );
} finally {
  db.close();
}
