// Audiobooks: the playback session with Audiobookshelf and the bottom bar for books.
// Books play on the same audio-only mpv as Music. While a book plays, mplayer.js
// steps aside (mode.book) and this file owns mpv's events and the bar.
//
// Audiobookshelf keeps your spot: we open a "play session" when a book starts,
// send the position every 15 seconds and on pause, and close it when you stop.
import { api, listen, IMG_BASE } from './api.js';
import { esc, toast } from './components.js';
import { mode, enterBookMode, music as M, setVolume, toggleMute, onMusic, IC } from './mplayer.js';

const { invoke } = window.__TAURI__.core;

// ---------- Small helpers shared with the Audiobooks pages ----------
export const absCover = (item, w = 400) => (item?.id ? `${IMG_BASE}/abs/${encodeURIComponent(item.id)}?w=${w}&u=${encodeURIComponent(item.updatedAt || '')}` : '');
export const absAuthorImg = (a, w = 300) => (a?.id && a.imagePath ? `${IMG_BASE}/absa/${encodeURIComponent(a.id)}?w=${w}&u=${encodeURIComponent(a.updatedAt || '')}` : '');
export const absSend = (method, path, body = null) => invoke('abs_send', { method, path, body });
/** "4h 12m", "12m", "45s" */
export const hm = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : m ? `${m}m` : `${s}s`; };
/** "1:02:03" or "2:03" */
export const clock = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(x).padStart(2, '0'); };
export const chapterAt = (chapters, t) => { let i = -1; (chapters || []).forEach((c, j) => { if (c.start <= t + 0.25) i = j; }); return i; };

