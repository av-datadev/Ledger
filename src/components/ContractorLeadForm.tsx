import { useState } from "react";
import { submitContractorLead } from "../lib/contractors";

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
}: {
  onSwitchToBuilder: () => void;
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
    <div className="min-h-dvh bg-paper text-ink flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center">
          <div className="text-lg font-semibold tracking-[0.18em]">
            BRICK FLOW
          </div>
        </div>

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

        <button
          className="text-[12px] text-ink-soft underline w-full text-center"
          onClick={onSwitchToBuilder}
        >
          Actually, I'm building or renovating a home →
        </button>
      </div>
    </div>
  );
}
