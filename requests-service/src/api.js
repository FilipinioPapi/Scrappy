// The service's web API, used by the Scrappy apps.
import { config } from './config.js';
import * as db from './db.js';
import * as handoff from './handoff.js';
import * as T from './tmdb.js';
import * as MB from './musicbrainz.js';
import * as AU from './audible.js';
import { findMovie, findShow, showEpisodes, embyOn } from './emby.js';
import { findAlbum, findSong, artistAlbumCount, navidromeOn } from './navidrome.js';
import { findBook, absOn } from './abs.js';
import { cache, getJson, today } from './util.js';

export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// ---------- Who's asking ----------
// The app sends the person's own Emby sign-in. We ask Emby who that is, so nobody can pose as someone else.
const who = cache(15 * 60 * 1000, 200);
export async function identify(req) {
  const token = req.headers['x-emby-token'], userId = req.headers['x-emby-userid'];
  if (!token || !userId) throw new HttpError(401, 'Sign in to Emby in Scrappy to make requests.');
  const key = token + '|' + userId;
  let name = who.get(key);
  if (!name) {
    if (!config.emby.url) throw new HttpError(500, 'EMBY_URL is not set on the request service.');
    try {
      const u = await getJson(`${config.emby.url}/Users/${encodeURIComponent(userId)}`, { headers: { 'X-Emby-Token': token, accept: 'application/json' } });
      name = u?.Name;
    } catch (e) { if (e.status === 401 || e.status === 403 || e.status === 404) throw new HttpError(401, 'Your Emby sign-in expired. Sign in again in Scrappy.'); throw new HttpError(502, "Couldn't reach Emby to check who you are."); }
    if (!name) throw new HttpError(401, 'Your Emby sign-in expired. Sign in again in Scrappy.');
    who.set(key, name);
  }
  return { name, admin: config.admins.includes(name.toLowerCase()) };
}

// ---------- Helpers ----------
const reqState = (map, id) => { const r = map.get(String(id)); return r ? { id: r.id, status: r.status } : null; };
const yearOf = (d) => (d || '').slice(0, 4);
const recent = (d) => !d || d > today() || (Date.now() - Date.parse(d)) / 864e5 < 150;

async function movieCard(m, reqs, detail) {
  const on = await findMovie(m.id, m.title, yearOf(m.release_date));
  let release = { out: true, label: '' };
  if (!on && detail) release = T.releaseInfo(detail);
  else if (!on && m.release_date > today()) release = { out: false, label: 'Coming soon' };
  return {
    type: 'movie', id: String(m.id), source: 'tmdb', title: m.title, year: yearOf(m.release_date), subtitle: yearOf(m.release_date),
    poster: T.poster(m.poster_path), onServer: on?.id || null, request: reqState(reqs, m.id), release, overview: m.overview || '',
  };
}

async function collectionView(id) {
  const c = await T.collection(id);
  const parts = (c.parts || []).sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999'));
  const reqs = db.latestFor('movie', parts.map((p) => p.id));
  const details = await Promise.all(parts.map((p) => (recent(p.release_date) ? T.movieDetails(p.id).catch(() => null) : null)));
  const items = await Promise.all(parts.map((p, i) => movieCard(p, reqs, details[i])));
  return { id: String(c.id), name: c.name, poster: T.poster(c.poster_path), backdrop: T.poster(c.backdrop_path, 'w780'), overview: c.overview || '', items,
    total: items.length, onServer: items.filter((x) => x.onServer).length, notOut: items.filter((x) => !x.onServer && !x.release.out).length };
}

async function searchMovies(q) {
  const r = await T.searchMovies(q);
  const list = (r.results || []).slice(0, 20);
  const reqs = db.latestFor('movie', list.map((m) => m.id));
  let n = 0;
  const details = await Promise.all(list.map((m, i) => (i === 0 || (recent(m.release_date) && n++ < 8) ? T.movieDetails(m.id).catch(() => null) : null)));
  const items = await Promise.all(list.map((m, i) => movieCard(m, reqs, details[i])));
  const coll = details[0]?.belongs_to_collection;
  return { items, collection: coll ? await collectionView(coll.id).catch(() => null) : null };
}

