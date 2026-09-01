import { useRef, useState } from "react";
import { useTabSwipe } from "../hooks/useTabSwipe";

export type Tab =
  | "dashboard"
  | "entry"
  | "ledger"
  | "recent"
  | "boq"
  | "stock"
  | "people"
  | "data"
  | "help";

/**
 * Eight destinations, four at a time, nothing hidden.
 *
 * The bar used to hold five slots and put Recent, Stock, People and Data behind
 * a "More" sheet — two taps and a modal to reach a screen people use daily.
 * Eight equal tabs is the other obvious answer and is worse: at 375px they give
 * 46.9px each, and 32.0px at the 1.25× text setting, under the 44px touch floor
 * at every size including the default.
 *
 * So the bar pages instead. Four tab slots plus the centre action, swiped
 * sideways between two pages, gives 75.0px per tab and 51.2px at 1.25× — the
 * same width the More sheet was buying, without burying anything. Two dots say
 * which page you are on.
 *
 * Record does not page. It is the app's verb, it is reached in a hurry with one
 * hand, and a control that moves under the thumb is a control you have to look
 * at first. It sits in the centre of both pages.
 */

type Slot = { id: Tab; label: string; icon: string };

/** Left of the action, then right of it. Reading order across both pages is the
 *  swipe order in `TAB_ORDER` below — the bar and the gesture agree. */
const PAGES: { left: Slot[]; right: Slot[] }[] = [
  {
    left: [
      { id: "dashboard", label: "Dash", icon: "M3 13h6v8H3zm7-9h6v17h-6zm7 5h6v12h-6z" },
      { id: "ledger", label: "Ledger", icon: "M4 4h16v2H4zm0 5h16v2H4zm0 5h10v2H4zm0 5h16v2H4z" },
    ],
    right: [
      { id: "boq", label: "BOQ", icon: "M6 2h9l5 5v15H6zm8 1v5h5M9 12h8v1.5H9zm0 4h8v1.5H9z" },
      {
        id: "recent",
        label: "Recent",
        icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm-1 2v6l5 3 .8-1.3-4.3-2.6V7z",
      },
    ],
  },
  {
    left: [
      {
        id: "stock",
        label: "Stock",
        icon: "M12 2 3 6.5v11L12 22l9-4.5v-11zm0 2.2 6.2 3.1L12 10.4 5.8 7.3zM5 8.9l6 3v7.4l-6-3zm14 0v7.4l-6 3v-7.4z",
      },
      {
        id: "people",
        label: "People",
        icon: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-7 1.7-7 4v3h14v-3c0-2.3-3.7-4-7-4zm8.5-2.5a3 3 0 1 0-2.1-5.1 5.9 5.9 0 0 1 .1 5c.6.1 1.3.1 2 .1zM18 13.2c1.9.6 4 1.8 4 3.8v3h-3v-3c0-1.5-.4-2.8-1-3.8z",
      },
    ],
    right: [
      {
        id: "data",
        label: "Data",
        icon: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zm-8 6c0 1.7 3.6 3 8 3s8-1.3 8-3v4c0 1.7-3.6 3-8 3s-8-1.3-8-3zm0 6c0 1.7 3.6 3 8 3s8-1.3 8-3v3c0 1.7-3.6 3-8 3s-8-1.3-8-3z",
      },
      {
        id: "help",
        label: "Help",
        icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm.1 2.6c-1.8 0-3 1-3.2 2.7h1.9c.1-.7.6-1.1 1.3-1.1.7 0 1.2.4 1.2 1 0 .6-.3.9-1 1.4-.8.5-1.2 1.1-1.1 2.1v.4h1.9v-.3c0-.6.2-.9 1-1.4.9-.6 1.4-1.3 1.4-2.3 0-1.6-1.3-2.5-3.4-2.5zM12 15.4a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z",
      },
    ],
  },
];

/**
 * The swipe order, and the only list that decides what "next screen" means.
 *
 * Record is deliberately absent. It is a form, not a view: swiping into it from
 * the Ledger would be odd, and swiping OUT of it halfway through typing an
 * entry would silently throw the entry away. It is entered and left by its
 * button.
 */
export const TAB_ORDER: Tab[] = [
  "dashboard",
  "ledger",
  "boq",
  "recent",
  "stock",
  "people",
  "data",
  "help",
];

