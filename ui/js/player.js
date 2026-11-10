// Scrappy's own player screen. mpv draws the video into the window behind
// this page; this file draws the controls on top and talks to mpv.
import { api, listen, img, load, IMG_BASE } from './api.js';
import { esc, toast, epCode, runtime } from './components.js';

const { invoke } = window.__TAURI__.core;

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></g></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2z"/><path d="M5 5.5v13L15 12z"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></g></svg>',
  muted: '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></g></svg>',
  fs: '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></g></svg>',
  fsExit: '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></g></svg>',
  cog: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  skip: '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6l7 6-7 6M13 6l7 6-7 6"/></g></svg>',
  eps: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="5" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="14" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
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
  <button class="p-skip" data-act="skip" aria-hidden="true" tabindex="-1">${ICONS.skip}<span>Skip Intro</span><i class="p-skip-bar"></i></button>
  <div class="p-upnext" aria-hidden="true">
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
  <div class="p-pauseinfo">
    <div class="p-pi-text">
      <div class="p-pi-kicker">YOU'RE WATCHING</div>
      <div class="p-pi-title"></div>
      <div class="p-pi-ep"></div>
      <div class="p-pi-overview"></div>
      <div class="p-pi-meta"></div>
    </div>
  </div>
  <div class="p-eps" aria-hidden="true">
    <div class="p-eps-head"><b class="p-eps-show"></b><div class="p-eps-tabs"></div></div>
    <div class="p-eps-row"></div>
  </div>
  <div class="p-still" hidden>
    <div class="p-still-box">
      <div class="p-still-title">ARE YOU STILL WATCHING?</div>
      <div class="p-still-sub"></div>
      <div class="p-still-btns">
        <button class="btn" data-act="still-yes">Keep watching</button>
        <button class="btn secondary" data-act="still-no">Back to browsing</button>
      </div>
    </div>
  </div>
  <div class="p-settings" aria-hidden="true">
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
        <div class="p-hover"><img class="p-thumb" alt="" hidden><span class="p-htime"></span></div>
      </div>
      <span class="p-dur">0:00</span>
    </div>
    <div class="p-row">
      <button class="p-pill" data-act="rew" title="Skip back (←)"></button>
      <button class="p-play" data-act="pause" title="Play/Pause (Space)" aria-label="Play or pause"><span class="i-pause">${ICONS.pause}</span><span class="i-play">${ICONS.play}</span></button>
      <button class="p-pill" data-act="fwd" title="Skip forward (→)"></button>
      <div class="p-ends" aria-live="off"><b></b><small></small></div>
      <div class="p-spacer"></div>
      <button class="p-btn p-epsbtn" data-act="eps" title="Episodes (E)" hidden>${ICONS.eps}<span>Episodes</span></button>
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
// Pop-ups slide in and back out (instead of popping on and off).
function reveal(sel, on) {
  const n = $(sel);
  n.classList.toggle('show', !!on);
  n.setAttribute('aria-hidden', String(!on));
  n.inert = !on;
}

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
// Audio/subtitle picks are kept apart from older saved settings, which could hold a subtitle the
// app chose by itself (not you). Only a pick you make yourself is stored here.
const trackKey = () => (S.item ? 'tracks:' + (S.item.SeriesId || S.item.Id) : null);
const loadTrackPrefs = () => (trackKey() && ls.json(trackKey())) || {};
function saveTrackPrefs(patch) { const k = trackKey(); if (k) ls.set(k, JSON.stringify({ ...loadTrackPrefs(), ...patch })); }
function savePrefs(patch) {
  const k = prefsKey();
  if (!k) return;
  ls.set(k, JSON.stringify({ ...loadPrefs(), ...patch }));
}
const trackRef = (t) => (t ? { lang: t.lang || '', title: t.title || '', forced: !!t.forced } : null);
function findTrack(type, ref) {
  if (!ref) return null;
  const list = S.tracks.filter((t) => t.type === type);
  const L = langOf(ref.lang);
  return list.find((t) => langOf(t.lang) === L && (t.title || '') === ref.title && !!t.forced === !!ref.forced)
    || list.find((t) => langOf(t.lang) === L && !!t.forced === !!ref.forced)
    || list.find((t) => langOf(t.lang) === L)
    || null;
}

