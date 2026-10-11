import { reduced } from './env.js';

/**
 * The hero elevation draws itself once, on load, and then rests.
 *
 * One class does it: the CSS holds every stroke retracted and every label
 * transparent until `.drawn` lands. With the script absent the CSS already
 * treats the drawing as finished, so this only ever ADDS the performance — it
 * is never what makes the hero legible.
 */
export function initHero() {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  if (reduced) { hero.classList.add('drawn'); return; }
  // Two frames, so the retracted state is painted before the transition to the
  // finished one begins. Adding the class in the same frame as first paint
  // makes the browser skip straight to the end.
  requestAnimationFrame(() => requestAnimationFrame(() => hero.classList.add('drawn')));
  // The same bargain the rest of the page makes: if a frame never comes — a
  // background tab, a throttled device — the drawing still arrives.
  setTimeout(() => hero.classList.add('drawn'), 1200);
}
