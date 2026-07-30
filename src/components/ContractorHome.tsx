import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { inr, todayStr } from "../lib/format";
import { createSite, balancesBySite } from "../lib/sites";
import { SiteDetail } from "./SiteDetail";
import { SiteBackupPanel } from "./SiteBackupPanel";
import { ContractorLeadForm } from "./ContractorLeadForm";
import { FindContractor } from "./FindContractor";
import type { ContractorSite } from "../types";

type Tab = "sites" | "directory";

/**
 * The contractor side of the app. Until now this was a single "list me in the
 * directory" form — nothing a contractor would open twice. The reason to come
 * back is here instead: their own books, one set per site, because a contractor
 * runs several houses at once and the whole difficulty is keeping each one's
 * money straight.
 */
export function ContractorHome({
  onSwitchToBuilder,
}: {
  onSwitchToBuilder: () => void;
}) {
  const [tab, setTab] = useState<Tab>("sites");
  const [openSiteId, setOpenSiteId] = useState<string | null>(null);

  const sites = useLiveQuery(() => db.sites.toArray(), []);
  const ledger = useLiveQuery(() => db.siteLedger.toArray(), []);
  const openSite = sites?.find((s) => s.id === openSiteId) ?? null;

  return (
    <div className="min-h-dvh flex flex-col bg-paper text-ink">
      <header className="sticky top-0 z-30 bg-header text-onhead px-4 h-12 flex items-center justify-between">
        <div className="font-bold tracking-[0.14em] text-sm">BRICK FLOW</div>
        <button
          className="text-[11px] underline opacity-80"
          onClick={onSwitchToBuilder}
        >
          I'm building a home
        </button>
      </header>

      {openSite ? (
        <main className="flex-1 pb-6">
          <SiteDetail site={openSite} onBack={() => setOpenSiteId(null)} />
        </main>
      ) : (
        <>
          <div className="flex border-b border-rule bg-surface">
            {(["sites", "directory"] as Tab[]).map((t) => (
              <button
                key={t}
                className={`flex-1 py-2.5 text-[13px] border-b-2 ${
                  tab === t
                    ? "border-crimson font-medium"
                    : "border-transparent text-ink-soft"
                }`}
                onClick={() => setTab(t)}
              >
                {t === "sites" ? "My sites" : "Directory"}
              </button>
            ))}
          </div>

          <main className="flex-1 pb-6">
            {tab === "sites" ? (
              <SitesList
                sites={sites ?? []}
                balances={balancesBySite(ledger ?? [])}
                onOpen={setOpenSiteId}
              />
            ) : (
              <>
                <FindContractor />
                <div className="border-t border-rule mt-2">
                  <ContractorLeadForm onSwitchToBuilder={onSwitchToBuilder} embedded />
                </div>
              </>
            )}
          </main>
        </>
      )}
    </div>
  );
}

function SitesList({
  sites,
  balances,
  onOpen,
}: {
  sites: ContractorSite[];
  balances: ReturnType<typeof balancesBySite>;
  onOpen: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  const active = sites.filter((s) => s.status === "active");
  const done = sites.filter((s) => s.status === "done");

  return (
    <div className="px-4 py-4 max-w-lg mx-auto space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.15em] text-ink-soft">
            My sites
          </h2>
          <p className="text-[12px] text-ink-soft mt-0.5">
            One set of books per house you're working on.
          </p>
        </div>
        <button
          className="btn !py-1.5 !px-3 !text-[13px]"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? "Cancel" : "+ Site"}
        </button>
      </div>

      {adding && <AddSiteForm onDone={() => setAdding(false)} />}

      {sites.length === 0 && !adding && (
        <div className="text-[13px] text-ink-soft">
          No sites yet. Add the first house you're working on to start keeping
          its money separate.
        </div>
      )}

      {active.map((s) => (
        <SiteCard key={s.id} site={s} balances={balances} onOpen={onOpen} />
      ))}

      {done.length > 0 && (
        <>
          <div className="text-[11px] uppercase tracking-[0.15em] text-ink-soft pt-2">
            Finished
          </div>
          {done.map((s) => (
            <SiteCard key={s.id} site={s} balances={balances} onOpen={onOpen} />
          ))}
        </>
      )}

      <SiteBackupPanel siteCount={sites.length} />
    </div>
  );
}

function SiteCard({
  site,
  balances,
  onOpen,
}: {
  site: ContractorSite;
  balances: ReturnType<typeof balancesBySite>;
  onOpen: (id: string) => void;
}) {
  const b = balances.get(site.id);
  return (
    <button
      type="button"
      className={`w-full text-left bg-surface border border-rule rounded-md p-3 ${
        site.status === "done" ? "opacity-60" : ""
      }`}
      onClick={() => onOpen(site.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">{site.name}</div>
          <div className="text-[12px] text-ink-soft truncate">
            {site.ownerName}
            {site.ownerPhone ? ` · ${site.ownerPhone}` : ""}
          </div>
        </div>
        <span className="text-ink-soft shrink-0" aria-hidden>
          ›
        </span>
      </div>

      {b && (b.received > 0 || b.spentTotal > 0) && (
        <div className="mt-2 pt-2 border-t border-rule flex justify-between text-[11px] text-ink-soft">
          <span>
            in <span className="money">{inr(b.received)}</span> · spent{" "}
            <span className="money">{inr(b.spentTotal)}</span>
          </span>
          <span
            className={`money ${b.toAccountFor > 0 ? "text-crimson" : "text-moss"}`}
          >
            {b.toAccountFor > 0
              ? `${inr(b.toAccountFor)} to account for`
              : `${inr(-b.toAccountFor)} owed to you`}
          </span>
        </div>
      )}
    </button>
  );
}

function AddSiteForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [address, setAddress] = useState("");
  const [contractAmount, setContractAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) {
      setError("Give the site a name.");
      return;
    }
    setError(null);
    const amount = parseFloat(contractAmount);
    await createSite({
      name: name.trim(),
      ownerName: ownerName.trim(),
      ownerPhone: ownerPhone.trim(),
      address: address.trim(),
      contractAmount: amount > 0 ? amount : null,
      startDate: todayStr(),
      notes: "",
    });
    onDone();
  };

  return (
    <div className="bg-surface border border-rule rounded-md p-3 space-y-2.5">
      <div>
        <label className="field-label" htmlFor="n-name">Site name</label>
        <input
          id="n-name"
          className="input"
          placeholder="e.g. Verma house — Civil Lines"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="field-label" htmlFor="n-owner">Owner</label>
          <input
            id="n-owner"
            className="input"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="n-phone">Phone</label>
          <input
            id="n-phone"
            type="tel"
            className="input"
            value={ownerPhone}
            onChange={(e) => setOwnerPhone(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="field-label" htmlFor="n-addr">Address (optional)</label>
        <input
          id="n-addr"
          className="input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </div>
      <div>
        <label className="field-label" htmlFor="n-amt">
          Contract amount (₹, optional)
        </label>
        <input
          id="n-amt"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          className="input money"
          placeholder="0"
          value={contractAmount}
          onChange={(e) => setContractAmount(e.target.value)}
        />
      </div>
      {error && <div className="text-[12px] text-crimson">{error}</div>}
      <button className="btn btn-primary w-full !py-2.5" onClick={() => void save()}>
        Add site
      </button>
    </div>
  );
}