// Pick the audio and subtitle tracks when a video starts:
// 1. what you picked last time for this show, otherwise
// 2. what Emby would pick for you (your Emby language settings and the file's defaults).
// Tracks can show up late (subtitle files on the server are added after the video opens),
// so this keeps trying for a few seconds until the wanted track appears.
function wanted() {
  const p = loadTrackPrefs(), d = S.defaults || {};
  return {
    audio: p.audio || d.audio || null,
    sub: p.sub || (d.subKnown ? (d.sub || 'off') : null),
  };
}
// Languages come as 'en', 'eng' or 'English' depending on where they're from.
const LANGS = { en: 'en', eng: 'en', english: 'en', de: 'de', ger: 'de', deu: 'de', german: 'de', fr: 'fr', fre: 'fr', fra: 'fr', french: 'fr', es: 'es', spa: 'es', spanish: 'es', it: 'it', ita: 'it', ja: 'ja', jpn: 'ja', japanese: 'ja' };
const langOf = (l) => { const k = String(l || '').toLowerCase().trim(); return LANGS[k] || k; };
const SUB_LANG = 'en'; // your subtitle language
const sameLang = (a, b) => !a || !b || langOf(a) === langOf(b);
function matchTrack(type, ref) {
  const list = S.tracks.filter((t) => t.type === type);
  if (ref.index != null) {
    // Emby's stream number is the same as the file's, so it's exact unless Emby is converting the video.
    if (ref.external) {
      const ext = list.filter((t) => t.external);
      return ext.find((t) => (t.title || '') === ref.displayTitle) || ext.find((t) => sameLang(t.lang, ref.lang) && t.lang) || null;
    }
    if (S.playMethod !== 'Transcode') {
      // Only trust the number when the language (or, without one, the name) agrees too.
      const t = list.find((x) => !x.external && x['ff-index'] === ref.index);
      const ok = t && (t.lang && ref.lang ? langOf(t.lang) === langOf(ref.lang) : (t.title || '') === (ref.title || ''));
      if (ok) return t;
    }
  }
  return findTrack(type, ref);
}
// A subtitle track's language, from its language tag or else the first word of its title.
const subLang = (x) => langOf(x.lang) || langOf((String(x.title || '').match(/[A-Za-z]+/) || [''])[0]);
function pickTracks() {
  if (!S.pick || S.defaults === undefined || !S.tracks.length) return;
  const w = wanted();
  const tp = loadTrackPrefs();
  if (S.pick.audio) {
    if (!w.audio) S.pick.audio = false;
    else { const t = matchTrack('audio', w.audio); if (t) { if (t.id !== S.aid) setProp('aid', t.id); S.wantAid = t.id; S.pick.audio = false; } }
  }
  if (!S.pick.sub) return;
  // The chosen subtitles are held (see holdSubs): mpv can switch by itself afterwards,
  // e.g. to forced subtitles that match the audio language.
  const use = (t) => { S.subTarget = t.id; S.lastSid = t.id; holdSubs(); };
  const off = () => { S.subTarget = 'no'; holdSubs(); };
  if (tp.sub) {
    // Your own pick for this show wins. "Off" is held off for the whole lookout.
    S.subWhy = 'your last pick for this show';
    if (tp.sub === 'off') { off(); return; }
    const t = matchTrack('sub', tp.sub);
    if (t) { use(t); S.pick.sub = false; }
    return;
  }
  // Otherwise the show's own default: the subtitles Emby itself would start with
  // (it knows the file's default flag and your Emby settings), then the subtitles
  // the file marks as default, otherwise off.
  if (w.sub && w.sub !== 'off') {
    S.subWhy = 'Emby\'s default';
    const t = matchTrack('sub', w.sub); // an external file can arrive a few seconds late
    if (t) { use(t); S.pick.sub = false; }
    return;
  }
  const fileDefault = !w.sub && S.tracks.find((x) => x.type === 'sub' && x.default);
  if (fileDefault) { use(fileDefault); S.subWhy = 'the video\'s default'; S.pick.sub = false; return; }
  S.subWhy = w.sub === 'off' ? 'Emby\'s default (off)' : 'the video\'s default (none)';
  off();
}
function stopPicking() { S.pick = null; }
// Keep the subtitles the app chose for this video, until you change them yourself.
function holdSubs() {
  if (S.subTarget == null) return;
  const want = S.subTarget === 'no' ? null : S.subTarget;
  if (S.sid !== want) setProp('sid', S.subTarget);
}
const letGoOfSubs = () => { S.subTarget = null; if (S.pick) S.pick.sub = false; };

