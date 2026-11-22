"use client";
import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import type { MediaAsset } from "../lib/types";
import { newRequestId } from "./request-id";
import { deleteMedia, validateMediaFile } from "./media-api";
import "./media.css";

export interface MediaSelection {
  key: string;
  file?: File;
  previewUrl: string;
  media?: MediaAsset;
  existing?: boolean;
  status?: "selected" | "uploading" | "ready" | "error";
  error?: string;
}
export function existingMediaSelection(media: MediaAsset): MediaSelection {
  return {
    key: media.id,
    previewUrl: media.url,
    media,
    existing: true,
    status: "ready",
  };
}
export default function MediaPicker({
  items,
  onChange,
  disabled = false,
}: {
  items: MediaSelection[];
  onChange: (items: MediaSelection[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  return (
    <section className="media-picker" aria-label="Fotografie aktivity">
      <div className="media-picker-title">
        <strong>
          Fotografie <span className="field-hint">nepovinné</span>
        </strong>
        <span className="small muted">{items.length}/5</span>
      </div>
      <p className="small muted">
        Najviac 5 fotografií. Veľké fotky z mobilu appka pred odoslaním sama
        zmenší.
      </p>
      {items.length > 0 && (
        <div className="media-selection-grid">
          {items.map((item, index) => (
            <figure
              key={item.key}
              className={`media-selection ${item.status === "error" ? "media-error" : ""}`}
            >
              <img
                src={item.previewUrl}
                alt={`Náhľad fotografie ${index + 1}`}
              />
              <button
                type="button"
                className="media-remove"
                aria-label={`Odobrať fotografiu ${index + 1}`}
                disabled={disabled}
                onClick={() => {
                  if (item.file) URL.revokeObjectURL(item.previewUrl);
                  if (item.media && !item.existing)
                    void deleteMedia(item.media.id, true).catch(() => {});
                  onChange(items.filter((entry) => entry.key !== item.key));
                }}
              >
                <X size={16} />
              </button>
              {item.status === "uploading" && (
                <figcaption role="status">Nahrávam…</figcaption>
              )}
              {item.status === "error" && (
                <figcaption className="error">
                  {item.error || "Nahratie sa nepodarilo."}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}
      <input
        ref={input}
        className="sr-only"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        disabled={disabled || items.length >= 5}
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          setError("");
          if (files.length + items.length > 5) {
            setError("K aktivite môžeš pridať najviac 5 fotografií.");
            return;
          }
          try {
            for (const file of files) validateMediaFile(file);
            onChange([
              ...items,
              ...files.map((file) => ({
                key: newRequestId(),
                file,
                previewUrl: URL.createObjectURL(file),
                status: "selected" as const,
              })),
            ]);
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Fotografiu sa nepodarilo vybrať.",
            );
          }
        }}
      />
      <button
        type="button"
        className="button secondary media-pick-button"
        disabled={disabled || items.length >= 5}
        onClick={() => input.current?.click()}
      >
        <ImagePlus size={18} />
        Vybrať fotografie
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
