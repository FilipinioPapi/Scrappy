// Scrappy's own player screen. mpv draws the video into the window behind
// this page; this file draws the controls on top and talks to mpv.
import { api, listen } from './api.js';
import { esc, toast, epCode } from './components.js';

const { invoke } = window.__TAURI__.core;

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  rew: '<svg viewBox="0 0 24 24"><path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="16.5" font-size="6.5" text-anchor="middle" font-family="Segoe UI,sans-serif" font-weight="700">10</text></svg>',
  fwd: '<svg viewBox="0 0 24 24"><path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="16.5" font-size="6.5" text-anchor="middle" font-family="Segoe UI,sans-serif" font-weight="700">30</text></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 5v14l9-7zM16 5h2.5v14H16z"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  muted: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  fs: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  fsExit: '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

const S = {
  open: false, embedded: true, item: null, pos: 0, duration: 0, paused: false,
  buffering: true, cache: 0, volume: Number(localStorage.getItem('volume') ?? 100),
  muted: false, next: null, fullscreen: false, dragging: false, upNextTimer: null, starting: false,
};

const el = document.createElement('div');
el.id = 'player';
el.hidden = true;
el.innerHTML = `
  <div class="p-click"></div>
  <div class="p-spinner"><div class="spinner"></div></div>
  <div class="p-top">
    <button class="p-btn" data-act="exit" title="Back (Esc)">${ICONS.back}</button>
    <div class="p-title"><div class="p-t1"></div><div class="p-t2"></div></div>
  </div>
  <div class="p-bottom">
    <div class="p-seek">
      <div class="p-track"><div class="p-buf"></div><div class="p-fill"></div></div>
      <div class="p-knob"></div>
      <div class="p-hover"></div>
    </div>
    <div class="p-row">
      <button class="p-btn big" data-act="pause" title="Play/Pause (Space)"></button>
      <button class="p-btn" data-act="rew" title="Back 10s (←)">${ICONS.rew}</button>
      <button class="p-btn" data-act="fwd" title="Forward 30s (→)">${ICONS.fwd}</button>
      <div class="p-time"></div>
      <div class="p-spacer"></div>
      <button class="p-btn p-next" data-act="next" title="Next episode (N)" hidden>${ICONS.next}<span>Next episode</span></button>
      <button class="p-btn" data-act="mute" title="Mute (M)"></button>
      <input class="p-vol" type="range" min="0" max="100" step="1" title="Volume (↑/↓)">
      <button class="p-btn" data-act="fs" title="Fullscreen (F or double-click)"></button>
    </div>
  </div>
  <div class="p-upnext" hidden>
    <div class="p-up-label">Up next in <b class="p-up-count">10</b></div>
    <div class="p-up-title"></div>
    <div class="p-up-btns">
      <button class="btn" data-act="up-now">Play now</button>
      <button class="btn secondary" data-act="up-cancel">Cancel</button>
    </div>
  </div>`;
document.body.appendChild(el);
const $ = (s) => el.querySelector(s);

const fmt = (t) => {
  t = Math.max(0, Math.floor(t || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
};

const cmd = (...args) => invoke('player_command', { args: args.map(String) }).catch(() => {});
const setProp = (name, value) => invoke('player_set', { name, value: String(value) }).catch(() => {});

// ---------- Drawing ----------

function drawTime() {
  const d = S.duration || S.item?.RunTimeTicks / 1e7 || 0;
  const pct = d ? Math.min(100, (S.pos / d) * 100) : 0;
  if (!S.dragging) {
    $('.p-fill').style.width = pct + '%';
    $('.p-knob').style.left = pct + '%';
  }
  $('.p-buf').style.width = d ? Math.min(100, (S.cache / d) * 100) + '%' : '0';
  $('.p-time').textContent = `${fmt(S.pos)} / ${fmt(d)}`;
}

function drawButtons() {
  $('[data-act=pause]').innerHTML = S.paused ? ICONS.play : ICONS.pause;
  $('[data-act=mute]').innerHTML = S.muted || S.volume === 0 ? ICONS.muted : ICONS.vol;
  $('[data-act=fs]').innerHTML = S.fullscreen ? ICONS.fsExit : ICONS.fs;
  $('.p-vol').value = S.volume;
  $('.p-vol').style.setProperty('--v', S.volume + '%');
  $('.p-next').hidden = !S.next;
  el.classList.toggle('buffering', S.buffering);
  el.classList.toggle('paused', S.paused);
}

function drawTitle() {
  const it = S.item;
  if (!it) {
    $('.p-t1').textContent = 'Loading…';
    $('.p-t2').textContent = '';
    return;
  }
  if (it.Type === 'Episode') {
    $('.p-t1').textContent = it.SeriesName || '';
    $('.p-t2').textContent = [epCode(it), it.Name].filter(Boolean).join(' · ');
  } else {
    $('.p-t1').textContent = it.Name;
    $('.p-t2').textContent = it.ProductionYear || '';
  }
}

// ---------- Show / hide controls ----------

let idleTimer;
function wake() {
  el.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!S.paused && !S.dragging && !el.matches('.p-bottom:hover, .p-top:hover')) el.classList.add('idle');
  }, 3000);
}
el.addEventListener('mousemove', wake);

