import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { requestLink, getLink } from "../lib/siteLink";
import { setSiteLink } from "../lib/sites";
import { SharedLedgerPanel } from "./SharedLedgerPanel";
import { ContractorAuth } from "./ContractorAuth";
import type { ContractorSite } from "../types";

/**
 * The contractor's end of site linking, on one of his sites.
 *
 * Three states: not linked (enter the owner's code), waiting (he's asked, the
 * owner hasn't decided), and linked (the shared ledger). His own money log
 * stays private throughout — only rows he puts in the shared panel are visible
 * to the owner, which is what makes it safe to keep his margins in the same app.
 */
export function SiteLinkPanel({ site }: { site: ContractorSite }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (alive) setSignedIn(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSignedIn(!!s),
    );
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // While a request is pending, re-check on mount so an approval that happened
  // on the owner's phone shows up the next time this screen is opened.
  const refresh = useCallback(async () => {
    if (!site.linkId || site.linkStatus === "approved") return;
    setChecking(true);
    try {
      const link = await getLink(site.linkId);
      if (link && link.status !== site.linkStatus) {
        await setSiteLink(site.id, link.id, link.status);
      }
    } catch {
      /* offline — the stored status stands until the next check */
    } finally {
      setChecking(false);
    }
  }, [site.id, site.linkId, site.linkStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (signedIn === null) return null;

  if (!signedIn) {
    return (
      <div className="pt-3 border-t border-rule space-y-2">
        <h3 className="eyebrow">Link to the owner</h3>
        <p className="text-[12px] text-ink-soft">
          Sign in to connect this site to the owner's app, so you both see the
          same record of what's been paid.
        </p>
        <ContractorAuth />
      </div>
    );
  }

  if (site.linkStatus === "approved" && site.linkId) {
    return (
      <div className="pt-3 border-t border-rule space-y-2.5">
        <SharedLedgerPanel
          linkId={site.linkId}
          role="contractor"
          counterpartyName={site.ownerName || "the owner"}
        />
      </div>
    );
  }

  if (site.linkStatus === "pending") {
    return (
      <div className="pt-3 border-t border-rule space-y-2">
        <h3 className="eyebrow">Link to the owner</h3>
        <div className="card p-3">
          <div className="text-[13px]">Waiting for the owner to approve.</div>
          <p className="text-[11px] text-ink-soft mt-1">
            He'll see your request in his app. Nothing is shared until he
            approves.
          </p>
          <button
            className="btn !py-1.5 !px-3 !text-[13px] mt-2"
            disabled={checking}
            onClick={() => void refresh()}
          >
            {checking ? "Checking…" : "Check again"}
          </button>
        </div>
      </div>
    );
  }

  return <RequestForm site={site} wasRevoked={site.linkStatus === "revoked"} />;
}

function RequestForm({
  site,
  wasRevoked,
}: {
  site: ContractorSite;
  wasRevoked: boolean;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!code.trim()) {
      setError("Enter the code the owner gave you.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const link = await requestLink({
        code,
        name: name.trim(),
        phone: phone.trim(),
        label: site.name,
      });
      await setSiteLink(site.id, link.id, link.status);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send that request.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-3 border-t border-rule space-y-2">
      <h3 className="eyebrow">Link to the owner</h3>
      <p className="text-[12px] text-ink-soft">
        {wasRevoked
          ? "Access to this site was cut. Enter the code again to ask once more."
          : "Ask the owner for his site code. Once he approves, you both see the same record of what's been paid — and he sees nothing else of your books."}
      </p>

      <div className="card p-3 space-y-2.5">
        <div>
          <label className="field-label" htmlFor="lk-code">Site code</label>
          <input
            id="lk-code"
            className="input money !tracking-[0.15em] !text-lg"
            placeholder="ABCD1234"
            autoCapitalize="characters"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="field-label" htmlFor="lk-name">Your name</label>
            <input
              id="lk-name"
              className="input"
              placeholder="A S Construction"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="lk-phone">Your phone</label>
            <input
              id="lk-phone"
              type="tel"
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        {error && <div className="text-[12px] text-crimson">{error}</div>}
        <button
          className="btn btn-primary w-full !py-2.5"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? "Sending…" : "Ask to link"}
        </button>
      </div>
    </div>
  );
}
