// Google TV / Android TV: drive the app with the TV remote.
// Arrows move a highlight to the nearest thing in that direction, OK presses it,
// and Back closes whatever is open or goes back a screen. Loaded only on Android.

const root = document.documentElement;
root.classList.add('tv');
import('./tvupdate.js').catch(() => {});
// The side rail (set when it has loaded).
let railApi = null;
import('./tvrail.js').then((m) => { railApi = m; }).catch(() => {});
const inRail = (el) => !!railApi && railApi.inRail(el);

// The PC layout is made for a window about 1440 points wide. TVs report less,
// so scale the whole page to fit.
const BASE_W = 1440;
function fit() { const z = innerWidth < BASE_W ? innerWidth / BASE_W : 1; root.style.zoom = z < 1 ? String(z) : ''; root.style.setProperty('--tvzoom', String(z)); }
fit();
addEventListener('resize', () => { root.style.zoom = ''; fit(); });

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
// Things that sit on top of the page; while one is open the highlight stays inside it.
const LAYERS = '.tvu, .tvm, .ctx-menu:not([hidden]), #player:not([hidden]), .menu:not([hidden]), .tdrop:not([hidden]), [role=dialog], .modal, .sheet, .ovl';

function shown(el) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  if (el.closest('[hidden], [inert], .row-arrow')) return false;
  const cs = getComputedStyle(el);
  // Switches are drawn by a see-through checkbox, so those still count.
  return cs.visibility !== 'hidden' && cs.display !== 'none' && (Number(cs.opacity) > 0.05 || el.matches('.set-sw input'));
}

function scopeFor(el) {
  const layers = [...document.querySelectorAll(LAYERS)].filter(shown);
  const inLayer = el && layers.find((l) => l.contains(el));
  if (inLayer) return inLayer;
  return layers.at(-1) || document.getElementById('view')?.parentElement || document.body;
}

// Row titles ("Latest Movies") are links on the PC; on the TV the highlight skips them,
// so Down goes straight from one row of posters to the next.
const SKIP = '.section-head h2 a, .hero-dot, .hero-arrow';
function candidates(scope) {
  return [...scope.querySelectorAll(FOCUSABLE)].filter((el) => !el.matches(SKIP) && shown(el));
}

