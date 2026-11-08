// Scrappy's own player screen. mpv draws the video into the window behind
// this page; this file draws the controls on top and talks to mpv.
import { api, listen, img } from './api.js';
import { esc, toast, epCode, runtime } from './components.js';

const { invoke } = window.__TAURI__.core;

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 5v14l9-7zM16 5h2.5v14H16z"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  muted: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  fs: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  fsExit: '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  cog: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  skip: '<svg viewBox="0 0 24 24"><path d="M5 5l8 7-8 7zM13 5l8 7-8 7z"/></svg>',
};

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SUB_SIZES = [['0.8', 'Small'], ['1', 'Medium'], ['1.25', 'Large'], ['1.5', 'Extra large']];
const ASPECTS = [['auto', 'Auto'], ['16:9', '16:9'], ['4:3', '4:3'], ['2.35:1', '2.35:1'], ['fill', 'Fill screen'], ['stretch', 'Stretch']];
const QUALITIES = [
  ['', 'Original (direct play)'], ['40000000', '40 Mbps · 4K'], ['20000000', '20 Mbps · 1080p'],
  ['10000000', '10 Mbps · 1080p'], ['6000000', '6 Mbps · 720p'], ['3000000', '3 Mbps · 720p'], ['1500000', '1.5 Mbps · 480p'],
];
const SKIPS = [5, 10, 15, 20, 30, 60];

const ls = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  json: (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
};

const S = {
  open: false, embedded: true, item: null, pos: 0, duration: 0, paused: false,
  buffering: true, cache: 0, volume: Number(ls.get('volume', 100)), muted: false,
  next: null, fullscreen: false, dragging: false, upNextTimer: null, starting: false,
  tracks: [], aid: null, sid: null, lastSid: null, speed: 1, subScale: ls.get('subScale', '1'),
  aspect: 'auto', quality: ls.get('quality', ''), intro: null, credits: null,
  creditsHandled: false, introDismissed: false, prefsApplied: false, settingsOpen: false,
};
const skipBack = () => Number(ls.get('skipBack', 10));
const skipFwd = () => Number(ls.get('skipFwd', 10));

