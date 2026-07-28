import { useCallback, useState } from "react";

const KEY = "hl-note-ai-consent";

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
export function useNoteAiConsent(): {
  granted: boolean;
  grant: () => void;
  revoke: () => void;
} {
  const [granted, setGranted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });

  const write = useCallback((value: boolean) => {
    setGranted(value);
    try {
      localStorage.setItem(KEY, value ? "1" : "0");
    } catch {
      /* private mode / storage disabled — the choice still holds this session */
    }
  }, []);

  return {
    granted,
    grant: useCallback(() => write(true), [write]),
    revoke: useCallback(() => write(false), [write]),
  };
}
