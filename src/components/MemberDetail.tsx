import { useEffect, useState } from "react";
import {
  listMemberFirms,
  contractorPhotoUrl,
  type Contractor,
  type FirmMember,
} from "../lib/contractors";
import { inr } from "../lib/format";
import { EngageTeamSheet } from "./EngageTeamSheet";

const AVAILABILITY_LABEL: Record<FirmMember["availability"], string> = {
  available: "Available now",
  partial: "Partly booked",
  booked: "Fully booked",
};

/**
 * One person in the directory.
 *
 * A member is hireable in their own right, so this screen has to answer two
 * questions honestly: what they do, and who they work with. The second one is
 * why the firm link is many-to-many — a good electrician is on two or three
 * builders' rosters, and a screen claiming they belong to one would be wrong
 * about the most useful fact on it.
 */
export function MemberDetail({
  member,
  viaFirm,
  onBack,
  onOpenFirm,
}: {
  member: FirmMember;
  /** The firm whose roster you arrived through, if any. */
  viaFirm: Contractor | null;
  onBack: () => void;
  onOpenFirm: (firm: Contractor) => void;
}) {
  const [firms, setFirms] = useState<Contractor[] | null>(null);
  const [engaging, setEngaging] = useState(false);

  useEffect(() => {
    let alive = true;
    listMemberFirms(member.id)
      .then((rows) => alive && setFirms(rows))
      // The roster is a nicety, not the point of the screen — a failure here
      // shows nothing rather than replacing the person with an error.
      .catch(() => alive && setFirms([]));
    return () => {
      alive = false;
    };
  }, [member.id]);

  const others = (firms ?? []).filter((f) => f.id !== viaFirm?.id);

  return (
    <div className="px-4 py-4 max-w-lg mx-auto space-y-3">
      <button className="btn !py-1.5 !px-2.5 text-[12px]" onClick={onBack}>
        ‹ Back
      </button>

      <div>
        <h2 className="text-[17px] font-semibold">{member.name}</h2>
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          <span className="badge">{member.trade}</span>
          <span className="text-[12px] text-ink-soft">
            {AVAILABILITY_LABEL[member.availability]}
            {member.yearsExperience ? ` · ${member.yearsExperience} yrs` : ""}
            {member.isLead ? " · team lead" : ""}
          </span>
        </div>
      </div>

      {viaFirm && (
        <div className="rounded-md bg-paper-2 p-3">
          <p className="text-[13px] text-ink-soft">
            Works with <b className="text-ink">{viaFirm.name}</b>. You can hire
            the firm for the whole job, or this person directly for{" "}
            {member.trade.toLowerCase()} alone.
          </p>
          {others.length > 0 && (
            <p className="text-[12px] text-ink-soft mt-1.5">
              Also works with{" "}
              {others.map((f, i) => (
                <span key={f.id}>
                  {i > 0 && ", "}
                  <button
                    className="text-crimson font-medium"
                    onClick={() => onOpenFirm(f)}
                  >
                    {f.name}
                  </button>
                </span>
              ))}
              .
            </p>
          )}
        </div>
      )}

      {member.phone ? (
        <a
          href={`tel:${member.phone}`}
          className="btn btn-primary w-full !py-3 !text-base block text-center"
        >
          Call {member.phone}
        </a>
      ) : (
        <div className="rounded-md border border-rule-strong p-3">
          <p className="text-[13px] text-ink-soft">
            No direct number — {member.name.split(" ")[0]} has not agreed to be
            listed with one.{" "}
            {viaFirm ? (
              <>
                Reach them through{" "}
                <a href={`tel:${viaFirm.phone}`} className="text-crimson font-medium">
                  {viaFirm.name}
                </a>
                .
              </>
            ) : (
              "Reach them through the firm they work with."
            )}
          </p>
        </div>
      )}

      {member.rateCard.length > 0 && (
        <div>
          <h3 className="eyebrow mb-1.5">Own rates</h3>
          <div className="card divide-y divide-rule">
            {member.rateCard.map((r, i) => (
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

      {member.photos.length > 0 && (
        <div>
          <h3 className="eyebrow mb-1.5">Work photos</h3>
          <div className="flex gap-2 overflow-x-auto -mx-1 px-1">
            {member.photos.map((p) => (
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

      <button className="btn w-full !py-3 !text-base" onClick={() => setEngaging(true)}>
        Add to my people
      </button>

      {engaging && (
        <EngageTeamSheet
          firmName={viaFirm?.name ?? member.name}
          candidates={[
            { name: member.name, trade: member.trade, phone: member.phone },
          ]}
          onClose={() => setEngaging(false)}
        />
      )}
    </div>
  );
}
