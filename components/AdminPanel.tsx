"use client";
import { appPath } from "../lib/paths";
import AccountAdmin from "./AccountAdmin";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Download,
  Eye,
  Mail,
  Plus,
  Send,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import type {
  ActivityGroup,
  ActivityType,
  AppState,
  Challenge,
  Condition,
  Course,
  Member,
  Message,
  Rule,
} from "../lib/types";

export type AdminData = {
  members: Member[];
  types: ActivityType[];
  rules: Rule[];
  challenges: Challenge[];
  messages: Message[];
  audit: Array<{
    id?: string;
    action: string;
    createdAt?: string;
    created_at?: string;
    actor?: string;
    detail?: string;
  }>;
  outbox: Array<{
    id?: string;
    status: string;
    kind?: string;
    attempts?: number;
    lastError?: string;
    last_error?: string;
  }>;
};
type Action = (action: string, data?: Record<string, unknown>) => Promise<any>;
type PeriodChange = {
  startDate: string;
  endDate: string;
  fromVersion?: number;
  toVersion?: number;
};
type RecalculationChange = {
  memberId: string;
  nickname: string;
  before: number | boolean;
  after: number | boolean;
  addedPeriods?: PeriodChange[];
  removedPeriods?: PeriodChange[];
  changedPeriods?: PeriodChange[];
};
type Recalculation = {
  previewToken: string;
  changes: RecalculationChange[];
  warning?: string;
};
const auditLabels: Record<string, string> = {
  saveCourse: "Úprava nastavení kurzu",
  inviteMember: "Pozvanie účastníka",
  resendInvite: "Opätovná pozvánka",
  updateMember: "Úprava členstva",
  saveType: "Úprava typu aktivity",
  saveRule: "Nová verzia pravidla",
  applyRecalculation: "Spätný prepočet odmien",
  saveChallenge: "Uloženie výzvy",
  publishChallenge: "Zverejnenie výzvy",
  endChallenge: "Ukončenie výzvy",
  saveMessage: "Uloženie oznámenia",
  sendMessage: "Publikovanie oznámenia",
  bootstrap: "Vytvorenie kurzu a prvého organizátora",
};
const exportDatasets = [
  {
    id: "activities",
    label: "Aktivity",
    description:
      "Zapísaný pohyb členov, dátumy, čas, vzdialenosť a poznámky. Zahŕňa aj zápisy bývalých členov kurzu.",
  },
  {
    id: "members",
    label: "Účastníci",
    description:
      "Prezývky, kontaktné e-maily, roly a stav členstva v tomto kurze.",
  },
  {
    id: "awards",
    label: "Odmeny",
    description:
      "Získané odmeny, ich obdobia a podmienky, podľa ktorých boli udelené.",
  },
  {
    id: "challenges",
    label: "Výzvy",
    description:
      "Názvy, podmienky, obdobia a stav všetkých výziev vrátane konceptov a skrytých úloh.",
  },
  {
    id: "completions",
    label: "Potvrdenia úloh",
    description:
      "Kto a kedy potvrdil praktickú úlohu, spolu s pridanou poznámkou.",
  },
  {
    id: "announcements",
    label: "Oznámenia",
    description:
      "Obsah konceptov aj publikovaných oznámení a ich nastavenie adresátov a dôležitosti.",
  },
  {
    id: "recipients",
    label: "Adresáti oznámení",
    description: "Konkrétni adresáti jednotlivých správ a ich stav prečítania.",
  },
  {
    id: "comments",
    label: "Komentáre",
    description: "Komentáre k aktivitám, ich autori a súvisiace zápisy.",
  },
  {
    id: "reactions",
    label: "Reakcie",
    description: "Reakcie členov a aktivity, ku ktorým patria.",
  },
] as const;
type ExportDataset = (typeof exportDatasets)[number]["id"];
type Tab =
  | "course"
  | "members"
  | "types"
  | "rules"
  | "challenges"
  | "messages"
  | "audit";
const groupLabels: Record<ActivityGroup, string> = {
  foot: "Chôdza / turistika / beh",
  exercise: "Cvičenie",
  other: "Ostatný pohyb",
  task: "Praktická úloha",
};
const initialCondition: Condition = { kind: "days", count: 3 };
const displayDate = (date: string) =>
  new Date(date + "T12:00:00Z").toLocaleDateString("sk-SK");
