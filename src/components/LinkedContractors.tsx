import { useCallback, useEffect, useState } from "react";
import { formatDate } from "../lib/format";
import {
  mySiteCode,
  listLinks,
  decideLink,
  type SiteLink,
} from "../lib/siteLink";
import { SharedLedgerPanel } from "./SharedLedgerPanel";

/**
 * The homeowner's end of site linking: the code to hand out, and the decision
 * on anyone who has used it.
 *
 * A pending request grants nothing at all — the code alone is not access — so
 * a code forwarded into a WhatsApp group still can't reach the ledger. The
 * approval here is the gate.
 */
export function LinkedContractors() {
  const [code, setCode] = useState<string | null>(null);
  const [links, setLinks] = useState<SiteLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([mySiteCode(), listLinks()]);
      setCode(c);
      setLinks(l);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load your site code.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, approve: boolean) => {
    setBusyId(id);
    try {
      await decideLink(id, approve);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that.");
    } finally {
      setBusyId(null);
    }
  };

  // Signed out: there is no household, so there's nothing to link to yet.
  if (error && !code && !links) {
    return (
      <section className="px-4 py-4 max-w-lg mx-auto">
        <h2 className="eyebrow mb-1">Your contractors</h2>
        <p className="text-[13px] text-ink-soft">
          Sign in above to get a site code you can give a contractor.
        </p>
      </section>
    );
  }

  const pending = links?.filter((l) => l.status === "pending") ?? [];
  const approved = links?.filter((l) => l.status === "approved") ?? [];
  const revoked = links?.filter((l) => l.status === "revoked") ?? [];

  return (
    <section className="px-4 py-4 max-w-lg mx-auto space-y-3">
      <div>
        <h2 className="eyebrow mb-1">Your contractors</h2>
        <p className="text-[12px] text-ink-soft">
          Give a contractor this code and approve him here. He'll see only the
          money between you and him — never the rest of your ledger.
        </p>
      </div>

      {code && (
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wider text-ink-soft">
            Your site code
          </div>
          <div className="flex items-center justify-between gap-2 mt-1">
            <span className="money text-2xl font-bold tracking-[0.15em]">
              {code}
            </span>
            <button
              className="btn !py-1.5 !px-3 !text-[13px]"
              onClick={() => {
                void navigator.clipboard?.writeText(code).then(
                  () => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  },
                  () => {
                    /* clipboard blocked — the code is on screen to read out */
                  },
                );
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {error && <div className="text-[12px] text-crimson">{error}</div>}

      {pending.length > 0 && (
        <div className="space-y-2">
          <h3 className="eyebrow">Waiting for your approval</h3>
          {pending.map((l) => (
            <div key={l.id} className="card p-3 border-crimson">
              <div className="font-semibold text-sm">
                {l.contractorName || "A contractor"}
              </div>
              <div className="text-[12px] text-ink-soft">
                {l.contractorPhone && <>{l.contractorPhone} · </>}
                asked {formatDate(l.requestedAt.slice(0, 10))}
              </div>
              {l.siteLabel && (
                <div className="text-[12px] text-ink-soft">
                  Calls it “{l.siteLabel}”
                </div>
              )}
              <p className="text-[11px] text-ink-soft mt-1.5">
                Approving lets him see payments you record against him and
                anything he shares back. Nothing else.
              </p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button
                  className="btn !py-2 !text-[13px]"
                  disabled={busyId === l.id}
                  onClick={() => void decide(l.id, false)}
                >
                  Reject
                </button>
                <button
                  className="btn btn-primary !py-2 !text-[13px]"
                  disabled={busyId === l.id}
                  onClick={() => void decide(l.id, true)}
                >
                  Approve
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {approved.map((l) => (
        <div key={l.id} className="card p-3">
          <button
            type="button"
            className="w-full flex items-start justify-between gap-2 text-left"
            onClick={() => setOpenId(openId === l.id ? null : l.id)}
            aria-expanded={openId === l.id}
          >
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">
                {l.contractorName || "Contractor"}
              </div>
              <div className="text-[12px] text-ink-soft truncate">
                {l.contractorPhone || "linked"} · tap to see the shared ledger
              </div>
            </div>
            <span
              className={`text-ink-soft shrink-0 transition-transform ${
                openId === l.id ? "rotate-90" : ""
              }`}
              aria-hidden
            >
              ›
            </span>
          </button>

          {openId === l.id && (
            <div className="mt-3 pt-3 border-t border-rule space-y-3">
              <SharedLedgerPanel
                linkId={l.id}
                role="owner"
                counterpartyName={l.contractorName || "the contractor"}
              />
              <button
                className="text-[12px] text-crimson underline"
                disabled={busyId === l.id}
                onClick={() => void decide(l.id, false)}
              >
                Cut this contractor's access
              </button>
            </div>
          )}
        </div>
      ))}

      {links?.length === 0 && (
        <p className="text-[13px] text-ink-soft">
          No contractor is linked yet. Give one the code above and his request
          will appear here.
        </p>
      )}

      {revoked.length > 0 && (
        <p className="text-[11px] text-ink-soft">
          {revoked.length} past{" "}
          {revoked.length === 1 ? "contractor has" : "contractors have"} had
          access cut. Re-approve by asking them to enter the code again.
        </p>
      )}
    </section>
  );
}
