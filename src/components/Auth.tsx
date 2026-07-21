import { useState } from "react";
import { sendMagicLink, signOut } from "../hooks/useAuth";
import {
  createHousehold,
  joinHousehold,
  type Household,
} from "../lib/sync";

/** Centered full-screen shell used by the auth/loading states. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper text-ink flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-lg font-semibold tracking-[0.18em]">BRICK FLOW</div>
          <div className="text-[12px] text-ink-soft mt-1">
            Shared construction ledger
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Splash() {
  return (
    <Shell>
      <div className="text-center text-sm text-ink-soft">Loading…</div>
    </Shell>
  );
}

/** Passwordless email sign-in. */
export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setStatus("sending");
    try {
      await sendMagicLink(email);
      setStatus("sent");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Could not send the link.");
    }
  };

  if (status === "sent") {
    return (
      <Shell>
        <div className="text-center space-y-3">
          <div className="text-2xl">📧</div>
          <div className="text-sm">
            We sent a sign-in link to <b>{email.trim()}</b>.
          </div>
          <div className="text-[12px] text-ink-soft">
            Open it on this device to sign in. You can close this once you've
            tapped the link.
          </div>
          <button
            className="text-[12px] text-ink-soft underline"
            onClick={() => setStatus("idle")}
          >
            Use a different email
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-3">
        <div>
          <label className="field-label" htmlFor="login-email">
            Sign in with your email
          </label>
          <input
            id="login-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            className="input"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </div>
        <p className="text-[12px] text-ink-soft">
          No password — we email you a one-tap sign-in link.
        </p>
        {error && <div className="text-[13px] text-crimson">{error}</div>}
        <button
          className="btn btn-primary w-full !py-3 !text-base"
          disabled={status === "sending"}
          onClick={() => void submit()}
        >
          {status === "sending" ? "Sending…" : "Send sign-in link"}
        </button>
      </div>
    </Shell>
  );
}

/** First sign-in: create a household or join an existing one by code. */
export function HouseholdSetup({
  onReady,
}: {
  onReady: (h: Household) => void;
}) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState("Our House");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setError(null);
    setBusy(true);
    try {
      const h =
        mode === "create"
          ? await createHousehold(name)
          : await joinHousehold(code);
      onReady(h);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="space-y-3">
        <div className="flex gap-1.5">
          {(["create", "join"] as const).map((m) => (
            <button
              key={m}
              className={`flex-1 text-[13px] rounded px-3 py-2 border ${
                mode === m
                  ? "bg-ink text-paper border-ink"
                  : "border-rule text-ink-soft"
              }`}
              onClick={() => setMode(m)}
            >
              {m === "create" ? "Start a household" : "Join with a code"}
            </button>
          ))}
        </div>

        {mode === "create" ? (
          <div>
            <label className="field-label" htmlFor="hh-name">
              Household name
            </label>
            <input
              id="hh-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-[12px] text-ink-soft mt-1.5">
              You'll get an invite code to share so family can join this same
              ledger.
            </p>
          </div>
        ) : (
          <div>
            <label className="field-label" htmlFor="hh-code">
              Invite code
            </label>
            <input
              id="hh-code"
              className="input uppercase tracking-widest"
              placeholder="e.g. 9F3A2B1C"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <p className="text-[12px] text-ink-soft mt-1.5">
              Ask whoever started the household for their invite code.
            </p>
          </div>
        )}

        {error && <div className="text-[13px] text-crimson">{error}</div>}
        <button
          className="btn btn-primary w-full !py-3 !text-base"
          disabled={busy}
          onClick={() => void go()}
        >
          {busy ? "Please wait…" : mode === "create" ? "Create" : "Join"}
        </button>
        <button
          className="text-[12px] text-ink-soft underline w-full text-center"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </div>
    </Shell>
  );
}

/** Small account/household panel shown on the Data tab. */
export function AccountPanel({
  household,
  email,
}: {
  household: Household;
  email: string | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!household.invite_code) return;
    try {
      await navigator.clipboard.writeText(household.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the code is visible to type manually */
    }
  };

  return (
    <div className="bg-surface border border-rule rounded-md p-3 mb-4">
      <div className="text-[11px] uppercase tracking-[0.15em] text-ink-soft mb-2">
        Shared ledger
      </div>
      <div className="text-sm font-medium">{household.name}</div>
      <div className="text-[12px] text-ink-soft">{email}</div>
      {household.invite_code && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[12px] text-ink-soft">Invite code:</span>
          <code className="text-sm font-semibold tracking-widest">
            {household.invite_code}
          </code>
          <button
            className="text-[12px] text-ink-soft underline"
            onClick={() => void copy()}
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
      )}
      <p className="text-[11px] text-ink-soft mt-1.5">
        Share this code so family can join this same ledger on their phone.
      </p>
      <button
        className="text-[13px] text-crimson mt-3"
        onClick={() => void signOut()}
      >
        Sign out
      </button>
    </div>
  );
}
