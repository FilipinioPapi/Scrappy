// Google TV: the side rail (approved mock "Scrappy TV Mock-ups"). It replaces the PC's top bar
// and side menu: icons only until the remote moves onto it, then it slides open with names.
// Search, Home, your libraries, Genres, Favorites, then Music, Audiobooks and Settings.
import { api } from './api.js';
import { esc } from './components.js';

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>',
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  movies: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  tvshows: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 21h8M9 2l3 4 3-4"/>',
  boxsets: '<rect x="3" y="8" width="13" height="13" rx="1.5"/><path d="M7 4h11.5A2.5 2.5 0 0 1 21 6.5V17"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  genres: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  favorites: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  audiobooks: '<path d="M4 13a8 8 0 0 1 16 0"/><rect x="3.5" y="13" width="4" height="7" rx="1.5"/><rect x="16.5" y="13" width="4" height="7" rx="1.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const SKIP = new Set(['music', 'livetv', 'channels', 'books', 'audiobooks', 'playlists']);

const rail = document.createElement('nav');
rail.id = 'tvrail'; rail.hidden = true;
document.body.appendChild(rail);
let views = [];
// Whoever is watching: their picture sits at the top, and pressing it opens "Who's watching?".
let me = { name: '', pic: '' };
window.__TAURI__.core.invoke('get_session').then((s) => {
  if (!s?.loggedIn && !s?.userName) return;
  me = { name: s.userName || s.servers?.navidrome?.user || s.servers?.audiobookshelf?.user || '', pic: s.servers?.emby?.signedIn && s.server && s.userId ? `${s.server}/Users/${encodeURIComponent(s.userId)}/Images/Primary?maxWidth=120&quality=90` : '' };
  draw();
}).catch(() => {});

const item = (key, name, icon, href) => `<a class="tr-i" href="${href}" data-k="${esc(key)}">${svg(ICON[icon] || ICON.folder)}<span>${esc(name)}</span></a>`;
function draw() {
  const libs = views.filter((v) => !SKIP.has(v.CollectionType));
  rail.innerHTML = `<div class="tr-logo"><img src="logo.png" alt=""><b>SCRAPPY</b></div>
    <a class="tr-i tr-me" href="#/home" data-k="me"><i class="tr-face">${esc((me.name || '?').charAt(0).toUpperCase())}${me.pic ? `<img src="${esc(me.pic)}" alt="" onerror="this.remove()">` : ''}</i><span>${esc(me.name || 'Who\'s watching')}</span></a>
    ${item('search', 'Search', 'search', '#/search')}
    ${item('home', 'Home', 'home', '#/home')}
    ${libs.map((v) => item(v.Id, v.Name, v.CollectionType, `#/library/${encodeURIComponent(v.Id)}`)).join('')}
    ${item('genres', 'Genres', 'genres', '#/genres')}
    ${item('favorites', 'Favorites', 'favorites', '#/favorites')}
    <div class="tr-sep"></div>
    ${item('music', 'Music', 'music', '#/music')}
    ${item('audiobooks', 'Audiobooks', 'audiobooks', '#/audiobooks')}
    <div class="tr-sp"></div>
    ${item('settings', 'Settings', 'settings', '#/settings')}`;
  // With many libraries the entries get a little shorter so Settings always fits on the screen.
  rail.style.setProperty('--trn', String(rail.querySelectorAll('.tr-i').length));
  mark();
}
// Light up where you are. Movie and show pages keep the last place lit.
let lit = 'home';
function mark() {
  const [, name, arg] = (location.hash.split('?')[0] || '#/home').split('/');
  const k = name === 'library' ? decodeURIComponent(arg || '') : ['genres', 'favorites', 'music', 'audiobooks', 'search', 'settings'].includes(name) ? name : !name || name === 'home' ? 'home' : name === 'stats' ? (arg || 'home') : null;
  if (k) lit = k;
  rail.hidden = name === 'login' || name === 'servers';
  document.documentElement.classList.toggle('tv-rail', !rail.hidden);
  rail.querySelectorAll('.tr-i').forEach((a) => a.classList.toggle('cur', a.dataset.k === lit));
}
/** The rail entry for the screen you're on (where Left lands). */
export const railCurrent = () => rail.querySelector('.tr-i.cur') || rail.querySelector('.tr-i');
export const inRail = (el) => !!el && rail.contains(el);

async function loadViews() {
  const take = (d) => { const v = d?.Items; if (!v?.length) return; if (JSON.stringify(v.map((x) => [x.Id, x.Name])) === JSON.stringify(views.map((x) => [x.Id, x.Name]))) return; const had = inRail(document.activeElement) ? document.activeElement.dataset.k : null; views = v; draw(); if (had) (rail.querySelector(`.tr-i[data-k="${CSS.escape(had)}"]`) || railCurrent())?.focus({ preventScroll: true }); };
  try { take(await api.cached('/Users/{userId}/Views')); } catch {}
  try { take(await api.get('/Users/{userId}/Views')); } catch {}
}

draw();
rail.addEventListener('focusin', (e) => e.target.scrollIntoView?.({ block: 'nearest' }));
addEventListener('hashchange', () => { mark(); if (!views.length) loadViews(); });
// Picking the screen you're already on just closes the rail.
rail.addEventListener('click', (e) => { const a = e.target.closest('.tr-i'); if (!a) return; if (a.dataset.k === 'me') { e.preventDefault(); import('./tvwho.js').then((m) => m.who({ side: true })).catch(() => {}); return; } if (a.getAttribute('href') === (location.hash || '#/home')) { e.preventDefault(); window.dispatchEvent(new Event('tv:leave-rail')); } else window.dispatchEvent(new Event('tv:rail-go')); });
setTimeout(loadViews, 600);
