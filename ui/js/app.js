import { api } from './api.js';
import './player.js';
import { toast } from './components.js';
import { loginView, homeView, libraryView, itemView, searchView, listenView } from './views.js';

const viewEl = document.getElementById('view');
const topbar = document.getElementById('topbar');
let session = null;
let routeId = 0;
let leaveHandlers = [];

async function refreshSession() {
  session = await api.session();
  document.getElementById('userInfo').innerHTML =
    `<b>${escapeText(session.userName)}</b>${escapeText(session.serverName || session.server)}`;
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
      if (msg === 'SESSION_EXPIRED' || msg === 'Not logged in.') {
        toast('Your sign-in expired. Please sign in again.', true);
        location.hash = '#/login';
        return;
      }
      if (soft) toast(msg, true);
      else if (my === routeId) viewEl.innerHTML = `<div class="empty">${escapeText(msg)}<br><br><button class="btn secondary" onclick="location.reload()">Try again</button></div>`;
    },
  };
}

async function route(opts = {}) {
  if (!session) await refreshSession();
  const hash = location.hash || '#/home';
  const [, name, arg] = hash.split('/');

  if (!session.loggedIn && name !== 'login') { location.hash = '#/login'; return; }
  if (session.loggedIn && name === 'login') { location.hash = '#/home'; return; }

  topbar.hidden = name === 'login';
  document.querySelectorAll('.tabs a').forEach((a) =>
    a.classList.toggle('active', a.dataset.tab === (name === 'listen' ? 'listen' : 'watch')));
  document.getElementById('userMenu').hidden = true;

  const ctx = makeCtx();
  const id = arg ? decodeURIComponent(arg) : '';
  if (!opts.keepScroll) window.scrollTo(0, 0);
  switch (name) {
    case 'login': return loginView(viewEl, ctx);
    case 'library': return libraryView(viewEl, ctx, id);
    case 'item': return itemView(viewEl, ctx, id);
    case 'search': return searchView(viewEl, ctx);
    case 'listen': return listenView(viewEl, ctx);
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
document.getElementById('clearCacheBtn').addEventListener('click', async () => {
  await api.clearCache();
  document.getElementById('userMenu').hidden = true;
  toast('Image and library cache cleared.');
});

// Backspace / mouse "back" button go back, like a browser.
window.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (e.key === 'Backspace' && !typing) { e.preventDefault(); history.back(); }
  if (e.key === '/' && !typing && session?.loggedIn) { e.preventDefault(); location.hash = '#/search'; }
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
route();
