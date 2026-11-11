// Audiobooks tab (Audiobookshelf): Home, Library, a genre's books, an author's books, and the book page.
// Playback and the bottom bar live in bplayer.js.
import { api } from './api.js';
import { esc, toast, loadingHtml } from './components.js';
import { IC } from './mplayer.js';
import { MI, hue } from './music.js';
import { fanTile, fanBanner, learnColors } from './gtiles.js';
import { loadBookmarks, bookmarksFor, onBookmarks, listHtml, wireList } from './bookmarks.js';
import { book, playBook, toggleBook, seekBook, setFinished, onBook, absCover, absAuthorImg, hm, clock, chapterAt, BI } from './bplayer.js';

const line = (d, n = 20) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const NAV = [
  ['', 'Home', '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'],
  ['library', 'Library', '<path d="M5 4h4v16H5zM10 4h4v16h-4zM15.5 5l3.8-1 3 15.4-3.8 1z"/>'],
  ['authors', 'Authors', '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'],
  ['series', 'Series', '<rect x="3" y="6" width="12" height="15" rx="1.5"/><path d="M7 3h12.5A1.5 1.5 0 0 1 21 4.5V17"/>'],
  ['genres', 'Genres', '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>'],
];
const BOOK_ICON = 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3';
const plural = (n, w) => `${(n || 0).toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const H = (p = '') => '#/audiobooks' + (p ? '/' + p : '');
const bookHref = (id) => H('book/' + encodeURIComponent(id));
const authorHref = (id) => H('author/' + encodeURIComponent(id));
const md = (it) => it?.media?.metadata || {};
const initials = (n) => String(n || '').split(/[\s.]+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0].toUpperCase()).slice(0, 2).join('');
/** Descriptions often come as HTML: keep only the words. */
const plainText = (html) => { const d = new DOMParser().parseFromString(String(html || ''), 'text/html'); d.querySelectorAll('br,p,div,li').forEach((n) => n.append('\n')); return (d.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim(); };
const seriesOf = (it) => { const m = md(it); const s = m.series; if (Array.isArray(s) && s[0]) return s[0].sequence ? `${s[0].name} · Book ${s[0].sequence}` : s[0].name; if (s?.name) return s.sequence ? `${s.name} · Book ${s.sequence}` : s.name; return (m.seriesName || '').replace(/ #(\S+)$/, ' · Book $1'); };

// ---------- Data ----------
let LIBS = null;
async function libraries() {
  if (!LIBS) {
    const r = await api.abs('/api/libraries');
    LIBS = (r.libraries || []).filter((l) => l.mediaType === 'book');
  }
  if (!LIBS.length) throw new Error('No audiobook libraries found on your Audiobookshelf server.');
  return LIBS;
}
const libId = () => { const id = localStorage.getItem('absLib'); return (LIBS.find((l) => l.id === id) || LIBS[0]).id; };
/** Show the saved copy right away (if any), then refresh from the server. */
async function absLoad(path, render, alive) {
  const cached = await api.absCached(path).catch(() => null);
  let shown = null;
  if (cached) { shown = JSON.stringify(cached); if (alive()) render(cached, true); }
  try {
    const fresh = await api.abs(path);
    if (alive() && JSON.stringify(fresh) !== shown) render(fresh, false);
    return fresh;
  } catch (e) { if (!cached) throw e; return cached; }
}
let PROG = new Map();
async function loadProgress() {
  try { const me = await api.abs('/api/me'); PROG = new Map((me.mediaProgress || []).filter((p) => !p.episodeId).map((p) => [p.libraryItemId, p])); } catch {}
  return PROG;
}
// Keep the progress bars right while a book plays or gets marked finished.
window.addEventListener('book:progress', ({ detail: d }) => {
  if (!d?.id) return;
  const p = PROG.get(d.id) || { libraryItemId: d.id };
  if (d.finished != null) Object.assign(p, { isFinished: d.finished, progress: d.finished ? 1 : 0, currentTime: d.finished ? p.currentTime : 0 });
  if (d.currentTime != null && d.duration) Object.assign(p, { currentTime: d.currentTime, progress: d.currentTime / d.duration, lastUpdate: Date.now() });
  PROG.set(d.id, p);
});
const progOf = (id) => PROG.get(id);
const pctOf = (id) => { const p = progOf(id); return p ? (p.isFinished ? 1 : p.progress || 0) : 0; };
const items = async (lib) => (await api.abs(`/api/libraries/${lib}/items?minified=1&sort=addedAt&desc=1&limit=0`)).results || [];

// ---------- Pieces ----------
function coverBox(it, w = 300, cls = '') {
  const m = md(it);
  return `<div class="mcv bk-cv ${cls}" style="--h:${hue(m.title || it.id)}"><span>${esc(m.title || '')}</span><img loading="lazy" src="${absCover(it, w)}" alt="" onload="this.classList.add('in')" onerror="this.remove()"></div>`;
}
function bookCard(it, sub) {
  const p = progOf(it.id), pct = pctOf(it.id), fin = p?.isFinished;
  return `<a class="mcard bk-card" href="${bookHref(it.id)}">
    <div class="mcard-art">${coverBox(it)}${fin ? `<span class="bk-done" title="Finished">${BI.check}</span>` : ''}<button type="button" class="hoverplay" data-playbook="${esc(it.id)}" aria-label="Play">${IC.play}</button></div>
    ${pct > 0 && !fin ? `<div class="bk-prog"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>` : '<div class="bk-prog bk-noprog"></div>'}
    <div class="t1">${esc(md(it).title || 'Untitled')}</div><div class="t2">${esc(sub ?? md(it).authorName ?? '')}</div></a>`;
}
function contCard(it) {
  const p = progOf(it.id), dur = it.media?.duration || 0, pct = pctOf(it.id);
  return `<a class="bk-cont" href="${bookHref(it.id)}">
    <div class="bk-cont-cv">${coverBox(it, 200)}<button type="button" class="hoverplay" data-playbook="${esc(it.id)}" aria-label="Resume">${IC.play}</button></div>
    <div class="bk-cont-tx"><div class="t1">${esc(md(it).title || '')}</div><div class="t2">${esc(md(it).authorName || '')}</div>
    <div class="bk-prog"><i style="width:${(pct * 100).toFixed(1)}%"></i></div><div class="t2 sm">${Math.round(pct * 100)}% · ${hm(dur - (p?.currentTime || 0))} left</div></div></a>`;
}
function seriesCard(it, label) {
  return `<a class="bk-ser" href="${bookHref(it.id)}">
    <div class="bk-stack">${coverBox(it, 200)}<i></i><i></i></div>
    <div class="bk-cont-tx"><div class="t1">${esc(label || md(it).seriesName || md(it).title || '')}</div><div class="t2">${esc(md(it).authorName || '')}</div>
    <div><span class="bk-pill">Up next: ${esc(md(it).title || '')}</span></div></div></a>`;
}
function authorCard(a) {
  const img = absAuthorImg(a, 300);
  return `<a class="mcard art bk-auth" href="${authorHref(a.id)}"><div class="mcard-art"><div class="mcv round bk-av" style="--h:${hue(a.name)}"><b>${esc(initials(a.name))}</b>${img ? `<img loading="lazy" src="${img}" alt="" onload="this.classList.add('in')" onerror="this.remove()">` : ''}</div></div>
    <div class="t1">${esc(a.name)}</div><div class="t2">${plural(a.numBooks ?? a.libraryItems?.length ?? 0, 'book')}</div></a>`;
}
function genreTile(g, list) {
  return fanTile(g, list, H('genre/' + encodeURIComponent(g)), absCover, (it) => md(it).title);
}
const section = (title, sub, inner, extra = '', id = '') => `<section class="msec"${id ? ` id="${id}"` : ''}><div class="msec-h"><h2>${esc(title)}${sub ? ` <span class="t2 bk-sub">${esc(sub)}</span>` : ''}</h2>${extra}</div>${inner}</section>`;
const crumbs = (trail) => `<div class="crumbs"><button type="button" class="gb sq" onclick="history.back()" aria-label="Back">${MI.back}</button>${trail.map(([l, h], i) => (i === trail.length - 1 ? `<b>${esc(l)}</b>` : `<a href="${h}">${esc(l)}</a><span>›</span>`)).join('')}</div>`;
function wirePlay(el) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-playbook]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const id = b.dataset.playbook;
    if (book.item?.id === id && book.started) toggleBook(); else playBook(id);
  });
}

// ---------- Shell ----------
function shellHtml() {
  return `<div class="mshell bkshell" style="--mside:240px">
    <aside class="maside">
      <div class="mhead"><span class="lbl">AUDIOBOOKS</span></div>
      ${NAV.map(([p, l, d]) => `<a class="mnav" data-p="${p}" href="${H(p)}">${line(d)}<span class="lbl">${l}</span></a>`).join('')}
      <div id="bkLibs"></div>
    </aside>
    <section class="mmain" id="mmain"></section>
  </div>`;
}
function drawLibs(root) {
  const box = root.querySelector('#bkLibs'); if (!box || !LIBS || LIBS.length < 2) return;
  box.innerHTML = `<div class="msep"></div><div class="mlibh lbl">LIBRARIES</div>` + LIBS.map((l) => `<button type="button" class="mnav bk-lib${l.id === libId() ? ' on' : ''}" data-lib="${esc(l.id)}">${line('<path d="' + BOOK_ICON + '"/>')}<span class="lbl">${esc(l.name)}</span></button>`).join('');
  box.onclick = (e) => { const b = e.target.closest('[data-lib]'); if (!b) return; try { localStorage.setItem('absLib', b.dataset.lib); } catch {} location.hash = H(); window.dispatchEvent(new HashChangeEvent('hashchange')); };
}

export async function booksView(root, ctx) {
  const [path, qs] = (location.hash.slice(2) || '').split('?');
  const [, page = '', rawId = ''] = path.split('/');
  const id = decodeURIComponent(rawId);
  const params = new URLSearchParams(qs || '');
  if (!root.querySelector('.bkshell')) root.innerHTML = shellHtml();
  // Home is lit on the home page, Library on the library pages (book and author pages light neither).
  const lit = ['', 'library', 'authors', 'series', 'genres', 'stats'].includes(page) ? page : page === 'genre' ? 'genres' : null;
  root.querySelectorAll('.mnav[data-p]').forEach((a) => a.classList.toggle('on', a.dataset.p === lit));
  const main = root.querySelector('#mmain');
  main.className = 'mmain bk page-' + (page || 'home');
  main.innerHTML = loadingHtml();
  const v = { main, ctx, alive: ctx.alive, params };
  try {
    await libraries(); drawLibs(root);
    switch (page) {
      case 'library': return params.get('genre') ? await libraryPage(v) : await shelfPage(v);
      case 'authors': return await authorsPage(v);
      case 'series': return await seriesPage(v);
      case 'genres': return await genresPage(v);
      case 'genre': return await genrePage(v, id);
      case 'book': return await bookPage(v, id);
      case 'author': return await authorPage(v, id);
      case 'stats': return await (await import('./stats.js')).statsPage(main, 'abs', ctx.alive);
      default: return await homePage(v);
    }
  } catch (e) {
    if (!ctx.alive()) return;
    if (String(e) === 'ABS_SESSION_EXPIRED') return ctx.fail(String(e));
    main.innerHTML = `<div class="empty">${esc(e.message || String(e))}<br><br><button class="btn secondary" onclick="location.reload()">Try again</button></div>`;
  }
}

// ---------- Home ----------
async function homePage(v) {
  const { main, alive, params } = v;
  const lib = libId();
  const [all, , authorsR, shelves] = await Promise.all([
    items(lib), loadProgress(),
    api.abs(`/api/libraries/${lib}/authors`).catch(() => ({ authors: [] })),
    api.abs(`/api/libraries/${lib}/personalized?limit=12`).catch(() => []),
  ]);
  if (!alive()) return;
  if (!all.length) { main.innerHTML = '<div class="empty">This library has no books yet.</div>'; return; }
  const byId = new Map(all.map((it) => [it.id, it]));
  const shelf = (k) => (Array.isArray(shelves) ? shelves : []).find((s) => s.id === k);

  const cont = [...PROG.values()].filter((p) => !p.isFinished && p.progress > 0 && byId.has(p.libraryItemId))
    .sort((a, b) => (b.lastUpdate || 0) - (a.lastUpdate || 0)).slice(0, 8).map((p) => byId.get(p.libraryItemId));
  const recent = all.slice(0, 14);
  const gmap = new Map();
  all.forEach((it) => (md(it).genres || []).forEach((g) => { if (!gmap.has(g)) gmap.set(g, []); gmap.get(g).push(it); }));
  const genres = [...gmap.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  const fresh = all.filter((it) => !progOf(it.id));
  const pick = () => fresh.slice().sort(() => Math.random() - 0.5).slice(0, 14);
  const series = (shelf('continue-series')?.entities || []).filter((e) => e?.media).slice(0, 6);
  const authors = (authorsR.authors || []).slice().sort((a, b) => (b.numBooks || 0) - (a.numBooks || 0)).slice(0, 14);
  const again = [...PROG.values()].filter((p) => p.isFinished && byId.has(p.libraryItemId)).sort((a, b) => (b.finishedAt || b.lastUpdate || 0) - (a.finishedAt || a.lastUpdate || 0)).slice(0, 14).map((p) => byId.get(p.libraryItemId));

  main.innerHTML = [
    cont.length ? section('Continue listening', plural(cont.length, 'book') + ' in progress', `<div class="bk-conts">${cont.map(contCard).join('')}</div>`) : '',
    section('Recently added', '', `<div class="mrow">${recent.map((it) => bookCard(it)).join('')}</div>`, `<a class="seeall" href="${H('library')}">See all</a>`),
    genres.length ? section('Genres', 'From your library', `<div class="bk-genres">${genres.map(([g, l]) => genreTile(g, l)).join('')}</div>`, '', 'row-genres') : '',
    fresh.length ? section('Discover', "Books you haven't started yet", `<div class="mrow" id="bkDisc">${pick().map((it) => bookCard(it)).join('')}</div>`, '<button type="button" class="btn secondary small" id="bkShuf">Shuffle picks</button>') : '',
    series.length ? section('Continue a series', 'Next book in series you\'ve started', `<div class="bk-conts">${series.map((it) => seriesCard(it, it.series?.name || it.media?.metadata?.series?.name)).join('')}</div>`) : '',
    authors.length ? section('Authors', 'Click one to see all their books', `<div class="mrow">${authors.map(authorCard).join('')}</div>`, '', 'row-authors') : '',
    again.length ? section('Listen again', "Books you've finished", `<div class="mrow">${again.map((it) => bookCard(it)).join('')}</div>`) : '',
  ].join('');
  learnColors(main);
  main.querySelector('#bkShuf')?.addEventListener('click', () => { main.querySelector('#bkDisc').innerHTML = pick().map((it) => bookCard(it)).join(''); });
  wirePlay(main);
  const row = params.get('row');
  if (row) setTimeout(() => main.querySelector('#row-' + row)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}

// ---------- Library (all books, or one genre) ----------
const SORTS = [['added', 'Recently added'], ['title', 'Title'], ['author', 'Author'], ['progress', 'Progress']];
const FILTERS = [['all', 'All'], ['new', 'Not started'], ['prog', 'In progress'], ['done', 'Finished']];
async function libraryPage(v) {
  const { main, alive, params } = v;
  const genre = params.get('genre') || '';
  const [all] = await Promise.all([items(libId()), loadProgress()]);
  if (!alive()) return;
  const st = { q: '', sort: localStorage.getItem('bkSort') || 'added', fil: 'all' };
  const base = genre ? all.filter((it) => (md(it).genres || []).includes(genre)) : all;
  main.innerHTML = `
    ${genre ? crumbs([['Home', H()], ['Genres', H() + '?row=genres'], [genre]]) : ''}
    <div class="bk-libh"><h1 class="disp bk-h1">${esc(genre ? genre.toUpperCase() : 'LIBRARY')}</h1><span class="t2" id="bkCount"></span>
      ${genre ? `<a class="btn secondary small" href="${H('library')}">Show all books</a>` : ''}<span class="sp"></span>
      <label class="bk-find">${line('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>', 16)}<input id="bkQ" placeholder="Filter by title or author" autocomplete="off"></label>
      <select class="pick" id="bkSort" aria-label="Sort">${SORTS.map(([k, l]) => `<option value="${k}"${k === st.sort ? ' selected' : ''}>Sort: ${l}</option>`).join('')}</select></div>
    <div class="bk-chips">${FILTERS.map(([k, l]) => `<button type="button" class="bk-chip${k === 'all' ? ' on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
    <div class="bk-grid" id="bkGrid"></div>`;
  const grid = main.querySelector('#bkGrid');
  const draw = () => {
    const q = st.q.toLowerCase();
    let list = base.filter((it) => {
      const p = progOf(it.id);
      if (st.fil === 'new' && p && (p.progress > 0 || p.isFinished)) return false;
      if (st.fil === 'prog' && !(p && !p.isFinished && p.progress > 0)) return false;
      if (st.fil === 'done' && !p?.isFinished) return false;
      return !q || (md(it).title || '').toLowerCase().includes(q) || (md(it).authorName || '').toLowerCase().includes(q);
    });
    const by = { title: (it) => (md(it).titleIgnorePrefix || md(it).title || '').toLowerCase(), author: (it) => (md(it).authorNameLF || md(it).authorName || '').toLowerCase() };
    if (by[st.sort]) list = list.slice().sort((a, b) => by[st.sort](a).localeCompare(by[st.sort](b)));
    else if (st.sort === 'progress') list = list.slice().sort((a, b) => pctOf(b.id) - pctOf(a.id));
    grid.innerHTML = list.length ? list.map((it) => bookCard(it)).join('') : '<div class="t2 bk-none">No books match.</div>';
    main.querySelector('#bkCount').textContent = plural(list.length, 'book');
  };
  let t; main.querySelector('#bkQ').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); draw(); }, 120); });
  main.querySelector('#bkSort').onchange = (e) => { st.sort = e.target.value; try { localStorage.setItem('bkSort', st.sort); } catch {} draw(); };
  main.querySelector('.bk-chips').onclick = (e) => { const c = e.target.closest('[data-f]'); if (!c) return; st.fil = c.dataset.f; main.querySelectorAll('.bk-chip').forEach((x) => x.classList.toggle('on', x === c)); draw(); };
  wirePlay(main);
  draw();
}

