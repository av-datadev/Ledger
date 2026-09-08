import { useCallback, useEffect, useState } from "react";
import {
  listContractors,
  listAllMembers,
  createMember,
  linkMemberToFirm,
  unlinkMemberFromFirm,
  type Contractor,
  type Member,
  type RateLine,
} from "../lib/contractors";

const TRADES = [
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
 * Admin-only: build a firm's roster.
 *
 * Two ways in, because the join is many-to-many and both cases are real: add a
 * new person to the directory, or put someone already listed onto this firm as
 * well. The second is the one that matters — an electrician working with three
 * builders should be one record on three rosters, not three records that drift
 * apart the moment one of them changes their number.
 *
 * RLS is the actual gate (is_directory_admin); this screen only being reachable
 * for the admin email is UI convenience.
 */
export function ManageRoster() {
  const [firms, setFirms] = useState<Contractor[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [firmId, setFirmId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // New-person fields.
  const [name, setName] = useState("");
  const [trade, setTrade] = useState(TRADES[0]);
  const [years, setYears] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneConsent, setPhoneConsent] = useState(false);
  const [isLead, setIsLead] = useState(false);
  const [rateItem, setRateItem] = useState("");
  const [rateUnit, setRateUnit] = useState("sq ft");
  const [rateValue, setRateValue] = useState("");
  const [rateMaterial, setRateMaterial] = useState(false);

  // Existing-person link.
  const [linkId, setLinkId] = useState("");

  const load = useCallback(async () => {
    try {
      const [f, m] = await Promise.all([
        listContractors("Moradabad"),
        listAllMembers("Moradabad"),
      ]);
      setFirms(f);
      setMembers(m);
      setFirmId((cur) => cur || f[0]?.id || "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const firm = firms?.find((f) => f.id === firmId) ?? null;

  const addNew = async () => {
    if (!firmId || !name.trim()) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const rateCard: RateLine[] = rateItem.trim()
        ? [
            {
              item: rateItem.trim(),
              unit: rateUnit.trim() || "sq ft",
              rate: Number(rateValue) || 0,
              materialIncluded: rateMaterial,
            },
          ]
        : [];
      const created = await createMember({
        name: name.trim(),
        trade,
        city: "Moradabad",
        phone: phone.trim(),
        phoneConsent,
        yearsExperience: years ? Number(years) : null,
        rateCard,
      });
      await linkMemberToFirm(firmId, created.id, isLead);
      setNote(`${created.name} added to ${firm?.name ?? "the firm"}.`);
      setName("");
      setYears("");
      setPhone("");
      setPhoneConsent(false);
      setIsLead(false);
      setRateItem("");
      setRateValue("");
      setRateMaterial(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add.");
    } finally {
      setBusy(false);
    }
  };

  const linkExisting = async () => {
    if (!firmId || !linkId) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await linkMemberToFirm(firmId, linkId, false);
      setNote("Added to this firm's roster.");
      setLinkId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link.");
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (memberId: string) => {
    setBusy(true);
    setError(null);
    try {
      await unlinkMemberFromFirm(firmId, memberId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove.");
    } finally {
      setBusy(false);
    }
  };

  const onRoster = new Set(firm?.members.map((m) => m.id) ?? []);
  const linkable = members.filter((m) => !onRoster.has(m.id));

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">Team rosters</h3>
        <p className="text-[13px] text-ink-soft mt-0.5">
          A firm's trades and team size are read off this list — they are no
          longer typed in.
        </p>
      </div>

      {error && <div className="text-[13px] text-danger">{error}</div>}
      {note && <div className="text-[13px] text-moss">{note}</div>}

      <div>
        <label className="field-label" htmlFor="roster-firm">
          Firm
        </label>
        <select
          id="roster-firm"
          className="input"
          value={firmId}
          onChange={(e) => setFirmId(e.target.value)}
        >
          {(firms ?? []).map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      {firm && (
        <div className="card divide-y divide-rule">
          {firm.members.length === 0 && (
            <div className="p-3 text-[13px] text-ink-soft">
              No one on this roster yet.
            </div>
          )}
          {firm.members.map((m) => (
            <div key={m.id} className="p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-medium truncate">
                  {m.name}
                  {m.isLead ? " · lead" : ""}
                </div>
                <div className="text-[12px] text-ink-soft">
                  {m.trade}
                  {m.yearsExperience ? ` · ${m.yearsExperience} yrs` : ""}
                  {m.phone ? ` · ${m.phone}` : " · no listed number"}
                </div>
              </div>
              <button
                className="btn btn-danger !py-1.5 !px-2.5 text-[12px] shrink-0"
                onClick={() => void unlink(m.id)}
                disabled={busy}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-rule pt-3 space-y-2">
        <h4 className="eyebrow">Add someone new</h4>
        <input
          className="input"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex gap-2">
          <select
            className="input flex-1"
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            aria-label="Trade"
          >
            {TRADES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input
            className="input w-24"
            inputMode="numeric"
            placeholder="Years"
            value={years}
            onChange={(e) => setYears(e.target.value)}
            aria-label="Years of experience"
          />
        </div>

        <div className="rounded-md bg-paper-2 p-3 space-y-2">
          <label className="flex items-start gap-2.5 text-[13px] min-h-11 items-center">
            <input
              type="checkbox"
              className="w-[18px] h-[18px] accent-crimson shrink-0"
              checked={phoneConsent}
              onChange={(e) => setPhoneConsent(e.target.checked)}
            />
            <span>
              This person has agreed to have their own number listed publicly.
            </span>
          </label>
          <input
            className="input"
            inputMode="tel"
            placeholder={
              phoneConsent ? "Their phone number" : "Consent needed first"
            }
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={!phoneConsent}
            aria-label="Member phone"
          />
          <p className="text-[12px] text-ink-faint">
            Their number is their own data, and the firm cannot agree on their
            behalf. Without consent they are listed under the firm and callers
            are pointed at the firm's number instead. The database refuses to
            store one either way.
          </p>
        </div>

        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Rate item (optional)"
            value={rateItem}
            onChange={(e) => setRateItem(e.target.value)}
          />
          <input
            className="input w-24"
            inputMode="decimal"
            placeholder="₹"
            value={rateValue}
            onChange={(e) => setRateValue(e.target.value)}
            aria-label="Rate"
          />
        </div>
        {rateItem.trim() !== "" && (
          <div className="flex gap-2 items-center">
            <input
              className="input flex-1"
              placeholder="Unit"
              value={rateUnit}
              onChange={(e) => setRateUnit(e.target.value)}
              aria-label="Rate unit"
            />
            <label className="flex items-center gap-2 text-[13px] shrink-0">
              <input
                type="checkbox"
                className="w-[18px] h-[18px] accent-crimson"
                checked={rateMaterial}
                onChange={(e) => setRateMaterial(e.target.checked)}
              />
              With material
            </label>
          </div>
        )}

        <label className="flex items-center gap-2.5 text-[13px] min-h-11">
          <input
            type="checkbox"
            className="w-[18px] h-[18px] accent-crimson"
            checked={isLead}
            onChange={(e) => setIsLead(e.target.checked)}
          />
          Team lead for this firm
        </label>

        <button
          className="btn btn-primary w-full !py-2.5"
          onClick={() => void addNew()}
          disabled={busy || !name.trim() || !firmId}
        >
          {busy ? "Saving…" : "Add to roster"}
        </button>
      </div>

      {linkable.length > 0 && (
        <div className="border-t border-rule pt-3 space-y-2">
          <h4 className="eyebrow">Or add someone already listed</h4>
          <p className="text-[12px] text-ink-soft">
            One person, several firms — the same record on each roster.
          </p>
          <div className="flex gap-2">
            <select
              className="input flex-1"
              value={linkId}
              onChange={(e) => setLinkId(e.target.value)}
              aria-label="Existing person"
            >
              <option value="">Choose someone…</option>
              {linkable.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.trade}
                </option>
              ))}
            </select>
            <button
              className="btn shrink-0"
              onClick={() => void linkExisting()}
              disabled={busy || !linkId}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
