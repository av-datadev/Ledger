import { useState } from "react";
import {
  createContractor,
  uploadContractorPhoto,
  updateContractorPhotos,
  type ContractorType,
  type Availability,
  type RateLine,
  type Reference,
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

const blankRate = (): RateLine => ({
  item: "",
  unit: "per sq ft",
  rate: 0,
  materialIncluded: false,
});
const blankRef = (): Reference => ({ name: "", phone: "" });

/**
 * Internal, admin-only screen for hand-onboarding a contractor listing (see
 * is_directory_admin in the Supabase migration — RLS is the real gate; this
 * component only being reachable from the Data tab for the admin email is
 * just UI convenience, not the security boundary).
 */
export function AddContractorAdmin({ adminName }: { adminName: string }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [area, setArea] = useState("");
  const [yearsExperience, setYearsExperience] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [contractorType, setContractorType] = useState<ContractorType>("general");
  const [trades, setTrades] = useState<string[]>([]);
  const [rateCard, setRateCard] = useState<RateLine[]>([blankRate()]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [availability, setAvailability] = useState<Availability>("available");
  const [freeFrom, setFreeFrom] = useState("");
  const [references, setReferences] = useState<Reference[]>([blankRef()]);
  const [advancePct, setAdvancePct] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [notes, setNotes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleTrade = (t: string) =>
    setTrades((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const reset = () => {
    setName("");
    setPhone("");
    setArea("");
    setYearsExperience("");
    setTeamSize("");
    setContractorType("general");
    setTrades([]);
    setRateCard([blankRate()]);
    setPhotos([]);
    setAvailability("available");
    setFreeFrom("");
    setReferences([blankRef()]);
    setAdvancePct("");
    setPaymentTerms("");
  };

  const submit = async () => {
    setError(null);
    setNotes(null);
    if (!name.trim() || !/^\d{10}$/.test(phone.trim())) {
      setError("Name and a 10-digit phone number are required.");
      return;
    }
    if (trades.length === 0) {
      setError("Pick at least one trade.");
      return;
    }
    setBusy(true);
    try {
      const cleanRates = rateCard.filter((r) => r.item.trim() && r.rate > 0);
      const cleanRefs = references.filter((r) => r.name.trim() && r.phone.trim());
      const created = await createContractor({
        name: name.trim(),
        phone: phone.trim(),
        city: "Moradabad",
        area: area.trim(),
        yearsExperience: yearsExperience ? Number(yearsExperience) : null,
        teamSize: teamSize ? Number(teamSize) : null,
        contractorType,
        trades,
        rateCard: cleanRates,
        photoPaths: [],
        availability,
        freeFrom: freeFrom || null,
        vouchedBy: adminName,
        references: cleanRefs,
        advancePct: advancePct ? Number(advancePct) : null,
        paymentTerms: paymentTerms.trim(),
      });
      if (photos.length > 0) {
        const paths = await Promise.all(
          photos.map((f) => uploadContractorPhoto(created.id, f)),
        );
        await updateContractorPhotos(created.id, paths);
      }
      setNotes(`Added ${created.name} to the directory.`);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that contractor.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[11px] uppercase tracking-[0.15em] text-ink-soft">
          Admin: Add contractor (Moradabad)
        </h2>
        <p className="text-[12px] text-ink-soft mt-0.5">
          Only visible to you. This goes straight into the public directory.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label" htmlFor="ac-name">Name</label>
          <input id="ac-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="ac-phone">Phone</label>
          <input
            id="ac-phone"
            className="input"
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="field-label" htmlFor="ac-area">Area</label>
          <input id="ac-area" className="input" value={area} onChange={(e) => setArea(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="ac-years">Years exp.</label>
          <input id="ac-years" type="number" className="input" value={yearsExperience} onChange={(e) => setYearsExperience(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="ac-team">Team size</label>
          <input id="ac-team" type="number" className="input" value={teamSize} onChange={(e) => setTeamSize(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="field-label">Type</label>
        <div className="flex gap-1.5">
          {(["general", "specialist"] as const).map((t) => (
            <button
              key={t}
              className={`flex-1 text-[13px] rounded px-3 py-2 border ${
                contractorType === t ? "bg-ink text-paper border-ink" : "border-rule text-ink-soft"
              }`}
              onClick={() => setContractorType(t)}
            >
              {t === "general" ? "General Contractor" : "Trade Specialist"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="field-label">Trades</label>
        <div className="flex flex-wrap gap-1.5">
          {TRADES.map((t) => (
            <button
              key={t}
              className={`text-[12px] rounded px-2.5 py-1.5 border ${
                trades.includes(t) ? "bg-ink text-paper border-ink" : "border-rule text-ink-soft"
              }`}
              onClick={() => toggleTrade(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="field-label">Rate card</label>
        {rateCard.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_90px_80px_auto] gap-1.5 items-center">
            <input
              className="input !text-[13px]"
              placeholder="Work item"
              value={r.item}
              onChange={(e) =>
                setRateCard((rows) => rows.map((row, j) => (j === i ? { ...row, item: e.target.value } : row)))
              }
            />
            <select
              className="input !text-[13px]"
              value={r.unit}
              onChange={(e) =>
                setRateCard((rows) => rows.map((row, j) => (j === i ? { ...row, unit: e.target.value } : row)))
              }
            >
              <option>per sq ft</option>
              <option>per day</option>
              <option>per job</option>
              <option>per unit</option>
            </select>
            <input
              type="number"
              className="input !text-[13px]"
              placeholder="₹"
              value={r.rate || ""}
              onChange={(e) =>
                setRateCard((rows) => rows.map((row, j) => (j === i ? { ...row, rate: Number(e.target.value) } : row)))
              }
            />
            <button
              className="text-[11px] text-ink-soft underline"
              onClick={() => setRateCard((rows) => rows.filter((_, j) => j !== i))}
            >
              remove
            </button>
            <label className="col-span-4 text-[12px] text-ink-soft flex items-center gap-1.5 -mt-1">
              <input
                type="checkbox"
                checked={r.materialIncluded}
                onChange={(e) =>
                  setRateCard((rows) =>
                    rows.map((row, j) => (j === i ? { ...row, materialIncluded: e.target.checked } : row)),
                  )
                }
              />
              Material included
            </label>
          </div>
        ))}
        <button
          className="text-[12px] text-ink-soft underline"
          onClick={() => setRateCard((rows) => [...rows, blankRate()])}
        >
          + Add another rate
        </button>
      </div>

      <div>
        <label className="field-label" htmlFor="ac-photos">Photos of past work</label>
        <input
          id="ac-photos"
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setPhotos(e.target.files ? Array.from(e.target.files) : [])}
        />
        {photos.length > 0 && (
          <div className="text-[12px] text-ink-soft mt-1">{photos.length} photo(s) selected</div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Availability</label>
          <select
            className="input"
            value={availability}
            onChange={(e) => setAvailability(e.target.value as Availability)}
          >
            <option value="available">Available now</option>
            <option value="partial">Partially booked</option>
            <option value="booked">Fully booked</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="ac-freefrom">Free from (if booked)</label>
          <input id="ac-freefrom" type="date" className="input" value={freeFrom} onChange={(e) => setFreeFrom(e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <label className="field-label">References (optional)</label>
        {references.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
            <input
              className="input !text-[13px]"
              placeholder="Name"
              value={r.name}
              onChange={(e) =>
                setReferences((rows) => rows.map((row, j) => (j === i ? { ...row, name: e.target.value } : row)))
              }
            />
            <input
              className="input !text-[13px]"
              placeholder="Phone"
              value={r.phone}
              onChange={(e) =>
                setReferences((rows) => rows.map((row, j) => (j === i ? { ...row, phone: e.target.value } : row)))
              }
            />
            <button
              className="text-[11px] text-ink-soft underline"
              onClick={() => setReferences((rows) => rows.filter((_, j) => j !== i))}
            >
              remove
            </button>
          </div>
        ))}
        <button
          className="text-[12px] text-ink-soft underline"
          onClick={() => setReferences((rows) => [...rows, blankRef()])}
        >
          + Add reference
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label" htmlFor="ac-advance">Advance % expected</label>
          <input id="ac-advance" type="number" className="input" value={advancePct} onChange={(e) => setAdvancePct(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="ac-terms">Payment terms</label>
          <input id="ac-terms" className="input" placeholder="30% advance, 40% at lintel…" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
        </div>
      </div>

      {error && <div className="text-[13px] text-crimson">{error}</div>}
      {notes && <div className="text-[13px] text-moss">{notes}</div>}
      <button className="btn btn-primary w-full !py-3" disabled={busy} onClick={() => void submit()}>
        {busy ? "Saving…" : "Add to directory"}
      </button>
    </div>
  );
}
