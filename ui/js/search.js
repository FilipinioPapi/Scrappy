// One search bar for the whole app, beside the tabs. Ctrl+F focuses it.
// Searches every signed-in server (Emby, Navidrome, Audiobookshelf), the current
// tab's results first. Forgives typos, and understands typed filters:
// in:music  type:song  genre:rock  year:2010-2019  fav:yes  is:unplayed
import { api, img } from './api.js';
import { esc, toast, loadingHtml } from './components.js';
import { playSongs, cover, fmt, IC } from './mplayer.js';
import { nd, coverHtml, href, plural, lib, kindOf } from './music.js';
import { absCover } from './bplayer.js';

const line = (d, n = 18) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const SI = {
  search: line('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>', 18),
  sliders: line('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>', 18),
  clock: line('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 14),
  x: line('<path d="M6 6l12 12M18 6 6 18"/>', 12),
};
let session = null;
export function setSearchSession(s) { session = s; }
const signed = (k) => !!session?.servers?.[k]?.signedIn;
const tabNow = () => { const n = (location.hash.split('/')[1] || 'home').split('?')[0]; return n === 'music' ? 'music' : n === 'audiobooks' ? 'audiobooks' : 'video'; };

// ---------- Query parsing ----------
const TYPES = { song: 'song', songs: 'song', album: 'album', albums: 'album', artist: 'artist', artists: 'artist', playlist: 'playlist', movie: 'movie', movies: 'movie', show: 'show', shows: 'show', series: 'show', tv: 'show', episode: 'episode', book: 'book', books: 'book', audiobook: 'book' };
const INS = { music: 'music', movies: 'video', movie: 'video', tv: 'video', video: 'video', emby: 'video', audiobooks: 'audiobooks', books: 'audiobooks', abs: 'audiobooks' };
export function parseQuery(raw) {
  const f = { text: '', in: null, type: null, genre: null, y1: null, y2: null, fav: false, unplayed: false };
  const words = [];
  for (const w of raw.match(/(\w+:"[^"]*"|\S+)/g) || []) {
    const m = w.match(/^(in|type|genre|year|fav|is):(.+)$/i);
    if (!m) { words.push(w); continue; }
    const k = m[1].toLowerCase(); const v = m[2].replace(/^"|"$/g, '').toLowerCase();
    if (k === 'in') f.in = INS[v] || null;
    else if (k === 'type') f.type = TYPES[v] || null;
    else if (k === 'genre') f.genre = v;
    else if (k === 'year') { const [a, b] = v.split(/[-–]/).map(Number); f.y1 = a || null; f.y2 = b || a || null; }
    else if (k === 'fav') f.fav = /^(yes|y|true|1)$/.test(v);
    else if (k === 'is' && v === 'unplayed') f.unplayed = true;
  }
  f.text = words.join(' ').trim();
  return f;
}
const hasFilter = (f) => f.in || f.type || f.genre || f.y1 || f.fav || f.unplayed;

// Typo-forgiving score: 1 = exact, ~0 = unrelated.
function score(q, s) {
  q = q.toLowerCase(); s = (s || '').toLowerCase();
  if (!q) return 0.5;
  if (s === q) return 1; if (s.startsWith(q)) return 0.95; if (s.includes(q)) return 0.85;
  const qw = q.split(/\s+/); let tot = 0;
  for (const w of qw) {
    let best = 0;
    for (const t of s.split(/[\s\-/,.()]+/)) { if (!t) continue; if (t.startsWith(w)) { best = 1; break; } const d = lev(w, t.slice(0, w.length + 1)); best = Math.max(best, 1 - d / Math.max(w.length, 3)); }
    tot += best;
  }
  return (tot / qw.length) * 0.8;
}
function lev(a, b) { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; let p = Array.from({ length: n + 1 }, (_, i) => i); for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[n]; }

// ---------- Searching each server ----------
let plCache = null;
async function searchMusic(f, big) {
  if (!signed('navidrome')) return null;
  const want = (t) => !f.type || f.type === t;
  const n = big ? 60 : 8;
  const run = (query) => nd('search3', { query, songCount: want('song') ? n * 2 : 0, albumCount: want('album') ? n : 0, artistCount: want('artist') ? n : 0 }).then((r) => r.searchResult3 || {});
  let r = await run(f.text);
  const count = (x) => (x.song?.length || 0) + (x.album?.length || 0) + (x.artist?.length || 0);
  // Few hits? Try shorter pieces of each word so typos still find things.
  if (f.text && count(r) < 3) {
    const parts = [...new Set(f.text.split(/\s+/).filter((w) => w.length >= 3).map((w) => w.slice(0, Math.max(3, Math.ceil(w.length * 0.6)))))];
    const extra = await Promise.all(parts.map((p) => run(p).catch(() => ({}))));
    const merge = (k) => { const seen = new Set(); return [r, ...extra].flatMap((x) => x[k] || []).filter((x) => !seen.has(x.id) && seen.add(x.id)); };
    r = { song: merge('song'), album: merge('album'), artist: merge('artist') };
  }
  const yearOk = (y) => !f.y1 || (y && y >= f.y1 && y <= f.y2);
  const genreOk = (g) => !f.genre || (g || '').toLowerCase().includes(f.genre);
  let songs = (r.song || []).filter((s) => yearOk(s.year) && genreOk(s.genre) && (!f.fav || s.starred) && (!f.unplayed || !s.playCount));
  let albums = (r.album || []).filter((a) => yearOk(a.year) && genreOk(a.genre) && (!f.fav || a.starred) && (!f.unplayed || !a.playCount));
  let artists = (r.artist || []).filter((a) => (!f.fav || a.starred) && !f.genre && !f.y1);
  const rank = (arr, key) => arr.map((x) => [x, score(f.text, key(x))]).filter(([, s]) => s > 0.45).sort((a, b) => b[1] - a[1]).map(([x]) => x);
  if (f.text) { songs = rank(songs, (s) => `${s.title} ${s.artist}`); albums = rank(albums, (a) => `${a.name} ${a.artist}`); artists = rank(artists, (a) => a.name); }
  let playlists = [];
  if (want('playlist') && f.text && !f.genre && !f.y1) {
    plCache = plCache || (await nd('getPlaylists').then((x) => x.playlists?.playlist || []).catch(() => []));
    playlists = rank(plCache, (p) => p.name);
  }
  return { songs: songs.slice(0, big ? 100 : 5), albums: albums.slice(0, big ? 40 : 4), artists: artists.slice(0, big ? 30 : 3), playlists: playlists.slice(0, big ? 20 : 3) };
}
async function searchVideo(f, big) {
  if (!signed('emby')) return null;
  const types = { movie: 'Movie', show: 'Series', episode: 'Episode' };
  if (f.type && !types[f.type]) return null;
  const p = new URLSearchParams({ Recursive: 'true', Limit: big ? '80' : '10', Fields: 'PrimaryImageAspectRatio,ProductionYear,Genres', ImageTypeLimit: '1', EnableImageTypes: 'Primary,Thumb' });
  if (f.text) p.set('SearchTerm', f.text);
  p.set('IncludeItemTypes', f.type ? types[f.type] : 'Movie,Series,Episode');
  if (f.genre) p.set('Genres', f.genre.replace(/\b\w/g, (c) => c.toUpperCase()));
  if (f.y1) p.set('Years', Array.from({ length: Math.min(60, f.y2 - f.y1 + 1) }, (_, i) => f.y1 + i).join(','));
  if (f.fav) p.set('IsFavorite', 'true');
  if (f.unplayed) p.set('IsPlayed', 'false');
  if (!f.text) p.set('SortBy', 'SortName');
  const r = await api.get(`/Users/{userId}/Items?${p}`);
  return { items: r.Items || [] };
}
let absLibs = null;
async function searchBooks(f, big) {
  if (!signed('audiobookshelf') || !f.text || (f.type && f.type !== 'book')) return null;
  absLibs = absLibs || (await api.abs('/api/libraries').then((r) => (r.libraries || []).filter((l) => l.mediaType === 'book')).catch(() => []));
  const res = await Promise.all(absLibs.map((l) => api.abs(`/api/libraries/${l.id}/search?q=${encodeURIComponent(f.text)}&limit=${big ? 30 : 4}`).catch(() => ({}))));
  return { books: res.flatMap((r) => (r.book || []).map((b) => b.libraryItem || b)).slice(0, big ? 60 : 4) };
}
export async function searchAll(raw, big = false) {
  const f = parseQuery(raw);
  const all = { f };
  const jobs = [];
  if (!f.in || f.in === 'music') jobs.push(searchMusic(f, big).then((r) => (all.music = r)).catch(() => {}));
  if (!f.in || f.in === 'video') jobs.push(searchVideo(f, big).then((r) => (all.video = r)).catch(() => {}));
  if (!f.in || f.in === 'audiobooks') jobs.push(searchBooks(f, big).then((r) => (all.audiobooks = r)).catch(() => {}));
  await Promise.all(jobs);
  return all;
}

// ---------- Result rows ----------
function rowHtml(r) {
  const thumb = r.cover ? `<div class="sr-th${r.round ? ' round' : ''}${r.wide ? ' wide' : ''}"><img src="${r.cover}" alt="" loading="lazy" onerror="this.remove()">${r.play ? `<button type="button" class="sr-play" data-play="${r.play}" aria-label="Play">${IC.play}</button>` : ''}</div>` : `<div class="sr-th${r.round ? ' round' : ''}" style="--h:${r.h || 0}"></div>`;
  return `<a class="sr" href="${r.href}" data-sr>${thumb}<div class="sr-txt"><div class="t1">${esc(r.title)}</div><div class="t2">${esc(r.sub)}</div></div>${r.right ? `<span class="t2">${esc(r.right)}</span>` : ''}</a>`;
}
function musicRows(m) {
  if (!m) return [];
  return [
    ...m.songs.map((s) => ({ href: `${href('album', s.albumId)}?song=${encodeURIComponent(s.id)}`, title: s.title, sub: `Song · ${s.artist || ''}`, cover: cover(s.coverArt, 100), play: 'song:' + s.id, right: fmt(s.duration), data: s })),
    ...m.albums.map((a) => ({ href: href('album', a.id), title: a.name, sub: `Album · ${a.artist || ''}${a.year ? ' · ' + a.year : ''}`, cover: cover(a.coverArt, 100), play: 'album:' + a.id })),
    ...m.artists.map((a) => ({ href: href('artist', a.id), title: a.name, sub: 'Artist', cover: cover(a.coverArt || 'ar-' + a.id, 100), round: true })),
    ...m.playlists.map((p) => ({ href: href('playlist', p.id), title: p.name, sub: `Playlist · ${plural(p.songCount, 'song')}`, cover: cover(p.coverArt, 100), play: 'pl:' + p.id })),
  ];
}
function videoRows(v) {
  if (!v) return [];
  const label = { Movie: 'Movie', Series: 'Show', Episode: 'Episode' };
  return v.items.map((i) => ({ href: `#/item/${encodeURIComponent(i.Id)}`, title: i.Name, sub: `${label[i.Type] || i.Type}${i.Type === 'Episode' && i.SeriesName ? ' · ' + i.SeriesName : ''}${i.ProductionYear ? ' · ' + i.ProductionYear : ''}`, cover: i.ImageTags?.Primary ? img(i.Id, 'Primary', i.ImageTags.Primary, 120) : null, wide: i.Type === 'Episode' }));
}
function bookRows(b) {
  if (!b) return [];
  return b.books.map((it) => { const md = it.media?.metadata || {}; return { href: `#/audiobooks/book/${encodeURIComponent(it.id)}`, title: md.title || it.title || 'Book', sub: `Audiobook${md.authorName ? ' · ' + md.authorName : ''}`, cover: absCover(it, 100), h: 20 }; });
}
const GROUPS = { music: ['MUSIC', musicRows], video: ['MOVIES & TV', videoRows], audiobooks: ['AUDIOBOOKS', bookRows] };
const orderNow = () => { const t = tabNow(); return [t, ...['video', 'music', 'audiobooks'].filter((x) => x !== t)]; };

// Play buttons on result covers.
async function playFrom(key) {
  const [k, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  try {
    if (k === 'song') { const r = await nd('getSong', { id }); const s = r.song; const a = await nd('getAlbum', { id: s.albumId }); const songs = a.album.song || []; playSongs(songs, Math.max(0, songs.findIndex((x) => x.id === id)), { from: { type: 'album', id: s.albumId, name: s.album }, shuffle: false }); }
    if (k === 'album') { const a = await nd('getAlbum', { id }); playSongs(a.album.song || [], 0, { from: { type: 'album', id, name: a.album.name }, shuffle: false }); }
    if (k === 'pl') { const p = await nd('getPlaylist', { id }); playSongs(p.playlist.entry || [], 0, { from: { type: 'playlist', id, name: p.playlist.name }, shuffle: false }); }
  } catch (e) { toast(String(e), true); }
}

// ---------- The bar ----------
const RKEY = 'srecent';
const recents = () => { try { return JSON.parse(localStorage.getItem(RKEY) || '[]'); } catch { return []; } };
const addRecent = (q) => { q = q.trim(); if (q.length < 2) return; try { localStorage.setItem(RKEY, JSON.stringify([q, ...recents().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8))); } catch {} };

export function mountSearch() {
  const box = document.getElementById('tsearch'); if (!box || box.dataset.wired) return;
  box.dataset.wired = 1;
  const input = box.querySelector('input'); const drop = box.querySelector('.tdrop');
  let seq = 0, sel = -1, timer;
  const placeholder = () => { input.placeholder = { music: 'Search music…', video: 'Search movies & TV…', audiobooks: 'Search audiobooks…' }[tabNow()]; };
  placeholder(); window.addEventListener('hashchange', placeholder);
  const show = (html) => { drop.innerHTML = html; drop.hidden = false; box.classList.add('open'); sel = -1; };
  const hide = () => { drop.hidden = true; box.classList.remove('open'); advOpen = false; };
  const foot = `<div class="sfoot"><kbd>Enter</kbd><span>all results</span><kbd>Esc</kbd><span>close</span><kbd>Ctrl F</kbd><span>search</span><span class="sp"></span><a href="#" data-all>See all results</a><button type="button" class="sadv-b" data-adv>${SI.sliders}<span>Advanced</span></button></div>`;
  const idle = () => {
    const rc = recents();
    const jump = tabNow() === 'music' ? lib.rec.slice(0, 3) : [];
    show(`${rc.length ? `<div class="kicker sk">RECENT SEARCHES</div><div class="schips">${rc.map((q) => `<span class="schip" data-q="${esc(q)}">${SI.clock}<span>${esc(q)}</span><button type="button" data-rm="${esc(q)}" aria-label="Remove">${SI.x}</button></span>`).join('')}</div>` : ''}
      ${jump.length ? `<div class="kicker sk">JUMP BACK IN · MUSIC</div>${jump.map((e) => rowHtml({ href: href(kindOf(e.k), e.k.slice(3)), title: e.t, sub: e.sub, cover: e.cv ? cover(e.cv, 100) : null, round: kindOf(e.k) === 'artist' })).join('')}` : ''}
      ${foot}`);
  };
  const run = async () => {
    const raw = input.value; const f = parseQuery(raw);
    if (!f.text && !hasFilter(f)) return idle();
    if (f.text.length === 1 && !hasFilter(f)) return;
    const my = ++seq;
    if (drop.hidden || !drop.querySelector('.sr')) show(`<div class="sload">${loadingHtml('Searching…')}</div>${foot}`);
    const res = await searchAll(raw, false);
    if (my !== seq) return;
    const blocks = orderNow().map((k) => { const rows = GROUPS[k][1](res[k]); return rows.length ? `<div class="kicker sk">${GROUPS[k][0]}</div>${rows.slice(0, 7).map(rowHtml).join('')}` : ''; }).join('');
    show((blocks || `<div class="sempty">Nothing found for “${esc(raw)}”.</div>`) + foot);
  };
  input.addEventListener('focus', () => { if (drop.hidden) run(); });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 200); });
  input.addEventListener('keydown', (e) => {
    const items = [...drop.querySelectorAll('[data-sr]')];
    if (e.key === 'Escape') { e.preventDefault(); hide(); input.blur(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!items.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((x, i) => x.classList.toggle('kb', i === sel)); items[sel].scrollIntoView({ block: 'nearest' }); return;
    }
    if (e.key === 'Enter') { e.preventDefault(); addRecent(input.value); if (sel >= 0 && items[sel]) { location.hash = items[sel].getAttribute('href'); } else goAll(); hide(); input.blur(); }
  });
  const goAll = () => { const q = input.value.trim(); if (!q) return; addRecent(q); location.hash = '#/search?q=' + encodeURIComponent(q); };
  drop.addEventListener('mousedown', (e) => e.preventDefault());
  drop.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]'); if (rm) { e.stopPropagation(); localStorage.setItem(RKEY, JSON.stringify(recents().filter((x) => x !== rm.dataset.rm))); idle(); return; }
    const p = e.target.closest('[data-play]'); if (p) { e.preventDefault(); e.stopPropagation(); playFrom(p.dataset.play); return; }
    const c = e.target.closest('[data-q]'); if (c) { input.value = c.dataset.q; run(); input.focus(); return; }
    if (e.target.closest('[data-all]')) { e.preventDefault(); goAll(); hide(); input.blur(); return; }
    if (e.target.closest('[data-adv]')) { advanced(); return; }
    if (e.target.closest('[data-sr]')) { addRecent(input.value); hide(); input.blur(); }
  });
  box.querySelector('.tadv').addEventListener('click', (e) => { e.preventDefault(); input.focus(); advanced(); });
  document.addEventListener('pointerdown', (e) => { if (!box.contains(e.target)) hide(); });
  window.addEventListener('hashchange', hide);
  window.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') || (e.key === '/' && !typing)) {
      if (document.getElementById('topbar').hidden) return;
      e.preventDefault(); input.focus(); input.select();
    }
  });
  // Advanced pop-up: builds the typed filters for you.
  let advOpen = false;
  function advanced() {
    advOpen = true;
    const f = parseQuery(input.value);
    const opt = (arr, v) => arr.map(([k, l]) => `<option value="${k}"${k === (v || '') ? ' selected' : ''}>${l}</option>`).join('');
    show(`<form class="sadv" id="sadv"><div class="kicker sk">ADVANCED SEARCH</div>
      <label>Words<input name="text" value="${esc(f.text)}" placeholder="Title, artist, album…"></label>
      <div class="sadv-row"><label>Search in<select name="in">${opt([['', 'Everywhere'], ['video', 'Movies & TV'], ['music', 'Music'], ['audiobooks', 'Audiobooks']], f.in)}</select></label>
      <label>Type<select name="type">${opt([['', 'Anything'], ['song', 'Songs'], ['album', 'Albums'], ['artist', 'Artists'], ['playlist', 'Playlists'], ['movie', 'Movies'], ['show', 'Shows'], ['episode', 'Episodes'], ['book', 'Audiobooks']], f.type)}</select></label></div>
      <div class="sadv-row"><label>Genre<input name="genre" value="${esc(f.genre || '')}" placeholder="e.g. rock"></label>
      <label>Year from<input name="y1" type="number" min="1900" max="2100" value="${f.y1 || ''}"></label><label>to<input name="y2" type="number" min="1900" max="2100" value="${f.y2 || ''}"></label></div>
      <div class="sadv-row checks"><label class="ck"><input type="checkbox" name="fav" ${f.fav ? 'checked' : ''}>Favorites only</label><label class="ck"><input type="checkbox" name="unplayed" ${f.unplayed ? 'checked' : ''}>Not played yet</label></div>
      <div class="sadv-btns"><button type="button" class="btn secondary sm" data-advx>Cancel</button><button type="submit" class="btn sm">Search</button></div></form>`);
    const form = drop.querySelector('#sadv');
    form.querySelector('[data-advx]').onclick = () => { advOpen = false; run(); };
    form.onsubmit = (e) => {
      e.preventDefault(); const d = new FormData(form); const parts = [];
      if (d.get('text')) parts.push(d.get('text'));
      if (d.get('in')) parts.push('in:' + ({ video: 'movies', music: 'music', audiobooks: 'audiobooks' })[d.get('in')]);
      if (d.get('type')) parts.push('type:' + d.get('type'));
      if (d.get('genre')) parts.push('genre:' + (/\s/.test(d.get('genre')) ? `"${d.get('genre')}"` : d.get('genre')));
      if (d.get('y1')) parts.push('year:' + d.get('y1') + (d.get('y2') && d.get('y2') !== d.get('y1') ? '-' + d.get('y2') : ''));
      if (d.get('fav')) parts.push('fav:yes'); if (d.get('unplayed')) parts.push('is:unplayed');
      input.value = parts.join(' '); advOpen = false; run(); input.focus();
    };
    form.querySelector('input[name=text]').focus();
  }
}

