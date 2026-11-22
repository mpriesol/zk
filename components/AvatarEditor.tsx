"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { deleteMedia, uploadMedia, validateMediaFile } from "./media-api";
import "./media.css";

export default function AvatarEditor({
  avatarUrl,
  onChanged,
}: {
  avatarUrl?: string | null;
  onChanged: () => void | Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<string | null>(null),
    [focusX, setFocusX] = useState(0.5),
    [focusY, setFocusY] = useState(0.5),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const refresh = async () => {
    await onChanged();
    setSaved(true);
  };
  return (
    <section className="avatar-editor stack" aria-label="Profilová fotografia">
      <h3>Profilová fotografia</h3>
      <p className="small muted">
        Fotografiu uvidia členovia tvojho kurzu. JPEG, PNG alebo WebP, najviac
        10 MB.
      </p>
      {(preview || avatarUrl) && (
        <img
          className="avatar-crop-preview"
          src={preview || avatarUrl!}
          alt="Náhľad profilovej fotografie"
          style={{ objectPosition: `${focusX * 100}% ${focusY * 100}%` }}
        />
      )}
      {file && (
        <div className="avatar-crop-controls">
          <p className="small">Uprav výrez posunutím fotografie.</p>
          <label className="field">
            Vodorovne
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={focusX}
              onChange={(event) => setFocusX(Number(event.target.value))}
              disabled={busy}
            />
          </label>
          <label className="field">
            Zvisle
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={focusY}
              onChange={(event) => setFocusY(Number(event.target.value))}
              disabled={busy}
            />
          </label>
        </div>
      )}
      <input
        ref={input}
        type="file"
        className="sr-only"
        accept="image/jpeg,image/png,image/webp"
        disabled={busy}
        onChange={(event) => {
          const selected = event.target.files?.[0];
          event.target.value = "";
          setError("");
          setSaved(false);
          if (!selected) return;
          try {
            validateMediaFile(selected);
            setFile(selected);
            setFocusX(0.5);
            setFocusY(0.5);
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Fotografiu sa nepodarilo vybrať.",
            );
          }
        }}
      />
      <div className="form-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={17} />
          {avatarUrl || file ? "Vybrať inú" : "Vybrať fotografiu"}
        </button>
        {file && (
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await uploadMedia(file, "avatar", { focusX, focusY });
                setFile(null);
                await refresh();
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "Fotografiu sa nepodarilo uložiť.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Ukladám…" : "Uložiť fotografiu"}
          </button>
        )}
        {avatarUrl && !file && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const id = avatarUrl.split("/").pop()!;
                await deleteMedia(id);
                await refresh();
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "Fotografiu sa nepodarilo odstrániť.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <Trash2 size={17} />
            Odstrániť
          </button>
        )}
        {file && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => setFile(null)}
          >
            Zrušiť výber
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="info-note">
          Profilová fotografia je aktualizovaná.
        </p>
      )}
    </section>
  );
}
