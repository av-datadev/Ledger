import type { Availability } from "../lib/contractors";
import { Icon } from "./Icon";

/**
 * The header every directory screen wears: where you came from, in small caps,
 * above what you are looking at, in the serif.
 *
 * The app's own bar already says BRICK BOOK, so this is not a second chrome bar
 * — it is the screen's title block, and it carries the one back control on
 * screen at any depth. Before this, drilling from People into a firm stacked
 * two of them ("‹ People" above "‹ Back"), which reads as a mistake because it
 * is one.
 */
export function DirectoryHeader({
  eyebrow,
  title,
  sub,
  onBack,
  backLabel = "Back",
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <div className="space-y-1.5">
      {onBack && (
        <button
          className="flex items-center gap-1 -ml-1 min-h-11 text-[13px] text-ink-soft font-medium"
          onClick={onBack}
        >
          <span className="rotate-180 flex" aria-hidden>
            <Icon name="chevron" size={16} />
          </span>
          {backLabel}
        </button>
      )}
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="text-[20px] leading-tight mt-0.5">{title}</h2>
        {sub && <p className="text-[12px] text-ink-soft mt-1">{sub}</p>}
      </div>
    </div>
  );
}

const AVAILABILITY: Record<Availability, { label: string; cls: string }> = {
  available: { label: "Available now", cls: "badge-positive" },
  partial: { label: "Partly booked", cls: "badge-warn" },
  booked: { label: "Fully booked", cls: "badge-neutral" },
};

/**
 * Availability as a pill rather than coloured text.
 *
 * The colour is the second signal, never the only one — each variant prints the
 * state in words, so the row still reads correctly with no colour at all.
 */
export function AvailabilityBadge({ value }: { value: Availability }) {
  const { label, cls } = AVAILABILITY[value];
  return <span className={`badge ${cls} shrink-0`}>{label}</span>;
}
