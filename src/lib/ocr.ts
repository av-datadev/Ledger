// On-device OCR via tesseract.js. All assets (worker, wasm core, English
// language data) are self-hosted under /tesseract and precached by the
// service worker, so scanning works fully offline. Nothing leaves the phone.

import { createWorker, type Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;
let progressHandler: ((pct: number) => void) | null = null;

function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker("eng", 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/",
    langPath: "/tesseract",
    logger: (m) => {
      if (m.status === "recognizing text" && progressHandler) {
        progressHandler(Math.round(m.progress * 100));
      }
    },
  }).catch((err) => {
    workerPromise = null; // allow retry on next scan
    throw err;
  });
  return workerPromise;
}

/** OCR a preprocessed image (data URL). Returns the raw recognized text. */
export async function recognizeText(
  imageDataUrl: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  progressHandler = onProgress ?? null;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(imageDataUrl);
    return data.text;
  } finally {
    progressHandler = null;
  }
}
