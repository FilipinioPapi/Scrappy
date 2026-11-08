// Right-click menu for posters and cards, plus the "Manage" windows
// (edit metadata, images, subtitles, identify, refresh, delete).
import { api, img } from './api.js';
import { esc, toast, playItem, playSeries, isPlayable } from './components.js';

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 5v14l11-7z" fill="currentColor"/></svg>',
  restart: '<svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2.05-4.95M5 5v4h4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  heart: (on) => `<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  remove: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 16l4-4 3 3 2-2 3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  cc: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 14h4M13 14h4M7 10.5h2M11 10.5h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  identify: '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 9h6M9 13h6M9 17h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2.05-4.95M19 5v4h-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="9" rx="1.5"/><rect x="3" y="15" width="18" height="6" rx="1.5"/></g></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
};

const refreshPage = () => window.dispatchEvent(new Event('scrappy:refresh'));

// Fold a card out of its row: it shrinks away and its neighbours glide over.
// Returns a function that brings it back.
function foldAway(cardEl) {
  const parent = cardEl.parentNode, next = cardEl.nextSibling;
  const section = cardEl.closest('section');
  cardEl.style.width = cardEl.offsetWidth + 'px';
  void cardEl.offsetWidth;
  cardEl.classList.add('folding');
  setTimeout(() => {
    cardEl.remove();
    cardEl.classList.remove('folding');
    cardEl.style.width = '';
    // Last card gone: tuck the whole row away too.
    if (section && !parent.querySelector('.card')) section.classList.add('row-gone');
  }, 420);
  return () => {
    section?.classList.remove('row-gone');
    parent.insertBefore(cardEl, next && next.parentNode === parent ? next : null);
    cardEl.classList.remove('unfold');
    void cardEl.offsetWidth;
    cardEl.classList.add('unfold');
    setTimeout(() => cardEl.classList.remove('unfold'), 500);
  };
}

