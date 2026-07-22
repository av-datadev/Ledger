import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { sendMagicLink, verifyEmailCode, signOut } from "../hooks/useAuth";
import {
  createHousehold,
  joinHousehold,
  stopSync,
  type Household,
} from "../lib/sync";
import { clearAllData } from "../db";

/**
 * Sign out AND wipe this ledger off the device — the shared/public-machine
 * path. Sync is stopped FIRST so clearing the local rows doesn't fire the
 * delete-hooks that would propagate the wipe up to the cloud; the data stays
 * safe in Supabase and returns on the next sign-in. Only used where a synced
 * household exists (see AccountPanel).
 */
async function signOutAndClear(): Promise<void> {
  await stopSync();
  await clearAllData();
  await signOut();
}

/** Bordered surface card used for the account blocks on the Data tab. */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-rule rounded-md p-3 mb-4">
      {children}
    </div>
  );
}

/**
 * The account block on the Data tab. The app itself runs with no sign-in — this
 * is where a user opts into the shared cloud ledger. States, in order:
 * checking → sign-in prompt → create/join a household → live household panel.
 */
export function AccountSection({
  session,
  authLoading,
  household,
  onHouseholdReady,
}: {
  session: Session | null;
  authLoading: boolean;
  household: Household | null | undefined;
  onHouseholdReady: (h: Household) => void;
}) {
  if (!session) {
    if (authLoading)
      return (
        <Card>
          <div className="text-[13px] text-ink-soft">Checking sign-in…</div>
        </Card>
      );
    return <SignInCard />;
  }
  if (household === undefined)
    return (
      <Card>
        <div className="text-[13px] text-ink-soft">
          Loading your shared ledger…
        </div>
      </Card>
    );
  if (household === null) return <HouseholdSetupCard onReady={onHouseholdReady} />;
  return <AccountPanel household={household} email={session.user.email} />;
}

/** Passwordless email sign-in (6-digit code), inline on the Data tab. */
function SignInCard() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<
    "idle" | "sending" | "sent" | "verifying"
  >("idle");
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
      setError(err instanceof Error ? err.message : "Could not send the email.");
    }
  };

  const verify = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setStatus("verifying");
    try {
      // On success, onAuthStateChange (useAuth) flips the app to signed-in.
      await verifyEmailCode(email, code);
    } catch (err) {
      setStatus("sent");
      setError(
        err instanceof Error ? err.message : "That code didn't work. Try again.",
      );
    }
  };

  return (
    <Card>
      <div className="text-[11px] uppercase tracking-[0.15em] text-ink-soft mb-2">
        Shared ledger
      </div>
      {status === "sent" || status === "verifying" ? (
        <div className="space-y-2">
          <div className="text-sm">
            We emailed a 6-digit sign-in code to <b>{email.trim()}</b>.
          </div>
          <label className="field-label" htmlFor="login-code">
            Enter the code
          </label>
          <input
            id="login-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="input tracking-[0.4em] text-center text-lg"
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && void verify()}
          />
          {error && <div className="text-[13px] text-crimson">{error}</div>}
          <button
            className="btn btn-primary w-full !py-2.5"
            disabled={status === "verifying"}
            onClick={() => void verify()}
          >
            {status === "verifying" ? "Signing in…" : "Verify & sign in"}
          </button>
          <p className="text-[12px] text-ink-soft">
            On iPhone, use this code (not the link in the email) so you stay
            signed in inside the installed app.
          </p>
          <button
            className="text-[12px] text-ink-soft underline"
            onClick={() => {
              setStatus("idle");
              setCode("");
              setError(null);
            }}
          >
            Use a different email
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[13px] text-ink-soft">
            Your entries live on this device. Sign in to back them up and sync
            across phones — no password, just a 6-digit email code.
          </p>
          <label className="field-label" htmlFor="login-email">
            Email
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
          {error && <div className="text-[13px] text-crimson">{error}</div>}
          <button
            className="btn btn-primary w-full !py-2.5"
            disabled={status === "sending"}
            onClick={() => void submit()}
          >
            {status === "sending" ? "Sending…" : "Email me a code"}
          </button>
        </div>
      )}
    </Card>
  );
}

/** First sign-in: create a household or join an existing one by code. */
function HouseholdSetupCard({ onReady }: { onReady: (h: Household) => void }) {
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
    <Card>
      <div className="text-[11px] uppercase tracking-[0.15em] text-ink-soft mb-2">
        Set up your shared ledger
      </div>
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
          className="btn btn-primary w-full !py-2.5"
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
    </Card>
  );
}

/** Live household panel: name, invite code, sign-out. */
function AccountPanel({
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
    <Card>
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
        onClick={() => {
          if (
            window.confirm(
              "Sign out and remove this ledger from this device? Your data stays safe in the cloud and comes back when you sign in again. (Recommended on a shared phone.)",
            )
          )
            void signOutAndClear();
        }}
      >
        Sign out &amp; clear this device
      </button>
    </Card>
  );
}
