import { useEffect, useRef, useState } from "react";
import { useVoiceAiConsent } from "../hooks/useNoteAiConsent";
import {
  canRecord,
  startRecording,
  readVoice,
  MAX_RECORD_MS,
  type Recorder,
  type VoiceMode,
  type VoiceResult,
} from "../lib/voice";

type Phase = "idle" | "consent" | "recording" | "sending";

/**
 * Speak a record instead of typing it.
 *
 * One button, used on three screens, because the three things being recorded
 * differ only in the shape that comes back — the act is identical and so is
 * everything that can go wrong with it.
 *
 * Nothing here writes anything. Every result lands in the form beside it for
 * the person to check and correct, which is the only honest way to use a
 * machine that will occasionally hear "do hazaar" as "das hazaar".
 */
export function VoiceCapture<M extends VoiceMode>({
  mode,
  hint,
  onResult,
}: {
  mode: M;
  /** An example sentence, shown while asking for consent. */
  hint: string;
  onResult: (result: VoiceResult[M]) => void;
}) {
  const consent = useVoiceAiConsent();
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<Recorder | null>(null);

  // Releasing the microphone when this unmounts mid-recording is not tidiness:
  // a live getUserMedia track keeps the phone's recording indicator lit after
  // the person has navigated away, which on an app holding their financial
  // records looks exactly like being spied on.
  useEffect(() => {
    return () => recorderRef.current?.cancel();
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - started), 200);
    return () => clearInterval(id);
  }, [phase]);

  // A recording nobody stopped is a phone quietly listening. It also grows a
  // payload that will be rejected for size, so it stops itself.
  useEffect(() => {
    if (phase === "recording" && elapsed >= MAX_RECORD_MS) void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, elapsed]);

  if (!canRecord()) return null;

  const begin = async () => {
    setErr(null);
    if (!consent.granted) {
      setPhase("consent");
      return;
    }
    try {
      recorderRef.current = await startRecording();
      setElapsed(0);
      setPhase("recording");
    } catch {
      // Almost always a denied microphone permission; naming the fix beats
      // reporting the error, which says "NotAllowedError" and helps nobody.
      setErr("Microphone blocked. Allow it for this site, then try again.");
      setPhase("idle");
    }
  };

  const finish = async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    setPhase("sending");
    try {
      const audio = await rec.stop();
      if (!audio) throw new Error("Nothing was recorded — try again.");
      const result = await readVoice(audio, mode);
      onResult(result);
      setPhase("idle");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read that.");
      setPhase("idle");
    }
  };

  const abandon = () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setPhase("idle");
  };

  if (phase === "consent") {
    return (
      <div className="mt-2 p-2.5 border border-rule rounded-md bg-paper space-y-2">
        <div className="text-[13px] font-medium">Speak it instead of typing?</div>
        <p className="text-[12px] text-ink-soft">
          Say it in Hindi, English or a mix — “{hint}” — and the fields below
          fill themselves for you to check.
        </p>
        <p className="text-[12px] text-ink-soft">
          {/* Said plainly and before anything is recorded. This is the whole
              bargain, and burying it would make the consent worthless. */}
          The recording is sent to Google's Gemini service to be read. Nothing
          else on this screen leaves your phone. You can turn this off again in
          the Data tab.
        </p>
        <div className="flex gap-1.5">
          <button
            className="btn btn-primary !py-1.5 !text-[13px] flex-1"
            onClick={() => {
              consent.grant();
              setPhase("idle");
              // Granting is the answer to "may I", not "do it now" — the person
              // presses the microphone again when they are ready to speak.
            }}
          >
            Allow and continue
          </button>
          <button
            className="btn !py-1.5 !text-[13px]"
            onClick={() => setPhase("idle")}
          >
            No thanks
          </button>
        </div>
      </div>
    );
  }

  if (phase === "recording") {
    const left = Math.max(0, Math.ceil((MAX_RECORD_MS - elapsed) / 1000));
    return (
      <div className="mt-2 p-2.5 border border-crimson rounded-md bg-crimson/5 space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-crimson animate-pulse shrink-0" />
          <span className="text-[13px] font-medium flex-1">Listening…</span>
          <span className="money text-[12px] text-ink-soft">{left}s</span>
        </div>
        <div className="flex gap-1.5">
          <button
            className="btn btn-primary !py-2 !text-[13px] flex-1"
            onClick={() => void finish()}
          >
            Done
          </button>
          <button className="btn !py-2 !text-[13px]" onClick={abandon}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn !py-1.5 !px-3 !text-[13px] w-full"
        disabled={phase === "sending"}
        onClick={() => void begin()}
      >
        {phase === "sending" ? "Reading what you said…" : "🎤 Speak it instead"}
      </button>
      {err && <div className="text-[12px] text-crimson mt-1">{err}</div>}
    </>
  );
}

/**
 * What the reader heard, shown above the filled-in form.
 *
 * The transcript is not a nicety. When a figure comes back wrong the person
 * needs to know whether the machine misheard the words or misunderstood the
 * sentence, and those have different fixes — say it again, or correct the
 * field. Without this they can only see that something is wrong.
 */
export function VoiceHeard({
  transcript,
  confidence,
  unclear,
  onDismiss,
}: {
  transcript: string;
  confidence: string;
  unclear: string;
  onDismiss: () => void;
}) {
  if (!transcript && !unclear) return null;
  return (
    <div className="mt-2 p-2.5 border border-rule rounded-md bg-paper space-y-1">
      <div className="flex items-start gap-2">
        <span className="text-[10px] uppercase tracking-wider text-ink-soft shrink-0 mt-0.5">
          Heard
        </span>
        <span className="text-[13px] flex-1 min-w-0">{transcript}</span>
        <button
          className="text-ink-soft text-[13px] px-1 shrink-0"
          aria-label="Dismiss what was heard"
          onClick={onDismiss}
        >
          ✕
        </button>
      </div>
      {(unclear || confidence === "low") && (
        <div className="text-[12px] text-crimson">
          {unclear || "Some of that was hard to make out."} Check the figures
          before saving.
        </div>
      )}
    </div>
  );
}
