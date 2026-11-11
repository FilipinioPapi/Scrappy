// Settings an admin can change from Scrappy's Settings page. They're kept in the database,
// so nobody has to edit the Docker settings. The Docker values are the starting point,
// and the admins named in ADMINS always stay admins (so nobody can lock themselves out).
import { config } from './config.js';
import { handle } from './db.js';

const DEFAULTS = () => ({
  admins: [],          // extra admins added in the app (on top of ADMINS)
  staff: [],           // can see and manage every request, can't change these settings
  region: config.region,
  hideAdult: true,
  autoAvailable: true,
  checkEvery: Math.max(2, config.checkEvery || 10),
  limit: 0,            // most open requests one person can have (0 = no limit)
  keepDays: 90,        // how long people see their finished requests
});

let cache = null, cacheDb = null;
export function settings() {
  if (cache && cacheDb === handle()) return cache;
  const out = DEFAULTS();
  try {
    for (const row of handle().prepare('SELECT key, value FROM settings').all()) {
      if (row.key in out) { try { out[row.key] = JSON.parse(row.value); } catch {} }
    }
  } catch {}
  cacheDb = handle();
  return (cache = out);
}

const names = (v) => [...new Set((Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter(Boolean))].slice(0, 50);
const REGION = /^[A-Z]{2}$/;
const CHECKS = [5, 10, 30];

/** Change some settings. Returns the full set. Throws Error(message) for a bad value. */
export function changeSettings(patch = {}) {
  const cur = settings(), next = { ...cur };
  if ('admins' in patch) next.admins = names(patch.admins);
  if ('staff' in patch) next.staff = names(patch.staff);
  if ('region' in patch) { const r = String(patch.region || '').toUpperCase(); if (!REGION.test(r)) throw new Error('Pick a country.'); next.region = r; }
  if ('hideAdult' in patch) next.hideAdult = !!patch.hideAdult;
  if ('autoAvailable' in patch) next.autoAvailable = !!patch.autoAvailable;
  if ('checkEvery' in patch) { const n = Number(patch.checkEvery); if (!CHECKS.includes(n)) throw new Error('Pick 5, 10 or 30 minutes.'); next.checkEvery = n; }
  if ('limit' in patch) { const n = Math.floor(Number(patch.limit)); if (!(n >= 0 && n <= 1000)) throw new Error('Pick a limit.'); next.limit = n; }
  if ('keepDays' in patch) { const n = Math.floor(Number(patch.keepDays)); if (!(n >= 7 && n <= 3650)) throw new Error('Pick how long to keep them.'); next.keepDays = n; }
  const put = handle().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const k of Object.keys(next)) if (JSON.stringify(next[k]) !== JSON.stringify(cur[k])) put.run(k, JSON.stringify(next[k]));
  cache = next; cacheDb = handle();
  return next;
}

const has = (list, name) => list.some((x) => x.toLowerCase() === String(name || '').toLowerCase());
export const isAdmin = (name) => config.admins.includes(String(name || '').toLowerCase()) || has(settings().admins, name);
export const isStaff = (name) => has(settings().staff, name);
export const region = () => settings().region || config.region;
