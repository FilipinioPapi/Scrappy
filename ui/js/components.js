import { img, api } from './api.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const PLAY_ICON = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="#fff"/></svg>';

export function toast(msg, isError = false, ms = 4000) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function runtime(ticks) {
  if (!ticks) return '';
  const min = Math.round(ticks / 600000000);
  const h = Math.floor(min / 60);
  return h ? `${h}h ${min % 60}m` : `${min}m`;
}

export function epCode(it) {
  if (it.ParentIndexNumber == null || it.IndexNumber == null) return '';
  return `S${it.ParentIndexNumber}:E${it.IndexNumber}`;
}

export function loadingHtml(text = 'Loading…') {
  return `<div class="loading"><div class="spinner"></div>${esc(text)}</div>`;
}

const PLAYABLE = new Set(['Movie', 'Episode', 'Video', 'MusicVideo', 'Trailer']);
export const isPlayable = (it) => PLAYABLE.has(it.Type) || (it.MediaType === 'Video' && !it.IsFolder);

// Choose the best picture for a card shape.
function pickImage(it, shape) {
  const t = it.ImageTags || {};
  if (shape === 'wide') {
    if (it.Type === 'Episode' && t.Primary) return img(it.Id, 'Primary', t.Primary, 500);
    if (t.Thumb) return img(it.Id, 'Thumb', t.Thumb, 500);
    if (it.BackdropImageTags?.length) return img(it.Id, 'Backdrop', it.BackdropImageTags[0], 500, 0);
    if (t.Primary) return img(it.Id, 'Primary', t.Primary, 500);
    if (it.ParentThumbItemId) return img(it.ParentThumbItemId, 'Thumb', it.ParentThumbImageTag, 500);
    if (it.ParentBackdropItemId) return img(it.ParentBackdropItemId, 'Backdrop', it.ParentBackdropImageTags?.[0], 500, 0);
    return null;
  }
  if (t.Primary) return img(it.Id, 'Primary', t.Primary, 340);
  if (it.SeriesPrimaryImageTag) return img(it.SeriesId, 'Primary', it.SeriesPrimaryImageTag, 340);
  return null;
}

export function shapeFor(it) {
  if (it.Type === 'Episode' || it.Type === 'Video') return 'wide';
  if (it.Type === 'MusicAlbum' || it.Type === 'Audio') return 'square';
  if (it.PrimaryImageAspectRatio && it.PrimaryImageAspectRatio > 1.3) return 'wide';
  return 'portrait';
}

