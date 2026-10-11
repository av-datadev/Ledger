import { nearestToMiddle } from './env.js';

/**
 * "Watch it work" — one phone, pinned, changing screen.
 *
 * No width gate: the observer is cheap, and gating it at load meant a window
 * resized (or a tablet rotated) into the wide layout got a phone stuck on the
 * first screen and three permanently dimmed steps.
 */
export function initPinnedPhone() {
  const shots = [...document.querySelectorAll('.stack img')];
  const steps = [...document.querySelectorAll('.sstep')];
  if (!shots.length || !steps.length) return;

  const pick = () => {
    const best = nearestToMiddle(steps);
    shots.forEach((img, n) => img.classList.toggle('on', n === best));
    steps.forEach((st, n) => st.classList.toggle('cur', n === best));
  };
  const io = new IntersectionObserver(pick, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
  steps.forEach((st) => io.observe(st));
  addEventListener('resize', pick, { passive: true });
  document.querySelector('.work-in').classList.add('live');
  pick();
}