// ---------- One author ----------
async function authorPage(v, id) {
  const { main, alive } = v;
  await loadProgress();
  await absLoad(`/api/authors/${encodeURIComponent(id)}?include=items`, (a) => {
    const list = (a.libraryItems || []).slice().sort((x, y) => seriesOf(x).localeCompare(seriesOf(y)) || (md(x).publishedYear || '').localeCompare(md(y).publishedYear || ''));
    const fin = list.filter((it) => progOf(it.id)?.isFinished).length;
    const img = absAuthorImg(a, 400), bio = plainText(a.description);
    main.innerHTML = `
      ${crumbs([['Authors', H('authors')], [a.name]])}
      <div class="bk-ahead"><div class="mcv round bk-av bk-big" style="--h:${hue(a.name)}"><b>${esc(initials(a.name))}</b>${img ? `<img src="${img}" alt="" onload="this.classList.add('in')" onerror="this.remove()">` : ''}</div>
        <div style="min-width:0"><div class="kicker">AUTHOR</div><h1 class="disp mtitle">${esc(a.name)}</h1>
        <div class="t2 bk-meta">${plural(list.length, 'book')} in your library · ${fin} finished</div>
        ${bio ? `<p class="bk-desc clamp" id="bkBio">${esc(bio)}</p><button type="button" class="bk-more" id="bkBioMore" hidden>More</button>` : ''}</div></div>
      ${section('Books', '', `<div class="bk-grid">${list.map((it) => bookCard(it, seriesOf(it) || md(it).publishedYear || '')).join('')}</div>`)}`;
    wirePlay(main); wireMore(main, 'bkBio', 'bkBioMore');
  }, alive);
}
function wireMore(main, textId, btnId) {
  const p = main.querySelector('#' + textId), b = main.querySelector('#' + btnId); if (!p || !b) return;
  requestAnimationFrame(() => { b.hidden = p.scrollHeight <= p.clientHeight + 2; });
  b.onclick = () => { const open = p.classList.toggle('clamp'); b.textContent = open ? 'More' : 'Less'; };
}

