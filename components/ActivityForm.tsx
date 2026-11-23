"use client";
import { useEffect, useRef, useState } from "react";
import { newRequestId } from "./request-id";
import type { Activity, AppState } from "../lib/types";
import { Modal, SportIcon, add, type Action } from "./ui";
import ColdPanel from "./ColdPanel";
import MediaPicker, {
  existingMediaSelection,
  type MediaSelection,
} from "./MediaPicker";
import { deleteMedia, uploadMedia } from "./media-api";
import {
  displayDuration,
  parseDuration,
  type DurationUnit,
} from "../lib/duration";
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
  const [date, setDate] = useState(
    activity?.date ||
      (state.today < state.course.endDate ? state.today : state.course.endDate),
  );
  // New entries start at 30 minutes; editing keeps the stored value.
  const [duration, setDuration] = useState(
    activity ? displayDuration(activity.minutes ?? null, "min") : "30",
  );
  const [unit, setUnit] = useState<DurationUnit>("min");
  const [canonicalMinutes, setCanonicalMinutes] = useState<number | null>(
    activity ? (activity.minutes ?? null) : 30,
  );
  const [durationError, setDurationError] = useState("");
  const [photos, setPhotos] = useState<MediaSelection[]>(() =>
    (activity?.photos || []).map(existingMediaSelection),
  );
  const currentPhotos = useRef(photos);
  currentPhotos.current = photos;
  useEffect(
    () => () => {
      for (const photo of currentPhotos.current)
        if (photo.file) URL.revokeObjectURL(photo.previewUrl);
    },
    [],
  );
  const [distance, setDistance] = useState(
    activity?.distance?.toString() || "",
  );
  const [note, setNote] = useState(activity?.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function close() {
    if (busy) return;
    for (const photo of photos)
      if (photo.media && !photo.existing)
        void deleteMedia(photo.media.id, true).catch(() => {});
    onClose();
  }
  async function save(e?: React.FormEvent, omitFailed = false) {
    e?.preventDefault();
    if (busy) return;
    if (durationError) {
      setError(durationError);
      return;
    }
    setBusy(true);
    setError("");
    try {
      let uploaded = omitFailed
        ? photos.filter((photo) => photo.status !== "error")
        : [...photos];
      for (let index = 0; index < uploaded.length; index++) {
        const photo = uploaded[index];
        if (photo.media || !photo.file) continue;
        uploaded[index] = { ...photo, status: "uploading", error: undefined };
        setPhotos([...uploaded]);
        try {
          const media = await uploadMedia(photo.file, "activity");
          uploaded[index] = {
            ...photo,
            media,
            status: "ready",
            error: undefined,
          };
        } catch (error) {
          uploaded[index] = {
            ...photo,
            status: "error",
            error:
              error instanceof Error
                ? error.message
                : "Nahratie sa nepodarilo.",
          };
        }
        setPhotos([...uploaded]);
      }
      if (uploaded.some((photo) => photo.status === "error")) {
        setError(
          "Niektoré fotografie sa nepodarilo nahrať. Skús uložiť znova alebo ich odober. Zápis zatiaľ nebol odoslaný.",
        );
        return;
      }
      await onAction("saveActivity", {
        id: activity?.id,
        idempotencyKey: key,
        typeId,
        date,
        minutes: canonicalMinutes,
        distance: distance === "" ? null : Number(distance.replace(",", ".")),
        note,
        photoIds: uploaded.map((photo) => photo.media!.id),
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
  const types = state.types.filter(
    (t) =>
      !t.hidden &&
      (t.active || t.id === activity?.typeId) &&
      t.group !== "task",
  );
  const selectedType = types.find((t) => t.id === typeId);
  const maxDate =
    state.today < state.course.endDate ? state.today : state.course.endDate;
  const yesterday = add(state.today, -1);
  const chips = [
    { date: state.today, label: "Dnes" },
    { date: yesterday, label: "Včera" },
  ].filter((c) => c.date >= state.course.startDate && c.date <= maxDate);
  const [otherDay, setOtherDay] = useState(
    () => !chips.some((c) => c.date === date),
  );
  const showDistance = selectedType?.group !== "exercise" || distance !== "";
  /** The typed number stays; only its unit changes (3 min → 3 hod). */
  function changeUnit(next: DurationUnit) {
    if (next === unit) return;
    setUnit(next);
    try {
      setCanonicalMinutes(parseDuration(duration, next));
      setDurationError("");
    } catch (error) {
      setDurationError(
        error instanceof Error ? error.message : "Skontroluj trvanie.",
      );
    }
  }
  return (
    <Modal
      title={activity ? "Upraviť zápis" : "Nový zápis"}
      onClose={close}
      sheet
    >
      <form onSubmit={save} className="cz-entry">
        <fieldset className="cz-entry-block" disabled={busy}>
          <legend>Čo</legend>
          <div className="cz-type-grid">
            {types.map((t) => (
              <button
                type="button"
                key={t.id}
                aria-pressed={t.id === typeId}
                onClick={() => setTypeId(t.id)}
              >
                <span className={`cz-type g-${t.group}`} aria-hidden="true">
                  <SportIcon group={t.group} typeName={t.name} size={22} />
                </span>
                <span>{t.name}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="cz-entry-block" disabled={busy}>
          <legend>Kedy</legend>
          <div className="cz-chip-row">
            {chips.map((c) => (
              <button
                type="button"
                key={c.date}
                aria-pressed={!otherDay && date === c.date}
                onClick={() => {
                  setOtherDay(false);
                  setDate(c.date);
                }}
              >
                {c.label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={otherDay}
              onClick={() => setOtherDay(true)}
            >
              Iný deň…
            </button>
          </div>
          {otherDay && (
            <label className="field cz-date">
              <span className="sr-only">Deň aktivity</span>
              <input
                type="date"
                value={date}
                min={state.course.startDate}
                max={maxDate}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </label>
          )}
        </fieldset>
        <div className={`cz-entry-numbers ${showDistance ? "" : "single"}`}>
          <div className="field">
            <label htmlFor="activity-duration">Trvanie</label>
            <div className="cz-duration">
              <input
                id="activity-duration"
                type="text"
                inputMode="decimal"
                placeholder={unit === "min" ? "45" : "1,5"}
                value={duration}
                disabled={busy}
                aria-invalid={!!durationError}
                aria-describedby="duration-hint"
                onChange={(e) => {
                  setDuration(e.target.value);
                  try {
                    setCanonicalMinutes(parseDuration(e.target.value, unit));
                    setDurationError("");
                  } catch (error) {
                    setDurationError(
                      error instanceof Error
                        ? error.message
                        : "Skontroluj trvanie.",
                    );
                  }
                }}
              />
              <div
                className="cz-segmented"
                role="group"
                aria-label="Jednotka trvania"
              >
                <button
                  type="button"
                  aria-pressed={unit === "min"}
                  disabled={busy}
                  onClick={() => changeUnit("min")}
                >
                  min
                </button>
                <button
                  type="button"
                  aria-pressed={unit === "hour"}
                  disabled={busy}
                  onClick={() => changeUnit("hour")}
                >
                  hod
                </button>
              </div>
            </div>
            <small id="duration-hint" className="cz-hint">
              {durationError
                ? durationError
                : canonicalMinutes !== null && unit === "hour"
                  ? `= ${canonicalMinutes} minút`
                  : !activity && canonicalMinutes === 30 && unit === "min"
                    ? "predvolených 30 minút, zmeň podľa skutočnosti"
                    : "nepovinné, v minútach alebo hodinách"}
            </small>
          </div>
          {showDistance && (
            <label className="field">
              Vzdialenosť
              <span className="cz-unit-input">
                <input
                  type="number"
                  disabled={busy}
                  min="0"
                  max="1000"
                  step="0.1"
                  inputMode="decimal"
                  placeholder="nepovinné"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                />
                <span aria-hidden="true">km</span>
              </span>
            </label>
          )}
        </div>
        {canonicalMinutes === null && !durationError && duration === "" && (
          <p className="cz-hint">
            Bez trvania sa zápis počíta ako pohybový deň, ale nesplní časové
            podmienky odmien.
          </p>
        )}
        <label className="field">
          Poznámka{" "}
          <span className="field-hint">nepovinné · uvidí ju skupina</span>
          <textarea
            disabled={busy}
            value={note}
            maxLength={2000}
            rows={3}
            placeholder="Kam viedla cesta, ako to išlo…"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <MediaPicker items={photos} onChange={setPhotos} disabled={busy} />
        {!activity && state.cold && (
          <ColdPanel state={state} onAction={onAction} variant="row" />
        )}
        <div className="cz-entry-footer">
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {photos.some((photo) => photo.status === "error") && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void save(undefined, true)}
            >
              Uložiť bez neúspešných fotografií
            </button>
          )}
          <button className="button primary cz-save" disabled={busy}>
            {busy ? "Ukladám…" : activity ? "Uložiť zmeny" : "Uložiť"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
