// One search bar for the whole app, beside the tabs. Ctrl+F focuses it.
// Searches every signed-in server (Emby, Navidrome, Audiobookshelf), the current
// tab's results first. Forgives typos, and understands typed filters:
// in:music  type:song  genre:rock  year:2010-2019  fav:yes  is:unplayed
import { api, img } from './api.js';
import { esc, toast, loadingHtml } from './components.js';
import { playSongs, cover, fmt, IC } from './mplayer.js';
import { nd, coverHtml, href, plural, lib, kindOf } from './music.js';
import { absCover, absAuthorImg, playBook } from './bplayer.js';

const line = (d, n = 18) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const SI = {
  search: line('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>', 18),
  sliders: line('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>', 18),
  clock: line('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 14),
  x: line('<path d="M6 6l12 12M18 6 6 18"/>', 12),
  warn: line('<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>', 15),
};
let session = null;
export function setSearchSession(s) { session = s; }
const signed = (k) => !!session?.servers?.[k]?.signedIn;
const tabNow = () => { const n = (location.hash.split('/')[1] || 'home').split('?')[0]; return n === 'music' ? 'music' : n === 'audiobooks' ? 'audiobooks' : 'video'; };

// ---------- Query parsing ----------
const TYPES = { song: 'song', songs: 'song', album: 'album', albums: 'album', artist: 'artist', artists: 'artist', playlist: 'playlist', movie: 'movie', movies: 'movie', show: 'show', shows: 'show', series: 'show', tv: 'show', episode: 'episode', book: 'book', books: 'book', audiobook: 'book', audiobooks: 'book', person: 'person', people: 'person', actor: 'person', actors: 'person', director: 'person', author: 'author', authors: 'author' };
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
// Typo help: shorter pieces of each word (so "intersteller" still finds "Interstellar").
const pieces = (text) => [...new Set(text.split(/\s+/).filter((w) => w.length >= 3).map((w) => w.slice(0, Math.max(3, Math.ceil(w.length * 0.6)))))];
const dedupe = (arr, key = (x) => x.id) => { const seen = new Set(); return arr.filter((x) => x && !seen.has(key(x)) && seen.add(key(x))); };

let plCache = null, plAt = 0;
let genreCache = null;
// With no words, ask Navidrome for the filter directly (favorites, a genre or a decade)
// instead of filtering whatever the first page of an empty search returns.
async function musicByFilter(f, n) {
  if (f.fav) { const r = (await nd('getStarred2')).starred2 || {}; return { song: r.song || [], album: r.album || [], artist: r.artist || [] }; }
  if (f.genre) {
    genreCache = genreCache || (await nd('getGenres').then((x) => (x.genres?.genre || []).map((g) => g.value)).catch(() => []));
    const g = genreCache.find((x) => x.toLowerCase() === f.genre) || genreCache.find((x) => x.toLowerCase().includes(f.genre));
    if (!g) return { song: [], album: [], artist: [] };
    const [s, a] = await Promise.all([
      nd('getSongsByGenre', { genre: g, count: Math.min(500, n * 4) }).then((x) => x.songsByGenre?.song || []),
      nd('getAlbumList2', { type: 'byGenre', genre: g, size: Math.min(500, n * 2) }).then((x) => x.albumList2?.album || []),
    ]);
    return { song: s, album: a, artist: [] };
  }
  if (f.y1) {
    const a = await nd('getAlbumList2', { type: 'byYear', fromYear: f.y1, toYear: f.y2, size: Math.min(500, n * 2) }).then((x) => x.albumList2?.album || []);
    return { song: [], album: a, artist: [] };
  }
  return null;
}
async function searchMusic(f, big) {
  if (!signed('navidrome')) return null;
  const want = (t) => !f.type || f.type === t;
  const n = big ? 60 : 8;
  const run = (query) => nd('search3', { query, songCount: want('song') ? n * 2 : 0, albumCount: want('album') ? n : 0, artistCount: want('artist') ? n : 0 }).then((r) => r.searchResult3 || {});
  let r = (!f.text && (await musicByFilter(f, n))) || (await run(f.text));
  const count = (x) => (x.song?.length || 0) + (x.album?.length || 0) + (x.artist?.length || 0);
  // Few hits? Try shorter pieces of each word so typos still find things.
  if (f.text && count(r) < 3) {
    const extra = await Promise.all(pieces(f.text).map((p) => run(p).catch(() => ({}))));
    const merge = (k) => dedupe([r, ...extra].flatMap((x) => x[k] || []));
    r = { song: merge('song'), album: merge('album'), artist: merge('artist') };
  }
  const yearOk = (y) => !f.y1 || (y && y >= f.y1 && y <= f.y2);
  const genreOk = (g) => !f.genre || (g || '').toLowerCase().includes(f.genre);
  let songs = want('song') ? (r.song || []).filter((s) => yearOk(s.year) && genreOk(s.genre) && (!f.fav || s.starred) && (!f.unplayed || !s.playCount)) : [];
  let albums = want('album') ? (r.album || []).filter((a) => yearOk(a.year) && genreOk(a.genre) && (!f.fav || a.starred) && (!f.unplayed || !a.playCount)) : [];
  let artists = want('artist') ? (r.artist || []).filter((a) => (!f.fav || a.starred) && !f.genre && !f.y1) : [];
  const rank = (arr, key) => arr.map((x) => [x, score(f.text, key(x))]).filter(([, s]) => s > 0.45).sort((a, b) => b[1] - a[1]).map(([x]) => x);
  if (f.text) { songs = rank(songs, (s) => `${s.title} ${s.artist}`); albums = rank(albums, (a) => `${a.name} ${a.artist}`); artists = rank(artists, (a) => a.name); }
  let playlists = [];
  if (want('playlist') && f.text && !f.genre && !f.y1) {
    // Refresh the playlist list now and then so new playlists are found.
    if (!plCache || Date.now() - plAt > 60000) { plCache = await nd('getPlaylists').then((x) => x.playlists?.playlist || []).catch(() => plCache || []); plAt = Date.now(); }
    playlists = rank(plCache, (p) => p.name);
  }
  return { songs: songs.slice(0, big ? 100 : 5), albums: albums.slice(0, big ? 40 : 4), artists: artists.slice(0, big ? 30 : 3), playlists: playlists.slice(0, big ? 20 : 3) };
}

const VFIELDS = { Fields: 'PrimaryImageAspectRatio,ProductionYear,Genres', ImageTypeLimit: '1', EnableImageTypes: 'Primary,Thumb' };
async function searchVideo(f, big) {
  if (!signed('emby')) return null;
  const types = { movie: 'Movie', show: 'Series', episode: 'Episode' };
  if (f.type && !types[f.type] && f.type !== 'person') return null;
  const base = (extra) => {
    const p = new URLSearchParams({ Recursive: 'true', ...VFIELDS, ...extra });
    if (f.genre) p.set('Genres', f.genre.replace(/\b\w/g, (c) => c.toUpperCase()));
    if (f.y1) p.set('Years', Array.from({ length: Math.min(60, f.y2 - f.y1 + 1) }, (_, i) => f.y1 + i).join(','));
    if (f.fav) p.set('IsFavorite', 'true');
    if (f.unplayed) p.set('IsPlayed', 'false');
    return p;
  };
  // Movies and shows, and episodes on their own, so episodes can't crowd out the show.
  const query = (term) => {
    const jobs = [];
    const top = f.type ? (f.type === 'episode' || f.type === 'person' ? '' : types[f.type]) : 'Movie,Series';
    if (top) { const p = base({ Limit: big ? '80' : '10', IncludeItemTypes: top }); if (term) p.set('SearchTerm', term); else p.set('SortBy', 'SortName'); jobs.push(api.get(`/Users/{userId}/Items?${p}`)); }
    if ((!f.type || f.type === 'episode') && (term || f.type === 'episode')) { const p = base({ Limit: big ? '60' : '6', IncludeItemTypes: 'Episode' }); if (term) p.set('SearchTerm', term); else p.set('SortBy', 'SortName'); jobs.push(api.get(`/Users/{userId}/Items?${p}`)); }
    return Promise.all(jobs).then((rs) => rs.flatMap((r) => r?.Items || []));
  };
  // People (actors, directors) only when there are words and no filters that people don't have.
  const wantPeople = f.text && (!f.type || f.type === 'person') && !f.genre && !f.y1 && !f.unplayed;
  const people = wantPeople
    ? api.get(`/Persons?${new URLSearchParams({ UserId: '{userId}', SearchTerm: f.text, Limit: big ? '30' : '8', Fields: 'PrimaryImageAspectRatio', ImageTypeLimit: '1', EnableImageTypes: 'Primary', ...(f.fav ? { IsFavorite: 'true' } : {}) })}`.replace('%7BuserId%7D', '{userId}')).then((r) => r?.Items || []).catch(() => [])
    : Promise.resolve([]);
  let [items, persons] = await Promise.all([query(f.text), people]);
  // Few hits? Try shorter pieces of each word, then keep only close matches.
  if (f.text && items.length < 3) {
    const extra = await Promise.all(pieces(f.text).map((p) => query(p).catch(() => [])));
    items = dedupe([...items, ...extra.flat()], (x) => x.Id);
  }
  if (f.text) {
    const rank = (arr) => arr.map((x) => [x, score(f.text, x.Name)]).filter(([, s]) => s > 0.45).sort((a, b) => b[1] - a[1]).map(([x]) => x);
    items = rank(items);
    persons = rank(persons);
  }
  // A close match on a person also brings in what they're in.
  let withPerson = [];
  if (persons[0] && score(f.text, persons[0].Name) >= 0.85 && f.type !== 'person') {
    const p = base({ Limit: big ? '60' : '6', IncludeItemTypes: f.type ? types[f.type] || 'Movie,Series' : 'Movie,Series', PersonIds: persons[0].Id, SortBy: 'CommunityRating,SortName', SortOrder: 'Descending' });
    withPerson = await api.get(`/Users/{userId}/Items?${p}`).then((r) => (r?.Items || []).map((i) => ({ ...i, _with: persons[0].Name }))).catch(() => []);
  }
  // Movies and shows first (title matches, then the person's), episodes last.
  items = dedupe([...items.filter((x) => x.Type !== 'Episode'), ...withPerson, ...items.filter((x) => x.Type === 'Episode')], (x) => x.Id);
  if (f.type === 'person') items = [];
  return { items: items.slice(0, big ? 120 : 10), people: persons.slice(0, big ? 30 : 6) };
}

let absLibs = null;
const b64 = (s) => encodeURIComponent(btoa(String.fromCharCode(...new TextEncoder().encode(s))));
async function searchBooks(f, big) {
  if (!signed('audiobookshelf') || !f.text || (f.type && f.type !== 'book' && f.type !== 'author')) return null;
  absLibs = absLibs || (await api.abs('/api/libraries').then((r) => (r.libraries || []).filter((l) => l.mediaType === 'book')));
  const n = big ? 30 : 6;
  // Audiobookshelf only matches book titles; authors, series and narrators come back separately.
  const res = await Promise.all(absLibs.map((l) => api.abs(`/api/libraries/${l.id}/search?q=${encodeURIComponent(f.text)}&limit=${n}`).then((r) => ({ l, r }))));
  const direct = res.flatMap(({ r }) => (r.book || []).map((b) => b.libraryItem || b));
  const rank = (arr, key) => arr.map((x) => [x, score(f.text, key(x))]).filter(([, s]) => s > 0.45).sort((a, b) => b[1] - a[1]).map(([x]) => x);
  const authors = rank(dedupe(res.flatMap(({ r }) => r.authors || [])), (a) => a.name);
  const series = rank(res.flatMap(({ r }) => r.series || []), (s) => s.series?.name || '');
  const narrators = rank(res.flatMap(({ l, r }) => (r.narrators || []).map((x) => ({ ...x, lib: l.id }))), (x) => x.name);
  // Books by the best-matching author, from the best series, and read by the best narrator.
  const extra = await Promise.all([
    authors[0] ? api.abs(`/api/authors/${encodeURIComponent(authors[0].id)}?include=items`).then((a) => (a.libraryItems || []).map((it) => ({ ...it, _by: authors[0].name }))).catch(() => []) : [],
    narrators[0] ? api.abs(`/api/libraries/${narrators[0].lib}/items?filter=narrators.${b64(narrators[0].name)}&limit=${n}`).then((r) => (r.results || []).map((it) => ({ ...it, _read: narrators[0].name }))).catch(() => []) : [],
  ]);
  const fromSeries = series.flatMap((s) => (s.books || []).map((it) => ({ ...it, _series: s.series?.name })));
  const books = f.type === 'author' ? [] : dedupe([...direct, ...extra[0], ...fromSeries, ...extra[1]]);
  return { books: books.slice(0, big ? 60 : 4), authors: f.type === 'book' ? [] : authors.slice(0, big ? 20 : 2) };
}
export async function searchAll(raw, big = false) {
  const f = parseQuery(raw);
  const all = { f, failed: [] };
  const job = (k, name, fn) => fn(f, big).then((r) => (all[k] = r)).catch(() => all.failed.push(name));
  const jobs = [];
  if (!f.in || f.in === 'music') jobs.push(job('music', 'Navidrome', searchMusic));
  if (!f.in || f.in === 'video') jobs.push(job('video', 'Emby', searchVideo));
  if (!f.in || f.in === 'audiobooks') jobs.push(job('audiobooks', 'Audiobookshelf', searchBooks));
  await Promise.all(jobs);
  return all;
}

// ---------- Result rows ----------
function rowHtml(r) {
  const thumb = r.cover ? `<div class="sr-th${r.round ? ' round' : ''}${r.wide ? ' wide' : ''}"><img src="${r.cover}" alt="" loading="lazy" onerror="this.remove()">${r.play ? `<button type="button" class="sr-play" data-play="${r.play}" aria-label="Play">${IC.play}</button>` : ''}</div>` : `<div class="sr-th${r.round ? ' round' : ''}" style="--h:${r.h || 0}"></div>`;
  return `<a class="sr" href="${r.href}" data-sr>${thumb}<div class="sr-txt"><div class="t1">${esc(r.title)}</div><div class="t2">${esc(r.sub)}</div></div>${r.right ? `<span class="t2">${esc(r.right)}</span>` : ''}</a>`;
}
const initials = (s) => (s || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
// A row of round faces (people, authors) for the drop-down.
function chipsHtml(rows) {
  return `<div class="schips-p">${rows.map((r) => `<a class="sp-chip" href="${r.href}" data-sr title="${esc(r.title)}"><span class="sr-th round" style="--h:${r.h || 0}"><b>${esc(initials(r.title))}</b>${r.cover ? `<img src="${r.cover}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span><span class="t2">${esc(r.title)}</span></a>`).join('')}</div>`;
}
const hueOf = (s) => { let h = 0; for (const c of s || '') h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
function musicGroups(m) {
  if (!m) return [];
  return [{ label: 'MUSIC', title: 'Music', rows: [
    ...m.songs.map((s) => ({ href: `${href('album', s.albumId)}?song=${encodeURIComponent(s.id)}`, title: s.title, sub: `Song · ${s.artist || ''}`, cover: cover(s.coverArt, 100), play: 'song:' + s.id, right: fmt(s.duration), data: s })),
    ...m.albums.map((a) => ({ href: href('album', a.id), title: a.name, sub: `Album · ${a.artist || ''}${a.year ? ' · ' + a.year : ''}`, cover: cover(a.coverArt, 100), play: 'album:' + a.id })),
    ...m.artists.map((a) => ({ href: href('artist', a.id), title: a.name, sub: 'Artist', cover: cover(a.coverArt || 'ar-' + a.id, 100), round: true })),
    ...m.playlists.map((p) => ({ href: href('playlist', p.id), title: p.name, sub: `Playlist · ${plural(p.songCount, 'song')}`, cover: cover(p.coverArt, 100), play: 'pl:' + p.id })),
  ] }];
}
function videoGroups(v) {
  if (!v) return [];
  const label = { Movie: 'Movie', Series: 'Show', Episode: 'Episode' };
  const people = (v.people || []).map((p) => ({ href: `#/person/${encodeURIComponent(p.Id)}`, title: p.Name, sub: p.Role || 'Person', cover: p.ImageTags?.Primary ? img(p.Id, 'Primary', p.ImageTags.Primary, 120) : null, round: true, h: hueOf(p.Name) }));
  const rows = v.items.map((i) => ({ href: `#/item/${encodeURIComponent(i.Id)}`, title: i.Name, sub: [label[i.Type] || i.Type, i.Type === 'Episode' ? i.SeriesName : '', i.ProductionYear, i._with ? 'with ' + i._with : ''].filter(Boolean).join(' · '), cover: i.ImageTags?.Primary ? img(i.Id, 'Primary', i.ImageTags.Primary, 120) : null, wide: i.Type === 'Episode' }));
  return [{ label: 'PEOPLE', title: 'People', rows: people, chips: true }, { label: 'MOVIES & TV', title: 'Movies & TV', rows }];
}
function bookGroups(b) {
  if (!b) return [];
  const seriesOf = (md) => md.seriesName || (md.series || []).map((s) => s.name + (s.sequence ? ' #' + s.sequence : '')).join(', ');
  const authors = (b.authors || []).map((a) => ({ href: `#/audiobooks/author/${encodeURIComponent(a.id)}`, title: a.name, sub: `Author${a.numBooks ? ' · ' + plural(a.numBooks, 'book') : ''}`, cover: absAuthorImg(a, 120) || null, round: true, h: hueOf(a.name) }));
  const books = b.books.map((it) => {
    const md = it.media?.metadata || {};
    const by = md.authorName || it._by || '';
    const extra = it._read && !by ? 'Read by ' + it._read : seriesOf(md) || it._series || '';
    return { href: `#/audiobooks/book/${encodeURIComponent(it.id)}`, title: md.title || it.title || 'Book', sub: ['Audiobook', by, extra].filter(Boolean).join(' · '), cover: absCover(it, 100), play: 'book:' + it.id, h: 20 };
  });
  return [{ label: 'AUTHORS', title: 'Authors', rows: authors }, { label: 'AUDIOBOOKS', title: 'Audiobooks', rows: books }];
}
const GROUPS = { music: musicGroups, video: videoGroups, audiobooks: bookGroups };
const orderNow = () => { const t = tabNow(); return [t, ...['video', 'music', 'audiobooks'].filter((x) => x !== t)]; };
const failedHtml = (res) => (res.failed?.length ? `<div class="sfail">${SI.warn}<span>Couldn't reach ${res.failed.join(' or ')}, so ${res.failed.length > 1 ? 'their' : 'its'} results aren't included.</span></div>` : '');

// Play buttons on result covers.
async function playFrom(key) {
  const [k, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  try {
    if (k === 'book') { playBook(id); return; }
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
    // One block per category (your tab first), each with its own heading.
    const blocks = orderNow().map((k) => GROUPS[k](res[k]).filter((g) => g.rows.length).map((g) => `<div class="kicker sk">${g.label}</div>${g.chips ? chipsHtml(g.rows) : g.rows.slice(0, 7).map(rowHtml).join('')}`).join('')).filter(Boolean).map((h) => `<div class="sgrp">${h}</div>`).join('');
    show((blocks || `<div class="sempty">Nothing found for “${esc(raw)}”.</div>`) + failedHtml(res) + foot);
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
      <label>Type<select name="type">${opt([['', 'Anything'], ['song', 'Songs'], ['album', 'Albums'], ['artist', 'Artists'], ['playlist', 'Playlists'], ['movie', 'Movies'], ['show', 'Shows'], ['episode', 'Episodes'], ['person', 'People'], ['book', 'Audiobooks'], ['author', 'Authors']], f.type)}</select></label></div>
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
  const groupHtml = (g) => `<section class="sres"><div class="section-head"><h2>${g.title}</h2><span class="count">${g.rows.length}</span></div><div class="sgrid">${g.rows.map(rowHtml).join('')}</div></section>`;
  const html = orderNow().flatMap((k) => GROUPS[k](res[k]).filter((g) => g.rows.length)).map(groupHtml).join('');
  root.innerHTML = `<div class="spage"><h1 class="disp">Results for “${esc(q)}”</h1>${failedHtml(res)}${html || `<div class="empty">Nothing found for “${esc(q)}”.</div>`}</div>`;
  // The page area outlives this page: wire it once, or one click would play many times over.
  if (!root.dataset.searchPlay) { root.dataset.searchPlay = '1'; root.addEventListener('click', (e) => { const p = e.target.closest('[data-play]'); if (p) { e.preventDefault(); e.stopPropagation(); playFrom(p.dataset.play); } }); }
  window.dispatchEvent(new Event('scrappy:ready'));
}