export function card(it, opts = {}) {
  const shape = opts.shape || shapeFor(it);
  const src = pickImage(it, shape);
  const ud = it.UserData || {};
  let title = it.Name;
  let sub = opts.subtitle ?? '';
  if (!opts.subtitle) {
    if (it.Type === 'Episode') {
      title = it.SeriesName || it.Name;
      sub = [epCode(it), it.Name].filter(Boolean).join(' · ');
    } else if (it.ProductionYear) {
      const endY = it.Type === 'Series' && it.EndDate && it.Status === 'Ended' ? new Date(it.EndDate).getFullYear() : 0;
      sub = endY && endY !== it.ProductionYear ? `${it.ProductionYear}–${endY}` : String(it.ProductionYear);
    }
  }
  const pct = ud.PlayedPercentage && !ud.Played ? ud.PlayedPercentage : 0;
  const badge = ud.Played
    ? '<span class="badge">✓</span>'
    : ud.UnplayedItemCount
    ? `<span class="badge">${ud.UnplayedItemCount}</span>`
    : '';
  // Episodes and Continue Watching: clicking anywhere on the picture plays it.
  const clickPlay = isPlayable(it) && (opts.clickPlay || it.Type === 'Episode');
  return `
    <a class="card ${shape}${clickPlay ? ' click-play' : ''}" href="#/item/${encodeURIComponent(it.Id)}" data-id="${esc(it.Id)}">
      <div class="art">
        <div class="ph">${esc(it.Name)}</div>
        ${src ? `<img loading="lazy" src="${esc(src)}" alt="" onload="this.classList.add('loaded')" onerror="this.remove()">` : ''}
        ${isPlayable(it) ? `<div class="play-over"><span data-play="${esc(it.Id)}" title="Play">${PLAY_ICON}</span></div>` : ''}
        ${badge}
        ${pct ? `<div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}
      </div>
      ${opts.noTitle ? '' : `<div class="title">${esc(title)}</div><div class="subtitle">${esc(sub)}</div>`}
    </a>`;
}

// One click handler for every "play" button anywhere in the app.
export async function playItem(id, fromStart = false) {
  const player = await import('./player.js');
  player.startPlayback(id, { fromStart });
}

document.addEventListener('click', (e) => {
  const art = e.target.closest('.card.click-play .art');
  if (!art || e.target.closest('[data-play]')) return;
  e.preventDefault();
  playItem(art.closest('.card').dataset.id);
});

document.addEventListener('click', (e) => {
  const p = e.target.closest('[data-play]');
  if (!p) return;
  e.preventDefault();
  e.stopPropagation();
  playItem(p.dataset.play, p.dataset.fromStart === '1');
});

// ---------- Shows: which episode "Play" should start ----------
// Part-way through an episode → that one. Started the show → the next one.
// Never started (or finished it) → the first episode.
const EP_FIELDS = 'Fields=Overview,PrimaryImageAspectRatio';
const targets = new Map();
export async function seriesTarget(seriesId, fresh = false) {
  if (!fresh && targets.has(seriesId)) return targets.get(seriesId);
  const one = async (path) => {
    try { const d = await api.get(path); return (Array.isArray(d) ? d : d?.Items || [])[0] || null; } catch { return null; }
  };
  const [resume, next, firsts] = await Promise.all([
    one(`/Users/{userId}/Items/Resume?ParentId=${seriesId}&Recursive=true&MediaTypes=Video&Limit=1&${EP_FIELDS}`),
    one(`/Shows/NextUp?SeriesId=${seriesId}&UserId={userId}&Limit=1&${EP_FIELDS}`),
    api.get(`/Shows/${seriesId}/Episodes?UserId={userId}&Limit=40&${EP_FIELDS}`).then((d) => d?.Items || []).catch(() => []),
  ]);
  const first = firsts.find((e) => e.ParentIndexNumber !== 0) || firsts[0] || null;
  const same = (a, b) => a && b && a.Id === b.Id;
  let t;
  if (resume) t = { ep: resume, first, started: true, resume: true };
  else if (next && !same(next, first)) t = { ep: next, first, started: true, resume: false };
  else t = { ep: first, first, started: false, resume: false };
  targets.set(seriesId, t);
  return t;
}

export function seriesPlayLabel(t) {
  if (!t?.ep) return 'Play';
  return t.started ? `Play ${epCode(t.ep) || ''}`.trim() : 'Play';
}

export async function playSeries(seriesId, fromStart = false) {
  const t = await seriesTarget(seriesId, true);
  if (fromStart) { if (t.first) playItem(t.first.Id, true); return; }
  if (t.ep) playItem(t.ep.Id, false);
  else toast('No episodes to play yet.', true);
}

document.addEventListener('click', (e) => {
  const p = e.target.closest('[data-play-series]');
  if (!p) return;
  e.preventDefault();
  e.stopPropagation();
  playSeries(p.dataset.playSeries, p.dataset.fromStart === '1');
});

// ---------- Arrows on every sideways row ----------
// Same thin arrows as the home banner. They appear when the mouse is over a
// row and only on a side that has more to scroll to.
const ROW_L = '<svg viewBox="0 0 28 56" aria-hidden="true"><path d="M22 4 6 28l16 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ROW_R = '<svg viewBox="0 0 28 56" aria-hidden="true"><path d="M6 4l16 24L6 52" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function addRowArrows(row) {
  if (row.dataset.arrows || !row.parentNode) return;
  row.dataset.arrows = '1';
  const wrap = document.createElement('div');
  wrap.className = 'row-wrap';
  row.parentNode.insertBefore(wrap, row);
  wrap.appendChild(row);
  wrap.insertAdjacentHTML('beforeend', `<button class="row-arrow l" aria-label="Scroll left">${ROW_L}</button><button class="row-arrow r" aria-label="Scroll right">${ROW_R}</button>`);
  const update = () => {
    const max = row.scrollWidth - row.clientWidth;
    wrap.classList.toggle('can-l', row.scrollLeft > 4);
    wrap.classList.toggle('can-r', max > 4 && row.scrollLeft < max - 4);
  };
  const go = (dir) => row.scrollBy({ left: dir * Math.max(200, row.clientWidth * 0.85), behavior: 'smooth' });
  wrap.querySelector('.row-arrow.l').addEventListener('click', (e) => { e.stopPropagation(); go(-1); });
  wrap.querySelector('.row-arrow.r').addEventListener('click', (e) => { e.stopPropagation(); go(1); });
  // One thin bar under every sideways row (same look everywhere). Click or drag it to slide the row.
  const bar = document.createElement('div');
  bar.className = 'hbar'; bar.innerHTML = '<i></i>';
  (wrap.closest('.bs-case') || wrap).after(bar);
  const th = bar.firstChild;
  const drawBar = () => {
    const max = row.scrollWidth - row.clientWidth;
    bar.classList.toggle('none', max < 4); if (max < 4) return;
    const w = Math.max(8, (row.clientWidth / row.scrollWidth) * 100);
    th.style.width = w + '%'; th.style.left = (row.scrollLeft / max) * (100 - w) + '%';
  };
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault(); bar.setPointerCapture(e.pointerId); bar.classList.add('drag');
    row.style.scrollBehavior = 'auto'; row.style.scrollSnapType = 'none';
    const r = bar.getBoundingClientRect(), tw = th.getBoundingClientRect().width;
    const go = (x) => { const f = Math.min(1, Math.max(0, (x - r.left - tw / 2) / (r.width - tw))); row.scrollLeft = f * (row.scrollWidth - row.clientWidth); };
    go(e.clientX);
    const mv = (ev) => go(ev.clientX);
    const up = () => { bar.classList.remove('drag'); row.style.scrollBehavior = ''; row.style.scrollSnapType = ''; bar.removeEventListener('pointermove', mv); };
    bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up, { once: true }); bar.addEventListener('pointercancel', up, { once: true });
  });
  const both = () => { update(); drawBar(); };
  row.addEventListener('scroll', both, { passive: true });
  wrap.addEventListener('mouseenter', update);
  new ResizeObserver(both).observe(row);
  new MutationObserver(both).observe(row, { childList: true });
  both();
}

// Every sideways row: Movies & TV rows (.row) and Music / Audiobooks rows (.mrow).
const scanRows = () => document.querySelectorAll('#view .row:not([data-arrows]), #view .mrow:not([data-arrows])').forEach(addRowArrows);
// (Not on the TV: arrows and bars are for the mouse, and measuring every row costs time.)
{ const v = document.getElementById('view'); if (v && !/Android/.test(navigator.userAgent)) new MutationObserver(scanRows).observe(v, { childList: true, subtree: true }); }
