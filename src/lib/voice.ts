// Recording a spoken record and having it come back as filled-in fields.
//
// The counterpart to noteScan.ts, which does the same for a photographed slip.
// The audio leaves the device — that is the whole bargain, and it is why this
// sits behind the same per-device consent the photo reader uses.

import { supabase } from "./supabase";
import { todayStr } from "./format";

/** How long one spoken record may run before recording stops itself. */
export const MAX_RECORD_MS = 30_000;

/** Roughly the ceiling a base64 JSON body can carry comfortably. */
const MAX_BYTES = 4 * 1024 * 1024;

const TIMEOUT_MS = 120_000;

export type VoiceMode = "entry" | "stock" | "site";

interface VoiceCommon {
  /** What was said, in the original language and script — shown for checking. */
  transcript: string;
  confidence: "high" | "medium" | "low" | string;
  /** Named in plain English when something important could not be made out. */
  unclear: string;
}

export interface VoiceEntry extends VoiceCommon {
  date: string;
  description: string;
  detail: string;
  amount: number;
  mode: string;
  category: string;
  notes: string;
}

export interface VoiceStock extends VoiceCommon {
  date: string;
  kind: "in" | "out" | string;
  item: string;
  qty: number;
  unit: string;
  person: string;
}

export interface VoiceSite extends VoiceCommon {
  date: string;
  kind: "received" | "material" | "labour" | "other" | string;
  description: string;
  amount: number;
  notes: string;
}

export type VoiceResult = { entry: VoiceEntry; stock: VoiceStock; site: VoiceSite };

/**
 * The recording format this device can actually produce.
 *
 * Browsers disagree: Chrome on Android gives webm/opus, Safari gives mp4/aac,
 * and asking for one the device cannot encode throws rather than falling back.
 * So the list is tried in order and the first supported one wins.
 */
export function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  const supported = (t: string) =>
    typeof MediaRecorder !== "undefined" &&
    typeof MediaRecorder.isTypeSupported === "function" &&
    MediaRecorder.isTypeSupported(t);
  return candidates.find(supported) ?? "";
}

/** True when this device can record at all — checked before offering the button. */
export function canRecord(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export interface Recorder {
  /** Resolves with the recorded audio, or null if nothing was captured. */
  stop: () => Promise<Blob | null>;
  /** Abandon the recording and release the microphone without returning audio. */
  cancel: () => void;
}

/**
 * Start recording, and hand back the two ways it can end.
 *
 * The microphone track is stopped on BOTH paths. A getUserMedia stream left
 * running keeps the phone's recording indicator lit, which on a device holding
 * somebody's financial records is alarming in a way no feature is worth.
 */
export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  rec.start();

  const release = () => stream.getTracks().forEach((t) => t.stop());

  return {
    stop: () =>
      new Promise<Blob | null>((resolve) => {
        rec.onstop = () => {
          release();
          resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || mimeType }) : null);
        };
        if (rec.state === "inactive") {
          release();
          resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || mimeType }) : null);
        } else {
          rec.stop();
        }
      }),
    cancel: () => {
      try {
        if (rec.state !== "inactive") rec.stop();
      } finally {
        release();
      }
    },
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // Chunked: a 4 MB clip spread over one apply() call blows the argument limit
  // on some engines, which fails as a RangeError rather than anything readable.
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Send one recording off to be transcribed and pulled apart into fields.
 *
 * Throws on any failure — offline, quota, unintelligible — which the caller
 * shows directly. There is no on-device fallback: nothing in the browser reads
 * Hinglish construction talk, and pretending otherwise by falling back to a
 * generic speech API would produce a confidently wrong number.
 */
export async function readVoice<M extends VoiceMode>(
  audio: Blob,
  mode: M,
): Promise<VoiceResult[M]> {
  if (audio.size === 0) throw new Error("Nothing was recorded — try holding the button longer.");
  if (audio.size > MAX_BYTES) {
    throw new Error("That recording is too long. Keep it to a short sentence.");
  }

  const audioBase64 = await blobToBase64(audio);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const { data, error } = await supabase.functions.invoke<
      VoiceResult[M] & { error?: string }
    >("scan-voice", {
      body: {
        audioBase64,
        mimeType: audio.type || "audio/webm",
        mode,
        // Sent from the device so "aaj" and "kal" resolve in the speaker's own
        // timezone rather than the edge function's UTC.
        today: todayStr(),
      },
      signal: controller.signal,
    });
    if (error) throw error;
    if (!data) throw new Error("Empty response from the voice reader.");
    if (data.error) throw new Error(data.error);
    return data;
  } finally {
    clearTimeout(timer);
  }
}