// ---------- Opening and closing ----------

function showOverlay() {
  if (!S.embedded) return;
  S.open = true;
  el.hidden = false;
  document.documentElement.classList.add('playing');
  wake();
}

async function hideOverlay() {
  const wasOpen = S.open;
  S.open = false;
  el.hidden = true;
  document.documentElement.classList.remove('playing');
  hideUpNext();
  if (S.fullscreen) await setFullscreen(false);
  if (wasOpen) window.dispatchEvent(new Event('scrappy:refresh'));
}

export async function startPlayback(id, fromStart = false) {
  if (S.starting) return;
  S.starting = true;
  S.embedded = localStorage.getItem('playerMode') !== 'window';
  hideUpNext();
  S.item = null; S.pos = 0; S.duration = 0; S.cache = 0; S.buffering = true; S.next = null;
  drawTitle(); drawTime(); drawButtons();
  showOverlay();
  if (!S.embedded) toast('Starting playback…', false, 2500);
  try {
    const res = await api.play(id, fromStart, S.embedded);
    S.item = res.item;
    drawTitle();
    findNext(res.item);
  } catch (e) {
    toast(String(e), true, 8000);
    if (!S.item) await exitPlayer();
  } finally {
    S.starting = false;
  }
}

export async function exitPlayer() {
  hideUpNext();
  await invoke('stop_playback').catch(() => {});
  await hideOverlay();
}

// Find the episode after this one, for Next / auto-play.
async function findNext(it) {
  if (it.Type !== 'Episode' || !it.SeriesId) return;
  try {
    const data = await api.get(`/Shows/${it.SeriesId}/Episodes?UserId={userId}&StartItemId=${it.Id}&Limit=2&Fields=PrimaryImageAspectRatio`);
    let items = data.Items || [];
    let next = items[0]?.Id === it.Id ? items[1] : null;
    if (!items.length || items[0].Id !== it.Id) {
      // Older servers ignore StartItemId: fall back to the full list.
      const all = (await api.get(`/Shows/${it.SeriesId}/Episodes?UserId={userId}`)).Items || [];
      const i = all.findIndex((e) => e.Id === it.Id);
      next = i >= 0 ? all[i + 1] : null;
    }
    if (S.item?.Id === it.Id) {
      S.next = next || null;
      drawButtons();
    }
  } catch {}
}

// ---------- Up next ----------

function showUpNext() {
  const n = S.next;
  if (!n) return false;
  let count = 10;
  $('.p-up-title').textContent = [epCode(n), n.Name].filter(Boolean).join(' · ');
  $('.p-up-count').textContent = count;
  $('.p-upnext').hidden = !S.embedded;
  S.upNextTimer = setInterval(() => {
    count--;
    $('.p-up-count').textContent = count;
    if (count <= 0) playNext();
  }, 1000);
  if (!S.embedded) { clearInterval(S.upNextTimer); S.upNextTimer = null; playNext(); }
  return true;
}

function hideUpNext() {
  clearInterval(S.upNextTimer);
  S.upNextTimer = null;
  $('.p-upnext').hidden = true;
}

function playNext() {
  const n = S.next;
  hideUpNext();
  if (n) startPlayback(n.Id, true);
}

// ---------- Events from mpv ----------

listen('mpv-prop', ({ payload: { name, value } }) => {
  switch (name) {
    case 'time-pos': S.pos = value ?? 0; drawTime(); break;
    case 'duration': S.duration = value ?? 0; drawTime(); break;
    case 'demuxer-cache-time': S.cache = value ?? 0; drawTime(); break;
    case 'pause': S.paused = !!value; drawButtons(); wake(); break;
    case 'paused-for-cache': case 'seeking': S.buffering = !!value; drawButtons(); break;
    case 'volume': if (value != null) { S.volume = Math.round(value); drawButtons(); } break;
    case 'mute': S.muted = !!value; drawButtons(); break;
  }
});

listen('player-loaded', () => {
  S.buffering = false;
  drawButtons();
  setProp('volume', S.volume);
});

