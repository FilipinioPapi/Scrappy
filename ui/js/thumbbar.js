// Windows taskbar preview buttons (Previous · Play/Pause · Next), for music and audiobooks.
// Tells the app what's playing; a click comes back as a "thumb" event.
import { onMusic, music, mode, togglePlay, next, prev, current } from './mplayer.js';
import { onBook, book } from './bplayer.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

let last = '';
function push() {
  const bk = mode.book;
  const active = bk ? !!book.started : !!(music.started && current());
  const playing = active && !!(bk ? book.playing : music.playing);
  const k = `${active}|${playing}|${bk}`;
  if (k === last) return;
  last = k;
  invoke('thumb_state', { active, playing, book: bk }).catch(() => {});
}
onMusic(push);
onBook(push);
push();

// In a book, Previous / Next go by chapter (the same as the media keys).
const ACT = {
  toggle: () => (mode.book ? window.dispatchEvent(new Event('book:toggle')) : togglePlay()),
  next: () => (mode.book ? window.dispatchEvent(new Event('book:next')) : next()),
  prev: () => (mode.book ? window.dispatchEvent(new Event('book:prev')) : prev()),
};
listen('thumb', (e) => ACT[e.payload]?.()).catch(() => {});
