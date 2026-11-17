// Windows taskbar preview (hover Scrappy's taskbar icon), as Jayden picked:
// - Music: Favourite · Shuffle · Previous · Play/Pause · Next · Repeat · Open Now playing.
// - Books: Previous chapter · Back · Play/Pause · Forward · Next chapter (jump lengths from Settings).
// - Nothing playing: Previous and Next grey, Play stays white and picks up the last song or book.
// - The cover as the preview picture, a progress bar on the taskbar icon (green playing,
//   yellow paused) and the song or book on the top line (the window title).
// Icons are drawn here so they match the app; a click comes back as a "thumb" event.
import { onMusic, music, mode, togglePlay, next, prev, current, toggleShuffle, cycleRepeat, setFavorite, cover } from './mplayer.js';
import { onBook, book, prevChapter, nextChapter, skipBack, skipFwd, skipLens, chapterAt, absCover } from './bplayer.js';
import { openNow } from './nowplaying.js';
import { onPref } from './prefs.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// ---------- icons (24-unit grid, white) ----------
const FILL = {
  prev: 'M6 5h2v14H6zM20 5v14L9 12z', next: 'M16 5h2v14h-2zM4 5v14l11-7z',
  play: 'M7 4.5v15l12.5-7.5z', pause: 'M7 5h3.6v14H7zM13.4 5H17v14h-3.6z',
  heartOn: 'M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z',
};
const STROKE = {
  heart: 'M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z',
  shuffle: 'M3 7h3c4.5 0 6.5 10 11 10h3M3 17h3c1.7 0 3-1.4 4.2-3.3M13.8 10.3C15 8.4 16.3 7 18 7h2M18 4l3 3-3 3M18 14l3 3-3 3',
  shuffleOn: 'M3 6h3c4.5 0 6.5 9 11 9h3M3 15h3c1.7 0 3-1.3 4.2-3M13.8 9C15 7.3 16.3 6 18 6h2M18 3l3 3-3 3M18 12l3 3-3 3',
  repeat: 'M4 11V9a2 2 0 0 1 2-2h13M16 4l3 3-3 3M20 13v2a2 2 0 0 1-2 2H5M8 20l-3-3 3-3',
  repeatAll: 'M4 10V8a2 2 0 0 1 2-2h13M16 3l3 3-3 3M20 12v2a2 2 0 0 1-2 2H5M8 19l-3-3 3-3',
  open: 'M14 4h6v6M20 4l-8 8M18 14v5H5V6h5',
  back: 'M12 5a8 8 0 1 1-6.9 4M14.5 2.5L12 5l2.5 2.5',
  fwd: 'M12 5a8 8 0 1 0 6.9 4M9.5 2.5L12 5 9.5 7.5',
};
// Shuffle and Repeat "on" get a dot underneath (Windows only shows white icons, no colour).
const DOT = { shuffleOn: 1, repeatAll: 1, repeatOne: 1 };

function draw(size, name, alpha) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.scale(size / 24, size / 24);
  g.globalAlpha = alpha;
  g.fillStyle = g.strokeStyle = '#fff';
  g.lineWidth = size <= 20 ? 2.3 : 2; g.lineCap = 'round'; g.lineJoin = 'round';
  const base = name === 'repeatOne' ? 'repeatAll' : name;
  if (FILL[base]) g.fill(new Path2D(FILL[base]));
  if (STROKE[base]) g.stroke(new Path2D(STROKE[base]));
  if (DOT[name]) { g.beginPath(); g.arc(12, 22, 1.5, 0, 7); g.fill(); }
  if (name === 'repeatOne') { g.font = '700 7px "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.fillText('1', 12, 14.6); }
  if (name === 'back' || name === 'fwd') {
    const { b, f } = skipLens();
    g.font = '700 7.5px "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(name === 'back' ? b : f), 12, 13.6);
  }
  const d = g.getImageData(0, 0, size, size).data;
  // base64 of the raw RGBA bytes
  let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
  return btoa(s);
}
const NAMES = ['prev', 'next', 'play', 'pause', 'heart', 'heartOn', 'shuffle', 'shuffleOn', 'repeat', 'repeatAll', 'repeatOne', 'open', 'back', 'fwd'];
async function sendIcons(only) {
  try {
    const size = await invoke('thumb_icon_size');
    const icons = [];
    for (const n of only || NAMES) icons.push({ name: n, rgba: draw(size, n, 1) });
    // Grey versions for "nothing playing" (darker than Windows' own faint disabled look)
    if (!only) for (const n of ['prev', 'next']) icons.push({ name: n + 'Dim', rgba: draw(size, n, 0.38) });
    await invoke('thumb_icons', { size, icons });
  } catch {}
}
sendIcons();
onPref('bSkip', () => sendIcons(['back', 'fwd']));

// ---------- what to show ----------
const B = (act, icon, tip, enabled = true) => ({ act, icon, tip, enabled, hidden: false });
const bookTitle = () => book.item?.media?.metadata?.title || '';
function chapter() {
  const i = chapterAt(book.chapters, book.pos);
  return i >= 0 ? { i, c: book.chapters[i] } : null;
}
function videoOn() { return document.documentElement.classList.contains('playing'); }

