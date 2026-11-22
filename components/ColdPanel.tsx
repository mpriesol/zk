"use client";
import { useId, useState } from "react";
import { Droplet, Snowflake, Pencil, Trash2 } from "lucide-react";
import type { AppState, ColdEntry } from "../lib/types";
import { Modal, fmt, type Action } from "./ui";

export default function ColdPanel({
  state,
  onAction,
  compact = false,
}: {
  state: AppState;
  onAction: Action;
  compact?: boolean;
}) {
  const cold = state.cold;
  const id = useId().replaceAll(":", "");
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(state.today);
  const [kind, setKind] = useState<"shower" | "outdoor">("shower");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!cold) return null;
  const peopleToday =
    cold.daily.find((d) => d.date === state.today)?.people || 0;
  const todayEntry = cold.entries.find((e) => e.date === state.today);
  const coverage = cold.activeCount
    ? Math.min(1, peopleToday / cold.activeCount)
    : 0;
  const existing = cold.entries.find((e) => e.date === date);
  function edit(entry?: ColdEntry) {
    setDate(
      entry?.date ||
        (state.today > cold!.endDate ? cold!.endDate : state.today),
    );
    setKind(entry?.kind || "shower");
    setNote(entry?.note || "");
    setError("");
    setOpen(true);
  }
  return (
    <section className={`cold-panel ${compact ? "compact" : ""}`}>
      <div className="section-head">
        <div>
          <p className="eyebrow">NAŠA ZIMNÁ KRAJINA</p>
          <h2>Vločka po vločke</h2>
        </div>
        <Snowflake size={24} />
      </div>
      <p className="cold-subtitle">Studená sprcha alebo otužovanie</p>
      <div
        className="winter-landscape"
        role="img"
        aria-label={`Dnes otužovanie zaznamenalo ${peopleToday} z ${cold.activeCount} ľudí. Každá vločka predstavuje jedného človeka.`}
      >
        <svg viewBox="0 0 440 190" aria-hidden="true">
          <defs>
            <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="#dcecf4" />
              <stop offset="1" stopColor="#f8fbfc" />
            </linearGradient>
            <linearGradient id={`lake-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="#9fbfcb" />
              <stop offset="1" stopColor="#c7dde5" />
            </linearGradient>
            <clipPath id={`ice-${id}`}>
              <ellipse cx="224" cy="158" rx="150" ry="24" />
            </clipPath>
            <g
              id={`flake-${id}`}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M0-6v12M-5.2-3l10.4 6M-5.2 3l10.4-6M-2-4l2 2 2-2M-2 4l2-2 2 2" />
            </g>
          </defs>
          <rect width="440" height="190" rx="12" fill={`url(#sky-${id})`} />
          <circle cx="351" cy="33" r="15" fill="#fff" opacity=".8" />
          <path d="M-30 144 87 33l88 90L267 24l190 133" fill="#b8ced4" />
          <path
            d="m51 67 36-34 36 37-23-7-13 11-13-12zm175-2 41-41 51 36-29-3-23 16-20-16z"
            fill="#f5fafb"
          />
          <path d="M-10 143 160 65l102 79 75-65 115 67v44H0" fill="#d7e5e7" />
          <path d="M0 144q65-20 130 0t147-4 163 9v41H0" fill="#f6faf9" />
          <ellipse
            cx="224"
            cy="158"
            rx="150"
            ry="24"
            fill={`url(#lake-${id})`}
          />
          <g clipPath={`url(#ice-${id})`}>
            <rect
              x="74"
              y="130"
              width={300 * coverage}
              height="54"
              fill="#effaff"
              opacity=".9"
            />
            <path
              d="m120 155 50-5 38 13 29-11 29 8 43-9"
              fill="none"
              stroke="#f7ffff"
              strokeWidth="2"
            />
          </g>
          <g fill="#6e9396">
            <path d="m32 103-21 40h42zm0 18-29 36h58zm362-24-19 42h38zm0 21-28 36h56z" />
            <path d="M31 150h3v18h-3zm362-4h3v16h-3" />
          </g>
          <g color="#6a98ae">
            {Array.from({ length: Math.min(peopleToday, 100) }, (_, i) => (
              <use
                key={i}
                href={`#flake-${id}`}
                x={30 + ((i * 61) % 380)}
                y={22 + ((i * 29) % 103)}
              />
            ))}
          </g>
        </svg>
      </div>
      <div className="cold-today">
        <strong>
          {peopleToday}
          <span> / {cold.activeCount}</span>
        </strong>
        <span>ľudí dnes pridalo vločku</span>
      </div>
      <p className="small muted">
        Každý človek pridá najviac jednu vločku denne. Spolu už {cold.entryDays}{" "}
        dní otužovania od {cold.people} ľudí.
      </p>
      {cold.canRecord && (
        <button
          className={`button ${todayEntry ? "secondary" : "cold-button"} full-width`}
          onClick={() => edit(todayEntry)}
        >
          {todayEntry ? <Snowflake size={17} /> : <Droplet size={17} />}
          {todayEntry
            ? "Dnešná vločka je pridaná"
            : state.today > cold.endDate
              ? "Doplniť minulý deň"
              : "Zaznamenať otužovanie"}
        </button>
      )}
      {!cold.canRecord && (
        <p className="small muted">
          Záznamy výzvy: {fmt(cold.availableFrom)} – {fmt(cold.endDate)}.
        </p>
      )}
      {!compact && cold.entries.length > 0 && (
        <details className="cold-history">
          <summary>Moje vločky · {cold.entries.length}</summary>
          {[...cold.entries]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((entry) => (
              <div key={entry.id} className="cold-entry">
                <Snowflake size={15} />
                <span>
                  {fmt(entry.date)} ·{" "}
                  {entry.kind === "shower" ? "studená sprcha" : "otužovanie"}
                </span>
                <button
                  className="icon-button"
                  aria-label={`Upraviť otužovanie ${fmt(entry.date)}`}
                  onClick={() => edit(entry)}
                >
                  <Pencil size={15} />
                </button>
              </div>
            ))}
        </details>
      )}
      {open && (
        <Modal
          title="Tvoja vločka do zimnej krajiny"
          onClose={() => !busy && setOpen(false)}
        >
          <form
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              try {
                await onAction("saveColdEntry", { date, kind, note });
                setOpen(false);
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Záznam sa nepodarilo uložiť.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              Stačí zaznamenať deň. Otužovanie má vlastný prehľad a nepridáva
              tréningové minúty.
            </p>
            <label className="field">
              Dátum
              <input
                type="date"
                required
                value={date}
                min={cold.availableFrom}
                max={state.today < cold.endDate ? state.today : cold.endDate}
                onChange={(e) => {
                  const found = cold.entries.find(
                    (entry) => entry.date === e.target.value,
                  );
                  setDate(e.target.value);
                  setKind(found?.kind || "shower");
                  setNote(found?.note || "");
                }}
              />
            </label>
            <label className="field">
              Ako to bolo?
              <select
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as "shower" | "outdoor")
                }
              >
                <option value="shower">Studená sprcha</option>
                <option value="outdoor">Otužovanie</option>
              </select>
            </label>
            <label className="field">
              Poznámka pre seba a organizátorov · nepovinná
              <textarea
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            {existing && (
              <p className="info-note">
                Tento deň už má vločku. Uložením upravíš pôvodný záznam.
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              {existing && (
                <button
                  type="button"
                  className="button danger"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !window.confirm(`Odstrániť tvoju vločku z ${fmt(date)}?`)
                    )
                      return;
                    setBusy(true);
                    setError("");
                    try {
                      await onAction("deleteColdEntry", { id: existing.id });
                      setOpen(false);
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Zmenu sa nepodarilo uložiť.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Trash2 size={16} />
                  Odstrániť
                </button>
              )}
              <button className="button cold-button" disabled={busy}>
                <Snowflake size={17} />
                {busy
                  ? "Ukladám…"
                  : existing
                    ? "Uložiť zmenu"
                    : "Pridať vločku"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
