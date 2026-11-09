// Audiobooks tab (Audiobookshelf): Home, Library, a genre's books, an author's books, and the book page.
// Playback and the bottom bar live in bplayer.js.
import { api } from './api.js';
import { esc, toast, loadingHtml } from './components.js';
import { IC } from './mplayer.js';
import { MI, hue, genreHue } from './music.js';
import { book, playBook, toggleBook, seekBook, setFinished, onBook, absCover, absAuthorImg, hm, clock, chapterAt, BI } from './bplayer.js';

const line = (d, n = 20) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const NAV = [
  ['', 'Home', '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'],
  ['library', 'Library', '<path d="M5 4h4v16H5zM10 4h4v16h-4zM15.5 5l3.8-1 3 15.4-3.8 1z"/>'],
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
  const fan = list.slice(0, 3).map((it) => `<span style="background-image:url('${absCover(it, 120)}')"></span>`).join('');
  return `<a class="mood" href="${H('library')}?genre=${encodeURIComponent(g)}" style="--h:${genreHue(g)}"><div class="shine"></div><svg class="art" viewBox="0 0 24 24" aria-hidden="true"><path d="${BOOK_ICON}"/></svg><div class="fan">${fan}</div>
    <div class="txt"><div class="nm">${esc(g)}</div><div class="ct">${plural(list.length, 'book')}</div></div></a>`;
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
  const lit = page === '' ? '' : page === 'library' ? 'library' : null;
  root.querySelectorAll('.mnav[data-p]').forEach((a) => a.classList.toggle('on', a.dataset.p === lit));
  const main = root.querySelector('#mmain');
  main.className = 'mmain bk page-' + (page || 'home');
  main.innerHTML = loadingHtml();
  const v = { main, ctx, alive: ctx.alive, params };
  try {
    await libraries(); drawLibs(root);
    switch (page) {
      case 'library': return await libraryPage(v);
      case 'book': return await bookPage(v, id);
      case 'author': return await authorPage(v, id);
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
      ${crumbs([['Home', H()], ['Authors', H() + '?row=authors'], [a.name]])}
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
  let item = null, unsub = null, tick = null;
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
          ${(m.genres || []).length ? `<div class="kicker bk-k">GENRES</div><div class="bk-chips">${m.genres.map((g) => `<a class="bk-chip" href="${H('library')}?genre=${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}</div>` : ''}
        </div>
        ${chapters.length ? `<div><div class="bk-chh"><h2 class="bk-h2">Chapters</h2><span class="t2">${plural(chapters.length, 'chapter')}</span></div>
          <div class="bk-chl" id="bkChl">${chapters.map((c, i) => `<button type="button" class="bk-chi" data-i="${i}"><span class="n">${i + 1}</span><span class="t">${esc(c.title || 'Chapter ' + (i + 1))}</span><span class="tk">${BI.check}</span><span class="left"></span><span class="d">${clock(c.end - c.start)}</span></button>`).join('')}</div></div>` : ''}
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
    unsub?.(); unsub = onBook(refresh);
    // While this book plays, keep the progress and the current chapter moving.
    clearInterval(tick); tick = setInterval(() => { if (!alive()) { clearInterval(tick); unsub?.(); return; } if (here() && book.playing) refresh(); }, 1000);
    refresh();
    const cur = main.querySelector('.bk-chi.cur');
    if (cur) { const box = main.querySelector('#bkChl'); box.scrollTop = cur.offsetTop - box.offsetTop - box.clientHeight / 3; }
  }, alive);
  if (!item) throw new Error('Book not found.');
}
