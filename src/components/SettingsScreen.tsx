import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, clearAllData } from "../db";
import { exportBackup, readBackupFile, applyBackup } from "../lib/backup";
import { withBalances } from "../lib/stock";
import { toCsv, downloadFile, timestampSlug } from "../lib/csv";
import { currentHouseholdId } from "../lib/sync";
import { useTextScale, TEXT_SCALES } from "../hooks/useTextScale";
import { useNoteAiConsent } from "../hooks/useNoteAiConsent";

export function SettingsScreen() {
  const settings = useLiveQuery(() => db.settings.get("app"), []);
  const counts = useLiveQuery(
    async () => ({
      entries: await db.entries.count(),
      boq: await db.boqItems.count(),
      stock: await db.stockItems.count(),
    }),
    [],
  );
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  const importRef = useRef<HTMLInputElement>(null);
  const { scale, setScale } = useTextScale();
  const noteAi = useNoteAiConsent();
  // While the shared cloud ledger is active, restoring/resetting local data
  // fights the live sync (and isn't needed — the cloud already holds it).
  const synced = currentHouseholdId() != null;

  const lastBackup = settings?.lastBackupDate
    ? new Date(settings.lastBackupDate)
    : null;
  const backupStale =
    !lastBackup || Date.now() - lastBackup.getTime() > 7 * 24 * 3600 * 1000;

  const onImportFile = async (file: File) => {
    setMsg(null);
    if (synced) {
      setMsg({
        kind: "err",
        text: "You're on the shared cloud ledger — restoring a local backup here would conflict with live sync. Sign out first if you really need to restore an old file.",
      });
      return;
    }
    try {
      const backup = await readBackupFile(file);
      const ok = window.confirm(
        `This backup contains ${backup.entries.length} ledger entries, ${backup.boqItems.length} BOQ items and ${backup.stockItems.length} stock items.\n\n` +
          `Importing will REPLACE the current data (${counts?.entries ?? "?"} entries, ${counts?.boq ?? "?"} BOQ items, ${counts?.stock ?? "?"} stock items).\n\nContinue?`,
      );
      if (!ok) return;
      await applyBackup(backup);
      setMsg({
        kind: "ok",
        text: `Restored ${backup.entries.length} entries and ${backup.boqItems.length} BOQ items.`,
      });
    } catch (err) {
      setMsg({
        kind: "err",
        text: err instanceof Error ? err.message : "Import failed.",
      });
    }
  };

  const exportEntriesCsv = async () => {
    const rows = await db.entries.toArray();
    downloadFile(
      `brick-flow-entries-${timestampSlug()}.csv`,
      toCsv(
        ["date", "category", "event", "detail", "amount", "mode", "paidBy", "notes"],
        rows as unknown as Record<string, unknown>[],
      ),
      "text/csv",
    );
  };

  const exportBoqCsv = async () => {
    const rows = await db.boqItems.toArray();
    downloadFile(
      `brick-flow-boq-${timestampSlug()}.csv`,
      toCsv(
        ["date", "category", "vendor", "invoiceNo", "invoiceTotal", "item", "hsn", "gstPct", "basis", "length", "width", "qty", "unit", "rate", "discPct", "amount"],
        rows as unknown as Record<string, unknown>[],
      ),
      "text/csv",
    );
  };

  const exportStockCsv = async () => {
    const [items, moves] = await Promise.all([
      db.stockItems.toArray(),
      db.stockMoves.toArray(),
    ]);
    const rows = withBalances(items, moves).map((s) => ({
      name: s.name,
      category: s.category,
      unit: s.unit,
      received: s.inQty,
      givenOut: s.outQty,
      balance: s.balance,
      done: s.done ? "yes" : "no",
    }));
    downloadFile(
      `brick-flow-stock-${timestampSlug()}.csv`,
      toCsv(
        ["name", "category", "unit", "received", "givenOut", "balance", "done"],
        rows as unknown as Record<string, unknown>[],
      ),
      "text/csv",
    );
  };

  const doReset = async () => {
    if (synced) {
      setMsg({
        kind: "err",
        text: "Clearing is disabled while you're on the shared cloud ledger — it would wipe the synced data. Sign out first.",
      });
      return;
    }
    if (
      !window.confirm(
        "Clear all data? This deletes ALL entries, BOQ items and stock on this device.",
      )
    )
      return;
    if (
      !window.confirm(
        "Are you absolutely sure? This cannot be undone unless you exported a backup.",
      )
    )
      return;
    await clearAllData();
    setMsg({ kind: "ok", text: "All on-device data cleared." });
  };

  return (
    <div className="px-4 py-4 max-w-lg mx-auto space-y-5">
      <section className="space-y-2">
        <h2 className="eyebrow">
          Text size
        </h2>
        <div className="flex gap-2">
          {TEXT_SCALES.map((s) => {
            const active = s.value === scale;
            return (
              <button
                key={s.value}
                className={`btn flex-1 !py-2.5 ${
                  active ? "!bg-ink !text-paper !border-ink" : ""
                }`}
                aria-pressed={active}
                onClick={() => setScale(s.value)}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <p className="text-[13px] text-ink-soft">
          Scales the whole app so text is easier to read. Saved on this device.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="eyebrow">
          Reading handwritten notes
        </h2>
        <button
          className={`btn w-full !py-2.5 ${
            noteAi.granted ? "!bg-ink !text-paper !border-ink" : ""
          }`}
          aria-pressed={noteAi.granted}
          onClick={() => (noteAi.granted ? noteAi.revoke() : noteAi.grant())}
        >
          {noteAi.granted ? "On — photos are sent to be read" : "Off"}
        </button>
        <p className="text-[13px] text-ink-soft">
          Lets New Entry read a vendor's handwritten slip, a cheque, or a Hindi
          diary page. Handwriting can't be read on the phone itself, so that
          photo is sent over the internet to an AI reader. Applies to this
          device only — not the others sharing this ledger.
        </p>
      </section>

      <section
        className={`border rounded-md px-3 py-3 ${
          backupStale ? "border-crimson bg-crimson/5" : "border-rule bg-surface"
        }`}
      >
        <div className="eyebrow">
          Last backup
        </div>
        <div
          className={`text-lg font-semibold mt-0.5 ${backupStale ? "text-crimson" : "text-moss"}`}
        >
          {lastBackup
            ? lastBackup.toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : "Never"}
        </div>
        {backupStale && (
          <div className="text-[13px] text-crimson mt-1">
            {lastBackup
              ? "More than 7 days old — export a fresh backup."
              : "No backup yet — export one now."}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="eyebrow">
          Backup &amp; restore
        </h2>
        <p className="text-[13px] text-ink-soft">
          The JSON backup below is your <strong>primary safety net</strong>.
          Your data lives only on this device — export regularly and keep the
          file somewhere safe (Drive, email, etc.).
        </p>
        <button
          className="btn btn-green w-full !py-3"
          onClick={() => void exportBackup().then(() => setMsg({ kind: "ok", text: "Backup exported." }))}
        >
          Export full backup (.json)
        </button>
        <button
          className="btn w-full !py-3"
          disabled={synced}
          onClick={() => importRef.current?.click()}
        >
          Import / restore from backup…
        </button>
        {synced && (
          <p className="text-[12px] text-ink-soft">
            You're on the shared cloud ledger, so your data is already backed up
            in the cloud. Restoring a local file is disabled here to avoid
            conflicts with live sync — sign out (Data → account) first if you
            truly need to restore an old backup.
          </p>
        )}
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImportFile(f);
            e.target.value = "";
          }}
        />
      </section>

      <section className="space-y-2">
        <h2 className="eyebrow">
          CSV export
        </h2>
        <div className="grid grid-cols-3 gap-2">
          <button className="btn" onClick={() => void exportEntriesCsv()}>
            Entries CSV
          </button>
          <button className="btn" onClick={() => void exportBoqCsv()}>
            BOQ CSV
          </button>
          <button className="btn" onClick={() => void exportStockCsv()}>
            Stock CSV
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="eyebrow">
          Danger zone
        </h2>
        <button
          className="btn w-full !border-crimson !text-crimson"
          disabled={synced}
          onClick={() => void doReset()}
        >
          Clear all data
        </button>
      </section>

      {msg && (
        <div
          className={`text-[13px] px-3 py-2 rounded-md border ${
            msg.kind === "ok"
              ? "border-moss text-moss bg-moss/5"
              : "border-crimson text-crimson bg-crimson/5"
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="text-[12px] text-ink-soft pb-4 space-y-1">
        <div>
          {counts
            ? `${counts.entries} entries · ${counts.boq} BOQ items · ${counts.stock} stock items on device`
            : ""}
        </div>
        <div className="flex items-center gap-2">
          <span>App version {__BUILD_ID__}</span>
          <button
            className="underline"
            onClick={() => {
              // Force the newest build onto this device: drop the service
              // worker + its caches, then hard-reload.
              void (async () => {
                try {
                  for (const r of await navigator.serviceWorker.getRegistrations())
                    await r.unregister();
                  for (const k of await caches.keys()) await caches.delete(k);
                } catch {
                  /* not supported / blocked — the reload below still helps */
                }
                location.reload();
              })();
            }}
          >
            check for update
          </button>
        </div>
      </div>
    </div>
  );
}