// One-time clean-up: forget saved subtitle picks, so every show starts again on
// its own default subtitles.
try {
  if (!ls.get('subFix3')) {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('tracks:')) continue;
      const v = ls.json(k);
      if (v?.sub) { delete v.sub; ls.set(k, JSON.stringify(v)); }
    }
    ls.set('subFix3', '1');
  }
} catch {}

// ---------- Drawing ----------

// Only touch the page when a value really changed.
const shown = {};
function put(sel, key, value, apply) {
  if (shown[sel + key] === value) return;
  shown[sel + key] = value;
  apply($(sel), value);
}
const setText = (sel, v) => put(sel, 'text', v, (n, x) => { n.textContent = x; });
const setStyle = (sel, prop, v) => put(sel, prop, v, (n, x) => { n.style[prop] = x; });
const setHTML = (sel, v) => put(sel, 'html', v, (n, x) => { n.innerHTML = x; });

// mpv reports the position 4 times a second. In between, the bar glides on its own
// so it moves smoothly instead of in steps.
let posAt = 0; // when S.pos was last set
const markPos = () => { posAt = performance.now(); };
function livePos() {
  if (S.paused || S.buffering || !S.frameSeen || S.starting) return S.pos;
  const p = S.pos + Math.min(1, (performance.now() - posAt) / 1000) * (S.speed || 1);
  const d = dur();
  return d ? Math.min(p, d) : p;
}
function drawBar(pos) {
  const d = dur();
  const pct = (d ? Math.min(100, (pos / d) * 100) : 0).toFixed(3) + '%';
  setStyle('.p-fill', 'width', pct);
  setStyle('.p-knob', 'left', pct);
  setText('.p-cur', fmt(pos));
}
function drawTime() {
  const d = dur();
  if (!S.dragging) drawBar(livePos());
  setStyle('.p-buf', 'width', d ? Math.min(100, (S.cache / d) * 100).toFixed(2) + '%' : '0');
  setText('.p-dur', fmt(d));
  drawEnds();
}