const el = document.createElement('div');
el.id = 'player';
el.hidden = true;
el.innerHTML = `
  <div class="p-click"></div>
  <div class="p-spinner"><div class="spinner"></div></div>
  <div class="p-top">
    <button class="p-btn" data-act="exit" title="Back (Esc)" aria-label="Back">${ICONS.back}</button>
    <div class="p-title"><div class="p-t1"></div><div class="p-t2"></div></div>
  </div>
  <button class="p-skip" data-act="skip" hidden>${ICONS.skip}<span>Skip Intro</span><i class="p-skip-bar"></i></button>
  <div class="p-upnext" hidden>
    <div class="p-up-main">
      <div class="p-up-thumb"></div>
      <div class="p-up-text">
        <div class="p-up-label">Up next in <b class="p-up-count">10</b></div>
        <div class="p-up-title"></div>
        <div class="p-up-meta"></div>
      </div>
    </div>
    <div class="p-up-btns">
      <button class="btn" data-act="up-now">Next episode</button>
      <button class="btn secondary" data-act="up-cancel">Cancel</button>
    </div>
  </div>
  <div class="p-settings" hidden>
    <div class="p-set-head"><b>Playback settings</b><span class="p-set-scope"></span></div>
    <label>Audio<select data-set="audio"></select></label>
    <label>Subtitles<select data-set="sub"></select></label>
    <div class="p-set-2">
      <label>Subtitle size<select data-set="subScale">${SUB_SIZES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label>Speed<select data-set="speed">${SPEEDS.map((v) => `<option value="${v}">${v}×</option>`).join('')}</select></label>
    </div>
    <div class="p-set-2">
      <label>Aspect ratio<select data-set="aspect">${ASPECTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label>Quality<select data-set="quality">${QUALITIES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
    </div>
    <div class="p-set-2">
      <label>Skip back (−)<select data-set="skipBack">${SKIPS.map((v) => `<option value="${v}">${v} seconds</option>`).join('')}</select></label>
      <label>Skip forward (+)<select data-set="skipFwd">${SKIPS.map((v) => `<option value="${v}">${v} seconds</option>`).join('')}</select></label>
    </div>
    <div class="p-set-note"></div>
  </div>
  <div class="p-bottom">
    <div class="p-seek-row">
      <span class="p-cur">0:00</span>
      <div class="p-seek">
        <div class="p-track"><div class="p-buf"></div><div class="p-fill"></div></div>
        <div class="p-knob"></div>
        <div class="p-hover"></div>
      </div>
      <span class="p-dur">0:00</span>
    </div>
    <div class="p-row">
      <button class="p-pill" data-act="rew" title="Skip back (←)"></button>
      <button class="p-play" data-act="pause" title="Play/Pause (Space)" aria-label="Play or pause"></button>
      <button class="p-pill" data-act="fwd" title="Skip forward (→)"></button>
      <div class="p-spacer"></div>
      <button class="p-btn p-next" data-act="next" title="Next episode (N)" hidden>${ICONS.next}<span>Next episode</span></button>
      <button class="p-btn" data-act="mute" title="Mute (M)" aria-label="Mute"></button>
      <input class="p-vol" type="range" min="0" max="100" step="1" title="Volume (↑/↓)" aria-label="Volume">
      <button class="p-btn p-cc" data-act="cc" title="Subtitles on/off (C)">CC</button>
      <button class="p-speed" data-act="speed" title="Playback speed"></button>
      <button class="p-btn p-cog" data-act="settings" title="Settings" aria-label="Settings">${ICONS.cog}</button>
      <button class="p-btn" data-act="fs" title="Fullscreen (F or double-click)" aria-label="Fullscreen"></button>
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
const dur = () => S.duration || S.item?.RunTimeTicks / 1e7 || 0;

// ---------- Tracks and per-show memory ----------

let langNames;
try { langNames = new Intl.DisplayNames(['en'], { type: 'language' }); } catch {}
const langName = (code) => {
  if (!code) return '';
  try { return langNames?.of(code) || code; } catch { return code; }
};
const channels = (n) => ({ 1: 'Mono', 2: 'Stereo', 6: '5.1', 7: '6.1', 8: '7.1' }[n] || (n ? `${n}ch` : ''));

function trackLabel(t) {
  const parts = [langName(t.lang) || (t.type === 'sub' ? 'Unknown' : '')];
  if (t.title && t.title !== langName(t.lang)) parts.push(t.title);
  const tech = [(t.codec || '').toUpperCase(), t.type === 'audio' ? channels(t['demux-channel-count']) : ''].filter(Boolean).join(' ');
  if (tech) parts.push(tech);
  const flags = [t.default && 'Default', t.forced && 'Forced', t.external && 'External'].filter(Boolean);
  let s = parts.filter(Boolean).join(' · ') || `Track ${t.id}`;
  if (flags.length) s += ` (${flags.join(', ')})`;
  return s;
}

const prefsKey = () => (S.item ? 'show:' + (S.item.SeriesId || S.item.Id) : null);
const loadPrefs = () => (prefsKey() && ls.json(prefsKey())) || {};
function savePrefs(patch) {
  const k = prefsKey();
  if (!k) return;
  ls.set(k, JSON.stringify({ ...loadPrefs(), ...patch }));
}
const trackRef = (t) => (t ? { lang: t.lang || '', title: t.title || '', forced: !!t.forced } : null);
function findTrack(type, ref) {
  if (!ref) return null;
  const list = S.tracks.filter((t) => t.type === type);
  return list.find((t) => (t.lang || '') === ref.lang && (t.title || '') === ref.title && !!t.forced === ref.forced)
    || list.find((t) => (t.lang || '') === ref.lang && !!t.forced === ref.forced)
    || list.find((t) => (t.lang || '') === ref.lang)
    || null;
}

// Re-apply what was chosen last time for this show.
function applyPrefs() {
  const p = loadPrefs();
  if (p.audio) {
    const t = findTrack('audio', p.audio);
    if (t && t.id !== S.aid) setProp('aid', t.id);
  }
  if (p.sub === 'off') setProp('sid', 'no');
  else if (p.sub) {
    const t = findTrack('sub', p.sub);
    if (t && t.id !== S.sid) setProp('sid', t.id);
  }
  if (p.speed) setProp('speed', p.speed);
}

// ---------- Drawing ----------

function drawTime() {
  const d = dur();
  const pct = d ? Math.min(100, (S.pos / d) * 100) : 0;
  if (!S.dragging) {
    $('.p-fill').style.width = pct + '%';
    $('.p-knob').style.left = pct + '%';
    $('.p-cur').textContent = fmt(S.pos);
  }
  $('.p-buf').style.width = d ? Math.min(100, (S.cache / d) * 100) + '%' : '0';
  $('.p-dur').textContent = fmt(d);
}

// Replay the little "tick" pop on a button.
function bounce(b) {
  b.classList.remove('tick');
  void b.offsetWidth;
  b.classList.add('tick');
}

function drawButtons() {
  const playBtn = $('[data-act=pause]');
  const playIcon = S.paused ? ICONS.play : ICONS.pause;
  if (playBtn.dataset.icon !== playIcon) {
    if (playBtn.dataset.icon) bounce(playBtn);
    playBtn.dataset.icon = playIcon;
    playBtn.innerHTML = playIcon;
  }
  $('[data-act=mute]').innerHTML = S.muted || S.volume === 0 ? ICONS.muted : ICONS.vol;
  $('[data-act=fs]').innerHTML = S.fullscreen ? ICONS.fsExit : ICONS.fs;
  $('[data-act=rew]').textContent = `−${skipBack()}`;
  $('[data-act=fwd]').textContent = `+${skipFwd()}`;
  const speedBtn = $('[data-act=speed]');
  if (speedBtn.textContent !== `${S.speed}×`) {
    if (speedBtn.textContent) bounce(speedBtn);
    speedBtn.textContent = `${S.speed}×`;
  }
  $('.p-cc').classList.toggle('on', S.sid != null);
  $('.p-cc').setAttribute('aria-pressed', String(S.sid != null));
  $('.p-cog').classList.toggle('on', S.settingsOpen);
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

function drawSettings() {
  const audio = S.tracks.filter((t) => t.type === 'audio');
  const subs = S.tracks.filter((t) => t.type === 'sub');
  $('[data-set=audio]').innerHTML = audio.length
    ? audio.map((t) => `<option value="${t.id}" ${t.id === S.aid ? 'selected' : ''}>${esc(trackLabel(t))}</option>`).join('')
    : '<option>No audio tracks</option>';
  $('[data-set=sub]').innerHTML = `<option value="no" ${S.sid == null ? 'selected' : ''}>Off</option>` +
    subs.map((t) => `<option value="${t.id}" ${t.id === S.sid ? 'selected' : ''}>${esc(trackLabel(t))}</option>`).join('');
  $('[data-set=subScale]').value = S.subScale;
  $('[data-set=speed]').value = String(S.speed);
  $('[data-set=aspect]').value = S.aspect;
  $('[data-set=quality]').value = S.quality;
  $('[data-set=skipBack]').value = String(skipBack());
  $('[data-set=skipFwd]').value = String(skipFwd());
  const name = S.item?.SeriesName || S.item?.Name || 'this title';
  $('.p-set-scope').textContent = S.item?.SeriesName ? 'for this show' : 'for this title';
  $('.p-set-note').textContent = `Audio, subtitles and speed are remembered for ${name}. Skip lengths and quality apply everywhere.`;
}

// ---------- Skip Intro / credits ----------

function readMarkers(it) {
  const ch = it?.Chapters || [];
  const at = (type) => ch.find((c) => c.MarkerType === type)?.StartPositionTicks;
  const is = at('IntroStart'), ie = at('IntroEnd'), cs = at('CreditsStart');
  S.intro = is != null && ie != null && ie > is ? { start: is / 1e7, end: ie / 1e7 } : null;
  S.credits = cs != null ? cs / 1e7 : null;
}

let skipMode = null; // 'intro' | 'credits'
function showSkip(mode) {
  if (skipMode === mode) return;
  skipMode = mode;
  $('.p-skip span').textContent = mode === 'intro' ? 'Skip Intro' : 'Skip Credits';
  $('.p-skip').hidden = !mode;
}

function checkMarkers() {
  if (!S.open || S.starting) return;
  const p = S.pos;
  // Intro
  if (S.intro && p >= S.intro.start && p < S.intro.end - 1 && !S.introDismissed) {
    showSkip('intro');
    const left = (S.intro.end - p) / (S.intro.end - S.intro.start);
    $('.p-skip-bar').style.width = Math.max(0, Math.min(100, left * 100)) + '%';
  } else if (skipMode === 'intro') {
    showSkip(null);
  }
  if (S.intro && p < S.intro.start) S.introDismissed = false;

  // Credits
  if (S.credits != null) {
    if (p < S.credits - 2 && S.creditsHandled) {
      // Seeked back before the credits: reset.
      S.creditsHandled = false;
      if (S.upNextMode === 'credits') hideUpNext();
      if (skipMode === 'credits') showSkip(null);
    }
    if (p >= S.credits && !S.creditsHandled) {
      S.creditsHandled = true;
      const autoplay = ls.get('autoplay', 'on') !== 'off';
      if (S.next && autoplay) showUpNext('credits');
      else if (S.next) showSkip('credits');
      else showSkip('credits');
    }
  }
}

function doSkip() {
  if (skipMode === 'intro' && S.intro) {
    cmd('seek', S.intro.end.toFixed(2), 'absolute');
    S.introDismissed = true;
    showSkip(null);
  } else if (skipMode === 'credits') {
    showSkip(null);
    if (S.next) playNext();
    else exitPlayer();
  }
}

// ---------- Show / hide controls ----------

let idleTimer;
function wake() {
  el.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!S.paused && !S.dragging && !S.settingsOpen && !el.querySelector('.p-bottom:hover, .p-top:hover')) el.classList.add('idle');
  }, 3000);
}
el.addEventListener('mousemove', wake);

function toggleSettings(force) {
  S.settingsOpen = force ?? !S.settingsOpen;
  $('.p-settings').hidden = !S.settingsOpen;
  if (S.settingsOpen) drawSettings();
  drawButtons();
  wake();
}

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
  showSkip(null);
  toggleSettings(false);
  if (S.fullscreen) await setFullscreen(false);
  if (wasOpen) window.dispatchEvent(new Event('scrappy:refresh'));
}

// opts: { fromStart, startSecs, keepItem }
export async function startPlayback(id, opts = {}) {
  if (S.starting) return;
  S.starting = true;
  S.embedded = ls.get('playerMode', 'embedded') !== 'window';
  hideUpNext();
  showSkip(null);
  if (!opts.keepItem) {
    S.item = null; S.next = null; S.intro = null; S.credits = null;
    S.aspect = 'auto';
  }
  S.pos = opts.startSecs || 0; S.duration = 0; S.cache = 0; S.buffering = true;
  S.tracks = []; S.aid = null; S.sid = null; S.prefsApplied = false;
  S.creditsHandled = false; S.introDismissed = false;
  drawTitle(); drawTime(); drawButtons();
  showOverlay();
  if (!S.embedded) toast('Starting playback…', false, 2500);
  try {
    const res = await api.play(id, {
      fromStart: !!opts.fromStart,
      embedded: S.embedded,
      startSecs: opts.startSecs ?? null,
      maxBitrate: S.quality ? Number(S.quality) : null,
    });
    S.item = res.item;
    readMarkers(res.item);
    drawTitle();
    if (!opts.keepItem) findNext(res.item);
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
    const items = data.Items || [];
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

// mode 'credits': credits started (secondary button = Watch credits)
// mode 'end': the episode finished (secondary button = Cancel)
function showUpNext(mode) {
  const n = S.next;
  if (!n) return false;
  hideUpNext();
  S.upNextMode = mode;
  let count = 10;
  const thumb = n.ImageTags?.Primary ? img(n.Id, 'Primary', n.ImageTags.Primary, 320) : null;
  $('.p-up-thumb').innerHTML = thumb ? `<img src="${esc(thumb)}" alt="">` : '';
  $('.p-up-title').textContent = [epCode(n), n.Name].filter(Boolean).join(' · ');
  $('.p-up-meta').textContent = runtime(n.RunTimeTicks);
  $('.p-up-count').textContent = count;
  $('[data-act=up-cancel]').textContent = mode === 'credits' ? 'Watch credits' : 'Cancel';
  if (!S.embedded) { playNext(); return true; }
  $('.p-upnext').hidden = false;
  S.upNextTimer = setInterval(() => {
    count--;
    $('.p-up-count').textContent = count;
    if (count <= 0) playNext();
  }, 1000);
  return true;
}

function hideUpNext() {
  clearInterval(S.upNextTimer);
  S.upNextTimer = null;
  S.upNextMode = null;
  $('.p-upnext').hidden = true;
}

function playNext() {
  const n = S.next;
  hideUpNext();
  if (n) startPlayback(n.Id, { fromStart: true });
}

// ---------- Events from mpv ----------

listen('mpv-prop', ({ payload: { name, value } }) => {
  switch (name) {
    case 'time-pos': S.pos = value ?? 0; drawTime(); checkMarkers(); break;
    case 'duration': S.duration = value ?? 0; drawTime(); break;
    case 'demuxer-cache-time': S.cache = value ?? 0; drawTime(); break;
    case 'pause': S.paused = !!value; drawButtons(); wake(); break;
    case 'paused-for-cache': case 'seeking': S.buffering = !!value; drawButtons(); break;
    case 'volume': if (value != null) { S.volume = Math.round(value); drawButtons(); } break;
    case 'mute': S.muted = !!value; drawButtons(); break;
    case 'speed': if (value != null) { S.speed = Math.round(value * 100) / 100; drawButtons(); } break;
    case 'track-list': {
      S.tracks = Array.isArray(value) ? value : [];
      const a = S.tracks.find((t) => t.type === 'audio' && t.selected);
      const s = S.tracks.find((t) => t.type === 'sub' && t.selected);
      S.aid = a ? a.id : null;
      S.sid = s ? s.id : null;
      if (S.sid != null) S.lastSid = S.sid;
      if (S.settingsOpen) drawSettings();
      drawButtons();
      break;
    }
  }
});

listen('player-loaded', () => {
  S.buffering = false;
  drawButtons();
  setProp('volume', S.volume);
  setProp('sub-scale', S.subScale);
  applyAspect();
  // External subtitles are added just after loading; give them a moment.
  setTimeout(() => { if (!S.prefsApplied) { S.prefsApplied = true; applyPrefs(); } }, 700);
});

listen('player-ended', ({ payload }) => {
  if (payload.error) {
    toast(payload.error, true, 8000);
    exitPlayer();
    return;
  }
  if (S.starting) return; // we're already switching to another file
  const autoplay = ls.get('autoplay', 'on') !== 'off';
  if (payload.eof && S.next && (autoplay || S.upNextMode === 'credits')) {
    if (S.upNextMode !== 'credits') showUpNext('end');
    return;
  }
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
  ls.set('volume', S.volume);
  setProp('volume', S.volume);
  if (S.muted) setProp('mute', 'no');
  drawButtons();
};

function setSpeed(v) {
  S.speed = v;
  setProp('speed', v);
  savePrefs({ speed: v });
  drawButtons();
}
function cycleSpeed() {
  const i = SPEEDS.indexOf(S.speed);
  setSpeed(SPEEDS[(i + 1) % SPEEDS.length] ?? 1);
}

function toggleSubs() {
  if (S.sid != null) {
    setProp('sid', 'no');
    savePrefs({ sub: 'off' });
    return;
  }
  const subs = S.tracks.filter((t) => t.type === 'sub');
  if (!subs.length) { toast('This video has no subtitles.'); return; }
  const pref = loadPrefs().sub;
  const t = subs.find((x) => x.id === S.lastSid) || (pref && pref !== 'off' && findTrack('sub', pref))
    || subs.find((x) => x.default) || subs[0];
  setProp('sid', t.id);
  savePrefs({ sub: trackRef(t) });
}

function applyAspect() {
  const a = S.aspect;
  setProp('video-aspect-override', ['auto', 'fill', 'stretch'].includes(a) ? 'no' : a);
  setProp('panscan', a === 'fill' ? '1.0' : '0.0');
  setProp('keepaspect', a === 'stretch' ? 'no' : 'yes');
}

// Settings panel changes
el.querySelector('.p-settings').addEventListener('change', (e) => {
  const sel = e.target.closest('select');
  if (!sel) return;
  const v = sel.value;
  switch (sel.dataset.set) {
    case 'audio': {
      setProp('aid', v);
      savePrefs({ audio: trackRef(S.tracks.find((t) => String(t.id) === v)) });
      break;
    }
    case 'sub': {
      setProp('sid', v);
      savePrefs({ sub: v === 'no' ? 'off' : trackRef(S.tracks.find((t) => String(t.id) === v)) });
      break;
    }
    case 'subScale': S.subScale = v; ls.set('subScale', v); setProp('sub-scale', v); break;
    case 'speed': setSpeed(Number(v)); break;
    case 'aspect': S.aspect = v; applyAspect(); break;
    case 'quality': {
      S.quality = v;
      ls.set('quality', v);
      // Reload the same video at the current spot with the new quality.
      if (S.item) startPlayback(S.item.Id, { startSecs: S.pos, keepItem: true });
      break;
    }
    case 'skipBack': ls.set('skipBack', v); drawButtons(); break;
    case 'skipFwd': ls.set('skipFwd', v); drawButtons(); break;
  }
});

el.addEventListener('click', (e) => {
  if (S.settingsOpen && !e.target.closest('.p-settings, [data-act=settings]')) toggleSettings(false);
  const b = e.target.closest('[data-act]');
  if (!b) return;
  e.stopPropagation();
  switch (b.dataset.act) {
    case 'exit': exitPlayer(); break;
    case 'pause': togglePause(); break;
    case 'rew': seekBy(-skipBack()); break;
    case 'fwd': seekBy(skipFwd()); break;
    case 'next': playNext(); break;
    case 'mute': setProp('mute', S.muted ? 'no' : 'yes'); break;
    case 'cc': toggleSubs(); break;
    case 'speed': cycleSpeed(); break;
    case 'settings': toggleSettings(); break;
    case 'fs': toggleFullscreen(); break;
    case 'skip': doSkip(); break;
    case 'up-now': playNext(); break;
    case 'up-cancel':
      if (S.upNextMode === 'credits') hideUpNext();
      else { hideUpNext(); exitPlayer(); }
      break;
  }
});

// Click the picture to pause, double-click for fullscreen.
let clickTimer;
$('.p-click').addEventListener('click', () => {
  if (S.settingsOpen) return;
  clearTimeout(clickTimer);
  clickTimer = setTimeout(togglePause, 230);
});
$('.p-click').addEventListener('dblclick', () => {
  clearTimeout(clickTimer);
  toggleFullscreen();
});

$('.p-vol').addEventListener('input', (e) => {
  S.volume = Number(e.target.value);
  ls.set('volume', S.volume);
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
    $('.p-cur').textContent = fmt(r * dur());
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
  if (e.target.closest?.('select')) return; // let dropdowns use the arrow keys
  switch (e.key) {
    case ' ': case 'k': case 'K': togglePause(); break;
    case 'ArrowLeft': seekBy(-(e.shiftKey ? 60 : skipBack())); break;
    case 'ArrowRight': seekBy(e.shiftKey ? 60 : skipFwd()); break;
    case 'ArrowUp': changeVolume(5); break;
    case 'ArrowDown': changeVolume(-5); break;
    case 'm': case 'M': setProp('mute', S.muted ? 'no' : 'yes'); break;
    case 'c': case 'C': toggleSubs(); break;
    case 'f': case 'F': case 'F11': toggleFullscreen(); break;
    case 'n': case 'N': if (S.next) playNext(); break;
    case 's': case 'S': if (skipMode) doSkip(); else return; break;
    case 'Escape':
      if (S.settingsOpen) toggleSettings(false);
      else if (S.fullscreen) setFullscreen(false);
      else exitPlayer();
      break;
    case 'Backspace': exitPlayer(); break;
    default: return;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
  wake();
}, true);

drawButtons();