listen('player-ended', ({ payload }) => {
  if (payload.error) {
    toast(payload.error, true, 8000);
    exitPlayer();
    return;
  }
  if (S.starting) return; // we're already switching to another file
  const autoplay = localStorage.getItem('autoplay') !== 'off';
  if (payload.eof && autoplay && showUpNext()) return;
  exitPlayer();
});

listen('player-closed', () => {
  if (S.starting) return;
  if (S.open) hideOverlay();
  else window.dispatchEvent(new Event('scrappy:refresh'));
});

// ---------- Controls ----------

async function setFullscreen(on) {
  S.fullscreen = await invoke('set_fullscreen', { on }).catch(() => false);
  drawButtons();
}
const toggleFullscreen = () => setFullscreen(!S.fullscreen);
const togglePause = () => cmd('cycle', 'pause');
const seekBy = (s) => { cmd('seek', s, 'relative'); S.pos = Math.max(0, S.pos + s); drawTime(); wake(); };
const changeVolume = (d) => {
  S.volume = Math.max(0, Math.min(100, S.volume + d));
  localStorage.setItem('volume', S.volume);
  setProp('volume', S.volume);
  if (S.muted) setProp('mute', 'no');
  drawButtons();
};

el.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  e.stopPropagation();
  switch (b.dataset.act) {
    case 'exit': exitPlayer(); break;
    case 'pause': togglePause(); break;
    case 'rew': seekBy(-10); break;
    case 'fwd': seekBy(30); break;
    case 'next': playNext(); break;
    case 'mute': setProp('mute', S.muted ? 'no' : 'yes'); break;
    case 'fs': toggleFullscreen(); break;
    case 'up-now': playNext(); break;
    case 'up-cancel': hideUpNext(); exitPlayer(); break;
  }
});

// Click the picture to pause, double-click for fullscreen.
let clickTimer;
$('.p-click').addEventListener('click', () => {
  clearTimeout(clickTimer);
  clickTimer = setTimeout(togglePause, 230);
});
$('.p-click').addEventListener('dblclick', () => {
  clearTimeout(clickTimer);
  toggleFullscreen();
});

$('.p-vol').addEventListener('input', (e) => {
  S.volume = Number(e.target.value);
  localStorage.setItem('volume', S.volume);
  setProp('volume', S.volume);
  if (S.muted) setProp('mute', 'no');
  drawButtons();
});

// Seek bar: click or drag.
const seek = $('.p-seek');
const ratioAt = (x) => {
  const r = seek.getBoundingClientRect();
  return Math.max(0, Math.min(1, (x - r.left) / r.width));
};
const dur = () => S.duration || S.item?.RunTimeTicks / 1e7 || 0;
seek.addEventListener('mousemove', (e) => {
  const r = ratioAt(e.clientX);
  const h = $('.p-hover');
  h.textContent = fmt(r * dur());
  h.style.left = r * 100 + '%';
});
seek.addEventListener('mousedown', (e) => {
  S.dragging = true;
  const move = (ev) => {
    const r = ratioAt(ev.clientX);
    $('.p-fill').style.width = r * 100 + '%';
    $('.p-knob').style.left = r * 100 + '%';
    $('.p-time').textContent = `${fmt(r * dur())} / ${fmt(dur())}`;
  };
  const up = (ev) => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    const t = ratioAt(ev.clientX) * dur();
    S.pos = t;
    S.dragging = false;
    cmd('seek', t.toFixed(2), 'absolute');
    drawTime();
  };
  move(e);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// Keyboard (only while the player is open).
window.addEventListener('keydown', (e) => {
  if (!S.open) return;
  const k = e.key;
  const handled = true;
  switch (k) {
    case ' ': case 'k': case 'K': togglePause(); break;
    case 'ArrowLeft': seekBy(e.shiftKey ? -60 : -10); break;
    case 'ArrowRight': seekBy(e.shiftKey ? 60 : 30); break;
    case 'ArrowUp': changeVolume(5); break;
    case 'ArrowDown': changeVolume(-5); break;
    case 'm': case 'M': setProp('mute', S.muted ? 'no' : 'yes'); break;
    case 'f': case 'F': case 'F11': toggleFullscreen(); break;
    case 'n': case 'N': if (S.next) playNext(); break;
    case 'Escape': if (S.fullscreen) setFullscreen(false); else exitPlayer(); break;
    case 'Backspace': exitPlayer(); break;
    default: return;
  }
  if (handled) { e.preventDefault(); e.stopImmediatePropagation(); wake(); }
}, true);

drawButtons();