// "Ends at 10:42 PM" and the time left, counting playback speed.
// While paused the clock still moves, so refresh it now and then.
setInterval(() => { if (S.open) drawEnds(); }, 10000);
function drawEnds() {
  const d = dur();
  if (!d) { setText('.p-ends b', ''); setText('.p-ends small', ''); return; }
  const left = Math.max(0, d - livePos()) / (S.speed || 1);
  const ends = new Date(Date.now() + left * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const mins = Math.ceil(left / 60);
  const h = Math.floor(mins / 60), m = mins % 60;
  setText('.p-ends b', `Ends at ${ends}`);
  setText('.p-ends small', `${h ? `${h} h ${m} min` : `${mins} min`} left`);
}
let glideRaf = 0;
function glide() {
  glideRaf = 0;
  if (!S.open) return;
  if (!S.dragging && !el.classList.contains('idle')) drawBar(livePos());
  glideRaf = requestAnimationFrame(glide);
}
const startGlide = () => { if (!glideRaf) glideRaf = requestAnimationFrame(glide); };

// Replay the little "tick" pop on a button.
function bounce(b) {
  b.classList.remove('tick');
  void b.offsetWidth;
  b.classList.add('tick');
}

function drawButtons() {
  $('[data-act=pause]').classList.toggle('is-paused', S.paused);
  setHTML('[data-act=mute]', S.muted || S.volume === 0 ? ICONS.muted : ICONS.vol);
  setHTML('[data-act=fs]', S.fullscreen ? ICONS.fsExit : ICONS.fs);
  setText('[data-act=rew]', `−${skipBack()}`);
  setText('[data-act=fwd]', `+${skipFwd()}`);
  const speedBtn = $('[data-act=speed]');
  if (speedBtn.textContent !== `${S.speed}×`) {
    if (speedBtn.textContent) bounce(speedBtn);
    speedBtn.textContent = `${S.speed}×`;
  }
  $('.p-cc').classList.toggle('on', S.sid != null);
  $('.p-cc').setAttribute('aria-pressed', String(S.sid != null));
  $('.p-cog').classList.toggle('on', S.settingsOpen);
  if (shown.vol !== S.volume) {
    shown.vol = S.volume;
    $('.p-vol').value = S.volume;
    $('.p-vol').style.setProperty('--v', S.volume + '%');
  }
  $('.p-next').hidden = !S.next;
  $('.p-epsbtn').hidden = !(S.item?.Type === 'Episode' && S.item?.SeriesId);
  $('.p-epsbtn').classList.toggle('on', !!S.epsOpen);
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
  // Where the subtitles came from, spelled out, so a wrong pick can be traced.
  const ed = S.defaults?.sub;
  const emby = !S.defaults ? 'unknown' : ed ? (ed.displayTitle || langName(ed.lang) || 'a track') + ` (#${ed.index})` : (S.defaults.subKnown ? 'Off' : 'none given');
  const fd = S.tracks.filter((t) => t.type === 'sub' && t.default).map(trackLabel).join(', ') || 'none';
  $('.p-set-note').textContent = `Audio, subtitles and speed are remembered for ${name}. Skip lengths and quality apply everywhere.${S.subWhy ? ` Subtitles started from ${S.subWhy}.` : ''} Emby's default subtitles: ${emby}. The video marks as default: ${fd}. Held on: ${S.subTarget == null ? 'nothing' : S.subTarget === 'no' ? 'Off' : (S.tracks.find((t) => t.type === 'sub' && t.id === S.subTarget) ? trackLabel(S.tracks.find((t) => t.type === 'sub' && t.id === S.subTarget)) : '#' + S.subTarget)}.`;
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
  reveal('.p-skip', !!mode);
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

  // Credits. Many episodes have no credits marker from Emby, so then Up next
  // shows for the last 40 seconds of an episode instead.
  const d = dur();
  const guess = S.credits == null && S.next && S.item?.Type === 'Episode' && d > 300 ? d - 40 : null;
  const cs = S.credits ?? guess;
  if (cs != null) {
    if (p < cs - 2 && S.creditsHandled) {
      // Seeked back before the credits: reset.
      S.creditsHandled = false;
      if (S.upNextMode === 'credits') hideUpNext();
      if (skipMode === 'credits') showSkip(null);
    }
    if (p >= cs && !S.creditsHandled) {
      S.creditsHandled = true;
      const autoplay = ls.get('autoplay', 'on') !== 'off';
      if (S.next && autoplay) showUpNext('credits');
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

// Controls shown or hidden. Subtitles move up above the player bar while it shows.
function setIdle(idle) {
  if (el.classList.contains('idle') === idle) return;
  el.classList.toggle('idle', idle);
  liftSubs(!idle);
}

// mpv's sub-pos: 100 = normal spot at the bottom, lower numbers sit higher up.
let subPos = 100, subGoal = 100, subRaf = 0;
function liftSubs(up, instant = false) {
  if (!S.embedded) return;
  let goal = 100;
  if (up && S.open) {
    const top = $('.p-seek-row').getBoundingClientRect().top;
    const h = window.innerHeight || 1;
    goal = Math.max(50, Math.round(100 - ((h - top) / h) * 100));
  }
  if (goal === subGoal && subRaf) return;
  subGoal = goal;
  cancelAnimationFrame(subRaf); subRaf = 0;
  if (instant) { subPos = goal; setProp('sub-pos', goal); return; }
  const from = subPos, t0 = performance.now(), len = 420;
  cancelAnimationFrame(subRaf);
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / len);
    const e = 1 - Math.pow(1 - k, 3);
    const v = Math.round(from + (goal - from) * e);
    if (v !== subPos) { subPos = v; setProp('sub-pos', v); }
    subRaf = k < 1 ? requestAnimationFrame(step) : 0;
  };
  subRaf = requestAnimationFrame(step);
}
window.addEventListener('resize', () => { if (S.open && !el.classList.contains('idle')) { subGoal = -1; liftSubs(true); } });

let idleTimer;
function wake() {
  setIdle(false);
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!S.paused && !S.dragging && !S.settingsOpen && !S.epsOpen && !S.stillOpen && !el.querySelector('.p-bottom:hover, .p-top:hover, .p-eps:hover')) setIdle(true);
  }, 1500);
  schedulePauseInfo();
}
el.addEventListener('mousemove', wake);
// Mouse left the window: hide the controls straight away.
document.documentElement.addEventListener('mouseleave', () => {
  if (!S.open || S.paused || S.dragging || S.settingsOpen || S.epsOpen || S.stillOpen) return;
  clearTimeout(idleTimer);
  setIdle(true);
});

