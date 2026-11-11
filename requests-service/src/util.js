// Small helpers shared by the rest of the service.
export const now = () => Date.now();
export const today = () => new Date().toISOString().slice(0, 10);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Loose name for matching titles across services: "The Bends (Deluxe Edition)" -> "bends". */
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\s*[([].*?(edition|remaster|deluxe|version|expanded|anniversary|unabridged|abridged|explicit|bonus).*?[)\]]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an) /, '')
    .trim();
}

/** Small time-based cache. */
export function cache(ttlMs, max = 500) {
  const m = new Map();
  return {
    get(k) { const e = m.get(k); if (!e) return undefined; if (Date.now() > e.t) { m.delete(k); return undefined; } return e.v; },
    set(k, v) { if (m.size >= max) m.delete(m.keys().next().value); m.set(k, { v, t: Date.now() + ttlMs }); return v; },
    async wrap(k, fn) { const hit = this.get(k); if (hit !== undefined) return hit; return this.set(k, await fn()); },
  };
}

/** fetch JSON with a timeout; throws Error(message) on failure. */
export async function getJson(u, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeout || 15000);
  try {
    const r = await fetch(u, { ...opts, signal: ctl.signal });
    if (!r.ok) { const e = new Error(`${new URL(u).host} answered ${r.status}`); e.status = r.status; throw e; }
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  } finally { clearTimeout(t); }
}
