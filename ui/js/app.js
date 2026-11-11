import { api, quiet } from './api.js';
import './player.js';
import './mplayer.js';
import { musicView } from './music.js';
import { booksView } from './books.js';
import './music2.js';
import './nowplaying.js';
import { mountSearch, setSearchSession, searchPage } from './search.js';
import { requestsPage, mountRequests } from './requests.js';
import './menu.js';
import './topfit.js';
import './updates.js';
import { toast } from './components.js';
import { loginView, firstTab, homeView, libraryView, itemView, personView, comingSoonView, connectView } from './views.js';

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
  // Every tab always shows; a tab whose server isn't signed in offers a sign-in instead.
  document.querySelectorAll('.tabs a').forEach((a) => (a.classList.toggle('off', !sv[tabFor[a.dataset.tab]]?.signedIn)));
  const pill = document.querySelector('.tab-pill'); if (pill) pill.classList.remove('ready');
  mountRequests(session).catch(() => {});
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
  if (document.body.classList.contains('tab-stats')) { pill.classList.add('gone'); return; }
  pill.classList.remove('gone');
  const on = nav.querySelector('a.active'); if (!on || !on.offsetWidth) { requestAnimationFrame(moveTabPill); return; }
  pill.style.left = on.offsetLeft + 'px'; pill.style.width = on.offsetWidth + 'px';
  if (!pill.classList.contains('ready')) requestAnimationFrame(() => pill.classList.add('ready'));
}
window.addEventListener('resize', moveTabPill);

let lastRouteName = '';
async function route(opts = {}) {
  if (!session) await refreshSession();
  const hash = location.hash || '#/home';
  const [, rawName, arg, arg2] = hash.split('/');
  // "#/search?q=…" and "#/requests?scope=all": the page name is the part before the "?".
  const name = (rawName || '').split('?')[0];
  // Stats are their own section now: the old per-tab addresses move there.
  if ((name === 'music' || name === 'audiobooks') && (arg || '').split('?')[0] === 'stats') { location.replace(`#/stats/${name}`); return; }
  const statsKind = name === 'stats' ? ({ music: 'music', audiobooks: 'abs' }[arg] || 'tv') : '';

  if (!session.loggedIn && name !== 'login') { location.hash = '#/login'; return; }
  if (session.loggedIn && name === 'login') { location.hash = firstTab(session); return; }
  // A tab whose server isn't signed in shows a sign-in prompt for it.
  const need = { music: 'navidrome', audiobooks: 'audiobookshelf' }[name] || { music: 'navidrome', abs: 'audiobookshelf' }[statsKind] || (['login', 'servers', 'search'].includes(name) ? '' : 'emby');
  const notSigned = need && !session.servers?.[need]?.signedIn;

  topbar.hidden = name === 'login' || name === 'servers';
  // The bottom player bar stays on the audio tabs (Music, Audiobooks); on Movies & TV it slides away
  // and the small player shows in the top bar instead.
  const audioTab = name === 'music' || name === 'audiobooks';
  const swapped = document.body.classList.contains('tab-music') !== audioTab && !!lastRouteName;
  // Moving between Stats categories keeps the page and only swaps the numbers.
  const statsSwitch = !!statsKind && lastRouteName === 'stats' && !!viewEl.querySelector(':scope > .stx-page > .stx');
  if (!statsKind) window.__statsPer = '';
  lastRouteName = name;
  document.body.classList.toggle('tab-music', audioTab);
  // Stats act as their own section: no side bars, no bottom bar, no tab lit up.
  // Requests act the same way.
  document.body.classList.toggle('tab-stats', !!statsKind || name === 'requests');
  document.querySelectorAll('.tabs a').forEach((a) =>
    a.classList.toggle('active', !statsKind && name !== 'requests' && a.dataset.tab === (['music', 'audiobooks'].includes(name) ? name : 'home')));
  moveTabPill();
  document.getElementById('userMenu').hidden = true;

  const ctx = makeCtx();
  if (opts.keepScroll) quiet();
  const id = arg ? decodeURIComponent(arg) : '';
  if (!opts.keepScroll && !statsSwitch) {
    window.scrollTo(0, 0);
    viewEl.classList.remove('quiet');
    // Quick fade-in for the new page; dropped soon after so later refreshes don't replay it.
    viewEl.classList.remove('entering', 'tabswap');
    void viewEl.offsetWidth;
    // Moving between the audio tabs and Movies & TV gets a softer, slightly longer cross-fade.
    viewEl.classList.add('entering'); viewEl.classList.toggle('tabswap', swapped);
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => viewEl.classList.remove('entering', 'tabswap'), 900);
  }
  // Home says when its banner is ready; every other page is ready once drawn.
  if (!['home', undefined, ''].includes(name)) setTimeout(hideIntro, 0);
  if (notSigned) return connectView(viewEl, need);
  switch (name) {
    case 'login': return loginView(viewEl, ctx);
    case 'servers': return loginView(viewEl, ctx, id);
    case 'library': return libraryView(viewEl, ctx, id, arg2 ? decodeURIComponent(arg2) : '');
    case 'item': return itemView(viewEl, ctx, id, arg2 ? decodeURIComponent(arg2) : '');
    case 'person': return personView(viewEl, ctx, id);
    case 'search': return searchPage(viewEl, ctx);
    case 'requests': return requestsPage(viewEl, ctx, (arg || '').split('?')[0], arg2 ? decodeURIComponent(arg2.split('?')[0]) : '');
    case 'music': return musicView(viewEl, ctx);
    case 'audiobooks': return booksView(viewEl, ctx);
    case 'stats': if (!statsSwitch) viewEl.innerHTML = '<div class="stx-page"></div>'; return import('./stats.js').then((m) => m.statsPage(viewEl.firstChild, statsKind, ctx.alive));
    default: return homeView(viewEl, ctx);
  }
}