function toggleSettings(force) {
  S.settingsOpen = force ?? !S.settingsOpen;
  reveal('.p-settings', S.settingsOpen);
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
  startGlide();
  wake();
}

async function hideOverlay() {
  const wasOpen = S.open;
  S.open = false;
  S.frameSeen = false;
  el.hidden = true;
  document.documentElement.classList.remove('playing');
  setVideoOn(false);
  hideUpNext();
  showSkip(null);
  toggleSettings(false);
  toggleEps(false);
  hideStill();
  clearTimeout(pauseInfoTimer);
  el.classList.remove('pause-info');
  cancelAnimationFrame(subRaf); subRaf = 0; subGoal = 100;
  if (subPos !== 100) { subPos = 100; setProp('sub-pos', 100); }
  if (S.fullscreen) await setFullscreen(false);
  if (wasOpen) window.dispatchEvent(new Event('scrappy:refresh'));
}

// opts: { fromStart, startSecs, keepItem }
export async function startPlayback(id, opts = {}) {
  if (S.starting) return;
  S.starting = true;
  window.dispatchEvent(new CustomEvent('video:start'));
  S.embedded = ls.get('playerMode', 'embedded') !== 'window';
  hideUpNext();
  showSkip(null);
  if (!opts.keepItem) {
    S.item = null; S.next = null; S.intro = null; S.credits = null;
    S.aspect = 'auto';
  }
  S.pos = opts.startSecs || 0; markPos(); S.duration = 0; S.cache = 0; S.buffering = true;
  S.tracks = []; S.aid = null; S.sid = null; S.prefsApplied = false;
  S.defaults = undefined; S.playMethod = ''; S.pick = { audio: true, sub: true }; S.wantAid = null; S.subTarget = null;
  clearTimeout(S.pickTimer);
  S.creditsHandled = false; S.introDismissed = false; S.previews = null;
  toggleEps(false);
  hideStill();
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
    S.defaults = res.defaults || null; S.playMethod = res.playMethod || '';
    pickTracks();
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
  reveal('.p-upnext', true);
  S.upNextTimer = setInterval(() => {
    count--;
    $('.p-up-count').textContent = count;
    if (count <= 0) playNext(true);
  }, 1000);
  return true;
}

function hideUpNext() {
  clearInterval(S.upNextTimer);
  S.upNextTimer = null;
  S.upNextMode = null;
  reveal('.p-upnext', false);
}

// auto: started by the countdown rather than by you.
function playNext(auto = false) {
  const n = S.next;
  hideUpNext();
  if (!n) return;
  if (auto) {
    S.autoChain = (S.autoChain || 0) + 1;
    if (S.autoChain > stillLimit()) { showStill(n); return; }
  } else {
    S.autoChain = 0;
  }
  startPlayback(n.Id, { fromStart: true });
}

// The page is only see-through while mpv is drawing video, otherwise the
// desktop would show through the window while a video is loading.
let videoOnTimer;
// See-through only once mpv has a video window and playback has really started.
function updateVideoOn() { setVideoOn(S.vo && S.frameSeen); }
function setVideoOn(on) {
  clearTimeout(videoOnTimer);
  if (!on) { document.documentElement.classList.remove('video-on'); return; }
  // Give mpv a moment to paint its first frame.
  videoOnTimer = setTimeout(() => {
    if (S.open) document.documentElement.classList.add('video-on');
  }, 150);
}

