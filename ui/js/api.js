// Thin layer over the Rust side. All server talk happens in Rust.
const { invoke } = window.__TAURI__.core;
export const { listen } = window.__TAURI__.event;

export const api = {
  session: () => invoke('get_session'),
  login: (server, username, password) => invoke('login', { server, username, password }),
  logout: () => invoke('logout'),
  get: (path) => invoke('api_get', { path }),
  cached: (path) => invoke('api_cached', { path }),
  play: (itemId, fromStart = false) => invoke('play', { itemId, fromStart }),
  clearCache: () => invoke('clear_cache'),
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
    if (isAlive() && JSON.stringify(fresh) !== shown) render(fresh, false);
  } catch (e) {
    if (!cached) throw e;
  }
}

// Images are served by Rust from a disk cache through the img:// protocol.
const IMG_BASE = navigator.userAgent.includes('Windows') ? 'http://img.localhost' : 'img://localhost';

export function img(itemId, type, tag, width = 400, index) {
  if (!itemId || !tag) return null;
  const idx = index !== undefined ? `/${index}` : '';
  return `${IMG_BASE}/${encodeURIComponent(itemId)}/${type}${idx}?tag=${encodeURIComponent(tag)}&w=${width}`;
}