// ---------- All results page ----------
export async function searchPage(root, ctx) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '';
  const input = document.querySelector('#tsearch input'); if (input && !input.value) input.value = q;
  if (!q) { root.innerHTML = '<div class="empty">Type in the search bar at the top, or press Ctrl+F.</div>'; return; }
  root.innerHTML = `<section class="section">${loadingHtml('Searching…')}</section>`;
  const res = await searchAll(q, true);
  if (!ctx.alive()) return;
  const groupHtml = (k) => {
    const rows = GROUPS[k][1](res[k]); if (!rows.length) return '';
    return `<section class="sres"><div class="section-head"><h2>${GROUPS[k][0].replace('MOVIES & TV', 'Movies & TV').replace('MUSIC', 'Music').replace('AUDIOBOOKS', 'Audiobooks')}</h2><span class="count">${rows.length}</span></div><div class="sgrid">${rows.map(rowHtml).join('')}</div></section>`;
  };
  const html = orderNow().map(groupHtml).join('');
  root.innerHTML = `<div class="spage"><h1 class="disp">Results for “${esc(q)}”</h1>${html || `<div class="empty">Nothing found for “${esc(q)}”.</div>`}</div>`;
  root.addEventListener('click', (e) => { const p = e.target.closest('[data-play]'); if (p) { e.preventDefault(); e.stopPropagation(); playFrom(p.dataset.play); } });
  window.dispatchEvent(new Event('scrappy:ready'));
}
