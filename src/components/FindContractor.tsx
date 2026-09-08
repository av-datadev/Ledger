import { useEffect, useMemo, useState } from "react";
import {
  listContractors,
  type Contractor,
  type FirmMember,
} from "../lib/contractors";
import { FirmDetail } from "./FirmDetail";
import { MemberDetail } from "./MemberDetail";

const AVAILABILITY_LABEL: Record<Contractor["availability"], string> = {
  available: "Available now",
  partial: "Partly booked",
  booked: "Fully booked",
};

const AVAILABILITY_CLASS: Record<Contractor["availability"], string> = {
  available: "text-moss",
  partial: "text-brass",
  booked: "text-crimson",
};

type View =
  | { kind: "list" }
  | { kind: "firm"; firm: Contractor }
  | { kind: "member"; member: FirmMember; viaFirm: Contractor | null };

/** How many trades a firm supplies, as "2 painters · 1 electrician". */
function tradeCounts(firm: Contractor): string[] {
  const counts = new Map<string, number>();
  for (const m of firm.members) {
    counts.set(m.trade, (counts.get(m.trade) ?? 0) + 1);
  }
  if (counts.size === 0) return firm.trades;
  return [...counts.entries()].map(([trade, n]) =>
    n === 1 ? `1 ${trade.toLowerCase()}` : `${n} ${trade.toLowerCase()}s`,
  );
}

/**
 * Public directory browse — no sign-in required. Moradabad only, for now.
 *
 * Search matches a firm's name and area, and also its people: typing
 * "electrician" finds a firm because someone on its roster is one, not because
 * somebody remembered to tag the firm.
 */
export function FindContractor() {
  const [firms, setFirms] = useState<Contractor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "list" });
  const [query, setQuery] = useState("");
  const [trade, setTrade] = useState<string | null>(null);
  const [freeOnly, setFreeOnly] = useState(false);

  useEffect(() => {
    let alive = true;
    listContractors("Moradabad")
      .then((rows) => alive && setFirms(rows))
      .catch(
        (err) =>
          alive &&
          setError(
            err instanceof Error ? err.message : "Could not load contractors.",
          ),
      );
    return () => {
      alive = false;
    };
  }, []);

  // Every trade anyone in the directory actually holds — the filter strip can
  // only offer work that somebody is there to do.
  const trades = useMemo(() => {
    const all = new Set<string>();
    for (const f of firms ?? []) for (const t of f.trades) all.add(t);
    return [...all].sort();
  }, [firms]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (firms ?? []).filter((f) => {
      if (trade && !f.trades.includes(trade)) return false;
      if (freeOnly && f.availability === "booked") return false;
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        (f.area ?? "").toLowerCase().includes(q) ||
        f.trades.some((t) => t.toLowerCase().includes(q)) ||
        f.members.some(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            m.trade.toLowerCase().includes(q),
        )
      );
    });
  }, [firms, query, trade, freeOnly]);

  const peopleCount = useMemo(
    () => new Set((firms ?? []).flatMap((f) => f.members.map((m) => m.id))).size,
    [firms],
  );

  if (view.kind === "firm") {
    return (
      <FirmDetail
        firm={view.firm}
        onBack={() => setView({ kind: "list" })}
        onOpenMember={(m) =>
          setView({ kind: "member", member: m, viaFirm: view.firm })
        }
      />
    );
  }

  if (view.kind === "member") {
    return (
      <MemberDetail
        member={view.member}
        viaFirm={view.viaFirm}
        onBack={() =>
          setView(
            view.viaFirm
              ? { kind: "firm", firm: view.viaFirm }
              : { kind: "list" },
          )
        }
        onOpenFirm={(f) => setView({ kind: "firm", firm: f })}
      />
    );
  }

  return (
    <div className="px-4 py-4 max-w-lg mx-auto space-y-3">
      <div>
        <h2 className="eyebrow">Contractors in Moradabad</h2>
        <p className="text-[12px] text-ink-soft mt-0.5">
          More added as they're onboarded.
        </p>
      </div>

      <input
        className="input"
        placeholder="Search a trade, firm or area"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search contractors"
      />

      {(trades.length > 0 || firms) && (
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
          <button
            className={`btn !py-1.5 !px-3 text-[13px] shrink-0 ${
              trade === null ? "!bg-accent-soft !text-accent-deep !border-accent-soft" : ""
            }`}
            aria-pressed={trade === null}
            onClick={() => setTrade(null)}
          >
            All trades
          </button>
          {trades.map((t) => (
            <button
              key={t}
              className={`btn !py-1.5 !px-3 text-[13px] shrink-0 ${
                trade === t ? "!bg-accent-soft !text-accent-deep !border-accent-soft" : ""
              }`}
              aria-pressed={trade === t}
              onClick={() => setTrade(trade === t ? null : t)}
            >
              {t}
            </button>
          ))}
          <button
            className={`btn !py-1.5 !px-3 text-[13px] shrink-0 ${
              freeOnly ? "!bg-accent-soft !text-accent-deep !border-accent-soft" : ""
            }`}
            aria-pressed={freeOnly}
            onClick={() => setFreeOnly((v) => !v)}
          >
            Available
          </button>
        </div>
      )}

      {error && <div className="text-[13px] text-danger">{error}</div>}
      {firms === null && !error && (
        <div className="text-[13px] text-ink-soft">Loading…</div>
      )}

      {firms && firms.length > 0 && (
        <div className="text-[12px] text-ink-soft" role="status">
          <b className="text-ink">
            {shown.length} {shown.length === 1 ? "firm" : "firms"}
          </b>
          {peopleCount > 0 ? ` · ${peopleCount} people listed` : ""}
        </div>
      )}

      {firms?.length === 0 && (
        <div className="text-[13px] text-ink-soft">
          No contractors listed yet — check back soon.
        </div>
      )}
      {firms && firms.length > 0 && shown.length === 0 && (
        <div className="text-[13px] text-ink-soft">
          Nothing matches that.{" "}
          <button
            className="text-crimson font-medium"
            onClick={() => {
              setQuery("");
              setTrade(null);
              setFreeOnly(false);
            }}
          >
            Clear the filters
          </button>
          .
        </div>
      )}

      <div className="space-y-2.5">
        {shown.map((f) => (
          <button
            key={f.id}
            className="card w-full text-left p-3 space-y-2"
            onClick={() => setView({ kind: "firm", firm: f })}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold truncate">{f.name}</div>
                <div className="text-[12px] text-ink-soft">
                  {f.contractorType === "general"
                    ? "General contractor"
                    : "Specialist"}
                  {f.area ? ` · ${f.area}` : ""}
                  {f.yearsExperience ? ` · ${f.yearsExperience} yrs` : ""}
                </div>
              </div>
              <span
                className={`text-[11px] font-medium shrink-0 ${AVAILABILITY_CLASS[f.availability]}`}
              >
                {AVAILABILITY_LABEL[f.availability]}
              </span>
            </div>

            {tradeCounts(f).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tradeCounts(f).map((t) => (
                  <span key={t} className="badge">
                    {t}
                  </span>
                ))}
              </div>
            )}

            {f.members.length > 0 && (
              <div className="text-[12px] text-ink-soft">
                Team of {f.members.length} ·{" "}
                {f.members
                  .slice(0, 2)
                  .map((m) => m.name)
                  .join(", ")}
                {f.members.length > 2 ? ` +${f.members.length - 2}` : ""}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
