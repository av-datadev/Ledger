/**
 * Placeholder rows shown while Dexie resolves (design.md §5.12).
 *
 * Every screen used to return `null` until its live query came back, which
 * flashes an empty page and then pops the whole layout in underneath the
 * reader's thumb. Reserving the real height first is the fix.
 *
 * No shimmer sweep on purpose: it is an animation running on a cheap phone for
 * no information, and it is the first thing to look broken under
 * `prefers-reduced-motion`.
 */

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="card overflow-hidden divide-y divide-rule"
      aria-hidden="true"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="px-3 py-2.5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="h-[13px] rounded-sm bg-rule w-3/5" />
            <div className="h-[11px] rounded-sm bg-rule w-2/5 mt-2" />
          </div>
          <div className="h-[13px] rounded-sm bg-rule w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** A card-shaped block, for screens whose content is cards rather than rows. */
export function SkeletonCards({ cards = 3 }: { cards?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="card p-3">
          <div className="h-[15px] rounded-sm bg-rule w-3/5" />
          <div className="h-[12px] rounded-sm bg-rule w-2/5 mt-2" />
          <div className="h-8 rounded-md bg-rule mt-3" />
        </div>
      ))}
    </div>
  );
}