// ---------- Events from mpv ----------

listen('mpv-prop', ({ payload: { name, value } }) => {
  switch (name) {
    case 'time-pos':
      S.pos = value ?? 0; markPos(); drawTime(); checkMarkers();
      if (value != null && !S.frameSeen) { S.frameSeen = true; updateVideoOn(); }
      break;
    case 'vo-configured': S.vo = !!value; updateVideoOn(); break;
    case 'duration': S.duration = value ?? 0; drawTime(); break;
    case 'demuxer-cache-time': S.cache = value ?? 0; drawTime(); break;
    case 'pause': S.pos = livePos(); markPos(); S.paused = !!value; drawButtons(); wake(); break;
    case 'paused-for-cache': case 'seeking': S.pos = livePos(); markPos(); S.buffering = !!value; drawButtons(); break;
    case 'volume': if (value != null) { S.volume = Math.round(value); drawButtons(); } break;
    case 'mute': S.muted = !!value; drawButtons(); break;
    case 'speed': if (value != null) { S.pos = livePos(); markPos(); S.speed = Math.round(value * 100) / 100; drawButtons(); drawTime(); } break;
    case 'track-list': {
      S.tracks = Array.isArray(value) ? value : [];
      const a = S.tracks.find((t) => t.type === 'audio' && t.selected);
      const s = S.tracks.find((t) => t.type === 'sub' && t.selected);
      S.aid = a ? a.id : null;
      S.sid = s ? s.id : null;
      if (S.sid != null) S.lastSid = S.sid;
      pickTracks();
      holdSubs();
      if (S.settingsOpen) drawSettings();
      drawButtons();
      break;
    }
  }
});

