import { appPath } from "../lib/paths";
import type { MediaAsset } from "../lib/types";

export const MEDIA_FILE_LIMIT = 10 * 1024 * 1024;
export function validateMediaFile(file: File) {
  if (file.size > MEDIA_FILE_LIMIT)
    throw new Error("Fotografia môže mať najviac 10 MB.");
  if (/\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type))
    throw new Error(
      "HEIC/HEIF zatiaľ nepodporujeme. Vyber alebo exportuj fotografiu ako JPEG, PNG alebo WebP.",
    );
  if (!/^image\/(jpeg|png|webp)$/.test(file.type))
    throw new Error("Vyber fotografiu JPEG, PNG alebo WebP.");
}
export async function uploadMedia(
  file: File,
  kind: "activity" | "avatar" | "award",
  options: { focusX?: number; focusY?: number } = {},
): Promise<MediaAsset> {
  validateMediaFile(file);
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", file);
  if (options.focusX !== undefined) form.set("focusX", String(options.focusX));
  if (options.focusY !== undefined) form.set("focusY", String(options.focusY));
  let response: Response;
  try {
    response = await fetch(appPath("/api/media"), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      body: form,
    });
  } catch {
    throw new Error(
      "Fotografiu sa nepodarilo odoslať. Skontroluj pripojenie a skús to znova.",
    );
  }
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error("Server nepotvrdil uloženie fotografie. Skús to znova.");
  }
  if (!response.ok || !data?.media?.id)
    throw new Error(data?.error || "Fotografiu sa nepodarilo uložiť.");
  return data.media;
}
export async function deleteMedia(
  id: string,
  onlyUnattached = false,
): Promise<void> {
  const response = await fetch(
    appPath(
      `/api/media/${encodeURIComponent(id)}${onlyUnattached ? "?onlyUnattached=1" : ""}`,
    ),
    { method: "DELETE", credentials: "same-origin", cache: "no-store" },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || "Fotografiu sa nepodarilo odstrániť.");
  }
}