/** Seasons and episodes of a show, compared with what Emby has. */
async function tvView(id, user) {
  const d = await T.tvDetails(id);
  const year = yearOf(d.first_air_date);
  const emby = await findShow(id, d.name, year);
  const have = emby ? await showEpisodes(emby.id) : new Set();
  const open = db.openFor('tv', id);
  const asked = open?.parts || {};
  const seasons = await Promise.all((d.seasons || []).map(async (s) => {
    const sd = await T.seasonDetails(id, s.season_number).catch(() => ({ episodes: [] }));
    const eps = (sd.episodes || []).map((e) => ({
      n: e.episode_number, name: e.name, airDate: e.air_date || '', aired: !!e.air_date && e.air_date <= today(),
      onServer: have.has(`${s.season_number}:${e.episode_number}`),
      requested: !!open && (asked.whole || (asked.seasons || []).includes(s.season_number) || (asked.episodes?.[s.season_number] || []).includes(e.episode_number)),
    }));
    const aired = eps.filter((e) => e.aired), got = aired.filter((e) => e.onServer).length;
    const next = eps.find((e) => !e.aired);
    let status, label = '';
    if (!aired.length) { status = 'soon'; label = s.air_date ? `Starts ${new Date(s.air_date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}` : 'Coming soon'; }
    else if (got === aired.length) status = 'complete';
    else if (got === 0) status = 'missing';
    else status = 'partial';
    if (next && aired.length) label = `Airing · next ${next.airDate ? new Date(next.airDate + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'soon'}`;
    return { n: s.season_number, name: s.name || (s.season_number ? `Season ${s.season_number}` : 'Specials'), airDate: s.air_date || '', status, label, special: s.season_number === 0, total: eps.length, aired: aired.length, onServer: got, episodes: eps,
      requested: !!open && (asked.whole || (asked.seasons || []).includes(s.season_number)) };
  }));
  return {
    type: 'tv', id: String(d.id), source: 'tmdb', title: d.name, year, poster: T.poster(d.poster_path), backdrop: T.poster(d.backdrop_path, 'w780'), overview: d.overview || '',
    airing: !!d.in_production || d.status === 'Returning Series', status: d.status, onServer: emby?.id || null,
    request: open ? { id: open.id, status: open.status, parts: open.parts } : null, following: db.isFollowing(id, user), seasons,
  };
}

async function searchTv(q) {
  const r = await T.searchTv(q);
  const list = (r.results || []).slice(0, 20);
  const reqs = db.latestFor('tv', list.map((m) => m.id));
  const items = await Promise.all(list.map(async (m, i) => {
    const on = await findShow(m.id, m.name, yearOf(m.first_air_date));
    let partial = false;
    // For shows on the server, check (for the first few) whether every aired episode is there.
    if (on && i < 6) {
      try {
        const [d, have] = await Promise.all([T.tvDetails(m.id), showEpisodes(on.id)]);
        const last = d.last_episode_to_air;
        const airedCount = (d.seasons || []).filter((s) => s.season_number > 0 && (!last || s.season_number < last.season_number)).reduce((a, s) => a + (s.episode_count || 0), 0) + (last ? last.episode_number : 0);
        partial = [...have].filter((k) => !k.startsWith('0:')).length < airedCount;
      } catch {}
    }
    return { type: 'tv', id: String(m.id), source: 'tmdb', title: m.name, year: yearOf(m.first_air_date), subtitle: yearOf(m.first_air_date), poster: T.poster(m.poster_path),
      onServer: on?.id || null, partial, request: reqState(reqs, m.id), release: { out: !!m.first_air_date && m.first_air_date <= today(), label: m.first_air_date && m.first_air_date <= today() ? '' : 'Coming soon' }, overview: m.overview || '' };
  }));
  return { items };
}