// A toast with a button (e.g. Undo) that stays a little longer.
function actionToast(msg, label, onClick, ms = 6000) {
  const el = document.createElement('div');
  el.className = 'toast with-action';
  el.innerHTML = `<span></span><button class="btn small"></button>`;
  el.querySelector('span').textContent = msg;
  const b = el.querySelector('button');
  b.textContent = label;
  b.addEventListener('click', () => { el.remove(); onClick(); });
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- What this account may do ----------

let policy = null;
async function getPolicy() {
  if (policy) return policy;
  try {
    const u = await api.get('/Users/{userId}');
    policy = u?.Policy || {};
  } catch {
    policy = {};
  }
  return policy;
}
// Forget it when someone else signs in.
window.addEventListener('hashchange', () => { if (location.hash === '#/login') policy = null; });

function rights(pol, it) {
  const admin = !!pol.IsAdministrator;
  // Emby names the "manage library" permission differently across versions.
  const manageFlag = Object.entries(pol).some(([k, v]) => v === true && /metadata|librarymanage|managelibrary|contentmanage/i.test(k));
  const canDelete = admin || !!it.CanDelete || !!pol.EnableContentDeletion;
  const canSubs = admin || !!pol.EnableSubtitleManagement || !!pol.EnableSubtitleDownloading;
  const canEdit = admin || manageFlag || canDelete || canSubs;
  return { canEdit, canDelete, canSubs: canSubs || canEdit };
}

// ---------- The menu ----------

const menu = document.createElement('div');
menu.className = 'ctx-menu';
menu.hidden = true;
document.body.appendChild(menu);

function closeMenu() { menu.hidden = true; }
document.addEventListener('click', (e) => { if (!menu.contains(e.target)) closeMenu(); });
window.addEventListener('blur', closeMenu);
window.addEventListener('scroll', closeMenu, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

// Replace the browser's own right-click menu everywhere (except in text boxes).
document.addEventListener('contextmenu', (e) => {
  const typing = e.target.closest('input, textarea');
  if (typing) return;
  e.preventDefault();
  const cardEl = e.target.closest('.card[data-id]');
  if (!cardEl || document.documentElement.classList.contains('playing')) { closeMenu(); return; }
  openMenu(cardEl, e.clientX, e.clientY);
});

async function openMenu(cardEl, x, y) {
  const id = cardEl.dataset.id;
  const inResume = !!cardEl.closest('[data-cw]');
  const path = `/Users/{userId}/Items/${id}`;
  // Show straight away from the saved copy, then check with the server.
  let it = await api.cached(path);
  if (!it) {
    menu.innerHTML = '<div class="ctx-loading"><div class="spinner"></div></div>';
    place(x, y);
    try { it = await api.get(path); } catch (e) { closeMenu(); toast(String(e), true); return; }
  }
  const pol = await getPolicy();
  render(it, inResume, pol, cardEl);
  place(x, y);
  api.get(path).then((fresh) => { if (!menu.hidden && menu.dataset.id === id) render(fresh, inResume, pol, cardEl); }).catch(() => {});
}

function place(x, y) {
  menu.hidden = false;
  menu.classList.remove('pop');
  void menu.offsetWidth;
  menu.classList.add('pop');
  // offset sizes ignore the pop-in animation's scale.
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const left = Math.max(8, Math.min(x, innerWidth - w - 8));
  const top = Math.max(8, Math.min(y, innerHeight - h - 8));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.style.transformOrigin = `${x - left}px ${y - top}px`;
}

function render(it, inResume, pol, cardEl) {
  const ud = it.UserData || {};
  const { canEdit, canDelete, canSubs } = rights(pol, it);
  const playable = isPlayable(it) || ['Series', 'Season', 'BoxSet'].includes(it.Type);
  const resumable = isPlayable(it) && ud.PlaybackPositionTicks > 0;
  const hasVideo = isPlayable(it);
  const canIdentify = ['Movie', 'Series'].includes(it.Type);
  const thumb = it.ImageTags?.Primary ? img(it.Id, 'Primary', it.ImageTags.Primary, 120)
    : it.SeriesPrimaryImageTag ? img(it.SeriesId, 'Primary', it.SeriesPrimaryImageTag, 120) : '';
  const sub = it.Type === 'Episode'
    ? [it.SeriesName, it.ParentIndexNumber != null ? `S${it.ParentIndexNumber}:E${it.IndexNumber}` : ''].filter(Boolean).join(' · ')
    : it.ProductionYear || '';
  const row = (act, icon, label, cls = '') => `<button class="ctx-item ${cls}" data-act="${act}">${icon}<span>${label}</span></button>`;
  const manage = canEdit || canSubs || canDelete;
  menu.dataset.id = it.Id;
  if (it.Type === 'Person') {
    // Cast & crew: open their page, or fix their details and photo.
    menu.innerHTML = `
    <div class="ctx-head">
      <div class="ctx-thumb">${thumb ? `<img src="${esc(thumb)}" alt="">` : ''}</div>
      <div class="ctx-names"><b>${esc(it.Name)}</b><span>Cast &amp; crew</span></div>
    </div>
    ${row('person', ICON.grid, 'See everything they’re in', 'primary')}
    ${canEdit ? '<div class="ctx-sep"></div><div class="ctx-label">MANAGE</div>' + row('meta', ICON.pencil, 'Edit metadata…') + row('images', ICON.image, 'Edit images…') : ''}`;
  } else menu.innerHTML = `
    <div class="ctx-head">
      <div class="ctx-thumb">${thumb ? `<img src="${esc(thumb)}" alt="">` : ''}</div>
      <div class="ctx-names"><b>${esc(it.Name)}</b><span>${esc(String(sub))}</span></div>
    </div>
    ${playable ? row('play', ICON.play, resumable ? 'Resume' : 'Play', 'primary') : ''}
    ${resumable ? row('restart', ICON.restart, 'Play from start') : ''}
    ${row('fav', ICON.heart(ud.IsFavorite), ud.IsFavorite ? 'Remove from Favorites' : 'Add to Favorites', ud.IsFavorite ? 'on' : '')}
    ${row('played', ICON.check, ud.Played ? 'Mark Unwatched' : 'Mark Watched', ud.Played ? 'on' : '')}
    ${inResume ? row('unresume', ICON.remove, 'Remove from Continue Watching') : ''}
    ${manage ? '<div class="ctx-sep"></div><div class="ctx-label">MANAGE</div>' : ''}
    ${canEdit ? row('meta', ICON.pencil, 'Edit metadata…') : ''}
    ${canEdit ? row('images', ICON.image, 'Edit images…') : ''}
    ${canSubs && hasVideo ? row('subs', ICON.cc, 'Edit subtitles…') : ''}
    ${canEdit && canIdentify ? row('identify', ICON.identify, 'Identify…') : ''}
    ${canEdit ? row('refresh', ICON.refresh, 'Refresh metadata') : ''}
    ${canDelete ? '<div class="ctx-sep"></div>' + row('delete', ICON.trash, 'Delete…', 'danger') : ''}`;
  menu.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    e.stopPropagation();
    closeMenu();
    ACTIONS[b.dataset.act]?.(it, cardEl);
  };
}

const ACTIONS = {
  person: (it) => { location.hash = `#/person/${encodeURIComponent(it.Id)}`; },
  play: (it) => (it.Type === 'Series' ? playSeries(it.Id) : it.Type === 'Season' && it.SeriesId ? playSeries(it.SeriesId) : playItem(it.Id, false)),
  restart: (it) => playItem(it.Id, true),
  async fav(it) {
    const on = !it.UserData?.IsFavorite;
    try {
      await (on ? api.post(`/Users/{userId}/FavoriteItems/${it.Id}`) : api.del(`/Users/{userId}/FavoriteItems/${it.Id}`));
      toast(on ? `Added ${it.Name} to Favorites` : `Removed ${it.Name} from Favorites`);
      refreshPage();
    } catch (e) { toast(String(e), true); }
  },
  async played(it) {
    const on = !it.UserData?.Played;
    try {
      await (on ? api.post(`/Users/{userId}/PlayedItems/${it.Id}`) : api.del(`/Users/{userId}/PlayedItems/${it.Id}`));
      toast(on ? `Marked ${it.Name} as watched` : `Marked ${it.Name} as unwatched`);
      refreshPage();
    } catch (e) { toast(String(e), true); }
  },
  async unresume(it, cardEl) {
    const oldTicks = it.UserData?.PlaybackPositionTicks || 0;
    let hidden = true;
    try {
      await api.post(`/Users/{userId}/Items/${it.Id}/HideFromResume?Hide=true`);
    } catch (e) {
      // Older servers: clear the saved position instead.
      hidden = false;
      try { await api.post(`/Users/{userId}/Items/${it.Id}/UserData`, { PlaybackPositionTicks: 0 }); }
      catch { toast(String(e), true); return; }
    }
    const restore = cardEl ? foldAway(cardEl) : null;
    actionToast(`Removed ${it.Name} from Continue Watching`, 'Undo', async () => {
      try {
        if (hidden) await api.post(`/Users/{userId}/Items/${it.Id}/HideFromResume?Hide=false`);
        else await api.post(`/Users/{userId}/Items/${it.Id}/UserData`, { PlaybackPositionTicks: oldTicks });
        restore?.();
      } catch (e) { toast(String(e), true); }
    });
  },
  meta: (it) => metadataDialog(it.Id),
  images: (it) => imagesDialog(it.Id),
  subs: (it) => subtitlesDialog(it.Id),
  identify: (it) => identifyDialog(it),
  async refresh(it) {
    try {
      await api.post(`/Items/${it.Id}/Refresh?Recursive=true&MetadataRefreshMode=FullRefresh&ImageRefreshMode=FullRefresh&ReplaceAllMetadata=false&ReplaceAllImages=false`);
      toast(`Refreshing ${it.Name} from online sources. This can take a minute.`);
      setTimeout(refreshPage, 4000);
    } catch (e) { toast(String(e), true); }
  },
  delete: (it) => deleteDialog(it),
};

// ---------- Windows ----------

function dialog(title, sub, body, foot = '') {
  const wrap = document.createElement('div');
  wrap.className = 'dlg-wrap';
  wrap.innerHTML = `
    <div class="dlg" role="dialog" aria-label="${esc(title)}">
      <div class="dlg-head">
        <div><div class="dlg-title">${esc(title)}</div><div class="dlg-sub">${esc(sub || '')}</div></div>
        <button class="icon-btn dlg-x" aria-label="Close">✕</button>
      </div>
      <div class="dlg-body">${body}</div>
      ${foot ? `<div class="dlg-foot">${foot}</div>` : ''}
    </div>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.classList.add('closing'); setTimeout(() => wrap.remove(), 160); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('.dlg-x').addEventListener('click', close);
  return { el: wrap, $: (s) => wrap.querySelector(s), $$: (s) => wrap.querySelectorAll(s), close };
}

const busy = (btn, on, text) => { btn.disabled = on; if (text) btn.textContent = text; };
const fresh = (id) => api.get(`/Users/{userId}/Items/${id}`);

// Edit metadata
async function metadataDialog(id) {
  let it;
  try { it = await fresh(id); } catch (e) { toast(String(e), true); return; }
  const date = it.PremiereDate ? it.PremiereDate.slice(0, 10) : '';
  const d = dialog('Edit metadata', it.Name, `
    <div class="form">
      <label class="wide">Title<input type="text" name="Name" value="${esc(it.Name || '')}"></label>
      <label>Sort title<input type="text" name="ForcedSortName" value="${esc(it.ForcedSortName || it.SortName || '')}"></label>
      <label>Year<input type="text" name="ProductionYear" value="${esc(it.ProductionYear ?? '')}"></label>
      <label>Release date<input type="text" name="PremiereDate" placeholder="YYYY-MM-DD" value="${esc(date)}"></label>
      <label>Age rating<input type="text" name="OfficialRating" value="${esc(it.OfficialRating || '')}"></label>
      <label>Community rating<input type="text" name="CommunityRating" value="${esc(it.CommunityRating ?? '')}"></label>
      <label>Genres<input type="text" name="Genres" placeholder="Comma separated" value="${esc((it.Genres || []).join(', '))}"></label>
      <label class="wide">Tagline<input type="text" name="Tagline" value="${esc(it.Taglines?.[0] || '')}"></label>
      <label class="wide">Overview<textarea name="Overview" rows="6">${esc(it.Overview || '')}</textarea></label>
      <label class="check wide"><input type="checkbox" name="Lock" ${it.LockData ? 'checked' : ''}> Lock these details so automatic refreshes don't overwrite them</label>
    </div>`,
    `<span class="dlg-note">Saves to your Emby server, so every app sees the change.</span>
     <button class="btn secondary" data-x>Cancel</button><button class="btn" data-save>Save</button>`);
  d.$('[data-x]').onclick = d.close;
  d.$('[data-save]').onclick = async (e) => {
    const f = Object.fromEntries([...d.$$('input[name], textarea[name]')].map((i) => [i.name, i.type === 'checkbox' ? i.checked : i.value.trim()]));
    const genres = f.Genres ? f.Genres.split(',').map((g) => g.trim()).filter(Boolean) : [];
    const body = {
      ...it,
      Name: f.Name || it.Name,
      ForcedSortName: f.ForcedSortName,
      ProductionYear: f.ProductionYear ? Number(f.ProductionYear) : null,
      PremiereDate: f.PremiereDate ? new Date(f.PremiereDate + 'T00:00:00Z').toISOString() : null,
      OfficialRating: f.OfficialRating,
      CommunityRating: f.CommunityRating ? Number(f.CommunityRating) : null,
      Genres: genres,
      GenreItems: genres.map((Name) => ({ Name })),
      Taglines: f.Tagline ? [f.Tagline] : [],
      Overview: f.Overview,
      LockData: f.Lock,
    };
    busy(e.target, true, 'Saving…');
    try {
      await api.post(`/Items/${id}`, body);
      d.close();
      toast('Saved');
      refreshPage();
    } catch (err) { toast(String(err), true); busy(e.target, false, 'Save'); }
  };
}

// Edit images
const IMG_TYPES = [['Primary', 'Poster'], ['Backdrop', 'Backdrop'], ['Logo', 'Logo'], ['Thumb', 'Thumbnail']];
async function imagesDialog(id) {
  let it;
  try { it = await fresh(id); } catch (e) { toast(String(e), true); return; }
  if (it.Type === 'Episode') IMG_TYPES[0][1] = 'Picture';
  let type = 'Primary';
  const d = dialog('Edit images', it.Name, `
    <div class="seg">${IMG_TYPES.map(([t, l]) => `<button class="season-tab ${t === type ? 'active' : ''}" data-type="${t}">${l}</button>`).join('')}</div>
    <div class="img-edit">
      <div class="img-side">
        <div class="dlg-label">CURRENT</div>
        <div class="img-cur"></div>
        <button class="btn secondary" data-upload>Upload from computer…</button>
        <button class="btn secondary danger-text" data-remove>Remove image</button>
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden>
      </div>
      <div class="img-main">
        <div class="dlg-label">FROM ONLINE SOURCES <span class="img-count"></span></div>
        <div class="img-grid"></div>
      </div>
    </div>`);
  const shape = () => (type === 'Primary' && it.Type !== 'Episode' ? 'tall' : 'wide');
  const current = () => {
    const tag = type === 'Backdrop' ? it.BackdropImageTags?.[0] : it.ImageTags?.[type];
    const src = tag ? img(it.Id, type, tag, 500, type === 'Backdrop' ? 0 : undefined) : '';
    d.$('.img-cur').className = 'img-cur ' + shape();
    d.$('.img-cur').innerHTML = src ? `<img src="${esc(src)}" alt="">` : '<span>No image</span>';
    d.$('[data-remove]').disabled = !src;
  };
  const reload = async () => { it = await fresh(id); current(); refreshPage(); };
  let seq = 0;
  const loadRemote = async () => {
    const my = ++seq;
    const grid = d.$('.img-grid');
    grid.className = 'img-grid ' + shape();
    grid.innerHTML = '<div class="dlg-loading"><div class="spinner"></div>Searching…</div>';
    d.$('.img-count').textContent = '';
    try {
      const r = await api.get(`/Items/${id}/RemoteImages?Type=${type}&Limit=60&IncludeAllLanguages=false`);
      if (my !== seq) return;
      const list = r?.Images || [];
      d.$('.img-count').textContent = list.length ? `· ${list.length}` : '';
      grid.innerHTML = list.length ? list.map((x, i) => `
        <button class="img-opt" data-i="${i}" title="Use this image">
          <img src="${esc(x.ThumbnailUrl || x.Url)}" alt="" loading="lazy" onload="this.classList.add('loaded')">
          <span>${esc(x.ProviderName || '')}${x.Width ? ` · ${x.Width}×${x.Height}` : ''}${x.Language ? ` · ${esc(x.Language)}` : ''}</span>
        </button>`).join('') : '<div class="dlg-empty">No online images found for this.</div>';
      grid.querySelectorAll('.img-opt').forEach((b) => b.addEventListener('click', async () => {
        const x = list[Number(b.dataset.i)];
        b.classList.add('working');
        try {
          await api.post(`/Items/${id}/RemoteImages/Download?Type=${type}&ImageUrl=${encodeURIComponent(x.Url)}&ProviderName=${encodeURIComponent(x.ProviderName || '')}`);
          grid.querySelectorAll('.img-opt.picked').forEach((p) => p.classList.remove('picked'));
          b.classList.add('picked');
          toast('Image updated');
          await reload();
        } catch (e) { toast(String(e), true); }
        b.classList.remove('working');
      }));
    } catch (e) {
      if (my === seq) grid.innerHTML = `<div class="dlg-empty">${esc(String(e))}</div>`;
    }
  };
  d.$$('[data-type]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.type === type) return;
    type = b.dataset.type;
    d.$$('[data-type]').forEach((x) => x.classList.toggle('active', x === b));
    current();
    loadRemote();
  }));
  const file = d.$('input[type=file]');
  d.$('[data-upload]').onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(f);
    });
    try {
      await api.uploadImage(`/Items/${id}/Images/${type}`, b64, f.type || 'image/jpeg');
      toast('Image uploaded');
      await reload();
    } catch (e) { toast(String(e), true); }
  };
  d.$('[data-remove]').onclick = async () => {
    try {
      await api.del(`/Items/${id}/Images/${type}${type === 'Backdrop' ? '/0' : ''}`);
      toast('Image removed');
      await reload();
    } catch (e) { toast(String(e), true); }
  };
  current();
  loadRemote();
}

// Edit subtitles
const LANGS = [['eng', 'English'], ['spa', 'Spanish'], ['fre', 'French'], ['ger', 'German'], ['ita', 'Italian'], ['por', 'Portuguese'],
  ['dut', 'Dutch'], ['swe', 'Swedish'], ['nor', 'Norwegian'], ['dan', 'Danish'], ['fin', 'Finnish'], ['pol', 'Polish'], ['rus', 'Russian'],
  ['tur', 'Turkish'], ['ara', 'Arabic'], ['hin', 'Hindi'], ['jpn', 'Japanese'], ['kor', 'Korean'], ['chi', 'Chinese']];
async function subtitlesDialog(id) {
  let it;
  try { it = await fresh(id); } catch (e) { toast(String(e), true); return; }
  const sub = it.Type === 'Episode' ? [it.SeriesName, `S${it.ParentIndexNumber}:E${it.IndexNumber}`, it.Name].filter(Boolean).join(' · ') : it.Name;
  const lang = localStorage.getItem('subSearchLang') || 'eng';
  const d = dialog('Edit subtitles', sub, `
    <div class="dlg-label">ON THIS ${it.Type === 'Episode' ? 'EPISODE' : 'TITLE'}</div>
    <div class="sub-current"></div>
    <div class="dlg-label" style="margin-top:18px">FIND MORE ONLINE</div>
    <div class="sub-search">
      <select data-lang>${LANGS.map(([c, n]) => `<option value="${c}" ${c === lang ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <span class="dlg-note">Searches the subtitle sources set up on your Emby server.</span>
      <button class="btn" data-search>Search</button>
    </div>
    <div class="sub-results"></div>`,
    '<span class="dlg-note">Subtitles out of sync? While watching, use Subtitle timing in the player\'s settings.</span>');
  const streams = () => (it.MediaStreams || it.MediaSources?.[0]?.MediaStreams || []).filter((s) => s.Type === 'Subtitle');
  const drawCurrent = () => {
    const list = streams();
    d.$('.sub-current').innerHTML = list.length ? list.map((s) => `
      <div class="sub-row">
        <div class="sub-text"><b>${esc(s.DisplayTitle || s.Language || 'Subtitle')}</b><span>${s.IsExternal ? 'Separate file' + (s.Path ? ` · ${esc(s.Path.split(/[\\/]/).pop())}` : '') : 'Built into the video file'}</span></div>
        <span class="tag">${s.IsExternal ? 'FILE' : 'IN VIDEO'}</span>
        ${s.IsExternal ? `<button class="btn secondary danger-text" data-del="${s.Index}">Delete</button>` : '<button class="btn secondary" disabled title="Subtitles inside the video file can\'t be removed">Can\'t delete</button>'}
      </div>`).join('') : '<div class="dlg-empty">No subtitles yet.</div>';
    d.$$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      busy(b, true, 'Deleting…');
      try {
        await api.del(`/Videos/${id}/Subtitles/${b.dataset.del}`);
        toast('Subtitle deleted');
        it = await fresh(id);
        drawCurrent();
      } catch (e) { toast(String(e), true); busy(b, false, 'Delete'); }
    }));
  };
  const search = async () => {
    const code = d.$('[data-lang]').value;
    localStorage.setItem('subSearchLang', code);
    const out = d.$('.sub-results');
    out.innerHTML = '<div class="dlg-loading"><div class="spinner"></div>Searching…</div>';
    try {
      const res = await api.get(`/Items/${id}/RemoteSearch/Subtitles/${code}?IsPerfectMatch=false`);
      // Hash matches (made for this exact file) go first.
      const list = (Array.isArray(res) ? res : []).map((r, n) => ({ r, n })).sort((a, b) => (b.r.IsHashMatch ? 1 : 0) - (a.r.IsHashMatch ? 1 : 0) || a.n - b.n).map((x) => x.r);
      out.innerHTML = list.length ? list.slice(0, 40).map((r, i) => `
        <div class="sub-row">
          <div class="sub-text"><b>${r.IsHashMatch ? '<span class="hash-tag" title="Made for this exact file, so the timing should line up">HASH MATCH</span>' : ''}${esc(r.Name || r.Id)}</b><span>${[r.ProviderName, r.Format, r.CommunityRating ? `${r.CommunityRating}★` : '', r.DownloadCount ? `${r.DownloadCount.toLocaleString()} downloads` : ''].filter(Boolean).map(esc).join(' · ')}</span></div>
          <button class="btn secondary" data-get="${i}">Download</button>
        </div>`).join('') : '<div class="dlg-empty">Nothing found in that language.</div>';
      out.querySelectorAll('[data-get]').forEach((b) => b.addEventListener('click', async () => {
        busy(b, true, 'Downloading…');
        try {
          await api.post(`/Items/${id}/RemoteSearch/Subtitles/${encodeURIComponent(list[Number(b.dataset.get)].Id)}`);
          b.textContent = '✓ Added';
          b.classList.add('bounce');
          setTimeout(async () => { try { it = await fresh(id); drawCurrent(); } catch {} }, 1500);
        } catch (e) { toast(String(e), true); busy(b, false, 'Download'); }
      }));
    } catch (e) { out.innerHTML = `<div class="dlg-empty">${esc(String(e))}</div>`; }
  };
  d.$('[data-search]').onclick = search;
  drawCurrent();
}

