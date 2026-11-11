// What's already on Navidrome, matched by artist + album name (and song title for songs).
import { createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { getJson, norm, keeper } from './util.js';

const on = () => !!(config.navidrome.url && config.navidrome.user && config.navidrome.pass);
function nd(endpoint, params = {}) {
  const salt = randomBytes(6).toString('hex');
  const token = createHash('md5').update(config.navidrome.pass + salt).digest('hex');
  const u = new URL(`${config.navidrome.url}/rest/${endpoint}`);
  for (const [k, v] of Object.entries({ u: config.navidrome.user, t: token, s: salt, v: '1.16.1', c: 'ScrappyRequests', f: 'json', ...params })) u.searchParams.set(k, v);
  return getJson(u.toString(), { timeout: 60000 }).then((r) => {
    const sr = r['subsonic-response'];
    if (sr?.status !== 'ok') throw new Error('Navidrome: ' + (sr?.error?.message || 'error'));
    return sr;
  });
}

let index = { albums: new Map(), byArtist: new Map(), at: 0 };
async function refreshNavidromeNow() {
  if (!on()) return index;
  const albums = new Map(), byArtist = new Map();
  for (let offset = 0; offset < 200000; offset += 500) {
    const r = await nd('getAlbumList2', { type: 'alphabeticalByName', size: 500, offset });
    const list = r.albumList2?.album || [];
    for (const a of list) {
      const art = norm(a.artist), key = `${art}|${norm(a.name)}`;
      albums.set(key, { id: a.id, name: a.name, artist: a.artist, mbid: a.musicBrainzId || '' });
      if (a.musicBrainzId) albums.set('mbid:' + a.musicBrainzId, albums.get(key));
      if (!byArtist.has(art)) byArtist.set(art, []);
      byArtist.get(art).push(albums.get(key));
    }
    if (list.length < 500) break;
  }
  index = { albums, byArtist, at: Date.now() };
  return index;
}
const K = keeper(refreshNavidromeNow, () => index, 'Navidrome');
export const refreshNavidrome = () => K.refresh();
const ix = () => K.get();
export const navidromeOn = on;

/** Album on the server? Artist names are matched loosely ("Beyoncé" = "Beyonce", "The" ignored). */
export async function findAlbum(artist, title) {
  const i = await ix();
  const a = norm(artist), t = norm(title);
  const hit = i.albums.get(`${a}|${t}`);
  if (hit) return hit;
  // Album credited to several artists: accept when the first one matches.
  for (const [k, v] of i.albums) if (!k.startsWith('mbid:') && k.endsWith('|' + t) && (k.startsWith(a) || a.startsWith(k.split('|')[0]))) return v;
  return null;
}
export async function artistAlbumCount(artist) { return ((await ix()).byArtist.get(norm(artist)) || []).length; }

/** Song on the server? Searches Navidrome for the title and checks the artist. */
export async function findSong(artist, title) {
  if (!on()) return null;
  const r = await nd('search3', { query: title, songCount: 20, albumCount: 0, artistCount: 0 }).catch(() => null);
  const t = norm(title), a = norm(artist);
  const s = (r?.searchResult3?.song || []).find((x) => norm(x.title) === t && (norm(x.artist).startsWith(a) || a.startsWith(norm(x.artist))));
  return s ? { id: s.id, albumId: s.albumId } : null;
}