listen('player-loaded', ({ payload }) => {
  loadPreviews(payload?.itemId);
  S.frameSeen = false;
  updateVideoOn();
  S.buffering = false;
  drawButtons();
  setProp('volume', S.volume);
  setProp('sub-scale', S.subScale);
  liftSubs(!el.classList.contains('idle'), true);
  applyAspect();
  // External subtitles are added just after loading; give them a moment.
  if (!S.prefsApplied) { S.prefsApplied = true; const sp = loadPrefs().speed; if (sp) setProp('speed', sp); }
  pickTracks();
  holdSubs();
  // Keep a lookout for late subtitle tracks, then stop looking (the choice stays held).
  clearTimeout(S.pickTimer); S.pickTimer = setTimeout(() => { pickTracks(); stopPicking(); holdSubs(); }, 10000);
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
const seekBy = (s) => { const p = livePos(); cmd('seek', s, 'relative+exact'); S.pos = Math.max(0, p + s); markPos(); drawTime(); wake(); };
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
  letGoOfSubs();
  if (S.sid != null) {
    setProp('sid', 'no');
    saveTrackPrefs({ sub: 'off' });
    return;
  }
  const subs = S.tracks.filter((t) => t.type === 'sub');
  if (!subs.length) { toast('This video has no subtitles.'); return; }
  // Turning subtitles on: your own last pick, then English, then Emby's pick.
  const pref = loadTrackPrefs().sub, d = S.defaults || {};
  const full = subs.filter((t) => !t.forced);
  const t = (pref && pref !== 'off' && matchTrack('sub', pref)) || full.find((x) => langOf(x.lang) === SUB_LANG)
    || (d.sub && matchTrack('sub', d.sub)) || full[0] || subs[0];
  setProp('sid', t.id);
  saveTrackPrefs({ sub: trackRef(t) });
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
      if (S.pick) S.pick.audio = false;
      S.wantAid = null;
      setProp('aid', v);
      saveTrackPrefs({ audio: trackRef(S.tracks.find((t) => String(t.id) === v)) });
      break;
    }
    case 'sub': {
      letGoOfSubs();
      setProp('sid', v);
      saveTrackPrefs({ sub: v === 'no' ? 'off' : trackRef(S.tracks.find((t) => String(t.id) === v)) });
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
  if (S.epsOpen && !e.target.closest('.p-eps, [data-act=eps]')) toggleEps(false);
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
    case 'settings': toggleEps(false); toggleSettings(); break;
    case 'eps': toggleSettings(false); toggleEps(); break;
    case 'still-yes': {
      const n = S.stillNext;
      S.autoChain = 0;
      hideStill();
      if (n) startPlayback(n.Id, { fromStart: true });
      break;
    }
    case 'still-no': hideStill(); exitPlayer(); break;
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
  $('.p-htime').textContent = fmt(r * dur());
  const thumb = $('.p-thumb');
  const pv = S.previews;
  if (pv) {
    const n = Math.max(0, Math.min(pv.count - 1, Math.floor((r * dur() * 1000) / pv.intervalMs)));
    const src = `${IMG_BASE}/bif/${encodeURIComponent(pv.id)}/${n}`;
    if (thumb.dataset.src !== src) { thumb.dataset.src = src; thumb.src = src; }
    thumb.hidden = false;
  } else {
    thumb.hidden = true;
  }
  h.style.left = r * 100 + '%';
});
seek.addEventListener('mousedown', (e) => {
  S.dragging = true;
  // While dragging, the picture follows along (quick keyframe jumps, a few a second).
  let lastScrub = 0, scrubTimer;
  const scrub = (t) => {
    clearTimeout(scrubTimer);
    const wait = 120 - (performance.now() - lastScrub);
    if (wait > 0) { scrubTimer = setTimeout(() => scrub(t), wait); return; }
    lastScrub = performance.now();
    cmd('seek', t.toFixed(2), 'absolute+keyframes');
  };
  const move = (ev) => {
    const t = ratioAt(ev.clientX) * dur();
    drawBar(t);
    if (ev !== e) scrub(t);
  };
  const up = (ev) => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    clearTimeout(scrubTimer);
    const t = ratioAt(ev.clientX) * dur();
    S.pos = t; markPos();
    S.dragging = false;
    cmd('seek', t.toFixed(2), 'absolute+exact');
    drawTime();
  };
  move(e);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// ---------- Seek previews, episode picker, still watching, paused info ----------

async function loadPreviews(itemId) {
  if (!itemId) return;
  try {
    const r = await invoke('load_previews', { itemId });
    if (r?.count && S.item?.Id === itemId) S.previews = { id: itemId, count: r.count, intervalMs: r.intervalMs || 10000 };
  } catch {}
}

function toggleEps(force) {
  S.epsOpen = force ?? !S.epsOpen;
  reveal('.p-eps', S.epsOpen);
  if (S.epsOpen) drawEps(S.item?.SeasonId);
  drawButtons();
  if (force === undefined) wake();
}

let epsSeq = 0;
async function drawEps(seasonId) {
  const it = S.item;
  if (!it?.SeriesId) return;
  const my = ++epsSeq;
  $('.p-eps-show').textContent = it.SeriesName || '';
  try {
    await load(`/Shows/${it.SeriesId}/Seasons?UserId={userId}`, (data) => {
      if (my !== epsSeq) return;
      let seasons = data?.Items || [];
      seasons = [...seasons.filter((s) => s.IndexNumber !== 0), ...seasons.filter((s) => s.IndexNumber === 0)];
      const tabs = $('.p-eps-tabs');
      tabs.innerHTML = seasons.length > 1 ? seasons.map((s) => `<button class="season-tab ${s.Id === seasonId ? 'active' : ''}" data-season="${esc(s.Id)}">${esc(s.Name)}</button>`).join('') : '';
      tabs.querySelectorAll('[data-season]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        tabs.querySelectorAll('.season-tab').forEach((t) => t.classList.toggle('active', t === b));
        drawEpisodes(b.dataset.season);
      }));
    });
  } catch {}
  drawEpisodes(seasonId);
}