// Pick the closest element in the direction pressed. Straight-line neighbours win
// over diagonal ones, so moving along a row or down a list feels predictable.
function nearest(from, dir, list, strict = false) {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of list) {
    if (el === from || from.contains(el) || el.contains(from)) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    let main, side, overlap;
    if (dir === 'ArrowRight') { if (b.left < a.right - 4 && bx <= ax + 4) continue; main = Math.max(0, b.left - a.right); side = Math.abs(by - ay); overlap = b.bottom > a.top && b.top < a.bottom; }
    else if (dir === 'ArrowLeft') { if (b.right > a.left + 4 && bx >= ax - 4) continue; main = Math.max(0, a.left - b.right); side = Math.abs(by - ay); overlap = b.bottom > a.top && b.top < a.bottom; }
    else if (dir === 'ArrowDown') { if (b.top < a.bottom - 4 && by <= ay + 4) continue; main = Math.max(0, b.top - a.bottom); side = Math.abs(bx - ax); overlap = b.right > a.left && b.left < a.right; }
    else { if (b.bottom > a.top + 4 && by >= ay - 4) continue; main = Math.max(0, a.top - b.bottom); side = Math.abs(bx - ax); overlap = b.right > a.left && b.left < a.right; }
    // Sideways never leaves the line you're on: Left at the start of a row opens the rail instead.
    if (strict && !overlap && (dir === 'ArrowLeft' || dir === 'ArrowRight')) continue;
    const score = main + side * (overlap ? 0.5 : 2.5) + (overlap ? 0 : 400);
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

// Move the highlight and bring it into view. In a row of posters the row slides
// sideways to keep the poster centred, and the page lines up the whole row (title
// and posters) in the middle of the screen, so it never stops half way between rows.
// One glide per scroller. Every press only moves the glide's destination, so pressing
// fast (or holding) keeps one continuous motion instead of jumps or piled-up animations.
const glides = new Map();
function glideTo(box, prop, to) {
  const page = box === window;
  const read = () => (page ? scrollY : box[prop]);
  const write = (v) => (page ? scrollTo(scrollX, v) : (box[prop] = v));
  let g = glides.get(box);
  if (g) { g.to = to; return; }
  if (Math.abs(read() - to) < 1) return;
  g = { to, pos: read(), t: performance.now() };
  glides.set(box, g);
  const step = (now) => {
    const dt = Math.min(64, now - g.t); g.t = now;
    // Ease out toward the destination, and ease in from a standstill, so a long move
    // (a whole screen) starts gently and reads as one clean slide.
    const far = Math.abs(g.to - g.pos);
    let d = (g.to - g.pos) * (1 - Math.exp(-dt / (far > 320 ? 130 : 85)));
    const cap = (g.v || 0) + 0.55 * dt;
    if (Math.abs(d) > cap) d = Math.sign(d) * cap;
    g.v = Math.abs(d);
    g.pos += d;
    if (Math.abs(g.to - g.pos) < 0.6) { write(g.to); glides.delete(box); if (page) keepInView(); return; }
    write(g.pos);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// The highlight never ends up off the screen. Rows that fill in late change the page's height
// while it is still sliding, so once things settle the page lines up on the highlight again.
const probe = document.createElement('div');
probe.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none';
document.body.appendChild(probe);
const viewH = () => probe.getBoundingClientRect().height || innerHeight;
let keepT = 0;
function keepInView() {
  clearTimeout(keepT);
  keepT = setTimeout(() => {
    const el = document.activeElement, view = document.getElementById('view');
    if (!el || el === document.body || !view?.contains(el) || root.classList.contains('playing') || el.closest(LAYERS) || glides.has(window)) return;
    const r = el.getBoundingClientRect(), H = viewH();
    if (r.height < H * 0.9 && (r.top < -2 || r.bottom > H + 2)) go(el);
  }, 140);
}
{ const v = document.getElementById('view'); if (v && window.ResizeObserver) new ResizeObserver(keepInView).observe(v); }
// Where the page would sit with this element lined up: ask the browser, then put it back.
function pageTarget(el, block) {
  const y0 = scrollY;
  el.scrollIntoView({ block, inline: 'nearest', behavior: 'instant' });
  const y1 = scrollY;
  scrollTo(scrollX, y0);
  return y1;
}
// Pictures in the row you're on, and the row below it, load before you reach them.
function warm(row) {
  const sec = row.closest('section, [data-row]') || row;
  for (const box of [row, sec.nextElementSibling]) box?.querySelectorAll?.('img[loading="lazy"]').forEach((im, i) => { if (i < 24) im.loading = 'eager'; });
}
function go(el) {
  el.focus({ preventScroll: true });
  // Cards that sit on top of the page (update, menus) never move the page underneath.
  if (el.closest(LAYERS)) return;
  const row = el.closest('.row, .mrow');
  const hero = el.closest('[data-row="hero"], .hero');
  if (hero || el.closest('.tvd .detail-main')) { glideTo(window, '', 0); return; }
  // Settings' left list stays put while you move through it (it all fits on the screen).
  if (el.closest('.set-side')) { const r = el.getBoundingClientRect(); if (r.top < 0 || r.bottom > viewH()) glideTo(window, '', pageTarget(el, 'nearest')); return; }
  if (!row) { glideTo(window, '', pageTarget(el, 'center')); return; }
  warm(row);
  const left = el.offsetLeft - row.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
  glideTo(row, 'scrollLeft', Math.max(0, Math.min(left, row.scrollWidth - row.clientWidth)));
  const sec = row.closest('.genre-row, section, [data-row]') || row;
  const tall = sec.offsetHeight > (innerHeight / (parseFloat(root.style.zoom) || 1)) * 0.9;
  glideTo(window, '', pageTarget(sec, tall || sec.closest('.tvd') ? 'start' : 'center'));
}

function first(scope) {
  const list = candidates(scope);
  const view = document.getElementById('view');
  return list.find((el) => view?.contains(el) && el.matches('[data-tvfirst], .set-side a.on')) || list.find((el) => view?.contains(el) && el.matches('.hero .btn, .detail-buttons .btn')) || list.find((el) => view?.contains(el) && el.matches('.card, .row a, .mrow a')) || list.find((el) => view?.contains(el)) || list.find((el) => !inRail(el));
}

const isText = (el) => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(el.type)));

// Text boxes: the TV keyboard only opens when you press OK on the box, so the remote can move past it freely.
// (The sign-in box does this itself.)
const armable = (el) => isText(el) && el.id !== 'siIn' && (!el.readOnly || el.dataset.tvarm);
const disarm = (el) => { if (el && el.dataset.tvarm === 'on') { el.dataset.tvarm = 'off'; el.readOnly = true; } };
addEventListener('focusin', (e) => { const el = e.target; if (armable(el) && el.dataset.tvarm !== 'on') { el.dataset.tvarm = 'off'; el.readOnly = true; } }, true);
addEventListener('focusout', (e) => disarm(e.target), true);
addEventListener('tv-ime', (e) => { if (e.detail === false) disarm(document.activeElement); });
addEventListener('keydown', (e) => {
  const el = e.target;
  if (e.key !== 'Enter' || el?.dataset?.tvarm !== 'off') return;
  e.preventDefault(); e.stopImmediatePropagation();
  el.dataset.tvarm = 'on'; el.blur(); el.dataset.tvarm = 'on'; el.readOnly = false; el.focus({ preventScroll: true });
  const n = el.value.length; try { el.setSelectionRange(n, n); } catch {}
}, true);

// The remote's media buttons act like the PC's keyboard shortcuts.
const MEDIA = { MediaPlayPause: ' ', MediaPlay: ' ', MediaPause: ' ', MediaFastForward: 'ArrowRight', MediaRewind: 'ArrowLeft', MediaTrackNext: 'n' };
addEventListener('keydown', (e) => {
  const to = MEDIA[e.key];
  if (!to) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  dispatchEvent(new KeyboardEvent('keydown', { key: to, bubbles: true, cancelable: true }));
}, true);

addEventListener('keydown', (e) => {
  const k = e.key;
  const cur = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  if (k === 'Enter' && cur && cur.matches('input[type=checkbox], input[type=radio]')) { e.preventDefault(); cur.click(); return; }
  // Drop-downs: OK opens a TV list instead of the phone-style picker, and arrows move on.
  if (k === 'Enter' && cur?.tagName === 'SELECT') {
    e.preventDefault();
    const opts = [...cur.options].filter((o) => !o.disabled && !/search for more/i.test(o.textContent));
    const label = cur.getAttribute('aria-label') || cur.closest('label, .pick-wrap')?.querySelector('.pick-label, span')?.textContent || cur.previousElementSibling?.textContent || 'Choose';
    import('./tvmenu.js').then((m) => m.tvPick(label.trim(), opts.map((o) => o.textContent.trim()), opts.findIndex((o) => o.selected))).then((i) => { if (i == null || !cur.isConnected) return; cur.value = opts[i].value; cur.dispatchEvent(new Event('change', { bubbles: true })); });
    return;
  }
  if (!k.startsWith('Arrow') || e.defaultPrevented) return;
  // In a text box, Left/Right move the text cursor until it reaches the end.
  if (isText(cur) && k === 'ArrowLeft' && (cur.selectionStart ?? 0) > 0) return;
  if (isText(cur) && k === 'ArrowRight' && (cur.selectionEnd ?? 0) < cur.value.length) return;
  if (cur?.type === 'range' && (k === 'ArrowLeft' || k === 'ArrowRight')) return;
  e.preventDefault();
  const scope = scopeFor(cur);
  if (!cur || !scope.contains(cur)) { const f = first(scope); if (f) go(f); return; }
  // The side rail: Up/Down move inside it, Right goes back to where you were on the page.
  if (inRail(cur)) {
    if (k === 'ArrowLeft') return;
    if (k === 'ArrowRight') { leaveRail(); return; }
    const next = nearest(cur, k, candidates(scope).filter(inRail));
    if (next) next.focus({ preventScroll: true });
    return;
  }
  // Settings: Right from the list of sections goes into the section, Left comes back to it.
  if (k === 'ArrowRight' && cur.closest('.set-side')) { const f = candidates(scope).find((el) => el.closest('.set-body')); if (f) go(f); return; }
  if (k === 'ArrowLeft' && cur.closest('.set-body')) { const f = nearest(cur, k, candidates(scope).filter((el) => el.closest('.set-body')), true) || document.querySelector('.set-side a.on'); if (f) { go(f); return; } }
  const next = nearest(cur, k, candidates(scope).filter((el) => !inRail(el)), scope === pageScope());
  if (next) {
    // Down from a text box (Search) lands on the first thing in the line below, not the one under the middle of the box.
    if (isText(cur) && k === 'ArrowDown') {
      const t = next.getBoundingClientRect().top;
      const line = candidates(scope).filter((el) => !inRail(el) && Math.abs(el.getBoundingClientRect().top - t) < 8).sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left);
      go(line[0] || next); return;
    }
    // Coming down (or up) into a row of posters from buttons lands on the row's first one.
    // Coming down into a show's episodes lands on the one you are up to.
    const here = k === 'ArrowDown' && !cur.closest('#epList') ? next.closest('#epList')?.querySelector('[data-tvhere] .card') : null;
    if (here) { go(here); return; }
    // Up from the top line of an episode grid goes to its jump buttons, or the Row and Grid switch.
    if (k === 'ArrowUp' && cur.closest('.ep-grid') && !next.closest('.ep-grid')) { const up = document.querySelector('#epList .ep-block.on') || document.querySelector('.tvs-bar .season-tab.active') || document.querySelector('.tvs-seg .on'); if (up && shown(up)) { go(up); return; } }
    if (k === 'ArrowUp' && cur.closest('#epList') && !next.closest('#children')) { const up = document.querySelector('.tvs-bar .season-tab.active') || document.querySelector('.tvs-seg .on'); if (up && shown(up)) { go(up); return; } }
    const tabs = (k === 'ArrowDown' || k === 'ArrowUp') ? next.closest('.season-tabs') : null;
    if (tabs && !cur.closest('.season-tabs')) { go(tabs.querySelector('.season-tab.active') || next); return; }
    const r = next.closest('.row, .mrow');
    if (r && (k === 'ArrowDown' || k === 'ArrowUp') && !cur.closest('.row, .mrow') && r.scrollLeft < 4) { go(candidates(r)[0] || next); return; }
    go(next); return;
  }
  // Nothing further left on the page: Left opens the rail on the screen you're on.
  if (k === 'ArrowLeft' && railApi && scope === pageScope()) { fromPage = cur; railApi.railCurrent()?.focus({ preventScroll: true }); }
});
const pageScope = () => document.getElementById('view')?.parentElement || document.body;
let fromPage = null;
function leaveRail() {
  const back = fromPage && fromPage.isConnected && shown(fromPage) ? fromPage : first(pageScope());
  if (back) go(back);
}
addEventListener('tv:leave-rail', leaveRail);
// Picking another screen from the rail lands on that screen once it has drawn.
addEventListener('tv:rail-go', () => {
  fromPage = null; let n = 0;
  const t = setInterval(() => {
    if (!inRail(document.activeElement) && document.activeElement !== document.body) { clearInterval(t); return; }
    const f = first(pageScope());
    if (f && !inRail(f) && document.getElementById('view')?.contains(f)) { clearInterval(t); scrollTo(0, 0); f.focus({ preventScroll: true }); } else if (++n > 40) clearInterval(t);
  }, 120);
});

