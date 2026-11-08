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
      sub = it.Type === 'Series' && it.EndDate && it.Status === 'Ended'
        ? `${it.ProductionYear}–${new Date(it.EndDate).getFullYear()}`
        : String(it.ProductionYear);
    }
  }
  const pct = ud.PlayedPercentage && !ud.Played ? ud.PlayedPercentage : 0;
  const badge = ud.Played
    ? '<span class="badge">✓</span>'
    : ud.UnplayedItemCount
    ? `<span class="badge">${ud.UnplayedItemCount}</span>`
    : '';
  return `
    <a class="card ${shape}" href="#/item/${encodeURIComponent(it.Id)}" data-id="${esc(it.Id)}">
      <div class="art">
        ${src ? `<img loading="lazy" src="${esc(src)}" alt="" onload="this.classList.add('loaded')" onerror="this.remove()">` : ''}
        <div class="ph">${src ? '' : esc(it.Name)}</div>
        ${isPlayable(it) ? `<div class="play-over"><span data-play="${esc(it.Id)}" title="Play">${PLAY_ICON}</span></div>` : ''}
        ${badge}
        ${pct ? `<div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}
      </div>
      ${opts.noTitle ? '' : `<div class="title">${esc(title)}</div><div class="subtitle">${esc(sub)}</div>`}
    </a>`;
}

// One click handler for every "play" button anywhere in the app.
export async function playItem(id, fromStart = false) {
  toast('Starting playback…', false, 2500);
  try {
    await api.play(id, fromStart);
  } catch (e) {
    toast(String(e), true, 7000);
  }
}

document.addEventListener('click', (e) => {
  const p = e.target.closest('[data-play]');
  if (!p) return;
  e.preventDefault();
  e.stopPropagation();
  playItem(p.dataset.play, p.dataset.fromStart === '1');
});
