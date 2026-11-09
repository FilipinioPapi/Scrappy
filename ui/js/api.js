// Thin layer over the Rust side. All server talk happens in Rust.
const { invoke } = window.__TAURI__.core;
export const { listen } = window.__TAURI__.event;

export const api = {
  session: () => invoke('get_session'),
  login: (server, username, password) => invoke('login', { server, username, password }),
  logout: () => invoke('logout'),
  serverCheck: (kind, address) => invoke('server_check', { kind, address }),
  serverLogin: (kind, address, username, password) => invoke('server_login', { kind, address, username, password }),
  serverLogout: (kind) => invoke('server_logout', { kind }),
  nd: (endpoint, query = '') => invoke('nd_get', { endpoint, query }),
  ndCached: (endpoint, query = '') => invoke('nd_cached', { endpoint, query }),
  abs: (path) => invoke('abs_get', { path }),
  ndPlaylistImage: (id, bytes, name) => invoke('nd_playlist_image', { id, bytes, name }),
  ndReauth: (password) => invoke('nd_reauth', { password }),
  lyricsFind: (artist, title, album, duration) => invoke('lyrics_find', { artist, title, album, duration }),
  absCached: (path) => invoke('abs_cached', { path }),
  get: (path) => invoke('api_get', { path }),
  cached: (path) => invoke('api_cached', { path }),
  post: (path, body = null) => invoke('api_send', { method: 'POST', path, body }),
  del: (path) => invoke('api_send', { method: 'DELETE', path, body: null }),
  uploadImage: (path, base64, contentType) => invoke('api_upload_image', { path, base64, contentType }),
  play: (itemId, o = {}) => invoke('play', { itemId, fromStart: !!o.fromStart, embedded: o.embedded ?? true, startSecs: o.startSecs ?? null, maxBitrate: o.maxBitrate ?? null }),
  clearCache: () => invoke('clear_cache'),
  refreshCovers: (kind) => invoke('refresh_covers', { kind }),
  absSend: (method, path, body = null) => invoke('abs_send', { method, path, body }),
};

// Show the saved copy instantly (if any), then refresh from the server and
// re-render only if something changed. `render(data, fromCache)`.
export async function load(path, render, isAlive = () => true) {
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
export const IMG_BASE = navigator.userAgent.includes('Windows') ? 'http://img.localhost' : 'img://localhost';

export function img(itemId, type, tag, width = 400, index) {
  if (!itemId || !tag) return null;
  const idx = index !== undefined ? `/${index}` : '';
  return `${IMG_BASE}/${encodeURIComponent(itemId)}/${type}${idx}?tag=${encodeURIComponent(tag)}&w=${width}`;
}

// Ask for an image even when Emby didn't list one (e.g. auto-made library pictures).
export function imgAny(itemId, type, width = 400) {
  return `${IMG_BASE}/${encodeURIComponent(itemId)}/${type}?w=${width}`;
}
