"use client";
import { useState } from "react";
import { newRequestId } from "./request-id";
import type { Activity, AppState } from "../lib/types";
import { Modal, type Action } from "./ui";
export default function ActivityForm({
  state,
  activity,
  onAction,
  onClose,
}: {
  state: AppState;
  activity?: Activity;
  onAction: Action;
  onClose: () => void;
}) {
  const [key] = useState(() => newRequestId());
  const [typeId, setTypeId] = useState(
    activity?.typeId ||
      state.types.find((t) => t.active && !t.hidden && t.group !== "task")
        ?.id ||
      "",
  );
  const [date, setDate] = useState(activity?.date || state.today);
  const [minutes, setMinutes] = useState(activity?.minutes?.toString() || "");
  const [distance, setDistance] = useState(
    activity?.distance?.toString() || "",
  );
  const [note, setNote] = useState(activity?.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onAction("saveActivity", {
        id: activity?.id,
        idempotencyKey: key,
        typeId,
        date,
        minutes: minutes === "" ? null : Number(minutes),
        distance: distance === "" ? null : Number(distance),
        note,
      });
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Zápis sa nepodarilo uložiť. Tvoje údaje ostali vo formulári.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={activity ? "Upraviť aktivitu" : "Čo si dnes podnikol?"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="muted form-intro">
        Aj obyčajná prechádzka má svoje miesto. Zapíš si pohyb tak, ako bol.
      </p>
      <form onSubmit={save} className="stack">
        <label className="field">
          Aktivita
          <select
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            required
          >
            {state.types
              .filter(
                (t) =>
                  !t.hidden &&
                  (t.active || t.id === activity?.typeId) &&
                  t.group !== "task",
              )
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          Deň aktivity
          <input
            type="date"
            value={date}
            min={state.course.startDate}
            max={
              state.today < state.course.endDate
                ? state.today
                : state.course.endDate
            }
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <div className="grid-two">
          <label className="field">
            Trvanie <span className="field-hint">minúty · nepovinné</span>
            <input
              type="number"
              min="1"
              max="1440"
              step="1"
              inputMode="numeric"
              placeholder="napr. 45"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <label className="field">
            Vzdialenosť <span className="field-hint">km · nepovinné</span>
            <input
              type="number"
              min="0"
              max="1000"
              step="0.1"
              inputMode="decimal"
              placeholder="napr. 3,5"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
            />
          </label>
        </div>
        <p className="info-note">
          Bez trvania sa zápis počíta ako aktivita a pohybový deň. Časovú
          podmienku odmeny splní až s vyplnenými minútami.
        </p>
        <label className="field">
          Poznámka{" "}
          <span className="field-hint">
            nepovinné · uvidia ju členovia kurzu
          </span>
          <textarea
            value={note}
            maxLength={2000}
            rows={3}
            placeholder="Kam ťa to dnes zavialo?"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Zrušiť
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Ukladám…" : activity ? "Uložiť zmeny" : "Uložiť aktivitu"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
