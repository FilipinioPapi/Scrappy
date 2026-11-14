// Google TV: the bridge to the screens the app draws natively (Home, the library grids, film and show pages).
// The web side keeps history, the player, menus and every screen that isn't native yet.
// Native asks for things through window.__tvNative; the web tells native what is on top of it.
import { playItem, playSeries, toast } from './components.js';
import { pref } from './prefs.js';
import { homeRows } from './homeedit.js';

const N = window.ScrappyNative;
const root = document.documentElement;

// This app has its own logo (the regular app keeps logo.png).
const LOGO = 'logo-native.png';
function logos() { for (const i of document.querySelectorAll('img[src="logo.png"]')) i.src = LOGO; }
logos();

// The saved sort of each library grid ("sort:<library>" keys).
function sorts() {
  const o = {};
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('sort:')) o[k] = localStorage.getItem(k); } } catch {}
  return o;
}

// Settings that native screens need, kept by the web side.
function sendPrefs() {
  try {
    N.prefs(JSON.stringify({
      homeRows: localStorage.getItem('homeRows:tv') || '',
      heroMode: pref('heroMode'),
      genreLib: localStorage.getItem('genreLib') || '',
      sorts: sorts(),
    }));
  } catch {}
}
sendPrefs();
addEventListener('scrappy:pref', sendPrefs);
addEventListener('hashchange', sendPrefs);

// For testing on the TV (adb logcat -s ScrappyNative): which keys the page gets, and its focus.
const desc = (el) => (el ? `${el.tagName}.${String(el.className || '').slice(0, 30)}` : 'none');
const note = (m) => { try { N.note(m); } catch {} };
addEventListener('keydown', (e) => {
  if (!e.key.startsWith('Arrow') && e.key !== 'Enter') return;
  const before = desc(document.activeElement);
  setTimeout(() => note(`key ${e.key} rep=${e.repeat} on=${before} -> ${desc(document.activeElement)} prevented=${e.defaultPrevented} focus=${document.hasFocus()} vis=${document.visibilityState} native=${root.classList.contains('native')}`), 50);
}, true);
addEventListener('focus', () => note('window focus'));
addEventListener('blur', () => note('window blur'));
document.addEventListener('visibilitychange', () => note('visibility ' + document.visibilityState));

// Something changed what the screens should show (watched, favorites, a refresh, after playing).
['scrappy:refresh', 'scrappy:stale', 'scrappy:memclear', 'scrappy:rowcache-clear'].forEach((n) => addEventListener(n, () => { try { N.stale(); } catch {} }));

// What sits on top of the page: while any of these is open the web view shows over the native
// screen, and the remote's keys go to it. Messages (toasts) show but leave the keys alone.
const LAYERS = '#intro, .who, .tvu, .tvm, .ctx-menu:not([hidden]), .menu:not([hidden]), .tdrop:not([hidden]), .hed-shade, [role=dialog], .modal, .sheet, .ovl';
let sent = '';
let t = 0;
function check() {
  t = 0;
  logos();
  const playing = root.classList.contains('playing');
  const keys = playing || !!document.querySelector(LAYERS);
  const vis = keys || !!document.getElementById('toasts')?.firstElementChild;
  const s = `${vis}|${keys}|${playing}`;
  if (s === sent) return;
  sent = s;
  try { N.layer(vis, keys, playing); } catch {}
}
const soon = () => { if (!t) t = setTimeout(check, 16); };
new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
new MutationObserver(soon).observe(root, { attributes: true, attributeFilter: ['class'] });
check();

// The Edit home card works on a stand-in of the home rows; native reads the saved order back.
function editHome(rows) {
  const box = document.createElement('div');
  box.hidden = true;
  for (const r of rows) { const d = document.createElement('div'); d.dataset.hrow = r.id; box.appendChild(d); }
  document.body.appendChild(box);
  homeRows(box, 'tv', rows, 'Movies & TV');
  box.querySelector('.hedit').click();
  // Native screens have no web highlight: start the remote on the card's first entry.
  setTimeout(() => document.querySelector('.hed-shade button, .hed-shade [tabindex]')?.focus({ preventScroll: true }), 60);
  const gone = new MutationObserver(() => { if (!document.querySelector('.hed-shade')) { gone.disconnect(); box.remove(); sendPrefs(); } });
  gone.observe(document.body, { childList: true });
}

// The quick menu (hold OK) works on a card: a hidden stand-in is used for native posters.
function hold(id, inResume) {
  const wrap = document.createElement('div');
  if (inResume) wrap.dataset.cw = '';
  wrap.style.cssText = 'position:fixed;left:50%;top:50%;width:2px;height:2px;opacity:0;pointer-events:none';
  wrap.innerHTML = `<a class="card" data-id="${String(id).replace(/"/g, '')}"><div class="art"></div></a>`;
  document.body.appendChild(wrap);
  const card = wrap.firstElementChild;
  card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: innerWidth / 2, clientY: innerHeight / 2 }));
  let n = 0;
  const tm = setInterval(() => {
    const menu = document.querySelector('.ctx-menu:not([hidden])');
    if (menu && !menu.contains(document.activeElement)) menu.querySelector('button, [tabindex]')?.focus({ preventScroll: true });
    if ((!menu && n > 5) || ++n > 600) { clearInterval(tm); wrap.remove(); }
  }, 100);
}

// A pick list (Sort, Show, Genre on the library grids), answered back to native.
async function pick(req, title, options, cur) {
  const { tvPick } = await import('./tvmenu.js');
  const i = await tvPick(title, options, cur);
  try { N.picked(req, i == null ? -1 : i); } catch {}
}

// The web view just got the remote back (a native screen was showing). Android moves the page's
// highlight to its first element when that happens; put it back where it belongs.
function refocus() {
  const fix = () => {
    if (root.classList.contains('native') && !document.querySelector(LAYERS)) return;
    const a = document.activeElement;
    const layer = [...document.querySelectorAll(LAYERS)].pop();
    if (layer) { if (!layer.contains(a)) layer.querySelector('button, [tabindex], a, input')?.focus({ preventScroll: true }); return; }
    const view = document.getElementById('view');
    if (!a || a === document.body || a === view || !view?.contains(a)) window.__tvFocusFirst?.();
  };
  setTimeout(fix, 60); setTimeout(fix, 300);
}

window.__tvNative = {
  refocus,
  play: (id, fromStart) => playItem(id, !!fromStart),
  playSeries: (id, fromStart) => playSeries(id, !!fromStart),
  toast: (msg, err) => toast(msg, !!err),
  subtitles: (id) => import('./menu.js').then((m) => m.subtitlesDialog(id)).catch(() => {}),
  hold,
  editHome: (rows) => editHome(rows),
  who: () => import('./tvwho.js').then((m) => m.who({ side: true })).catch(() => {}),
  pick,
  genreLib: (id) => { try { localStorage.setItem('genreLib', id); } catch {} },
  sort: (key, i) => { try { localStorage.setItem(key, String(i)); } catch {} sendPrefs(); },
};
