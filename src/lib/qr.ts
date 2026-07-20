// Decode a QR code out of a still photo (the same file the OCR path uses).
// Prefers the browser's native BarcodeDetector when present, and falls back to
// jsqr — a small pure-JS decoder — everywhere else, so it works offline on any
// phone. Returns the raw QR text, or null if no QR was found.

import jsQR from "jsqr";

// QR decoding needs the original pixels (not the grayscale/contrast-stretched
// OCR image), but a huge photo is slow to scan — cap the long edge.
const MAX_EDGE = 1400;

async function fileToImageData(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas unavailable on this device.");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } finally {
    bitmap.close();
  }
}

/** Decode the first QR code found in an image file, or null if there is none. */
export async function decodeQrFromFile(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;

  // Native path — Android Chrome and others expose BarcodeDetector.
  const Detector = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector as
    | (new (opts?: { formats?: string[] }) => {
        detect: (src: CanvasImageSource | Blob) => Promise<{ rawValue: string }[]>;
      })
    | undefined;
  if (Detector) {
    try {
      const detector = new Detector({ formats: ["qr_code"] });
      const bitmap = await createImageBitmap(file);
      try {
        const codes = await detector.detect(bitmap);
        if (codes.length && codes[0].rawValue) return codes[0].rawValue;
      } finally {
        bitmap.close();
      }
    } catch {
      // fall through to jsqr
    }
  }

  // Fallback — decode from raw pixels.
  try {
    const img = await fileToImageData(file);
    const result = jsQR(img.data, img.width, img.height, {
      inversionAttempts: "attemptBoth",
    });
    return result?.data ?? null;
  } catch {
    return null;
  }
}
