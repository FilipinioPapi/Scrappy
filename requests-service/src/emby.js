// What's already on Emby, matched by TMDB number (Emby stores it for each film and show).
import { config } from './config.js';
import { getJson, norm, keeper } from './util.js';

const on = () => !!(config.emby.url && config.emby.apiKey);
const get = (path) => getJson(config.emby.url + path, { headers: { 'X-Emby-Token': config.emby.apiKey, accept: 'application/json' }, timeout: 60000 });

let index = { movies: new Map(), shows: new Map(), byName: new Map(), at: 0 };

/** Re-read every film and show (ids only, so it's quick even for big libraries). */
async function refreshEmbyNow() {
  if (!on()) return index;
  const movies = new Map(), shows = new Map(), byName = new Map();
  let start = 0;
  for (;;) {
    const r = await get(`/Items?Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds,ProductionYear&EnableImages=false&StartIndex=${start}&Limit=2000`);
    for (const it of r.Items || []) {
      const ids = Object.fromEntries(Object.entries(it.ProviderIds || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
      const entry = { id: it.Id, name: it.Name, year: it.ProductionYear };
      const map = it.Type === 'Movie' ? movies : shows;
      if (ids.tmdb) map.set(ids.tmdb, entry);
      byName.set(`${it.Type}:${norm(it.Name)}:${it.ProductionYear || ''}`, entry);
    }
    start += (r.Items || []).length;
    if (!r.Items?.length || start >= (r.TotalRecordCount || 0)) break;
  }
  index = { movies, shows, byName, at: Date.now() };
  return index;
}
const K = keeper(refreshEmbyNow, () => index, 'Emby');
export const refreshEmby = () => K.refresh();
export const embyIndex = () => K.get();
export const embyOn = on;

/** Film on the server? Matches by TMDB number, then by name + year. */
export async function findMovie(tmdbId, title, year) {
  const ix = await embyIndex();
  return ix.movies.get(String(tmdbId)) || (title ? ix.byName.get(`Movie:${norm(title)}:${year || ''}`) : null) || null;
}
export async function findShow(tmdbId, title, year) {
  const ix = await embyIndex();
  return ix.shows.get(String(tmdbId)) || (title ? ix.byName.get(`Series:${norm(title)}:${year || ''}`) : null) || null;
}

/** Set of "season:episode" on the server for a show (handles files that hold two episodes). */
export async function showEpisodes(embyId) {
  const r = await get(`/Shows/${embyId}/Episodes?Fields=ParentIndexNumber,IndexNumber,IndexNumberEnd&EnableImages=false&Limit=5000`).catch(() =>
    get(`/Items?ParentId=${embyId}&Recursive=true&IncludeItemTypes=Episode&Fields=ParentIndexNumber,IndexNumber,IndexNumberEnd&EnableImages=false&Limit=5000`));
  const set = new Set();
  for (const e of r.Items || []) {
    if (e.LocationType === 'Virtual') continue; // Emby's placeholders for missing episodes
    const s = e.ParentIndexNumber ?? 1, a = e.IndexNumber, b = e.IndexNumberEnd ?? a;
    if (a == null) continue;
    for (let n = a; n <= b; n++) set.add(`${s}:${n}`);
  }
  return set;
}
