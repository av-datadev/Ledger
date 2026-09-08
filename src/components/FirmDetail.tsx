import { useMemo, useState } from "react";
import {
  contractorPhotoUrl,
  type Contractor,
  type FirmMember,
} from "../lib/contractors";
import { inr, formatDate } from "../lib/format";
import { EngageTeamSheet } from "./EngageTeamSheet";
import { DirectoryHeader, AvailabilityBadge } from "./DirectoryChrome";

/** Group the roster by trade, keeping the seniority order within each. */
function byTrade(members: FirmMember[]): [string, FirmMember[]][] {
  const groups = new Map<string, FirmMember[]>();
  for (const m of members) {
    const list = groups.get(m.trade) ?? [];
    list.push(m);
    groups.set(m.trade, list);
  }
  return [...groups.entries()];
}

/**
 * One firm, and the people in it.
 *
 * The roster is the screen. A firm's trades and team size are read off it
 * rather than typed, so what you see here IS what the directory knows — there
 * is no second, hand-maintained claim that can drift away from the list.
 */
export function FirmDetail({
  firm,
  onBack,
  onOpenMember,
}: {
  firm: Contractor;
  onBack: () => void;
  onOpenMember: (m: FirmMember) => void;
}) {
  const [engaging, setEngaging] = useState(false);
  const groups = useMemo(() => byTrade(firm.members), [firm.members]);

  return (
    <div className="px-4 py-4 max-w-lg mx-auto space-y-3">
      <DirectoryHeader
        eyebrow="Directory"
        title={firm.name}
        onBack={onBack}
        backLabel="Contractors"
      />

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge">
            {firm.contractorType === "general" ? "General contractor" : "Specialist"}
          </span>
          <AvailabilityBadge value={firm.availability} />
          <span className="text-[12px] text-ink-soft">
            {firm.area ? `${firm.area}` : firm.city}
            {firm.yearsExperience ? ` · ${firm.yearsExperience} yrs` : ""}
          </span>
        </div>
        {firm.freeFrom && (
          <div className="text-[12px] text-ink-soft mt-1">
            Free from {formatDate(firm.freeFrom)}
          </div>
        )}
        {firm.vouchedBy && (
          <div className="text-[12px] text-moss mt-1">
            Vouched for by {firm.vouchedBy}
          </div>
        )}
      </div>

      <a
        href={`tel:${firm.phone}`}
        className="btn btn-primary w-full !py-3 !text-base block text-center"
      >
        Call {firm.phone}
      </a>

      {firm.members.length > 0 ? (
        <div>
          <h3 className="eyebrow mb-1.5">
            Team · {firm.members.length}{" "}
            {firm.members.length === 1 ? "person" : "people"}
          </h3>
          <div className="card overflow-hidden">
            {groups.map(([trade, people], gi) => (
              <div key={trade} className={gi > 0 ? "border-t border-rule" : ""}>
                <div className="px-3 pt-2.5 pb-1">
                  <span className="eyebrow">{trade}</span>
                </div>
                {people.map((m, i) => (
                  <button
                    key={m.id}
                    className={`w-full text-left px-3 py-2.5 min-h-11 flex items-center
                                justify-between gap-2 ${i > 0 ? "border-t border-rule" : ""}`}
                    onClick={() => onOpenMember(m)}
                  >
                    <span className="min-w-0">
                      <span className="text-[13px] font-medium block truncate">
                        {m.name}
                      </span>
                      <span className="text-[12px] text-ink-soft">
                        {m.yearsExperience ? `${m.yearsExperience} yrs` : "—"}
                        {m.isLead ? " · lead" : ""}
                        {!m.phone ? " · no direct number" : ""}
                      </span>
                    </span>
                    <span className="text-ink-faint shrink-0" aria-hidden>
                      ›
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-md bg-paper-2 p-3">
          <p className="text-[13px] text-ink-soft">
            The team for this firm has not been listed yet — call to ask who
            they would put on the job.
          </p>
        </div>
      )}

      {firm.rateCard.length > 0 && (
        <div>
          <h3 className="eyebrow mb-1.5">Rate card</h3>
          <div className="card divide-y divide-rule">
            {firm.rateCard.map((r, i) => (
              <div key={i} className="flex justify-between gap-2 p-3">
                <span className="min-w-0">
                  <span className="text-[13px] font-medium block">{r.item}</span>
                  <span className="text-[12px] text-ink-soft">
                    per {r.unit} ·{" "}
                    {r.materialIncluded ? "material included" : "labour only"}
                  </span>
                </span>
                <span className="money text-[13px] shrink-0">{inr(r.rate)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {firm.photos.length > 0 && (
        <div>
          <h3 className="eyebrow mb-1.5">Work photos</h3>
          <div className="flex gap-2 overflow-x-auto -mx-1 px-1">
            {firm.photos.map((p) => (
              <img
                key={p}
                src={contractorPhotoUrl(p)}
                alt=""
                className="w-24 h-24 object-cover rounded shrink-0 border border-rule"
              />
            ))}
          </div>
        </div>
      )}

      {(firm.advancePct != null || firm.paymentTerms) && (
        <div>
          <h3 className="eyebrow mb-1.5">Payment</h3>
          {firm.advancePct != null && (
            <div className="text-[13px] text-ink-soft">
              Advance {firm.advancePct}%
            </div>
          )}
          {firm.paymentTerms && (
            <div className="text-[13px] text-ink-soft">{firm.paymentTerms}</div>
          )}
        </div>
      )}

      {firm.references.length > 0 && (
        <div>
          <h3 className="eyebrow mb-1.5">References</h3>
          <div className="card divide-y divide-rule">
            {firm.references.map((r, i) => (
              <a
                key={i}
                href={`tel:${r.phone}`}
                className="flex justify-between gap-2 p-3 min-h-11 items-center"
              >
                <span className="text-[13px]">{r.name}</span>
                <span className="money text-[12px] text-ink-soft">{r.phone}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {firm.members.length > 0 && (
        <button
          className="btn btn-primary w-full !py-3 !text-base"
          onClick={() => setEngaging(true)}
        >
          I've hired them
        </button>
      )}

      {engaging && (
        <EngageTeamSheet
          firmName={firm.name}
          candidates={firm.members.map((m) => ({
            name: m.name,
            trade: m.trade,
            phone: m.phone,
          }))}
          onClose={() => setEngaging(false)}
        />
      )}
    </div>
  );
}
