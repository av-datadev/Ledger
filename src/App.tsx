import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Dashboard } from "./components/Dashboard";
import { EntryForm } from "./components/EntryForm";
import { Ledger, type LedgerPreset } from "./components/Ledger";
import { Recent } from "./components/Recent";
import { Boq } from "./components/Boq";
import { Stock } from "./components/Stock";
import { People } from "./components/People";
import { SettingsScreen } from "./components/SettingsScreen";
import { TabBar, type Tab } from "./components/TabBar";
import { useTheme } from "./hooks/useTheme";
import { useAuth } from "./hooks/useAuth";
import {
  getMyHousehold,
  startSync,
  stopSync,
  type Household,
} from "./lib/sync";
import { AccountSection } from "./components/Auth";

/**
 * No auth gate: the app runs on the on-device ledger the moment it opens, so a
 * fresh visitor sees a blank slate they can use offline. Signing in (from the
 * Data tab) resolves the user's household and starts sync, which pulls their
 * cloud data down onto this device.
 */
export default function App() {
  const { session, loading } = useAuth();
  // undefined = signed in, still resolving; null = no active household (signed
  // out, or signed in without one yet).
  const [household, setHousehold] = useState<Household | null | undefined>(
    null,
  );

  useEffect(() => {
    if (!session) {
      setHousehold(null);
      return;
    }
    let alive = true;
    setHousehold(undefined);
    getMyHousehold()
      .then((h) => alive && setHousehold(h))
      .catch(() => alive && setHousehold(null));
    return () => {
      alive = false;
    };
  }, [session]);

  // Start/stop the sync engine as the active household changes. With no
  // household the app simply keeps running on local data.
  useEffect(() => {
    if (!household) return;
    void startSync(household.id).catch((e) => console.error("sync start", e));
    return () => {
      void stopSync();
    };
  }, [household]);

  return (
    <LedgerApp
      session={session}
      authLoading={loading}
      household={household}
      onHouseholdReady={setHousehold}
    />
  );
}

function LedgerApp({
  session,
  authLoading,
  household,
  onHouseholdReady,
}: {
  session: Session | null;
  authLoading: boolean;
  household: Household | null | undefined;
  onHouseholdReady: (h: Household) => void;
}) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const { theme, toggle } = useTheme();
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
      <header className="bg-header text-onhead sticky top-0 z-30 px-4 h-12 flex items-center justify-between border-b border-black/30">
        <h1 className="text-sm font-semibold tracking-[0.18em]">
          BRICK FLOW
        </h1>
        <button
          onClick={toggle}
          className="text-onhead/90 active:text-onhead p-1 -mr-1"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to night mode"}
          title={theme === "dark" ? "Light mode" : "Night mode"}
        >
          {theme === "dark" ? (
            // Sun
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
            </svg>
          ) : (
            // Moon
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          )}
        </button>
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
        {tab === "recent" && <Recent />}
        {tab === "boq" && <Boq />}
        {tab === "stock" && <Stock />}
        {tab === "people" && (
          <People
            onOpenLedger={(cat) => openLedger({ category: cat })}
            onNewPayment={openEntry}
          />
        )}
        {tab === "data" && (
          <>
            <div className="px-4 pt-4">
              <AccountSection
                session={session}
                authLoading={authLoading}
                household={household}
                onHouseholdReady={onHouseholdReady}
              />
            </div>
            <SettingsScreen />
          </>
        )}
      </main>

      <TabBar tab={tab} onChange={navigateFromTabBar} />
    </div>
  );
}
