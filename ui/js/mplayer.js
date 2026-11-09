// Music: the queue and the bottom player bar. Songs are Navidrome (Subsonic) song objects.
// Rust's mpv holds the current song plus what follows it (for gapless playback);
// this file holds the whole queue, shuffle, repeat and Favorites.
import { api, listen, IMG_BASE } from './api.js';
import { esc, toast } from './components.js';

const { invoke } = window.__TAURI__.core;

export const cover = (id, w = 300) => (id ? `${IMG_BASE}/nd/${encodeURIComponent(id)}?w=${w}` : '');
export const fmt = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const line = (d, n = 20) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const IC = {
  play: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 6.2v11.6a.8.8 0 0 1-1.2.7L9 12.7a.8.8 0 0 1 0-1.4l7.8-5.8a.8.8 0 0 1 1.2.7z" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M17 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6 6.2v11.6a.8.8 0 0 0 1.2.7l7.8-5.8a.8.8 0 0 0 0-1.4L7.2 5.5A.8.8 0 0 0 6 6.2z" fill="currentColor"/></svg>',
  shuffle: line('<path d="M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6C14.3 16 15.5 17 17.5 17H21M3 17h3.5c1.4 0 2.4-.5 3.2-1.4M14.3 8.4C15.1 7.5 16.1 7 17.5 7H21M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5"/>'),
  repeat: line('<path d="M17 3.5 20 6.5l-3 3"/><path d="M4 11.5v-1a4 4 0 0 1 4-4h12"/><path d="M7 20.5l-3-3 3-3"/><path d="M20 12.5v1a4 4 0 0 1-4 4H4"/>'),
  heart: line('<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>'),
  heartOn: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" fill="currentColor"/></svg>',
  vol: line('<path d="M4 9.5h3l4.5-4v13L7 14.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  muted: line('<path d="M4 9.5h3l4.5-4v13L7 14.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  queue: line('<path d="M4 6h12M4 11h12M4 16h7"/><path d="M15 14.5v5l4.5-2.5z"/>'),
  more: line('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  note: line('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
};

const S = {
  queue: [], idx: -1, base: 0, loadedTo: 0, original: null,
  shuffle: false, repeat: 'off', playing: false, pos: 0, dur: 0,
  volume: 70, muted: false, started: false, from: null, scrobbled: false,
};
export const music = S;
const subs = new Set();
export const onMusic = (f) => { subs.add(f); return () => subs.delete(f); };
const notify = () => { drawBar(); subs.forEach((f) => { try { f(S); } catch {} }); };
export const current = () => S.queue[S.idx] || null;

try {
  const v = JSON.parse(localStorage.getItem('mstate') || 'null');
  if (v && Array.isArray(v.queue)) Object.assign(S, { queue: v.queue, idx: v.idx, shuffle: !!v.shuffle, repeat: v.repeat || 'off', volume: v.volume ?? 70, from: v.from || null, original: v.original || null });
} catch {}
function save() {
  try {
    localStorage.setItem('mstate', JSON.stringify({ queue: S.queue.slice(0, 1500), idx: S.idx, shuffle: S.shuffle, repeat: S.repeat, volume: S.volume, from: S.from, original: S.original?.slice(0, 1500) || null }));
  } catch {}
}

const CHUNK = 400; // songs handed to mpv at a time
async function loadFrom(i) {
  S.idx = i; S.base = i; S.pos = 0; S.dur = S.queue[i]?.duration || 0; S.started = true; S.scrobbled = false;
  const ids = S.queue.slice(i, i + CHUNK).map((s) => s.id);
  S.loadedTo = i + ids.length;
  notify(); save();
  try {
    await invoke('music_play', { ids, volume: S.muted ? 0 : S.volume });
    await invoke('music_set', { name: 'loop-file', value: S.repeat === 'one' ? 'inf' : 'no' });
  } catch (e) { fail(e); }
}
async function refreshUpNext() {
  if (!S.started) return;
  S.base = S.idx;
  const ids = S.queue.slice(S.idx + 1, S.idx + 1 + CHUNK).map((s) => s.id);
  S.loadedTo = S.idx + 1 + ids.length;
  try { await invoke('music_upnext', { ids }); } catch (e) { fail(e); }
}
function fail(e) {
  const msg = String(e);
  if (msg === 'ND_SESSION_EXPIRED') { toast('Your Navidrome sign-in expired. Please sign in again.', true); location.hash = '#/servers/navidrome'; return; }
  toast(msg, true);
}

function shuffled(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/** Play a list of songs. `from` says where they came from ({ type, id, name }). */
export function playSongs(songs, start = 0, opts = {}) {
  songs = (songs || []).filter(Boolean);
  if (!songs.length) return;
  const shuffle = opts.shuffle ?? S.shuffle;
  S.from = opts.from || null;
  S.shuffle = shuffle;
  if (shuffle) {
    const first = opts.shuffle && opts.start == null && !start ? songs[Math.floor(Math.random() * songs.length)] : songs[start];
    S.original = songs.slice();
    S.queue = [first, ...shuffled(songs.filter((s) => s !== first))];
    loadFrom(0);
  } else {
    S.original = null;
    S.queue = songs.slice();
    loadFrom(start);
  }
}
export function playNext(songs) {
  if (!S.queue.length) return playSongs(songs);
  S.queue.splice(S.idx + 1, 0, ...songs);
  S.original?.push(...songs);
  refreshUpNext(); save(); notify();
  toast(songs.length === 1 ? `"${songs[0].title}" plays next.` : `${songs.length} songs play next.`);
}
export function addToQueue(songs) {
  if (!S.queue.length) return playSongs(songs);
  S.queue.push(...songs);
  S.original?.push(...songs);
  if (S.loadedTo >= S.queue.length - songs.length) refreshUpNext();
  save(); notify();
  toast(songs.length === 1 ? `Added "${songs[0].title}" to the queue.` : `Added ${songs.length} songs to the queue.`);
}
export function playAt(i) { if (S.queue[i]) loadFrom(i); }
export function removeAt(i) {
  if (i === S.idx || !S.queue[i]) return;
  S.queue.splice(i, 1);
  if (i < S.idx) S.idx--;
  refreshUpNext(); save(); notify();
}
export function moveInQueue(from, to) {
  if (from === S.idx || to <= S.idx || !S.queue[from]) return;
  const [s] = S.queue.splice(from, 1);
  S.queue.splice(to, 0, s);
  refreshUpNext(); save(); notify();
}
export function clearUpNext() { S.queue.splice(S.idx + 1); S.original = null; refreshUpNext(); save(); notify(); }

export function togglePlay() {
  if (!S.queue.length) return;
  if (!S.started) return loadFrom(Math.max(0, S.idx));
  invoke('music_command', { args: ['cycle', 'pause'] }).catch(fail);
}
export function next() {
  if (S.idx < S.queue.length - 1) {
    if (S.started && S.idx + 1 < S.loadedTo) invoke('music_command', { args: ['playlist-next', 'force'] }).catch(() => loadFrom(S.idx + 1));
    else loadFrom(S.idx + 1);
  } else if (S.repeat === 'all') loadFrom(0);
}
export function prev() {
  if (S.pos > 3 || S.idx <= 0) { seek(0); return; }
  loadFrom(S.idx - 1);
}
export function seek(secs) {
  if (!S.started) return;
  S.pos = secs; drawBar();
  invoke('music_command', { args: ['seek', String(secs), 'absolute'] }).catch(() => {});
}
export function toggleShuffle() {
  const cur = current();
  S.shuffle = !S.shuffle;
  if (cur) {
    if (S.shuffle) {
      S.original = S.queue.slice();
      S.queue = [...S.queue.slice(0, S.idx + 1), ...shuffled(S.queue.slice(S.idx + 1))];
    } else if (S.original) {
      const i = S.original.indexOf(cur);
      S.queue = S.original; S.original = null;
      S.idx = i >= 0 ? i : 0;
    }
    refreshUpNext();
  }
  save(); notify();
}
export function cycleRepeat() {
  S.repeat = { off: 'all', all: 'one', one: 'off' }[S.repeat];
  invoke('music_set', { name: 'loop-file', value: S.repeat === 'one' ? 'inf' : 'no' }).catch(() => {});
  save(); notify();
}
export function setVolume(v) {
  S.volume = Math.max(0, Math.min(100, Math.round(v))); S.muted = false;
  invoke('music_set', { name: 'volume', value: String(S.volume) }).catch(() => {});
  save(); drawBar();
}
export function toggleMute() {
  S.muted = !S.muted;
  invoke('music_set', { name: 'volume', value: String(S.muted ? 0 : S.volume) }).catch(() => {});
  drawBar();
}

// Favorites (Subsonic "star").
export async function setFavorite(song, on) {
  try {
    await api.nd(on ? 'star' : 'unstar', `id=${encodeURIComponent(song.id)}`);
    const stamp = on ? new Date().toISOString() : undefined;
    S.queue.forEach((s) => { if (s.id === song.id) s.starred = stamp; });
    song.starred = stamp;
    save(); notify();
    window.dispatchEvent(new CustomEvent('music:favorite', { detail: { id: song.id, on } }));
    toast(on ? 'Added to Favorites.' : 'Removed from Favorites.');
  } catch (e) { fail(e); }
}

// ---------- Events from mpv ----------
listen('music-prop', ({ payload: { name, value } }) => {
  if (name === 'time-pos' && typeof value === 'number') {
    S.pos = value;
    const cur = current();
    // Count a play once half the song (or 4 minutes) has played.
    if (cur && !S.scrobbled && S.dur > 0 && (value > S.dur / 2 || value > 240)) {
      S.scrobbled = true;
      api.nd('scrobble', `id=${encodeURIComponent(cur.id)}&submission=true`).catch(() => {});
    }
    drawProgress();
  } else if (name === 'duration' && typeof value === 'number') { S.dur = value; drawProgress(); }
  else if (name === 'pause') { S.playing = value === false; notify(); }
  else if (name === 'playlist-pos' && typeof value === 'number' && value >= 0) {
    const i = S.base + value;
    if (i !== S.idx || !S.started) {
      S.idx = i; S.pos = 0; S.dur = S.queue[i]?.duration || 0; S.scrobbled = false;
      save(); notify();
    }
    const cur = current();
    if (cur) api.nd('scrobble', `id=${encodeURIComponent(cur.id)}&submission=false`).catch(() => {});
    // Running low on songs handed to mpv: give it the next batch.
    if (S.idx >= S.loadedTo - 2 && S.loadedTo < S.queue.length) refreshUpNext();
  }
});
listen('music-end', ({ payload }) => {
  if (payload.error) { toast(payload.error, true); return; }
  if (payload.eof && S.idx >= S.queue.length - 1) {
    if (S.repeat === 'all') loadFrom(0);
    else { S.playing = false; S.started = false; S.pos = 0; notify(); }
  }
});
listen('music-closed', () => { S.started = false; S.playing = false; notify(); });

// ---------- The bar ----------
const bar = document.createElement('div');
bar.id = 'mbar';
bar.hidden = true;
bar.innerHTML = `
  <div class="mb-now">
    <button class="mb-cover" id="mbCover" title="Go to album"><img alt=""></button>
    <div class="mb-txt"><a class="mb-title" id="mbTitle"></a><div class="mb-sub" id="mbSub"></div></div>
    <button class="gb mb-fav" id="mbFav" title="Add to Favorites" aria-label="Add to Favorites"></button>
  </div>
  <div class="mb-mid">
    <div class="mb-ctl">
      <button class="gb" id="mbShuf" title="Shuffle" aria-label="Shuffle">${IC.shuffle}</button>
      <button class="gb" id="mbPrev" title="Previous" aria-label="Previous">${IC.prev}</button>
      <button class="mb-play" id="mbPlay" title="Play" aria-label="Play">${IC.play}</button>
      <button class="gb" id="mbNext" title="Next" aria-label="Next">${IC.next}</button>
      <button class="gb" id="mbRep" title="Repeat" aria-label="Repeat">${IC.repeat}<i class="one">1</i></button>
    </div>
    <div class="mb-seek"><span id="mbPos">0:00</span><div class="mseek" id="mbSeek"><div class="track"><i></i></div><b></b></div><span id="mbDur">0:00</span></div>
  </div>
  <div class="mb-right">
    <button class="gb" id="mbQueue" title="Up next" aria-label="Up next">${IC.queue}</button>
    <button class="gb" id="mbMute" title="Mute" aria-label="Mute">${IC.vol}</button>
    <div class="mseek vol" id="mbVol"><div class="track"><i></i></div><b></b></div>
  </div>`;
document.body.appendChild(bar);
const $ = (id) => bar.querySelector('#' + id);
let lastCoverId = null;

function drawBar() {
  const cur = current();
  bar.hidden = !cur;
  document.body.classList.toggle('has-mbar', !!cur);
  if (!cur) return;
  if (cur.coverArt !== lastCoverId) {
    lastCoverId = cur.coverArt;
    const im = bar.querySelector('#mbCover img');
    im.classList.remove('in'); im.onload = () => im.classList.add('in');
    im.src = cover(cur.coverArt, 160);
  }
  const t = $('mbTitle'); t.textContent = cur.title || ''; t.href = cur.albumId ? `#/music/album/${encodeURIComponent(cur.albumId)}?song=${encodeURIComponent(cur.id)}` : '#/music';
  $('mbSub').innerHTML = `${cur.artistId ? `<a href="#/music/artist/${encodeURIComponent(cur.artistId)}">${esc(cur.artist)}</a>` : esc(cur.artist || '')}${cur.album ? ` · <a href="#/music/album/${encodeURIComponent(cur.albumId)}">${esc(cur.album)}</a>` : ''}`;
  const fav = $('mbFav'); const on = !!cur.starred;
  fav.innerHTML = on ? IC.heartOn : IC.heart; fav.classList.toggle('on', on);
  fav.title = on ? 'Remove from Favorites' : 'Add to Favorites';
  const play = $('mbPlay'); const showPause = S.playing && S.started;
  if (play.dataset.st !== String(showPause)) { play.dataset.st = String(showPause); play.innerHTML = showPause ? IC.pause : IC.play; play.title = showPause ? 'Pause' : 'Play'; play.classList.remove('morph'); void play.offsetWidth; play.classList.add('morph'); }
  $('mbShuf').classList.toggle('on', S.shuffle);
  const rep = $('mbRep'); rep.classList.toggle('on', S.repeat !== 'off'); rep.classList.toggle('is-one', S.repeat === 'one');
  rep.title = { off: 'Repeat', all: 'Repeat all', one: 'Repeat this song' }[S.repeat];
  $('mbMute').innerHTML = S.muted || S.volume === 0 ? IC.muted : IC.vol;
  setFill($('mbVol'), S.muted ? 0 : S.volume / 100);
  drawProgress();
}
function setFill(el, f) { f = Math.max(0, Math.min(1, f || 0)); el.querySelector('i').style.width = f * 100 + '%'; el.querySelector('b').style.left = f * 100 + '%'; }
let dragging = false;
function drawProgress() {
  if (bar.hidden || dragging) return;
  const d = S.dur || current()?.duration || 0;
  $('mbPos').textContent = fmt(S.pos); $('mbDur').textContent = fmt(d);
  setFill($('mbSeek'), d ? S.pos / d : 0);
  bar.classList.toggle('playing', S.playing && S.started);
}
function slider(el, onMove, onDone) {
  el.addEventListener('pointerdown', (e) => {
    const r = el.getBoundingClientRect();
    const at = (ev) => Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    el.setPointerCapture(e.pointerId); el.classList.add('drag');
    onMove(at(e));
    const mv = (ev) => onMove(at(ev));
    const up = (ev) => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.classList.remove('drag'); onDone?.(at(ev)); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
}
slider($('mbSeek'), (f) => { dragging = true; const d = S.dur || current()?.duration || 0; setFill($('mbSeek'), f); $('mbPos').textContent = fmt(f * d); },
  (f) => { dragging = false; seek(f * (S.dur || current()?.duration || 0)); });
slider($('mbVol'), (f) => setVolume(f * 100));
$('mbPlay').onclick = togglePlay;
$('mbNext').onclick = next;
$('mbPrev').onclick = prev;
$('mbShuf').onclick = toggleShuffle;
$('mbRep').onclick = cycleRepeat;
$('mbMute').onclick = toggleMute;
$('mbFav').onclick = () => { const c = current(); if (c) setFavorite(c, !c.starred); };
$('mbCover').onclick = () => { const c = current(); if (c?.albumId) location.hash = `#/music/album/${encodeURIComponent(c.albumId)}?song=${encodeURIComponent(c.id)}`; };
$('mbQueue').onclick = () => window.dispatchEvent(new CustomEvent('music:panel', { detail: 'queue' }));
// Soft bounce + faint red ripple on every bar button.
bar.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  b.classList.remove('tap'); void b.offsetWidth; b.classList.add('tap');
});

// Space = play/pause, media keys, while not typing.
window.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  const vp = document.getElementById('player');
  if (typing || (vp && !vp.hidden)) return;
  if (e.code === 'Space' && current() && location.hash.startsWith('#/music')) { e.preventDefault(); togglePlay(); }
});
navigator.mediaSession?.setActionHandler?.('play', togglePlay);
navigator.mediaSession?.setActionHandler?.('pause', togglePlay);
navigator.mediaSession?.setActionHandler?.('nexttrack', next);
navigator.mediaSession?.setActionHandler?.('previoustrack', prev);

drawBar();
