import { useEffect, useState } from "react";
import {
  listContractors,
  contractorPhotoUrl,
  type Contractor,
} from "../lib/contractors";
import { inr } from "../lib/format";

const AVAILABILITY_LABEL: Record<Contractor["availability"], string> = {
  available: "Available now",
  partial: "Partially booked",
  booked: "Fully booked",
};

const AVAILABILITY_CLASS: Record<Contractor["availability"], string> = {
  available: "text-moss",
  partial: "text-ink-soft",
  booked: "text-crimson",
};

/** Public directory browse — no sign-in required. Moradabad only, for now. */
export function FindContractor() {
  const [contractors, setContractors] = useState<Contractor[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listContractors("Moradabad")
      .then((rows) => alive && setContractors(rows))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Could not load contractors."));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="px-4 py-4 max-w-lg mx-auto space-y-3">
      <div>
        <h2 className="text-[11px] uppercase tracking-[0.15em] text-ink-soft">
          Contractors in Moradabad
        </h2>
        <p className="text-[12px] text-ink-soft mt-0.5">
          A hand-picked list to start — more added as they're onboarded.
        </p>
      </div>

      {error && <div className="text-[13px] text-crimson">{error}</div>}
      {contractors === null && !error && (
        <div className="text-[13px] text-ink-soft">Loading…</div>
      )}
      {contractors?.length === 0 && (
        <div className="text-[13px] text-ink-soft">
          No contractors listed yet — check back soon.
        </div>
      )}

      <div className="space-y-3">
        {contractors?.map((c) => (
          <ContractorCard key={c.id} contractor={c} />
        ))}
      </div>
    </div>
  );
}

function ContractorCard({ contractor: c }: { contractor: Contractor }) {
  return (
    <div className="bg-surface border border-rule rounded-md p-3 space-y-2">
      <div className="flex justify-between items-start">
        <div>
          <div className="font-semibold text-sm">{c.name}</div>
          <div className="text-[12px] text-ink-soft">
            {c.contractorType === "general" ? "General Contractor" : "Specialist"}
            {c.area ? ` · ${c.area}` : ""}
          </div>
        </div>
        <span className={`text-[11px] font-medium ${AVAILABILITY_CLASS[c.availability]}`}>
          {AVAILABILITY_LABEL[c.availability]}
        </span>
      </div>

      {c.trades.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {c.trades.map((t) => (
            <span key={t} className="badge">{t}</span>
          ))}
        </div>
      )}

      {c.photos.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1">
          {c.photos.map((p) => (
            <img
              key={p}
              src={contractorPhotoUrl(p)}
              alt=""
              className="w-20 h-20 object-cover rounded shrink-0 border border-rule"
            />
          ))}
        </div>
      )}

      {c.rateCard.length > 0 && (
        <div className="text-[12px] text-ink-soft space-y-0.5">
          {c.rateCard.slice(0, 3).map((r, i) => (
            <div key={i} className="flex justify-between">
              <span>{r.item}{r.materialIncluded ? "" : " (labour only)"}</span>
              <span className="money">{inr(r.rate)}/{r.unit}</span>
            </div>
          ))}
          {c.rateCard.length > 3 && (
            <div>+{c.rateCard.length - 3} more</div>
          )}
        </div>
      )}

      {(c.yearsExperience || c.teamSize) && (
        <div className="text-[12px] text-ink-soft">
          {c.yearsExperience ? `${c.yearsExperience} yrs experience` : ""}
          {c.yearsExperience && c.teamSize ? " · " : ""}
          {c.teamSize ? `team of ${c.teamSize}` : ""}
        </div>
      )}

      {c.vouchedBy && (
        <div className="text-[11px] text-moss">Vouched for by {c.vouchedBy}</div>
      )}

      <a href={`tel:${c.phone}`} className="btn btn-primary w-full !py-2 block text-center">
        Call {c.phone}
      </a>
    </div>
  );
}
