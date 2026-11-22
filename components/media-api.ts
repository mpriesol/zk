import { appPath } from "../lib/paths";
import type { MediaAsset } from "../lib/types";

export const MEDIA_FILE_LIMIT = 10 * 1024 * 1024;
/** Original photo from the phone; it is resized in the browser before upload. */
export const MEDIA_SOURCE_LIMIT = 40 * 1024 * 1024;
/** The reverse proxy accepts about 1 MB per request; stay safely below it. */
const UPLOAD_TARGET = 900 * 1024;
const isHeic = (file: File) =>
  /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
export function validateMediaFile(file: File) {
  if (file.size > MEDIA_SOURCE_LIMIT)
    throw new Error("Fotografia môže mať najviac 40 MB.");
  if (!isHeic(file) && file.type && !/^image\//.test(file.type))
    throw new Error("Vyber fotografiu JPEG, PNG alebo WebP.");
}
async function decodeImage(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}> {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      /* Fallback below, e.g. older Safari. */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality),
  );
}
/**
 * Phone photos are often 3–12 MB. Resize and re-encode them in the browser
 * (JPEG, or PNG for award images that may be transparent) so the upload fits
 * the proxy limit. Small JPEG/PNG/WebP files are sent unchanged.
 */
export async function prepareMediaFile(
  file: File,
  kind: "activity" | "avatar" | "award",
): Promise<File> {
  const supported = /^image\/(jpeg|png|webp)$/.test(file.type);
  if (supported && file.size <= UPLOAD_TARGET) return file;
  let decoded;
  try {
    decoded = await decodeImage(file);
  } catch {
    throw new Error(
      isHeic(file)
        ? "Tento telefón neposlal fotografiu v podporovanom formáte (HEIC). Skús ju vybrať z galérie znova alebo ju ulož ako JPEG."
        : "Fotografiu sa nepodarilo otvoriť. Skús inú fotografiu.",
    );
  }
  try {
    const keepAlpha = kind === "award" && file.type !== "image/jpeg";
    const type = keepAlpha ? "image/png" : "image/jpeg";
    const attempts = keepAlpha
      ? [{ side: 1024 }, { side: 768 }, { side: 512 }]
      : [
          { side: kind === "avatar" ? 1024 : 2048, quality: 0.85 },
          { side: kind === "avatar" ? 1024 : 1600, quality: 0.78 },
          { side: 1280, quality: 0.72 },
          { side: 1024, quality: 0.68 },
        ];
    for (const attempt of attempts) {
      const scale = Math.min(
        1,
        attempt.side / Math.max(decoded.width, decoded.height),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(decoded.width * scale));
      canvas.height = Math.max(1, Math.round(decoded.height * scale));
      const context = canvas.getContext("2d");
      if (!context) break;
      if (!keepAlpha) {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
      const blob = await toBlob(
        canvas,
        type,
        "quality" in attempt ? attempt.quality : undefined,
      );
      canvas.width = canvas.height = 0;
      if (blob && blob.size <= UPLOAD_TARGET) {
        const name =
          file.name.replace(/\.[^.]+$/, "") +
          (type === "image/png" ? ".png" : ".jpg");
        return new File([blob], name || "fotografia.jpg", { type });
      }
    }
  } finally {
    decoded.close();
  }
  throw new Error(
    "Fotografiu sa nepodarilo zmenšiť na odoslanie. Skús inú fotografiu.",
  );
}
export async function uploadMedia(
  file: File,
  kind: "activity" | "avatar" | "award",
  options: { focusX?: number; focusY?: number } = {},
): Promise<MediaAsset> {
  validateMediaFile(file);
  file = await prepareMediaFile(file, kind);
  if (file.size > MEDIA_FILE_LIMIT)
    throw new Error("Fotografia môže mať najviac 10 MB.");
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
  if (response.status === 413)
    throw new Error(
      "Fotografia je pre server príliš veľká. Skús ju odfotiť v nižšom rozlíšení alebo vybrať inú.",
    );
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Server nepotvrdil uloženie fotografie (kód ${response.status}). Skús to znova.`,
    );
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
