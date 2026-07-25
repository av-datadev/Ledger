// Keeps an installed (home-screen) copy of the app up to date.
//
// The service worker is built with skipWaiting + clientsClaim, so a new version
// takes over as soon as the browser *notices* it. The gap this closes is the
// noticing: an installed PWA that's never fully closed can sit on a months-old
// bundle because nothing triggers an update check. That's how a phone ends up
// running an older build than what's deployed.

let reloading = false;

export function watchForUpdates(): void {
  if (!("serviceWorker" in navigator)) return;

  // Whether this page is already controlled. On a first-ever install the
  // controller arrives for the first time and must NOT trigger a reload —
  // only a genuine swap of an existing controller means "new version".
  const hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true; // guard against a reload loop
    location.reload();
  });

  const check = () => {
    void navigator.serviceWorker
      .getRegistration()
      .then((r) => r?.update())
      .catch(() => {
        /* offline or blocked — the next check will retry */
      });
  };

  check(); // on launch
  setInterval(check, 30 * 60 * 1000); // and periodically while open
  // Coming back to the app (app switcher, unlock) is the most common moment a
  // phone has fresh network after a deploy.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) check();
  });
}
