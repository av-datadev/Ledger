import { useEffect, useRef, useState } from "react";
import {
  exportSiteBackup,
  readSiteBackupFile,
  applySiteBackup,
  type ParsedSiteBackup,
} from "../lib/siteBackup";
import { formatDate } from "../lib/format";
import { supabase } from "../lib/supabase";
import { resyncSites, siteSyncState } from "../lib/siteSync";
import { agoLabel } from "../hooks/useSyncStatus";
import { ContractorAuth } from "./ContractorAuth";

/**
 * Save/restore for the contractor's site books, and the automatic cloud copy.
 *
 * The file backup came first, when these books were the only copy anywhere. It
 * stays, because it is the one a contractor can keep himself — but a safety net
 * that depends on remembering to use it is not one, so signing in now keeps a
 * continuous copy under his own account. Both are offered here rather than one
 * quietly replacing the other: the file is his, the cloud copy is automatic,
 * and neither makes the other pointless.
 */
export function SiteBackupPanel({ siteCount }: { siteCount: number }) {
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, setPending] = useState<ParsedSiteBackup | null>(null);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);
  const [cloud, setCloud] = useState(siteSyncState());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (alive) setSignedIn(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSignedIn(!!s),
    );
    // The sync module isn't reactive, so poll it — this panel is on screen for
    // seconds at a time and a stale "backed up 5 min ago" is worse than none.
    const id = setInterval(() => setCloud(siteSyncState()), 2000);
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
      clearInterval(id);
    };
  }, []);

  const backUpNow = async () => {
    setMsg(null);
    setBusy(true);
    try {
      await resyncSites();
      setCloud(siteSyncState());
    } catch {
      setMsg({
        kind: "err",
        text: "Couldn't reach your backup just now. Your books are safe on this phone.",
      });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const { sites, rows } = await exportSiteBackup();
      setMsg({
        kind: "ok",
        text: `Saved ${sites} ${sites === 1 ? "site" : "sites"} and ${rows} logged ${
          rows === 1 ? "row" : "rows"
        }, photos included.`,
      });
    } catch (err) {
      setMsg({
        kind: "err",
        text: err instanceof Error ? err.message : "Could not save the backup.",
      });
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File) => {
    setMsg(null);
    setPending(null);
    try {
      setPending(await readSiteBackupFile(file));
    } catch (err) {
      setMsg({
        kind: "err",
        text: err instanceof Error ? err.message : "Could not read that file.",
      });
    }
  };

  const restore = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await applySiteBackup(pending);
      setMsg({
        kind: "ok",
        text: `Restored ${pending.sites.length} ${
          pending.sites.length === 1 ? "site" : "sites"
        }.`,
      });
      setPending(null);
    } catch (err) {
      setMsg({
        kind: "err",
        text: err instanceof Error ? err.message : "Could not restore that backup.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-4 mt-2 border-t border-rule space-y-2">
      <h3 className="eyebrow">
        Back up my sites
      </h3>

      {cloud.on ? (
        <div className="card p-3 space-y-1.5">
          <div className="text-[13px] text-moss">
            ✓ Backed up to your account
          </div>
          <p className="text-[11px] text-ink-soft">
            Your sites, every logged row and the bill photos are kept under your
            own sign-in. Lose this phone and you sign in on the next one to get
            them back. Nobody else can see them — not the owners you're linked
            with, not your other sites.
          </p>
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-[11px] text-ink-soft">
              {cloud.syncing
                ? "Backing up…"
                : cloud.lastSyncAt
                  ? `Last backed up ${agoLabel(cloud.lastSyncAt)}`
                  : "Not backed up yet"}
            </span>
            <button
              className="btn !py-1.5 !px-3 !text-[12px]"
              disabled={busy || cloud.syncing}
              onClick={() => void backUpNow()}
            >
              Back up now
            </button>
          </div>
        </div>
      ) : (
        <div className="card p-3 space-y-2">
          <p className="text-[12px] text-ink-soft">
            Your site books are on this phone only. That means a lost, reset or
            wiped phone loses every site at once. Sign in and they're kept under
            your own account instead — still private, still yours, and back on
            the next phone the moment you sign in there.
          </p>
          {signedIn === false &&
            (showSignIn ? (
              <ContractorAuth />
            ) : (
              <button
                className="btn btn-primary w-full !py-2 !text-[13px]"
                onClick={() => setShowSignIn(true)}
              >
                Keep a backup of my books
              </button>
            ))}
        </div>
      )}

      <p className="text-[12px] text-ink-soft">
        You can also keep a copy of your own as a file, and restore from it on
        any phone.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button
          className="btn !py-2 !text-[13px]"
          disabled={busy || siteCount === 0}
          onClick={() => void save()}
        >
          Save a copy
        </button>
        <button
          className="btn !py-2 !text-[13px]"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          Restore
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          e.target.value = "";
        }}
      />

      {siteCount === 0 && (
        <p className="text-[11px] text-ink-soft">
          Nothing to save yet — add a site first.
        </p>
      )}

      {pending && (
        <div className="border border-crimson rounded-md p-3 space-y-2 bg-crimson/5">
          <div className="text-[13px]">
            This backup holds{" "}
            <b>
              {pending.sites.length}{" "}
              {pending.sites.length === 1 ? "site" : "sites"}
            </b>{" "}
            and <b>{pending.ledger.length} logged rows</b>
            {pending.exportedAt && (
              <> from {formatDate(pending.exportedAt.slice(0, 10))}</>
            )}
            .
          </div>
          <div className="text-[12px] text-crimson">
            Restoring replaces everything currently on this phone
            {siteCount > 0 && (
              <>
                {" "}
                — the {siteCount} {siteCount === 1 ? "site" : "sites"} here now
                will be removed
              </>
            )}
            . This can't be undone.
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="btn !py-2 !text-[13px]"
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary !py-2 !text-[13px]"
              disabled={busy}
              onClick={() => void restore()}
            >
              {busy ? "Restoring…" : "Replace and restore"}
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div
          className={`text-[12px] ${msg.kind === "ok" ? "text-moss" : "text-crimson"}`}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
