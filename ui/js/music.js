// The Music tab (Navidrome): side menu with Your Library, and every Music screen.
// Screens follow the approved mock-ups on the Music design canvas.
import { api, quiet } from './api.js';
import { esc, toast, loadingHtml } from './components.js';
import { music, onMusic, current, playSongs, playNext, addToQueue, playAt, removeAt, moveInQueue, clearUpNext, setFavorite, togglePlay, cover, fmt, IC } from './mplayer.js';

const line = (d, n = 20) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const NAV = [
  ['home', 'Home', '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'],
  ['albums', 'Albums', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>'],
  ['artists', 'Artists', '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'],
  ['songs', 'Songs', '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'],
  ['genres', 'Genres', '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'],
  ['playlists', 'Playlists', '<path d="M4 6h12M4 11h12M4 16h7"/><path d="M19 8v8.5"/><circle cx="16.5" cy="17" r="2.5"/>'],
];
export const MI = {
  pin: line('<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z"/><path d="M12 14v6"/>', 14),
  pinOn: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z" fill="currentColor" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M12 14v6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>',
  collapse: line('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16M15 10l-2 2 2 2"/>'),
  back: line('<path d="M15 6l-6 6 6 6"/>', 18),
  search: line('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>', 18),
  clock: line('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 16),
  close: line('<path d="M6 6l12 12M18 6 6 18"/>'),
  plus: line('<path d="M12 5v14M5 12h14"/>', 18),
  album: line('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>', 18),
  artist: line('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>', 18),
  next: line('<path d="M4 6h12M4 11h9M4 16h6"/><path d="M15 13.5v6l5-3z"/>', 18),
  addq: line('<path d="M4 6h12M4 11h12M4 16h7"/><path d="M17 14v6M14 17h6"/>', 18),
  list: line('<path d="M4 6h12M4 11h12M4 16h7"/><path d="M19 8v8.5"/><circle cx="16.5" cy="17" r="2.5"/>', 18),
  check: line('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 14),
  grip: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><g fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></g></svg>',
  eq: '<span class="eq"><i></i><i></i><i></i></span>',
};

// ---------- Small helpers ----------
export const hue = (s) => [...String(s || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
export function coverHtml(id, title, w = 300, cls = '') {
  const h = hue(title || id);
  return `<div class="mcv ${cls}" style="--h:${h}"><span>${esc(title || '')}</span>${id ? `<img loading="lazy" src="${cover(id, w)}" alt="" onload="this.classList.add('in')" onerror="this.remove()">` : ''}</div>`;
}
export const totalTime = (secs) => { const m = Math.round(secs / 60); return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`; };
export const plural = (n, w) => `${(n || 0).toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
export const dateStr = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
export const href = (type, id) => `#/music/${type}/${encodeURIComponent(id)}`;
const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
export const nd = (endpoint, params = {}) => api.nd(endpoint, typeof params === 'string' ? params : q(params));

// Show the saved copy first, then refresh. render(data, fromCache)
export async function ndLoad(endpoint, params, render, alive) {
  const query = typeof params === 'string' ? params : q(params);
  const cached = await api.ndCached(endpoint, query).catch(() => null);
  let shown = null;
  if (cached) { shown = JSON.stringify(cached); if (alive()) render(cached, true); }
  try {
    const fresh = await api.nd(endpoint, query);
    if (alive() && JSON.stringify(fresh) !== shown) { if (shown) quiet(); render(fresh, false); }
    return fresh;
  } catch (e) { if (!cached) throw e; return cached; }
}

// ---------- Your Library (recents + pins), kept on this computer ----------
const LIB_KEY = 'mlib';
export let lib = { rec: [], pins: [], hpins: [], fil: 'all', collapsed: false, width: 272 };
try { Object.assign(lib, JSON.parse(localStorage.getItem(LIB_KEY) || '{}')); } catch {}
export const saveLib = () => { try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); } catch {} };
let playlistsCache = [];

export const syncNow = () => syncRows();
export function bump(entry) {
  lib.rec = [entry, ...lib.rec.filter((r) => r.k !== entry.k)].slice(0, 40);
  saveLib(); drawLib(true);
}
function libEntries() {
  const seen = new Set(lib.rec.map((r) => r.k));
  const extra = playlistsCache.filter((p) => !seen.has('pl:' + p.id)).map(plEntry);
  return [...lib.rec, ...extra];
}
const plEntry = (p) => ({ k: 'pl:' + p.id, t: p.name, sub: `Playlist · ${plural(p.songCount, 'song')}`, cv: p.coverArt });
export const kindOf = (k) => ({ pl: 'playlist', al: 'album', ar: 'artist' }[k.slice(0, 2)]);

function libItem(e, pinned) {
  const kind = kindOf(e.k);
  return `<a class="mli${pinned ? ' pinned' : ''}" href="${href(kind, e.k.slice(3))}" data-k="${esc(e.k)}" title="${esc(e.t)}">
    ${coverHtml(e.cv, '', 100, kind === 'artist' ? 'round' : '')}
    <div class="mli-txt"><div class="t1">${esc(e.t)}</div><div class="t2">${pinned ? `<span class="pinmark">${MI.pinOn}</span>` : ''}${esc(e.sub)}</div></div>
    <button type="button" class="mli-pin" data-pin="${esc(e.k)}" title="${pinned ? 'Unpin' : 'Pin to side menu'}" aria-label="${pinned ? 'Unpin' : 'Pin to side menu'}">${pinned ? MI.pinOn : MI.pin}</button>
  </a>`;
}
function drawLib(animate) {
  const box = document.getElementById('mlib'); if (!box) return;
  const all = libEntries();
  const ok = (e) => lib.fil === 'all' || kindOf(e.k) === lib.fil;
  const pins = lib.pins.map((k) => all.find((e) => e.k === k)).filter(Boolean).filter(ok);
  const rest = all.filter((e) => !lib.pins.includes(e.k)).filter(ok);
  const before = animate ? flipFirst(box) : null;
  box.innerHTML = (pins.length ? `<div class="mlsec">PINNED</div>${pins.map((e) => libItem(e, true)).join('')}<div class="mlsec">RECENTS</div>` : '')
    + rest.map((e) => libItem(e, false)).join('')
    + (!pins.length && !rest.length ? '<div class="t2 mlempty">Nothing here yet</div>' : '');
  if (before) flipLast(box, before);
  document.querySelectorAll('.mchip').forEach((c) => c.classList.toggle('on', c.dataset.f === lib.fil));
  markActive();
}
// Smoothly slide library rows to their new places.
function flipFirst(box) { const m = new Map(); box.querySelectorAll('[data-k]').forEach((el) => m.set(el.dataset.k, el.getBoundingClientRect().top)); return m; }
function flipLast(box, before) {
  box.querySelectorAll('[data-k]').forEach((el) => {
    const was = before.get(el.dataset.k);
    if (was === undefined) { el.animate([{ opacity: 0, transform: 'translateX(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' }); return; }
    const dy = was - el.getBoundingClientRect().top;
    if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
}
function markActive() {
  const h = decodeURIComponent((location.hash.split('?')[0] || ''));
  document.querySelectorAll('.mli').forEach((a) => a.classList.toggle('on', decodeURIComponent(a.getAttribute('href')) === h));
  const page = h.split('/')[2] || 'home';
  const navPage = { album: 'albums', artist: 'artists', genre: 'genres', playlist: 'playlists', search: '' }[page] ?? page;
  document.querySelectorAll('.mnav').forEach((a) => a.classList.toggle('on', a.dataset.p === navPage));
}

function shellHtml() {
  return `
  <div class="mshell${lib.collapsed ? ' collapsed' : ''}" style="--mside:${lib.collapsed ? 76 : lib.width}px">
    <aside class="maside">
      <div class="mhead"><span class="lbl">MUSIC</span><button type="button" class="gb" id="mCol" title="Collapse / expand" aria-label="Collapse or expand the side menu">${MI.collapse}</button></div>
      ${NAV.map(([p, l, d]) => `<a class="mnav" data-p="${p}" href="#/music/${p}" title="${l}">${line(d)}<span class="lbl">${l}</span></a>`).join('')}
      <div class="msep"></div>
      <div class="mlibh lbl">YOUR LIBRARY</div>
      <div class="mchips lbl">${[['playlist', 'Playlists'], ['album', 'Albums'], ['artist', 'Artists']].map(([f, l]) => `<button type="button" class="mchip" data-f="${f}">${l}</button>`).join('')}</div>
      <div id="mlib"></div>
      <div class="mgrab" title="Drag to resize"></div>
    </aside>
    <section class="mmain" id="mmain"></section>
    <aside class="mpanel" id="mpanel" hidden></aside>
  </div>`;
}

function wireShell(root) {
  const shell = root.querySelector('.mshell');
  root.querySelector('#mCol').onclick = () => {
    lib.collapsed = !lib.collapsed; saveLib();
    shell.classList.toggle('collapsed', lib.collapsed);
    shell.style.setProperty('--mside', (lib.collapsed ? 76 : lib.width) + 'px');
  };
  root.querySelector('.mchips').onclick = (e) => {
    const c = e.target.closest('.mchip'); if (!c) return;
    lib.fil = lib.fil === c.dataset.f ? 'all' : c.dataset.f; saveLib(); drawLib(true);
  };
  root.querySelector('#mlib').addEventListener('click', (e) => {
    const p = e.target.closest('[data-pin]'); if (!p) return;
    e.preventDefault(); e.stopPropagation();
    const k = p.dataset.pin;
    lib.pins = lib.pins.includes(k) ? lib.pins.filter((x) => x !== k) : [k, ...lib.pins];
    saveLib(); drawLib(true);
  });
  // Drag the right edge to resize the side menu.
  root.querySelector('.mgrab').addEventListener('pointerdown', (e) => {
    if (lib.collapsed) return;
    const g = e.currentTarget; g.setPointerCapture(e.pointerId); shell.classList.add('resizing');
    const mv = (ev) => { lib.width = Math.max(220, Math.min(420, ev.clientX)); shell.style.setProperty('--mside', lib.width + 'px'); };
    const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); shell.classList.remove('resizing'); saveLib(); };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
  });
  nd('getPlaylists').then((r) => { playlistsCache = r.playlists?.playlist || []; drawLib(false); }).catch(() => {});
  drawLib(false);
}

// ---------- Song lists ----------
// A table of songs. cols: which extra columns to show ('album', 'added', 'plays', 'cover').
export function songTable(songs, { cols = ['album', 'added'], numbers = false, start = 0, keyPrefix = '' } = {}) {
  const head = `<div class="srow shead">
    <span class="c-n">#</span><span class="c-t">Title</span>
    ${cols.includes('album') ? '<span class="c-a">Album</span>' : ''}${cols.includes('added') ? '<span class="c-d">Date added</span>' : ''}${cols.includes('plays') ? '<span class="c-p">Plays</span>' : ''}
    <span class="c-f"></span><span class="c-l">${MI.clock}</span><span class="c-m"></span></div>`;
  return head + songs.map((s, i) => songRow(s, start + i, { cols, numbers, keyPrefix })).join('');
}
export function songRow(s, i, { cols = ['album', 'added'], numbers = false } = {}) {
  const cur = current();
  const now = cur && cur.id === s.id;
  return `<div class="srow${now ? ' now' : ''}${music.playing && now ? ' playing' : ''}" data-i="${i}" data-id="${esc(s.id)}">
    <span class="c-n"><b>${numbers ? (s.track || i + 1) : i + 1}</b>${MI.eq}<button type="button" class="rowplay" aria-label="Play">${IC.play}</button></span>
    <span class="c-t">${cols.includes('cover') ? coverHtml(s.coverArt, '', 100, 'sm') : ''}<span class="tt"><span class="t1">${esc(s.title)}</span>${!cols.includes('noartist') ? `<a class="t2" href="${s.artistId ? href('artist', s.artistId) : '#/music/artists'}">${esc(s.artist || '')}</a>` : ''}</span></span>
    ${cols.includes('album') ? `<a class="c-a t2" href="${href('album', s.albumId)}">${esc(s.album || '')}</a>` : ''}
    ${cols.includes('added') ? `<span class="c-d t2">${dateStr(s.created)}</span>` : ''}
    ${cols.includes('plays') ? `<span class="c-p t2">${s.playCount ? plural(s.playCount, 'play') : ''}</span>` : ''}
    <span class="c-f"><button type="button" class="gb sfav${s.starred ? ' on' : ''}" title="${s.starred ? 'Remove from Favorites' : 'Add to Favorites'}">${s.starred ? IC.heartOn : IC.heart}</button></span>
    <span class="c-l t2">${fmt(s.duration)}</span>
    <span class="c-m"><button type="button" class="gb smore" title="More" aria-label="More">${IC.more}</button></span>
  </div>`;
}
// Clicks on rows: double-click or the row's play button plays from that song.
export function wireSongs(el, getSongs, from) {
  el.addEventListener('click', (e) => {
    const row = e.target.closest('.srow[data-i]'); if (!row || e.target.closest('a')) return;
    const songs = getSongs(); const i = +row.dataset.i; const s = songs[i]; if (!s) return;
    if (e.target.closest('.sfav')) { setFavorite(s, !s.starred); return; }
    if (e.target.closest('.smore')) { songMenu(s, e.target.closest('.smore')); return; }
    if (e.target.closest('.rowplay')) { if (current()?.id === s.id) togglePlay(); else playSongs(songs, i, { from, shuffle: false }); return; }
    el.querySelectorAll('.srow.sel').forEach((r) => r.classList.remove('sel'));
    row.classList.add('sel');
  });
  el.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.srow[data-i]'); if (!row || e.target.closest('button,a')) return;
    playSongs(getSongs(), +row.dataset.i, { from, shuffle: false });
  });
  el.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.srow[data-i]'); if (!row) return;
    e.preventDefault(); const s = getSongs()[+row.dataset.i]; if (s) songMenu(s, null, e.clientX, e.clientY);
  });
}
// Keep "now playing" rows and hearts up to date everywhere.
function syncRows() {
  const cur = current();
  document.querySelectorAll('.srow[data-id]').forEach((r) => {
    const now = !!cur && r.dataset.id === cur.id;
    r.classList.toggle('now', now); r.classList.toggle('playing', now && music.playing);
  });
  document.querySelectorAll('[data-playctx]').forEach((b) => b.classList.toggle('is-playing', music.playing && music.from && b.dataset.playctx === music.from.type + ':' + music.from.id));
}
onMusic(syncRows);
window.addEventListener('music:favorite', ({ detail: { id, on } }) => {
  document.querySelectorAll(`.srow[data-id="${CSS.escape(id)}"] .sfav`).forEach((b) => { b.classList.toggle('on', on); b.innerHTML = on ? IC.heartOn : IC.heart; b.title = on ? 'Remove from Favorites' : 'Add to Favorites'; });
});

// ---------- Menus ----------
const menuEl = document.createElement('div');
menuEl.className = 'ctx-menu mmenu'; menuEl.hidden = true;
document.body.appendChild(menuEl);
document.addEventListener('pointerdown', (e) => { if (!menuEl.hidden && !menuEl.contains(e.target)) menuEl.hidden = true; }, true);
window.addEventListener('hashchange', () => (menuEl.hidden = true));
function openMenu(items, anchor, x, y) {
  menuEl.innerHTML = items.map((it, i) => it === '-' ? '<div class="ctx-sep"></div>' : `<button type="button" class="ctx-item${it.cls ? ' ' + it.cls : ''}" data-i="${i}">${it.icon || ''}<span>${esc(it.label)}</span></button>`).join('');
  menuEl.hidden = false;
  const r = anchor ? anchor.getBoundingClientRect() : { left: x, right: x, bottom: y, top: y };
  const w = menuEl.offsetWidth, h = menuEl.offsetHeight;
  menuEl.style.left = Math.max(8, Math.min(innerWidth - w - 8, (anchor ? r.right - w : x))) + 'px';
  menuEl.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
  menuEl.classList.remove('pop'); void menuEl.offsetWidth; menuEl.classList.add('pop');
  menuEl.onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; menuEl.hidden = true; items[+b.dataset.i].run(); };
}
export function songMenu(s, anchor, x, y) {
  openMenu([
    { label: 'Play next', icon: MI.next, run: () => playNext([s]) },
    { label: 'Add to queue', icon: MI.addq, run: () => addToQueue([s]) },
    { label: 'Add to playlist…', icon: MI.list, run: () => addToPlaylist([s]) },
    '-',
    { label: s.starred ? 'Remove from Favorites' : 'Add to Favorites', icon: s.starred ? IC.heartOn : IC.heart, cls: s.starred ? 'on' : '', run: () => setFavorite(s, !s.starred) },
    { label: 'Go to album', icon: MI.album, run: () => (location.hash = href('album', s.albumId)) },
    { label: 'Go to artist', icon: MI.artist, run: () => (location.hash = href('artist', s.artistId)) },
  ], anchor, x, y);
}
export function listMenu(songs, anchor, extra = []) {
  openMenu([
    { label: 'Play next', icon: MI.next, run: () => playNext(songs) },
    { label: 'Add to queue', icon: MI.addq, run: () => addToQueue(songs) },
    { label: 'Add to playlist…', icon: MI.list, run: () => addToPlaylist(songs) },
    ...extra,
  ], anchor);
}
// Pick a playlist (or make a new one) and add songs to it.
export async function addToPlaylist(songs) {
  let lists = playlistsCache;
  try { lists = (await nd('getPlaylists')).playlists?.playlist || []; playlistsCache = lists; } catch {}
  const wrap = document.createElement('div');
  wrap.className = 'dlg-wrap';
  wrap.innerHTML = `<div class="dlg mdlg"><h2>Add to playlist</h2><p class="t2">${songs.length === 1 ? esc(songs[0].title) : plural(songs.length, 'song')}</p>
    <div class="mdlg-list"><button type="button" class="mdlg-it new" data-new="1">${MI.plus}<span>New playlist</span></button>
    ${lists.filter((p) => !p.readonly).map((p) => `<button type="button" class="mdlg-it" data-id="${esc(p.id)}">${coverHtml(p.coverArt, '', 100, 'sm')}<span><b>${esc(p.name)}</b><small>${plural(p.songCount, 'song')}</small></span></button>`).join('')}</div>
    <div class="dlg-btns"><button type="button" class="btn secondary" data-x="1">Cancel</button></div></div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', async (e) => {
    if (e.target === wrap || e.target.closest('[data-x]')) return close();
    const ids = songs.map((s) => s.id);
    if (e.target.closest('[data-new]')) {
      const name = prompt('Name your new playlist', 'New playlist'); if (!name) return;
      try { await nd('createPlaylist', `name=${encodeURIComponent(name)}&${ids.map((id) => 'songId=' + encodeURIComponent(id)).join('&')}`); toast(`Made "${name}".`); close(); refreshPlaylists(); } catch (err) { toast(String(err), true); }
      return;
    }
    const b = e.target.closest('[data-id]'); if (!b) return;
    try { await nd('updatePlaylist', `playlistId=${encodeURIComponent(b.dataset.id)}&${ids.map((id) => 'songIdToAdd=' + encodeURIComponent(id)).join('&')}`); toast(`Added to "${b.querySelector('b').textContent}".`); close(); refreshPlaylists(); } catch (err) { toast(String(err), true); }
  });
}
export function refreshPlaylists() { return nd('getPlaylists').then((r) => { playlistsCache = r.playlists?.playlist || []; drawLib(false); return playlistsCache; }).catch(() => playlistsCache); }

// ---------- Cards ----------
export function albumCard(a, sub) {
  return `<a class="mcard" href="${href('album', a.id)}" data-album="${esc(a.id)}">
    <div class="mcard-art">${coverHtml(a.coverArt, a.name, 300)}<button type="button" class="hoverplay" data-playalbum="${esc(a.id)}" aria-label="Play">${IC.play}</button></div>
    <div class="t1">${esc(a.name)}</div><div class="t2">${esc(sub ?? a.artist ?? '')}</div></a>`;
}
export function artistCard(a) {
  return `<a class="mcard art" href="${href('artist', a.id)}">
    <div class="mcard-art round">${coverHtml(a.coverArt, a.name, 300, 'round')}</div>
    <div class="t1">${esc(a.name)}</div><div class="t2">${a.albumCount != null ? plural(a.albumCount, 'album') : 'Artist'}</div></a>`;
}
export function row(title, inner, more) {
  return `<section class="msec"><div class="msec-h"><h2>${esc(title)}</h2>${more ? `<a class="seeall" href="${more}">See all</a>` : ''}</div><div class="mrow">${inner}</div></section>`;
}
// Cover hover = play (albums anywhere on the page).
export function wireCards(el) {
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-playalbum]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    b.classList.add('busy');
    try { const r = await nd('getAlbum', { id: b.dataset.playalbum }); playSongs(r.album.song || [], 0, { from: { type: 'album', id: r.album.id, name: r.album.name }, shuffle: false }); }
    catch (err) { toast(String(err), true); }
    b.classList.remove('busy');
  });
}

// ---------- Router ----------
export async function musicView(root, ctx) {
  const [path, qs] = (location.hash.slice(2) || '').split('?');
  const [, page = 'home', rawId = ''] = path.split('/');
  const id = decodeURIComponent(rawId);
  const params = new URLSearchParams(qs || '');
  if (!root.querySelector('.mshell')) { root.innerHTML = shellHtml(); wireShell(root); }
  markActive();
  const main = root.querySelector('#mmain');
  main.className = 'mmain page-' + page;
  main.innerHTML = loadingHtml();
  wirePanel(root);
  const v = { main, ctx, alive: ctx.alive, params };
  const fail = (e) => { if (ctx.alive()) { if (String(e) === 'ND_SESSION_EXPIRED') return ctx.fail(e); main.innerHTML = `<div class="empty">${esc(String(e))}<br><br><button class="btn secondary" onclick="location.reload()">Try again</button></div>`; } };
  try {
    switch (page) {
      case 'albums': return await albumsPage(v);
      case 'album': return await albumPage(v, id);
      case 'artists': return await artistsPage(v);
      case 'artist': return await artistPage(v, id);
      case 'songs': return await songsPage(v);
      default:
        if (EXTRA[page]) return await EXTRA[page](v, id);
        return await homePage(v);
    }
  } catch (e) { fail(e); }
}
// More screens register here (Genres, Playlists, Search).
export const EXTRA = {};
export const ready = () => window.dispatchEvent(new Event('scrappy:ready'));

// ---------- Home ----------
const MIXES = [
  { key: 'scrappy', name: 'Scrappy Mix', blurb: 'Songs you love and play most, plus a few you forgot about.' },
  { key: 'fresh', name: 'Fresh Finds', blurb: 'Straight from the albums you added most recently.' },
  { key: 'throwback', name: 'Throwback Mix', blurb: 'Older favorites from your library. Turn it up.' },
];
async function mixSongs(key) {
  if (key === 'scrappy') {
    const [st, fr, rnd] = await Promise.all([nd('getStarred2').catch(() => ({})), nd('getAlbumList2', { type: 'frequent', size: 12 }).catch(() => ({})), nd('getRandomSongs', { size: 30 })]);
    const fav = (st.starred2?.song || []).sort(() => Math.random() - 0.5).slice(0, 20);
    const albums = fr.albumList2?.album || [];
    const freq = [];
    for (const a of albums.slice(0, 6)) { try { const r = await nd('getAlbum', { id: a.id }); freq.push(...(r.album.song || []).sort(() => Math.random() - 0.5).slice(0, 3)); } catch {} }
    const all = [...fav, ...freq, ...(rnd.randomSongs?.song || []).slice(0, 10)];
    const seen = new Set(); return all.filter((s) => !seen.has(s.id) && seen.add(s.id)).sort(() => Math.random() - 0.5).slice(0, 40);
  }
  if (key === 'fresh') {
    const r = await nd('getAlbumList2', { type: 'newest', size: 8 });
    const out = [];
    for (const a of r.albumList2?.album || []) { try { const x = await nd('getAlbum', { id: a.id }); out.push(...(x.album.song || []).slice(0, 5)); } catch {} }
    return out.sort(() => Math.random() - 0.5);
  }
  const r = await nd('getRandomSongs', { size: 40, toYear: new Date().getFullYear() - 10 });
  return r.randomSongs?.song || [];
}
async function homePage(v) {
  const { main, alive } = v;
  main.innerHTML = `
    <div class="mhome-top">
      <div class="mix" id="mix"></div>
      <div class="jump"><h2>Jump back in</h2><div class="jump-grid" id="jump"></div></div>
    </div>
    <div id="hRecent"></div><div id="hHistory"></div><div id="hMood"></div>`;
  wireCards(main);
  // Mix card with arrows.
  let mi = 0;
  const drawMix = (dir = 0) => {
    const m = MIXES[mi];
    const el = main.querySelector('#mix');
    el.innerHTML = `<div class="mix-card${dir ? ' slide' + (dir > 0 ? 'R' : 'L') : ''}">
      <div class="mix-k">MIX ${mi + 1} OF ${MIXES.length}</div><div class="mix-n">${esc(m.name)}</div><p>${esc(m.blurb)}</p>
      <div class="mix-foot"><button type="button" class="btn mix-play" data-playctx="mix:${m.key}">${IC.play}<span>Play</span></button>
      <div class="dots">${MIXES.map((_, i) => `<i class="${i === mi ? 'on' : ''}"></i>`).join('')}</div>
      <button type="button" class="gb mix-prev" aria-label="Previous mix">${MI.back}</button><button type="button" class="gb mix-next" aria-label="Next mix" style="transform:scaleX(-1)">${MI.back}</button></div></div>`;
    el.querySelector('.mix-prev').onclick = () => { mi = (mi + MIXES.length - 1) % MIXES.length; drawMix(-1); };
    el.querySelector('.mix-next').onclick = () => { mi = (mi + 1) % MIXES.length; drawMix(1); };
    el.querySelector('.mix-play').onclick = async (e) => {
      const b = e.currentTarget; b.classList.add('busy');
      try { const songs = await mixSongs(m.key); if (!songs.length) toast('Not enough music for this mix yet.'); else playSongs(songs, 0, { from: { type: 'mix', id: m.key, name: m.name }, shuffle: false }); }
      catch (err) { toast(String(err), true); }
      b.classList.remove('busy');
    };
  };
  drawMix();
  // Jump back in: the first six from Your Library.
  const drawJump = () => {
    const items = libEntries().slice(0, 6);
    main.querySelector('#jump').innerHTML = items.length ? items.map((e) => `<a class="quick" href="${href(kindOf(e.k), e.k.slice(3))}">${coverHtml(e.cv, '', 120, kindOf(e.k) === 'artist' ? 'round' : '')}<div><div class="t1">${esc(e.t)}</div><div class="t2">${esc(e.sub)}</div></div></a>`).join('')
      : '<div class="t2">Albums, artists and playlists you open show up here.</div>';
  };
  drawJump();
  refreshPlaylists().then(() => alive() && drawJump());
  await Promise.all([
    ndLoad('getAlbumList2', { type: 'newest', size: 20 }, (r) => { main.querySelector('#hRecent').innerHTML = row('Recently added', (r.albumList2?.album || []).map((a) => albumCard(a)).join(''), '#/music/albums?sort=newest'); ready(); }, alive),
    ndLoad('getAlbumList2', { type: 'recent', size: 20 }, (r) => { const a = r.albumList2?.album || []; main.querySelector('#hHistory').innerHTML = a.length ? row('Listening history', a.map((x) => albumCard(x, x.artist)).join('')) : ''; }, alive),
    ndLoad('getGenres', {}, (r) => {
      const gs = (r.genres?.genre || []).filter((g) => g.songCount).sort((a, b) => b.songCount - a.songCount).slice(0, 8);
      main.querySelector('#hMood').innerHTML = gs.length ? `<section class="msec"><div class="msec-h"><h2>What are you in the mood for?</h2><a class="seeall" href="#/music/genres">All genres</a></div><div class="moods">${gs.map(moodTile).join('')}</div></section>` : '';
    }, alive),
  ]).catch((e) => { if (alive()) toast(String(e), true); });
  wireMoods(main);
}
export function moodTile(g) {
  const h = hue(g.value);
  return `<a class="mood" href="#/music/genre/${encodeURIComponent(g.value)}" style="--h:${h}"><div class="shine"></div>
    <div class="txt"><div class="nm">${esc(g.value)}</div><div class="ct">${plural(g.songCount, 'song')}</div></div>
    <button type="button" class="hp" data-playgenre="${esc(g.value)}" aria-label="Play ${esc(g.value)}">${IC.play}</button></a>`;
}
export function wireMoods(el) {
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-playgenre]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    try { const r = await nd('getSongsByGenre', { genre: b.dataset.playgenre, count: 300 }); playSongs(r.songsByGenre?.song || [], 0, { shuffle: true, from: { type: 'genre', id: b.dataset.playgenre, name: b.dataset.playgenre } }); }
    catch (err) { toast(String(err), true); }
  });
}

// ---------- Albums (grouped by artist, each with its songs) ----------
async function allAlbums(type = 'alphabeticalByArtist') {
  const out = [];
  for (let off = 0; off < 20000; off += 500) {
    const r = await nd('getAlbumList2', { type, size: 500, offset: off });
    const a = r.albumList2?.album || []; out.push(...a);
    if (a.length < 500) break;
  }
  return out;
}
async function albumsPage(v) {
  const { main, alive, params } = v;
  const sort = params.get('sort') || 'artist';
  const albums = await allAlbums(sort === 'newest' ? 'newest' : 'alphabeticalByArtist');
  if (!alive()) return;
  const artists = new Map();
  for (const a of albums) { const k = sort === 'newest' ? '_' : (a.artistId || a.artist); if (!artists.has(k)) artists.set(k, { id: a.artistId, name: a.artist, albums: [] }); artists.get(k).albums.push(a); }
  main.innerHTML = `
    <div class="mpage-h"><h1 class="disp">Albums</h1><span class="t2 cnt">${plural(albums.length, 'album')} · ${plural(new Set(albums.map((a) => a.artistId)).size, 'artist')}</span>
      <label class="msearch">${MI.search}<input type="search" id="aFind" placeholder="Search albums, artists, songs" spellcheck="false"></label>
      <div class="seg"><a href="#/music/albums" class="${sort === 'artist' ? 'on' : ''}">By artist</a><a href="#/music/albums?sort=newest" class="${sort === 'newest' ? 'on' : ''}">Newest</a></div>
      <a class="btn secondary" href="#/music/artists">${MI.artist}<span>Artists</span></a></div>
    <div id="aList"></div>`;
  const list = main.querySelector('#aList');
  const groups = [...artists.values()];
  const block = (a) => `<div class="ab" data-album="${esc(a.id)}">
      <a class="ab-cover" href="${href('album', a.id)}">${coverHtml(a.coverArt, a.name, 400)}<button type="button" class="hoverplay" data-playalbum="${esc(a.id)}" aria-label="Play">${IC.play}</button></a>
      <div class="ab-body"><a class="ab-t disp" href="${href('album', a.id)}">${esc(a.name)}</a>
        <div class="t2">${[sort === 'newest' ? a.artist : '', a.year, a.genre, plural(a.songCount, 'song'), totalTime(a.duration || 0)].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="ab-btns"><button type="button" class="btn" data-abplay="${esc(a.id)}" data-playctx="album:${esc(a.id)}">${IC.play}<span>Play</span></button><button type="button" class="btn secondary" data-abshuf="${esc(a.id)}">${IC.shuffle}<span>Shuffle</span></button><button type="button" class="gb sq" data-abmore="${esc(a.id)}" aria-label="More">${IC.more}</button></div>
        <div class="ab-songs" data-songs="${esc(a.id)}"><div class="t2 ab-wait">…</div></div></div></div>`;
  const draw = (filter = '') => {
    const f = filter.trim().toLowerCase();
    const gs = groups.map((g) => ({ ...g, albums: f ? g.albums.filter((a) => (a.name + ' ' + a.artist).toLowerCase().includes(f)) : g.albums })).filter((g) => g.albums.length);
    list.innerHTML = gs.map((g) => sort === 'newest' ? g.albums.map(block).join('') : `<section class="ag">
      <div class="ag-h"><a class="ag-a" href="${g.id ? href('artist', g.id) : '#'}">${coverHtml(g.albums[0].coverArt && 'ar-' + g.id, g.name, 120, 'round')}<div><div class="disp">${esc(g.name)}</div><div class="t2">${plural(g.albums.length, 'album')} · ${plural(g.albums.reduce((n, a) => n + (a.songCount || 0), 0), 'song')}</div></div></a>
      ${g.id ? `<button type="button" class="btn secondary sm" data-shufartist="${esc(g.id)}">${IC.shuffle}<span>Shuffle artist</span></button>` : ''}</div>
      ${g.albums.map(block).join('')}</section>`).join('') || '<div class="empty">No albums match.</div>';
    observe();
  };
  // Load each album's songs as it scrolls into view.
  const songsOf = new Map();
  const io = new IntersectionObserver((ents) => ents.forEach(async (en) => {
    if (!en.isIntersecting) return; io.unobserve(en.target);
    const id = en.target.dataset.songs;
    try {
      const songs = songsOf.get(id) || (await nd('getAlbum', { id })).album.song || [];
      songsOf.set(id, songs);
      if (!en.target.isConnected) return;
      const half = Math.ceil(songs.length / 2);
      const col = (arr, off) => `<div class="ab-col">${arr.map((s, i) => `<div class="srow mini${current()?.id === s.id ? ' now' : ''}" data-i="${off + i}" data-id="${esc(s.id)}"><span class="c-f">${s.starred ? `<span class="minifav">${IC.heartOn}</span>` : ''}</span><span class="c-n"><b>${s.track || off + i + 1}</b>${MI.eq}<button type="button" class="rowplay" aria-label="Play">${IC.play}</button></span><span class="c-t t1">${esc(s.title)}</span><span class="c-l t2">${fmt(s.duration)}</span><span class="c-m"><button type="button" class="gb smore" aria-label="More">${IC.more}</button></span></div>`).join('')}</div>`;
      en.target.innerHTML = col(songs.slice(0, half), 0) + col(songs.slice(half), half);
      const al = albums.find((x) => x.id === id);
      if (!en.target.dataset.wired) { en.target.dataset.wired = 1; wireSongs(en.target, () => songsOf.get(id), { type: 'album', id, name: al?.name }); }
      syncRows();
    } catch { en.target.innerHTML = ''; }
  }), { rootMargin: '600px' });
  const observe = () => list.querySelectorAll('[data-songs]').forEach((el) => io.observe(el));
  v.ctx.onLeave(() => io.disconnect());
  const getAlbumSongs = async (id) => songsOf.get(id) || (songsOf.set(id, (await nd('getAlbum', { id })).album.song || []), songsOf.get(id));
  list.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-abplay],[data-abshuf],[data-abmore],[data-shufartist]'); if (!t) return;
    e.preventDefault();
    try {
      if (t.dataset.shufartist) {
        const g = groups.find((x) => x.id === t.dataset.shufartist);
        const all = (await Promise.all(g.albums.map((a) => getAlbumSongs(a.id)))).flat();
        return playSongs(all, 0, { shuffle: true, from: { type: 'artist', id: g.id, name: g.name } });
      }
      const id = t.dataset.abplay || t.dataset.abshuf || t.dataset.abmore;
      const al = albums.find((x) => x.id === id); const songs = await getAlbumSongs(id);
      const from = { type: 'album', id, name: al?.name };
      if (t.dataset.abplay) playSongs(songs, 0, { from, shuffle: false });
      else if (t.dataset.abshuf) playSongs(songs, 0, { from, shuffle: true });
      else listMenu(songs, t, [{ label: 'Go to album', icon: MI.album, run: () => (location.hash = href('album', id)) }, { label: 'Go to artist', icon: MI.artist, run: () => (location.hash = href('artist', al.artistId)) }]);
    } catch (err) { toast(String(err), true); }
  });
  wireCards(list);
  let ft; main.querySelector('#aFind').addEventListener('input', (e) => { clearTimeout(ft); ft = setTimeout(() => draw(e.target.value), 150); });
  draw(); ready();
}

// ---------- One album ----------
async function albumPage(v, id) {
  const { main, alive, params } = v;
  const hl = params.get('song');
  let album = null;
  await ndLoad('getAlbum', { id }, (r) => {
    album = r.album; const songs = album.song || [];
    const multiDisc = new Set(songs.map((s) => s.discNumber || 1)).size > 1;
    bump({ k: 'al:' + album.id, t: album.name, sub: `Album · ${album.artist || ''}`, cv: album.coverArt });
    main.innerHTML = `
      <div class="mhero" style="--h:${hue(album.name)}"><div class="mhero-bg">${album.coverArt ? `<img src="${cover(album.coverArt, 600)}" alt="" onload="this.classList.add('in')" onerror="this.remove()">` : ''}</div>
        <div class="crumbs"><button type="button" class="gb sq" onclick="history.back()" aria-label="Back">${MI.back}</button><a href="#/music/albums">Albums</a><span>›</span><b>${esc(album.name)}</b></div>
        <div class="mhero-in">${coverHtml(album.coverArt, album.name, 600, 'big')}
          <div><div class="kicker">ALBUM</div><h1 class="disp mtitle">${esc(album.name)}</h1>
            <div class="meta">${album.artistId ? `<a href="${href('artist', album.artistId)}">${esc(album.artist)}</a>` : esc(album.artist || '')}${[album.year, album.genre, plural(songs.length, 'song') + ', ' + totalTime(album.duration || 0)].filter(Boolean).map((x) => ' · ' + esc(x)).join('')}</div>
            <div class="mbtns"><button type="button" class="btn" id="alPlay" data-playctx="album:${esc(album.id)}">${IC.play}<span>Play</span></button><button type="button" class="btn secondary" id="alShuf">${IC.shuffle}<span>Shuffle</span></button>
            <button type="button" class="gb sq${album.starred ? ' on' : ''}" id="alFav" title="${album.starred ? 'Remove from Favorites' : 'Add to Favorites'}">${album.starred ? IC.heartOn : IC.heart}</button><button type="button" class="gb sq" id="alMore" aria-label="More">${IC.more}</button></div></div></div></div>
      <div class="stable album" id="alSongs">${multiDisc ? discTables(songs) : songTable(songs, { cols: ['plays', 'noartist'], numbers: true })}</div>
      <div class="t2 relnote">${album.year ? 'Released ' + album.year : ''}${album.recordLabels?.[0]?.name ? ' · ' + esc(album.recordLabels[0].name) : ''}</div>
      <div id="alMore1"></div><div id="alMore2"></div>`;
    const from = { type: 'album', id: album.id, name: album.name };
    wireSongs(main.querySelector('#alSongs'), () => songs, from);
    main.querySelector('#alPlay').onclick = () => playSongs(songs, 0, { from, shuffle: false });
    main.querySelector('#alShuf').onclick = () => playSongs(songs, 0, { from, shuffle: true });
    main.querySelector('#alMore').onclick = (e) => listMenu(songs, e.currentTarget, album.artistId ? [{ label: 'Go to artist', icon: MI.artist, run: () => (location.hash = href('artist', album.artistId)) }] : []);
    main.querySelector('#alFav').onclick = async (e) => {
      const b = e.currentTarget; const on = !album.starred;
      try { await nd(on ? 'star' : 'unstar', { albumId: album.id }); album.starred = on ? 'y' : undefined; b.classList.toggle('on', on); b.innerHTML = on ? IC.heartOn : IC.heart; b.title = on ? 'Remove from Favorites' : 'Add to Favorites'; toast(on ? 'Album added to Favorites.' : 'Album removed from Favorites.'); }
      catch (err) { toast(String(err), true); }
    };
    if (hl) { const r2 = main.querySelector(`.srow[data-id="${CSS.escape(hl)}"]`); if (r2) { r2.classList.add('hl'); setTimeout(() => r2.scrollIntoView({ block: 'center', behavior: 'smooth' }), 200); } }
    syncRows(); ready();
  }, alive);
  if (!album || !alive()) return;
  wireCards(main);
  // More by this artist, and more like this (same genre).
  if (album.artistId) nd('getArtist', { id: album.artistId }).then((r) => {
    const others = (r.artist?.album || []).filter((a) => a.id !== album.id);
    if (alive() && others.length) main.querySelector('#alMore1').innerHTML = row(`More by ${album.artist}`, others.map((a) => albumCard(a, a.year || '')).join(''), href('artist', album.artistId));
  }).catch(() => {});
  if (album.genre) nd('getAlbumList2', { type: 'byGenre', genre: album.genre, size: 24 }).then((r) => {
    const like = (r.albumList2?.album || []).filter((a) => a.id !== album.id && a.artistId !== album.artistId).sort(() => Math.random() - 0.5).slice(0, 12);
    if (alive() && like.length) main.querySelector('#alMore2').innerHTML = row('More like this', like.map((a) => albumCard(a)).join(''));
  }).catch(() => {});
}
function discTables(songs) {
  const discs = [...new Set(songs.map((s) => s.discNumber || 1))];
  let n = 0;
  return discs.map((d) => { const ss = songs.filter((s) => (s.discNumber || 1) === d); const start = n; n += ss.length; return `<div class="disc">Disc ${d}</div>` + songTable(ss, { cols: ['plays', 'noartist'], numbers: true, start }); }).join('');
}

// ---------- Artists ----------
async function artistsPage(v) {
  const { main, alive } = v;
  await ndLoad('getArtists', {}, (r) => {
    const groups = r.artists?.index || [];
    const total = groups.reduce((n, g) => n + (g.artist?.length || 0), 0);
    main.innerHTML = `<div class="mpage-h"><h1 class="disp">Artists</h1><span class="t2 cnt">${plural(total, 'artist')}</span>
      <label class="msearch">${MI.search}<input type="search" id="arFind" placeholder="Search artists" spellcheck="false"></label>
      <a class="btn secondary" href="#/music/albums">${MI.album}<span>Albums</span></a></div><div id="arList"></div>`;
    const draw = (f = '') => {
      f = f.trim().toLowerCase();
      main.querySelector('#arList').innerHTML = groups.map((g) => { const as = (g.artist || []).filter((a) => !f || a.name.toLowerCase().includes(f)); return as.length ? `<section class="msec"><div class="letter">${esc(g.name)}</div><div class="mgrid">${as.map(artistCard).join('')}</div></section>` : ''; }).join('') || '<div class="empty">No artists match.</div>';
    };
    draw();
    main.querySelector('#arFind').addEventListener('input', (e) => draw(e.target.value));
    ready();
  }, alive);
}

// ---------- One artist ----------
async function artistPage(v, id) {
  const { main, alive } = v;
  const r = await nd('getArtist', { id });
  if (!alive()) return;
  const ar = r.artist; const albums = (ar.album || []).sort((a, b) => (b.year || 0) - (a.year || 0));
  const songCount = albums.reduce((n, a) => n + (a.songCount || 0), 0);
  const plays = albums.reduce((n, a) => n + (a.playCount || 0), 0);
  bump({ k: 'ar:' + ar.id, t: ar.name, sub: 'Artist', cv: ar.coverArt });
  main.innerHTML = `
    <div class="arhero" style="--h:${hue(ar.name)}"><div class="arhero-bg" id="arBg">${ar.coverArt ? `<img src="${cover(ar.coverArt, 1200)}" alt="" onload="this.classList.add('in')" onerror="this.remove()">` : ''}</div>
      <a class="back-pill" href="#/music/artists">${MI.back}<span>All artists</span></a>
      <div class="arhero-in"><div class="inlib"><span>${MI.check}</span>In your library</div><h1 class="disp arname">${esc(ar.name)}</h1>
      <div class="meta">${plays ? plural(plays, 'play') + ' · ' : ''}${plural(albums.length, 'album')} · ${plural(songCount, 'song')}</div></div></div>
    <div class="arbar"><button type="button" class="arplay" id="arPlay" aria-label="Play ${esc(ar.name)}" data-playctx="artist:${esc(ar.id)}">${IC.play}</button>
      <button type="button" class="gb lg" id="arShuf" title="Shuffle" aria-label="Shuffle">${IC.shuffle}</button>
      <button type="button" class="btn secondary sm${ar.starred ? ' on' : ''}" id="arFav">${ar.starred ? IC.heartOn : IC.heart}<span>${ar.starred ? 'In Favorites' : 'Favorite'}</span></button>
      <button type="button" class="gb lg" id="arMore" aria-label="More">${IC.more}</button>
      <a class="favcard" id="arFavSongs" hidden></a></div>
    <section class="msec"><h2>Popular</h2><div class="stable" id="arTop"><div class="t2">…</div></div><button type="button" class="link showmore" id="arTopMore" hidden>Show more</button></section>
    ${row('Albums', albums.map((a) => albumCard(a, [a.year, plural(a.songCount, 'song')].filter(Boolean).join(' · '))).join(''))}
    <div id="arBio"></div><div id="arSimilar"></div>`;
  wireCards(main);
  const from = { type: 'artist', id: ar.id, name: ar.name };
  let allSongs = null;
  const getAll = async () => allSongs || (allSongs = (await Promise.all(albums.map((a) => nd('getAlbum', { id: a.id }).then((x) => x.album.song || []).catch(() => [])))).flat());
  let top = [];
  main.querySelector('#arPlay').onclick = async (e) => {
    const b = e.currentTarget; b.classList.remove('tap'); void b.offsetWidth; b.classList.add('tap');
    const list = top.length ? top : await getAll(); playSongs(list, 0, { from, shuffle: false });
  };
  main.querySelector('#arShuf').onclick = async () => playSongs(await getAll(), 0, { from, shuffle: true });
  main.querySelector('#arMore').onclick = async (e) => { const t = e.currentTarget; listMenu(await getAll(), t); };
  main.querySelector('#arFav').onclick = async (e) => {
    const b = e.currentTarget; const on = !ar.starred;
    try { await nd(on ? 'star' : 'unstar', { artistId: ar.id }); ar.starred = on ? 'y' : undefined; b.classList.toggle('on', on); b.innerHTML = `${on ? IC.heartOn : IC.heart}<span>${on ? 'In Favorites' : 'Favorite'}</span>`; toast(on ? 'Artist added to Favorites.' : 'Artist removed from Favorites.'); }
    catch (err) { toast(String(err), true); }
  };
  ready();
  // Popular songs.
  nd('getTopSongs', { artist: ar.name, count: 20 }).then(async (t) => {
    top = (t.topSongs?.song || []).filter((s) => s.artistId === ar.id || s.artist === ar.name);
    if (!top.length) { const all = await getAll(); top = all.slice().sort((a, b) => (b.playCount || 0) - (a.playCount || 0)).slice(0, 10); }
    if (!alive()) return;
    const box = main.querySelector('#arTop'); let shown = 5;
    const drawTop = () => { box.innerHTML = songTable(top.slice(0, shown), { cols: ['cover', 'plays', 'noartist'] }).replace(/<div class="srow shead">[\s\S]*?<\/div>/, ''); const m = main.querySelector('#arTopMore'); m.hidden = top.length <= 5; m.textContent = shown > 5 ? 'Show less' : 'Show more'; syncRows(); };
    main.querySelector('#arTopMore').onclick = () => { shown = shown > 5 ? 5 : 10; drawTop(); };
    wireSongs(box, () => top, from); drawTop();
  }).catch(() => { main.querySelector('#arTop').innerHTML = ''; });
  // Favorite songs by this artist.
  nd('getStarred2').then((st) => {
    const favs = (st.starred2?.song || []).filter((s) => s.artistId === ar.id);
    const c = main.querySelector('#arFavSongs'); if (!favs.length || !alive()) return;
    c.hidden = false;
    c.innerHTML = `${coverHtml(ar.coverArt, '', 100, 'round')}<span class="favdot">${IC.heartOn}</span><div><div class="t1">Favorite songs</div><div class="t2">${plural(favs.length, 'favorite song')}</div></div>`;
    c.onclick = (e) => { e.preventDefault(); playSongs(favs, 0, { from: { type: 'artistfav', id: ar.id, name: `${ar.name}: Favorite songs` }, shuffle: false }); };
  }).catch(() => {});
  // Bio + similar artists in your library.
  nd('getArtistInfo2', { id: ar.id, count: 12 }).then((info) => {
    const i = info.artistInfo2 || {}; if (!alive()) return;
    const bio = (i.biography || '').replace(/<a [^>]*>.*?<\/a>\.?/g, '').trim();
    if (bio) main.querySelector('#arBio').innerHTML = `<section class="msec"><h2>About</h2><p class="bio">${esc(bio)}</p></section>`;
    const sim = (i.similarArtist || []).filter((s) => s.id);
    if (sim.length) main.querySelector('#arSimilar').innerHTML = row('Fans also like', sim.map(artistCard).join(''));
  }).catch(() => {});
}

// ---------- Songs ----------
async function allSongs() {
  const out = [];
  for (let off = 0; off < 100000; off += 500) {
    const r = await nd('search3', { query: '', songCount: 500, songOffset: off, albumCount: 0, artistCount: 0 });
    const s = r.searchResult3?.song || []; out.push(...s);
    if (s.length < 500) break;
  }
  return out;
}
async function songsPage(v) {
  const { main, alive } = v;
  main.innerHTML = loadingHtml('Loading your songs…');
  const songs = await allSongs();
  if (!alive()) return;
  let sort = localStorage.getItem('msongsort') || 'title', dir = localStorage.getItem('msongdir') === 'desc' ? -1 : 1, filter = '';
  let view = songs;
  const total = songs.reduce((n, s) => n + (s.duration || 0), 0);
  main.innerHTML = `
    <div class="mpage-h songs-h"><button type="button" class="arplay sm" id="sgPlay" aria-label="Play all" data-playctx="songs:all">${IC.play}</button><button type="button" class="gb sq" id="sgShuf" title="Shuffle" aria-label="Shuffle">${IC.shuffle}</button>
      <div><h1 class="disp">Songs</h1><div class="t2 cnt">${plural(songs.length, 'song')} · ${totalTime(total)}</div></div>
      <label class="msearch">${MI.search}<input type="search" id="sgFind" placeholder="Search songs" spellcheck="false"></label></div>
    <div class="stable songs" id="sgTable"></div><nav class="rail" id="sgRail" hidden></nav>`;
  const table = main.querySelector('#sgTable'); const rail = main.querySelector('#sgRail');
  const from = { type: 'songs', id: 'all', name: 'Songs' };
  const keyOf = { title: (s) => (s.title || '').toLowerCase(), album: (s) => (s.album || '').toLowerCase(), added: (s) => s.created || '', time: (s) => s.duration || 0 };
  const letter = (s) => { const c = (s.title || '').trim()[0]?.toUpperCase() || '#'; return /[A-Z]/.test(c) ? c : '#'; };
  const draw = () => {
    const f = filter.trim().toLowerCase();
    view = (f ? songs.filter((s) => `${s.title} ${s.artist} ${s.album}`.toLowerCase().includes(f)) : songs.slice())
      .sort((a, b) => { const x = keyOf[sort](a), y = keyOf[sort](b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
    const arrow = (k) => (sort === k ? `<i class="sarrow${dir < 0 ? ' down' : ''}">▴</i>` : '');
    const head = `<div class="srow shead sticky"><span class="c-n"></span><button type="button" class="c-t" data-sort="title">Title${arrow('title')}</button><button type="button" class="c-a" data-sort="album">Album${arrow('album')}</button><button type="button" class="c-d" data-sort="added">Date added${arrow('added')}</button><span class="c-f"></span><button type="button" class="c-l" data-sort="time">${MI.clock}${arrow('time')}</button><span class="c-m"></span></div>`;
    const byLetter = sort === 'title' && !f;
    let html = head, last = null;
    view.forEach((s, i) => {
      if (byLetter) { const L = letter(s); if (L !== last) { html += `<div class="lsec" id="L-${L === '#' ? 'num' : L}">${L}</div>`; last = L; } }
      html += songRow(s, i, { cols: ['cover', 'album', 'added'] });
    });
    table.innerHTML = html + (view.length ? '' : '<div class="empty">No songs match.</div>');
    rail.hidden = !byLetter;
    if (byLetter) { const have = new Set(view.map(letter)); rail.innerHTML = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((L) => `<button type="button" class="${have.has(L) ? '' : 'off'}" data-L="${L}">${L}</button>`).join(''); }
    syncRows();
  };
  table.addEventListener('click', (e) => {
    const h = e.target.closest('[data-sort]'); if (!h) return;
    const k = h.dataset.sort; if (sort === k) dir = -dir; else { sort = k; dir = k === 'added' ? -1 : 1; }
    localStorage.setItem('msongsort', sort); localStorage.setItem('msongdir', dir < 0 ? 'desc' : 'asc'); draw();
  });
  rail.addEventListener('click', (e) => { const b = e.target.closest('[data-L]'); if (!b || b.classList.contains('off')) return; const el = main.querySelector('#L-' + (b.dataset.L === '#' ? 'num' : b.dataset.L)); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 130, behavior: 'smooth' }); });
  wireSongs(table, () => view, from);
  main.querySelector('#sgPlay').onclick = () => playSongs(view, 0, { from, shuffle: false });
  main.querySelector('#sgShuf').onclick = () => playSongs(view, 0, { from, shuffle: true });
  let ft; main.querySelector('#sgFind').addEventListener('input', (e) => { clearTimeout(ft); ft = setTimeout(() => { filter = e.target.value; draw(); }, 150); });
  draw(); ready();
}

// ---------- Up next panel (right side) ----------
let panelOpen = false;
function wirePanel(root) {
  const p = root.querySelector('#mpanel'); if (!p || p.dataset.wired) { drawPanel(); return; }
  p.dataset.wired = 1;
  p.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return togglePanel(false);
    if (e.target.closest('[data-clear]')) return clearUpNext();
    const rm = e.target.closest('[data-rm]'); if (rm) return removeAt(+rm.dataset.rm);
    const it = e.target.closest('[data-qi]'); if (it && !e.target.closest('.qgrip')) playAt(+it.dataset.qi);
  });
  // Drag to reorder.
  let dragFrom = null;
  p.addEventListener('dragstart', (e) => { const it = e.target.closest('[data-qi]'); if (!it) return; dragFrom = +it.dataset.qi; it.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
  p.addEventListener('dragend', () => { dragFrom = null; p.querySelectorAll('.dragging,.over').forEach((x) => x.classList.remove('dragging', 'over')); });
  p.addEventListener('dragover', (e) => { const it = e.target.closest('[data-qi]'); if (dragFrom == null || !it) return; e.preventDefault(); p.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); it.classList.add('over'); });
  p.addEventListener('drop', (e) => { const it = e.target.closest('[data-qi]'); if (dragFrom == null || !it) return; e.preventDefault(); moveInQueue(dragFrom, +it.dataset.qi); });
  drawPanel();
}
function togglePanel(on = !panelOpen) {
  panelOpen = on;
  document.querySelector('.mshell')?.classList.toggle('panel-open', on);
  const p = document.getElementById('mpanel'); if (p) p.hidden = !on;
  document.getElementById('mbQueue')?.classList.toggle('on', on);
  drawPanel();
}
window.addEventListener('music:panel', () => {
  if (!location.hash.startsWith('#/music')) { panelOpen = true; location.hash = '#/music/home'; return; }
  togglePanel();
});
function drawPanel() {
  const p = document.getElementById('mpanel'); if (!p) return;
  p.hidden = !panelOpen; document.querySelector('.mshell')?.classList.toggle('panel-open', panelOpen);
  document.getElementById('mbQueue')?.classList.toggle('on', panelOpen);
  if (!panelOpen) return;
  const cur = current();
  const up = music.queue.slice(music.idx + 1, music.idx + 101);
  p.innerHTML = `<div class="mp-h"><h3>Up next</h3><button type="button" class="gb" data-close="1" aria-label="Close">${MI.close}</button></div>
    ${cur ? `<div class="mp-now">${coverHtml(cur.coverArt, '', 120)}<div><div class="kicker">NOW PLAYING</div><div class="t1">${esc(cur.title)}</div><div class="t2">${esc(cur.artist || '')} · ${esc(cur.album || '')}</div></div>${music.playing ? MI.eq : ''}</div>` : '<div class="t2 mp-empty">Nothing playing yet. Pick a song and it shows up here.</div>'}
    ${up.length ? `<div class="mp-sub"><span>NEXT${music.from?.name ? ' FROM ' + esc(music.from.name.toUpperCase()) : ''}</span><button type="button" class="link" data-clear="1">Clear</button></div>
    <div class="mp-list">${up.map((s, k) => { const i = music.idx + 1 + k; return `<div class="qi" draggable="true" data-qi="${i}"><span class="qgrip">${MI.grip}</span>${coverHtml(s.coverArt, '', 100, 'sm')}<div class="qt"><div class="t1">${esc(s.title)}</div><div class="t2">${esc(s.artist || '')}</div></div><span class="t2 qd">${fmt(s.duration)}</span><button type="button" class="gb qrm" data-rm="${i}" aria-label="Remove">${MI.close}</button></div>`; }).join('')}</div>` : cur ? '<div class="t2 mp-empty">That\'s the end of the queue.</div>' : ''}`;
}
onMusic(() => panelOpen && drawPanel());