// Identify (fix a wrong match)
async function identifyDialog(it) {
  const kind = it.Type === 'Series' ? 'Series' : 'Movie';
  const d = dialog('Identify', `Find the right match for ${it.Name}`, `
    <div class="sub-search">
      <input type="text" data-name value="${esc(it.Name || '')}" placeholder="Title">
      <input type="text" data-year value="${esc(it.ProductionYear ?? '')}" placeholder="Year" style="width:100px;flex:none">
      <button class="btn" data-search>Search</button>
    </div>
    <div class="id-results"></div>`,
    '<span class="dlg-note">Picking a match replaces the details and pictures with the ones from that match.</span>');
  const search = async () => {
    const out = d.$('.id-results');
    out.innerHTML = '<div class="dlg-loading"><div class="spinner"></div>Searching…</div>';
    const year = Number(d.$('[data-year]').value) || null;
    try {
      const list = await api.post(`/Items/RemoteSearch/${kind}`, {
        SearchInfo: { Name: d.$('[data-name]').value.trim(), Year: year },
        ItemId: it.Id,
        IncludeDisabledProviders: false,
      });
      const items = Array.isArray(list) ? list : [];
      out.innerHTML = items.length ? items.slice(0, 30).map((r, i) => `
        <button class="id-opt" data-i="${i}">
          <div class="id-img">${r.ImageUrl ? `<img src="${esc(r.ImageUrl)}" alt="" loading="lazy">` : ''}</div>
          <div class="sub-text"><b>${esc(r.Name)}${r.ProductionYear ? ` (${r.ProductionYear})` : ''}</b><span>${esc(r.SearchProviderName || '')}</span><p>${esc((r.Overview || '').slice(0, 220))}</p></div>
        </button>`).join('') : '<div class="dlg-empty">No matches found. Try a different title or year.</div>';
      out.querySelectorAll('.id-opt').forEach((b) => b.addEventListener('click', async () => {
        b.classList.add('working');
        try {
          await api.post(`/Items/RemoteSearch/Apply/${it.Id}?ReplaceAllImages=true`, items[Number(b.dataset.i)]);
          d.close();
          toast('Match updated. New details and pictures will appear shortly.');
          setTimeout(refreshPage, 3000);
        } catch (e) { toast(String(e), true); b.classList.remove('working'); }
      }));
    } catch (e) { out.innerHTML = `<div class="dlg-empty">${esc(String(e))}</div>`; }
  };
  d.$('[data-search]').onclick = search;
  d.$('[data-name]').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  search();
}

// Delete (always asks first)
function deleteDialog(it) {
  const what = it.Type === 'Series' ? 'this whole show, every season and episode,' : it.Type === 'Season' ? 'this whole season' : 'this';
  const d = dialog(`Delete ${it.Name}?`, '', `
    <p class="dlg-warn">This removes ${what} from your server, including the files on disk. It can't be undone.</p>`,
    `<button class="btn secondary" data-x>Cancel</button><button class="btn danger" data-go>Delete</button>`);
  d.$('[data-x]').onclick = d.close;
  d.$('[data-go]').onclick = async (e) => {
    busy(e.target, true, 'Deleting…');
    try {
      await api.del(`/Items/${it.Id}`);
      d.close();
      toast(`Deleted ${it.Name}`);
      if (location.hash.includes(it.Id)) history.back();
      else refreshPage();
    } catch (err) { toast(String(err), true); busy(e.target, false, 'Delete'); }
  };
}

export { subtitlesDialog };