async function searchMusic(q, all) {
  const r = await MB.searchMusic(q, all);
  const albumReqs = db.latestFor('album', r.albums.map((a) => a.id)), songReqs = db.latestFor('song', r.songs.map((s) => s.id));
  const albums = await Promise.all(r.albums.map(async (a) => ({ type: 'album', ...a, poster: a.cover, subtitle: [a.kind === 'album' ? '' : a.kindLabel, a.artist, a.year].filter(Boolean).join(' · '), onServer: (await findAlbum(a.artist, a.title))?.id || null, request: reqState(albumReqs, a.id), release: { out: true, label: '' } })));
  const songs = await Promise.all(r.songs.map(async (s) => {
    const on = (await findSong(s.artist, s.title)) || null;
    return { type: 'song', ...s, poster: s.cover, subtitle: [s.artist, s.album ? 'from ' + s.album : ''].filter(Boolean).join(' · '), onServer: on?.albumId || null, request: reqState(songReqs, s.id), release: { out: true, label: '' } };
  }));
  const artists = await Promise.all(r.artists.map(async (a) => ({ type: 'artist', id: a.id, title: a.name, subtitle: [a.type, a.country, a.disambiguation].filter(Boolean).join(' · '), poster: '', onServerCount: await artistAlbumCount(a.name) })));
  return { artists, albums, songs };
}

async function artistView(id, all) {
  const a = await MB.artistAlbums(id);
  const list = a.albums.filter((x) => all || ['album', 'ep'].includes(x.kind));
  const reqs = db.latestFor('album', list.map((x) => x.id));
  const items = await Promise.all(list.map(async (x) => ({ type: 'album', ...x, poster: x.cover, subtitle: [x.kind === 'album' ? '' : x.kindLabel, x.year].filter(Boolean).join(' · '), onServer: (await findAlbum(x.artist || a.name, x.title))?.id || null, request: reqState(reqs, x.id), release: { out: true, label: '' } })));
  const main = items.filter((x) => ['album', 'ep'].includes(x.kind));
  return { id: a.id, name: a.name, disambiguation: a.disambiguation, items, total: main.length, onServer: main.filter((x) => x.onServer).length, hiddenCount: all ? 0 : a.albums.length - list.length };
}

async function bookCards(books) {
  const reqs = db.latestFor('book', books.map((b) => b.id));
  return Promise.all(books.map(async (b) => ({
    type: 'book', ...b, poster: b.cover,
    subtitle: [b.author, b.series ? `${b.series.title}${b.series.sequence ? ' #' + b.series.sequence : ''}` : '', b.length].filter(Boolean).join(' · '),
    onServer: (await findBook(b.source === 'audible' ? b.id : '', b.title, b.author))?.id || null, request: reqState(reqs, b.id),
    release: b.released ? { out: true, label: '' } : { out: false, label: `Out ${new Date(b.releaseDate + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` },
  })));
}

