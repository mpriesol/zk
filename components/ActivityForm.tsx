"use client";
import { useEffect, useRef, useState } from "react";
import { newRequestId } from "./request-id";
import type { Activity, AppState } from "../lib/types";
import { Modal, type Action } from "./ui";
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
  const [duration, setDuration] = useState(
    displayDuration(activity?.minutes ?? null, "min"),
  );
  const [unit, setUnit] = useState<DurationUnit>("min");
  const [canonicalMinutes, setCanonicalMinutes] = useState<number | null>(
    activity?.minutes ?? null,
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
  return (
    <Modal
      title={activity ? "Upraviť aktivitu" : "Nová aktivita"}
      onClose={close}
    >
      <p className="muted form-intro">
        Aj obyčajná prechádzka má svoje miesto. Zapíš si pohyb tak, ako bol.
      </p>
      <form onSubmit={save} className="stack">
        <label className="field">
          Aktivita
          <select
            value={typeId}
            disabled={busy}
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
            disabled={busy}
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
          <div className="field">
            <label htmlFor="activity-duration">
              Trvanie <span className="field-hint">nepovinné</span>
            </label>
            <div className="duration-input">
              <input
                id="activity-duration"
                type="text"
                inputMode="decimal"
                placeholder={unit === "min" ? "napr. 45" : "napr. 1,5"}
                value={duration}
                disabled={busy}
                aria-invalid={!!durationError}
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
              <select
                aria-label="Jednotka trvania"
                value={unit}
                disabled={busy}
                onChange={(event) => {
                  if (durationError) {
                    setError(durationError);
                    return;
                  }
                  const next = event.target.value as DurationUnit;
                  setUnit(next);
                  setDuration(displayDuration(canonicalMinutes, next));
                }}
              >
                <option value="min">min</option>
                <option value="hour">hod</option>
              </select>
            </div>
          </div>
          <label className="field">
            Vzdialenosť <span className="field-hint">km · nepovinné</span>
            <input
              type="number"
              disabled={busy}
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
            disabled={busy}
            value={note}
            maxLength={2000}
            rows={3}
            placeholder="Kam ťa to dnes zavialo?"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <MediaPicker items={photos} onChange={setPhotos} disabled={busy} />
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
            onClick={close}
          >
            Zrušiť
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Ukladám…" : activity ? "Uložiť zmeny" : "Uložiť aktivitu"}
          </button>
        </div>
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
      </form>
    </Modal>
  );
}
