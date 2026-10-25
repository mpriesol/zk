import { SQLiteDatabase, migrateApp } from "../server/sqlite.ts";
import { handleRequest } from "../lib/server.ts";
import { weekStart, addDays, todayInZone } from "../lib/dates.ts";
import { resolve } from "node:path";
if (
  process.env.NODE_ENV === "production" ||
  process.env.AUTH_MAIL_MODE !== "file"
)
  throw new Error("Demo seed vyžaduje vývojový režim a AUTH_MAIL_MODE=file.");
const db = new SQLiteDatabase(
  process.env.DATABASE_PATH || ".data/cestou-zimy.sqlite",
);
migrateApp(db);
const courseId = process.env.COURSE_ID || "cestou-zimy",
  email = process.env.BOOTSTRAP_ADMIN_EMAIL || "organizator@example.test";
const existing = db.native
  .prepare("SELECT data FROM courses WHERE id=?")
  .get(courseId);
if (existing && !JSON.parse(String(existing.data)).testMode)
  throw new Error("Demo seed sa nesmie spustiť na reálnom kurze.");
const admin = {
    userId: "demo-seed-admin",
    email,
    displayName: "Organizátor · TEST",
  },
  config = { courseId, bootstrapAdminEmail: email },
  today = todayInZone("Europe/Bratislava");
async function api(
  identity: typeof admin,
  action?: string,
  data: Record<string, unknown> = {},
) {
  const response = await handleRequest(
    new Request(
      "http://localhost/api/" + (action ? "action" : "state"),
      action
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, ...data }),
          }
        : {},
    ),
    identity,
    db,
    config,
  );
  const body: any = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body;
}
try {
  if (existing) {
    const count = db.native
      .prepare("SELECT COUNT(*) count FROM activities WHERE course_id=?")
      .get(courseId);
    if (Number(count?.count) > 0)
      throw new Error(
        "Kurz už obsahuje záznamy. Seed ich neprepisuje; použi novú samostatnú testovaciu databázu.",
      );
  }
  let state = await api(admin);
  const records = [
    {
      email: "anna@example.test",
      nickname: "Anna · TEST",
      days: [0, 1, 3, 5, 8, 10, 14, 16],
      types: ["walk", "exercise"],
      minutes: [40, 20],
    },
    {
      email: "boris@example.test",
      nickname: "Boris · TEST",
      days: [1, 4, 8, 11, 15],
      types: ["run"],
      minutes: [90],
    },
    {
      email: "dana@example.test",
      nickname: "Dana · TEST",
      days: [2, 14, 16],
      types: ["hike", "walk"],
      minutes: [120, null],
    },
    {
      email: "emil@example.test",
      nickname: "Emil · TEST",
      days: [],
      types: ["walk"],
      minutes: [null],
    },
  ];
  for (const person of records) {
    const invited = await api(admin, "inviteMember", {
      ...person,
      role: "participant",
    });
    const identity = {
      userId: "demo-" + person.email,
      email: person.email,
      displayName: person.nickname,
    };
    for (let i = 0; i < person.days.length; i++) {
      const d = addDays(today, -person.days[i]);
      await api(identity, "saveActivity", {
        idempotencyKey: "demo-" + i,
        typeId: courseId + "-" + person.types[i % person.types.length],
        date: d,
        minutes: person.minutes[i % person.minutes.length],
        distance: null,
        note: i === 0 ? "Vývojový záznam · skúšame denník" : "",
      });
    }
  }
  await api(admin, "saveProfile", {
    nickname: "Organizátor · TEST",
    animations: true,
  });
  await api(admin, "saveActivity", {
    idempotencyKey: "demo-admin-walk",
    typeId: courseId + "-walk",
    date: today,
    minutes: 35,
    distance: 2.8,
    note: "Testovací zápis organizátora.",
  });
  const ch = await api(admin, "saveChallenge", {
    name: "Skús si zbaliť batoh · TEST",
    description:
      "Prejdi si zoznam výbavy, skús rozložiť váhu a zisti, čo si môžeš požičať. Nie je potrebné nič kupovať.",
    startDate: addDays(weekStart(today), -7),
    endDate: addDays(weekStart(today), 13),
    condition: { kind: "manual", count: 1 },
    reward: "Praktický kryštál",
    hidden: false,
  });
  await api(admin, "publishChallenge", { id: ch.id, announce: false });
  await api(
    {
      userId: "demo-anna@example.test",
      email: "anna@example.test",
      displayName: "Anna · TEST",
    },
    "completeChallenge",
    {
      id: ch.id,
      date: today,
      note: "Test: batoh skontrolovaný.",
      completed: true,
    },
  );
  const old = await api(admin, "saveChallenge", {
    name: "Krátka prechádzka · TEST",
    description:
      "Aspoň jedna prechádzka s vyplneným trvaním 20 minút. Staršia testovacia výzva.",
    startDate: addDays(weekStart(today), -14),
    endDate: addDays(weekStart(today), -8),
    condition: {
      kind: "activities",
      count: 1,
      groups: ["foot"],
      minMinutes: 20,
    },
    reward: "Lesný kryštál",
    hidden: false,
  });
  await api(admin, "publishChallenge", { id: old.id, announce: false });
  await api(admin, "endChallenge", { id: old.id });
  const message = await api(admin, "saveMessage", {
    title: "Vitaj v testovacom ročníku",
    body: "Toto sú označené vývojové údaje. Skús si zapísať vlastnú aktivitu, otvoriť Všetci alebo pozrieť výzvy. Všetko je dobrovoľné.",
    link: "/?view=challenges",
    important: true,
    pinned: true,
    audience: "all",
    recipients: [],
    push: false,
  });
  await api(admin, "sendMessage", { id: message.id });
  // The seed never creates sessions or OTPs. Verified OTP login binds each invited email later.
  db.native
    .prepare("UPDATE members SET user_id=NULL WHERE course_id=?")
    .run(courseId);
  console.log(
    "Testovací ročník vytvorený. Prihlás sa štandardným OTP (vývojové e-maily sú v MAIL_DIRECTORY).",
  );
  console.log(
    "Organizátor: " +
      email +
      "\nÚčastníci: " +
      records.map((p) => p.email).join(", "),
  );
} finally {
  db.close();
}
