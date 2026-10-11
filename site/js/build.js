import { reduced, inr, nearestToMiddle } from './env.js';

/**
 * The build — eight stages of a G+1, drawn and counted.
 *
 * Same mechanism as the pinned phone: re-measure on every observer fire and
 * take the step nearest the middle. Sharing it is the point — two different
 * scroll behaviours on one page is one too many to reason about.
 *
 * What it advances is three things kept in step: the drawing gains a stage,
 * the rail fills, and the running total counts to the figure that stage ended
 * on. The figures come off the markup's `data-total`, so the copy beside each
 * step and the number under the drawing can never drift apart.
 */
const BUDGET = 6000000;

export function initBuild() {
  const house = document.getElementById('house');
  const steps = [...document.querySelectorAll('.hstep')];
  if (!house || !steps.length) return;

  const stages = [...house.querySelectorAll('.hs-g')],
        elTotal = document.getElementById('hs-total'),
        elBar   = document.getElementById('hs-bar'),
        elPct   = document.getElementById('hs-pct'),
        elRail  = document.getElementById('hs-rail'),
        FINAL   = +steps[steps.length - 1].dataset.total;

  let at = -1, raf = 0, net = 0, countFrom = FINAL;

  function setTotal(to, animate) {
    cancelAnimationFrame(raf);
    clearTimeout(net);
    const pct = Math.min(100, to / BUDGET * 100);
    elBar.style.width = pct + '%';
    elPct.textContent = Math.round(pct);
    if (!animate) { elTotal.textContent = inr(to); countFrom = to; return; }

    const land = () => { elTotal.textContent = inr(to); countFrom = to; };
    const from = countFrom;
    let t0 = 0;
    raf = requestAnimationFrame(function tick(now) {
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / 700);
      // Matches the CSS easing, so the figure and the drawing land together.
      elTotal.textContent = inr(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick); else land();
    });
    // Safety net, the same bargain the scroll reveals make. requestAnimationFrame
    // does not fire in a background tab, so a stage painted while the tab is
    // hidden would leave the figure reading whatever it read before — a WRONG
    // number beside a finished drawing, which is the one failure this section
    // cannot have. A figure that arrives without counting is fine; a figure
    // that disagrees with the stage beside it is not.
    net = setTimeout(land, 900);
  }

  function paint(n) {
    if (n === at) return;
    at = n;
    stages.forEach((g, i) => g.classList.toggle('done', i <= n));
    steps.forEach((st, i) => {
      st.classList.toggle('done', i <= n);
      st.classList.toggle('cur', i === n);
    });
    if (elRail) elRail.style.height = (n / (steps.length - 1)) * 100 + '%';
    setTotal(+steps[n].dataset.total, true);
  }

  if (reduced) {
    // The finished house and the final figure outright, the way the voice demo
    // renders its finished state instead of playing it. Nothing moves, and
    // nothing is withheld either.
    house.classList.add('settled');
    steps.forEach((st) => st.classList.add('done'));
    if (elRail) elRail.style.height = '100%';
    setTotal(FINAL, false);
    return;
  }

  const pick = () => paint(nearestToMiddle(steps));
  const io = new IntersectionObserver(pick, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
  steps.forEach((st) => io.observe(st));
  addEventListener('resize', pick, { passive: true });
  document.getElementById('hsteps').classList.add('live');
  // Start on stage one rather than on the finished house the markup holds, so
  // there is something left to watch.
  countFrom = +steps[0].dataset.total;
  pick();
}