function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Zmenu sa nepodarilo uložiť. Skús to znova.";
}
function ConditionFields({
  value,
  onChange,
  part = false,
  mode = "all",
}: {
  value: Condition;
  onChange: (value: Condition) => void;
  part?: boolean;
  mode?: "all" | "movement" | "manualOnly";
}) {
  const kind = value.kind;
  const swap = (next: Condition["kind"]) =>
    onChange(
      next === "combination"
        ? {
            kind: "combination",
            conditions: [
              {
                kind: "activities",
                count: 1,
                groups: ["foot"],
                minMinutes: 30,
              },
              {
                kind: "activities",
                count: 1,
                groups: ["exercise"],
                minMinutes: 15,
              },
            ],
          }
        : next === "manual"
          ? { kind: "manual", count: 1 }
          : { kind: next, count: kind === "combination" ? 1 : value.count },
    );
  return (
    <fieldset className="condition-fields stack">
      <legend>Podmienka{part ? " – časť kombinácie" : ""}</legend>
      <label className="field">
        Spôsob splnenia
        <select
          value={kind}
          onChange={(e) => swap(e.target.value as Condition["kind"])}
        >
          {mode !== "manualOnly" && (
            <>
              <option value="days">Rozdielne pohybové dni</option>
              <option value="activities">Počet vhodných aktivít</option>
            </>
          )}
          {mode !== "movement" && (
            <option value="manual">Vlastné potvrdenie praktickej úlohy</option>
          )}
          {!part && mode !== "manualOnly" && (
            <option value="combination">Kombinácia dvoch podmienok</option>
          )}
        </select>
      </label>
      {kind === "combination" ? (
        <div className="grid-two">
          {value.conditions.map((condition, index) => (
            <ConditionFields
              key={index}
              part
              mode={mode}
              value={condition}
              onChange={(next) =>
                onChange({
                  ...value,
                  conditions: value.conditions.map((item, i) =>
                    i === index ? next : item,
                  ),
                })
              }
            />
          ))}
        </div>
      ) : (
        <>
          <div className="grid-two">
            <label className="field">
              {kind === "days"
                ? "Počet rozdielnych dní"
                : kind === "manual"
                  ? "Počet potvrdení"
                  : "Počet aktivít"}
              <input
                type="number"
                min="1"
                max={kind === "manual" ? 1 : kind === "days" ? 365 : 500}
                readOnly={kind === "manual"}
                required
                value={value.count}
                onChange={(e) =>
                  onChange({ ...value, count: Number(e.target.value) })
                }
              />
            </label>
            {kind !== "manual" && (
              <label className="field">
                Minimálne minúty jednej aktivity
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={value.minMinutes ?? ""}
                  placeholder="Bez časového limitu"
                  onChange={(e) =>
                    onChange({
                      ...value,
                      minMinutes: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    })
                  }
                />
              </label>
            )}
          </div>
          {kind !== "manual" && (
            <label className="field">
              Skupina pohybu
              <select
                value={value.groups?.length === 1 ? value.groups[0] : "all"}
                onChange={(e) =>
                  onChange({
                    ...value,
                    groups:
                      e.target.value === "all"
                        ? undefined
                        : [e.target.value as ActivityGroup],
                  })
                }
              >
                <option value="all">Všetky pohybové skupiny</option>
                {(["foot", "exercise", "other"] as ActivityGroup[]).map(
                  (group) => (
                    <option key={group} value={group}>
                      {groupLabels[group]}
                    </option>
                  ),
                )}
              </select>
            </label>
          )}
        </>
      )}
      {kind === "manual" && (
        <p className="muted">
          Účastník sám potvrdí splnenie. Úloha nepridáva tréningové minúty ani
          pohybové dni.
        </p>
      )}
    </fieldset>
  );
}

