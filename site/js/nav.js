/**
 * The sticky nav.
 *
 * Two jobs: gain a hairline once you have moved off the top, and — on pages
 * whose hero is the dark band — stay transparent and light-on-dark until you
 * have scrolled past it. The second is why `scrolled` and `on-dark` are
 * separate classes rather than one state.
 */
export function initNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const hero = document.querySelector('.hero');
  if (hero) nav.classList.add('on-dark');

  const sync = () => {
    // Past the hero, the nav is over paper again and goes back to ink.
    const past = hero ? scrollY > hero.offsetHeight - nav.offsetHeight : scrollY > 10;
    nav.classList.toggle('scrolled', past);
  };
  addEventListener('scroll', sync, { passive: true });
  addEventListener('resize', sync, { passive: true });
  sync();

  // A disclosure menu that stays open behind you is a menu you have to go back
  // and close. Clicking out, or pressing Escape, shuts it.
  const menu = document.querySelector('.navmenu');
  if (!menu) return;
  addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.removeAttribute('open'); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.hasAttribute('open')) {
      menu.removeAttribute('open');
      menu.querySelector('summary').focus();
    }
  });
}
