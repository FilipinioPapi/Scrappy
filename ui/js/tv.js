// Google TV / Android TV: drive the app with the TV remote.
// Arrows move a highlight to the nearest thing in that direction, OK presses it,
// and Back closes whatever is open or goes back a screen. Loaded only on Android.

const root = document.documentElement;
root.classList.add('tv');

// The PC layout is made for a window about 1440 points wide. TVs report less,
// so scale the whole page to fit.
const BASE_W = 1440;
function fit() { root.style.zoom = innerWidth < BASE_W ? String(innerWidth / BASE_W) : ''; }
fit();
addEventListener('resize', () => { root.style.zoom = ''; fit(); });

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
// Things that sit on top of the page; while one is open the highlight stays inside it.
const LAYERS = '#player.open, .menu:not([hidden]), .tdrop:not([hidden]), [role=dialog], .modal, .sheet, .ovl';

function shown(el) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  if (el.closest('[hidden], [inert], .row-arrow')) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
}

function scopeFor(el) {
  const layers = [...document.querySelectorAll(LAYERS)].filter(shown);
  const inLayer = el && layers.find((l) => l.contains(el));
  if (inLayer) return inLayer;
  return layers.at(-1) || document.getElementById('view')?.parentElement || document.body;
}

function candidates(scope) {
  return [...scope.querySelectorAll(FOCUSABLE)].filter(shown);
}

// Pick the closest element in the direction pressed. Straight-line neighbours win
// over diagonal ones, so moving along a row or down a list feels predictable.
function nearest(from, dir, list) {
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
    const score = main + side * (overlap ? 0.5 : 2.5) + (overlap ? 0 : 400);
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

function go(el) {
  el.focus({ preventScroll: true });
  const vertical = !el.closest('.row, .mrow');
  el.scrollIntoView({ block: vertical ? 'center' : 'nearest', inline: 'center', behavior: 'smooth' });
}

function first(scope) {
  const list = candidates(scope);
  const view = document.getElementById('view');
  return list.find((el) => view?.contains(el) && el.matches('.card, .row a, .mrow a')) || list.find((el) => view?.contains(el)) || list[0];
}

const isText = (el) => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(el.type)));

addEventListener('keydown', (e) => {
  const k = e.key;
  const cur = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  if (k === 'Enter' && cur && cur.matches('input[type=checkbox], input[type=radio]')) { e.preventDefault(); cur.click(); return; }
  if (!k.startsWith('Arrow') || e.defaultPrevented) return;
  if (cur?.tagName === 'SELECT') return;
  // In a text box, Left/Right move the text cursor until it reaches the end.
  if (isText(cur) && k === 'ArrowLeft' && (cur.selectionStart ?? 0) > 0) return;
  if (isText(cur) && k === 'ArrowRight' && (cur.selectionEnd ?? 0) < cur.value.length) return;
  if (cur?.type === 'range' && (k === 'ArrowLeft' || k === 'ArrowRight')) return;
  e.preventDefault();
  const scope = scopeFor(cur);
  if (!cur || !scope.contains(cur)) { const f = first(scope); if (f) go(f); return; }
  const next = nearest(cur, k, candidates(scope));
  if (next) go(next);
});

// When a new screen appears and nothing has the highlight, put it on the first thing.
let settle = 0;
new MutationObserver(() => {
  clearTimeout(settle);
  settle = setTimeout(() => {
    const cur = document.activeElement;
    if (cur && cur !== document.body && cur.isConnected && shown(cur)) return;
    const f = first(scopeFor(null));
    if (f) f.focus({ preventScroll: true });
  }, 180);
}).observe(document.body, { childList: true, subtree: true });

// ---------- Back button ----------
// Called by the Android app when Back is pressed. Returns true if the page handled it.
const TOP = new Set(['', '#', '#/', '#/home', '#/music', '#/audiobooks']);
const watcher = new MutationObserver(() => {});
watcher.observe(document.body, { attributes: true, attributeOldValue: true, childList: true, subtree: true });
window.__tvBack = () => {
  // 1. Let whatever is open close itself (menus, panels, the player) through Escape.
  watcher.takeRecords();
  const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  const changed = watcher.takeRecords().some((r) => r.type === 'childList' ? (r.addedNodes.length || r.removedNodes.length) : r.target.getAttribute(r.attributeName) !== r.oldValue);
  if (changed) return true;
  // 2. Otherwise go back a screen, until you're on a tab's home screen.
  if (!TOP.has(location.hash)) { history.back(); return true; }
  return false;
};
