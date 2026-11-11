// Audiobook bookmarks. They live in Audiobookshelf (per user), so the same ones
// show up in the Audiobookshelf app and website. We keep a copy here, refreshed
// from GET /api/me, and change them with the /api/me/item/:id/bookmark calls.
import { api } from './api.js';
import { esc, toast } from './components.js';

const { invoke } = window.__TAURI__.core;
const send = (method, path, body = null) => invoke('abs_send', { method, path, body });

let all = [];           // [{ libraryItemId, time, title, createdAt }]
let loaded = 0, loading = null;
const subs = new Set();
/** Called whenever the list changes. Returns an unsubscribe function. */
export const onBookmarks = (f) => { subs.add(f); return () => subs.delete(f); };
const changed = () => subs.forEach((f) => { try { f(); } catch {} });

/** Fetch from Audiobookshelf (at most once every 30 seconds unless forced). */
export function loadBookmarks(force = false) {
  if (loading) return loading;
  if (!force && loaded && Date.now() - loaded < 30000) return Promise.resolve(all);
  loading = api.abs('/api/me').then((me) => {
    all = Array.isArray(me?.bookmarks) ? me.bookmarks : [];
    loaded = Date.now(); changed(); return all;
  }).catch(() => all).finally(() => { loading = null; });
  return loading;
}
/** This book's bookmarks, in time order. */
export const bookmarksFor = (id) => all.filter((b) => b.libraryItemId === id).sort((a, b) => a.time - b.time);

/** Save a bookmark. Times are whole seconds, like the Audiobookshelf apps. */
export async function addBookmark(id, time, title) {
  time = Math.max(0, Math.floor(time || 0));
  title = String(title || '').trim() || 'Bookmark';
  const res = await send('POST', `/api/me/item/${encodeURIComponent(id)}/bookmark`, { time, title });
  all = all.filter((b) => !(b.libraryItemId === id && b.time === time));
  all.push(res && res.time != null ? res : { libraryItemId: id, time, title, createdAt: Date.now() });
  changed();
  return time;
}
export async function renameBookmark(id, time, title) {
  title = String(title || '').trim(); if (!title) return;
  await send('PATCH', `/api/me/item/${encodeURIComponent(id)}/bookmark`, { time, title });
  const b = all.find((x) => x.libraryItemId === id && x.time === time); if (b) b.title = title;
  changed();
}
/** Delete, with an Undo in the note. */
export async function removeBookmark(id, time) {
  const b = all.find((x) => x.libraryItemId === id && x.time === time);
  try { await send('DELETE', `/api/me/item/${encodeURIComponent(id)}/bookmark/${time}`); }
  catch (e) { toast(String(e), true); return; }
  all = all.filter((x) => x !== b); changed();
  if (b) actionToast('Bookmark deleted.', 'Undo', () => addBookmark(id, b.time, b.title).catch((e) => toast(String(e), true)));
}

/** A note with a button (Rename, Undo). */
export function actionToast(msg, label, onClick, ms = 6000) {
  const el = document.createElement('div');
  el.className = 'toast with-action bm-toast';
  el.innerHTML = `${MARK_FILL}<span></span><button type="button" class="btn small secondary"></button>`;
  el.querySelector('span').textContent = msg;
  const btn = el.querySelector('button'); btn.textContent = label;
  btn.addEventListener('click', () => { el.remove(); onClick(); });
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export const MARK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/></svg>';
export const MARK_FILL = '<svg class="bm-fill" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/></svg>';
const PEN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
const BIN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>';

const clock = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(x).padStart(2, '0'); };
const chapterNo = (chapters, t) => { let i = -1; (chapters || []).forEach((c, j) => { if (c.start <= t + 0.25) i = j; }); return i; };

/** The rows of a bookmark list. playBtn adds a "Play from here" button (book page). */
export function listHtml(id, chapters, { playBtn = false, editing = null, fresh = null } = {}) {
  const list = bookmarksFor(id);
  if (!list.length) return `<div class="bm-empty">No bookmarks yet. Press <kbd>B</kbd> or the bookmark button while listening to save your spot.</div>`;
  return list.map((b) => {
    const ci = chapterNo(chapters, b.time);
    const sub = [ci >= 0 ? `Chapter ${ci + 1}` : '', b.time === fresh ? 'just now' : ''].filter(Boolean).join(' · ');
    const ed = b.time === editing;
    return `<div class="bm-row${ed ? ' edit' : ''}" data-t="${b.time}" role="button" tabindex="0" title="${ed ? '' : 'Jump to ' + clock(b.time)}">
      <span class="bm-ic">${MARK_FILL}</span>
      <span class="bm-tx">${ed ? `<input class="bm-in" value="${esc(b.title)}" maxlength="120" aria-label="Bookmark name"><small>Enter to save · Esc to cancel</small>` : `<b>${esc(b.title)}</b>${sub ? `<small>${sub}</small>` : ''}`}</span>
      <span class="bm-tm">${clock(b.time)}</span>
      ${ed ? '' : `<span class="bm-acts">${playBtn ? `<button type="button" class="gb" data-act="play" title="Play from here" aria-label="Play from here">${PLAY}</button>` : ''}<button type="button" class="gb" data-act="rename" title="Rename" aria-label="Rename">${PEN}</button><button type="button" class="gb" data-act="del" title="Delete" aria-label="Delete">${BIN}</button></span>`}
    </div>`;
  }).join('');
}

/**
 * Wire a list container (built with listHtml). jump(time) plays from that spot.
 * redraw(editingTime) rebuilds the list (null = no row being renamed).
 */
export function wireList(box, id, jump, redraw) {
  box.onclick = (e) => {
    const row = e.target.closest('.bm-row'); if (!row || row.classList.contains('edit')) return;
    const t = Number(row.dataset.t), act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'rename') redraw(t);
    else if (act === 'del') removeBookmark(id, t);
    else jump(t);
  };
  box.onkeydown = (e) => {
    const row = e.target.closest('.bm-row');
    if (e.target.classList.contains('bm-in')) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value; renameBookmark(id, Number(row.dataset.t), v).catch((er) => toast(String(er), true)).finally(() => redraw(null)); }
      else if (e.key === 'Escape') { e.preventDefault(); redraw(null); }
      return;
    }
    if (row && e.key === 'Enter') jump(Number(row.dataset.t));
  };
  const inp = box.querySelector('.bm-in');
  if (inp) { inp.focus(); inp.select(); const t0 = inp.value; inp.onblur = () => setTimeout(() => { if (!inp.isConnected) return; const v = inp.value.trim(), t = Number(inp.closest('.bm-row').dataset.t); if (v && v !== t0) renameBookmark(id, t, v).catch((er) => toast(String(er), true)).finally(() => redraw(null)); else redraw(null); }, 150); }
}
