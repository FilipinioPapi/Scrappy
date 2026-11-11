// Music from MusicBrainz: artists, albums (release groups) and songs.
// MusicBrainz allows about one request a second, so calls wait their turn and are cached.
import { cache, getJson, sleep } from './util.js';

const UA = 'ScrappyRequests/1.0';
const c = cache(24 * 3600 * 1000, 3000);
let last = 0, chain = Promise.resolve();

function mb(path, params = {}) {
  const u = new URL('https://musicbrainz.org/ws/2' + path);
  for (const [k, v] of Object.entries({ ...params, fmt: 'json' })) u.searchParams.set(k, v);
  const key = u.toString();
  const hit = c.get(key);
  if (hit) return Promise.resolve(hit);
  const run = chain.then(async () => {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    for (let i = 0; i < 3; i++) {
      try { return c.set(key, await getJson(key, { headers: { 'User-Agent': UA, accept: 'application/json' } })); }
      catch (e) { if (e.status !== 503 || i === 2) throw e; await sleep(1500); last = Date.now(); }
    }
  });
  chain = run.catch(() => {});
  return run;
}

export const cover = (rgId, size = 250) => (rgId ? `https://coverartarchive.org/release-group/${rgId}/front-${size}` : '');
const credit = (ac) => (ac || []).map((a) => (a.name || a.artist?.name || '') + (a.joinphrase || '')).join('').trim();
const year = (d) => (d || '').slice(0, 4);
const esc = (s) => String(s).replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');

/** Albums & EPs by default; singles, live albums, compilations etc. only when asked. */
export function kindOf(rg) {
  const p = rg['primary-type'] || '', sec = rg['secondary-types'] || [];
  if (p === 'Album' && !sec.length) return 'album';
  if (p === 'EP' && !sec.length) return 'ep';
  if (p === 'Single' && !sec.length) return 'single';
  if (sec.includes('Live')) return 'live';
  if (sec.includes('Compilation')) return 'compilation';
  return 'other';
}
export const isMain = (rg) => ['album', 'ep'].includes(kindOf(rg));
const kindLabel = { album: 'Album', ep: 'EP', single: 'Single', live: 'Live album', compilation: 'Compilation', other: 'Other' };

const rgShape = (rg) => ({
  id: rg.id, title: rg.title, artist: credit(rg['artist-credit']), artistId: rg['artist-credit']?.[0]?.artist?.id || '',
  year: year(rg['first-release-date']), kind: kindOf(rg), kindLabel: kindLabel[kindOf(rg)], cover: cover(rg.id),
});

export async function searchMusic(q, all = false) {
  // One at a time (MusicBrainz's limit), artists first since they're what people usually mean.
  const artists = await mb('/artist', { query: q, limit: 6 });
  const groups = await mb('/release-group', { query: `releasegroup:(${esc(q)}) OR artist:(${esc(q)})`, limit: 40 });
  const recs = await mb('/recording', { query: `recording:(${esc(q)}) AND status:official`, limit: 25 });
  const seen = new Set();
  const albums = (groups['release-groups'] || [])
    .filter((rg) => all || isMain(rg))
    .filter((rg) => (rg.score ?? 100) >= 60)
    .map(rgShape)
    .filter((a) => !seen.has(a.id) && seen.add(a.id));
  const songSeen = new Set();
  const songs = (recs.recordings || []).filter((r) => (r.score ?? 100) >= 70).map((r) => {
    // "from the album": earliest official album release this song is on, else any release.
    const rels = (r.releases || []).filter((x) => x['release-group']);
    const pick = rels.find((x) => x['release-group']['primary-type'] === 'Album' && !(x['release-group']['secondary-types'] || []).length) || rels[0];
    const rg = pick?.['release-group'];
    return { id: r.id, title: r.title, artist: credit(r['artist-credit']), album: rg?.title || '', albumId: rg?.id || '', year: year(r['first-release-date']), cover: cover(rg?.id), length: r.length || 0 };
  }).filter((s) => { const k = (s.title + '|' + s.artist).toLowerCase(); return !songSeen.has(k) && songSeen.add(k); }).slice(0, 12);
  return {
    artists: (artists.artists || []).filter((a) => (a.score ?? 100) >= 70).map((a) => ({ id: a.id, name: a.name, disambiguation: a.disambiguation || '', country: a.country || '', type: a.type || '' })),
    albums: albums.slice(0, 20), songs,
  };
}

/** Every release group of an artist (we filter to albums & EPs unless asked). */
export async function artistAlbums(artistId) {
  const info = await mb(`/artist/${artistId}`);
  const out = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const r = await mb('/release-group', { artist: artistId, limit: 100, offset });
    out.push(...(r['release-groups'] || []));
    if (out.length >= (r['release-group-count'] || 0) || !(r['release-groups'] || []).length) break;
  }
  const list = out.map(rgShape).map((a) => ({ ...a, artist: a.artist || info.name })).sort((a, b) => (a.year || '9999').localeCompare(b.year || '9999'));
  return { id: info.id, name: info.name, disambiguation: info.disambiguation || '', albums: list };
}
export const releaseGroup = async (id) => rgShape(await mb(`/release-group/${id}`, { inc: 'artist-credits' }));
export async function recording(id) {
  const r = await mb(`/recording/${id}`, { inc: 'artist-credits+releases+release-groups' });
  const rels = (r.releases || []).filter((x) => x['release-group']);
  const pick = rels.find((x) => x['release-group']['primary-type'] === 'Album' && !(x['release-group']['secondary-types'] || []).length) || rels[0];
  const rg = pick?.['release-group'];
  return { id: r.id, title: r.title, artist: credit(r['artist-credit']), album: rg?.title || '', albumId: rg?.id || '', cover: cover(rg?.id), year: year(r['first-release-date']) };
}
