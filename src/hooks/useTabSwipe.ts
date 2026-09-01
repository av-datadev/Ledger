import { useEffect, useRef } from "react";

/**
 * Swipe left/right across a screen to move to the next or previous tab.
 *
 * Three rules keep this from being the kind of gesture people learn to fight:
 *
 * 1. **It has to look like a swipe.** A drag is only claimed once it has run
 *    SLOP px horizontally AND is clearly more horizontal than vertical. Without
 *    that second half, every slightly-diagonal flick down a long ledger would
 *    change tab.
 * 2. **Anything that scrolls sideways wins.** The BOQ coverage table is wider
 *    than the phone and scrolls inside its own box. A gesture starting in there
 *    belongs to the table, not to the navigation — so we walk up from the touch
 *    target looking for a scrollable ancestor before claiming anything.
 * 3. **It never fires from inside a control.** Dragging across a range input or
 *    a text selection is not navigation.
 *
 * Touch only, by design. A trackpad's horizontal wheel and a mouse drag are not
 * this gesture, and hijacking them breaks desktop text selection.
 */

/** Horizontal travel before a drag counts as a swipe. */
const SLOP = 12;
/** How much more horizontal than vertical it has to be. */
const RATIO = 1.4;

/** Does this element, or an ancestor up to the root, scroll horizontally? */
function inHorizontalScroller(start: EventTarget | null, root: HTMLElement) {
  let el = start instanceof Element ? start : null;
  while (el && el !== root.parentElement) {
    // scrollWidth can exceed clientWidth by a rounding pixel on zoomed layouts;
    // 4px keeps that from reading as a scroller.
    if (el.scrollWidth - el.clientWidth > 4) {
      const overflow = getComputedStyle(el).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
    if (el.closest("input,textarea,select,[contenteditable]") === el) return true;
    el = el.parentElement;
  }
  return false;
}

export function useTabSwipe(
  ref: React.RefObject<HTMLElement | null>,
  { onNext, onPrev }: { onNext: () => void; onPrev: () => void },
) {
  // Held in a ref so the listeners can stay passive and unchanging while the
  // callbacks they close over are re-created on every render.
  const handlers = useRef({ onNext, onPrev });
  handlers.current = { onNext, onPrev };

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let claimed = false;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return; // a pinch is not a swipe
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      claimed = false;
      tracking = !inHorizontalScroller(e.target, root);
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking || claimed || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);

      // Committed to a vertical scroll — stop watching until the next touch.
      if (ay > SLOP && ay > ax) {
        tracking = false;
        return;
      }
      if (ax < SLOP || ax < ay * RATIO) return;

      claimed = true;
      if (dx < 0) handlers.current.onNext();
      else handlers.current.onPrev();
    };

    const onEnd = () => {
      tracking = false;
      claimed = false;
    };

    // Passive: this gesture never calls preventDefault, so the browser is free
    // to keep scrolling at 60fps while we watch.
    const opts = { passive: true } as const;
    root.addEventListener("touchstart", onStart, opts);
    root.addEventListener("touchmove", onMove, opts);
    root.addEventListener("touchend", onEnd, opts);
    root.addEventListener("touchcancel", onEnd, opts);
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onEnd);
    };
  }, [ref]);
}
