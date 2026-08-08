import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, clearAllData } from "../db";
import { exportBackup, readBackupFile, applyBackup } from "../lib/backup";
import { exportExcelBackup, readExcelBackupFile } from "../lib/excelBackup";
import { withBalances } from "../lib/stock";
import { toCsv, downloadFile, downloadBlob, timestampSlug } from "../lib/csv";
import { currentHouseholdId } from "../lib/sync";
import { useTextScale, TEXT_SCALES } from "../hooks/useTextScale";
import { useNoteAiConsent } from "../hooks/useNoteAiConsent";
import { ImportEntries } from "./ImportEntries";
import { PushToggle } from "./PushToggle";
import { Faq } from "./Faq";

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
  const importExcelRef = useRef<HTMLInputElement>(null);
  const [showImport, setShowImport] = useState(false);
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

  const onImportExcel = async (file: File) => {
    setMsg(null);
    if (synced) {
      setMsg({
        kind: "err",
        text: "You're on the shared cloud ledger — restoring a backup here would conflict with live sync. Sign out first if you really need to restore an old file.",
      });
      return;
    }
    try {
      const backup = await readExcelBackupFile(file);
      const ok = window.confirm(
        `This workbook contains ${backup.entries.length} ledger entries, ${backup.boqItems.length} BOQ items and ${backup.stockItems.length} stock items.\n\n` +
          `Importing will REPLACE the current data (${counts?.entries ?? "?"} entries, ${counts?.boq ?? "?"} BOQ items, ${counts?.stock ?? "?"} stock items).\n\n` +
          `Entry photos are NOT in an Excel file and will be left exactly as they are on this phone.\n\nContinue?`,
      );
      if (!ok) return;
      // version 7 = the current shape, so none of the legacy re-seeding runs.
      // keepAttachments because the workbook has no photos to restore and the
      // ones on this phone still belong to these same entry ids.
      await applyBackup(
        { version: 7, ...backup, attachments: [] },
        { keepAttachments: true },
      );
      setMsg({
        kind: "ok",
        text: `Restored ${backup.entries.length} entries and ${backup.boqItems.length} BOQ items from Excel. Photos on this phone were left untouched.`,
      });
    } catch (err) {
      setMsg({
        kind: "err",
        text: err instanceof Error ? err.message : "Excel import failed.",
      });
    }
  };

  const exportEntriesCsv = async () => {
    const rows = await db.entries.toArray();
    downloadFile(
      `brick-book-entries-${timestampSlug()}.csv`,
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
      `brick-book-boq-${timestampSlug()}.csv`,
      toCsv(
        ["date", "category", "vendor", "invoiceNo", "invoiceTotal", "item", "hsn", "gstPct", "basis", "length", "width", "thickness", "pieces", "qty", "writtenQty", "unit", "rate", "discPct", "amount"],
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
      `brick-book-stock-${timestampSlug()}.csv`,
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

  if (showImport) return <ImportEntries onClose={() => setShowImport(false)} />;

  return (
    <div className="px-4 py-4 max-w-lg mx-auto space-y-5">
      {/* Deliberately its own section, above Backup & restore and worded to
          keep the two apart: restoring REPLACES this ledger with a file the app
          wrote, importing ADDS rows from a file it didn't. Confusing them is
          how someone wipes a month of entries trying to bring in a spreadsheet. */}
      <section className="space-y-2">
        <h2 className="eyebrow">Import past expenses</h2>
        <p className="text-[13px] text-ink-soft">
          Been keeping this in a phone note or a spreadsheet? Bring that history
          in once and carry on here. Rows are <strong>added</strong> to what you
          already have — nothing is replaced — and you check every one before it
          saves.
        </p>
        <button
          className="btn w-full !py-3"
          onClick={() => {
            setMsg(null);
            setShowImport(true);
          }}
        >
          Import a list or spreadsheet
        </button>
      </section>

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

      <PushToggle />

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
          Keep a copy somewhere safe (Drive, email). <strong>JSON</strong> is
          the complete one — it includes bill photos. <strong>Excel</strong>{" "}
          opens anywhere and can be corrected by hand, but carries no photos.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <button
            className="btn btn-green !py-3"
            onClick={() =>
              void exportBackup().then(() =>
                setMsg({ kind: "ok", text: "JSON backup downloaded." }),
              )
            }
          >
            Download .json
          </button>
          <button
            className="btn !py-3"
            disabled={synced}
            onClick={() => importRef.current?.click()}
          >
            Upload .json
          </button>
          <button
            className="btn !py-3"
            onClick={() =>
              void exportExcelBackup()
                .then((blob) => {
                  downloadBlob(`brick-book-backup-${timestampSlug()}.xlsx`, blob);
                  setMsg({ kind: "ok", text: "Excel backup downloaded." });
                })
                .catch((err) =>
                  setMsg({
                    kind: "err",
                    text: err instanceof Error ? err.message : "Excel export failed.",
                  }),
                )
            }
          >
            Download .xlsx
          </button>
          <button
            className="btn !py-3"
            disabled={synced}
            onClick={() => importExcelRef.current?.click()}
          >
            Upload .xlsx
          </button>
        </div>

        {synced && (
          <p className="text-[12px] text-ink-soft">
            You're on the shared cloud ledger, so your data is already backed up
            in the cloud. Uploading a file is disabled here to avoid conflicts
            with live sync — sign out (Data → account) first if you truly need
            to restore an old backup.
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
        <input
          ref={importExcelRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImportExcel(f);
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

      <Faq />

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
        {/* Plain links, not in-app screens: a store reviewer has to be able to
            reach these from the listing without installing anything, so the
            pages are static HTML and the app points at the same URLs. */}
        <div className="flex items-center gap-3 pt-1">
          <a className="underline" href="/privacy.html">
            Privacy
          </a>
          <a className="underline" href="/terms.html">
            Terms
          </a>
          <a className="underline" href="/delete-account.html">
            Delete account
          </a>
        </div>
      </div>
    </div>
  );
}