/** Which page of the bar a tab lives on, or null for Record, which is on both. */
function pageOf(tab: Tab): number | null {
  const i = PAGES.findIndex((p) =>
    [...p.left, ...p.right].some((s) => s.id === tab),
  );
  return i === -1 ? null : i;
}

export function TabBar({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
}) {
  const [page, setPage] = useState(() => pageOf(tab) ?? 0);
  const [lastTab, setLastTab] = useState(tab);

  // A tab chosen anywhere else — a dashboard drill-down, the back button, a
  // screen swipe — brings its page with it, so the current tab is never on the
  // page you cannot see. Record leaves the page where it is.
  //
  // Adjusted during render rather than in an effect. An effect would paint one
  // frame with the new tab on the old page, which on a boundary-crossing swipe
  // shows the bar highlighting a tab that isn't there.
  if (tab !== lastTab) {
    setLastTab(tab);
    const p = pageOf(tab);
    if (p !== null && p !== page) setPage(p);
  }

  // The bar pages on its own swipe too. Without this the only way to reach
  // Data from Dash would be to swipe the screen through all six tabs between
  // them — the page-2 tabs would be visible to nobody who wanted to tap one.
  const barRef = useRef<HTMLDivElement>(null);
  useTabSwipe(barRef, {
    onNext: () => setPage((p) => Math.min(p + 1, PAGES.length - 1)),
    onPrev: () => setPage((p) => Math.max(p - 1, 0)),
  });

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 bg-header chrome-edge-t"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main"
    >
      <div className="relative" ref={barRef}>
        {/* Both pages live in the DOM and slide as one track, so every
            destination stays in the accessibility tree and reachable by
            keyboard even while its page is off-screen. */}
        <div className="overflow-hidden">
          <div
            className="flex motion-safe:transition-transform"
            style={{
              transform: `translateX(-${page * 100}%)`,
              transitionDuration: "var(--dur-base)",
              transitionTimingFunction: "var(--ease-base)",
            }}
          >
            {PAGES.map((p, i) => (
              <div key={i} className="w-full shrink-0 flex">
                {p.left.map((s) => (
                  <BarTab
                    key={s.id}
                    {...s}
                    active={s.id === tab}
                    onClick={() => onChange(s.id)}
                    onFocus={() => setPage(i)}
                  />
                ))}
                {/* The centre action's column. Kept empty here and filled by the
                    button below, which sits outside the clipping box so its
                    raised circle is not cut off. */}
                <div className="flex-1 min-w-0" />
                {p.right.map((s) => (
                  <BarTab
                    key={s.id}
                    {...s}
                    active={s.id === tab}
                    onClick={() => onChange(s.id)}
                    onFocus={() => setPage(i)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* The app's verb, given the centre of every page. */}
        <button
          onClick={() => onChange("entry")}
          aria-current={tab === "entry" ? "page" : undefined}
          className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1/5 flex flex-col items-center py-2 min-w-0"
        >
          <span
            /* shrink-0: the column is height-constrained by `inset-y-0`, and a
               flex item shrinks along the main axis by default — without this
               the circle squashes to an ellipse at the larger text sizes. */
            className={`w-11 h-11 shrink-0 -mt-4 mb-0.5 rounded-full flex items-center justify-center border-2 border-header ${
              tab === "entry"
                ? "bg-accent-fill-deep text-white"
                : "bg-accent-fill text-white"
            }`}
            style={{
              boxShadow:
                "0 8px 20px -10px color-mix(in srgb, var(--color-accent-fill) 70%, transparent)",
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
      </div>

      {/* Which page, and how many. Not a control — the bar and the screen both
          swipe, and a 6px dot is not a 44px target. */}
      <div className="flex justify-center items-center gap-1.5 pb-1" aria-hidden="true">
        {PAGES.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full motion-safe:transition-colors ${
              i === page ? "bg-crimson" : "bg-onhead/25"
            }`}
          />
        ))}
      </div>
    </nav>
  );
}

function BarTab({
  label,
  icon,
  active,
  onClick,
  onFocus,
}: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
  /** Focusing a tab on the off-screen page brings that page into view, so every
   *  destination stays keyboard-reachable and nothing is focused invisibly. */
  onFocus: () => void;
}) {
  return (
    <button
      onClick={onClick}
      onFocus={onFocus}
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
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
        <path d={icon} />
      </svg>
      {label}
    </button>
  );
}
