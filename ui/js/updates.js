// Auto-updates. New builds download quietly in the background; a green "Update ready"
// button shows what's new, and "Restart now" installs it (waiting if something is playing).
// "Later" leaves it for the next start, when it installs before anything else happens.
// Admins (the request service's admins) can pick Preview or Stable; everyone else gets Stable.
import { toast, esc } from './components.js';
import { music } from './mplayer.js';
import { book } from './bplayer.js';

const { invoke } = window.__TAURI__.core;
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// Back on the page you were on before the update restarted the app.
const back = ls.get('updReturn');
if (back) { ls.set('updReturn', ''); if (back.startsWith('#')) location.hash = back; }

let admin = ls.get('isAdmin') === '1';
let current = '', found = null, checking = false, waitTimer = null;
const channel = () => (admin && ls.get('updChannel') !== 'stable' ? 'preview' : 'stable');
const autoInstall = () => ls.get('updAuto') !== 'off';
const fmtDay = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
const chName = () => (channel() === 'preview' ? 'Preview' : 'Stable');

// Is the request service saying we're an admin? Remember the answer for next time.
async function checkAdmin() {
  try {
    const me = await invoke('req_call', { method: 'GET', path: '/api/me', body: null });
    const was = admin; admin = !!me?.admin; ls.set('isAdmin', admin ? '1' : '0');
    if (was !== admin) drawSettings();
  } catch {}
}

// Something playing? (music, an audiobook, or a video)
let video = false;
window.addEventListener('video:start', () => { video = true; });
window.addEventListener('scrappy:refresh', () => { video = false; });
const busy = () => (music.playing) || (book.playing && book.started) || video || !!(document.getElementById('player') && !document.getElementById('player').hidden);

// ---------- Top bar button + card ----------
const btn = document.createElement('div');
btn.className = 'upd-wrap'; btn.hidden = true;
btn.innerHTML = `<button type="button" class="upd-btn" id="updBtn"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg><span>Update ready</span></button>
  <div class="upd-card" id="updCard" hidden></div>`;
document.querySelector('header .actions')?.prepend(btn);
const card = btn.querySelector('#updCard');
btn.querySelector('#updBtn').onclick = (e) => { e.stopPropagation(); card.hidden = !card.hidden; if (!card.hidden) drawCard(); };
document.addEventListener('pointerdown', (e) => { if (!card.hidden && !btn.contains(e.target)) card.hidden = true; });

function drawCard() {
  if (!found) return;
  const lines = String(found.notes || '').split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean).slice(0, 8);
  card.innerHTML = `<div class="kicker">UPDATE READY</div>
    <div class="upd-t">Scrappy ${chName()}${found.date ? ' · ' + fmtDay(found.date) : ''}</div>
    <div class="t2">You have version ${esc(current)}, this is ${esc(found.version)}</div>
    ${lines.length ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="t2">Fixes and improvements.</p>'}
    ${busy() ? '<div class="upd-wait">Playing something? It\'ll wait until you stop.</div>' : ''}
    <div class="upd-btns"><button type="button" class="btn secondary" id="updLater">Later</button><button type="button" class="btn upd-go" id="updNow">${waitTimer ? 'Waiting for you to stop…' : 'Restart now'}</button></div>`;
  card.querySelector('#updLater').onclick = () => { card.hidden = true; toast(autoInstall() ? 'It will install the next time Scrappy starts.' : 'You can install it from Settings any time.'); };
  card.querySelector('#updNow').onclick = () => { card.hidden = true; restartWhenFree(); };
}
function restartWhenFree() {
  if (!busy()) return install();
  if (waitTimer) return;
  toast('Scrappy will restart to update as soon as you stop playing.');
  waitTimer = setInterval(() => { if (!busy()) { clearInterval(waitTimer); waitTimer = null; install(); } }, 3000);
}

// ---------- Restart splash ----------
async function install() {
  if (!found) return;
  const s = document.createElement('div');
  s.className = 'upd-splash';
  s.innerHTML = `<div class="upd-logo">SCRAPPY</div><div class="upd-st">Updating to the ${fmtDay(found.date) || esc(found.version)} ${chName()}…</div><div class="t2">Back in a few seconds</div><div class="upd-bar"><i></i></div>`;
  document.body.appendChild(s);
  ls.set('updReturn', location.hash);
  try { await invoke('upd_install', { channel: channel() }); }
  catch (e) { s.remove(); ls.set('updReturn', ''); toast('Update failed: ' + e, true); }
}

// ---------- Checking ----------
async function check(manual = false, atStart = false) {
  if (checking) return;
  checking = true; drawSettings('Checking…');
  try {
    const r = await invoke('upd_check', { channel: channel() });
    current = r.current || current;
    found = r.available ? r : null;
    btn.hidden = !found;
    if (found && atStart && found.wasSaved && autoInstall() && !busy()) { install(); return; }
    if (manual) toast(found ? 'An update is ready.' : "You're up to date.");
  } catch (e) {
    if (manual) toast("Couldn't check for updates: " + e, true);
  } finally { checking = false; drawSettings(); }
}

// ---------- Settings (cog menu) ----------
function drawSettings(state) {
  const box = document.getElementById('updSettings'); if (!box) return;
  box.querySelector('#updVer').textContent = `${chName()}${current ? ' · version ' + current : ''}`;
  const st = box.querySelector('#updState');
  st.textContent = state || (found ? 'Update ready' : current ? 'Up to date' : '');
  st.className = 'upd-state' + (found && !state ? ' ready' : '');
  box.querySelector('#updCh').hidden = !admin;
  box.querySelectorAll('#updCh [data-ch]').forEach((b) => b.classList.toggle('on', b.dataset.ch === channel()));
  box.querySelector('#updAuto').checked = autoInstall();
  box.querySelector('#updCheckBtn').textContent = found ? 'See update' : 'Check now';
}
function mountSettings() {
  const box = document.getElementById('updSettings'); if (!box) return;
  box.querySelector('#updCheckBtn').onclick = (e) => { e.stopPropagation(); if (found) { document.getElementById('userMenu').hidden = true; card.hidden = false; drawCard(); } else check(true); };
  box.querySelectorAll('#updCh [data-ch]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); if (b.dataset.ch === channel()) return; ls.set('updChannel', b.dataset.ch); found = null; btn.hidden = true; drawSettings(); check(true); }));
  box.querySelector('#updAuto').onchange = (e) => { ls.set('updAuto', e.target.checked ? 'on' : 'off'); };
  drawSettings();
}

mountSettings();
invoke('app_version').then((v) => { current = v; drawSettings(); }).catch(() => {});
// First look a few seconds after start (an update saved last time installs now), then every 2 hours.
setTimeout(async () => { await checkAdmin(); check(false, true); }, 4000);
setInterval(() => { checkAdmin().then(() => check()); }, 2 * 3600 * 1000);