// ---------- One book ----------
async function bookPage(v, id) {
  const { main, alive } = v;
  let item = null, unsub = null, tick = null, unBm = null;
  await absLoad(`/api/items/${encodeURIComponent(id)}?expanded=1&include=progress`, (it) => {
    item = it;
    const m = md(it), chapters = it.media?.chapters || [], dur = it.media?.duration || 0;
    const au = (m.authors || []).map((a) => `<a href="${authorHref(a.id)}">${esc(a.name)}</a>`).join(', ') || esc(m.authorName || '');
    const desc = plainText(m.description);
    main.innerHTML = `
      <div class="mhero bk-hero" style="--h:${hue(m.title || id)}"><div class="mhero-bg"><img src="${absCover(it, 600)}" alt="" onload="this.classList.add('in')" onerror="this.remove()"></div>
        ${crumbs([['Library', H('library')], [m.title || 'Book']])}
        <div class="mhero-in">${coverBox(it, 600, 'big')}
          <div style="min-width:0;flex:1"><div class="kicker">AUDIOBOOK</div><h1 class="disp mtitle">${esc(m.title || '')}</h1>
            ${m.subtitle ? `<div class="bk-subt">${esc(m.subtitle)}</div>` : ''}
            <div class="meta">${[au ? 'by ' + au : '', m.narratorName ? 'Read by ' + esc(m.narratorName) : '', esc(m.publishedYear || ''), dur ? hm(dur) : ''].filter(Boolean).join(' · ')}</div>
            <div class="bk-progrow"><div class="bk-prog lg"><i id="bkPBar"></i></div><span id="bkPTxt"></span></div>
            <div class="mbtns"><button type="button" class="btn" id="bkPlay">${IC.play}<span>Play</span></button>
              <button type="button" class="btn secondary" id="bkFin">${BI.check}<span>Mark as finished</span></button>
              <button type="button" class="btn secondary" id="bkStart" hidden>Start over</button></div></div></div></div>
      <div class="bk-body">
        <div>
          ${desc ? `<h2 class="bk-h2">About this book</h2><p class="bk-desc clamp" id="bkDesc">${esc(desc)}</p><button type="button" class="bk-more" id="bkDescMore" hidden>More</button>` : ''}
          ${seriesOf(it) ? `<div class="kicker bk-k">SERIES</div><div class="bk-line">${esc(seriesOf(it))}</div>` : ''}
          ${(m.genres || []).length ? `<div class="kicker bk-k">GENRES</div><div class="bk-chips">${m.genres.map((g) => `<a class="bk-chip" href="${H('genre/' + encodeURIComponent(g))}">${esc(g)}</a>`).join('')}</div>` : ''}
        </div>
        <div><div class="bk-chh"><div class="bk-tabs" role="tablist">
            ${chapters.length ? `<button type="button" role="tab" data-tab="ch">Chapters <em>${chapters.length}</em></button>` : ''}
            <button type="button" role="tab" data-tab="bm">Bookmarks <em id="bkBmN"></em></button></div></div>
          ${chapters.length ? `<div class="bk-chl" id="bkChl">${chapters.map((c, i) => `<button type="button" class="bk-chi" data-i="${i}"><span class="n">${i + 1}</span><span class="t">${esc(c.title || 'Chapter ' + (i + 1))}</span><span class="tk">${BI.check}</span><span class="left"></span><span class="d">${clock(c.end - c.start)}</span></button>`).join('')}</div>` : ''}
          <div class="bk-chl bm-list bk-bml" id="bkBml"></div></div>
      </div>`;
    wireMore(main, 'bkDesc', 'bkDescMore');
    const here = () => book.item?.id === id && book.started;
    const prog = () => {
      if (here()) return { t: book.pos, fin: false };
      const p = it.userMediaProgress || progOf(id);
      return { t: p?.isFinished ? dur : p?.currentTime || 0, fin: !!p?.isFinished, started: (p?.currentTime || 0) > 0 };
    };
    const refresh = () => {
      if (!alive()) { unsub?.(); return; }
      const { t, fin } = prog(), ci = fin ? chapters.length : chapterAt(chapters, t);
      main.querySelector('#bkPBar').style.width = (dur ? (fin ? 100 : (t / dur) * 100) : 0) + '%';
      main.querySelector('#bkPTxt').textContent = fin ? 'Finished' : t > 0 ? `${Math.round((t / dur) * 100)}% · ${hm(dur - t)} left` : `${hm(dur)} · not started`;
      const playing = here() && book.playing;
      const label = fin ? 'Listen again' : playing ? 'Pause' : here() ? 'Resume' : t > 0 ? (ci >= 0 && chapters.length ? `Resume · Chapter ${ci + 1}` : 'Resume') : 'Play';
      const pb = main.querySelector('#bkPlay'); pb.innerHTML = (playing ? IC.pause : IC.play) + `<span>${esc(label)}</span>`;
      const fb = main.querySelector('#bkFin'); fb.classList.toggle('on', fin); fb.innerHTML = BI.check + `<span>${fin ? 'Finished' : 'Mark as finished'}</span>`;
      fb.title = fin ? 'Click to mark as not finished' : '';
      main.querySelector('#bkStart').hidden = fin || !(t > 0);
      main.querySelectorAll('.bk-chi').forEach((b, i) => {
        b.classList.toggle('cur', i === ci && !fin); b.classList.toggle('past', i < ci || fin);
        b.querySelector('.left').textContent = i === ci && !fin ? `${clock(chapters[i].end - t)} left` : '';
      });
    };
    main.querySelector('#bkPlay').onclick = () => {
      const { fin } = prog();
      if (here()) toggleBook(); else playBook(id, fin ? { at: 0 } : {});
    };
    main.querySelector('#bkStart').onclick = () => (here() ? seekBook(0) : playBook(id, { at: 0 }));
    main.querySelector('#bkFin').onclick = async () => {
      const on = !prog().fin;
      try {
        await setFinished(id, on);
        it.userMediaProgress = { ...(it.userMediaProgress || {}), isFinished: on, currentTime: on ? dur : 0, progress: on ? 1 : 0 };
        toast(on ? 'Marked as finished.' : 'Marked as not finished.');
        refresh();
      } catch (e) { toast(String(e), true); }
    };
    main.querySelector('#bkChl')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      const c = chapters[Number(b.dataset.i)]; if (!c) return;
      if (here()) seekBook(c.start); else playBook(id, { at: c.start });
    });
    // Chapters / Bookmarks switch (remembered). Bookmarks come from Audiobookshelf.
    let bmEdit = null;
    const tabs = main.querySelectorAll('.bk-tabs [data-tab]');
    const setTab = (k) => {
      if (!chapters.length) k = 'bm';
      tabs.forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
      const chl = main.querySelector('#bkChl'); if (chl) chl.hidden = k !== 'ch';
      main.querySelector('#bkBml').hidden = k !== 'bm';
    };
    tabs.forEach((b) => (b.onclick = () => { try { localStorage.setItem('bkTab', b.dataset.tab); } catch {} setTab(b.dataset.tab); }));
    const drawMarks = () => {
      if (!alive()) { unBm?.(); return; }
      const n = bookmarksFor(id).length;
      main.querySelector('#bkBmN').textContent = n; main.querySelector('#bkBmN').hidden = !n;
      const box = main.querySelector('#bkBml');
      box.innerHTML = listHtml(id, chapters, { playBtn: true, editing: bmEdit });
      wireList(box, id, (t) => (here() ? seekBook(t) : playBook(id, { at: t })), (t) => { bmEdit = t; drawMarks(); });
    };
    unBm?.(); unBm = onBookmarks(drawMarks);
    setTab(localStorage.getItem('bkTab') === 'bm' ? 'bm' : 'ch');
    drawMarks(); loadBookmarks();
    unsub?.(); unsub = onBook(refresh);
    // While this book plays, keep the progress and the current chapter moving.
    clearInterval(tick); tick = setInterval(() => { if (!alive()) { clearInterval(tick); unsub?.(); return; } if (here() && book.playing) refresh(); }, 1000);
    refresh();
    const cur = main.querySelector('.bk-chi.cur');
    if (cur) { const box = main.querySelector('#bkChl'); box.scrollTop = cur.offsetTop - box.offsetTop - box.clientHeight / 3; }
  }, alive);
  if (!item) throw new Error('Book not found.');
}