// Account menu
document.getElementById('userBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const m = document.getElementById('userMenu');
  m.hidden = !m.hidden;
  document.getElementById('refMenu').hidden = true;
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

// ---------- Refresh button: click = Quick Scan, right-click = Quick Scan / Deep Scan ----------
const refreshBtn = document.getElementById('refreshBtn');
const refMenu = document.getElementById('refMenu');
const SECTIONS = {
  home: { name: 'Movies & TV', server: 'Emby', what: 'posters', deep: 'Asks Emby to look through its folders for new or changed files, then refreshes. A few minutes.' },
  music: { name: 'Music', server: 'Navidrome', what: 'album art', deep: 'Asks Navidrome to look through its music folder for new or changed files, then refreshes. About a minute.' },
  audiobooks: { name: 'Audiobooks', server: 'Audiobookshelf', what: 'covers', deep: 'Asks Audiobookshelf to look through its folders for new or changed files, then refreshes. A few minutes.' },
};
const curSection = () => { const [, n, a] = (location.hash || '#/home').split('/'); const k = n === 'stats' ? a : n; return k === 'music' || k === 'audiobooks' ? k : 'home'; };
const lastRefresh = {};
const adminCache = {};
async function isAdmin(sec) {
  if (sec in adminCache) return adminCache[sec];
  let ok = false;
  try {
    if (sec === 'audiobooks') ok = ['root', 'admin'].includes((await api.abs('/api/me')).type);
    else if (sec === 'music') { const u = session?.servers?.navidrome?.user || ''; ok = !!(await api.nd('getUser', 'username=' + encodeURIComponent(u))).user?.adminRole; }
    else ok = !!(await api.get('/Users/' + session.userId)).Policy?.IsAdministrator;
  } catch {}
  return (adminCache[sec] = ok);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let scanning = false;
async function quickScan(sec = curSection(), quietToast = false) {
  if (scanning) return;
  scanning = true; refreshBtn.classList.add('scanning'); refMenu.hidden = true;
  try {
    const [covers] = await Promise.all([
      api.refreshCovers(sec).catch(() => 0),
      sec === 'music' ? import('./music.js').then((m) => m.refreshPlaylists?.()).catch(() => {}) : null,
    ]);
    // Draw the page again straight from the server (pages always ask the server after showing saved copies).
    window.dispatchEvent(new CustomEvent('scrappy:refresh', { detail: sec }));
    await route({ keepScroll: true });
    lastRefresh[sec] = Date.now();
    if (!quietToast) toast(`${SECTIONS[sec].name} is up to date${covers ? ` · ${covers} new ${covers === 1 ? 'picture' : 'pictures'}` : ''}`);
  } catch (e) { toast(String(e), true); }
  finally { scanning = false; refreshBtn.classList.remove('scanning'); }
}
async function deepScan(sec = curSection()) {
  if (scanning) return;
  const S = SECTIONS[sec];
  scanning = true; refreshBtn.classList.add('scanning'); refMenu.hidden = true;
  toast(`Asking ${S.server} to scan for new files…`);
  const started = Date.now(), until = started + 15 * 60 * 1000;
  try {
    if (sec === 'audiobooks') {
      const libs = ((await api.abs('/api/libraries')).libraries || []).filter((l) => l.mediaType === 'book');
      for (const l of libs) await api.absSend('POST', `/api/libraries/${l.id}/scan`);
      await wait(3000);
      while (Date.now() < until) {
        const t = await api.abs('/api/tasks').catch(() => null);
        const busy = (t?.tasks || []).some((x) => !x.isFinished && /scan/i.test(x.action || ''));
        if (!busy) break; await wait(3000);
      }
    } else if (sec === 'music') {
      await api.nd('startScan');
      await wait(2000);
      while (Date.now() < until) { const r = await api.nd('getScanStatus').catch(() => null); if (!r?.scanStatus?.scanning) break; await wait(2500); }
    } else {
      await api.post('/Library/Refresh');
      await wait(4000);
      while (Date.now() < until) {
        const tasks = await api.get('/ScheduledTasks?IsHidden=false').catch(() => null);
        if (!Array.isArray(tasks)) { await wait(20000); break; }
        const t = tasks.find((x) => x.Key === 'RefreshLibrary');
        if (!t || t.State !== 'Running') break; await wait(3000);
      }
    }
    scanning = false;
    await quickScan(sec, true);
    toast(`${S.server} scan finished · ${S.name} is up to date`);
  } catch (e) {
    toast(`${S.server} scan didn't start: ${String(e).replace(/^Error:\s*/, '')}`, true);
  } finally { scanning = false; refreshBtn.classList.remove('scanning'); }
}
const ago = (t) => { if (!t) return 'not yet this session'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m === 1 ? '1 min ago' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
async function openRefMenu() {
  const sec = curSection(), S = SECTIONS[sec];
  document.getElementById('userMenu').hidden = true;
  const draw = (admin) => {
    refMenu.innerHTML = `<div class="rm-h">${S.name}${lastRefresh[sec] ? ' · refreshed ' + ago(lastRefresh[sec]) : ''}</div>
      <button type="button" class="rm-i" data-act="quick"><span class="ic">${refreshBtn.querySelector('svg').outerHTML}</span><span><span class="t">Quick Scan</span><span class="d">Reloads this tab from ${S.server} and grabs any changed ${S.what}. A few seconds.</span></span></button>
      <button type="button" class="rm-i${admin === false ? ' off' : ''}" data-act="deep"${admin === false ? ' aria-disabled="true"' : ''}><span class="ic"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg></span>
        <span><span class="t">Deep Scan${admin === false ? '<span class="lock"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg> Admin only</span>' : ''}</span>
        <span class="d">${admin === false ? `Asks ${S.server} to look for new files on the server. Needs an admin account on ${S.server}.` : S.deep}</span></span></button>`;
  };
  draw(adminCache[sec]);
  refMenu.hidden = false;
  if (!(sec in adminCache)) draw(await isAdmin(sec));
}
refreshBtn.addEventListener('click', (e) => { e.stopPropagation(); quickScan(); });
refreshBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); if (!refMenu.hidden) { refMenu.hidden = true; return; } openRefMenu(); });
// ---------- Stats button: click = this tab's stats, right-click = pick any of the three ----------
const statsBtn = document.getElementById('topStatsBtn');
const statsMenu = document.getElementById('statsMenu');
const STATS_ROUTES = { home: '#/stats', music: '#/stats/music', audiobooks: '#/stats/audiobooks' };
const onStats = () => Object.values(STATS_ROUTES).includes((location.hash || '').split('?')[0]);
let beforeStats = '';
const SEC_ICON = {
  home: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  music: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  audiobooks: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg>',
};
function goStats(sec) {
  statsMenu.hidden = true;
  if (!onStats()) beforeStats = location.hash || '#/home';
  location.hash = STATS_ROUTES[sec];
}
statsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (onStats()) { location.hash = beforeStats || { home: '#/home', music: '#/music', audiobooks: '#/audiobooks' }[curSection()]; beforeStats = ''; return; }
  goStats(curSection());
});
statsBtn.addEventListener('contextmenu', (e) => {
  e.preventDefault(); e.stopPropagation();
  if (!statsMenu.hidden) { statsMenu.hidden = true; return; }
  refMenu.hidden = true; document.getElementById('userMenu').hidden = true;
  const here = curSection(), cur = (location.hash || '').split('?')[0];
  statsMenu.innerHTML = `<div class="rm-h">Open stats</div>` + Object.keys(STATS_ROUTES).map((k) => `<button type="button" class="rm-i sm${cur === STATS_ROUTES[k] ? ' cur' : ''}" data-sec="${k}"><span class="ic">${SEC_ICON[k]}</span><span class="t">${SECTIONS[k].name} stats</span>${k === here ? '<span class="here">this tab</span>' : ''}</button>`).join('');
  statsMenu.hidden = false;
});
statsMenu.addEventListener('click', (e) => { e.stopPropagation(); const b = e.target.closest('[data-sec]'); if (b) goStats(b.dataset.sec); });
document.addEventListener('click', () => { statsMenu.hidden = true; });
const litStats = () => statsBtn.classList.toggle('on', onStats());
window.addEventListener('hashchange', litStats); litStats();

refMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  const b = e.target.closest('[data-act]'); if (!b || b.classList.contains('off')) return;
  if (b.dataset.act === 'quick') quickScan(); else deepScan();
});
document.addEventListener('click', (e) => { if (!e.target.closest('.refresh-wrap')) refMenu.hidden = true; });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') refMenu.hidden = true; });
window.addEventListener('hashchange', () => { refMenu.hidden = true; });

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
// Your Year in Review normally appears on December 1; this shows it any time (for trying it out).
const yirEarlyToggle = document.getElementById('yirEarlyToggle');
yirEarlyToggle.checked = localStorage.getItem('yirEarly') === 'on';
yirEarlyToggle.addEventListener('change', () => { localStorage.setItem('yirEarly', yirEarlyToggle.checked ? 'on' : 'off'); if (/stats/.test(location.hash)) route({ keepScroll: true }); });
document.querySelector('.menu').addEventListener('click', (e) => { if (e.target.closest('label')) e.stopPropagation(); });

// After playback, refresh the page so Continue Watching and progress bars update.
window.addEventListener('scrappy:refresh', () => {
  const name = (location.hash || '#/home').split('/')[1];
  if (['home', 'item', undefined, ''].includes(name)) route({ keepScroll: true });
});

window.addEventListener('hashchange', () => route());
mountSearch();
route();

