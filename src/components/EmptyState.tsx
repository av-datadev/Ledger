import { Icon, type IconName } from "./Icon";

/**
 * What a list says when it holds nothing yet (design.md §5.11).
 *
 * Every list in the app needs one. A blank panel reads as a screen that failed
 * to load, not as a book nobody has written in — and the first thing a new user
 * sees is a blank ledger, because nothing is seeded.
 *
 * "No results" is a DIFFERENT case from "nothing here yet" and must not reuse
 * this copy: one offers to clear the filters, the other offers to create the
 * first thing. Pass the right `action` for the case you are in.
 */
export function EmptyState({
  icon,
  line,
  hint,
  actionLabel,
  onAction,
}: {
  icon: IconName;
  /** States what is not here, in a sentence. */
  line: string;
  /** Says what to do about it. */
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-2 px-6 py-10">
      <Icon name={icon} size={24} className="text-ink-faint" />
      <div className="text-[15px] leading-snug font-semibold">{line}</div>
      {hint && (
        <div className="text-[11px] leading-relaxed text-ink-faint max-w-[30ch]">
          {hint}
        </div>
      )}
      {actionLabel && onAction && (
        <button className="btn btn-primary !py-2 mt-2" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
