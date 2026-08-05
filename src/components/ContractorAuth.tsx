import { useState } from "react";
import { sendMagicLink, verifyEmailCode } from "../hooks/useAuth";

/**
 * Sign-in for a contractor, so his sites can be linked to an owner's app.
 *
 * Same emailed code the household side uses. Phone OTP would suit this
 * trade better, but in India it needs DLT registration (a per-year fee to the
 * operator plus entity, sender-ID and per-template approval) before any SMS is
 * delivered at all — too much to carry for this. Every Android phone already
 * has a Google account behind the Play Store, so an address exists even when
 * it's never opened, and the code is needed once per device.
 *
 * Signing in creates no household and joins nothing: it only gives this device
 * an identity the server can attach a site link to.
 */
export function ContractorAuth() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!email.trim() || !email.includes("@")) {
      setError("Enter your email address.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await sendMagicLink(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    // Length is a Supabase project setting (6–10 digits) — see Auth.tsx.
    if (!/^\d{6,10}$/.test(code.trim())) {
      setError("Enter the code from the email.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await verifyEmailCode(email.trim(), code.trim());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That code didn't work. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-3 space-y-2.5">
      {!sent ? (
        <>
          <div>
            <label className="field-label" htmlFor="ca-email">Your email</label>
            <input
              id="ca-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              className="input"
              placeholder="you@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <p className="text-[11px] text-ink-soft">
            We'll email you a code. Needed once on this phone.
          </p>
          {error && <div className="text-[12px] text-crimson">{error}</div>}
          <button
            className="btn btn-primary w-full !py-2.5"
            disabled={busy}
            onClick={() => void send()}
          >
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </>
      ) : (
        <>
          <p className="text-[12px] text-ink-soft">
            We emailed a code to <b>{email.trim()}</b>.
          </p>
          <div>
            <label className="field-label" htmlFor="ca-code">Enter the code</label>
            <input
              id="ca-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              className="input money !text-xl !tracking-[0.3em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          {error && <div className="text-[12px] text-crimson">{error}</div>}
          <button
            className="btn btn-primary w-full !py-2.5"
            disabled={busy}
            onClick={() => void verify()}
          >
            {busy ? "Checking…" : "Sign in"}
          </button>
          <button
            className="text-[12px] text-ink-soft underline"
            onClick={() => {
              setSent(false);
              setCode("");
              setError(null);
            }}
          >
            Use a different email
          </button>
        </>
      )}
    </div>
  );
}
