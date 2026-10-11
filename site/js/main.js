/**
 * Entry point. One module per behaviour, each one guarding its own markup, so a
 * section can be removed from the page without anything here needing to know.
 *
 * Native ES modules: no bundler, no build step, nothing to install. They need
 * to be served over HTTP rather than opened as a file:// URL — which is what
 * `.claude/launch.json` and Vercel both do.
 */
import { initNav } from './nav.js';
import { initHero } from './hero.js';
import { initReveal } from './reveal.js';
import { initPinnedPhone } from './pinned-phone.js';
import { initBuild } from './build.js';
import { initVoiceDemo } from './voice-demo.js';

initNav();
initHero();
initReveal();
initPinnedPhone();
initBuild();
initVoiceDemo();