// ---------- Bookshelf pieces (Library, Authors, Series, Genres) ----------
const nameKey = (n) => { const w = String(n || '').trim().split(/\s+/); return (w.length > 1 ? w[w.length - 1] + ' ' + w.slice(0, -1).join(' ') : w[0] || '').toLowerCase(); };
const titleKey = (it) => (md(it).titleIgnorePrefix || md(it).title || '').toLowerCase();
const authorKey = (it) => (md(it).authorNameLF || nameKey(md(it).authorName)).toLowerCase();
const authorsOf = (it) => String(md(it).authorName || '').split(/\s*,\s*|\s+&\s+/).filter(Boolean);
/** "Mistborn #1, Cosmere #3" -> [{ name, seq }] (minified items only carry this string). */
const seriesList = (it) => {
  const m = md(it);
  if (Array.isArray(m.series) && m.series.length) return m.series.map((x) => ({ name: x.name, seq: x.sequence || '' }));
  return String(m.seriesName || '').split(/,\s+(?=[^,]*?(?:#|$))/).map((x) => x.trim()).filter(Boolean).map((x) => { const r = x.match(/^(.*?)\s+#(\S+)$/); return r ? { name: r[1], seq: r[2] } : { name: x, seq: '' }; });
};
const seqNum = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : 1e9; };
const SEARCH = line('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>', 16);

/** A book standing on a shelf: its full cover art, a progress line and a finished tick. */
function shelfBook(it) {
  const m = md(it), p = progOf(it.id), pct = pctOf(it.id), fin = p?.isFinished;
  const state = fin ? 'Finished' : pct > 0 ? `${Math.round(pct * 100)}% listened` : 'Not started';
  return `<a class="bs-book" href="${bookHref(it.id)}" title="${esc(`${m.title || ''}\n${m.authorName || ''}\n${state}`)}">
    <div class="bs-art" style="--h:${hue(m.title || it.id)}"><span class="bs-ph"><b>${esc(m.title || '')}</b><i>${esc(m.authorName || '')}</i></span>
      <img loading="lazy" src="${absCover(it, 400)}" alt="" onload="this.parentNode.classList.add('ld')" onerror="this.remove()">
      ${pct > 0 && !fin ? `<span class="bs-pg"><i style="width:${(pct * 100).toFixed(1)}%"></i></span>` : ''}
      ${fin ? `<span class="bs-fin">${BI.check}</span>` : ''}
      <button type="button" class="hoverplay" data-playbook="${esc(it.id)}" aria-label="Play">${IC.play}</button></div></a>`;
}
/** One sideways shelf. Arrows and the thin bar under it come from components.js (any .row). */
const sideShelf = (list) => `<div class="bs-case"><div class="row bs-row">${list.map(shelfBook).join('')}</div><div class="bs-plank"></div></div>`;
const segHtml = (id, opts, cur) => `<div class="bk-seg" id="${id}" role="group">${opts.map(([k, l, ic]) => `<button type="button" data-k="${k}" class="${k === cur ? 'on' : ''}">${ic || ''}${l}</button>`).join('')}</div>`;
function wireSeg(main, id, fn) {
  const box = main.querySelector('#' + id);
  box.onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); fn(b.dataset.k); };
}
const pageHead = (title, find) => `<div class="bk-libh"><h1 class="disp bk-h1">${title}</h1><span class="t2" id="bkCount"></span><span class="sp"></span>
  <label class="bk-find">${SEARCH}<input id="bkQ" placeholder="${find}" autocomplete="off"></label></div>`;