// ---------- Building a request from an id (the server fills in the details itself) ----------
async function itemFor(x) {
  const id = String(x.extId || '').trim();
  if (!id) throw new HttpError(400, 'Missing item.');
  if (x.type === 'movie') {
    const d = await T.movieDetails(id), rel = T.releaseInfo(d);
    return { type: 'movie', extId: id, source: 'tmdb', title: d.title, year: yearOf(d.release_date), subtitle: yearOf(d.release_date), poster: T.poster(d.poster_path), release: rel.out ? '' : rel.label };
  }
  if (x.type === 'tv') {
    const d = await T.tvDetails(id);
    const clean = (a) => [...new Set((a || []).map(Number).filter((n) => Number.isInteger(n) && n >= 0))].sort((p, q) => p - q);
    const parts = {};
    if (x.parts?.whole) parts.whole = true;
    if (x.parts?.seasons?.length) parts.seasons = clean(x.parts.seasons);
    for (const [s, eps] of Object.entries(x.parts?.episodes || {})) { const e = clean(eps); if (e.length) (parts.episodes ||= {})[Number(s)] = e; }
    if (!parts.whole && !parts.seasons && !parts.episodes) parts.whole = true;
    return { type: 'tv', extId: id, source: 'tmdb', title: d.name, year: yearOf(d.first_air_date), subtitle: handoff.partsText(parts), poster: T.poster(d.poster_path), parts, follow: !!x.follow };
  }
  if (x.type === 'album') {
    const a = await MB.releaseGroup(id);
    return { type: 'album', extId: id, source: 'musicbrainz', title: a.title, year: a.year, subtitle: [a.kindLabel, a.artist].join(' · '), poster: a.cover, info: { artist: a.artist, artistId: a.artistId, kind: a.kind } };
  }
  if (x.type === 'song') {
    const s = await MB.recording(id);
    return { type: 'song', extId: id, source: 'musicbrainz', title: s.title, year: s.year, subtitle: [s.artist, s.album ? 'from ' + s.album : ''].filter(Boolean).join(' · '), poster: s.cover, info: { artist: s.artist, album: s.album, albumId: s.albumId } };
  }
  if (x.type === 'book') {
    const b = await AU.bookById(id, x.source === 'openlibrary' ? 'openlibrary' : 'audible');
    return { type: 'book', extId: id, source: b.source, title: b.title, year: b.year, subtitle: [b.author, b.series ? `${b.series.title}${b.series.sequence ? ' #' + b.series.sequence : ''}` : ''].filter(Boolean).join(' · '), poster: b.cover,
      release: b.released ? '' : `Out ${b.releaseDate}`, info: { author: b.author, narrator: b.narrator, series: b.series } };
  }
  throw new HttpError(400, 'Unknown request type.');
}

async function alreadyThere(item) {
  if (item.type === 'movie') return !!(await findMovie(item.extId, item.title, item.year));
  if (item.type === 'album') return !!(await findAlbum(item.info.artist, item.title));
  if (item.type === 'song') return !!(await findSong(item.info.artist, item.title));
  if (item.type === 'book') return !!(await findBook(item.source === 'audible' ? item.extId : '', item.title, item.info.author));
  return false; // TV: the app only sends missing parts
}

