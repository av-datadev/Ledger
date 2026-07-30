import { useEffect, useState } from "react";
import {
  listContractors,
  contractorPhotoUrl,
  type Contractor,
} from "../lib/contractors";
import { inr, formatDate } from "../lib/format";

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

/**
 * One directory listing. Collapsed it shows only the name and number — the two
 * things you need to make contact — so a long list stays scannable. Tapping it
 * opens the full record: every rate, references, terms and photos, which had no
 * way to be seen before (the rate card was cut off at three lines and the
 * references, advance % and payment terms were never rendered at all).
 */
function ContractorCard({ contractor: c }: { contractor: Contractor }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-surface border border-rule rounded-md overflow-hidden">
      <button
        type="button"
        className="w-full text-left p-3 flex items-start justify-between gap-2"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">{c.name}</div>
          <div className="text-[12px] text-ink-soft money">{c.phone}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[11px] font-medium ${AVAILABILITY_CLASS[c.availability]}`}
          >
            {AVAILABILITY_LABEL[c.availability]}
          </span>
          <span
            className={`text-ink-soft transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          >
            ›
          </span>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-rule pt-2.5">
          <div className="text-[12px] text-ink-soft">
            {c.contractorType === "general" ? "General Contractor" : "Specialist"}
            {c.area ? ` · ${c.area}` : ""}
            {c.city ? ` · ${c.city}` : ""}
          </div>

          {c.trades.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {c.trades.map((t) => (
                <span key={t} className="badge">
                  {t}
                </span>
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

          {(c.yearsExperience || c.teamSize) && (
            <div className="text-[12px] text-ink-soft">
              {c.yearsExperience ? `${c.yearsExperience} yrs experience` : ""}
              {c.yearsExperience && c.teamSize ? " · " : ""}
              {c.teamSize ? `team of ${c.teamSize}` : ""}
            </div>
          )}

          {c.rateCard.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-soft mb-1">
                Rates
              </div>
              <div className="text-[12px] space-y-0.5">
                {c.rateCard.map((r, i) => (
                  <div key={i} className="flex justify-between gap-2">
                    <span className="text-ink-soft">
                      {r.item}
                      {r.materialIncluded ? " (with material)" : " (labour only)"}
                    </span>
                    <span className="money shrink-0">
                      {inr(r.rate)}/{r.unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(c.advancePct != null || c.paymentTerms) && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-soft mb-1">
                Payment
              </div>
              {c.advancePct != null && (
                <div className="text-[12px] text-ink-soft">
                  Advance: {c.advancePct}%
                </div>
              )}
              {c.paymentTerms && (
                <div className="text-[12px] text-ink-soft">{c.paymentTerms}</div>
              )}
            </div>
          )}

          {c.references.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-soft mb-1">
                References
              </div>
              <div className="space-y-0.5">
                {c.references.map((r, i) => (
                  <a
                    key={i}
                    href={`tel:${r.phone}`}
                    className="flex justify-between gap-2 text-[12px]"
                  >
                    <span>{r.name}</span>
                    <span className="money text-ink-soft">{r.phone}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {c.freeFrom && (
            <div className="text-[12px] text-ink-soft">
              Free from {formatDate(c.freeFrom)}
            </div>
          )}

          {c.vouchedBy && (
            <div className="text-[11px] text-moss">
              Vouched for by {c.vouchedBy}
            </div>
          )}

          <a
            href={`tel:${c.phone}`}
            className="btn btn-primary w-full !py-2 block text-center"
          >
            Call {c.phone}
          </a>
        </div>
      )}
    </div>
  );
}