// The Scrappy logo goes to the home screen of whichever tab you're on.
document.querySelector('#topbar .brand')?.addEventListener('click', (e) => {
  const tab = (location.hash.split('/')[1] || 'home');
  const home = tab === 'music' ? '#/music' : tab === 'audiobooks' ? '#/audiobooks' : '#/home';
  e.preventDefault();
  if (location.hash === home) window.scrollTo({ top: 0, behavior: 'smooth' }); else location.hash = home;
});

// ---------- Ctrl + / Ctrl - / Ctrl 0: scale the whole app ----------
// The level is remembered. It never zooms in so far that the app has less than
// about 960 x 560 points of room, so nothing gets squeezed or cut off.
const ZOOMS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.33, 1.5];
let zoom = Number((() => { try { return localStorage.getItem('zoom'); } catch { return null; } })()) || 1;
const MIN_W = 960, MIN_H = 560;
const roomFor = (z) => (innerWidth * zoomNow) / z >= MIN_W && (innerHeight * zoomNow) / z >= MIN_H;
let zoomNow = 1; // the level currently applied (innerWidth is measured at this level)
function applyZoom(z, say) {
  zoom = z;
  window.__TAURI__.core.invoke('set_zoom', { level: z }).then(() => {
    zoomNow = z;
    try { localStorage.setItem('zoom', String(z)); } catch {}
    setTimeout(moveTabPill, 60);
  }).catch(() => {});
  if (say) toast(`Zoom ${Math.round(z * 100)}%`);
}
function stepZoom(dir) {
  const i = ZOOMS.findIndex((v) => Math.abs(v - zoom) < 0.01);
  const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? ZOOMS.indexOf(1) : i) + dir))];
  if (next === zoom) return;
  if (dir > 0 && !roomFor(next)) { toast('Make the window bigger to zoom in more.'); return; }
  applyZoom(next, true);
}
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.key === '=' || e.key === '+') { e.preventDefault(); e.stopPropagation(); stepZoom(1); }
  else if (e.key === '-' || e.key === '_') { e.preventDefault(); e.stopPropagation(); stepZoom(-1); }
  else if (e.key === '0') { e.preventDefault(); e.stopPropagation(); applyZoom(1, true); }
}, true);
window.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); stepZoom(e.deltaY < 0 ? 1 : -1); } }, { passive: false });
// If the window is made smaller than the zoom level allows, step the zoom back down.
window.addEventListener('resize', () => {
  if (zoomNow <= 1 || innerWidth >= MIN_W && innerHeight >= MIN_H) return;
  let z = zoomNow;
  while (z > 1 && !roomFor(z)) z = ZOOMS[ZOOMS.indexOf(z) - 1] ?? 1;
  if (z !== zoomNow) applyZoom(z, false);
});
if (zoom !== 1) {
  // At start-up the window is at 100%, so check the saved level still fits.
  let z = zoom;
  while (z > 1 && !roomFor(z)) z = ZOOMS[ZOOMS.indexOf(z) - 1] ?? 1;
  applyZoom(z, false);
}
