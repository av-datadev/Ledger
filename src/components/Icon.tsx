/**
 * The app's icon set — inline SVG paths compiled into the bundle.
 *
 * No icon package and no runtime fetch: both break the offline promise, and a
 * full library breaks the bundle budget. Every path is drawn in a 24×24 viewBox
 * as a solid `fill-current` shape, matching the tab-bar icons that were already
 * here, so the whole app reads as one family.
 *
 * This replaces the ten emoji that were doing this job (📷 🔗 📎 ⚠ 📐 📇 🏠 🎤
 * plus ✓ and ✕ as glyph text). Emoji are font-dependent, render differently on
 * every Android skin, cannot be themed or sized by token, and are announced by
 * screen readers as their own names rather than the control's.
 *
 * Semantics are chosen by USE, not by glyph — the same shape is decorative in
 * one place and meaningful in another:
 *   - decorative beside visible text  → the default here (aria-hidden)
 *   - meaningful and standalone       → pass a `title`
 *   - inside a control                → leave it hidden and name the control
 */

export type IconName =
  | "camera"
  | "mic"
  | "clip"
  | "link"
  | "warn"
  | "ruler"
  | "house"
  | "hardhat"
  | "card"
  | "check"
  | "x"
  | "search"
  | "sync"
  | "chevron"
  | "more";

const PATHS: Record<IconName, string> = {
  camera:
    "M9 4h6l1.2 2H20a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.8zM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z",
  mic: "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM7 11a5 5 0 0 0 4 4.9V19H8v2h8v-2h-3v-3.1A5 5 0 0 0 17 11h-2a3 3 0 0 1-6 0z",
  clip: "M17 7v9a5 5 0 0 1-10 0V6.5a3.5 3.5 0 1 1 7 0V15a2 2 0 1 1-4 0V8h1.5v7a.5.5 0 0 0 1 0V6.5a2 2 0 1 0-4 0V16a3.5 3.5 0 0 0 7 0V7z",
  link: "M9.5 13.5a3.5 3.5 0 0 1 0-5l2-2a3.5 3.5 0 0 1 5 5l-1 1-1.4-1.4 1-1a1.5 1.5 0 0 0-2.2-2.2l-2 2a1.5 1.5 0 0 0 0 2.2zM14.5 10.5a3.5 3.5 0 0 1 0 5l-2 2a3.5 3.5 0 0 1-5-5l1-1 1.4 1.4-1 1a1.5 1.5 0 0 0 2.2 2.2l2-2a1.5 1.5 0 0 0 0-2.2z",
  warn: "M12 3 1.5 21h21zm0 4.8 6.9 11.5H5.1zM11 10.5h2v5h-2zm0 6h2v2h-2z",
  ruler:
    "M3 8h18v8H3zm2 2v4h1.5v-2H8v2h1.5v-3H11v3h1.5v-2H14v2h1.5v-3H17v3h2v-4z",
  house: "M12 3 2 11h3v9h5v-6h4v6h5v-9h3z",
  /* The contractor side, in one shape: a hard hat with its brim. Drawn solid at
     the same weight as `house`, which marks the owner side, so the pair reads
     as two of a kind in the two mode-switch buttons.

     The raised centre crown is the whole icon. A plain dome on a brim reads as
     a bell at 16px; the step up in the middle is what makes it a hard hat. */
  hardhat:
    "M12 3.4a2.7 2.7 0 0 0-2.7 2.7v2.1A5.7 5.7 0 0 0 5.8 13.5v2h12.4v-2a5.7 5.7 0 0 0-3.5-5.3V6.1A2.7 2.7 0 0 0 12 3.4zM2 16.6h20a1 1 0 0 1 1 1v1.1a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-1.1a1 1 0 0 1 1-1z",
  card: "M3 5h18v14H3zm2 2v10h14V7zm2 2h4v4H7zm6 0h4v1.5h-4zm0 3h4v1.5h-4zM7 14h4v1.5H7z",
  check: "M9.6 16.3 5.4 12.1 4 13.5l5.6 5.6L20.2 8.5l-1.4-1.4z",
  x: "M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z",
  search:
    "M10 3a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 10 3zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z",
  sync: "M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z",
  chevron: "M9 5l7 7-7 7-1.4-1.4L13.2 12 7.6 6.4z",
  more: "M6 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
};

/** 16 inside a badge or dense row · 20 default · 24 header actions. */
export type IconSize = 16 | 20 | 24;

export function Icon({
  name,
  size = 20,
  className = "",
  title,
}: {
  name: IconName;
  size?: IconSize | number;
  className?: string;
  /** Give this ONLY when the icon stands alone and carries the meaning. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`fill-current shrink-0 ${className}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
