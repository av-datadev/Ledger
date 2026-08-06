import { useState } from "react";
import { submitContractorLead } from "../lib/contractors";
import { FindContractor } from "./FindContractor";

const SENT_KEY = "hl-contractor-lead-sent";

const TRADES = [
  "General Contractor",
  "Masonry",
  "Tiling",
  "Electrical",
  "Plumbing",
  "Painting",
  "Carpentry",
  "Aluminium/Windows",
  "AC",
  "Other",
];

/**
 * Shown to a device that chose "I'm a contractor" at the role gate.
 * Self-serve listing isn't built yet (listings are hand-onboarded — see
 * AddContractorAdmin) — this just captures interest for a follow-up call.
 */
export function ContractorLeadForm({
  onSwitchToBuilder,
  embedded = false,
}: {
  onSwitchToBuilder: () => void;
  /** Rendered inside ContractorHome, which already supplies the app shell and
   * header — drop this component's own so there aren't two. */
  embedded?: boolean;
}) {
  const [sent, setSent] = useState(
    () => localStorage.getItem(SENT_KEY) === "1",
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [trade, setTrade] = useState(TRADES[0]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("Enter your name.");
    if (!/^\d{10}$/.test(phone.trim())) return setError("Enter a 10-digit phone number.");
    setBusy(true);
    try {
      await submitContractorLead({
        name: name.trim(),
        phone: phone.trim(),
        city: "Moradabad",
        trade,
        notes: notes.trim(),
      });
      try {
        localStorage.setItem(SENT_KEY, "1");
      } catch {
        /* private mode — still show the thank-you for this session */
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={embedded ? "" : "min-h-dvh bg-paper text-ink"}>
      {!embedded && (
        <header className="bg-header text-onhead sticky top-0 z-30 px-4 h-12 flex items-center justify-between border-b border-black/30">
          <h1 className="text-sm font-semibold tracking-[0.18em]">BRICK BOOK</h1>
          <button
            onClick={onSwitchToBuilder}
            className="text-onhead/90 active:text-onhead text-[11px] border border-onhead/30 rounded px-2 py-1"
            title="Switch back to the home builder side"
          >
            Home builder view
          </button>
        </header>
      )}

      <div className="px-6 py-5 mx-auto max-w-sm space-y-5">

        {sent ? (
          <div className="text-center space-y-3">
            <div className="text-2xl">✅</div>
            <div className="text-sm">
              Thanks — we've got your details and will call you to get you
              listed.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-soft text-center">
              We're onboarding contractors in Moradabad by hand right now.
              Leave your details and we'll call you.
            </p>
            <div>
              <label className="field-label" htmlFor="lead-name">Name</label>
              <input
                id="lead-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="lead-phone">Phone</label>
              <input
                id="lead-phone"
                type="tel"
                inputMode="numeric"
                className="input"
                placeholder="10-digit number"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="lead-trade">What do you do</label>
              <select
                id="lead-trade"
                className="input"
                value={trade}
                onChange={(e) => setTrade(e.target.value)}
              >
                {TRADES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="lead-notes">Anything else (optional)</label>
              <input
                id="lead-notes"
                className="input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            {error && <div className="text-[13px] text-crimson">{error}</div>}
            <button
              className="btn btn-primary w-full !py-3"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? "Sending…" : "Submit"}
            </button>
          </div>
        )}

      </div>

      {/* The live public directory — the same list homeowners browse, so a
          newly added listing can be verified from this side too. Skipped when
          embedded: ContractorHome already shows the directory above this form. */}
      {!embedded && (
        <div className="border-t border-rule">
          <FindContractor />
        </div>
      )}
    </div>
  );
}
