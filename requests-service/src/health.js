// "Server health" on Scrappy's Settings page (admins only): is each server answering, how fast,
// and who's using Scrappy. Everything comes from what the servers already know (Emby's own
// device and session lists), so there's no extra tracking.
import { config } from './config.js';
import { getJson } from './util.js';
import { countOpen } from './db.js';

export const VERSION = '1.1.0';

async function timed(fn) {
  const t = Date.now();
  try { const v = await fn(); return { ok: true, ms: Date.now() - t, v }; }
  catch (e) { return { ok: false, ms: Date.now() - t, error: e.message }; }
}
const embyGet = (path) => getJson(config.emby.url + path, { headers: { 'X-Emby-Token': config.emby.apiKey, accept: 'application/json' }, timeout: 8000 });
const absGet = (path) => getJson(config.abs.url + path, { headers: { authorization: 'Bearer ' + config.abs.token, accept: 'application/json' }, timeout: 8000 });

/** Compare "0.2.140"-style versions. */
const newer = (a, b) => {
  const x = String(a || '').split('.').map(Number), y = String(b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
};

/** latest: the newest Scrappy version the asking app knows of (its own, or a found update). */
export async function health(latest = '') {
  const out = { service: { version: VERSION, tmdb: !!config.tmdbKey }, servers: [], people: null };
  const emby = config.emby.url && config.emby.apiKey
    ? await timed(async () => {
      const [info, sessions] = await Promise.all([embyGet('/System/Info'), embyGet('/Sessions?ActiveWithinSeconds=600').catch(() => [])]);
      let reporting = false;
      try { const plugins = await embyGet('/Plugins'); reporting = (plugins || []).some((p) => /playback reporting/i.test(p.Name || '')); } catch {}
      return { version: info?.Version || '', watching: (sessions || []).filter((s) => s.NowPlayingItem).length, reporting };
    })
    : null;
  out.servers.push({ key: 'emby', name: 'Emby', set: !!emby, ...(emby || {}) });

  const nd = config.navidrome.url ? await timed(async () => {
    const u = new URL(`${config.navidrome.url}/rest/ping`);
    for (const [k, v] of Object.entries({ u: config.navidrome.user, p: 'enc:' + Buffer.from(config.navidrome.pass).toString('hex'), v: '1.16.1', c: 'ScrappyRequests', f: 'json' })) u.searchParams.set(k, v);
    const r = (await getJson(u.toString(), { timeout: 8000 }))?.['subsonic-response'];
    if (r?.status !== 'ok') throw new Error(r?.error?.message || 'Navidrome said no');
    return { version: r.serverVersion || '' };
  }) : null;
  out.servers.push({ key: 'navidrome', name: 'Navidrome', set: !!nd, ...(nd || {}) });

  const abs = config.abs.url && config.abs.token ? await timed(async () => {
    await absGet('/api/libraries');
    const st = await getJson(config.abs.url + '/status', { timeout: 8000 }).catch(() => null);
    return { version: st?.serverVersion || '' };
  }) : null;
  // Audiobookshelf 2.26+ turned off old login tokens: it wants an API key instead.
  if (abs && !abs.ok && /401/.test(abs.error || '')) abs.error = 'Audiobookshelf turned down the key. Make an API key in Audiobookshelf (Settings, API Keys) and put it in ABS_TOKEN.';
  out.servers.push({ key: 'audiobookshelf', name: 'Audiobookshelf', set: !!abs, ...(abs || {}) });

  // Who's using Scrappy: Emby's device list, Scrappy devices active in the last week.
  if (emby?.ok) {
    try {
      const d = await embyGet('/Devices');
      const week = Date.now() - 7 * 864e5;
      const mine = (d?.Items || []).filter((x) => /scrappy/i.test(x.AppName || '') && Date.parse(x.DateLastActivity || 0) > week);
      const top = [latest, ...mine.map((x) => x.AppVersion)].reduce((a, b) => (newer(b, a) ? b : a), '');
      out.people = {
        active: new Set(mine.map((x) => (x.LastUserName || x.Name || '').toLowerCase())).size,
        devices: mine.length,
        newest: top,
        old: mine.filter((x) => top && newer(top, x.AppVersion)).length,
      };
    } catch {}
  }
  try { out.openRequests = countOpen(); } catch {}
  return out;
}
