// The hand-off step: where new requests and status changes are sent.
// Today that's an optional webhook (the Discord bot will listen here later).
// Sonarr / Radarr / Lidarr can plug in here without changing the app.
import { config } from './config.js';

async function send(event, payload) {
  if (!config.handoffUrl) return;
  try {
    await fetch(config.handoffUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-scrappy-secret': config.handoffSecret },
      body: JSON.stringify({ event, ...payload }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) { console.warn('Hand-off failed:', e.message); }
}

/** Plain sentence for a request, e.g. "Sarah requested Song X by Artist Y, from the album Z". */
export function describe(r, who = r.users.join(', ')) {
  const i = r.info || {};
  if (r.type === 'song') return `${who} requested ${r.title} by ${i.artist}${i.album ? `, from the album ${i.album}` : ''}`;
  if (r.type === 'album') return `${who} requested the album ${r.title} by ${i.artist}`;
  if (r.type === 'book') return `${who} requested the audiobook ${r.title}${i.author ? ` by ${i.author}` : ''}`;
  if (r.type === 'tv') return `${who} requested ${r.title}: ${partsText(r.parts)}`;
  return `${who} requested the movie ${r.title}${r.year ? ` (${r.year})` : ''}`;
}
export function partsText(p = {}) {
  const bits = [];
  if (p.whole) return 'the whole show';
  if (p.seasons?.length) bits.push(p.seasons.length === 1 ? `Season ${p.seasons[0]}` : `Seasons ${p.seasons.slice(0, -1).join(', ')} and ${p.seasons.at(-1)}`);
  for (const [s, eps] of Object.entries(p.episodes || {})) bits.push(`Season ${s} episode${eps.length > 1 ? 's' : ''} ${eps.length > 1 ? eps.slice(0, -1).join(', ') + ' and ' + eps.at(-1) : eps[0]}`);
  return bits.join('; ') || 'the whole show';
}

export const newRequest = (r, user) => send('request.created', { request: r, by: user, text: describe(r, user) });
export const joinedRequest = (r, user) => send('request.joined', { request: r, by: user, text: describe(r, user) });
export const statusChanged = (r, by) => send('request.status', { request: r, by });
