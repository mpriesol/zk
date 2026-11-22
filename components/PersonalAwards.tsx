"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import type { AppState, PersonalAwardDefinition } from "../lib/types";
import { fmt, Modal, type Action } from "./ui";
import AwardArt from "./AwardArt";

export default function PersonalAwards({
  state,
  onAction,
}: {
  state: AppState;
  onAction: Action;
}) {
  const [selected, setSelected] = useState<PersonalAwardDefinition | null>(
    null,
  );
  const [date, setDate] = useState(state.today),
    [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const own = (state.personalAwards || []).filter(
    (a) => a.memberId === state.me.id,
  );
  const definitions = state.personalAwardDefinitions || [];
  if (!definitions.length && !own.length) return null;
  return (
    <section className="personal-awards-section">
      <h2 className="cz-section-title">Odznaky a osobné ocenenia</h2>
      <div className="reward-grid">
        {definitions.map((definition) => {
          const grants = own.filter((a) => a.definitionId === definition.id);
          const mine = grants.find((a) => a.source === "self");
          return (
            <article
              className={`reward-card ${grants.length ? "complete" : ""}`}
              key={definition.id}
            >
              <div className="reward-title">
                <AwardArt
                  visual={definition.visual}
                  rewardKey={definition.id}
                  earned={!!grants.length}
                />
                <div>
                  <span className="cz-kicker">
                    {definition.mode === "self"
                      ? "Praktická výzva"
                      : "Udeľuje organizátor"}
                  </span>
                  <h3>{definition.name}</h3>
                </div>
                {grants.length > 0 && (
                  <span className="pill success">
                    <Check size={12} /> Získané
                    {grants.length > 1 ? ` ×${grants.length}` : ""}
                  </span>
                )}
              </div>
              <p>{definition.description}</p>
              {grants.map((grant) => (
                <p className="small muted" key={grant.id}>
                  {fmt(grant.date)}
                  {grant.reason ? ` · ${grant.reason}` : ""}
                </p>
              ))}
              {definition.mode === "self" && (
                <button
                  className="button secondary"
                  onClick={() => {
                    setSelected(definition);
                    setDate(mine?.date || state.today);
                    setReason(mine?.reason || "");
                    setError("");
                  }}
                >
                  {mine ? "Upraviť moje potvrdenie" : "Potvrdiť splnenie"}
                </button>
              )}
            </article>
          );
        })}
      </div>
      {own.some((a) => !definitions.some((d) => d.id === a.definitionId)) && (
        <div className="reward-grid">
          {own
            .filter((a) => !definitions.some((d) => d.id === a.definitionId))
            .map((grant) => (
              <article className="reward-card complete" key={grant.id}>
                <div className="reward-title">
                  <AwardArt
                    visual={grant.snapshot.visual}
                    rewardKey={grant.definitionId}
                    earned
                  />
                  <h3>{grant.snapshot.name}</h3>
                </div>
                <p>{grant.reason || grant.snapshot.description}</p>
                <small>{fmt(grant.date)}</small>
              </article>
            ))}
        </div>
      )}
      {selected && (
        <Modal title={selected.name} onClose={() => !busy && setSelected(null)}>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await onAction("confirmPersonalAward", {
                  definitionId: selected.id,
                  date,
                  reason,
                  completed: true,
                });
                setSelected(null);
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "Potvrdenie sa nepodarilo uložiť.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>{selected.description}</p>
            <label className="field">
              Deň splnenia
              <input
                type="date"
                value={date}
                min={state.course.startDate}
                max={
                  state.today < state.course.endDate
                    ? state.today
                    : state.course.endDate
                }
                required
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="field">
              Malý príbeh · nepovinný
              <textarea
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              {own.some(
                (a) => a.definitionId === selected.id && a.source === "self",
              ) && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await onAction("confirmPersonalAward", {
                        definitionId: selected.id,
                        completed: false,
                      });
                      setSelected(null);
                    } catch (error) {
                      setError(
                        error instanceof Error
                          ? error.message
                          : "Zmenu sa nepodarilo uložiť.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Zrušiť moje potvrdenie
                </button>
              )}
              <button className="button primary" disabled={busy}>
                {busy ? "Ukladám…" : "Potvrdzujem splnenie"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