const line = (d, n = 20) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const BI = {
  back10: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4a8 8 0 1 1-8 8"/><path d="M14.4 1.7 12 4l2.4 2.3"/><text x="12.4" y="15.3" text-anchor="middle" font-size="7.6" font-weight="700" font-family="Inter,sans-serif" fill="currentColor" stroke="none">10</text></svg>',
  fwd10: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4a8 8 0 1 0 8 8"/><path d="M9.6 1.7 12 4 9.6 6.3"/><text x="11.6" y="15.3" text-anchor="middle" font-size="7.6" font-weight="700" font-family="Inter,sans-serif" fill="currentColor" stroke="none">10</text></svg>',
  moon: line('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  chapters: line('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'),
  tortoise: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><g transform="translate(24 0) scale(-1 1)"><path d="M4.2 13.2C4.2 9.6 7.3 7 11.2 7s7 2.6 7 6.2z"/><rect x="3.4" y="14" width="15.6" height="1.9" rx=".95"/><path d="M17.6 11.4c.5-.9 1.4-1.5 2.5-1.5 1.5 0 2.5 1.1 2.5 2.4s-1 2.3-2.4 2.3h-2.4z"/><rect x="5.6" y="16.4" width="2.8" height="2.8" rx="1.1"/><rect x="13.4" y="16.4" width="2.8" height="2.8" rx="1.1"/><path d="M3.6 14.1 1.6 15.2c-.3.2-.2.6.1.6h2z"/></g></svg>',
  hare: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><ellipse cx="15.2" cy="5.9" rx="1.25" ry="3.9" transform="rotate(-28 15.2 5.9)"/><ellipse cx="17.6" cy="6.1" rx="1.15" ry="3.5" transform="rotate(-12 17.6 6.1)" opacity=".55"/><circle cx="17.6" cy="11.4" r="2.9"/><path d="M3.8 14.6c0-3 3-5.2 6.9-5.2 2.7 0 4.9 1 6 2.6l.9 2.6c0 2.3-2.2 3.6-5 3.6H8.2c-2.6 0-4.4-1.5-4.4-3.6z"/><circle cx="3.2" cy="12.9" r="1.6"/><rect x="13.2" y="16.6" width="5.4" height="2.1" rx="1.05"/><rect x="4.6" y="17.1" width="6" height="2.1" rx="1.05"/></svg>',
  check: line('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 16),
};

// ---------- State ----------
const SPEED_MIN = 0.9, SPEED_MAX = 2, SPEED_STEP = 0.05;
const B = {
  item: null, session: null, tracks: [], chapters: [], duration: 0,
  pos: 0, track: 0, playing: false, started: false, loading: false,
  speed: 1, sleep: null, listened: 0, lastSync: 0,
};
export const book = B;
const subs = new Set();
/** Pages listen for changes (playing, position) with this. Returns an unsubscribe function. */
export const onBook = (f) => { subs.add(f); return () => subs.delete(f); };
const notify = () => { draw(); subs.forEach((f) => { try { f(B); } catch {} }); };

const slim = (it) => it && ({ id: it.id, updatedAt: it.updatedAt, libraryId: it.libraryId, media: { duration: it.media?.duration, chapters: it.media?.chapters || [], metadata: { title: it.media?.metadata?.title, authorName: it.media?.metadata?.authorName, authors: it.media?.metadata?.authors || [] } } });
function save() {
  try { localStorage.setItem('bstate', JSON.stringify({ item: slim(B.item), pos: B.pos, speed: B.speed, duration: B.duration })); } catch {}
}
try {
  const v = JSON.parse(localStorage.getItem('bstate') || 'null');
  if (v) { B.item = v.item || null; B.pos = v.pos || 0; B.speed = v.speed || 1; B.duration = v.duration || v.item?.media?.duration || 0; B.chapters = v.item?.media?.chapters || []; }
} catch {}

function deviceId() {
  let d = localStorage.getItem('absDevice');
  if (!d) { d = 'scrappy-' + Math.random().toString(36).slice(2, 10); try { localStorage.setItem('absDevice', d); } catch {} }
  return d;
}
function fail(e) {
  const msg = String(e);
  if (msg === 'ABS_SESSION_EXPIRED') { toast('Your Audiobookshelf sign-in expired. Please sign in again.', true); location.hash = '#/servers/audiobookshelf'; return; }
  toast(msg, true);
}
const trackAt = (t) => { let i = 0; B.tracks.forEach((tr, j) => { if (tr.startOffset <= t + 0.01) i = j; }); return i; };
const curChapter = () => B.chapters[chapterAt(B.chapters, B.pos)] || null;

// ---------- Playback ----------
/** Start (or switch to) a book. `at` = seconds into the book; default is where you left off. */
export async function playBook(itemId, opts = {}) {
  try {
    await closeSession();
    const item = await api.abs(`/api/items/${encodeURIComponent(itemId)}?expanded=1&include=progress`);
    const sess = await absSend('POST', `/api/items/${encodeURIComponent(itemId)}/play`, {
      deviceInfo: { clientName: 'Scrappy', clientVersion: '1.0', deviceId: deviceId(), manufacturer: 'Scrappy', model: 'Desktop' },
      supportedMimeTypes: ['audio/flac', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/x-m4b', 'audio/aac', 'audio/ogg', 'audio/opus', 'audio/webm', 'audio/wav'],
      mediaPlayer: 'mpv', forceDirectPlay: true, forceTranscode: false,
    });
    const tracks = (sess?.audioTracks || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (!tracks.length) throw new Error('This book has no audio files Scrappy can play.');
    B.item = item; B.session = sess; B.tracks = tracks;
    B.chapters = item.media?.chapters?.length ? item.media.chapters : (sess.chapters || []);
    B.duration = sess.duration || item.media?.duration || tracks.reduce((a, t) => a + (t.duration || 0), 0);
    const prog = item.userMediaProgress;
    let at = opts.at ?? (prog?.isFinished ? 0 : (sess.currentTime || prog?.currentTime || 0));
    if (at >= B.duration - 3) at = 0;
    const ti = trackAt(at);
    Object.assign(B, { track: ti, pos: at, started: true, playing: true, loading: true, listened: 0, lastSync: Date.now() });
    try { localStorage.setItem('lastAudio', 'book'); } catch {}
    enterBookMode(); save(); notify();
    await invoke('book_play', { paths: tracks.map((t) => t.contentUrl), index: ti, start: at - (tracks[ti].startOffset || 0), volume: M.muted ? 0 : M.volume, speed: B.speed });
  } catch (e) { B.loading = false; fail(e.message || e); }
}

async function sync(close = false) {
  if (!B.session) return;
  const id = B.session.id;
  const body = { currentTime: B.pos, timeListened: Math.round(B.listened), duration: B.duration };
  B.listened = 0; B.lastSync = Date.now();
  if (close) B.session = null;
  try { await absSend('POST', `/api/session/${encodeURIComponent(id)}/${close ? 'close' : 'sync'}`, body); }
  catch (e) {
    if (String(e) === 'ABS_SESSION_EXPIRED') return fail(e);
    // The server forgot the session (e.g. it restarted): the next play opens a new one.
    if (!close) B.session = null;
  }
  window.dispatchEvent(new CustomEvent('book:progress', { detail: { id: B.item?.id, currentTime: body.currentTime, duration: B.duration } }));
}
async function closeSession() { if (B.session) await sync(true); }

export function toggleBook() {
  if (!B.item) return;
  if (!B.started || !B.session) return playBook(B.item.id, { at: B.pos });
  invoke('music_command', { args: ['cycle', 'pause'] }).catch(fail);
}
export function pauseBook() { if (B.started && B.playing) invoke('music_set', { name: 'pause', value: 'yes' }).catch(() => {}); }

export function seekBook(t) {
  t = Math.max(0, Math.min((B.duration || 1) - 1, t));
  B.pos = t; drawProgress(); save();
  if (!B.started || !B.tracks.length) { notify(); return; }
  const ti = trackAt(t), local = t - (B.tracks[ti].startOffset || 0);
  if (ti === B.track) { invoke('music_command', { args: ['seek', local.toFixed(2), 'absolute'] }).catch(() => {}); return; }
  B.track = ti; B.loading = true;
  invoke('music_set', { name: 'start', value: local.toFixed(2) })
    .then(() => invoke('music_set', { name: 'playlist-pos', value: String(ti) }))
    .catch(() => {});
}
export const skip = (secs) => seekBook(B.pos + secs);
export function prevChapter() {
  const i = chapterAt(B.chapters, B.pos);
  if (i < 0) return seekBook(0);
  const c = B.chapters[i];
  seekBook(B.pos - c.start > 3 || i === 0 ? c.start : B.chapters[i - 1].start);
}
export function nextChapter() {
  const i = chapterAt(B.chapters, B.pos);
  if (B.chapters[i + 1]) seekBook(B.chapters[i + 1].start);
}
export function setSpeed(v) {
  B.speed = Math.round(Math.max(SPEED_MIN, Math.min(SPEED_MAX, v)) * 20) / 20;
  if (B.started) invoke('music_set', { name: 'speed', value: B.speed.toFixed(2) }).catch(() => {});
  save(); notify();
}
/** minutes, 'chapter', or null to turn off */
export function setSleep(v) {
  B.sleep = v == null ? null : v === 'chapter' ? { chapter: chapterAt(B.chapters, B.pos) } : { end: Date.now() + v * 60000, mins: v };
  notify();
  if (v != null) toast(v === 'chapter' ? 'Sleep timer: stops at the end of this chapter.' : `Sleep timer: stops in ${v} minutes.`);
}

/** Mark a book finished (or not). Works for any book, playing or not. */
export async function setFinished(itemId, on) {
  if (on && B.item?.id === itemId && B.started) { pauseBook(); await closeSession(); B.started = false; B.pos = 0; save(); }
  await absSend('PATCH', `/api/me/progress/${encodeURIComponent(itemId)}`, on ? { isFinished: true } : { isFinished: false, currentTime: 0, progress: 0 });
  window.dispatchEvent(new CustomEvent('book:progress', { detail: { id: itemId, finished: on } }));
  notify();
}

// Music took over the player: close our session and hide the book bar.
window.addEventListener('book:stop', () => { closeSession(); B.started = false; B.playing = false; try { localStorage.setItem('lastAudio', 'music'); } catch {} notify(); });
window.addEventListener('book:toggle', toggleBook);
window.addEventListener('book:next', nextChapter);
window.addEventListener('book:prev', prevChapter);
window.addEventListener('beforeunload', () => { if (B.session) sync(true); });

// ---------- Events from mpv (only while a book owns it) ----------
listen('music-loaded', () => {
  if (!mode.book || !B.loading) return;
  B.loading = false;
  invoke('music_set', { name: 'start', value: 'none' }).catch(() => {});
});
listen('music-prop', ({ payload: { name, value } }) => {
  if (!mode.book || !B.started) return;
  if (name === 'time-pos' && typeof value === 'number') {
    if (B.loading) return;
    B.pos = (B.tracks[B.track]?.startOffset || 0) + value;
    drawProgress();
  } else if (name === 'playlist-pos' && typeof value === 'number' && value >= 0) {
    B.track = value;
  } else if (name === 'pause') {
    const was = B.playing; B.playing = value === false;
    if (was && !B.playing) { sync(); save(); }
    notify();
  }
});
listen('music-end', ({ payload }) => {
  if (!mode.book || !B.started) return;
  if (payload.error) { toast(payload.error, true); return; }
  if (payload.eof && B.track >= B.tracks.length - 1 && !B.loading) {
    const id = B.item?.id;
    B.pos = B.duration; B.playing = false;
    closeSession().then(() => id && setFinished(id, true)).then(() => toast('Finished the book.'));
    B.started = false; save(); notify();
  }
});
listen('music-closed', () => { if (mode.book) { B.started = false; B.playing = false; notify(); } });

// Once a second: count listening time, sync every 15 s, run the sleep timer.
setInterval(() => {
  if (!mode.book || !B.started || !B.playing) return;
  B.listened += 1;
  if (Date.now() - B.lastSync > 15000) { sync(); save(); }
  if (B.sleep?.end && Date.now() >= B.sleep.end) { B.sleep = null; pauseBook(); toast('Sleep timer: paused.'); notify(); }
  else if (B.sleep && 'chapter' in B.sleep && chapterAt(B.chapters, B.pos) !== B.sleep.chapter) {
    const c = curChapter(); B.sleep = null; pauseBook(); if (c) seekBook(c.start); toast('Sleep timer: paused at the end of the chapter.'); notify();
  }
  if (B.sleep?.end) drawSleep();
}, 1000);

// ---------- The bar ----------
const bar = document.createElement('div');
bar.id = 'bbar';
bar.hidden = true;
bar.innerHTML = `
  <div class="mb-now">
    <a class="mb-cover" id="bbCover" title="Open the book"><img alt=""></a>
    <div class="mb-txt"><a class="mb-title" id="bbTitle"></a><div class="mb-sub" id="bbSub"></div><div class="mb-sub bb-ch" id="bbCh"></div></div>
  </div>
  <div class="mb-mid">
    <div class="mb-ctl">
      <button type="button" class="bb-spd" id="bbSpd" title="Speed" aria-label="Speed">1.00×</button>
      <button type="button" class="gb" id="bbPrev" title="Previous chapter" aria-label="Previous chapter">${IC.prev}</button>
      <button type="button" class="gb bb-skip" id="bbBack" title="Back 10 seconds" aria-label="Back 10 seconds">${BI.back10}</button>
      <button type="button" class="mb-play" id="bbPlay" title="Play" aria-label="Play">${IC.play}</button>
      <button type="button" class="gb bb-skip" id="bbFwd" title="Forward 10 seconds" aria-label="Forward 10 seconds">${BI.fwd10}</button>
      <button type="button" class="gb" id="bbNext" title="Next chapter" aria-label="Next chapter">${IC.next}</button>
      <button type="button" class="gb" id="bbSleep" title="Sleep timer" aria-label="Sleep timer">${BI.moon}<i class="bb-sl"></i></button>
    </div>
    <div class="mb-seek"><span id="bbPos">0:00</span><div class="mseek" id="bbSeek"><div class="track"><i></i></div><b></b></div><span id="bbRem">0:00</span></div>
  </div>
  <div class="mb-right">
    <span class="bb-left" id="bbLeft"></span>
    <button type="button" class="gb" id="bbChap" title="Chapters" aria-label="Chapters">${BI.chapters}</button>
    <button type="button" class="gb" id="bbMute" title="Mute" aria-label="Mute">${IC.vol}</button>
    <div class="mseek vol" id="bbVol"><div class="track"><i></i></div><b></b></div>
  </div>`;
document.body.appendChild(bar);
const pop = document.createElement('div');
pop.id = 'bbPop'; pop.className = 'bb-pop off';
document.body.appendChild(pop);
const $ = (id) => bar.querySelector('#' + id);

let lastCover = null;
function draw() {
  const show = mode.book && !!B.item;
  bar.hidden = !show;
  if (show) document.body.classList.add('has-mbar');
  if (!show) { closePop(); return; }
  const it = B.item, md = it.media?.metadata || {};
  if (it.id !== lastCover) {
    lastCover = it.id;
    const im = bar.querySelector('#bbCover img');
    im.classList.remove('in'); im.onload = () => im.classList.add('in'); im.onerror = () => im.classList.remove('in');
    im.src = absCover(it, 160);
  }
  const href = `#/audiobooks/book/${encodeURIComponent(it.id)}`;
  $('bbCover').href = href;
  const t = $('bbTitle'); t.textContent = md.title || ''; t.href = href;
  const au = md.authors?.[0];
  $('bbSub').innerHTML = au?.id ? `<a href="#/audiobooks/author/${encodeURIComponent(au.id)}">${esc(md.authorName || au.name)}</a>` : esc(md.authorName || '');
  const play = $('bbPlay'); const showPause = B.playing && B.started;
  if (play.dataset.st !== String(showPause)) { play.dataset.st = String(showPause); play.innerHTML = showPause ? IC.pause : IC.play; play.title = showPause ? 'Pause' : 'Play'; play.classList.remove('morph'); void play.offsetWidth; play.classList.add('morph'); }
  $('bbSpd').textContent = B.speed.toFixed(2) + '×';
  $('bbSpd').classList.toggle('on', B.speed !== 1);
  $('bbMute').innerHTML = M.muted || M.volume === 0 ? IC.muted : IC.vol;
  setFill($('bbVol'), M.muted ? 0 : M.volume / 100);
  $('bbPrev').disabled = $('bbNext').disabled = !B.chapters.length;
  $('bbChap').hidden = !B.chapters.length;
  drawSleep();
  drawProgress();
  if (pop.dataset.kind && !pop.classList.contains('off')) fillPop(pop.dataset.kind);
}
function drawSleep() {
  const s = $('bbSleep'); s.classList.toggle('on', !!B.sleep);
  const lbl = B.sleep?.end ? Math.max(1, Math.ceil((B.sleep.end - Date.now()) / 60000)) + 'm' : B.sleep ? 'ch' : '';
  s.querySelector('.bb-sl').textContent = lbl;
  s.title = B.sleep?.end ? `Sleep timer: ${lbl} left` : B.sleep ? 'Sleep timer: end of chapter' : 'Sleep timer';
}
function setFill(el, f) { f = Math.max(0, Math.min(1, f || 0)); el.querySelector('i').style.width = f * 100 + '%'; el.querySelector('b').style.left = f * 100 + '%'; }
let dragging = false;
/** The bar scrubs through the current chapter (or the whole book when it has no chapters). */
function span() {
  const c = curChapter();
  if (!c) return { start: 0, end: B.duration || 1 };
  return { start: c.start, end: c.end || B.duration };
}
function drawProgress() {
  if (bar.hidden) return;
  const c = curChapter();
  $('bbCh').textContent = c?.title || '';
  bar.classList.toggle('playing', B.playing && B.started);
  $('bbLeft').textContent = B.duration ? `${hm((B.duration - B.pos) / B.speed)} left` : '';
  if (dragging) return;
  const { start, end } = span();
  $('bbPos').textContent = clock(B.pos - start); $('bbRem').textContent = '-' + clock(end - B.pos);
  setFill($('bbSeek'), (B.pos - start) / Math.max(1, end - start));
  if (pop.dataset.kind === 'chapters' && !pop.classList.contains('off')) markChapter();
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
slider($('bbSeek'), (f) => { dragging = true; const { start, end } = span(); setFill($('bbSeek'), f); $('bbPos').textContent = clock(f * (end - start)); $('bbRem').textContent = '-' + clock((1 - f) * (end - start)); },
  (f) => { dragging = false; const { start, end } = span(); seekBook(start + f * (end - start)); });
slider($('bbVol'), (f) => { setVolume(f * 100); draw(); });
$('bbPlay').onclick = toggleBook;
$('bbBack').onclick = () => skip(-10);
$('bbFwd').onclick = () => skip(10);
$('bbPrev').onclick = prevChapter;
$('bbNext').onclick = nextChapter;
$('bbMute').onclick = () => { toggleMute(); draw(); };
$('bbSpd').onclick = (e) => togglePop('speed', e.currentTarget);
$('bbSleep').onclick = (e) => togglePop('sleep', e.currentTarget);
$('bbChap').onclick = (e) => togglePop('chapters', e.currentTarget);
onMusic(() => { if (mode.book) draw(); });
bar.addEventListener('pointerdown', (e) => { const b = e.target.closest('button'); if (!b) return; b.classList.remove('tap'); void b.offsetWidth; b.classList.add('tap'); });

// ---------- Pop-ups: speed, sleep timer, chapters ----------
function togglePop(kind, anchor) {
  if (pop.dataset.kind === kind && !pop.classList.contains('off')) return closePop();
  pop.dataset.kind = kind;
  pop.className = 'bb-pop ' + kind;
  fillPop(kind);
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth;
  pop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + 'px';
  pop.style.bottom = (window.innerHeight - bar.getBoundingClientRect().top + 10) + 'px';
  bar.querySelectorAll('.pop-on').forEach((b) => b.classList.remove('pop-on'));
  anchor.classList.add('pop-on');
  if (kind === 'chapters') pop.querySelector('.cur')?.scrollIntoView({ block: 'center' });
}
function closePop() { pop.classList.add('off'); bar.querySelectorAll('.pop-on').forEach((b) => b.classList.remove('pop-on')); }
document.addEventListener('pointerdown', (e) => { if (!pop.classList.contains('off') && !pop.contains(e.target) && !e.target.closest('#bbSpd,#bbSleep,#bbChap')) closePop(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });

const STOPS = Array.from({ length: Math.round((SPEED_MAX - SPEED_MIN) / SPEED_STEP) + 1 }, (_, i) => Math.round((SPEED_MIN + i * SPEED_STEP) * 100) / 100);
const MAJOR = [0.9, 1, 1.25, 1.5, 1.75, 2];
const LABELS = [1, 1.25, 1.5, 1.75, 2]; // 0.9 sits too close to 1.0 for a label
const pct = (v) => ((v - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100;
function fillPop(kind) {
  if (kind === 'speed') {
    if (!pop.querySelector('.bb-trk')) {
      pop.innerHTML = `<div class="bb-big"><b></b><span>×</span></div>
        <div class="bb-srow"><button type="button" class="gb bb-ani" data-sp="-1" title="Slower" aria-label="Slower">${BI.tortoise}</button>
        <div class="bb-trk" role="slider" aria-label="Playback speed" tabindex="0"><div class="rail"><div class="fill"></div>
          ${STOPS.map((v) => `<span class="stop${MAJOR.includes(v) ? ' maj' : ''}" style="left:${pct(v)}%"></span>${LABELS.includes(v) ? `<span class="lbl" data-v="${v}" style="left:${pct(v)}%">${v.toFixed(2).replace(/0$/, '')}×</span>` : ''}`).join('')}
          <b class="thumb"></b></div></div>
        <button type="button" class="gb bb-ani" data-sp="1" title="Faster" aria-label="Faster">${BI.hare}</button></div>`;
      const trk = pop.querySelector('.bb-trk');
      const at = (ev) => { const r = trk.querySelector('.rail').getBoundingClientRect(); return SPEED_MIN + Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * (SPEED_MAX - SPEED_MIN); };
      trk.addEventListener('pointerdown', (e) => {
        trk.setPointerCapture(e.pointerId); trk.classList.add('drag'); setSpeed(at(e));
        const mv = (ev) => setSpeed(at(ev));
        const up = () => { trk.removeEventListener('pointermove', mv); trk.removeEventListener('pointerup', up); trk.classList.remove('drag'); };
        trk.addEventListener('pointermove', mv); trk.addEventListener('pointerup', up);
      });
      trk.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setSpeed(B.speed - SPEED_STEP); } if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setSpeed(B.speed + SPEED_STEP); } });
      pop.querySelectorAll('[data-sp]').forEach((b) => (b.onclick = () => setSpeed(B.speed + Number(b.dataset.sp) * SPEED_STEP)));
    }
    pop.querySelector('.bb-big b').textContent = B.speed.toFixed(2);
    pop.querySelector('.fill').style.width = pct(B.speed) + '%';
    pop.querySelector('.thumb').style.left = pct(B.speed) + '%';
    pop.querySelectorAll('.stop').forEach((s, i) => s.classList.toggle('lit', STOPS[i] <= B.speed + 0.001));
    pop.querySelectorAll('.lbl').forEach((l) => l.classList.toggle('cur', Math.abs(Number(l.dataset.v) - B.speed) < 0.001));
    pop.querySelector('.bb-trk').setAttribute('aria-valuenow', B.speed.toFixed(2));
  } else if (kind === 'sleep') {
    const cur = B.sleep?.end ? B.sleep.mins : B.sleep ? 'chapter' : null;
    const opts = [[null, 'Off'], [15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], ['chapter', 'End of chapter']];
    pop.innerHTML = `<div class="bb-ph">Sleep timer</div>` + opts.map(([v, l]) => `<button type="button" class="bb-mi${cur === v ? ' on' : ''}" data-sl="${v ?? ''}">${l}${cur === v ? BI.check : ''}</button>`).join('');
    pop.querySelectorAll('[data-sl]').forEach((b) => (b.onclick = () => { const v = b.dataset.sl; setSleep(v === '' ? null : v === 'chapter' ? 'chapter' : Number(v)); closePop(); }));
  } else if (kind === 'chapters') {
    if (pop.dataset.for !== B.item?.id || pop.querySelectorAll('.bb-chi').length !== B.chapters.length) {
      pop.dataset.for = B.item?.id || '';
      pop.innerHTML = `<div class="bb-ph"><span>Chapters</span><span class="t2" id="bbChN"></span></div><div class="bb-chl">`
        + B.chapters.map((c, i) => `<button type="button" class="bb-chi" data-i="${i}"><span class="n">${i + 1}</span><span class="t">${esc(c.title || 'Chapter ' + (i + 1))}</span><span class="d">${clock(c.end - c.start)}</span></button>`).join('') + '</div>';
      pop.querySelectorAll('.bb-chi').forEach((b) => (b.onclick = () => { const c = B.chapters[Number(b.dataset.i)]; if (c) { if (!B.started) playBook(B.item.id, { at: c.start }); else seekBook(c.start); } }));
    }
    markChapter();
  }
}
function markChapter() {
  const ci = chapterAt(B.chapters, B.pos);
  pop.querySelectorAll('.bb-chi').forEach((b, i) => { b.classList.toggle('cur', i === ci); b.classList.toggle('past', i < ci); });
  const n = pop.querySelector('#bbChN'); if (n) n.textContent = ci >= 0 ? `${ci + 1} of ${B.chapters.length}` : '';
}

// Space = play/pause while a book owns the player (not while typing or watching video).
window.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  const vp = document.getElementById('player');
  if (typing || (vp && !vp.hidden) || !mode.book) return;
  if (e.code === 'Space' && B.item && location.hash.startsWith('#/audiobooks')) { e.preventDefault(); toggleBook(); }
});

// After a restart, show the last book in the bar (paused) if a book was the last thing playing.
if (B.item && localStorage.getItem('lastAudio') === 'book') enterBookMode();
draw();