// Warm-up: resting on a poster for a moment fetches its page, so OK opens it at once.
let warmT = 0;
addEventListener('focusin', (e) => {
  clearTimeout(warmT);
  const m = e.target.closest?.('a.card[href*="#/item/"]')?.getAttribute('href').match(/#\/item\/([^/?]+)/);
  if (!m || root.classList.contains('playing')) return;
  warmT = setTimeout(() => import('./views.js').then((v) => v.warmItem(decodeURIComponent(m[1]))).catch(() => {}), 220);
});
// And once Home has settled, the libraries behind the side bar are fetched quietly.
let warmedLibs = false;
addEventListener('scrappy:ready', () => { if (warmedLibs) return; warmedLibs = true; setTimeout(() => import('./views.js').then((v) => v.warmLibraries()).catch(() => {}), 2500); });

// If the highlighted thing gets redrawn (the home banner changes picture, a row
// refreshes), the highlight stays in the same spot instead of jumping to the top.
const BOX = '[data-row], section, .maside, header, .menu, [role=dialog]';
let last = null;
addEventListener('focusin', (e) => {
  const el = e.target; const box = el.closest?.(BOX);
  last = box ? { box, sel: box.matches('[data-row]') ? `[data-row="${box.dataset.row}"]` : null, idx: candidates(box).indexOf(el) } : null;
});
let settle = 0;
new MutationObserver(() => {
  clearTimeout(settle);
  settle = setTimeout(() => {
    // The video player looks after its own highlight (none at all while you just watch).
    if (root.classList.contains('playing')) return;
    const cur = document.activeElement;
    if (cur && cur !== document.body && cur.isConnected && shown(cur)) return;
    const box = last && (last.box.isConnected ? last.box : last.sel && document.querySelector(last.sel));
    const same = box && shown(box) ? candidates(box) : [];
    const f = same.length ? same[Math.min(Math.max(last.idx, 0), same.length - 1)] : first(scopeFor(null));
    if (f) f.focus({ preventScroll: true });
  }, 60);
}).observe(document.body, { childList: true, subtree: true });

// ---------- Hold OK: quick menu ----------
// A short press opens the poster or episode; holding OK brings up its quick menu
// (play, start over, watched, favorite), the same one a right-click gives on the PC.
const HOLDABLE = '.card[data-id], .season-tab[data-season]';
let held = null;
addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  // Still holding after the menu opened: nothing in the menu gets pressed by accident.
  if (held?.done) { e.preventDefault(); e.stopImmediatePropagation(); return; }
  const el = document.activeElement?.closest?.(HOLDABLE);
  if (!el || el !== document.activeElement) return;
  e.preventDefault();
  if (!e.repeat) { held = { el, at: performance.now(), done: false }; return; }
  if (!held || held.el !== el || held.done || performance.now() - held.at < 550) return;
  held.done = true;
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  let n = 0, seen = false;
  const t = setInterval(() => {
    const menu = document.querySelector('.ctx-menu:not([hidden])');
    if (!menu) { if (seen || ++n > 40) { clearInterval(t); if (seen && el.isConnected && (document.activeElement === document.body || !shown(document.activeElement))) el.focus({ preventScroll: true }); } return; }
    seen = true;
    if (!held && !menu.contains(document.activeElement)) candidates(menu)[0]?.focus({ preventScroll: true });
  }, 100);
}, true);
addEventListener('keyup', (e) => {
  if (e.key !== 'Enter' || !held) return;
  const h = held; held = null;
  if (h.done) { e.preventDefault(); e.stopImmediatePropagation(); return; }
  if (h.el === document.activeElement) h.el.click();
}, true);

// ---------- Back button ----------
// Called by the Android app when Back is pressed. Returns true if the page handled it.
const TOP = new Set(['', '#', '#/', '#/home', '#/music', '#/audiobooks', '#/login']);
const watcher = new MutationObserver(() => {});
watcher.observe(document.body, { attributes: true, attributeOldValue: true, childList: true, subtree: true });
window.__tvBack = () => {
  // On the side rail, Back just closes it.
  if (inRail(document.activeElement)) { leaveRail(); return true; }
  // 1. Let whatever is open close itself (menus, panels, the player) through Escape.
  watcher.takeRecords();
  const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  const changed = watcher.takeRecords().some((r) => r.type === 'childList' ? (r.addedNodes.length || r.removedNodes.length) : r.target.getAttribute(r.attributeName) !== r.oldValue);
  // While a video is up, Back belongs to the player (it closes panels, hides the bar, then leaves).
  if (changed || root.classList.contains('playing')) return true;
  // 2. Otherwise go back a screen, until you're on a tab's home screen.
  if (!TOP.has(location.hash)) { history.back(); return true; }
  return false;
};
