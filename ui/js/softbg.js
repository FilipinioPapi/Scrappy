// Big blurred backgrounds (album, playlist and book pages, Now playing, follow-along) used to be a
// full-size picture with a CSS blur. The graphics chip redoes such a blur on every frame the
// screen changes (scrolling, the visualiser, moving text), which is costly on weak PCs.
// Now each picture is blurred once into a tiny copy that the screen simply stretches: it looks
// the same and costs nothing per frame.
import { listen } from './api.js';

// The window is minimised: nothing on screen needs drawing (set by the app, see lib.rs).
export const win = { min: false };
listen('win-min', ({ payload }) => { win.min = !!payload; document.documentElement.classList.toggle('minimized', win.min); });

const SOFT = '.mhero-bg img, .mn-bg img, .fp-bg img';
const SAT = { 'mn-bg': 1.5, 'fp-bg': 1.3 };
const made = new Map(); // picture address -> Promise<tiny blurred copy, or null>

function soften(src, sat) {
  const k = sat + '|' + src;
  if (!made.has(k)) {
    if (made.size > 60) made.delete(made.keys().next().value);
    made.set(k, new Promise((res) => {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => {
        try {
          const w = 32, h = Math.max(8, Math.round((w * im.naturalHeight) / (im.naturalWidth || 1)));
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const x = c.getContext('2d');
          x.filter = `blur(2.5px) saturate(${sat})`;
          x.drawImage(im, -4, -4, w + 8, h + 8); // drawn a little larger so the edges stay solid
          res(c.toDataURL('image/png'));
        } catch { res(null); }
      };
      im.onerror = () => res(null);
      im.src = src;
    }));
  }
  return made.get(k);
}

document.addEventListener('load', (e) => {
  const im = e.target;
  if (!(im instanceof HTMLImageElement) || im.src.startsWith('data:') || !im.matches(SOFT)) return;
  const box = im.parentElement.className.split(' ').find((c) => SAT[c]);
  const src = im.src;
  soften(src, SAT[box] || 1.4).then((url) => {
    if (im.src !== src) return; // replaced meanwhile
    if (url) im.src = url; else im.classList.add('hardblur');
    im.classList.add('soft');
  });
}, true);
