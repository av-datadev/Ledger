import { useState } from "react";
import { useBackClose } from "../hooks/useBackClose";
import { Icon } from "./Icon";

export type Tab =
  | "dashboard"
  | "entry"
  | "ledger"
  | "recent"
  | "boq"
  | "stock"
  | "people"
  | "data";

/**
 * Five destinations, not eight.
 *
 * Eight tabs at phone width gave 46.9px each at the default text size and
 * 32.0px at 320px / 1.25× — under the 44px touch floor at every combination,
 * including the default. Five give 75.0px and 51.2px.
 *
 * Entry is promoted out of the row into the centre action: it is the app's
 * verb, the most-used destination, and the one reached in a hurry with one
 * hand. Recent, Stock, People and Data are genuinely lower-frequency and sit
 * behind More. Nothing is removed — every screen is still one or two taps away,
 * and the Tab union is unchanged, so navigation state and the Android back
 * behaviour work exactly as before.
 */

const BAR: { id: Tab; label: string; icon: string }[] = [
  // Simple inline SVG paths (24x24 viewBox), no icon library needed.
  { id: "dashboard", label: "Dash", icon: "M3 13h6v8H3zm7-9h6v17h-6zm7 5h6v12h-6z" },
  { id: "ledger", label: "Ledger", icon: "M4 4h16v2H4zm0 5h16v2H4zm0 5h10v2H4zm0 5h16v2H4z" },
  { id: "boq", label: "BOQ", icon: "M6 2h9l5 5v15H6zm8 1v5h5M9 12h8v1.5H9zm0 4h8v1.5H9z" },
];

/** The four screens behind More, with a line each saying what they answer. */
const MORE: { id: Tab; label: string; hint: string; icon: string }[] = [
  {
    id: "recent",
    label: "Recent",
    hint: "Everything added or corrected lately",
    icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm-1 2v6l5 3 .8-1.3-4.3-2.6V7z",
  },
  {
    id: "stock",
    label: "Stock",
    hint: "What came in, what went out, who took it",
    icon: "M12 2 3 6.5v11L12 22l9-4.5v-11zm0 2.2 6.2 3.1L12 10.4 5.8 7.3zM5 8.9l6 3v7.4l-6-3zm14 0v7.4l-6 3v-7.4z",
  },
  {
    id: "people",
    label: "People",
    hint: "Trades, contracts and what's still owed",
    icon: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-7 1.7-7 4v3h14v-3c0-2.3-3.7-4-7-4zm8.5-2.5a3 3 0 1 0-2.1-5.1 5.9 5.9 0 0 1 .1 5c.6.1 1.3.1 2 .1zM18 13.2c1.9.6 4 1.8 4 3.8v3h-3v-3c0-1.5-.4-2.8-1-3.8z",
  },
  {
    id: "data",
    label: "Data",
    hint: "Backup, sign-in, AI consent, text size",
    icon: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zm-8 6c0 1.7 3.6 3 8 3s8-1.3 8-3v4c0 1.7-3.6 3-8 3s-8-1.3-8-3zm0 6c0 1.7 3.6 3 8 3s8-1.3 8-3v3c0 1.7-3.6 3-8 3s-8-1.3-8-3z",
  },
];

const MORE_IDS = MORE.map((m) => m.id);

export function TabBar({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_IDS.includes(tab);

  const pick = (t: Tab) => {
    setMoreOpen(false);
    onChange(t);
  };

  return (
    <>
      {moreOpen && (
        <MoreSheet
          current={tab}
          onPick={pick}
          onClose={() => setMoreOpen(false)}
        />
      )}
      <nav
        className="fixed bottom-0 inset-x-0 z-30 bg-header border-t border-black/40"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex">
          {BAR.slice(0, 2).map((t) => (
            <BarTab
              key={t.id}
              {...t}
              active={t.id === tab}
              onClick={() => pick(t.id)}
            />
          ))}

          {/* The app's verb, given the centre. */}
          <button
            onClick={() => pick("entry")}
            aria-current={tab === "entry" ? "page" : undefined}
            className="flex-1 flex flex-col items-center py-2 min-w-0"
          >
            <span
              className={`w-11 h-11 -mt-4 mb-0.5 rounded-full flex items-center justify-center border-2 border-header ${
                tab === "entry"
                  ? "bg-accent-deep text-white"
                  : "bg-crimson text-white"
              }`}
              style={{
                boxShadow:
                  "0 8px 20px -10px color-mix(in srgb, var(--color-crimson) 70%, transparent)",
              }}
            >
              <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current">
                <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
              </svg>
            </span>
            <span
              className={`text-[11px] tracking-wide ${
                tab === "entry" ? "text-onhead" : "text-onhead/55"
              }`}
            >
              Record
            </span>
          </button>

          {BAR.slice(2).map((t) => (
            <BarTab
              key={t.id}
              {...t}
              active={t.id === tab}
              onClick={() => pick(t.id)}
            />
          ))}

          <button
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] tracking-wide min-w-0 ${
              moreActive || moreOpen ? "text-onhead" : "text-onhead/55"
            }`}
          >
            <span
              className={`h-0.5 w-7 -mt-2 mb-1 rounded-full ${
                moreActive ? "bg-crimson" : "bg-transparent"
              }`}
            />
            <Icon name="more" size={20} />
            More
          </button>
        </div>
      </nav>
    </>
  );
}

function BarTab({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] tracking-wide min-w-0 ${
        active ? "text-onhead" : "text-onhead/55"
      }`}
    >
      <span
        className={`h-0.5 w-7 -mt-2 mb-1 rounded-full ${
          active ? "bg-crimson" : "bg-transparent"
        }`}
      />
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
        <path d={icon} />
      </svg>
      {label}
    </button>
  );
}

/** The four demoted screens. A sheet, so the Android back gesture closes it. */
function MoreSheet({
  current,
  onPick,
  onClose,
}: {
  current: Tab;
  onPick: (t: Tab) => void;
  onClose: () => void;
}) {
  const requestClose = useBackClose(true, onClose);
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/50" onClick={requestClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More screens"
        className="absolute inset-x-0 bottom-0 bg-surface rounded-t-lg shadow-2xl px-4 pt-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 84px)" }}
      >
        <div className="w-9 h-1 rounded-full bg-rule-strong mx-auto mb-3" />
        <div className="card overflow-hidden divide-y divide-rule !shadow-none">
          {MORE.map((m) => (
            <button
              key={m.id}
              className="w-full flex items-center gap-3 px-3 py-3 text-left active:bg-ink/5"
              aria-current={m.id === current ? "page" : undefined}
              onClick={() => onPick(m.id)}
            >
              <svg
                viewBox="0 0 24 24"
                className="w-5 h-5 fill-current text-ink-faint shrink-0"
                aria-hidden="true"
              >
                <path d={m.icon} />
              </svg>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">
                  {m.label}
                </span>
                <span className="block text-[12px] text-ink-soft">
                  {m.hint}
                </span>
              </span>
              <Icon name="chevron" size={16} className="text-ink-faint" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