export default function AdminPanel({
  state,
  onAction,
  visualFixture,
  onMembershipChanged,
}: {
  state: AppState;
  onAction: Action;
  visualFixture?: AdminData;
  onMembershipChanged?: () => Promise<void> | void;
}) {
  const [tab, setTab] = useState<Tab>("course");
  const [exportDataset, setExportDataset] =
    useState<ExportDataset>("activities");
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailOtpEnabled, setEmailOtpEnabled] = useState(false);
  const [course, setCourse] = useState<Course>(state.course);
  const [invite, setInvite] = useState({
    email: "",
    nickname: "",
    role: "participant",
  });
  const [type, setType] = useState<Partial<ActivityType>>({
    name: "",
    group: "other",
    active: true,
  });
  const [rule, setRule] = useState<Rule | null>(null);
  const [recalc, setRecalc] = useState<Recalculation | null>(null);
  const [challenge, setChallenge] = useState<Partial<Challenge> | null>(null);
  const [challengePreview, setChallengePreview] = useState(false);
  const [message, setMessage] = useState<Partial<Message> | null>(null);
  const [messagePreview, setMessagePreview] = useState(false);
  const [challengeDirty, setChallengeDirty] = useState(false);
  const [messageDirty, setMessageDirty] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const load = useCallback(async () => {
    if (visualFixture) {
      setData(visualFixture);
      return;
    }
    const response = await fetch(appPath("/api/admin"), { cache: "no-store" });
    const result = (await response.json()) as AdminData & { error?: string };
    if (!response.ok)
      throw new Error(result.error || "Administráciu sa nepodarilo načítať.");
    setData(result);
  }, [visualFixture]);
  useEffect(() => {
    load().catch((e) => setError(errorText(e)));
  }, [load]);
  const run = async (
    action: string,
    payload: Record<string, unknown> = {},
    success = "Zmena je uložená.",
  ) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await onAction(action, payload);
      await load();
      setNotice(result?.warning || result?.message || success);
      return result;
    } catch (e) {
      setError(errorText(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const perform = (
    action: string,
    payload: Record<string, unknown> = {},
    success?: string,
  ) => {
    void run(action, payload, success).catch(() => {});
  };
  const latestRules = useMemo(() => {
    const map = new Map<string, Rule>();
    for (const item of data?.rules || [])
      if (!map.has(item.key) || map.get(item.key)!.version < item.version)
        map.set(item.key, item);
    return Array.from(map.values());
  }, [data?.rules]);
  const newChallenge = () => {
    setChallenge({
      name: "",
      description: "",
      startDate: state.today,
      endDate: state.today,
      condition: { kind: "manual", count: 1 },
      reward: "Bonusový drahokam",
      status: "draft",
      hidden: true,
      typeId: null,
    });
    setChallengePreview(false);
    setAnnounce(false);
    setChallengeDirty(false);
  };
  const newMessage = () => {
    setMessage({
      title: "",
      body: "",
      link: "",
      important: false,
      pinned: false,
      audience: "all",
      recipients: [],
      push: false,
      status: "draft",
    });
    setMessagePreview(false);
    setMessageDirty(false);
  };
  const buttons: [Tab, string][] = [
    ["course", "Kurz"],
    ["members", "Účastníci"],
    ["types", "Aktivity"],
    ["rules", "Odmeny"],
    ["challenges", "Výzvy"],
    ["messages", "Oznámenia"],
    ["audit", "Záznamy a export"],
  ];
  if (!data)
    return (
      <section className="panel">
        <h2>Organizátor</h2>
        <p role={error ? "alert" : "status"}>
          {error || "Načítavam správu kurzu…"}
        </p>
        {error && (
          <button
            className="button secondary"
            onClick={() => load().catch((e) => setError(errorText(e)))}
          >
            Skúsiť znova
          </button>
        )}
      </section>
    );
  return (
    <section className="admin-panel stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">SPRÁVA KURZU</p>
          <h2>Priestor organizátora</h2>
        </div>
        <Shield aria-hidden="true" />
      </div>
      <nav className="admin-tabs" aria-label="Administrácia">
        {buttons.map(([key, label]) => (
          <button
            className={"button " + (key === tab ? "primary" : "secondary")}
            key={key}
            onClick={() => {
              setTab(key);
              setNotice("");
              setError("");
            }}
            aria-current={tab === key ? "page" : undefined}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          <Check size={18} aria-hidden="true" /> {notice}
        </p>
      )}
      {tab === "course" && (
        <form
          className="panel stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              window.confirm(
                "Uložiť nastavenia kurzu? Existujúce zápisy zostanú zachované.",
              )
            )
              perform("saveCourse", { ...course });
          }}
        >
          <h3>Základné nastavenia</h3>
          <label className="field">
            Názov ročníka
            <input
              required
              maxLength={120}
              value={course.name}
              onChange={(e) => setCourse({ ...course, name: e.target.value })}
            />
          </label>
          <div className="grid-two">
            <label className="field">
              Začiatok prípravy
              <input
                type="date"
                required
                value={course.startDate}
                onChange={(e) =>
                  setCourse({ ...course, startDate: e.target.value })
                }
              />
            </label>
            <label className="field">
              Koniec prípravy – vrátane
              <input
                type="date"
                required
                min={course.startDate}
                value={course.endDate}
                onChange={(e) =>
                  setCourse({ ...course, endDate: e.target.value })
                }
              />
            </label>
          </div>
          <label className="field">
            Časová zóna
            <input
              required
              value={course.timezone}
              onChange={(e) =>
                setCourse({ ...course, timezone: e.target.value })
              }
            />
            <small>
              Predvolene Europe/Bratislava. Týždeň sa začína pondelkom.
            </small>
          </label>
          <label className="field">
            Najviac vystúpení veveričky za reláciu
            <input
              type="number"
              min="0"
              max="10"
              value={course.squirrelLimit}
              onChange={(e) =>
                setCourse({ ...course, squirrelLimit: Number(e.target.value) })
              }
            />
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={course.testMode}
              onChange={(e) =>
                setCourse({ ...course, testMode: e.target.checked })
              }
            />{" "}
            Označiť ako testovací ročník
          </label>
          <button className="button primary" disabled={busy}>
            <Settings size={18} /> Uložiť nastavenia
          </button>
        </form>
      )}
      {tab === "members" && (
        <div className="stack">
          <AccountAdmin
            disabled={!!visualFixture}
            onEmailAvailability={setEmailOtpEnabled}
            onChanged={async () => {
              await load();
              await onMembershipChanged?.();
            }}
          />
          {emailOtpEnabled && (
            <form
              className="panel stack"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await run(
                    "inviteMember",
                    invite,
                    "Členstvo je pripravené. Stav odoslania pozvánky nájdeš v záznamoch.",
                  );
                  setInvite({ email: "", nickname: "", role: "participant" });
                } catch {}
              }}
            >
              <h3>Pozvať cez e-mail</h3>
              <p className="muted">
                Pozvánka platí iba pre tento kurz. Účastník sa prihlási účtom s
                týmto e-mailom.
              </p>
              <div className="grid-two">
                <label className="field">
                  E-mail
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={invite.email}
                    onChange={(e) =>
                      setInvite({ ...invite, email: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Meno alebo prezývka
                  <input
                    required
                    maxLength={50}
                    value={invite.nickname}
                    onChange={(e) =>
                      setInvite({ ...invite, nickname: e.target.value })
                    }
                  />
                </label>
              </div>
              <label className="field">
                Rola
                <select
                  value={invite.role}
                  onChange={(e) =>
                    setInvite({ ...invite, role: e.target.value })
                  }
                >
                  <option value="participant">Účastník</option>
                  <option value="admin">Organizátor</option>
                </select>
              </label>
              <button className="button primary" disabled={busy}>
                <Mail size={18} /> Pripraviť a odoslať pozvánku
              </button>
            </form>
          )}
          <div className="panel stack">
            <h3>
              Členovia kurzu{" "}
              <span className="muted">({data.members.length})</span>
            </h3>
            {data.members
              .slice()
              .sort((a, b) => a.nickname.localeCompare(b.nickname, "sk"))
              .map((member) => {
                const contactEmail =
                  member.email && !/@[^@]*\.invalid$/i.test(member.email)
                    ? member.email
                    : undefined;
                return (
                  <article className="admin-member card" key={member.id}>
                    <div>
                      <strong>{member.nickname}</strong>
                      <p className="muted">
                        {contactEmail ? `${contactEmail} · ` : ""}
                        {member.role === "admin"
                          ? "organizátor"
                          : "účastník"} ·{" "}
                        {member.active
                          ? member.userId
                            ? "aktívny účet"
                            : "pozvaný"
                          : "neaktívne členstvo"}
                      </p>
                    </div>
                    <div className="button-row">
                      {emailOtpEnabled && contactEmail && (
                        <button
                          className="button secondary"
                          disabled={busy || !member.active}
                          onClick={() =>
                            perform(
                              "resendInvite",
                              { id: member.id },
                              "Pozvánka bola zaradená na odoslanie.",
                            )
                          }
                        >
                          Znova pozvať
                        </button>
                      )}
                      <button
                        className="button secondary"
                        disabled={busy || member.id === state.me.id}
                        onClick={() => {
                          const role =
                            member.role === "admin" ? "participant" : "admin";
                          if (
                            window.confirm(
                              `Zmeniť rolu používateľa ${member.nickname} na ${role === "admin" ? "organizátora" : "účastníka"}?`,
                            )
                          )
                            perform("updateMember", { id: member.id, role });
                        }}
                      >
                        {member.role === "admin"
                          ? "Zmeniť na účastníka"
                          : "Zmeniť na organizátora"}
                      </button>
                      <button
                        className={
                          "button " + (member.active ? "danger" : "secondary")
                        }
                        disabled={busy || member.id === state.me.id}
                        onClick={() => {
                          if (
                            window.confirm(
                              member.active
                                ? `Zrušiť členstvo pre ${member.nickname}? Prístup sa zastaví aj na už prihlásených zariadeniach.`
                                : `Obnoviť členstvo pre ${member.nickname}?`,
                            )
                          )
                            perform("updateMember", {
                              id: member.id,
                              active: !member.active,
                            });
                        }}
                      >
                        {member.active ? "Zrušiť členstvo" : "Obnoviť členstvo"}
                      </button>
                    </div>
                  </article>
                );
              })}
          </div>
        </div>
      )}
      {tab === "types" && (
        <div className="grid-two">
          <form
            className="panel stack"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await run("saveType", {
                  id: type.id,
                  name: type.name,
                  group: type.group,
                  active: type.active,
                });
                setType({ name: "", group: "other", active: true });
              } catch {}
            }}
          >
            <h3>{type.id ? "Upraviť typ aktivity" : "Nový typ aktivity"}</h3>
            <label className="field">
              Názov
              <input
                required
                maxLength={60}
                value={type.name || ""}
                onChange={(e) => setType({ ...type, name: e.target.value })}
              />
            </label>
            <label className="field">
              Skupina pre výpočet odmien
              <select
                value={type.group}
                onChange={(e) =>
                  setType({ ...type, group: e.target.value as ActivityGroup })
                }
              >
                {Object.entries(groupLabels)
                  .filter(([key]) => key !== "task")
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={type.active ?? true}
                onChange={(e) => setType({ ...type, active: e.target.checked })}
              />{" "}
              Aktívny typ
            </label>
            <p className="muted">
              Skryté typy sprístupni publikovaním ich výzvy. Zmena názvu nemení
              pôvodný dátum aktivity.
            </p>
            <div className="button-row">
              <button className="button primary" disabled={busy}>
                Uložiť typ
              </button>
              {type.id && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={() =>
                    setType({ name: "", group: "other", active: true })
                  }
                >
                  Nový typ
                </button>
              )}
            </div>
          </form>
          <div className="panel stack">
            <h3>Typy pohybu a úloh</h3>
            {data.types.map((item) => (
              <button
                className="type-admin-row"
                key={item.id}
                disabled={item.hidden || item.group === "task"}
                onClick={() => setType({ ...item })}
              >
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {groupLabels[item.group]}
                    {item.group === "task" ? " · spravuj vo Výzvach" : ""}
                  </small>
                </span>
                <span className="pill">
                  {item.hidden
                    ? "Skrytý"
                    : item.active
                      ? "Aktívny"
                      : "Neaktívny"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === "rules" && (
        <div className="stack">
          <div className="panel stack">
            <h3>Pravidlá základnej zbierky</h3>
            <p className="muted">
              Úprava vytvorí novú verziu. Týždenné pravidlo začne platiť najskôr
              nasledujúci týždeň; pravidlo za celú prípravu až po skončení
              aktuálnej prípravy. Historické odmeny zostávajú podľa pôvodných
              podmienok. Spätnú zmenu vykonaj osobitne s náhľadom.
            </p>
            <div className="button-row">
              {latestRules.map((item) => (
                <button
                  className={
                    "button " +
                    (rule?.key === item.key ? "primary" : "secondary")
                  }
                  key={item.id}
                  onClick={() => {
                    setRule(structuredClone(item));
                    setRecalc(null);
                  }}
                >
                  {item.name} <span className="muted">v{item.version}</span>
                </button>
              ))}
            </div>
          </div>
          {rule && (
            <form
              className="panel stack"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await run(
                    "saveRule",
                    {
                      id: rule.id,
                      key: rule.key,
                      name: rule.name,
                      description: rule.description,
                      gem: rule.gem,
                      condition: rule.condition,
                      active: rule.active,
                    },
                    "Nová verzia pravidla je uložená s budúcou platnosťou.",
                  );
                  setRule(null);
                  setRecalc(null);
                } catch {}
              }}
            >
              <h3>Upraviť: {rule.name}</h3>
              <div className="grid-two">
                <label className="field">
                  Názov odmeny
                  <input
                    required
                    value={rule.name}
                    onChange={(e) => setRule({ ...rule, name: e.target.value })}
                  />
                </label>
                <label className="field">
                  Drahokam
                  <input
                    required
                    value={rule.gem}
                    onChange={(e) => setRule({ ...rule, gem: e.target.value })}
                  />
                </label>
              </div>
              <label className="field">
                Zrozumiteľný opis
                <textarea
                  required
                  rows={3}
                  value={rule.description}
                  onChange={(e) =>
                    setRule({ ...rule, description: e.target.value })
                  }
                />
              </label>
              <ConditionFields
                mode={rule.key === "equipment" ? "manualOnly" : "movement"}
                value={rule.condition}
                onChange={(condition) => setRule({ ...rule, condition })}
              />
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={rule.active}
                  onChange={(e) =>
                    setRule({ ...rule, active: e.target.checked })
                  }
                />{" "}
                Pravidlo aktívne
              </label>
              <p className="muted">
                Periodicita:{" "}
                {rule.period === "week"
                  ? "jeden drahokam za týždeň"
                  : "jeden drahokam za celú prípravu"}
                . Posledná verzia v{rule.version}, platná od{" "}
                {displayDate(rule.effectiveFrom)}.
              </p>
              <button className="button primary" disabled={busy}>
                Uložiť budúcu verziu
              </button>
            </form>
          )}
          <div className="panel stack">
            <h3>Spätný prepočet – iba po kontrole</h3>
            <p className="muted">
              Porovná historické odmeny s poslednou uloženou verziou vybraného
              pravidla. Najskôr zobraz náhľad konkrétnych zmien.
            </p>
            <label className="field">
              Pravidlo
              <select
                value={rule?.key || ""}
                onChange={(e) => {
                  const selected = latestRules.find(
                    (item) => item.key === e.target.value,
                  );
                  setRule(selected ? structuredClone(selected) : null);
                  setRecalc(null);
                }}
              >
                <option value="">Vyber pravidlo</option>
                {latestRules.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button secondary"
              disabled={busy || !rule}
              onClick={async () => {
                if (!rule) return;
                try {
                  const result = await run(
                    "previewRecalculation",
                    { ruleKey: rule.key },
                    "Náhľad je pripravený. Zatiaľ sa nič neprepočítalo.",
                  );
                  setRecalc({
                    ...result,
                    changes: result.changes.filter(
                      (item: RecalculationChange) =>
                        item.before !== item.after ||
                        item.addedPeriods?.length ||
                        item.removedPeriods?.length ||
                        item.changedPeriods?.length,
                    ),
                  });
                } catch {}
              }}
            >
              <Eye size={18} /> Zobraziť dôsledky
            </button>
            {recalc && (
              <div className="stack">
                <p>
                  {recalc.warning ||
                    "Nasledujúci prepočet zmení historické odmeny podľa poslednej uloženej verzie pravidla."}
                </p>
                {recalc.changes.length ? (
                  <ul>
                    {recalc.changes.map((item, index) => (
                      <li key={item.memberId + index}>
                        <strong>{item.nickname}</strong>: počet odmien{" "}
                        {String(item.before)} → {String(item.after)}
                        {(
                          [
                            "addedPeriods",
                            "removedPeriods",
                            "changedPeriods",
                          ] as const
                        ).map((kind) =>
                          (item[kind] || []).map((period, i) => (
                            <p className="small muted" key={kind + i}>
                              {kind === "addedPeriods"
                                ? "Pribudne"
                                : kind === "removedPeriods"
                                  ? "Odoberie sa"
                                  : "Zmenia sa podmienky"}
                              : {displayDate(period.startDate)} –{" "}
                              {displayDate(period.endDate)}
                              {period.fromVersion !== undefined
                                ? ` · verzia ${period.fromVersion} → ${period.toVersion}`
                                : ""}
                            </p>
                          )),
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Žiadne zmeny odmien.</p>
                )}
                <button
                  className="button danger"
                  disabled={busy || !rule || !recalc.changes.length}
                  onClick={async () => {
                    if (
                      !rule ||
                      !window.confirm(
                        "Použiť tento spätný prepočet? Historické odmeny sa zmenia podľa zobrazeného náhľadu.",
                      )
                    )
                      return;
                    try {
                      await run(
                        "applyRecalculation",
                        {
                          ruleKey: rule.key,
                          previewToken: recalc.previewToken,
                        },
                        "Spätný prepočet je dokončený a zapísaný v audite.",
                      );
                      setRecalc(null);
                    } catch {}
                  }}
                >
                  Potvrdiť spätný prepočet
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {tab === "challenges" && (
        <div className="stack">
          <div className="panel stack">
            <div className="section-heading">
              <h3>Výzvy kurzu</h3>
              <button className="button primary" onClick={newChallenge}>
                <Plus size={18} /> Nová výzva
              </button>
            </div>
            <p className="muted">
              Koncepty a skryté výzvy vidí iba organizátor. Publikovanie je
              oddelené od obdobia plnenia.
            </p>
            {data.challenges.length === 0 && (
              <p>Zatiaľ nie sú vytvorené žiadne výzvy.</p>
            )}
            {data.challenges.map((item) => (
              <article key={item.id} className="card stack">
                <div className="section-heading">
                  <div>
                    <h4>{item.name}</h4>
                    <p className="muted">
                      {displayDate(item.startDate)} –{" "}
                      {displayDate(item.endDate)} vrátane
                    </p>
                  </div>
                  <span className="pill">
                    {item.hidden
                      ? "Skrytá"
                      : item.status === "draft"
                        ? "Koncept"
                        : item.status === "ended"
                          ? "Ukončená"
                          : "Zverejnená"}
                  </span>
                </div>
                <p>{item.description}</p>
                <div className="button-row">
                  <button
                    className="button secondary"
                    onClick={() => {
                      setChallenge(structuredClone(item));
                      setChallengePreview(false);
                      setAnnounce(false);
                      setChallengeDirty(false);
                    }}
                  >
                    {item.status === "draft"
                      ? "Upraviť a zobraziť náhľad"
                      : "Zobraziť náhľad"}
                  </button>
                  {item.status === "published" && !item.hidden && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Ukončiť výzvu „${item.name}“?`))
                          perform(
                            "endChallenge",
                            { id: item.id },
                            "Výzva bola ukončená.",
                          );
                      }}
                    >
                      Ukončiť
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {challenge && challenge.status !== "draft" && (
            <article className="panel stack">
              <span className="eyebrow">ZVEREJNENÁ VÝZVA</span>
              <h3>{challenge.name}</h3>
              <p className="pre-wrap">{challenge.description}</p>
              <p>
                {challenge.startDate} – {challenge.endDate}, oba dni vrátane.
              </p>
              <p>Odmena: {challenge.reward}</p>
              <p className="muted">
                Publikované podmienky zostávajú nemenné. Ak potrebuješ iné
                pravidlá, ukonči výzvu a vytvor novú.
              </p>
              <button
                className="button secondary"
                onClick={() => setChallenge(null)}
              >
                Zavrieť náhľad
              </button>
            </article>
          )}
          {challenge && challenge.status === "draft" && (
            <form
              className="panel stack"
              onChange={() => setChallengeDirty(true)}
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const result = await run(
                    "saveChallenge",
                    { ...challenge },
                    "Výzva je uložená. Publikovanie je samostatný krok.",
                  );
                  if (result?.id) setChallenge({ ...challenge, id: result.id });
                  setChallengeDirty(false);
                } catch {}
              }}
            >
              <h3>{challenge.id ? "Úprava výzvy" : "Koncept novej výzvy"}</h3>
              <label className="field">
                Názov
                <input
                  required
                  maxLength={120}
                  value={challenge.name || ""}
                  onChange={(e) =>
                    setChallenge({ ...challenge, name: e.target.value })
                  }
                />
              </label>
              <label className="field">
                Opis
                <textarea
                  required
                  rows={4}
                  maxLength={5000}
                  value={challenge.description || ""}
                  onChange={(e) =>
                    setChallenge({ ...challenge, description: e.target.value })
                  }
                />
              </label>
              <div className="grid-two">
                <label className="field">
                  Plnenie od
                  <input
                    type="date"
                    required
                    min={state.course.startDate}
                    max={state.course.endDate}
                    value={challenge.startDate}
                    onChange={(e) =>
                      setChallenge({ ...challenge, startDate: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Plnenie do – vrátane
                  <input
                    type="date"
                    required
                    min={challenge.startDate}
                    max={state.course.endDate}
                    value={challenge.endDate}
                    onChange={(e) =>
                      setChallenge({ ...challenge, endDate: e.target.value })
                    }
                  />
                </label>
              </div>
              <label className="field">
                Bonusová odmena
                <input
                  required
                  value={challenge.reward || ""}
                  onChange={(e) =>
                    setChallenge({ ...challenge, reward: e.target.value })
                  }
                />
              </label>
              <ConditionFields
                value={challenge.condition || initialCondition}
                onChange={(condition) =>
                  setChallenge({ ...challenge, condition })
                }
              />
              {challenge.typeId && (
                <p>
                  Súvisiaca praktická úloha:{" "}
                  <strong>
                    {
                      data.types.find((item) => item.id === challenge.typeId)
                        ?.name
                    }
                  </strong>
                </p>
              )}
              <p className="muted">
                Súvisiaci skrytý typ sa sprístupní spolu s výzvou. Ostatné
                skryté úlohy zostanú utajené.
              </p>
              <div className="button-row">
                <button className="button primary" disabled={busy}>
                  Uložiť výzvu
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setChallengePreview(!challengePreview)}
                >
                  <Eye size={18} />{" "}
                  {challengePreview ? "Skryť náhľad" : "Náhľad"}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setChallenge(null)}
                >
                  Zavrieť
                </button>
              </div>
              {challengePreview && (
                <article className="card stack">
                  <span className="eyebrow">NÁHĽAD PRE ÚČASTNÍKA</span>
                  <h3>{challenge.name || "Názov výzvy"}</h3>
                  <p className="pre-wrap">{challenge.description}</p>
                  <p>
                    Obdobie: {challenge.startDate} – {challenge.endDate}, oba
                    dni vrátane.
                  </p>
                  <p>Odmena: {challenge.reward}</p>
                </article>
              )}
              {challenge.id &&
                (challenge.hidden || challenge.status === "draft") && (
                  <div className="stack">
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={announce}
                        onChange={(e) => {
                          e.stopPropagation();
                          setAnnounce(e.target.checked);
                        }}
                      />{" "}
                      Pridať oznámenie o novej výzve
                    </label>
                    <button
                      className="button primary"
                      type="button"
                      disabled={busy || challengeDirty}
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `Zverejniť uloženú výzvu „${challenge.name}“ všetkým členom kurzu?`,
                          )
                        )
                          return;
                        try {
                          await run(
                            "publishChallenge",
                            { id: challenge.id, announce },
                            "Výzva je zverejnená.",
                          );
                          setChallenge(null);
                        } catch {}
                      }}
                    >
                      Zverejniť uloženú výzvu
                    </button>
                    {challengeDirty && (
                      <p className="muted">
                        Pred zverejnením ulož rozpracované zmeny.
                      </p>
                    )}
                  </div>
                )}
            </form>
          )}
        </div>
      )}
      {tab === "messages" && (
        <div className="stack">
          <div className="panel stack">
            <div className="section-heading">
              <h3>Oznámenia od organizátora</h3>
              <button className="button primary" onClick={newMessage}>
                <Plus size={18} /> Nová správa
              </button>
            </div>
            <p className="muted">
              Správy sa zobrazia v aplikácii aj bez push upozornení. Nový člen
              neuvidí staršie adresné správy.
            </p>
            {data.messages.length === 0 && <p>Zatiaľ bez oznámení.</p>}
            {data.messages.map((item) => (
              <article className="card" key={item.id}>
                <div className="section-heading">
                  <div>
                    <strong>{item.title}</strong>
                    <p className="muted">
                      {item.status === "sent" ? "Publikovaná" : "Koncept"} ·{" "}
                      {item.audience === "all"
                        ? "Všetci členovia"
                        : "Vybraní adresáti"}
                    </p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setMessage(structuredClone(item));
                      setMessagePreview(false);
                      setMessageDirty(false);
                    }}
                  >
                    Otvoriť
                  </button>
                </div>
              </article>
            ))}
          </div>
          {message && (
            <form
              className="panel stack"
              onChange={() => setMessageDirty(true)}
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const result = await run(
                    "saveMessage",
                    { ...message },
                    message.status === "sent"
                      ? "Správa je upravená. Nový push sa neposlal."
                      : "Koncept je uložený.",
                  );
                  if (result?.id) setMessage({ ...message, id: result.id });
                  setMessageDirty(false);
                } catch {}
              }}
            >
              <h3>
                {message.status === "sent"
                  ? "Upraviť publikovanú správu"
                  : "Koncept oznámenia"}
              </h3>
              <label className="field">
                Titulok
                <input
                  required
                  maxLength={120}
                  value={message.title || ""}
                  onChange={(e) =>
                    setMessage({ ...message, title: e.target.value })
                  }
                />
              </label>
              <label className="field">
                Obsah
                <textarea
                  required
                  maxLength={8000}
                  rows={6}
                  value={message.body || ""}
                  onChange={(e) =>
                    setMessage({ ...message, body: e.target.value })
                  }
                />
              </label>
              <label className="field">
                Odkaz do aplikácie – nepovinný
                <input
                  value={message.link || ""}
                  placeholder={appPath("/?view=challenges")}
                  onChange={(e) =>
                    setMessage({ ...message, link: e.target.value })
                  }
                />
                <small>Použi iba internú cestu začínajúcu lomkou.</small>
              </label>
              <div className="button-row">
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={!!message.important}
                    onChange={(e) =>
                      setMessage({
                        ...message,
                        important: e.target.checked,
                        pinned: e.target.checked ? message.pinned : false,
                      })
                    }
                  />{" "}
                  Dôležitá správa
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    disabled={!message.important}
                    checked={!!message.pinned}
                    onChange={(e) =>
                      setMessage({ ...message, pinned: e.target.checked })
                    }
                  />{" "}
                  Pripnúť na domov
                </label>
              </div>
              <label className="field">
                Adresáti
                <select
                  disabled={message.status === "sent"}
                  value={message.audience || "all"}
                  onChange={(e) =>
                    setMessage({
                      ...message,
                      audience: e.target.value as Message["audience"],
                    })
                  }
                >
                  <option value="all">Všetci aktuálni členovia kurzu</option>
                  <option value="selected">Iba vybraní účastníci</option>
                </select>
              </label>
              {message.audience === "selected" && (
                <fieldset className="recipient-list">
                  <legend>Vyber adresátov</legend>
                  {data.members
                    .filter((member) => member.active)
                    .map((member) => (
                      <label className="check-field" key={member.id}>
                        <input
                          type="checkbox"
                          disabled={message.status === "sent"}
                          checked={
                            message.recipients?.includes(member.id) || false
                          }
                          onChange={(e) =>
                            setMessage({
                              ...message,
                              recipients: e.target.checked
                                ? [...(message.recipients || []), member.id]
                                : (message.recipients || []).filter(
                                    (id) => id !== member.id,
                                  ),
                            })
                          }
                        />
                        {member.nickname}
                      </label>
                    ))}
                </fieldset>
              )}
              <label className="check-field">
                <input
                  type="checkbox"
                  disabled={!state.pushConfigured || message.status === "sent"}
                  checked={!!message.push}
                  onChange={(e) =>
                    setMessage({ ...message, push: e.target.checked })
                  }
                />{" "}
                Pri publikovaní poslať aj push tým, ktorí ho povolili
              </label>
              {!state.pushConfigured && (
                <p className="muted">
                  Push ešte nie je nakonfigurovaný. Oznámenie v aplikácii
                  funguje samostatne.
                </p>
              )}
              {message.status === "sent" && (
                <p className="muted">
                  Úprava zverejnenej správy neodošle ďalší push a nezmení
                  pôvodných adresátov.
                </p>
              )}
              <div className="button-row">
                <button className="button primary" disabled={busy}>
                  {message.status === "sent"
                    ? "Uložiť úpravu"
                    : "Uložiť koncept"}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setMessagePreview(!messagePreview)}
                >
                  <Eye size={18} /> Náhľad
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setMessage(null)}
                >
                  Zavrieť
                </button>
              </div>
              {messagePreview && (
                <article className="card stack">
                  <span className="eyebrow">NÁHĽAD PRE ADRESÁTA</span>
                  {message.important && <span className="pill">Dôležité</span>}
                  <h3>{message.title || "Titulok správy"}</h3>
                  <p className="pre-wrap">{message.body}</p>
                  {message.link && (
                    <span className="muted">Odkaz: {message.link}</span>
                  )}
                </article>
              )}
              {message.id && message.status !== "sent" && (
                <button
                  className="button primary"
                  type="button"
                  disabled={busy || messageDirty}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Odoslať uloženú správu „${message.title}“ ${message.audience === "all" ? "všetkým aktuálnym členom" : "vybraným adresátom"}${message.push ? " aj s push upozornením" : ""}?`,
                      )
                    )
                      return;
                    try {
                      await run(
                        "sendMessage",
                        { id: message.id },
                        "Správa je publikovaná v aplikácii. Výsledok push odoslania nájdeš v záznamoch.",
                      );
                      setMessage(null);
                    } catch {}
                  }}
                >
                  <Send size={18} /> Odoslať uloženú správu
                </button>
              )}
              {messageDirty && message.id && message.status !== "sent" && (
                <p className="muted">Pred odoslaním ulož rozpracované zmeny.</p>
              )}
            </form>
          )}
        </div>
      )}
      {tab === "audit" && (
        <div className="stack">
          <div className="panel stack">
            <h3>Export údajov kurzu</h3>
            <p className="muted">
              CSV obsahuje kurzové údaje dostupné organizátorovi. Uchovávaj ho
              súkromne.
            </p>
            <label className="field">
              Čo chceš stiahnuť
              <select
                value={exportDataset}
                aria-describedby="course-export-description"
                onChange={(event) =>
                  setExportDataset(event.target.value as ExportDataset)
                }
              >
                {exportDatasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.label}
                  </option>
                ))}
              </select>
            </label>
            <p id="course-export-description" className="muted">
              {
                exportDatasets.find((dataset) => dataset.id === exportDataset)
                  ?.description
              }
            </p>
            <a
              className="button primary"
              href={appPath(`/api/export.csv?dataset=${exportDataset}`)}
              onClick={(e) => {
                if (visualFixture) e.preventDefault();
              }}
              aria-disabled={!!visualFixture}
              download
            >
              <Download size={18} /> Stiahnuť vybrané údaje (CSV)
            </a>
          </div>
          <div className="panel stack">
            <h3>Administrátorské zásahy</h3>
            {data.audit.length ? (
              <div className="audit-list">
                {data.audit.map((item, index) => (
                  <article className="card" key={item.id || index}>
                    <strong>{auditLabels[item.action] || item.action}</strong>
                    <p className="muted">
                      {item.createdAt || item.created_at || ""}
                      {item.actor ? " · " + item.actor : ""}
                    </p>
                    {item.detail && (
                      <p>
                        {typeof item.detail === "string"
                          ? item.detail
                          : JSON.stringify(item.detail)}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p>Zatiaľ bez záznamov.</p>
            )}
          </div>
          <div className="panel stack">
            <h3>Odosielanie upozornení</h3>
            <p className="muted">
              Prijatie poskytovateľom neznamená prečítanie ani garantované
              doručenie do telefónu.
            </p>
            {data.outbox.length ? (
              data.outbox.map((item, index) => (
                <article className="card" key={item.id || index}>
                  <strong>
                    {item.kind === "email" ? "Pozvánka" : "Upozornenie"}
                  </strong>
                  <p>
                    Stav:{" "}
                    {(
                      {
                        pending: "čaká na odoslanie",
                        sent: "prijaté poskytovateľom",
                        failed: "odoslanie zlyhalo",
                        delivered: "prijaté poskytovateľom",
                        skipped: "neodoslané",
                        processing: "spracúva sa",
                        cancelled: "zrušené",
                        unavailable: "nepripravené",
                      } as Record<string, string>
                    )[item.status] || item.status}
                    {item.attempts !== undefined
                      ? " · pokusy: " + item.attempts
                      : ""}
                  </p>
                  {(item.lastError || item.last_error) && (
                    <p className="muted">{item.lastError || item.last_error}</p>
                  )}
                </article>
              ))
            ) : (
              <p>Zatiaľ nebolo pripravené žiadne odoslanie.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
