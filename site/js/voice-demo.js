import { reduced } from './env.js';

/**
 * The one thing on this page you can operate.
 *
 * Two real phrases, played the way the app plays them: the words arrive first,
 * then the fields fill, then it saves. The second take is the point of the whole
 * feature — "saadhe teen hazaar" is ₹3,500, and no keyboard was involved.
 *
 * Nothing is recorded and no microphone is touched. The card says so, because a
 * mic button that isn't a mic button would otherwise be a small lie.
 */
const TAKES = [
  { say: '2000 ka cement Gopal se liya',
    fields: [['Item', 'Cement'], ['Dealer', 'Gopal'], ['Amount', '₹2,000']] },
  { say: 'saadhe teen hazaar plumber ko diye',
    fields: [['Item', 'Plumbing'], ['Person', 'Plumber'], ['Amount', '₹3,500']] },
];

export function initVoiceDemo() {
  const demo = document.getElementById('demo');
  if (!demo) return;

  const heard = document.getElementById('heard-text'),
        fieldBox = document.getElementById('fields'),
        saved = document.getElementById('saved'),
        btn = document.getElementById('demo-btn'),
        btnLabel = document.getElementById('demo-btn-label');

  // Under prefers-reduced-motion nothing animates, so the first press should at
  // least land on the OTHER phrase — otherwise it repaints exactly what is
  // already on screen and reads as a dead button.
  let take = reduced ? 1 : 0, timers = [], playing = false;

  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const clearAll = () => { timers.forEach(clearTimeout); timers = []; };

  function paintFields(t, on) {
    fieldBox.innerHTML = '';
    t.fields.forEach((f) => {
      const row = document.createElement('div');
      row.className = 'f' + (on ? ' on' : '');
      const k = document.createElement('span'); k.className = 'k'; k.textContent = f[0];
      const v = document.createElement('span');
      v.className = 'v' + (f[1].charAt(0) === '₹' ? ' money' : '');
      v.textContent = f[1];
      row.append(k, v); fieldBox.append(row);
    });
  }

  function finish(t) {
    playing = false;
    demo.classList.remove('listening');
    heard.textContent = t.say;
    paintFields(t, true);
    saved.classList.add('on');
    btn.disabled = false;
    btnLabel.textContent = 'Say another';
  }

  function play() {
    clearAll();
    const t = TAKES[take];
    take = (take + 1) % TAKES.length;
    saved.classList.remove('on');
    if (reduced) { finish(t); return; }

    playing = true;
    btn.disabled = true;
    btnLabel.textContent = 'Listening…';
    demo.classList.add('listening');
    heard.textContent = '';
    paintFields(t, false);

    // The words, one at a time — a transcript arriving, not a label appearing.
    let i = 0;
    (function type() {
      heard.textContent = t.say.slice(0, ++i);
      if (i < t.say.length) later(type, 34);
      else later(fill, 420);
    })();

    // Then the form fills itself, top to bottom.
    function fill() {
      demo.classList.remove('listening');
      const rows = fieldBox.querySelectorAll('.f');
      rows.forEach((r, n) => later(() => r.classList.add('on'), n * 300));
      later(() => finish(t), rows.length * 300 + 350);
    }
  }

  btn.addEventListener('click', play);

  // The buttons that promise the demo actually start it, once the smooth scroll
  // has landed. A link that says "play it again" and then plays nothing is
  // worse than no link.
  document.querySelectorAll('a[href="#say"]').forEach((a) => {
    a.addEventListener('click', () => later(play, 700));
  });

  // Play once, unprompted, the first time it scrolls into view — the page
  // should demonstrate itself before anyone decides to press anything.
  if (!reduced) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting && !playing) { io.disconnect(); play(); }
      });
    }, { threshold: .3 });
    io.observe(demo);
  }
}