function wireFind(main, fn) { let t; main.querySelector('#bkQ').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => fn(e.target.value.trim().toLowerCase()), 120); }); }
const save = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
/** Big lists draw a screenful first, then the rest as you scroll near the end. */
function drawChunks(box, parts, after) {
  let n = 0; const step = 12;
  const more = () => { box.insertAdjacentHTML('beforeend', parts.slice(n, n + step).join('')); n += step; after?.(); if (n < parts.length) io.observe(box.lastElementChild); };
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); more(); } }, { rootMargin: '800px' });
  box._more = () => { io.disconnect(); if (n < parts.length) more(); else box._more = null; };
  box.innerHTML = ''; if (!parts.length) { box._more = null; return; } more();
}


function sortBooks(l, sort) {
  const r = (it) => (progOf(it.id)?.isFinished ? 2 : pctOf(it.id) > 0 ? 0 : 1);
  if (sort === 'title') return l.slice().sort((a, b) => titleKey(a).localeCompare(titleKey(b)));
  if (sort === 'author') return l.slice().sort((a, b) => authorKey(a).localeCompare(authorKey(b)) || seqNum(seriesList(a)[0]?.seq) - seqNum(seriesList(b)[0]?.seq) || titleKey(a).localeCompare(titleKey(b)));
  if (sort === 'progress') return l.slice().sort((a, b) => r(a) - r(b) || pctOf(b.id) - pctOf(a.id) || titleKey(a).localeCompare(titleKey(b)));
  return l.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}
