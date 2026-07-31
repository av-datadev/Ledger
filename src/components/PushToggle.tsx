import { useEffect, useState } from "react";
import {
  pushState,
  enablePush,
  disablePush,
  isStandalone,
  type PushState,
} from "../lib/push";

/**
 * Turn notifications on for this phone.
 *
 * Per-device by nature: a push subscription belongs to one browser on one
 * device, so each phone sharing the ledger decides for itself. Nothing about
 * the ledger is in a notification — just a short line and a tag; the device
 * fetches the real data once it's opened.
 */
export function PushToggle() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(state === "on" ? await disablePush() : await enablePush());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not change notifications.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (state === null) return null;

  // iOS only gives push to an app added to the home screen. Saying so beats a
  // toggle that fails for reasons the person can't see.
  const iosNeedsInstall =
    state === "unsupported" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !isStandalone();

  return (
    <section className="space-y-2">
      <h2 className="eyebrow">Notifications</h2>

      {state === "unsupported" ? (
        <p className="text-[13px] text-ink-soft">
          {iosNeedsInstall
            ? "Add Brick Flow to your home screen first — on iPhone, notifications only work once the app is installed."
            : "This browser can't show notifications."}
        </p>
      ) : state === "denied" ? (
        <p className="text-[13px] text-ink-soft">
          Notifications are blocked for this site. Turn them back on in your
          browser's site settings, then come back here.
        </p>
      ) : (
        <>
          <button
            className={`btn w-full !py-2.5 ${
              state === "on" ? "!bg-ink !text-paper !border-ink" : ""
            }`}
            aria-pressed={state === "on"}
            disabled={busy}
            onClick={() => void toggle()}
          >
            {busy ? "…" : state === "on" ? "On — this phone will be notified" : "Off"}
          </button>
          <p className="text-[13px] text-ink-soft">
            Tells you when a contractor asks to link to your site, and when
            someone you're linked to shares a payment or a bill. This phone
            only.
          </p>
        </>
      )}

      {error && <div className="text-[12px] text-crimson">{error}</div>}
    </section>
  );
}
