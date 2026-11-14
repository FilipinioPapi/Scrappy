// Movies & TV side menu (approved mock SideTV): your libraries, Genres, Favorites, and
// Your Library (pinned + recently watched with time left). Same size and collapse as the
// Music and Audiobooks menus, so switching tabs never moves the page.
import { api, img } from './api.js';
import { esc, runtime } from './components.js';
import { shellAttrs, headHtml, navHtml, wireSize, markNav, libStore, libHtml, drawLib, wireLib } from './sidemenu.js';

const ICON = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  movies: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  tvshows: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 21h8M9 2l3 4 3-4"/>',
  boxsets: '<rect x="3" y="8" width="13" height="13" rx="1.5"/><path d="M7 4h11.5A2.5 2.5 0 0 1 21 6.5V17"/>',
  playlists: '<path d="M4 6h12M4 11h12M4 16h7"/><path d="M19 8v8.5"/><circle cx="16.5" cy="17" r="2.5"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  genres: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  favorites: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
};
const SKIP = new Set(['music', 'livetv', 'channels', 'books', 'audiobooks']);
let views = null;

const SL = libStore('tv');
const COLL_KEY = 'tvSideColls';
let recents = [], raw = [], recentsAt = 0, loadingRecents = null;

function shellHtml() {
  return `<div ${shellAttrs('tvshell')}>
    <aside class="maside">
      ${headHtml('MOVIES &amp; TV')}
      <div class="tvnav">${navFor()}</div>
      ${libHtml([['movie', 'Movies'], ['show', 'Shows'], ['collection', 'Collections']])}
      <div class="mgrab" title="Drag to resize"></div>
    </aside>
    <section class="mmain tvmain" id="tvmain"></section>
  </div>`;
}
function navFor() {
  const libs = (views || []).filter((v) => !SKIP.has(v.CollectionType));
  return navHtml([
    ['home', 'Home', ICON.home, '#/home'],
    ...libs.map((v) => [v.Id, v.Name, ICON[v.CollectionType] || ICON.folder, `#/library/${encodeURIComponent(v.Id)}`]),
    ['genres', 'Genres', ICON.genres, '#/genres'],
    ['favorites', 'Favorites', ICON.favorites, '#/favorites'],
  ]);
}
async function loadViews(shell) {
  const draw = (d) => { const v = d?.Items; if (!v || JSON.stringify(v.map((x) => [x.Id, x.Name])) === JSON.stringify((views || []).map((x) => [x.Id, x.Name]))) return; views = v; shell.querySelector('.tvnav').innerHTML = navFor(); lightNav(shell); };
  try { draw(await api.cached('/Users/{userId}/Views')); } catch {}
  try { draw(await api.get('/Users/{userId}/Views')); } catch {}
}
function lightNav(shell) {
  const [, name, arg] = (location.hash.split('?')[0] || '#/home').split('/');
  markNav(shell, name === 'library' ? decodeURIComponent(arg || '') : ['genres', 'favorites'].includes(name) ? name : name === 'home' || !name ? 'home' : null);
}

