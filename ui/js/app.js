import { api, quiet } from './api.js';
import './player.js';
import './mplayer.js';
import { musicView } from './music.js';
import './music2.js';
import './nowplaying.js';
import { mountSearch, setSearchSession, searchPage } from './search.js';
import './menu.js';
import { toast } from './components.js';
import { loginView, firstTab, homeView, libraryView, itemView, personView, searchView, comingSoonView } from './views.js';

const viewEl = document.getElementById('view');

// Opening intro: stays until the first page is ready (the home banner, or any
// other page), at least 1.2s so it doesn't flash, and never past ~2.5s.
const introStart = performance.now();
let introGone = false;
function hideIntro() {
  if (introGone) return;
  introGone = true;
  const el = document.getElementById('intro');
  if (!el) return;
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 500);
  }, Math.max(0, 1200 - (performance.now() - introStart)));
}
window.addEventListener('scrappy:ready', hideIntro, { once: true });
setTimeout(hideIntro, 2000);
const topbar = document.getElementById('topbar');
let session = null;
let routeId = 0;
let leaveHandlers = [];
let enterTimer;

async function refreshSession() {
  session = await api.session();
  setSearchSession(session);
  const sv = session.servers || {};
  const rows = [['emby', 'Emby'], ['navidrome', 'Navidrome'], ['audiobookshelf', 'Audiobookshelf']]
    .filter(([k]) => sv[k]?.signedIn)
    .map(([k, n]) => `<div class="menu-srv"><b>${n}</b>${escapeText(sv[k].user)}</div>`).join('');
  document.getElementById('userInfo').innerHTML = rows || 'Not signed in';
  // Only servers you're signed in to get a tab.
  const tabFor = { home: 'emby', music: 'navidrome', audiobooks: 'audiobookshelf' };
  document.querySelectorAll('.tabs a').forEach((a) => (a.hidden = !sv[tabFor[a.dataset.tab]]?.signedIn));
  const pill = document.querySelector('.tab-pill'); if (pill) pill.classList.remove('ready');
}
const escapeText = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function makeCtx() {
  const my = ++routeId;
  leaveHandlers.forEach((f) => { try { f(); } catch {} });
  leaveHandlers = [];
  return {
    session,
    refreshSession,
    alive: () => my === routeId,
    onLeave: (f) => leaveHandlers.push(f),
    fail(e, soft = false) {
      const msg = String(e);
      const expired = { SESSION_EXPIRED: 'emby', 'Not logged in.': 'emby', ND_SESSION_EXPIRED: 'navidrome', ABS_SESSION_EXPIRED: 'audiobookshelf' }[msg];
      if (expired) {
        toast('Your sign-in expired. Please sign in again.', true);
        api.serverLogout(expired).catch(() => {}).then(refreshSession).then(() => { location.hash = `#/servers/${expired}`; });
        return;
      }
      if (soft) toast(msg, true);
      else if (my === routeId) viewEl.innerHTML = `<div class="empty">${escapeText(msg)}<br><br><button class="btn secondary" onclick="location.reload()">Try again</button></div>`;
    },
  };
}

// The red pill behind the active top tab slides to whichever tab is picked.
function moveTabPill() {
  const nav = document.querySelector('.tabs'); if (!nav || nav.closest('[hidden]')) return;
  let pill = nav.querySelector('.tab-pill');
  if (!pill) { pill = document.createElement('span'); pill.className = 'tab-pill'; nav.prepend(pill); nav.classList.add('has-pill'); }
  const on = nav.querySelector('a.active'); if (!on || !on.offsetWidth) { requestAnimationFrame(moveTabPill); return; }
  pill.style.left = on.offsetLeft + 'px'; pill.style.width = on.offsetWidth + 'px';
  if (!pill.classList.contains('ready')) requestAnimationFrame(() => pill.classList.add('ready'));
}
window.addEventListener('resize', moveTabPill);