function compute() {
  const bk = mode.book;
  const song = current();
  const active = bk ? !!book.started : !!(music.started && song);
  const playing = active && !!(bk ? book.playing : music.playing);
  let buttons, title = '', progress = 0, value = 0;
  if (active && bk) {
    const { b, f } = skipLens();
    buttons = [
      B('prevch', 'prev', 'Previous chapter'), B('back', 'back', `Back ${b} seconds`),
      playing ? B('toggle', 'pause', 'Pause') : B('toggle', 'play', 'Play'),
      B('fwd', 'fwd', `Forward ${f} seconds`), B('nextch', 'next', 'Next chapter'),
    ];
    const ch = chapter();
    title = [bookTitle(), ch && (ch.c.title || `Chapter ${ch.i + 1}`)].filter(Boolean).join(' · ');
    if (ch) {
      const end = book.chapters[ch.i + 1]?.start ?? ch.c.end ?? book.duration;
      const len = Math.max(1, end - ch.c.start);
      value = Math.round(Math.min(1, Math.max(0, (book.pos - ch.c.start) / len)) * 1000);
    } else if (book.duration) value = Math.round(Math.min(1, book.pos / book.duration) * 1000);
    progress = playing ? 1 : 2;
  } else if (active) {
    const fav = !!song.starred;
    buttons = [
      B('fav', fav ? 'heartOn' : 'heart', fav ? 'Remove from favourites' : 'Add to favourites'),
      B('shuffle', music.shuffle ? 'shuffleOn' : 'shuffle', music.shuffle ? 'Shuffle on' : 'Shuffle off'),
      B('prev', 'prev', 'Previous'),
      playing ? B('toggle', 'pause', 'Pause') : B('toggle', 'play', 'Play'),
      B('next', 'next', 'Next'),
      B('repeat', { off: 'repeat', all: 'repeatAll', one: 'repeatOne' }[music.repeat] || 'repeat', { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' }[music.repeat] || 'Repeat off'),
      B('open', 'open', 'Open Now playing'),
    ];
    title = [song.title, song.artist].filter(Boolean).join(' · ');
    const dur = music.dur || song.duration || 0;
    value = dur ? Math.round(Math.min(1, (music.pos || 0) / dur) * 1000) : 0;
    progress = playing ? 1 : 2;
  } else {
    // Nothing playing: Play picks up the last song or book (not while a video is on).
    const lastBook = bk && book.item;
    const lastSong = !bk && song;
    const name = lastBook ? bookTitle() : lastSong ? song.title : '';
    const can = !!name && !videoOn();
    buttons = [
      B('none', 'prevDim', 'Nothing playing'),
      can ? B('resume', 'play', `Play: ${name}`) : B('none', 'play', videoOn() ? 'A video is playing' : 'Nothing playing', false),
      B('none', 'nextDim', 'Nothing playing'),
    ];
  }
  return { buttons, title, progress, value, cover: active ? (bk ? absCover(book.item, 300) : cover(song.coverArt, 300)) : '' };
}

// ---------- send (only what changed) ----------
let lastKey = '', lastCover = null, coverReq = 0;
function push() {
  const s = compute();
  const key = JSON.stringify([s.buttons, s.title, s.progress, s.value]);
  if (key !== lastKey) {
    lastKey = key;
    invoke('thumb_set', { buttons: s.buttons, title: s.title, progress: s.progress, value: s.value }).catch(() => {});
  }
  if (s.cover !== lastCover) { lastCover = s.cover; sendCover(s.cover); }
}
function sendCover(url) {
  const req = ++coverReq;
  if (!url) { invoke('thumb_cover', { cover: null }).catch(() => {}); return; }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (req !== coverReq) return;
    try {
      const k = 256 / Math.max(img.naturalWidth, img.naturalHeight);
      const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.fillStyle = '#0d0d0d'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
      invoke('thumb_cover', { cover: { w, h, rgba: btoa(s) } }).catch(() => {});
    } catch { invoke('thumb_cover', { cover: null }).catch(() => {}); }
  };
  img.onerror = () => { if (req === coverReq) invoke('thumb_cover', { cover: null }).catch(() => {}); };
  img.src = url;
}

onMusic(push);
onBook(push);
push();
// Position changes don't always notify: refresh the progress bar once a second while something plays.
setInterval(() => { if ((mode.book ? book.playing : music.playing)) push(); }, 1000);
// A video starting or stopping changes whether Play can resume.
new MutationObserver(push).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

// ---------- clicks ----------
const ACT = {
  toggle: () => (mode.book ? window.dispatchEvent(new Event('book:toggle')) : togglePlay()),
  resume: () => (mode.book ? window.dispatchEvent(new Event('book:toggle')) : togglePlay()),
  next: () => next(),
  prev: () => prev(),
  nextch: () => nextChapter(),
  prevch: () => prevChapter(),
  back: () => skipBack(),
  fwd: () => skipFwd(),
  shuffle: () => toggleShuffle(),
  repeat: () => cycleRepeat(),
  fav: () => { const s = current(); if (s) setFavorite(s, !s.starred); },
  open: () => openNow(),
};
listen('thumb', (e) => ACT[e.payload]?.()).catch(() => {});
