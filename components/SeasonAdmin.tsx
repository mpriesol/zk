"use client";
import { useEffect, useState } from "react";
import { Eye, Plus, Upload } from "lucide-react";
import type {
  Course,
  Member,
  Motto,
  PersonalAwardDefinition,
  PersonalAwardGrant,
  RewardVisual,
} from "../lib/types";
import AwardArt, { AWARD_ICONS } from "./AwardArt";
import { uploadMedia } from "./media-api";

type Action = (
  action: string,
  data?: Record<string, unknown>,
  success?: string,
) => Promise<any>;
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Zmenu sa nepodarilo uložiť.";
const displayDate = (date: string) =>
  date
    ? new Date(date + "T12:00:00Z").toLocaleDateString("sk-SK", {
        timeZone: "UTC",
      })
    : "—";
const GEM_OPTIONS = [
  ["rhythm", "Pravidelnosť"],
  ["foot", "Pohyb"],
  ["support", "Sila"],
  ["variety", "Pestrosť"],
  ["equipment", "Výbava"],
] as const;

export function AwardVisualPicker({
  value,
  onChange,
  disabled = false,
  onUploadingChange,
}: {
  value?: RewardVisual;
  onChange: (visual: RewardVisual) => void;
  disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState(value?.kind || "icon");
  useEffect(() => {
    if (value?.kind) setKind(value.kind);
  }, [value?.kind]);
  const chosen: RewardVisual = value || { kind: "icon", value: "star" };
  return (
    <fieldset
      className="stack award-visual-picker"
      disabled={disabled || uploading}
    >
      <legend>Obrázok odmeny</legend>
      <div className="button-row">
        {(
          [
            ["gem", "Drahokam"],
            ["icon", "Predmet alebo symbol"],
            ["image", "Vlastný obrázok"],
          ] as const
        ).map(([key, label]) => (
          <button
            type="button"
            className={`button ${kind === key ? "primary" : "secondary"}`}
            aria-pressed={kind === key}
            key={key}
            onClick={() => {
              setKind(key);
              if (key !== "image")
                onChange({
                  kind: key,
                  value: key === "gem" ? "rhythm" : "star",
                  color: chosen.color,
                });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {kind !== "image" && (
        <div className="visual-picker-grid">
          {(kind === "gem" ? GEM_OPTIONS : AWARD_ICONS).map(([key, label]) => (
            <button
              type="button"
              key={key}
              title={label}
              className={`visual-option ${chosen.kind === kind && chosen.value === key ? "selected" : ""}`}
              aria-pressed={chosen.kind === kind && chosen.value === key}
              onClick={() =>
                onChange({ kind, value: key, color: chosen.color })
              }
            >
              <AwardArt
                visual={{ kind, value: key, color: chosen.color }}
                earned
                label={label}
              />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
      {kind === "image" && (
        <label className="field">
          <span>
            <Upload size={16} /> Nahrať obrázok
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setUploading(true);
              onUploadingChange?.(true);
              setError("");
              try {
                const media = await uploadMedia(file, "award");
                onChange({ kind: "image", value: media.id, url: media.url });
              } catch (error) {
                setError(message(error));
              } finally {
                setUploading(false);
                onUploadingChange?.(false);
              }
            }}
          />
          <small>
            JPEG, PNG alebo WebP do 10 MB. Obrázok sa uloží k odmene po uložení
            formulára.
          </small>
        </label>
      )}
      {kind !== "image" && (
        <label className="field">
          Farba
          <input
            type="color"
            value={chosen.color || "#3995ac"}
            onChange={(event) =>
              onChange({ ...chosen, color: event.target.value })
            }
          />
        </label>
      )}
      {uploading && <p role="status">Nahrávam obrázok…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <AwardArt visual={chosen} earned />
        <span className="small muted">Náhľad získanej odmeny</span>
      </div>
    </fieldset>
  );
}

export function PersonalAwardsAdmin({
  definitions,
  grants,
  members,
  today,
  course,
  busy,
  onAction,
}: {
  definitions: PersonalAwardDefinition[];
  grants: PersonalAwardGrant[];
  members: Member[];
  today: string;
  course: Course;
  busy: boolean;
  onAction: Action;
}) {
  const [definition, setDefinition] =
    useState<Partial<PersonalAwardDefinition> | null>(null);
  const [grant, setGrant] = useState({
    definitionId: "",
    memberId: "",
    date: today > course.endDate ? course.endDate : today,
    reason: "",
  });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const possible = definitions.filter(
    (item) => item.mode === "organizer" && item.status === "published",
  );
  const selected = definitions.find((item) => item.id === grant.definitionId);
  const alreadyGranted = grants.some(
    (item) =>
      item.definitionId === grant.definitionId &&
      item.memberId === grant.memberId,
  );
  return (
    <div className="stack">
      <section className="panel stack">
        <div className="section-heading">
          <h3>Osobitné ocenenia</h3>
          <button
            type="button"
            className="button primary"
            onClick={() => {
              setError("");
              setDefinition({
                name: "",
                description: "",
                visual: { kind: "icon", value: "star" },
                mode: "organizer",
                status: "draft",
              });
            }}
          >
            <Plus size={18} />
            Nové ocenenie
          </button>
        </div>
        <p>
          Návrhy môžeš upraviť a zverejniť. Pri praktickej úlohe si splnenie
          potvrdí účastník. Osobné poďakovanie udeľuje organizátor s konkrétnym
          dôvodom.
        </p>
        <div className="grid-two">
          {definitions.map((item) => (
            <article className="card stack" key={item.id}>
              <div className="section-heading">
                <AwardArt visual={item.visual} earned label={item.name} />
                <span className="pill">
                  {item.status === "draft" ? "Koncept" : "Zverejnené"}
                </span>
              </div>
              <h4>{item.name}</h4>
              <p className="small">{item.description}</p>
              <p className="small muted">
                {item.mode === "self"
                  ? "Potvrdí účastník"
                  : "Udeľuje organizátor"}
              </p>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setDefinition(structuredClone(item));
                  setError("");
                }}
              >
                Upraviť ocenenie
              </button>
            </article>
          ))}
        </div>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {definition && (
        <form
          className="panel stack"
          onSubmit={async (event) => {
            event.preventDefault();
            if (uploading) return;
            setError("");
            try {
              await onAction(
                "saveAwardDefinition",
                { ...definition },
                definition.status === "published"
                  ? "Ocenenie je zverejnené."
                  : "Koncept ocenenia je uložený.",
              );
              setDefinition(null);
            } catch (error) {
              setError(message(error));
            }
          }}
        >
          <h3>{definition.id ? "Upraviť ocenenie" : "Nové ocenenie"}</h3>
          <label className="field">
            Názov
            <input
              required
              maxLength={120}
              value={definition.name || ""}
              onChange={(event) =>
                setDefinition({ ...definition, name: event.target.value })
              }
            />
          </label>
          <label className="field">
            Za čo ho možno získať
            <textarea
              required
              rows={3}
              maxLength={5000}
              value={definition.description || ""}
              onChange={(event) =>
                setDefinition({
                  ...definition,
                  description: event.target.value,
                })
              }
            />
          </label>
          <div className="grid-two">
            <label className="field">
              Kto potvrdí splnenie
              <select
                value={definition.mode}
                onChange={(event) =>
                  setDefinition({
                    ...definition,
                    mode: event.target.value as PersonalAwardDefinition["mode"],
                  })
                }
              >
                <option value="self">
                  Účastník – dobrovoľná praktická úloha
                </option>
                <option value="organizer">Organizátor – osobné udelenie</option>
              </select>
            </label>
            <label className="field">
              Viditeľnosť
              <select
                value={definition.status}
                onChange={(event) =>
                  setDefinition({
                    ...definition,
                    status: event.target
                      .value as PersonalAwardDefinition["status"],
                  })
                }
              >
                <option value="draft">Koncept – vidí iba organizátor</option>
                <option value="published">Zverejnené</option>
              </select>
            </label>
          </div>
          <AwardVisualPicker
            value={definition.visual}
            onChange={(visual) => setDefinition({ ...definition, visual })}
            disabled={busy}
            onUploadingChange={setUploading}
          />
          <p className="small muted">
            Už udelené ocenenia si zachovajú názov, obrázok a podmienku zo dňa
            udelenia.
          </p>
          <div className="button-row">
            <button
              type="submit"
              className="button primary"
              disabled={busy || uploading}
            >
              {definition.status === "published"
                ? "Uložiť a zverejniť"
                : "Uložiť koncept"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={uploading}
              onClick={() => setDefinition(null)}
            >
              Zavrieť
            </button>
          </div>
        </form>
      )}
      <form
        className="panel stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            await onAction(
              "grantPersonalAward",
              { ...grant },
              "Osobitné ocenenie je udelené.",
            );
            setGrant({ ...grant, memberId: "", reason: "" });
          } catch (error) {
            setError(message(error));
          }
        }}
      >
        <h3>Udeliť osobné ocenenie</h3>
        {!possible.length && (
          <p className="muted">
            Najskôr zverejni aspoň jedno ocenenie s možnosťou „Organizátor –
            osobné udelenie“.
          </p>
        )}
        <label className="field">
          Ocenenie
          <select
            required
            value={grant.definitionId}
            onChange={(event) =>
              setGrant({ ...grant, definitionId: event.target.value })
            }
          >
            <option value="">Vyber ocenenie</option>
            {possible.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <div className="card button-row">
            <AwardArt visual={selected.visual} earned />
            <span>{selected.description}</span>
          </div>
        )}
        <div className="grid-two">
          <label className="field">
            Komu
            <select
              required
              value={grant.memberId}
              onChange={(event) =>
                setGrant({ ...grant, memberId: event.target.value })
              }
            >
              <option value="">Vyber účastníka</option>
              {members
                .filter((member) => member.active)
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.nickname}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Dátum udelenia
            <input
              type="date"
              required
              min={course.startDate}
              max={today < course.endDate ? today : course.endDate}
              value={grant.date}
              onChange={(event) =>
                setGrant({ ...grant, date: event.target.value })
              }
            />
          </label>
        </div>
        <label className="field">
          Konkrétny dôvod
          <textarea
            required
            maxLength={2000}
            rows={3}
            placeholder="Napríklad: Ďakujem za pomoc pri skúšobnom stavaní stanov."
            value={grant.reason}
            onChange={(event) =>
              setGrant({ ...grant, reason: event.target.value })
            }
          />
        </label>
        {alreadyGranted && (
          <p className="muted">
            Tento človek už má vybrané ocenenie. Históriu nájdeš nižšie.
          </p>
        )}
        <button
          className="button primary"
          disabled={busy || !possible.length || alreadyGranted}
        >
          Udeliť ocenenie
        </button>
      </form>
      <section className="panel stack">
        <h3>Udelené osobitné ocenenia</h3>
        {grants.length ? (
          grants.map((item) => (
            <article className="card stack" key={item.id}>
              <div className="section-heading">
                <div className="button-row">
                  <AwardArt visual={item.snapshot.visual} earned />
                  <div>
                    <strong>
                      {item.snapshot.name} ·{" "}
                      {members.find((member) => member.id === item.memberId)
                        ?.nickname || "Bývalý účastník"}
                    </strong>
                    <p className="small muted">
                      {displayDate(item.date)} ·{" "}
                      {item.source === "self"
                        ? "Potvrdené účastníkom"
                        : "Udelil organizátor"}
                    </p>
                  </div>
                </div>
              </div>
              <p>{item.reason || item.snapshot.description}</p>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Odobrať ocenenie „${item.snapshot.name}“ tomuto účastníkovi?`,
                    )
                  )
                    return;
                  try {
                    await onAction(
                      "revokePersonalAward",
                      { id: item.id },
                      "Ocenenie je odobraté.",
                    );
                  } catch (error) {
                    setError(message(error));
                  }
                }}
              >
                Odobrať udelenie
              </button>
            </article>
          ))
        ) : (
          <p className="muted">
            Zatiaľ nebolo udelené žiadne osobitné ocenenie.
          </p>
        )}
      </section>
    </div>
  );
}

interface PreparationPreview {
  previewId: string;
  expiresAt: string;
  confirmation: string;
  counts: Record<string, number>;
  preserveParticipants: boolean;
  proposedCourse: Course;
  backupAvailable?: boolean;
  backupRequired?: boolean;
  warning?: string;
}
const countLabels: Record<string, string> = {
  activities: "Aktivity",
  awards: "Základné odmeny",
  completions: "Potvrdenia praktických úloh",
  cold_entries: "Záznamy otužovania",
  personal_award_grants: "Udelené osobitné ocenenia",
  comments: "Komentáre",
  reactions: "Reakcie",
  recipients: "Doručenia správ a prečítania",
  messages: "Správy vrátane konceptov",
  outbox: "Úlohy odosielania správ",
  motto_daily: "História denných citátov",
  recalculation_previews: "Náhľady prepočtov",
  registration_invites: "Pozývacie odkazy",
  password_resets: "Žiadosti o obnovu hesla",
  audit: "História administrácie",
  membership_requests: "Žiadosti o členstvo",
  subscriptions: "Push odbery",
  media: "Fotografie a obrázky účastníkov",
  members: "Členstvá v tomto kurze",
};
const countMetadata = new Set([
  "removedMemberships",
  "removedAccounts",
  "preservedSharedAccounts",
  "retainedTemplateImages",
  "retainedAvatars",
]);

export default function SeasonAdmin({
  course,
  mottos,
  onAction,
  busy,
}: {
  course: Course;
  mottos: Motto[];
  onAction: Action;
  busy: boolean;
}) {
  const year =
    course.year ||
    Number((course.eventStartDate || course.endDate).slice(0, 4));
  const [settings, setSettings] = useState({
    coldUnlockDay: course.coldUnlockDay || 8,
    mottoStartDate: course.mottoStartDate || course.startDate,
  });
  const [draft, setDraft] = useState({
    year,
    name: course.name,
    startDate: course.startDate,
    endDate: course.endDate,
    eventStartDate: course.eventStartDate || "",
    eventEndDate: course.eventEndDate || "",
    preserveParticipants: false,
  });
  const [preview, setPreview] = useState<PreparationPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [motto, setMotto] = useState<Partial<Motto> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!preview) return;
    const timer = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, [preview]);
  const invalidate = (patch: Partial<typeof draft>) => {
    setDraft({ ...draft, ...patch });
    setPreview(null);
    setConfirmation("");
    setReviewed(false);
  };
  const expired = !!preview && Date.parse(preview.expiresAt) <= now;
  return (
    <div className="stack">
      <form
        className="panel stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            await onAction(
              "saveCourse",
              { ...course, ...settings },
              "Rozšírené nastavenia sú uložené.",
            );
          } catch (error) {
            setError(message(error));
          }
        }}
      >
        <h3>Rozšírené nastavenia prípravy</h3>
        <div className="grid-two">
          <label className="field">
            Otužovanie sprístupniť od dňa prípravy
            <input
              type="number"
              required
              min={8}
              max={365}
              value={settings.coldUnlockDay}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  coldUnlockDay: Number(event.target.value),
                })
              }
            />
            <small>
              Najskôr od 8. dňa. Dátum sa počíta od začiatku prípravy.
            </small>
          </label>
          <label className="field">
            Denné citáty začať zobrazovať od
            <input
              type="date"
              required
              value={settings.mottoStartDate}
              onChange={(event) =>
                setSettings({ ...settings, mottoStartDate: event.target.value })
              }
            />
          </label>
        </div>
        <button className="button primary" disabled={busy}>
          Uložiť rozšírené nastavenia
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">RUČNE VYBRANÉ SLOVÁ</p>
            <h3>Knižnica denných citátov</h3>
          </div>
          <button
            type="button"
            className="button primary"
            onClick={() =>
              setMotto({
                text: "",
                author: "",
                sourceUrl: "",
                originalText: "",
                sourceWork: "",
                translation: false,
                active: true,
                order: Math.max(0, ...mottos.map((item) => item.order)) + 1,
              })
            }
          >
            <Plus size={17} />
            Nový citát
          </button>
        </div>
        <p>
          Uveď skutočného autora a odkaz na zdroj. Pri vlastnom slovenskom
          preklade ponechaj aj originál. Citáty sa striedajú podľa poradia; už
          zobrazený denný citát zostáva pre daný deň rovnaký.
        </p>
        <div className="stack">
          {[...mottos]
            .sort((a, b) => a.order - b.order)
            .map((item) => (
              <article className="card stack" key={item.id}>
                <div className="section-heading">
                  <span className="pill">
                    {item.active ? "Aktívny" : "Pozastavený"} · poradie{" "}
                    {item.order}
                  </span>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setMotto({ ...item })}
                  >
                    Upraviť
                  </button>
                </div>
                <blockquote className="motto-preview">
                  <p>„{item.text}“</p>
                  <footer>
                    {item.author}
                    {item.translation ? " · slovenský preklad" : ""}
                  </footer>
                </blockquote>
                {item.sourceWork && (
                  <p className="small muted">{item.sourceWork}</p>
                )}
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Zdroj citátu
                </a>
                {(item.dateFrom || item.dateTo) && (
                  <p className="small muted">
                    Zobraziť{" "}
                    {item.dateFrom
                      ? `od ${displayDate(item.dateFrom)}`
                      : "bez začiatku"}
                    {item.dateTo
                      ? ` do ${displayDate(item.dateTo)}`
                      : " bez koncového dátumu"}
                  </p>
                )}
              </article>
            ))}
        </div>
      </section>
      {motto && (
        <form
          className="panel stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            try {
              await onAction("saveMotto", { ...motto }, "Citát je uložený.");
              setMotto(null);
            } catch (error) {
              setError(message(error));
            }
          }}
        >
          <h3>{motto.id ? "Upraviť citát" : "Nový citát"}</h3>
          <label className="field">
            Text pre účastníka
            <textarea
              required
              maxLength={500}
              rows={3}
              value={motto.text || ""}
              onChange={(event) =>
                setMotto({ ...motto, text: event.target.value })
              }
            />
          </label>
          <div className="grid-two">
            <label className="field">
              Autor
              <input
                required
                maxLength={150}
                value={motto.author || ""}
                onChange={(event) =>
                  setMotto({ ...motto, author: event.target.value })
                }
              />
            </label>
            <label className="field">
              Poradie
              <input
                type="number"
                required
                min={0}
                max={10000}
                value={motto.order ?? 0}
                onChange={(event) =>
                  setMotto({ ...motto, order: Number(event.target.value) })
                }
              />
            </label>
          </div>
          <label className="field">
            Odkaz na zdroj
            <input
              type="url"
              required
              placeholder="https://…"
              value={motto.sourceUrl || ""}
              onChange={(event) =>
                setMotto({ ...motto, sourceUrl: event.target.value })
              }
            />
          </label>
          <label className="field">
            Dielo a miesto v ňom
            <input
              maxLength={300}
              value={motto.sourceWork || ""}
              onChange={(event) =>
                setMotto({ ...motto, sourceWork: event.target.value })
              }
            />
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={!!motto.translation}
              onChange={(event) =>
                setMotto({ ...motto, translation: event.target.checked })
              }
            />
            Text je vlastný slovenský preklad
          </label>
          <label className="field">
            Originálne znenie
            <textarea
              rows={2}
              maxLength={1000}
              value={motto.originalText || ""}
              onChange={(event) =>
                setMotto({ ...motto, originalText: event.target.value })
              }
            />
          </label>
          <div className="grid-two">
            <label className="field">
              Zobrazovať od (nepovinné)
              <input
                type="date"
                value={motto.dateFrom || ""}
                onChange={(event) =>
                  setMotto({ ...motto, dateFrom: event.target.value })
                }
              />
            </label>
            <label className="field">
              Zobrazovať do (nepovinné)
              <input
                type="date"
                min={motto.dateFrom}
                value={motto.dateTo || ""}
                onChange={(event) =>
                  setMotto({ ...motto, dateTo: event.target.value })
                }
              />
            </label>
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={motto.active ?? true}
              onChange={(event) =>
                setMotto({ ...motto, active: event.target.checked })
              }
            />
            Citát je aktívny
          </label>
          <article className="card stack">
            <p className="eyebrow">NÁHĽAD NA DOMOVE</p>
            <blockquote className="motto-preview">
              <p>„{motto.text || "Text citátu"}“</p>
              <footer>
                {motto.author || "Autor"}
                {motto.translation ? " · slovenský preklad" : ""}
              </footer>
            </blockquote>
          </article>
          <div className="button-row">
            <button className="button primary" disabled={busy}>
              Uložiť citát
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setMotto(null)}
            >
              Zavrieť
            </button>
            {motto.id && (
              <button
                type="button"
                className="button danger"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm("Odstrániť tento citát z knižnice?"))
                    return;
                  try {
                    await onAction(
                      "deleteMotto",
                      { id: motto.id },
                      "Citát je odstránený.",
                    );
                    setMotto(null);
                  } catch (error) {
                    setError(message(error));
                  }
                }}
              >
                Odstrániť citát
              </button>
            )}
          </div>
        </form>
      )}
      <section className="panel stack preparation-start">
        <p className="eyebrow">NOVÁ SKUPINA ALEBO NOVÝ ROČNÍK</p>
        <h3>Spustiť prípravu na zimný kurz</h3>
        <p>
          Nastav ročník a dátumy. Najskôr sa pripraví prehľad presných údajov,
          ktoré sa odstránia. Samotný náhľad súčasné zápisy nemaže.
        </p>
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            setPreview(null);
            setConfirmation("");
            setReviewed(false);
            try {
              const result = await onAction(
                "previewPreparation",
                { ...draft },
                "Náhľad je pripravený. Súčasné údaje sa nezmenili.",
              );
              setPreview(result);
              setNow(Date.now());
            } catch (error) {
              setError(message(error));
            }
          }}
        >
          <div className="grid-two">
            <label className="field">
              Ročník hlavnej udalosti
              <input
                type="number"
                min={2020}
                max={2200}
                required
                value={draft.year}
                onChange={(event) =>
                  invalidate({ year: Number(event.target.value) })
                }
              />
            </label>
            <label className="field">
              Názov prípravy
              <input
                required
                maxLength={120}
                value={draft.name}
                onChange={(event) => invalidate({ name: event.target.value })}
              />
            </label>
          </div>
          <div className="grid-two">
            <label className="field">
              Začiatok prípravy
              <input
                type="date"
                required
                value={draft.startDate}
                onChange={(event) =>
                  invalidate({ startDate: event.target.value })
                }
              />
            </label>
            <label className="field">
              Koniec prípravy – vrátane
              <input
                type="date"
                required
                min={draft.startDate}
                value={draft.endDate}
                onChange={(event) =>
                  invalidate({ endDate: event.target.value })
                }
              />
            </label>
          </div>
          <div className="grid-two">
            <label className="field">
              Začiatok hlavnej časti kurzu
              <input
                type="date"
                required
                value={draft.eventStartDate}
                onChange={(event) =>
                  invalidate({ eventStartDate: event.target.value })
                }
              />
            </label>
            <label className="field">
              Koniec hlavnej časti kurzu
              <input
                type="date"
                required
                min={draft.eventStartDate}
                value={draft.eventEndDate}
                onChange={(event) =>
                  invalidate({ eventEndDate: event.target.value })
                }
              />
            </label>
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={draft.preserveParticipants}
              onChange={(event) =>
                invalidate({ preserveParticipants: event.target.checked })
              }
            />
            Zachovať účastníkov a ich prihlásenie – pokračujeme s rovnakou
            skupinou
          </label>
          <p className="small muted">
            {draft.preserveParticipants
              ? "Účastníci zostanú, ich doterajšie zápisy a udelené odmeny sa odstránia."
              : "Predvolene sa odstránia aj doterajšie členstvá a účty používané iba v tomto kurze."}{" "}
            Tvoje organizátorské prihlásenie, účty potrebné pre iné kurzy a
            konfigurácia zostanú zachované.
          </p>
          <button className="button secondary" disabled={busy}>
            <Eye size={18} />
            Zobraziť presný náhľad spustenia
          </button>
        </form>
        {preview && (
          <div className="card stack preparation-impact" aria-live="polite">
            <h4>Náhľad: {preview.proposedCourse.name}</h4>
            <p>
              Príprava {displayDate(preview.proposedCourse.startDate)} –{" "}
              {displayDate(preview.proposedCourse.endDate)}. Hlavná časť kurzu{" "}
              {displayDate(preview.proposedCourse.eventStartDate || "")} –{" "}
              {displayDate(preview.proposedCourse.eventEndDate || "")}.
            </p>
            <h4>Odstránia sa tieto údaje</h4>
            <dl>
              {Object.entries(preview.counts)
                .filter(([key]) => !countMetadata.has(key))
                .map(([key, count]) => (
                  <div className="section-heading" key={key}>
                    <dt>{countLabels[key] || key}</dt>
                    <dd>
                      <strong>{count}</strong>
                    </dd>
                  </div>
                ))}
            </dl>
            <p>
              <strong>
                Účty na odstránenie: {preview.counts.removedAccounts || 0}.
              </strong>{" "}
              Členstvá na odstránenie: {preview.counts.removedMemberships || 0}.
            </p>
            <p className="small">
              Zachované spoločné účty iných kurzov:{" "}
              {preview.counts.preservedSharedAccounts || 0}. Zachované obrázky
              šablón: {preview.counts.retainedTemplateImages || 0}. Zachované
              avatary: {preview.counts.retainedAvatars || 0}.
            </p>
            <p className="error">{preview.warning}</p>
            <p className="small muted">
              Pred zmenou sa musí úspešne dokončiť záloha databázy a obrázkov.
              Ak sa údaje od náhľadu zmenia, server vyžiada nový náhľad.
            </p>
            {preview.backupAvailable === false && (
              <p className="error" role="alert">
                Spustenie je zablokované, kým nebude pripravená záloha databázy
                a obrázkov.
              </p>
            )}
            {expired ? (
              <p className="error" role="alert">
                Náhľad vypršal. Zobraz nový náhľad spustenia.
              </p>
            ) : (
              <p className="small muted">
                Náhľad platí do{" "}
                {new Date(preview.expiresAt).toLocaleTimeString("sk-SK")}.
              </p>
            )}
            <label className="check-field">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              Skontroloval/a som údaje na odstránenie a nastavenie účastníkov.
            </label>
            <label className="field">
              Na potvrdenie prepíš presne: {preview.confirmation}
              <input
                autoComplete="off"
                spellCheck={false}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="button danger"
              disabled={
                busy ||
                expired ||
                !reviewed ||
                confirmation !== preview.confirmation ||
                preview.backupAvailable === false
              }
              onClick={async () => {
                setError("");
                try {
                  await onAction(
                    "applyPreparation",
                    { previewId: preview.previewId, confirmation },
                    "Príprava je spustená podľa skontrolovaného náhľadu.",
                  );
                  setPreview(null);
                  setConfirmation("");
                  setReviewed(false);
                } catch (error) {
                  setError(message(error));
                  setPreview(null);
                  setConfirmation("");
                  setReviewed(false);
                }
              }}
            >
              Spustiť prípravu na zimný kurz
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