async function drawEpisodes(seasonId) {
  const it = S.item;
  const row = $('.p-eps-row');
  const my = ++epsSeq;
  try {
    await load(`/Shows/${it.SeriesId}/Episodes?SeasonId=${seasonId}&UserId={userId}&Fields=PrimaryImageAspectRatio`, (data) => {
      if (my !== epsSeq) return;
      const eps = data?.Items || [];
      row.innerHTML = eps.map((e, i) => {
        const ud = e.UserData || {};
        const cur = e.Id === it.Id;
        const pct = cur ? (dur() ? (S.pos / dur()) * 100 : 0) : ud.Played ? 100 : ud.PlayedPercentage || 0;
        const src = e.ImageTags?.Primary ? img(e.Id, 'Primary', e.ImageTags.Primary, 400) : '';
        return `
          <button class="p-ep ${cur ? 'cur' : ''}" data-ep="${esc(e.Id)}" style="animation-delay:${Math.min(i, 8) * 30}ms">
            <div class="p-ep-img">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : ''}${pct ? `<i style="width:${pct.toFixed(1)}%"></i>` : ''}</div>
            <div class="p-ep-title">${e.IndexNumber != null ? `${e.IndexNumber}. ` : ''}${esc(e.Name)}</div>
            <div class="p-ep-meta">${cur ? 'Playing now' : ud.Played ? 'Watched' : runtime(e.RunTimeTicks)}</div>
          </button>`;
      }).join('');
      row.querySelectorAll('[data-ep]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (b.dataset.ep === it.Id) { toggleEps(false); return; }
        toggleEps(false);
        S.autoChain = 0;
        startPlayback(b.dataset.ep);
      }));
      row.querySelector('.p-ep.cur')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
  } catch {}
}

const stillLimit = () => Number(ls.get('stillWatching', 3));
function showStill(next) {
  S.stillOpen = true;
  S.stillNext = next;
  setProp('pause', 'yes');
  $('.p-still-sub').textContent = [next.SeriesName, epCode(next), next.Name].filter(Boolean).join(' · ');
  $('.p-still').hidden = false;
  setIdle(false);
}
function hideStill() {
  S.stillOpen = false;
  S.stillNext = null;
  $('.p-still').hidden = true;
}

// Any click, key or scroll in the player means someone is there.
['mousedown', 'keydown', 'wheel'].forEach((t) => window.addEventListener(t, () => { if (S.open && !S.stillOpen) S.autoChain = 0; }, true));

let pauseInfoTimer;
function schedulePauseInfo() {
  clearTimeout(pauseInfoTimer);
  el.classList.remove('pause-info');
  if (!S.open || !S.paused || !S.item) return;
  pauseInfoTimer = setTimeout(() => {
    if (!S.open || !S.paused || S.settingsOpen || S.epsOpen || S.stillOpen || S.dragging || S.upNextMode) return;
    drawPauseInfo();
    el.classList.add('pause-info');
    setIdle(true);
  }, 5000);
}
function drawPauseInfo() {
  const it = S.item;
  const isEp = it.Type === 'Episode';
  $('.p-pi-title').textContent = isEp ? it.SeriesName || it.Name : it.Name;
  $('.p-pi-ep').textContent = isEp ? [epCode(it), it.Name].filter(Boolean).join(' · ') : [it.ProductionYear, it.OfficialRating].filter(Boolean).join(' · ');
  $('.p-pi-overview').textContent = it.Overview || '';
  const left = Math.max(0, dur() - S.pos) / (S.speed || 1);
  const ends = new Date(Date.now() + left * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('.p-pi-meta').textContent = `Paused · ${fmt(S.pos)} of ${fmt(dur())} · ends at ${ends}`;
}

// Keyboard (only while the player is open).
// Mouse wheel over the video changes the volume (not over the settings panel, which scrolls).
el.addEventListener('wheel', (e) => {
  if (!S.open || e.target.closest('.p-settings, select')) return;
  e.preventDefault();
  changeVolume(e.deltaY < 0 ? 5 : -5);
  wake();
}, { passive: false });

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
    case 'e': case 'E': if (S.item?.Type === 'Episode') { toggleSettings(false); toggleEps(); } break;
    case 's': case 'S': if (skipMode) doSkip(); else return; break;
    case 'Escape':
      if (S.settingsOpen) toggleSettings(false);
      else if (S.epsOpen) toggleEps(false);
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
