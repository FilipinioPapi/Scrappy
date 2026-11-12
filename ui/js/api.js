// Thin layer over the Rust side. All server talk happens in Rust.
const { invoke } = window.__TAURI__.core;
export const { listen } = window.__TAURI__.event;

// Smart home rows saved for the signed-in person; a sign-out wipes them so the next person never sees them.
function clearRowCache() { try { Object.keys(localStorage).filter((k) => k.startsWith('hr:')).forEach((k) => localStorage.removeItem(k)); } catch {} window.dispatchEvent(new Event('scrappy:rowcache-clear')); }

// Google TV: answers already fetched in this run are kept in memory, so going Back to a page
// (or opening one that was warmed up while you rested on its poster) draws at once with no
// trip to the disk or the server. Anything that changes data (watching, favorites, edits) empties it.
const TV = /Android/.test(navigator.userAgent);
const MEM = new Map(); // path -> { v, t }
const FRESH = 45000;   // an answer this young is shown as it is, without asking the server again
// What kind of thing each id is (movie, show...), learned from every list that passes through,
// so a show's page can ask for its seasons at the same moment as the show itself.
const KIND = new Map();
export const kindOf = (id) => KIND.get(id);
const memPut = (path, v) => { if (!TV || v == null) return;
  if (Array.isArray(v.Items)) { if (KIND.size > 6000) KIND.clear(); for (const x of v.Items) if (x?.Id && x.Type) KIND.set(x.Id, x.Type); } if (MEM.size > 500) MEM.delete(MEM.keys().next().value); MEM.set(path, { v, t: Date.now() }); };
export const memClear = () => MEM.clear();
export const memHas = (path) => MEM.has(path);
if (TV) {
  ['player-closed', 'player-ended'].forEach((n) => window.__TAURI__.event.listen(n, memClear));
  window.addEventListener('scrappy:rowcache-clear', memClear);
  window.addEventListener('scrappy:art-clear', memClear);
}
const INFLIGHT = new Map();

export const api = {
  session: () => invoke('get_session'),
  login: (server, username, password) => invoke('login', { server, username, password }),
  logout: () => { clearRowCache(); return invoke('logout'); },
  serverCheck: (kind, address) => invoke('server_check', { kind, address }),
  serverLogin: (kind, address, username, password) => invoke('server_login', { kind, address, username, password }),
  serverLogout: (kind) => { clearRowCache(); return invoke('server_logout', { kind }); },
  nd: (endpoint, query = '') => invoke('nd_get', { endpoint, query }),
  ndCached: (endpoint, query = '') => invoke('nd_cached', { endpoint, query }),
  abs: (path) => invoke('abs_get', { path }),
  ndPlaylistImage: (id, bytes, name) => invoke('nd_playlist_image', { id, bytes, name }),
  ndReauth: (password) => invoke('nd_reauth', { password }),
  lyricsFind: (artist, title, album, duration) => invoke('lyrics_find', { artist, title, album, duration }),
  absCached: (path) => invoke('abs_cached', { path }),
  get: (path) => {
    if (!TV) return invoke('api_get', { path });
    // Two parts of a page asking for the same thing at once share one request.
    const m = MEM.get(path);
    if (m && Date.now() - m.t < FRESH) return Promise.resolve(m.v);
    if (INFLIGHT.has(path)) return INFLIGHT.get(path);
    const p = invoke('api_get', { path }).then((v) => { memPut(path, v); return v; }).finally(() => INFLIGHT.delete(path));
    INFLIGHT.set(path, p);
    return p;
  },
  cached: (path) => { const m = TV && MEM.get(path); return m ? Promise.resolve(m.v) : invoke('api_cached', { path }); },
  post: (path, body = null) => { memClear(); return invoke('api_send', { method: 'POST', path, body }); },
  del: (path) => { memClear(); return invoke('api_send', { method: 'DELETE', path, body: null }); },
  uploadImage: (path, base64, contentType) => invoke('api_upload_image', { path, base64, contentType }),
  play: (itemId, o = {}) => invoke('play', { itemId, fromStart: !!o.fromStart, embedded: o.embedded ?? true, startSecs: o.startSecs ?? null, maxBitrate: o.maxBitrate ?? null }),
  clearCache: () => { window.dispatchEvent(new Event('scrappy:art-clear')); return invoke('clear_cache'); },
  refreshCovers: (kind) => invoke('refresh_covers', { kind }),
  absSend: (method, path, body = null) => invoke('abs_send', { method, path, body }),
};

// Show the saved copy instantly (if any), then refresh from the server and
// re-render only if something changed. `render(data, fromCache)`.
export async function load(path, render, isAlive = () => true) {
  const m = TV && MEM.get(path);
  if (m && Date.now() - m.t < FRESH) { if (isAlive()) render(m.v, true); return; }
  const cached = await api.cached(path);
  let shown = null;
  if (cached) {
    shown = JSON.stringify(cached);
    if (isAlive()) render(cached, true);
  }
  try {
    const fresh = await api.get(path);
    if (isAlive() && JSON.stringify(fresh) !== shown) {
      // Swapping in fresher data for what's already on screen: don't replay entrance animations.
      if (shown) quiet();
      render(fresh, false);
    }
  } catch (e) {
    if (!cached) throw e;
  }
}

// Turns off entrance animations on the current page until the next page change
// (removing it earlier would make everything replay its animation).
export function quiet() {
  document.getElementById('view')?.classList.add('quiet');
}

// Images are served by Rust from a disk cache through the img:// protocol.
// Windows and Android serve custom protocols as http://<name>.localhost.
export const IMG_BASE = /Windows|Android/.test(navigator.userAgent) ? 'http://img.localhost' : 'img://localhost';

// A TV draws the app at 1080p, so bigger pictures only cost time to download and open.
// Posters and thumbnails are drawn about two thirds the PC size, so ask for smaller files.
const fitW = (w) => (!TV ? w : w >= 1280 ? Math.min(w, 1920) : Math.ceil((w * 0.7) / 20) * 20);

export function img(itemId, type, tag, width = 400, index) {
  if (!itemId || !tag) return null;
  width = fitW(width);
  const idx = index !== undefined ? `/${index}` : '';
  return `${IMG_BASE}/${encodeURIComponent(itemId)}/${type}${idx}?tag=${encodeURIComponent(tag)}&w=${width}`;
}

// Ask for an image even when Emby didn't list one (e.g. auto-made library pictures).
export function imgAny(itemId, type, width = 400) {
  width = fitW(width);
  return `${IMG_BASE}/${encodeURIComponent(itemId)}/${type}?w=${width}`;
}
