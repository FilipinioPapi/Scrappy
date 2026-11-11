// Background work: notice when requested things arrive, and add new seasons for followed shows.
import { config } from './config.js';
import * as db from './db.js';
import * as handoff from './handoff.js';
import { findMovie, findShow, showEpisodes, refreshEmby } from './emby.js';
import { findAlbum, findSong, refreshNavidrome } from './navidrome.js';
import { findBook, refreshAbs } from './abs.js';
import { tvDetails, seasonDetails, poster, airedEpisodes } from './tmdb.js';
import { today } from './util.js';
import { settings } from './settings.js';

/** Is everything this TV request asked for on the server now? */
export async function tvDone(r) {
  const show = await findShow(r.extId, r.title, r.year);
  if (!show) return null;
  const have = await showEpisodes(show.id);
  const p = r.parts || {};
  let seasons = p.seasons || [];
  if (p.whole || (!seasons.length && !Object.keys(p.episodes || {}).length)) {
    const d = await tvDetails(r.extId);
    seasons = (d.seasons || []).filter((s) => s.season_number > 0).map((s) => s.season_number);
  }
  for (const s of seasons) {
    const sd = await seasonDetails(r.extId, s);
    const aired = airedEpisodes(sd);
    const all = (sd.episodes || []).length;
    // Wait until the season has finished airing, and every episode is there.
    if (!aired.length || aired.length < all) return null;
    if (!aired.every((n) => have.has(`${s}:${n}`))) return null;
  }
  for (const [s, eps] of Object.entries(p.episodes || {})) if (!eps.every((n) => have.has(`${s}:${n}`))) return null;
  return show.id;
}

export async function whereIs(r) {
  const i = r.info || {};
  if (r.type === 'movie') return (await findMovie(r.extId, r.title, r.year))?.id || null;
  if (r.type === 'tv') return tvDone(r);
  if (r.type === 'album') return (await findAlbum(i.artist, r.title))?.id || null;
  if (r.type === 'song') return (await findSong(i.artist, r.title))?.albumId || (i.album ? (await findAlbum(i.artist, i.album))?.id : null) || null;
  if (r.type === 'book') return (await findBook(r.source === 'audible' ? r.extId : '', r.title, i.author))?.id || null;
  return null;
}

export async function checkArrivals() {
  await Promise.allSettled([refreshEmby(), refreshNavidrome(), refreshAbs()]);
  for (const r of db.openRequests()) {
    try {
      // Settings: an admin can turn off marking requests Available by themselves.
      if (!settings().autoAvailable) break;
      const ref = await whereIs(r);
      if (ref) { const done = db.setStatus(r.id, 'available', null, String(ref)); handoff.statusChanged(done, 'auto'); }
    } catch (e) { console.warn(`Check of request ${r.id} failed:`, e.message); }
  }
}

/** "Request new seasons too": add each new season once TMDB has a date for it. */
export async function checkNewSeasons() {
  for (const f of db.follows()) {
    try {
      const d = await tvDetails(f.tmdbId);
      const fresh = (d.seasons || []).filter((s) => s.season_number > 0 && s.air_date && !f.seen.includes(s.season_number));
      for (const s of fresh) {
        for (const user of f.users) {
          const { request, created } = db.addRequest({
            type: 'tv', extId: f.tmdbId, source: 'tmdb', title: d.name, year: (d.first_air_date || '').slice(0, 4), poster: poster(d.poster_path),
            subtitle: s.air_date > today() ? `New season · starts ${s.air_date}` : 'New season', parts: { seasons: [s.season_number] }, follow: true,
          }, user, 'Added automatically: new season');
          if (created) handoff.newRequest(request, user);
        }
      }
      if (fresh.length) db.setFollowSeen(f.tmdbId, [...f.seen, ...fresh.map((s) => s.season_number)]);
    } catch (e) { console.warn(`New-season check for ${f.title} failed:`, e.message); }
  }
}

export function startJobs() {
  // How often comes from Settings each time, so a change applies without a restart.
  const again = () => setTimeout(() => checkArrivals().catch(() => {}).finally(again), Math.max(2, settings().checkEvery) * 60 * 1000);
  setTimeout(() => checkArrivals().catch(() => {}).finally(again), 20 * 1000);
  setTimeout(() => checkNewSeasons().catch(() => {}), 60 * 1000);
  setInterval(() => checkNewSeasons().catch(() => {}), 24 * 3600 * 1000);
}
