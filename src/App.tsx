import { useEffect, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { EntryForm } from "./components/EntryForm";
import { Ledger, type LedgerPreset } from "./components/Ledger";
import { Boq } from "./components/Boq";
import { Stock } from "./components/Stock";
import { People } from "./components/People";
import { SettingsScreen } from "./components/SettingsScreen";
import { TabBar, type Tab } from "./components/TabBar";

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  // Cross-tab hand-offs: "open the Ledger filtered to X" (dashboard drill-down,
  // People tab) and "open Entry with category Y preselected" (People tab).
  const [ledgerPreset, setLedgerPreset] = useState<LedgerPreset | null>(null);
  const [entryPreset, setEntryPreset] = useState<string | null>(null);

  // Android back button: from any non-dashboard tab, back returns to the
  // dashboard instead of exiting the app. Sub-screens (BOQ review, entry
  // editor) push their own entry via useBackClose.
  useEffect(() => {
    history.replaceState({ tab: "dashboard" }, "");
    const onPop = (e: PopStateEvent) => {
      const state = e.state as { tab?: Tab; modal?: boolean } | null;
      if (state?.modal) return; // handled by useBackClose
      setTab(state?.tab ?? "dashboard");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (t: Tab) => {
    setTab((current) => {
      if (t === current) return current;
      const state = history.state as { tab?: Tab; modal?: boolean } | null;
      if (t === "dashboard") {
        // Rewind past a sub-screen entry too, if one is open.
        if (state?.modal) history.go(-2);
        else if (state?.tab && state.tab !== "dashboard") history.back();
      } else if (!state?.tab || state.tab === "dashboard") {
        history.pushState({ tab: t }, "");
      } else {
        history.replaceState({ tab: t }, "");
      }
      return t;
    });
  };

  // Plain tab-bar navigation clears any pending hand-off so tabs open fresh.
  const navigateFromTabBar = (t: Tab) => {
    setLedgerPreset(null);
    setEntryPreset(null);
    navigate(t);
  };

  const openLedger = (preset: Omit<LedgerPreset, "seq">) => {
    navigate("ledger");
    setLedgerPreset({ ...preset, seq: Date.now() });
  };

  const openEntry = (category: string) => {
    navigate("entry");
    setEntryPreset(category);
  };

  return (
    <div className="min-h-dvh flex flex-col bg-paper">
      <header className="bg-ink text-paper sticky top-0 z-30 px-4 h-12 flex items-center border-b border-black/30">
        <h1 className="text-sm font-semibold tracking-[0.18em]">
          HOUSE LEDGER
        </h1>
      </header>

      <main className="flex-1 pb-20">
        {tab === "dashboard" && (
          <Dashboard
            onOpenCategory={(cat) => openLedger({ category: cat })}
            onOpenPayer={(payer) => openLedger({ paidBy: payer })}
          />
        )}
        {tab === "entry" && (
          <EntryForm key={entryPreset ?? "new"} presetCategory={entryPreset} />
        )}
        {tab === "ledger" && <Ledger preset={ledgerPreset} />}
        {tab === "boq" && <Boq />}
        {tab === "stock" && <Stock />}
        {tab === "people" && (
          <People
            onOpenLedger={(cat) => openLedger({ category: cat })}
            onNewPayment={openEntry}
          />
        )}
        {tab === "data" && <SettingsScreen />}
      </main>

      <TabBar tab={tab} onChange={navigateFromTabBar} />
    </div>
  );
}
