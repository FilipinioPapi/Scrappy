// Tiles and their artwork arrive together.
//
// 1. A picture this session has already shown is put straight in when it is drawn again
//    (coming back to a page, a list that refreshes, a row that redraws): no coloured tile
//    first, no second fade.
// 2. A page that has just been drawn (or a row that turns up late on a home page) is held
//    back for a moment until the pictures you can see in it are ready, then shown in one
//    go. Pictures that take longer than that fade in over their tile as before.
//
// Nothing here changes what a page looks like once it has settled.
const view = document.getElementById('view');
const MAX_WAIT = 240;   // longest a page waits for its pictures
const EARLY = 1600;     // how long after a page change new pieces count as part of that page
const seen = new Set(); // picture addresses that have loaded this session

// Google TV: every picture is fetched through the app (a slow trip on a TV, even from its own
// storage), and the browser forgets a picture as soon as nothing on screen uses it. Holding on to
// the ones already shown means the next page that uses them draws them at once.
const TV = document.documentElement.classList.contains('tv');
const held = new Map(); // address -> Image
function hold(src) {
  if (!TV || !src || src.startsWith('data:')) return;
  const had = held.get(src);
  if (had) { held.delete(src); held.set(src, had); return; }
  const im = new Image(); im.decoding = 'async'; im.src = src; held.set(src, im);
  if (held.size > 320) held.delete(held.keys().next().value);
}
document.addEventListener('load', (e) => { const t = e.target; if (t && t.tagName === 'IMG' && t.naturalWidth) { const src = t.currentSrc || t.src; seen.add(src); if (t.naturalWidth <= 800) hold(src); } }, true);
// Clearing the picture cache (Settings) or signing out: those pictures have to load again.
export const forgetArt = () => { seen.clear(); held.clear(); };
window.addEventListener('scrappy:rowcache-clear', forgetArt);
window.addEventListener('scrappy:art-clear', forgetArt);

let routeAt = performance.now();
/** A page change has started. */
export const artPageStart = () => { routeAt = performance.now(); };

// The class a picture gets when it has loaded lives in its own onload ("in", "loaded", ...),
// so running that early is all it takes to show it at once.
function showNow(im) {
  if (im.dataset.pre || typeof im.onload !== 'function') return;
  im.dataset.pre = '1';
  im.classList.add('pre');
  if (im.loading === 'lazy') im.loading = 'eager';
  try { im.onload(); } catch {}
  requestAnimationFrame(() => requestAnimationFrame(() => im.classList.remove('pre')));
}

const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > -40 && r.top < innerHeight + 40 && r.right > 0 && r.left < innerWidth; };

let gate = null; // { nodes, pending, timer }
function release() {
  const g = gate; if (!g) return;
  gate = null; clearTimeout(g.timer);
  const calm = document.documentElement.classList.contains('calm');
  for (const n of g.nodes) {
    if (!n.isConnected) continue;
    n.removeAttribute('data-hold');
    if (calm) continue;
    // The page's own entrance plays from its start if it has one; otherwise a soft fade.
    if (getComputedStyle(n).animationName !== 'none') continue;
    let moving = false;
    for (let p = n.parentElement; p && p !== view.parentElement; p = p.parentElement) if (p.getAnimations().some((a) => a.playState === 'running')) { moving = true; break; }
    if (moving) continue;
    const top = n.parentElement === view || n.parentElement?.classList.contains('mmain');
    n.animate(top ? [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }] : [{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' });
  }
}
function settle(g) {
  if (g !== gate || g.pending.size) return;
  // One more frame, so rows that land a moment apart still come in together.
  requestAnimationFrame(() => { if (g === gate && !g.pending.size) release(); });
}
function watch(g, im) {
  g.pending.add(im);
  const done = () => { g.pending.delete(im); settle(g); };
  im.addEventListener('load', () => { (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(done); }, { once: true });
  im.addEventListener('error', done, { once: true });
}

// Which freshly added pieces may be held: page content, and entries in a side menu that
// have a new picture of their own to wait for (the rest of the menu never blinks). Never the
// loading spinner, the banner's own slides, or anything marked data-nohold (lists that
// redraw as you scroll).
const inSide = (n) => !!n.closest('.maside, .mpanel');
function holdable(n, early) {
  if (n.tagName === 'IMG' || n.classList.contains('loading') || n.classList.contains('mshell') || n.classList.contains('mmain') || n.classList.contains('maside') || n.classList.contains('mpanel')) return false;
  if (n.closest('.hero, [data-nohold], [data-hold]')) return false;
  if (n.querySelector('.maside, .mpanel')) return false;
  if (n.querySelector('.mmain')) return false;
  if (!early && !n.closest('[data-hrow], [data-row]')) return false;
  return true;
}

new MutationObserver((muts) => {
  const added = [];
  for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && n.isConnected) added.push(n);
  if (!added.length) return;
  // 1. Pictures already shown this session go straight in.
  for (const n of added) {
    const ims = n.tagName === 'IMG' ? [n] : n.getElementsByTagName('img');
    for (const im of ims) { const src = im.getAttribute('src'); if (src && seen.has(im.src)) showNow(im); }
  }
  // 2. New page content waits for the pictures you can see in it.
  if (view.classList.contains('quiet')) return;
  const early = performance.now() - routeAt < EARLY;
  if (!early && !gate && !added.some((n) => view.contains(n) && n.closest('[data-hrow], [data-row]'))) return;
  const fresh = added.filter((n) => view.contains(n) && holdable(n, early));
  if (!fresh.length) return;
  const tops = fresh.filter((n) => !fresh.some((o) => o !== n && o.contains(n)));
  const waitFor = [], held = [];
  for (const n of tops) {
    let own = 0;
    for (const im of n.getElementsByTagName('img')) {
      if (waitFor.length >= 80) break;
      if (!im.getAttribute('src') || im.complete || im.dataset.pre || !onScreen(im)) continue;
      waitFor.push(im); own++;
    }
    if (own || !inSide(n)) held.push(n);
  }
  if (!waitFor.length && !gate) return;
  if (!gate) { gate = { nodes: new Set(), pending: new Set() }; gate.timer = setTimeout(release, MAX_WAIT); }
  const g = gate;
  for (const n of held) { n.setAttribute('data-hold', ''); g.nodes.add(n); }
  for (const im of waitFor) watch(g, im);
  settle(g);
}).observe(document.body, { childList: true, subtree: true });