// ---------- Recently watched ----------
const left = (it) => { const u = it.UserData || {}; return u.PlaybackPositionTicks && it.RunTimeTicks ? runtime(it.RunTimeTicks - u.PlaybackPositionTicks) + ' left' : ''; };
const pct = (it) => { const u = it.UserData || {}; return !u.Played && u.PlaybackPositionTicks && it.RunTimeTicks ? u.PlaybackPositionTicks / it.RunTimeTicks : 0; };
const code = (it) => (it.ParentIndexNumber != null && it.IndexNumber != null ? `S${it.ParentIndexNumber} E${it.IndexNumber}` : '');
const openedColls = () => { try { return JSON.parse(localStorage.getItem(COLL_KEY) || '[]'); } catch { return []; } };
function build(items) {
  const out = [], seen = new Set();
  items.sort((a, b) => (Date.parse(b.UserData?.LastPlayedDate || 0) || 0) - (Date.parse(a.UserData?.LastPlayedDate || 0) || 0));
  for (const it of items) {
    const at = Date.parse(it.UserData?.LastPlayedDate || 0) || 0;
    if (it.Type === 'Episode' && it.SeriesId) {
      if (seen.has(it.SeriesId)) continue; seen.add(it.SeriesId);
      const l = left(it);
      out.push({ k: 'sh:' + it.SeriesId, kind: 'show', t: it.SeriesName || it.Name, sub: l ? [code(it), l].filter(Boolean).join(' · ') : code(it) ? `Show · Last watched ${code(it)}` : 'Show', img: it.SeriesPrimaryImageTag ? img(it.SeriesId, 'Primary', it.SeriesPrimaryImageTag, 120) : '', shape: 'poster', href: `#/item/${encodeURIComponent(it.SeriesId)}`, prog: pct(it), at });
    } else if (it.Type === 'Movie') {
      if (seen.has(it.Id)) continue; seen.add(it.Id);
      const l = left(it);
      out.push({ k: 'mv:' + it.Id, kind: 'movie', t: it.Name, sub: ['Movie', l || (it.UserData?.Played ? 'Watched' : it.ProductionYear || '')].filter(Boolean).join(' · '), img: it.ImageTags?.Primary ? img(it.Id, 'Primary', it.ImageTags.Primary, 120) : '', shape: 'poster', href: `#/item/${encodeURIComponent(it.Id)}`, prog: pct(it), at });
    }
  }
  for (const c of openedColls()) out.push({ k: 'co:' + c.id, kind: 'collection', onlyFil: true, t: c.name, sub: c.n ? `Collection · ${c.n} titles` : 'Collection', img: c.tag ? img(c.id, 'Primary', c.tag, 120) : '', shape: 'stack', href: `#/item/${encodeURIComponent(c.id)}`, at: c.at });
  return out.sort((a, b) => b.at - a.at);
}
const F = 'Fields=PrimaryImageAspectRatio,ProductionYear&EnableImageTypes=Primary&ImageTypeLimit=1';
async function loadRecents(shell, force = false) {
  if (!force && Date.now() - recentsAt < 60000) return;
  if (loadingRecents) return loadingRecents;
  loadingRecents = (async () => {
    const q = (p) => api.get(p).then((d) => d?.Items || []).catch(() => []);
    const [resume, played] = await Promise.all([
      q(`/Users/{userId}/Items/Resume?Limit=15&MediaTypes=Video&IncludeItemTypes=Movie,Episode&${F}`),
      q(`/Users/{userId}/Items?SortBy=DatePlayed&SortOrder=Descending&Filters=IsPlayed&IncludeItemTypes=Movie,Episode&Recursive=true&Limit=40&${F}`),
    ]);
    raw = [...resume, ...played]; recents = build(raw.slice()); recentsAt = Date.now();
    redraw();
  })().finally(() => { loadingRecents = null; });
  return loadingRecents;
}
function redraw() { const sh = document.querySelector('.tvshell'); if (sh) drawLib(sh, SL, recents.length ? recents : build([])); }

/** A collection page was opened: it shows under the Collections chip. */
export function noteCollection(it) {
  const list = [{ id: it.Id, name: it.Name, tag: it.ImageTags?.Primary || '', n: it.ChildCount || 0, at: Date.now() }, ...openedColls().filter((c) => c.id !== it.Id)].slice(0, 20);
  try { localStorage.setItem(COLL_KEY, JSON.stringify(list)); } catch {}
  recents = build(raw.slice()); redraw();
}
window.addEventListener('scrappy:rowcache-clear', () => { recents = []; raw = []; recentsAt = 0; views = null; });
// After watching something, the list catches up next time a Movies & TV page opens.
['scrappy:refresh', 'scrappy:stale'].forEach((n) => window.addEventListener(n, () => { recentsAt = 0; }));

/** Make sure the Movies & TV shell is on screen and return the page area inside it. */
export function tvShell(viewEl) {
  let shell = viewEl.querySelector(':scope > .tvshell');
  // Google TV has its own side rail: the page area is all that's needed (no PC side menu to build or fill).
  if (document.documentElement.classList.contains('tv')) {
    if (!shell) { viewEl.innerHTML = '<div class="mshell tvshell"><section class="mmain tvmain" id="tvmain"></section></div>'; shell = viewEl.firstChild; }
    return shell.querySelector('#tvmain');
  }
  if (!shell) {
    viewEl.innerHTML = shellHtml();
    shell = viewEl.querySelector('.tvshell');
    wireSize(shell);
    wireLib(shell, SL, redraw, (k) => recents.find((e) => e.k === k));
    loadViews(shell);
  }
  lightNav(shell);
  redraw();
  loadRecents(shell);
  return shell.querySelector('#tvmain');
}
