"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Check,
  Copy,
  KeyRound,
  Link,
  RefreshCw,
  UserCheck,
  X,
} from "lucide-react";
import { appPath } from "../lib/paths";

type PendingAccount = {
  id: string;
  userId: string;
  username: string;
  nickname: string;
  createdAt: string;
};
type CourseInvite = {
  id: string;
  label: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revoked: boolean;
};
type PasswordMember = {
  id: string;
  username: string;
  nickname: string;
  active: boolean;
};
type AccountAdminData = {
  pending: PendingAccount[];
  invites: CourseInvite[];
  passwordMembers: PasswordMember[];
  passwordEnabled: boolean;
  emailOtpEnabled: boolean;
};
type IssuedLink = {
  kind: "invite" | "reset";
  url: string;
  expiresAt: string;
  label: string;
};
function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Zmenu sa nepodarilo uložiť.";
}
const timestamp = (value: string) =>
  new Date(value).toLocaleString("sk-SK", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function AccountAdmin({
  disabled = false,
  onChanged,
  onEmailAvailability,
}: {
  disabled?: boolean;
  onChanged?: () => Promise<void> | void;
  onEmailAvailability: (enabled: boolean) => void;
}) {
  const [data, setData] = useState<AccountAdminData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [maxUses, setMaxUses] = useState(30);
  const [resetMemberId, setResetMemberId] = useState("");
  const issuedInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (issued) issuedInput.current?.focus();
  }, [issued]);
  const load = useCallback(async () => {
    if (disabled) return;
    const response = await fetch(appPath("/api/registration/admin"), {
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error || "Správu účtov sa nepodarilo načítať.");
    setData(body as AccountAdminData);
    if (body.passwordEnabled === false) setIssued(null);
    onEmailAvailability(body.emailOtpEnabled === true);
  }, [disabled, onEmailAvailability]);
  useEffect(() => {
    void load().catch((e) => setError(errorText(e)));
  }, [load]);

  async function run(
    action: string,
    payload: Record<string, unknown>,
    success: string,
    link?: { kind: "invite" | "reset"; label: string },
  ) {
    if (disabled || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(appPath("/api/registration/admin"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Zmenu sa nepodarilo uložiť.");
      if (link) {
        if (typeof body.url !== "string" || typeof body.expiresAt !== "string")
          throw new Error(
            "Server nevrátil odkaz. Pred opakovaním obnov prehľad.",
          );
        setIssued({ ...link, url: body.url, expiresAt: body.expiresAt });
        setCopied(false);
      }
      setNotice(success);
      try {
        await load();
        await onChanged?.();
      } catch {
        setError(
          "Zmena je uložená, ale prehľad sa nepodarilo obnoviť. Obnov ho tlačidlom nižšie.",
        );
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function createInvite(event: FormEvent) {
    event.preventDefault();
    await run(
      "createInvite",
      { label: label.trim(), expiresInDays, maxUses },
      "Pozývací odkaz je pripravený. Pošli ho iba účastníkom tohto kurzu.",
      { kind: "invite", label: label.trim() || "Pozvánka do kurzu" },
    );
  }

  if (disabled)
    return (
      <section className="panel">
        <h3>Registrácie a pozývacie odkazy</h3>
        <p className="muted">
          V izolovanom vizuálnom teste je správa účtov vypnutá.
        </p>
      </section>
    );

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="section-head">
          <div>
            <p className="eyebrow">PRÍSTUP DO KURZU</p>
            <h3>Registrácie a pozvánky</h3>
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setError("");
              void load().catch((e) => setError(errorText(e)));
            }}
          >
            <RefreshCw size={16} /> Obnoviť
          </button>
        </div>
        <p className="muted">
          {data?.passwordEnabled === false
            ? "V tomto kurze je zapnuté prihlásenie e-mailovým kódom. Účastníkov môžeš pozvať formulárom nižšie."
            : "Na vytvorenie účtu stačí používateľské meno a heslo. S platným pozývacím odkazom účastník vstúpi rovno do kurzu; ostatné registrácie čakajú na tvoje schválenie."}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="info-note" role="status">
            {notice}
          </p>
        )}
        {!data && !error && <p role="status">Načítavam registrácie…</p>}
        {issued && (
          <section
            className="card stack"
            aria-label={
              issued.kind === "reset"
                ? "Odkaz na nové heslo"
                : "Nový pozývací odkaz"
            }
          >
            <h4>
              {issued.kind === "reset"
                ? "Odkaz na nové heslo"
                : "Pozývací odkaz"}{" "}
              · {issued.label}
            </h4>
            <label className="field">
              Odkaz na skopírovanie
              <input
                ref={issuedInput}
                type="text"
                readOnly
                value={issued.url}
                onFocus={(event) => event.currentTarget.select()}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <p className="small muted">
              Platí do {timestamp(issued.expiresAt)}.{" "}
              {issued.kind === "reset"
                ? "Je jednorazový. Odovzdaj ho iba tomuto človeku po overení, že o obnovu požiadal. Po nastavení hesla sa jeho účet odhlási zo všetkých zariadení."
                : "Každý s týmto odkazom môže vytvoriť účet v kurze až do vyčerpania limitu alebo zrušenia pozvánky."}
            </p>
            <p className="small muted">
              Po zatvorení tento odkaz znovu nezobrazíme.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="button primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(issued.url);
                    setCopied(true);
                  } catch {
                    setError(
                      "Automatické kopírovanie nie je dostupné. Označ odkaz v poli a skopíruj ho ručne.",
                    );
                  }
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "Skopírované" : "Skopírovať odkaz"}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setIssued(null);
                  setCopied(false);
                }}
              >
                Zavrieť odkaz
              </button>
            </div>
          </section>
        )}
      </section>
      {data && data.passwordEnabled !== false && (
        <>
          <section className="panel stack">
            <h3>
              Čakajú na schválenie{" "}
              <span className="muted">({data.pending.length})</span>
            </h3>
            {data.pending.length === 0 ? (
              <p className="muted">Žiadna registrácia nečaká na schválenie.</p>
            ) : (
              data.pending.map((person) => (
                <article className="admin-member card" key={person.id}>
                  <div>
                    <strong>{person.nickname}</strong>
                    <p className="muted">
                      Používateľské meno: {person.username} ·{" "}
                      {timestamp(person.createdAt)}
                    </p>
                  </div>
                  <div className="button-row">
                    <button
                      type="button"
                      className="button primary"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Prijať ${person.nickname} do kurzu? Získa prístup k zápisom a správam skupiny.`,
                          )
                        )
                          void run(
                            "approve",
                            { id: person.id },
                            `${person.nickname} má prístup do kurzu.`,
                          );
                      }}
                    >
                      <UserCheck size={16} /> Schváliť
                    </button>
                    <button
                      type="button"
                      className="button danger"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Odmietnuť registráciu ${person.nickname}? Prístup do kurzu nedostane.`,
                          )
                        )
                          void run(
                            "reject",
                            { id: person.id },
                            "Registrácia bola odmietnutá.",
                          );
                      }}
                    >
                      <X size={16} /> Odmietnuť
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>
          <form className="panel stack" onSubmit={createInvite}>
            <h3>Nový pozývací odkaz</h3>
            <label className="field">
              Označenie pre teba
              <input
                value={label}
                maxLength={80}
                placeholder="Napríklad účastníci ročníka"
                onChange={(event) => setLabel(event.target.value)}
                disabled={busy}
              />
            </label>
            <div className="grid-two">
              <label className="field">
                Platnosť v dňoch
                <input
                  type="number"
                  min={1}
                  max={30}
                  required
                  value={expiresInDays}
                  onChange={(event) =>
                    setExpiresInDays(Number(event.target.value))
                  }
                  disabled={busy}
                />
              </label>
              <label className="field">
                Najviac nových účtov
                <input
                  type="number"
                  min={1}
                  max={100}
                  required
                  value={maxUses}
                  onChange={(event) => setMaxUses(Number(event.target.value))}
                  disabled={busy}
                />
              </label>
            </div>
            <button className="button primary" disabled={busy}>
              <Link size={16} /> Vytvoriť pozývací odkaz
            </button>
          </form>
          <section className="panel stack">
            <h3>Vydané pozvánky</h3>
            {data.invites.length === 0 ? (
              <p className="muted">
                Zatiaľ si nevytvoril žiadny pozývací odkaz.
              </p>
            ) : (
              data.invites.map((invite) => {
                const expired = Date.parse(invite.expiresAt) <= Date.now();
                const full = invite.uses >= invite.maxUses;
                return (
                  <article className="admin-member card" key={invite.id}>
                    <div>
                      <strong>{invite.label || "Pozvánka do kurzu"}</strong>
                      <p className="muted">
                        {invite.uses}/{invite.maxUses} registrácií · do{" "}
                        {timestamp(invite.expiresAt)}
                      </p>
                      <span className="small">
                        {invite.revoked
                          ? "Zrušená"
                          : expired
                            ? "Platnosť vypršala"
                            : full
                              ? "Limit vyčerpaný"
                              : "Aktívna"}
                      </span>
                    </div>
                    {!invite.revoked && !expired && !full && (
                      <button
                        type="button"
                        className="button danger"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Zrušiť pozvánku „${invite.label || "Pozvánka do kurzu"}“? Existujúci členovia zostanú v kurze, cez tento odkaz už nový účet nevstúpi.`,
                            )
                          )
                            void run(
                              "revokeInvite",
                              { id: invite.id },
                              "Pozývací odkaz je zrušený.",
                            );
                        }}
                      >
                        Zrušiť odkaz
                      </button>
                    )}
                  </article>
                );
              })
            )}
          </section>
          <form
            className="panel stack"
            onSubmit={async (event) => {
              event.preventDefault();
              const member = data.passwordMembers.find(
                (person) => person.id === resetMemberId && person.active,
              );
              if (!member) return;
              if (
                window.confirm(
                  `Vytvoriť jednorazový odkaz na nové heslo pre ${member.nickname}? Odovzdaj ho iba tomuto človeku. Použitie odkazu ukončí jeho doterajšie prihlásenia.`,
                )
              )
                await run(
                  "createReset",
                  { memberId: member.id },
                  "Odkaz na nové heslo je pripravený.",
                  { kind: "reset", label: member.nickname },
                );
            }}
          >
            <h3>Pomoc so zabudnutým heslom</h3>
            <p className="muted">
              Pôvodné heslo sa nezobrazuje. Po overení človeka mu môžeš odovzdať
              jednorazový odkaz, cez ktorý si zvolí nové.
            </p>
            <label className="field">
              Účet
              <select
                required
                value={resetMemberId}
                onChange={(event) => setResetMemberId(event.target.value)}
                disabled={busy}
              >
                <option value="">Vyber účastníka</option>
                {data.passwordMembers
                  .filter((member) => member.active)
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.nickname} · {member.username}
                    </option>
                  ))}
              </select>
            </label>
            <button
              className="button secondary"
              disabled={busy || !resetMemberId}
            >
              <KeyRound size={16} /> Vytvoriť odkaz na nové heslo
            </button>
          </form>
        </>
      )}
    </div>
  );
}