/** A tall bookshelf: as many covers per shelf as fit, shelves stacked top to bottom. */
function mountWall(wall, rail, alive, chunked = true) {
  let list = [], per = 0, letters = false;
  const letter = (it) => { const c = (titleKey(it)[0] || '#').toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; };
  const perRow = () => { const w = wall.clientWidth - 44; return Math.max(1, Math.floor((w + 22) / (158 + 22))); };
  const draw = () => {
    per = perRow();
    const rows = [];
    for (let i = 0; i < list.length; i += per) rows.push(list.slice(i, i + per));
    (chunked ? drawChunks : (box, parts) => { box.innerHTML = parts.join(''); })(wall, rows.map((r, i) => `<div class="bs-case bs-tall" data-i="${i}"><div class="bs-books">${r.map(shelfBook).join('')}</div><div class="bs-plank"></div></div>`));
    if (!list.length) wall.innerHTML = '<div class="t2 bk-none">No books match.</div>';
    if (!rail) return;
    // A–Z strip: jump to the first shelf holding that letter.
    rail.hidden = !letters || list.length < 30;
    if (rail.hidden) return;
    const first = new Map(); list.forEach((it, i) => { const l = letter(it); if (!first.has(l)) first.set(l, Math.floor(i / per)); });
    rail.innerHTML = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `<button type="button" data-row="${first.get(l) ?? ''}"${first.has(l) ? '' : ' disabled'}>${l}</button>`).join('');
  };
  if (rail) rail.onclick = (e) => {
    const b = e.target.closest('[data-row]'); if (!b || b.dataset.row === '') return;
    const target = Number(b.dataset.row);
    let guard = 0; // shelves draw as you scroll; draw enough to reach that one
    while (!wall.querySelector(`[data-i="${target}"]`) && wall._more && guard++ < 500) wall._more();
    wall.querySelector(`[data-i="${target}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  let rt; new ResizeObserver(() => { if (!alive()) return; if (list.length && perRow() !== per) { clearTimeout(rt); rt = setTimeout(draw, 80); } }).observe(wall);
  return { set(l, az) { list = l; letters = az; draw(); } };
}

// ---------- Library: the whole library on one tall bookshelf ----------
const LSORTS = [['title', 'Title A–Z'], ['author', 'Author'], ['added', 'Recently added'], ['progress', 'Progress']];
async function shelfPage(v) {
  const { main, alive } = v;
  const [all] = await Promise.all([items(libId()), loadProgress()]);
  if (!alive()) return;
  const st = { q: '', sort: LSORTS.some(([k]) => k === localStorage.getItem('bkShelfSort')) ? localStorage.getItem('bkShelfSort') : 'title' };
  main.innerHTML = `${pageHead('LIBRARY', 'Find a book')}
    <div class="bk-sortrow"><span class="bk-lab">SORT BY</span>${segHtml('bkSortSeg', LSORTS, st.sort)}</div>
    <div class="bs-wall" id="bkWall"></div><div class="bs-rail" id="bkRail" hidden></div>`;
  const wall = mountWall(main.querySelector('#bkWall'), main.querySelector('#bkRail'), alive);
  const sorted = () => sortBooks(all.filter((it) => !st.q || (md(it).title || '').toLowerCase().includes(st.q) || (md(it).authorName || '').toLowerCase().includes(st.q)), st.sort);
  const redo = () => { const l = sorted(); wall.set(l, st.sort === 'title'); main.querySelector('#bkCount').textContent = plural(l.length, 'book'); };
  wireFind(main, (q) => { st.q = q; redo(); });
  wireSeg(main, 'bkSortSeg', (k) => { st.sort = k; save('bkShelfSort', k); redo(); });
  wirePlay(main);
  redo();
}

// ---------- Authors: a shelf per author ----------
async function authorsPage(v) {
  const { main, alive } = v;
  const lib = libId();
  const [all, , ar] = await Promise.all([items(lib), loadProgress(), api.abs(`/api/libraries/${lib}/authors`).catch(() => ({ authors: [] }))]);
  if (!alive()) return;
  const byName = new Map();
  all.forEach((it) => authorsOf(it).forEach((n) => { const k = n.toLowerCase(); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(it); }));
  const known = new Map((ar.authors || []).map((a) => [String(a.name).toLowerCase(), a]));
  const authors = [...byName.entries()].map(([k, list]) => { const a = known.get(k) || { name: authorsOf(list[0]).find((n) => n.toLowerCase() === k) || k }; return { a, list: list.slice().sort((x, y) => seqNum(seriesList(x)[0]?.seq) - seqNum(seriesList(y)[0]?.seq) || titleKey(x).localeCompare(titleKey(y))) }; })
    .sort((x, y) => nameKey(x.a.name).localeCompare(nameKey(y.a.name)));
  main.innerHTML = `${pageHead('AUTHORS', 'Find an author')}<div id="bkShelves"></div>`;
  const box = main.querySelector('#bkShelves');
  const draw = (q = '') => {
    const l = authors.filter((x) => !q || x.a.name.toLowerCase().includes(q));
    main.querySelector('#bkCount').textContent = plural(l.length, 'author');
    drawChunks(box, l.map(({ a, list }) => {
      const img = a.id ? absAuthorImg(a, 120) : '';
      const head = `<span class="mcv round bk-av bs-av" style="--h:${hue(a.name)}"><b>${esc(initials(a.name))}</b>${img ? `<img loading="lazy" src="${img}" alt="" onload="this.classList.add('in')" onerror="this.remove()">` : ''}</span>`;
      const name = a.id ? `<a class="bs-name" href="${authorHref(a.id)}">${esc(a.name)}</a>` : `<b class="bs-name">${esc(a.name)}</b>`;
      return `<section class="bs-grp"><div class="bs-gh">${head}${name}<span class="t2">${plural(list.length, 'book')}</span></div>${sideShelf(list)}</section>`;
    }));
    if (!l.length) box.innerHTML = '<div class="t2 bk-none">No authors match.</div>';
  };
  wireFind(main, draw); wirePlay(main); draw();
}


function seriesGroups(all) {
  const map = new Map();
  all.forEach((it) => seriesList(it).forEach(({ name, seq }) => { const k = name.toLowerCase(); if (!map.has(k)) map.set(k, { name, books: [] }); map.get(k).books.push({ it, seq }); }));
  return [...map.values()].map((x) => {
    const list = x.books.sort((a, b) => seqNum(a.seq) - seqNum(b.seq) || titleKey(a.it).localeCompare(titleKey(b.it))).map((b) => b.it);
    return { name: x.name, list, by: md(list[0]).authorName || '', akey: authorKey(list[0]), added: Math.max(...list.map((it) => it.addedAt || 0)) };
  });
}
function seriesTile(x) {
  const n = x.list.length, f = x.list.filter((it) => progOf(it.id)?.isFinished).length, avg = x.list.reduce((t, it) => t + pctOf(it.id), 0) / n;
  const prog = f === n ? 'Finished' : f ? `${f} of ${n} finished` : avg > 0 ? 'Started' : 'Not started';
  return `<a class="bs-tile" href="${H('series')}?q=${encodeURIComponent(x.name)}"><div class="bs-stack">${x.list.slice(0, 3).map((it) => `<span class="bs-art sm" style="--h:${hue(md(it).title || it.id)}"><span class="bs-ph"><b>${esc(md(it).title || '')}</b></span><img loading="lazy" src="${absCover(it, 240)}" alt="" onload="this.parentNode.classList.add('ld')" onerror="this.remove()"></span>`).join('')}</div>
    <div class="t1">${esc(x.name)}</div><div class="t2">${esc(x.by)} · ${plural(n, 'book')}</div><div class="t2">${prog}</div><div class="bk-prog"><i style="width:${(avg * 100).toFixed(1)}%"></i></div></a>`;
}

// ---------- Series: a shelf per series (or a grid of collections) ----------
const SSORTS = [['author', 'Author'], ['name', 'Series A–Z'], ['added', 'Recently added']];
const SVIEWS = [['shelves', 'Shelves', line('<rect x="3" y="4" width="5" height="6" rx="1"/><rect x="10" y="4" width="5" height="6" rx="1"/><path d="M2 12h20"/><rect x="3" y="14" width="5" height="6" rx="1"/><rect x="10" y="14" width="5" height="6" rx="1"/><path d="M2 22h20"/>', 16)],
  ['grid', 'Collections', line('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>', 16)]];
async function seriesPage(v) {
  const { main, alive, params } = v;
  const [all] = await Promise.all([items(libId()), loadProgress()]);
  if (!alive()) return;
  const series = seriesGroups(all);
  const st = { q: (params.get('q') || '').toLowerCase(), sort: SSORTS.some(([k]) => k === localStorage.getItem('bkSerSort')) ? localStorage.getItem('bkSerSort') : 'author', view: localStorage.getItem('bkSerView') === 'grid' ? 'grid' : 'shelves' };
  main.innerHTML = `${pageHead('SERIES', 'Find a series')}
    <div class="bk-sortrow"><span class="bk-lab">SORT BY</span>${segHtml('bkSortSeg', SSORTS, st.sort)}<span class="sp"></span>${segHtml('bkViewSeg', SVIEWS, st.view)}</div>
    <div id="bkShelves"></div>`;
  const box = main.querySelector('#bkShelves');
  let shown = [];
  const draw = () => {
    shown = series.filter((x) => !st.q || x.name.toLowerCase().includes(st.q) || x.by.toLowerCase().includes(st.q));
    if (st.sort === 'author') shown.sort((a, b) => a.akey.localeCompare(b.akey) || a.name.localeCompare(b.name));
    else if (st.sort === 'name') shown.sort((a, b) => a.name.replace(/^the /i, '').localeCompare(b.name.replace(/^the /i, '')));
    else shown.sort((a, b) => b.added - a.added);
    main.querySelector('#bkCount').textContent = plural(shown.length, 'series').replace(/seriess$/, 'series');
    if (st.view === 'grid') { box.className = 'bs-tiles'; drawChunks(box, shown.map(seriesTile)); }
    else { box.className = ''; drawChunks(box, shown.map((x, i) => `<section class="bs-grp" data-s="${i}"><div class="bs-gh"><b class="bs-name">${esc(x.name)}</b><span class="t2">by ${esc(x.by)}</span><span class="t2">· ${plural(x.list.length, 'book')}</span></div>${sideShelf(x.list)}</section>`)); }
    if (!shown.length) box.innerHTML = `<div class="t2 bk-none">${series.length ? 'No series match.' : 'No series in this library yet.'}</div>`;
  };
  if (st.q) { st.view = 'shelves'; main.querySelector('#bkQ').value = params.get('q'); main.querySelectorAll('#bkViewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.k === 'shelves')); }
  wireFind(main, (q) => { st.q = q; draw(); });
  wireSeg(main, 'bkSortSeg', (k) => { st.sort = k; save('bkSerSort', k); draw(); });
  wireSeg(main, 'bkViewSeg', (k) => { st.view = k; save('bkSerView', k); draw(); });
  wirePlay(main); draw();
}

// ---------- Genres: a shelf per genre ----------
async function genresPage(v) {
  const { main, alive } = v;
  const [all] = await Promise.all([items(libId()), loadProgress()]);
  if (!alive()) return;
  const gmap = new Map();
  all.forEach((it) => (md(it).genres || []).forEach((g) => { if (!gmap.has(g)) gmap.set(g, []); gmap.get(g).push(it); }));
  const genres = [...gmap.entries()].sort((a, b) => b[1].length - a[1].length).map(([g, l]) => [g, l.slice().sort((a, b) => titleKey(a).localeCompare(titleKey(b)))]);
  main.innerHTML = `${pageHead('GENRES', 'Find a genre')}<div id="bkShelves"></div>`;
  const box = main.querySelector('#bkShelves');
  const draw = (q = '') => {
    const l = genres.filter(([g]) => !q || g.toLowerCase().includes(q));
    main.querySelector('#bkCount').textContent = plural(l.length, 'genre');
    drawChunks(box, l.map(([g, list]) => `<section class="bs-grp"><div class="bs-gh"><a class="bs-name lk" href="${H('genre/' + encodeURIComponent(g))}">${esc(g)}<span class="chev">›</span></a><span class="t2">${plural(list.length, 'book')}</span></div>${sideShelf(list)}</section>`));
    if (!l.length) box.innerHTML = `<div class="t2 bk-none">${genres.length ? 'No genres match.' : 'Your books have no genres set in Audiobookshelf.'}</div>`;
  };
  wireFind(main, draw); wirePlay(main); draw();
}

// ---------- One genre ----------
async function genrePage(v, g) {
  const { main, alive } = v;
  const lib = libId();
  const [all] = await Promise.all([items(lib), loadProgress()]);
  if (!alive()) return;
  const mine = all.filter((it) => (md(it).genres || []).includes(g));
  if (!mine.length) { main.innerHTML = crumbs([['Genres', H('genres')], [g]]) + '<div class="empty">No books in this genre.</div>'; return; }
  const cont = mine.filter((it) => !progOf(it.id)?.isFinished && pctOf(it.id) > 0).sort((a, b) => (progOf(b.id)?.lastUpdate || 0) - (progOf(a.id)?.lastUpdate || 0));
  const series = seriesGroups(mine).sort((a, b) => b.list.length - a.list.length);
  const byAuthor = new Map(); mine.forEach((it) => authorsOf(it).forEach((n) => byAuthor.set(n, (byAuthor.get(n) || 0) + 1)));
  const known = new Map(); try { ((await api.abs(`/api/libraries/${lib}/authors`)).authors || []).forEach((a) => known.set(String(a.name).toLowerCase(), a)); } catch {}
  if (!alive()) return;
  const authors = [...byAuthor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([n, c]) => ({ ...(known.get(n.toLowerCase()) || { name: n }), numBooks: c }));
  const hours = mine.reduce((t, it) => t + (it.media?.duration || 0), 0) / 3600;
  const recent = mine.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 20);
  const gmap = new Map(); all.forEach((it) => (md(it).genres || []).forEach((x) => { if (x === g) return; if (!gmap.has(x)) gmap.set(x, []); gmap.get(x).push(it); }));
  const others = [...gmap.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  const st = { sort: LSORTS.some(([k]) => k === localStorage.getItem('bkGenreSort')) ? localStorage.getItem('bkGenreSort') : 'title' };
  main.innerHTML = `
    ${crumbs([['Genres', H('genres')], [g]])}
    ${fanBanner(g, mine, absCover, (it) => md(it).title, `
      <div class="bg-btns"><button type="button" class="btn" id="bkSurprise">${IC.play}<span>Surprise me</span></button></div>
      <h1 class="disp bg-t">${esc(g.toUpperCase())}</h1>
      <div class="bg-s">${[plural(mine.length, 'book'), plural(byAuthor.size, 'author'), hours >= 1 ? Math.round(hours).toLocaleString() + ' hours' : '', cont.length ? cont.length + ' in progress' : ''].filter(Boolean).join(' · ')}</div>
    `)}
    ${cont.length ? section('Continue listening', `${g} you've started`, sideShelf(cont)) : ''}
    ${series.length ? section('Series', plural(series.length, 'series').replace(/seriess$/, 'series'), `<div class="row bs-tilerow">${series.map(seriesTile).join('')}</div>`) : ''}
    ${section('Recently added', '', sideShelf(recent))}
    <section class="msec"><div class="msec-h bk-allh"><h2>All ${esc(g)} <span class="t2 bk-sub">${plural(mine.length, 'book')}</span></h2>${segHtml('bkSortSeg', LSORTS, st.sort)}</div><div class="bs-wall" id="bkWall"></div></section>
    ${authors.length ? section('Authors', `Most books in ${g} first`, `<div class="mrow">${authors.map(authorCard).join('')}</div>`) : ''}
    ${others.length ? section('More genres', '', `<div class="bk-genres">${others.map(([x, l]) => genreTile(x, l)).join('')}</div>`) : ''}`;
  learnColors(main);
  const wall = mountWall(main.querySelector('#bkWall'), null, alive, false);
  wall.set(sortBooks(mine, st.sort), false);
  wireSeg(main, 'bkSortSeg', (k) => { st.sort = k; save('bkGenreSort', k); wall.set(sortBooks(mine, k), false); });
  main.querySelector('#bkSurprise').onclick = () => {
    const pool = mine.filter((it) => !progOf(it.id)); const list = pool.length ? pool : mine;
    playBook(list[Math.floor(Math.random() * list.length)].id);
  };
  wirePlay(main);
}
