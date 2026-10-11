/**
 * Scroll reveal. Elements start hidden ONLY because `.js` is on the html
 * element, so with JavaScript off the page is simply fully visible.
 */
export function initReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: .12, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  // Two safety nets. Content that never reveals is content nobody can read,
  // which is a worse failure than an animation that never plays.
  const showVisible = (margin) => {
    document.querySelectorAll('.reveal:not(.in)').forEach((el) => {
      if (el.getBoundingClientRect().top < innerHeight * margin) el.classList.add('in');
    });
  };
  addEventListener('load', () => showVisible(1.1));
  setTimeout(() => showVisible(1), 1400);
}
