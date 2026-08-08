import { useAiConsent, NOTE_AI_CONSENT } from "./useAiConsent";

/**
 * Per-device consent for the handwritten-note reader.
 *
 * Reading a note sends that photo off the phone to the AI reader, which is a
 * different bargain from everything else on the Entry screen — attached photos
 * stay on-device, and the form says so. So it is asked for explicitly, once,
 * before the first read.
 *
 * The storage key is unchanged from when this hook held the logic itself, so
 * anyone who already agreed is not asked again.
 */
export function useNoteAiConsent(): {
  granted: boolean;
  grant: () => void;
  revoke: () => void;
} {
  return useAiConsent(NOTE_AI_CONSENT);
}
