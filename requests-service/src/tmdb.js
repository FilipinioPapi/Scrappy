// Films and TV from TMDB (titles, posters, dates, seasons and episodes).
import { config } from './config.js';
import { cache, getJson, today } from './util.js';
import { settings, region as country } from './settings.js';

const IMG = 'https://image.tmdb.org/t/p/';
export const poster = (p, size = 'w342') => (p ? IMG + size + p : '');
const c = cache(6 * 3600 * 1000, 2000);

export async function tmdb(path, params = {}) {
  if (!config.tmdbKey) throw new Error('TMDB_API_KEY is not set on the request service.');
  const u = new URL('https://api.themoviedb.org/3' + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  // A short key is the old "API key"; a long one is the "read access token".
  const headers = { accept: 'application/json' };
  if (config.tmdbKey.length > 40) headers.authorization = 'Bearer ' + config.tmdbKey; else u.searchParams.set('api_key', config.tmdbKey);
  return c.wrap(u.toString(), () => getJson(u.toString(), { headers }));
}

const fmtDay = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtFull = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/**
 * Where a film is in its release, from TMDB's dates for our country.
 * { out: bool, label: '' | 'In cinemas now · digital Feb 3' | 'In cinemas Dec 18' | 'Coming soon', long }
 */
export function releaseInfo(movie) {
  const t = today();
  const region = (movie.release_dates?.results || []).find((r) => r.iso_3166_1 === country());
  const dates = (region?.release_dates || []).map((d) => ({ type: d.type, date: (d.release_date || '').slice(0, 10) })).filter((d) => d.date);
  const first = (types) => dates.filter((d) => types.includes(d.type)).map((d) => d.date).sort()[0];
  const cinema = first([2, 3]), digital = first([4]), physical = first([5]), tv = first([6]);
  const homeDate = [digital, physical, tv].filter(Boolean).sort()[0];
  if (homeDate && homeDate <= t) return { out: true, label: '', long: '' };
  if (cinema && cinema <= t) {
    return homeDate
      ? { out: false, label: `In cinemas · digital ${fmtDay(homeDate)}`, long: `In cinemas now, digital release ${fmtFull(homeDate)}.` }
      : { out: false, label: 'In cinemas now', long: 'In cinemas now. Digital release date not announced yet.' };
  }
  if (cinema) return { out: false, label: `In cinemas ${fmtDay(cinema)}`, long: `In cinemas ${fmtFull(cinema)}. Digital release date not announced yet.` };
  if (homeDate) return { out: false, label: `Out ${fmtDay(homeDate)}`, long: `Coming out ${fmtFull(homeDate)}.` };
  // No dates for our country: fall back to TMDB's general status and date.
  const rd = movie.release_date || '';
  if (movie.status === 'Released' && rd && rd <= t) {
    // Released somewhere; assume it's out unless it's very recent.
    const ageDays = (Date.now() - Date.parse(rd)) / 864e5;
    return ageDays > 120 ? { out: true, label: '', long: '' } : { out: false, label: 'Recently released', long: 'Recently released; it may not be out digitally yet.' };
  }
  return { out: false, label: rd ? `Coming ${fmtDay(rd)}` : 'Coming soon', long: rd ? `Expected ${fmtFull(rd)}.` : 'Coming soon. No release date yet.' };
}

export const movieDetails = (id) => tmdb(`/movie/${id}`, { append_to_response: 'release_dates' });
export const tvDetails = (id) => tmdb(`/tv/${id}`, { append_to_response: 'external_ids' });
export const seasonDetails = (id, n) => tmdb(`/tv/${id}/season/${n}`);
export const collection = (id) => tmdb(`/collection/${id}`);
const adult = () => (settings().hideAdult ? 'false' : 'true');
export const searchMovies = (q) => tmdb('/search/movie', { query: q, include_adult: adult(), region: country() });
export const searchTv = (q) => tmdb('/search/tv', { query: q, include_adult: adult() });

/** Episodes that have aired (by our clock) in a TMDB season. */
export const airedEpisodes = (season) => (season.episodes || []).filter((e) => e.air_date && e.air_date <= today()).map((e) => e.episode_number);
