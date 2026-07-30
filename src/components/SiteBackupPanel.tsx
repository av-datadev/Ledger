import { useRef, useState } from "react";
import {
  exportSiteBackup,
  readSiteBackupFile,
  applySiteBackup,
  type ParsedSiteBackup,
} from "../lib/siteBackup";
import { formatDate } from "../lib/format";

/**
 * Save/restore for the contractor's site books.
 *
 * These books are the only copy — they're device-local and deliberately outside
 * household sync — so this is the safety net, not a convenience. The restore
 * confirms with real counts before overwriting, because it replaces rather than
 * merges.
 */
export function SiteBackupPanel({ siteCount }: { siteCount: number }) {
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, setPending] = useState<ParsedSiteBackup | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
      <p className="text-[12px] text-ink-soft">
        Your site books live on this phone only — nothing is uploaded, and no
        one else can see them. That also means a lost phone loses them, so save
        a copy now and then and keep it somewhere safe.
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