async function route(opts = {}) {
  if (!session) await refreshSession();
  const hash = location.hash || '#/home';
  const [, name, arg, arg2] = hash.split('/');

  if (!session.loggedIn && name !== 'login') { location.hash = '#/login'; return; }
  if (session.loggedIn && name === 'login') { location.hash = firstTab(session); return; }
  // A tab whose server isn't signed in goes to one that is.
  const need = { music: 'navidrome', audiobooks: 'audiobookshelf' }[name] || (['login', 'servers'].includes(name) ? '' : 'emby');
  if (need && !session.servers?.[need]?.signedIn) { location.hash = firstTab(session); return; }

  topbar.hidden = name === 'login' || name === 'servers';
  document.querySelectorAll('.tabs a').forEach((a) =>
    a.classList.toggle('active', a.dataset.tab === (['music', 'audiobooks'].includes(name) ? name : 'home')));
  moveTabPill();
  document.getElementById('userMenu').hidden = true;

  const ctx = makeCtx();
  if (opts.keepScroll) quiet();
  const id = arg ? decodeURIComponent(arg) : '';
  if (!opts.keepScroll) {
    window.scrollTo(0, 0);
    viewEl.classList.remove('quiet');
    // Quick fade-in for the new page; dropped soon after so later refreshes don't replay it.
    viewEl.classList.remove('entering');
    void viewEl.offsetWidth;
    viewEl.classList.add('entering');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => viewEl.classList.remove('entering'), 700);
  }
  // Home says when its banner is ready; every other page is ready once drawn.
  if (!['home', undefined, ''].includes(name)) setTimeout(hideIntro, 0);
  switch (name) {
    case 'login': return loginView(viewEl, ctx);
    case 'servers': return loginView(viewEl, ctx, id);
    case 'library': return libraryView(viewEl, ctx, id, arg2 ? decodeURIComponent(arg2) : '');
    case 'item': return itemView(viewEl, ctx, id, arg2 ? decodeURIComponent(arg2) : '');
    case 'person': return personView(viewEl, ctx, id);
    case 'search': return searchPage(viewEl, ctx);
    case 'music': return musicView(viewEl, ctx);
    case 'audiobooks': return comingSoonView(viewEl, 'Audiobooks from Audiobookshelf will live here.');
    default: return homeView(viewEl, ctx);
  }
}

// Account menu
document.getElementById('userBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const m = document.getElementById('userMenu');
  m.hidden = !m.hidden;
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.user-menu')) document.getElementById('userMenu').hidden = true;
});
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api.logout().catch(() => {});
  await refreshSession();
  location.hash = '#/login';
});
document.getElementById('serversBtn').addEventListener('click', () => { location.hash = '#/servers'; });
document.getElementById('clearCacheBtn').addEventListener('click', async () => {
  await api.clearCache();
  document.getElementById('userMenu').hidden = true;
  toast('Image and library cache cleared.');
});

// Backspace / mouse "back" button go back, like a browser.
window.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (e.key === 'Backspace' && !typing) { e.preventDefault(); history.back(); }
});
window.addEventListener('mouseup', (e) => { if (e.button === 3) history.back(); if (e.button === 4) history.forward(); });

// Player events from Rust

// Settings in the account menu (full settings page comes in step 5).
const autoplayToggle = document.getElementById('autoplayToggle');
const windowModeToggle = document.getElementById('windowModeToggle');
autoplayToggle.checked = localStorage.getItem('autoplay') !== 'off';
windowModeToggle.checked = localStorage.getItem('playerMode') === 'window';
autoplayToggle.addEventListener('change', () => localStorage.setItem('autoplay', autoplayToggle.checked ? 'on' : 'off'));
windowModeToggle.addEventListener('change', () => localStorage.setItem('playerMode', windowModeToggle.checked ? 'window' : 'embedded'));
document.querySelector('.menu').addEventListener('click', (e) => { if (e.target.closest('label')) e.stopPropagation(); });

// After playback, refresh the page so Continue Watching and progress bars update.
window.addEventListener('scrappy:refresh', () => {
  const name = (location.hash || '#/home').split('/')[1];
  if (['home', 'item', undefined, ''].includes(name)) route({ keepScroll: true });
});

window.addEventListener('hashchange', () => route());
mountSearch();
route();