// ---------- Routes ----------
export async function route(method, path, query, body, req) {
  if (path === '/api/health') {
    return { ok: true, version: '1.0.0', emby: embyOn(), navidrome: navidromeOn(), audiobookshelf: absOn(), tmdb: !!config.tmdbKey, region: config.region };
  }
  const me = await identify(req);
  const mustAdmin = () => { if (!me.admin) throw new HttpError(403, 'Only admins can do that.'); };
  let m;

  if (method === 'GET' && path === '/api/me') return { user: me.name, admin: me.admin, region: config.region, music: navidromeOn(), books: absOn() };

  if (method === 'GET' && path === '/api/search') {
    const q = String(query.q || '').trim();
    if (q.length < 2) return { items: [] };
    if (query.type === 'movie') return searchMovies(q);
    if (query.type === 'tv') return searchTv(q);
    if (query.type === 'music') return searchMusic(q, query.all === '1');
    if (query.type === 'book') { const r = await AU.searchBooks(q); return { ...r, books: await bookCards(r.books) }; }
    throw new HttpError(400, 'Pick a category first.');
  }
  if (method === 'GET' && (m = path.match(/^\/api\/collection\/(\d+)$/))) return collectionView(m[1]);
  if (method === 'GET' && (m = path.match(/^\/api\/tv\/(\d+)$/))) return tvView(m[1], me.name);
  if (method === 'GET' && (m = path.match(/^\/api\/artist\/([\w-]+)$/))) return artistView(m[1], query.all === '1');
  if (method === 'GET' && (m = path.match(/^\/api\/series\/(\w+)$/))) { const s = await AU.seriesBooks(m[1]); const books = await bookCards(s.books); return { ...s, books, total: books.length, onServer: books.filter((b) => b.onServer).length }; }
  if (method === 'GET' && (m = path.match(/^\/api\/author\/(.+)$/))) { const a = await AU.authorBooks(decodeURIComponent(m[1])); const books = await bookCards(a.books); return { ...a, books, total: books.length, onServer: books.filter((b) => b.onServer).length }; }

  if (method === 'POST' && path === '/api/requests') {
    const items = Array.isArray(body?.items) ? body.items.slice(0, 200) : [];
    if (!items.length) throw new HttpError(400, 'Nothing to request.');
    const note = String(body.note || '').slice(0, 500);
    const out = [];
    for (const x of items) {
      const item = await itemFor(x);
      if (await alreadyThere(item)) { out.push({ title: item.title, skipped: 'on the server' }); continue; }
      const res = db.addRequest(item, me.name, note);
      if (item.type === 'tv' && item.follow) {
        const d = await T.tvDetails(item.extId);
        db.addFollow(item.extId, item.title, item.poster, me.name, (d.seasons || []).map((s) => s.season_number));
      }
      if (res.created) handoff.newRequest(res.request, me.name);
      else if (res.joined || res.partsChanged) handoff.joinedRequest(res.request, me.name);
      out.push({ id: res.request.id, title: item.title, status: res.request.status, joined: !res.created });
    }
    return { results: out };
  }
  if (method === 'GET' && path === '/api/requests') {
    if (query.scope === 'all') mustAdmin();
    const list = db.listRequests({ user: query.scope === 'all' ? null : me.name, status: query.status || null, type: query.type || null });
    const cutoff = Date.now() - 90 * 864e5;
    // People see open requests plus finished ones from the last 90 days. Only admins see who asked.
    return {
      requests: list.filter((r) => query.scope === 'all' || db.OPEN.includes(r.status) || (r.doneAt || r.updatedAt) > cutoff)
        .map((r) => (me.admin ? r : { ...r, users: r.users.filter((u) => u.toLowerCase() === me.name.toLowerCase()), others: r.users.length - 1, notes: r.notes.filter((n) => n.user.toLowerCase() === me.name.toLowerCase()) })),
      follows: db.follows().filter((f) => f.users.some((u) => u.toLowerCase() === me.name.toLowerCase())).map((f) => ({ tmdbId: f.tmdbId, title: f.title, poster: f.poster })),
    };
  }
  if (method === 'PATCH' && (m = path.match(/^\/api\/requests\/(\d+)$/))) {
    mustAdmin();
    const r = db.getRequest(Number(m[1]));
    if (!r) throw new HttpError(404, 'That request is gone.');
    const status = body?.status || r.status;
    if (!db.STATUSES.includes(status)) throw new HttpError(400, 'Unknown status.');
    const done = db.setStatus(r.id, status, body?.note !== undefined ? String(body.note).slice(0, 500) : null, null);
    handoff.statusChanged(done, me.name);
    return { request: done };
  }
  if (method === 'DELETE' && (m = path.match(/^\/api\/requests\/(\d+)$/))) {
    const r = db.getRequest(Number(m[1]));
    if (!r) return { ok: true };
    if (r.status === 'available') throw new HttpError(400, "It's already on the server.");
    const left = db.leaveRequest(r.id, me.name);
    if (r.type === 'tv' && !left) db.removeFollow(r.extId, me.name);
    return { ok: true, left };
  }
  if (method === 'POST' && (m = path.match(/^\/api\/follows\/(\d+)$/))) {
    const d = await T.tvDetails(m[1]);
    db.addFollow(m[1], d.name, T.poster(d.poster_path), me.name, (d.seasons || []).map((s) => s.season_number));
    return { ok: true };
  }
  if (method === 'DELETE' && (m = path.match(/^\/api\/follows\/(\d+)$/))) { db.removeFollow(m[1], me.name); return { ok: true }; }

  if (method === 'GET' && path === '/api/notices') return { notices: db.noticesFor(me.name) };
  if (method === 'POST' && path === '/api/notices/seen') { db.markSeen(me.name, body?.ids || null); return { ok: true }; }

  throw new HttpError(404, 'Not found.');
}
