/**
 * The one place the page asks whether it is allowed to move.
 *
 * Every module imports this rather than calling matchMedia itself, so there is
 * a single answer and no module can forget to ask.
 */
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Indian grouping — ₹48,62,400. Lakhs and crores, never millions.
 *
 * The app formats money this way and so does every figure printed on this page;
 * a landing page that wrote ₹4,862,400 would be advertising a different product
 * to a different country.
 */
export function inr(n) {
  const s = String(Math.round(n)), last = s.slice(-3), rest = s.slice(0, -3);
  return '₹' + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last;
}

/**
 * Whichever element is nearest the middle of the viewport.
 *
 * Shared by the two pinned sections. Both re-measure on every observer fire
 * rather than trusting the entry that fired it: on a fast scroll several
 * elements cross the band in one batch and the last one processed wins, which
 * is not the one you are looking at.
 */
export function nearestToMiddle(els) {
  const mid = innerHeight / 2;
  let best = 0, bestD = Infinity;
  els.forEach((el, n) => {
    const r = el.getBoundingClientRect();
    const d = Math.abs(r.top + r.height / 2 - mid);
    if (d < bestD) { bestD = d; best = n; }
  });
  return best;
}
