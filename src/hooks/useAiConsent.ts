import { useCallback, useState } from "react";

/**
 * Per-device consent for one AI reader that sends data off the phone.
 *
 * Deliberately localStorage and NOT a synced setting: consent to upload
 * belongs to whoever is holding that phone, not to the household. Several
 * people share this ledger; one of them agreeing must not silently opt in
 * the rest.
 *
 * Consent is asked PER PURPOSE rather than once for "AI", because the readers
 * ask for very different things. Agreeing to send a photo of one slip is not
 * agreeing to send an entire spending history, so those are separate keys and
 * separate prompts — see NOTE_AI_CONSENT and IMPORT_AI_CONSENT below.
 */
export function useAiConsent(key: string): {
  granted: boolean;
  grant: () => void;
  revoke: () => void;
} {
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

/** Reading one handwritten slip or note as a photo. */
export const NOTE_AI_CONSENT = "hl-note-ai-consent";

/**
 * Reading a whole expense history — a pasted note, or a spreadsheet too
 * irregular to map on-device. A much larger ask than the note reader: it is
 * every payment the person has made, not one piece of paper, which is why it
 * has its own key and is never implied by the other.
 */
export const IMPORT_AI_CONSENT = "bb-import-ai-consent";
