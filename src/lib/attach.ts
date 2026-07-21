// Turns a picked photo (cheque, diary page, receipt) into a compact JPEG blob
// to store alongside a ledger entry. Downscales and re-encodes so a 4 MB camera
// shot lands at a few hundred KB — small enough to keep many in IndexedDB and
// to carry inside a JSON backup. Everything stays on-device.

import type { Attachment } from "../types";

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export interface ProcessedImage {
  blob: Blob;
  mime: string;
  name: string;
  w: number;
  h: number;
}

/** Downscale + re-encode a picked image file to a storable JPEG. */
export async function fileToAttachment(file: File): Promise<ProcessedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose a photo (JPG/PNG/HEIC).");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable on this device.");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) throw new Error("Could not process that image.");
    return { blob, mime: "image/jpeg", name: file.name || "photo.jpg", w, h };
  } finally {
    bitmap.close();
  }
}

/** Build the full Attachment row for an entry from a processed image. */
export function toAttachment(entryId: string, img: ProcessedImage): Attachment {
  return {
    id: crypto.randomUUID(),
    entryId,
    blob: img.blob,
    mime: img.mime,
    name: img.name,
    w: img.w,
    h: img.h,
    createdAt: Date.now(),
  };
}

// --- Backup helpers: blobs can't live in JSON, so round-trip through base64. ---

/** Encode a blob as a base64 string (no data: prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/** Decode a base64 string back into a Blob of the given MIME type. */
export function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
