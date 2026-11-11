// The request list lives in one SQLite file (DATA_DIR/requests.db).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { now } from './util.js';

export const OPEN = ['requested', 'progress'];
export const STATUSES = ['requested', 'progress', 'available', 'cantfind'];

let db;
export function openDb(file) {
  if (!file) { mkdirSync(config.dataDir, { recursive: true }); file = join(config.dataDir, 'requests.db'); }
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,              -- movie | tv | album | song | book
      ext_id TEXT NOT NULL,            -- TMDB / MusicBrainz / Audible (or Open Library) id
      source TEXT NOT NULL DEFAULT '', -- tmdb | musicbrainz | audible | openlibrary
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      year TEXT NOT NULL DEFAULT '',
      poster TEXT NOT NULL DEFAULT '',
      info TEXT NOT NULL DEFAULT '{}', -- extra details (artist, album, author, series...)
      parts TEXT NOT NULL DEFAULT '{}',-- TV: {"seasons":[4,5],"episodes":{"2":[8,9]}}
      release TEXT NOT NULL DEFAULT '',-- e.g. "In cinemas 18 Dec" when requested
      status TEXT NOT NULL DEFAULT 'requested',
      admin_note TEXT NOT NULL DEFAULT '',
      lib_ref TEXT NOT NULL DEFAULT '',-- library id once it's on the server
      follow INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      done_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS req_item ON requests(type, ext_id);
    CREATE TABLE IF NOT EXISTS requesters (
      request_id INTEGER NOT NULL,
      user TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (request_id, user)
    );
    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT NOT NULL,
      request_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      seen_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS follows (
      tmdb_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      poster TEXT NOT NULL DEFAULT '',
      users TEXT NOT NULL DEFAULT '[]',
      seen TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

const j = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
function shape(r) {
  if (!r) return null;
  const users = db.prepare('SELECT user, note, created_at FROM requesters WHERE request_id = ? ORDER BY created_at, rowid').all(r.id);
  return {
    id: r.id, type: r.type, extId: r.ext_id, source: r.source, title: r.title, subtitle: r.subtitle, year: r.year, poster: r.poster,
    info: j(r.info, {}), parts: j(r.parts, {}), release: r.release, status: r.status, adminNote: r.admin_note, libRef: r.lib_ref,
    follow: !!r.follow, createdAt: r.created_at, updatedAt: r.updated_at, doneAt: r.done_at,
    users: users.map((u) => u.user), notes: users.filter((u) => u.note).map((u) => ({ user: u.user, note: u.note })),
  };
}

export const getRequest = (id) => shape(db.prepare('SELECT * FROM requests WHERE id = ?').get(id));
export function openFor(type, extId) {
  return shape(db.prepare(`SELECT * FROM requests WHERE type = ? AND ext_id = ? AND status IN ('requested','progress') ORDER BY id DESC LIMIT 1`).get(type, String(extId)));
}
/** Latest request of any status for each of these items: Map "type:extId" -> request. */
export function latestFor(type, extIds) {
  const out = new Map();
  if (!extIds.length) return out;
  const rows = db.prepare(`SELECT * FROM requests WHERE type = ? AND ext_id IN (${extIds.map(() => '?').join(',')}) ORDER BY id`).all(type, ...extIds.map(String));
  for (const r of rows) {
    const prev = out.get(r.ext_id);
    // An open request wins over an older finished one.
    if (!prev || OPEN.includes(r.status) || !OPEN.includes(prev.status)) out.set(r.ext_id, r);
  }
  const who = (id) => db.prepare('SELECT lower(user) AS u FROM requesters WHERE request_id = ?').all(id).map((x) => x.u);
  return new Map([...out].map(([k, r]) => [k, { id: r.id, status: r.status, parts: j(r.parts, {}), users: who(r.id) }]));
}

const union = (a = [], b = []) => [...new Set([...a, ...b])].sort((x, y) => x - y);
export function mergeParts(a = {}, b = {}) {
  const seasons = union(a.seasons, b.seasons);
  const episodes = {};
  for (const src of [a.episodes || {}, b.episodes || {}]) for (const [s, eps] of Object.entries(src)) episodes[s] = union(episodes[s], eps);
  // A whole season covers its single episodes.
  for (const s of seasons) delete episodes[s];
  const out = {};
  if (a.whole || b.whole) out.whole = true;
  if (seasons.length) out.seasons = seasons;
  if (Object.keys(episodes).length) out.episodes = episodes;
  return out;
}

/** Add a request, or join an open one for the same item. Returns { request, created }. */
export function addRequest(item, user, note = '') {
  const t = now();
  const open = openFor(item.type, item.extId);
  if (open) {
    const parts = item.type === 'tv' ? mergeParts(open.parts, item.parts) : open.parts;
    db.prepare('UPDATE requests SET parts = ?, follow = MAX(follow, ?), updated_at = ? WHERE id = ?').run(JSON.stringify(parts), item.follow ? 1 : 0, t, open.id);
    const joined = db.prepare('INSERT OR IGNORE INTO requesters (request_id, user, note, created_at) VALUES (?, ?, ?, ?)').run(open.id, user, note, t).changes > 0;
    if (!joined && note) db.prepare('UPDATE requesters SET note = ? WHERE request_id = ? AND user = ?').run(note, open.id, user);
    return { request: getRequest(open.id), created: false, joined, partsChanged: JSON.stringify(parts) !== JSON.stringify(open.parts) };
  }
  const r = db.prepare(`INSERT INTO requests (type, ext_id, source, title, subtitle, year, poster, info, parts, release, follow, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    item.type, String(item.extId), item.source || '', item.title, item.subtitle || '', String(item.year || ''), item.poster || '',
    JSON.stringify(item.info || {}), JSON.stringify(item.parts || {}), item.release || '', item.follow ? 1 : 0, t, t);
  const id = Number(r.lastInsertRowid);
  db.prepare('INSERT INTO requesters (request_id, user, note, created_at) VALUES (?, ?, ?, ?)').run(id, user, note, t);
  return { request: getRequest(id), created: true, joined: true };
}

export function listRequests({ user, status, type } = {}) {
  const where = [], args = [];
  if (user) { where.push('id IN (SELECT request_id FROM requesters WHERE lower(user) = lower(?))'); args.push(user); }
  if (status === 'open') where.push(`status IN ('requested','progress')`);
  else if (status) { where.push('status = ?'); args.push(status); }
  if (type) { where.push('type = ?'); args.push(type); }
  const rows = db.prepare(`SELECT * FROM requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (status IN ('requested','progress')) DESC, updated_at DESC LIMIT 1000`).all(...args);
  return rows.map(shape);
}
export const openRequests = () => db.prepare(`SELECT * FROM requests WHERE status IN ('requested','progress')`).all().map(shape);

export function setStatus(id, status, note, libRef) {
  const t = now();
  const done = status === 'available' || status === 'cantfind' ? t : null;
  db.prepare('UPDATE requests SET status = ?, admin_note = COALESCE(?, admin_note), lib_ref = COALESCE(?, lib_ref), updated_at = ?, done_at = ? WHERE id = ?')
    .run(status, note ?? null, libRef ?? null, t, done, id);
  const r = getRequest(id);
  if (done) for (const u of r.users) db.prepare('INSERT INTO notices (user, request_id, created_at) VALUES (?, ?, ?)').run(u, id, t);
  return r;
}

/** Someone takes their name off a request. The request goes away when nobody's left. */
export function leaveRequest(id, user) {
  db.prepare('DELETE FROM requesters WHERE request_id = ? AND lower(user) = lower(?)').run(id, user);
  const left = db.prepare('SELECT COUNT(*) AS n FROM requesters WHERE request_id = ?').get(id).n;
  if (!left) { db.prepare('DELETE FROM requests WHERE id = ?').run(id); db.prepare('DELETE FROM notices WHERE request_id = ?').run(id); }
  return left;
}

export function noticesFor(user) {
  const rows = db.prepare('SELECT * FROM notices WHERE lower(user) = lower(?) AND seen_at IS NULL ORDER BY created_at DESC LIMIT 20').all(user);
  return rows.map((n) => ({ id: n.id, createdAt: n.created_at, request: getRequest(n.request_id) })).filter((n) => n.request);
}
export function markSeen(user, ids) {
  const t = now();
  if (ids?.length) for (const id of ids) db.prepare('UPDATE notices SET seen_at = ? WHERE id = ? AND lower(user) = lower(?)').run(t, id, user);
  else db.prepare('UPDATE notices SET seen_at = ? WHERE lower(user) = lower(?) AND seen_at IS NULL').run(t, user);
}

// "Request new seasons too"
export function addFollow(tmdbId, title, poster, user, seen) {
  const f = db.prepare('SELECT * FROM follows WHERE tmdb_id = ?').get(String(tmdbId));
  if (f) {
    const users = [...new Set([...j(f.users, []), user])];
    db.prepare('UPDATE follows SET users = ? WHERE tmdb_id = ?').run(JSON.stringify(users), String(tmdbId));
  } else {
    db.prepare('INSERT INTO follows (tmdb_id, title, poster, users, seen, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(String(tmdbId), title, poster, JSON.stringify([user]), JSON.stringify(seen), now());
  }
}
export function removeFollow(tmdbId, user) {
  const f = db.prepare('SELECT * FROM follows WHERE tmdb_id = ?').get(String(tmdbId));
  if (!f) return;
  const users = j(f.users, []).filter((u) => u.toLowerCase() !== user.toLowerCase());
  if (users.length) db.prepare('UPDATE follows SET users = ? WHERE tmdb_id = ?').run(JSON.stringify(users), String(tmdbId));
  else db.prepare('DELETE FROM follows WHERE tmdb_id = ?').run(String(tmdbId));
}
export const follows = () => db.prepare('SELECT * FROM follows').all().map((f) => ({ tmdbId: f.tmdb_id, title: f.title, poster: f.poster, users: j(f.users, []), seen: j(f.seen, []) }));
export const isFollowing = (tmdbId, user) => follows().some((f) => f.tmdbId === String(tmdbId) && f.users.some((u) => u.toLowerCase() === user.toLowerCase()));
export const setFollowSeen = (tmdbId, seen) => db.prepare('UPDATE follows SET seen = ? WHERE tmdb_id = ?').run(JSON.stringify(seen), String(tmdbId));
