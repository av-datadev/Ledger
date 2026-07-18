export type Tab =
  | "dashboard"
  | "entry"
  | "ledger"
  | "recent"
  | "boq"
  | "stock"
  | "people"
  | "data";

const TABS: { id: Tab; label: string; icon: string }[] = [
  // Simple inline SVG paths (24x24 viewBox), no icon library needed.
  { id: "dashboard", label: "Dash", icon: "M3 13h6v8H3zm7-9h6v17h-6zm7 5h6v12h-6z" },
  { id: "entry", label: "Entry", icon: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" },
  { id: "ledger", label: "Ledger", icon: "M4 4h16v2H4zm0 5h16v2H4zm0 5h10v2H4zm0 5h16v2H4z" },
  // Clock — recently added/edited entries.
  { id: "recent", label: "Recent", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm-1 2v6l5 3 .8-1.3-4.3-2.6V7z" },
  { id: "boq", label: "BOQ", icon: "M6 2h9l5 5v15H6zm8 1v5h5M9 12h8v1.5H9zm0 4h8v1.5H9z" },
  { id: "stock", label: "Stock", icon: "M12 2 3 6.5v11L12 22l9-4.5v-11zm0 2.2 6.2 3.1L12 10.4 5.8 7.3zM5 8.9l6 3v7.4l-6-3zm14 0v7.4l-6 3v-7.4z" },
  { id: "people", label: "People", icon: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-7 1.7-7 4v3h14v-3c0-2.3-3.7-4-7-4zm8.5-2.5a3 3 0 1 0-2.1-5.1 5.9 5.9 0 0 1 .1 5c.6.1 1.3.1 2 .1zM18 13.2c1.9.6 4 1.8 4 3.8v3h-3v-3c0-1.5-.4-2.8-1-3.8z" },
  { id: "data", label: "Data", icon: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zm-8 6c0 1.7 3.6 3 8 3s8-1.3 8-3v4c0 1.7-3.6 3-8 3s-8-1.3-8-3zm0 6c0 1.7 3.6 3 8 3s8-1.3 8-3v3c0 1.7-3.6 3-8 3s-8-1.3-8-3z" },
];

export function TabBar({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
}) {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 bg-header border-t border-black/40"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[9.5px] tracking-wide ${
                active ? "text-onhead" : "text-[#8fa1b0]"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <span
                className={`h-0.5 w-7 -mt-2 mb-1 rounded-full ${active ? "bg-crimson" : "bg-transparent"}`}
              />
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                <path d={t.icon} />
              </svg>
              {t.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
