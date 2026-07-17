import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, resetToSeed } from "../db";
import { exportBackup, readBackupFile, applyBackup } from "../lib/backup";
import { withBalances } from "../lib/stock";
import { toCsv, downloadFile, timestampSlug } from "../lib/csv";

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

  const lastBackup = settings?.lastBackupDate
    ? new Date(settings.lastBackupDate)
    : null;
  const backupStale =
    !lastBackup || Date.now() - lastBackup.getTime() > 7 * 24 * 3600 * 1000;

  const onImportFile = async (file: File) => {
    setMsg(null);
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
      `house-ledger-entries-${timestampSlug()}.csv`,
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
      `house-ledger-boq-${timestampSlug()}.csv`,
      toCsv(
        ["date", "category", "vendor", "invoiceNo", "invoiceTotal", "item", "hsn", "gstPct", "qty", "unit", "rate", "discPct", "amount"],
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
      `house-ledger-stock-${timestampSlug()}.csv`,
      toCsv(
        ["name", "category", "unit", "received", "givenOut", "balance", "done"],
        rows as unknown as Record<string, unknown>[],
      ),
      "text/csv",
    );
  };

  const doReset = async () => {
    if (
      !window.confirm(
        "Reset to seed data? This deletes ALL current entries and BOQ items.",
      )
    )
      return;
    if (
      !window.confirm(
        "Are you absolutely sure? This cannot be undone unless you exported a backup.",
      )
    )
      return;
    await resetToSeed();
    setMsg({ kind: "ok", text: "Database reset to seed data." });
  };

  return (
    <div className="px-4 py-4 max-w-lg mx-auto space-y-5">
      <section
        className={`border rounded-md px-3 py-3 ${
          backupStale ? "border-crimson bg-crimson/5" : "border-rule bg-white"
        }`}
      >
        <div className="text-[11px] uppercase tracking-[0.15em] text-ink-soft">
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
        <h2 className="text-[11px] uppercase tracking-[0.15em] text-ink-soft">
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
          onClick={() => importRef.current?.click()}
        >
          Import / restore from backup…
        </button>
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
        <h2 className="text-[11px] uppercase tracking-[0.15em] text-ink-soft">
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
        <h2 className="text-[11px] uppercase tracking-[0.15em] text-ink-soft">
          Danger zone
        </h2>
        <button
          className="btn w-full !border-crimson !text-crimson"
          onClick={() => void doReset()}
        >
          Reset to seed data
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

      <div className="text-[12px] text-ink-soft pb-4">
        {counts
          ? `${counts.entries} entries · ${counts.boq} BOQ items · ${counts.stock} stock items on device`
          : ""}
      </div>
    </div>
  );
}
