import { useCallback, useState } from "react";

const NOTE_KEY = "hl-note-ai-consent";
// Voice is asked for SEPARATELY from the photo reader. They are different
// bargains: one sends a picture of a piece of paper, the other sends a
// recording of the person's own voice, and somebody may well agree to the
// first and not the second. Rolling them into one switch would take an
// agreement given about paper and quietly apply it to a microphone.
const VOICE_KEY = "hl-voice-ai-consent";

export interface AiConsent {
  granted: boolean;
  grant: () => void;
  revoke: () => void;
}

function useConsentKey(key: string): AiConsent {
  const [granted, setGranted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });

  const write = useCallback(
    (value: boolean) => {
      setGranted(value);
      try {
        localStorage.setItem(key, value ? "1" : "0");
      } catch {
        /* private mode / storage disabled — the choice still holds this session */
      }
    },
    [key],
  );

  return {
    granted,
    grant: useCallback(() => write(true), [write]),
    revoke: useCallback(() => write(false), [write]),
  };
}

/**
 * Per-device consent for the handwritten-note reader.
 *
 * Reading a note sends that photo off the phone to the AI reader, which is a
 * different bargain from everything else on the Entry screen — attached photos
 * stay on-device, and the form says so. So it is asked for explicitly, once,
 * before the first read.
 *
 * Deliberately localStorage and NOT a synced setting: consent to upload a photo
 * belongs to whoever is holding that phone, not to the household. Four people
 * share this ledger; one of them agreeing must not silently opt in the rest.
 */
export function useNoteAiConsent(): AiConsent {
  return useConsentKey(NOTE_KEY);
}

/**
 * Per-device consent for the voice reader.
 *
 * Same reasoning as the note reader, and the same localStorage-not-synced rule:
 * agreeing to send your own voice off the phone is a decision for whoever is
 * holding it, not for the four people sharing the ledger.
 */
export function useVoiceAiConsent(): AiConsent {
  return useConsentKey(VOICE_KEY);
}
