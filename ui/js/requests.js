// Requests: the Request button, "Now available" card, Make a request, group pages,
// TV seasons, and the requests list (with the admin tab). Talks to the request service
// on the server through Rust (req_call), signed in as the person's Emby account.
import { esc, toast, loadingHtml } from './components.js';

const { invoke } = window.__TAURI__.core;
const rq = (method, path, body = null) => invoke('req_call', { method, path, body });
const get = (path) => rq('GET', path);
const enc = encodeURIComponent;

const svg = (d, n = 20, sw = 1.75) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  req: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>'),
  movie: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9h17M8 5v4M16 5v4"/>', 17),
  tv: svg('<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M9 21h6M8.5 3l3.5 3 3.5-3"/>', 17),
  music: svg('<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>', 17),
  book: svg('<path d="M4 13a8 8 0 0 1 16 0"/><rect x="3.5" y="13" width="4" height="7" rx="1.5"/><rect x="16.5" y="13" width="4" height="7" rx="1.5"/>', 17),
  search: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>', 18),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>', 16),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 16),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>', 20, 1.9),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 14, 2.4),
};
const TYPES = [['movie', 'Movie', I.movie], ['tv', 'TV show', I.tv], ['music', 'Music', I.music], ['book', 'Audiobook', I.book]];
const STATUS = { requested: 'Requested', progress: 'In progress', available: 'Available', cantfind: "Can't find" };
const hue = (s) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const libHref = (type, ref) => (!ref ? '' : type === 'movie' || type === 'tv' ? `#/item/${enc(ref)}` : type === 'book' ? `#/audiobooks/book/${enc(ref)}` : `#/music/album/${enc(ref)}`);
const day = (t) => { const d = new Date(t), n = new Date(); const diff = Math.floor((new Date(n.toDateString()) - new Date(d.toDateString())) / 864e5); return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };

let me = null;
async function whoami() { if (!me) me = await get('/api/me'); return me; }

// ---------- Offline / not set up ----------
async function offlineHtml(err) {
  if (err === 'REQ_NO_EMBY') return `<div class="empty">Sign in to Emby to make requests.</div>`;
  const a = await invoke('req_address').catch(() => ({ address: '' }));
  if (err !== 'REQ_OFFLINE') return `<div class="empty">${esc(err)}<br><br><button class="btn secondary" onclick="location.reload()">Try again</button></div>`;
  return `<div class="rq-off">
    <div class="kicker">REQUESTS</div><h1 class="disp rq-h1">Requests aren't set up yet</h1>
    <p class="t2">Scrappy couldn't find the request service at <b>${esc(a.address)}</b>. If it runs somewhere else, put its address here.</p>
    <form class="rq-addr" id="rqAddr"><input id="rqAddrIn" value="${esc(a.custom ? a.address : '')}" placeholder="${esc(a.address)}" spellcheck="false"><button class="btn sm">Save</button></form>
  </div>`;
}
function wireOffline(root) {
  const f = root.querySelector('#rqAddr'); if (!f) return;
  f.onsubmit = async (e) => { e.preventDefault(); await invoke('req_set_address', { address: f.querySelector('input').value }); me = null; toast('Saved.'); window.dispatchEvent(new HashChangeEvent('hashchange')); };
}
async function fail(root, e) { root.innerHTML = await offlineHtml(String(e)); wireOffline(root); window.dispatchEvent(new Event('scrappy:ready')); }

// ---------- Shared bits ----------
function badge(it) {
  if (it.onServer && !it.partial) return `<span class="rq-badge ok">On the server</span>`;
  if (it.onServer && it.partial) return `<span class="rq-badge part">Partly on the server</span>`;
  if (it.request && ['requested', 'progress'].includes(it.request.status)) return `<span class="rq-badge req">${STATUS[it.request.status]}${it.request.count > 1 ? ` ×${it.request.count}` : ''}</span>`;
  if (it.release && !it.release.out && it.release.label) return `<span class="rq-badge soon">${esc(it.release.label)}</span>`;
  return '';
}
const art = (src, title, cls = '') => `<div class="rq-art ${cls}" style="--h:${hue(title)}"><span>${esc(title)}</span>${src ? `<img src="${esc(src)}" alt="" loading="lazy" onload="this.classList.add('in')" onerror="this.remove()">` : ''}</div>`;
const kindWord = { movie: 'MOVIE', tv: 'TV SHOW', album: 'ALBUM', song: 'SONG', book: 'AUDIOBOOK' };
const actionFor = (it) => {
  if (it.type === 'tv') return `<a class="btn sm secondary" href="#/requests/tv/${enc(it.id)}">See seasons</a>`;
  if (it.onServer) return `<a class="btn sm secondary" href="${libHref(it.type, it.onServer)}">Open</a>`;
  if (it.request && ['requested', 'progress'].includes(it.request.status)) return it.request.mine
    ? `<button class="btn sm secondary rq-mine" data-unreq="${it.request.id}" title="You asked for this. Click to cancel.">${I.check} Requested</button>`
    : `<button class="btn sm secondary rq-add" data-req="${esc(it.id)}">+ Add request</button>`;
  return `<button class="btn sm" data-req="${esc(it.id)}">Request</button>`;
};
function cardHtml(it) {
  const link = it.type === 'tv' ? `#/requests/tv/${enc(it.id)}` : '';
  return `<div class="rq-card" data-id="${esc(it.id)}">
    ${link ? `<a href="${link}" class="rq-card-art">` : '<div class="rq-card-art">'}${art(it.poster, it.title, it.type === 'album' || it.type === 'song' ? 'sq' : it.type === 'book' ? 'sq' : '')}<div class="rq-card-b">${badge(it)}</div>${link ? '</a>' : '</div>'}
    <div class="rq-ct" title="${esc(it.title)}">${esc(it.title)}</div>
    <div class="rq-cs"><span class="rq-type">${kindWord[it.type] || ''}</span><span>${esc(it.subtitle || it.year || '')}</span></div>
    ${actionFor(it)}
  </div>`;
}
function rowHtml(it, opts = {}) {
  const mineOpen = it.request && ['requested', 'progress'].includes(it.request.status) && it.request.mine;
  const sel = opts.select && !it.onServer && !mineOpen;
  return `<div class="rq-row${opts.link ? ' rq-go' : ''}" data-id="${esc(it.id)}" ${opts.link ? `data-href="${opts.link}"` : ''}>
    ${opts.select ? `<button class="rq-ck${sel ? '' : ' dis'}" data-ck="${esc(it.id)}" aria-label="Select" ${sel ? '' : 'disabled'}>${I.check}</button>` : ''}
    <div class="rq-th ${opts.round ? 'round' : ''} ${opts.sq ? 'sq' : ''}" style="--h:${hue(it.title)}">${it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>
    <div class="rq-tx"><div class="t1">${esc(it.title)}</div><div class="t2">${esc(it.subtitle || '')}</div></div>
    ${mineOpen && opts.select ? `<span class="rq-badge mine">${I.check} Requested${it.request.count > 1 ? ` ×${it.request.count}` : ''}</span>` : badge(it) || (opts.select && !it.onServer ? '<span class="t2 rq-miss">Missing</span>' : '')}
    ${opts.action ? actionFor(it) : opts.link ? `<span class="rq-chev">${I.chev}</span>` : ''}
  </div>`;
}

// ---------- Confirm sheet ----------
function sheet({ kicker, title, sub, poster, info, items, label = 'Send request', sq }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'rq-dim';
    el.innerHTML = `<form class="rq-sheet">
      <div class="rq-sh-hd"><div class="rq-th big ${sq ? 'sq' : ''}" style="--h:${hue(title)}">${poster ? `<img src="${esc(poster)}" alt="" onerror="this.remove()">` : ''}</div>
        <div style="min-width:0"><div class="kicker">${esc(kicker)}</div><h3>${esc(title)}</h3><div class="t2">${esc(sub || '')}</div></div></div>
      ${info ? `<div class="rq-info">${esc(info)}</div>` : ''}
      ${items?.length ? `<div class="rq-sh-list">${items.map((t) => `<div>${esc(t)}</div>`).join('')}</div>` : ''}
      <input class="rq-note" maxlength="300" placeholder="Add a note (optional)">
      <div class="rq-sh-btns"><button type="button" class="btn secondary" data-x>Cancel</button><button class="btn">${esc(label)}</button></div>
    </form>`;
    const done = (v) => { el.classList.add('out'); setTimeout(() => el.remove(), 180); document.removeEventListener('keydown', key); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', key);
    el.addEventListener('mousedown', (e) => { if (e.target === el) done(null); });
    el.querySelector('[data-x]').onclick = () => done(null);
    el.querySelector('form').onsubmit = (e) => { e.preventDefault(); done({ note: el.querySelector('.rq-note').value.trim() }); };
    document.body.appendChild(el);
    el.querySelector('.btn:not(.secondary)').focus();
  });
}
function noteDialog(title, current = '') {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'rq-dim';
    el.innerHTML = `<form class="rq-sheet"><div><div class="kicker">CAN'T FIND</div><h3>${esc(title)}</h3><div class="t2">Add a short note so they know why. They'll see it with the request.</div></div>
      <input class="rq-note" maxlength="300" placeholder="e.g. Not out digitally yet" value="${esc(current)}">
      <div class="rq-sh-btns"><button type="button" class="btn secondary" data-x>Cancel</button><button class="btn">Save</button></div></form>`;
    const done = (v) => { el.remove(); resolve(v); };
    el.querySelector('[data-x]').onclick = () => done(null);
    el.addEventListener('mousedown', (e) => { if (e.target === el) done(null); });
    el.querySelector('form').onsubmit = (e) => { e.preventDefault(); done(el.querySelector('input').value.trim()); };
    document.body.appendChild(el);
    el.querySelector('input').focus();
  });
}
async function send(items, note) {
  try {
    const r = await rq('POST', '/api/requests', { items, note });
    const made = r.results.filter((x) => !x.skipped), skipped = r.results.filter((x) => x.skipped);
    if (made.length) toast(made.length === 1 ? `Requested ${made[0].title}. You'll see it under Requests when it's ready.` : `Requested ${made.length} items. You'll see them under Requests.`);
    else if (skipped.length) toast(skipped.length === 1 ? `${skipped[0].title} is already on the server.` : 'Those are already on the server.');
    // Over the per-person limit (set by an admin): say how many didn't go in.
    const over = skipped.filter((x) => x.skipped === 'over your limit').length;
    if (over && made.length) toast(`${over} more didn't go in: you've reached the most open requests you can have.`, true);
    return true;
  } catch (e) { toast(String(e) === 'REQ_OFFLINE' ? "Couldn't reach the request service." : String(e), true); return false; }
}
async function unrequest(id) {
  try { await rq('DELETE', `/api/requests/${id}`); toast('Cancelled your request.'); refreshBadge(); return true; }
  catch (e) { toast(String(e) === 'REQ_OFFLINE' ? "Couldn't reach the request service." : String(e), true); return false; }
}
const typeKicker = { movie: 'REQUEST A MOVIE', tv: 'REQUEST A TV SHOW', album: 'REQUEST AN ALBUM', song: 'REQUEST A SONG', book: 'REQUEST AN AUDIOBOOK' };
async function requestOne(it) {
  let info = '';
  if (it.release && !it.release.out && it.release.label) info = `Not out yet (${it.release.label}). Your request stays on the list until it's out.`;
  if (it.type === 'song') info = `Jayden will see the song, artist and album, and decide whether to grab just the song or the whole album.`;
  if (it.request && ['requested', 'progress'].includes(it.request.status)) info = (info ? info + ' ' : '') + `${it.request.count > 1 ? it.request.count + ' people have' : 'Someone has'} already asked for this. You'll be added, so you hear when it arrives too.`;
  const ok = await sheet({ kicker: typeKicker[it.type], title: it.title, sub: it.subtitle || it.year, poster: it.poster, info, label: it.request && ['requested', 'progress'].includes(it.request.status) ? 'Add my request' : 'Send request', sq: ['album', 'song', 'book'].includes(it.type) });
  if (!ok) return false;
  return send([{ type: it.type, extId: it.id, source: it.source }], ok.note);
}

// ---------- Pages ----------
export async function requestsPage(root, ctx, sub, id) {
  root.onclick = null; root.onchange = null; // handlers left by another requests page would catch clicks here
  try { await whoami(); } catch (e) { return fail(root, e); }
  if (sub === 'new' || !sub && location.hash.includes('/new')) return makePage(root, ctx);
  if (sub === 'collection') return groupPage(root, ctx, 'collection', id);
  if (sub === 'artist') return groupPage(root, ctx, 'artist', id);
  if (sub === 'series') return groupPage(root, ctx, 'series', id);
  if (sub === 'author') return groupPage(root, ctx, 'author', id);
  if (sub === 'tv') return tvPage(root, ctx, id);
  return listPage(root, ctx);
}

// Make a request: pick a category, then search only that category.
function makePage(root, ctx) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  let type = TYPES.some(([k]) => k === params.get('type')) ? params.get('type') : 'movie';
  let all = params.get('all') === '1';
  const what = { movie: 'films', tv: 'TV shows', music: 'artists, albums and songs', book: 'audiobooks, series and authors' };
  root.innerHTML = `<div class="rq-page">
    <div class="rq-top"><div><div class="kicker">REQUESTS</div><h1 class="disp rq-h1">Make a request</h1></div><a class="rq-openbtn" href="#/requests">${I.list}Open Requests<span class="rq-n" id="rqOpenN" hidden></span></a></div>
    <div class="rq-types" role="tablist">${TYPES.map(([k, l, ic]) => `<button type="button" data-type="${k}" class="${k === type ? 'on' : ''}">${ic}${l}</button>`).join('')}</div>
    <form class="rq-big" id="rqForm">${I.search}<input id="rqQ" spellcheck="false" autocomplete="off" value="${esc(params.get('q') || '')}"><span class="t2" id="rqWhat"></span></form>
    <div id="rqRes"></div></div>`;
  const input = root.querySelector('#rqQ'), res = root.querySelector('#rqRes');
  const openCount = () => get(`/api/requests?scope=${listScope()}&status=open`).then((d) => {
    const n = root.querySelector('#rqOpenN'); if (!n) return;
    n.textContent = d.requests.length; n.hidden = !d.requests.length;
  }).catch(() => {});
  openCount();
  const setUrl = () => history.replaceState(history.state, '', `#/requests/new?type=${type}${input.value.trim() ? '&q=' + enc(input.value.trim()) : ''}${all ? '&all=1' : ''}`);
  const placeholder = () => { input.placeholder = { movie: 'Search for a film…', tv: 'Search for a TV show…', music: 'Search for an artist, album or song…', book: 'Search for a book, series or author…' }[type]; root.querySelector('#rqWhat').textContent = `Searching ${what[type]}`; };
  let seq = 0, timer, last = null;
  const run = async () => {
    const q = input.value.trim(); setUrl();
    if (q.length < 2) { res.innerHTML = `<div class="rq-hint t2">Type at least two letters. The search only looks in ${what[type]}.</div>`; return; }
    const my = ++seq;
    res.innerHTML = loadingHtml(type === 'music' ? 'Searching MusicBrainz…' : 'Searching…');
    try {
      const r = await get(`/api/search?type=${type === 'music' ? 'music' : type}&q=${enc(q)}${all ? '&all=1' : ''}`);
      if (my !== seq || !ctx.alive()) return;
      last = r; draw(r);
    } catch (e) { if (my === seq) { if (String(e) === 'REQ_OFFLINE') return fail(root, e); res.innerHTML = `<div class="empty">${esc(String(e))}</div>`; } }
  };
  const byId = new Map();
  const remember = (list) => list.forEach((it) => byId.set(it.type + ':' + it.id, it));
  function draw(r) {
    byId.clear();
    let html = '';
    if (type === 'movie' || type === 'tv') {
      remember(r.items || []);
      const c = r.collection;
      if (c && c.total > 1) {
        const missing = c.items.filter((x) => !x.onServer && !(x.request && ['requested', 'progress'].includes(x.request.status)));
        html += `<div class="rq-strip"><div class="rq-mini">${c.items.slice(0, 4).map((x) => `<i style="--h:${hue(x.title)}">${x.poster ? `<img src="${esc(x.poster)}" alt="" onerror="this.remove()">` : ''}</i>`).join('')}</div>
          <div class="rq-tx"><b>${esc(c.name)}</b><span class="t2">${c.total} films · ${c.onServer} on the server${c.notOut ? ` · ${c.notOut} not out yet` : ''}</span></div>
          <a class="btn secondary" href="#/requests/collection/${enc(c.id)}">See collection</a>${missing.length ? `<button class="btn" data-coll>Request the whole collection</button>` : '<span class="rq-badge ok">All on the server or requested</span>'}</div>`;
        remember(c.items);
        res._coll = { c, missing };
      }
      html += r.items?.length ? `<div class="section-head rq-sec"><h2>${type === 'movie' ? 'Films' : 'TV shows'}</h2><span class="count">${r.items.length}</span></div><div class="rq-grid">${r.items.map(cardHtml).join('')}</div>` : '';
    } else if (type === 'music') {
      remember([...r.albums, ...r.songs]);
      html += `<div class="rq-switchrow"><button type="button" class="rq-sw${all ? ' on' : ''}" data-all><i></i>Show singles, live &amp; compilations</button></div>`;
      if (r.artists.length) html += `<div class="kicker rq-grp">ARTISTS</div><div class="rq-list">${r.artists.map((a) => rowHtml({ ...a, subtitle: [a.subtitle, a.onServerCount ? `${a.onServerCount} album${a.onServerCount === 1 ? '' : 's'} on the server` : ''].filter(Boolean).join(' · ') }, { round: true, link: `#/requests/artist/${enc(a.id)}` })).join('')}</div>`;
      if (r.albums.length) html += `<div class="kicker rq-grp">ALBUMS</div><div class="rq-grid">${r.albums.map(cardHtml).join('')}</div>`;
      if (r.songs.length) html += `<div class="kicker rq-grp">SONGS</div><div class="rq-list">${r.songs.map((s) => rowHtml(s, { sq: true, action: true })).join('')}</div>`;
    } else {
      remember(r.books);
      if (r.source === 'openlibrary') html += `<div class="rq-hint t2">Audible had nothing for that, so these come from Open Library.</div>`;
      if (r.authors?.length) html += `<div class="kicker rq-grp">AUTHORS</div><div class="rq-list">${r.authors.map((a) => rowHtml({ id: a.id, title: a.name, subtitle: 'Author' }, { round: true, link: `#/requests/author/${enc(a.id)}` })).join('')}</div>`;
      if (r.series?.length) html += `<div class="kicker rq-grp">SERIES</div><div class="rq-list">${r.series.map((s) => rowHtml({ id: s.id, title: s.title, subtitle: `Series · ${s.author}`, poster: s.cover }, { sq: true, link: `#/requests/series/${enc(s.id)}` })).join('')}</div>`;
      if (r.books.length) html += `<div class="kicker rq-grp">AUDIOBOOKS</div><div class="rq-grid">${r.books.map(cardHtml).join('')}</div>`;
    }
    res.innerHTML = html || `<div class="empty">Nothing found for “${esc(input.value.trim())}”.</div>`;
  }
  res.addEventListener('click', async (e) => {
    const row = e.target.closest('.rq-row.rq-go'); if (row && !e.target.closest('button,a')) { location.hash = row.dataset.href; return; }
    if (e.target.closest('[data-all]')) { all = !all; run(); return; }
    if (e.target.closest('[data-coll]')) {
      const { c, missing } = res._coll;
      const ok = await sheet({ kicker: 'REQUEST A COLLECTION', title: c.name, sub: `${missing.length} film${missing.length === 1 ? '' : 's'} not on the server`, poster: c.poster, items: missing.map((m) => `${m.title}${m.year ? ' (' + m.year + ')' : ''}${!m.release.out && m.release.label ? ' · ' + m.release.label : ''}`), label: `Request ${missing.length} film${missing.length === 1 ? '' : 's'}` });
      if (ok && (await send(missing.map((m) => ({ type: 'movie', extId: m.id })), ok.note))) run();
      return;
    }
    const un = e.target.closest('[data-unreq]');
    if (un) { if (await unrequest(un.dataset.unreq)) { run(); openCount(); } return; }
    const b = e.target.closest('[data-req]'); if (!b) return;
    const card = b.closest('[data-id]');
    const it = [...byId.values()].find((x) => x.id === card.dataset.id);
    if (it && (await requestOne(it))) { run(); openCount(); }
  });
  root.querySelector('.rq-types').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]'); if (!b || b.dataset.type === type) return;
    type = b.dataset.type; all = false;
    root.querySelectorAll('.rq-types button').forEach((x) => x.classList.toggle('on', x === b));
    placeholder(); res.innerHTML = ''; run(); input.focus();
  });
  root.querySelector('#rqForm').onsubmit = (e) => { e.preventDefault(); clearTimeout(timer); run(); };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, type === 'music' ? 700 : 450); });
  placeholder();
  if (input.value.trim()) run(); else res.innerHTML = `<div class="rq-hint t2">Pick a category, then search. The search only looks in that category.</div>`;
  setTimeout(() => input.focus(), 50);
  window.dispatchEvent(new Event('scrappy:ready'));
}

// Group pages: a film collection, an artist's albums, a book series, an author's books.
async function groupPage(root, ctx, kind, id) {
  root.innerHTML = `<div class="rq-page">${loadingHtml()}</div>`;
  let all = new URLSearchParams(location.hash.split('?')[1] || '').get('all') === '1';
  const path = { collection: `/api/collection/${enc(id)}`, artist: `/api/artist/${enc(id)}`, series: `/api/series/${enc(id)}`, author: `/api/author/${enc(id)}` }[kind];
  let d;
  const load = async () => { d = await get(path + (kind === 'artist' && all ? '?all=1' : '')); };
  try { await load(); } catch (e) { return fail(root, e); }
  if (!ctx.alive()) return;
  const selected = new Set();
  const draw = () => {
    const items = d.items || d.books || [];
    const open = (x) => x.request && ['requested', 'progress'].includes(x.request.status);
    const missing = items.filter((x) => !x.onServer && !(open(x) && x.request.mine) && (kind !== 'artist' || ['album', 'ep'].includes(x.kind)));
    const word = { collection: 'film', artist: 'album', series: 'book', author: 'book' }[kind];
    const pl = (n) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const head = {
      collection: ['COLLECTION', d.name, `${pl(d.total)} · ${d.onServer} on the server`, d.poster, missing.length ? `Request ${pl(missing.length)} missing` : ''],
      artist: ['ARTIST', d.name, `${d.onServer} of ${pl(d.total)} on the server${d.disambiguation ? ' · ' + d.disambiguation : ''}`, items.find((x) => x.kind === 'album')?.poster, missing.length ? 'Request whole discography' : ''],
      series: ['SERIES', d.title, `${d.author ? d.author + ' · ' : ''}${pl(d.total)} · ${d.onServer} on the server`, d.cover, missing.length ? 'Request the whole series' : ''],
      author: ['AUTHOR', d.name, `${pl(d.total)} · ${d.onServer} on the server`, items[0]?.poster, missing.length ? 'Request all' : ''],
    }[kind];
    root.innerHTML = `<div class="rq-page"><div class="rq-back"><a href="javascript:history.back()">‹ Back</a></div><div class="rq-gp">
      <div class="rq-hero">${art(head[3], head[1], kind === 'collection' ? '' : 'sq' + (kind === 'artist' ? ' round' : ''))}
        <div><div class="kicker">${head[0]}</div><h2>${esc(head[1])}</h2><div class="t2">${esc(head[2])}</div></div>
        ${head[4] ? `<button class="btn rq-wide" data-all-missing>${esc(head[4])}</button>` : `<span class="rq-badge ok">Everything is on the server or requested</span>`}
        ${kind === 'artist' ? `<button type="button" class="rq-sw${all ? ' on' : ''}" data-allsw><i></i>Show singles, live &amp; compilations</button>` : ''}
      </div>
      <div><div class="rq-list">${items.map((x) => rowHtml({ ...x, subtitle: x.subtitle || x.year }, { select: true, sq: kind !== 'collection' })).join('') || '<div class="empty">Nothing here.</div>'}</div>
        <div class="rq-bar" ${selected.size ? '' : 'hidden'}><div class="rq-tx"><b>${selected.size} selected</b></div><button class="btn secondary" data-clear>Clear</button><button class="btn" data-sel>Request ${pl(selected.size)}</button></div></div>
    </div></div>`;
    items.forEach((x) => { if (selected.has(x.id)) root.querySelector(`[data-ck="${CSS.escape(x.id)}"]`)?.classList.add('on'); });
    root.onclick = async (e) => {
      const ck = e.target.closest('[data-ck]');
      if (ck) { const k = ck.dataset.ck; selected.has(k) ? selected.delete(k) : selected.add(k); draw(); return; }
      if (e.target.closest('[data-clear]')) { selected.clear(); draw(); return; }
      if (e.target.closest('[data-allsw]')) { all = !all; root.innerHTML = `<div class="rq-page">${loadingHtml()}</div>`; await load(); draw(); return; }
      const list = e.target.closest('[data-sel]') ? items.filter((x) => selected.has(x.id)) : e.target.closest('[data-all-missing]') ? missing : null;
      if (!list?.length) return;
      const ok = await sheet({ kicker: `REQUEST ${list.length > 1 ? word.toUpperCase() + 'S' : 'A ' + word.toUpperCase()}`, title: head[1], sub: pl(list.length), poster: head[3], items: list.map((x) => `${x.title}${x.subtitle ? ' · ' + x.subtitle : ''}`), label: `Request ${pl(list.length)}`, sq: kind !== 'collection' });
      if (!ok) return;
      if (await send(list.map((x) => ({ type: x.type, extId: x.id, source: x.source })), ok.note)) { selected.clear(); await load(); draw(); }
    };
  };
  draw();
  window.dispatchEvent(new Event('scrappy:ready'));
}

// TV: seasons compared with Emby, missing episodes, new seasons.
async function tvPage(root, ctx, id) {
  root.innerHTML = `<div class="rq-page">${loadingHtml()}</div>`;
  let d;
  const load = async () => { d = await get(`/api/tv/${enc(id)}`); };
  try { await load(); } catch (e) { return fail(root, e); }
  if (!ctx.alive()) return;
  const pick = { seasons: new Set(), eps: new Map() };
  let showSpecials = false;
  const openNow = new Set(d.seasons.filter((s) => s.status === 'partial').map((s) => s.n));
  const missingEps = (s) => s.episodes.filter((e) => e.aired && !e.onServer && !e.requested).map((e) => e.n);
  const badgeFor = (s) => s.requested ? '<span class="rq-badge req">Requested</span>' : {
    complete: s.label ? `<span class="rq-badge ok">On the server</span><span class="rq-badge soon">${esc(s.label)}</span>` : '<span class="rq-badge ok">On the server</span>',
    partial: '<span class="rq-badge part">Partly on the server</span>', missing: '<span class="t2 rq-miss">Missing</span>', soon: `<span class="rq-badge soon">${esc(s.label || 'Coming soon')}</span>`,
  }[s.status];
  const partsText = () => {
    const bits = [...pick.seasons].sort((a, b) => a - b).map((n) => `Season ${n}`);
    for (const [s, set] of [...pick.eps].sort((a, b) => a[0] - b[0])) if (set.size) bits.push(`Season ${s}: episode${set.size > 1 ? 's' : ''} ${[...set].sort((a, b) => a - b).join(', ')}`);
    return bits;
  };
  const count = () => pick.seasons.size + [...pick.eps.values()].reduce((a, s) => a + s.size, 0);
  const draw = () => {
    const seasons = d.seasons.filter((s) => !s.special || showSpecials);
    const specials = d.seasons.filter((s) => s.special).length;
    const wantAll = d.seasons.filter((s) => !s.special && !s.requested && (s.status === 'missing' || (s.status === 'partial' && missingEps(s).length)));
    root.innerHTML = `<div class="rq-page"><div class="rq-back"><a href="javascript:history.back()">‹ Back</a></div><div class="rq-gp">
      <div class="rq-hero">${art(d.poster, d.title)}
        <div><div class="kicker">TV SHOW</div><h2>${esc(d.title)}</h2><div class="t2">${esc([d.year, d.airing ? 'Still airing' : 'Ended', `${d.seasons.filter((s) => !s.special && s.aired).length} season${d.seasons.filter((s) => !s.special && s.aired).length === 1 ? '' : 's'} out`].filter(Boolean).join(' · '))}</div></div>
        ${wantAll.length ? `<button class="btn rq-wide" data-missing>Request what's missing</button>` : `<span class="rq-badge ok">${d.onServer ? 'Everything out is on the server or requested' : 'Nothing to request yet'}</span>`}
        ${d.onServer ? `<a class="btn secondary rq-wide" href="#/item/${enc(d.onServer)}">Open in Scrappy</a>` : ''}
        ${d.airing ? `<button type="button" class="rq-sw${d.following ? ' on' : ''}" data-follow><i></i>Request new seasons too</button>` : ''}
      </div>
      <div>${seasons.map((s) => {
        const selectable = !s.requested && s.status !== 'complete';
        const open = openNow.has(s.n);
        return `<div class="rq-season${open ? ' open' : ''}" data-s="${s.n}">
          <div class="rq-sh"><button class="rq-ck${pick.seasons.has(s.n) ? ' on' : ''}${selectable ? '' : ' dis'}" data-sck="${s.n}" ${selectable ? '' : 'disabled'} aria-label="Select season">${I.check}</button>
            <button type="button" class="rq-tx rq-sname" data-open="${s.n}"><b>${esc(s.name)}</b> <span class="t2">· ${s.total ? (s.status === 'soon' ? `${s.total} episodes planned` : `${s.onServer} of ${s.aired} episode${s.aired === 1 ? '' : 's'} on the server`) : 'Announced'}</span></button>
            ${badgeFor(s)}${s.status === 'partial' && !s.requested && missingEps(s).length ? `<button class="btn sm" data-smiss="${s.n}">Request missing episodes</button>` : ''}
            <button type="button" class="rq-chev${open ? ' up' : ''}" data-open="${s.n}" aria-label="Episodes">${I.chev}</button></div>
          ${open ? `<div class="rq-eps">${s.episodes.map((e) => {
            const can = !e.onServer && !e.requested && !s.requested && !pick.seasons.has(s.n);
            const on = pick.eps.get(s.n)?.has(e.n);
            return `<div class="rq-ep"><button class="rq-ck${on ? ' on' : ''}${can ? '' : ' dis'}" data-eck="${s.n}:${e.n}" ${can ? '' : 'disabled'} aria-label="Select episode">${I.check}</button><span class="n">E${e.n}</span><span class="rq-tx">${esc(e.name || 'Episode ' + e.n)}</span>${e.onServer ? '<span class="rq-badge ok">On the server</span>' : e.requested || s.requested ? '<span class="rq-badge req">Requested</span>' : !e.aired ? `<span class="rq-badge soon">${e.airDate ? esc(new Date(e.airDate + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })) : 'Coming soon'}</span>` : '<span class="t2 rq-miss">Missing</span>'}</div>`;
          }).join('') || '<div class="t2" style="padding:8px 0">No episode list yet.</div>'}</div>` : ''}
        </div>`;
      }).join('')}
      ${specials ? `<button type="button" class="rq-link t2" data-specials>${showSpecials ? 'Hide specials' : `Show specials (${d.seasons.find((s) => s.special)?.total || 0})`}</button>` : ''}
      <div class="rq-bar" ${count() ? '' : 'hidden'}><div class="rq-tx"><b>${count()} selected</b> <span class="t2">· ${esc(partsText().join('; '))}</span></div><button class="btn secondary" data-clear>Clear</button><button class="btn" data-sel>Request</button></div>
      </div></div></div>`;
  };
  const submit = async (parts) => {
    const lines = [];
    if (parts.seasons) parts.seasons.forEach((n) => lines.push(`Season ${n}`));
    for (const [s, eps] of Object.entries(parts.episodes || {})) lines.push(`Season ${s}: episode${eps.length > 1 ? 's' : ''} ${eps.join(', ')}`);
    const someone = d.request ? 'Someone already asked for part of this show. You\'ll be added to that request.' : '';
    const ok = await sheet({ kicker: 'REQUEST A TV SHOW', title: d.title, sub: d.year, poster: d.poster, items: lines, info: someone });
    if (!ok) return;
    if (await send([{ type: 'tv', extId: d.id, parts }], ok.note)) { pick.seasons.clear(); pick.eps.clear(); await load(); draw(); }
  };
  root.onclick = async (e) => {
    const t = e.target;
    const op = t.closest('[data-open]'); if (op) { const n = Number(op.dataset.open); openNow.has(n) ? openNow.delete(n) : openNow.add(n); draw(); return; }
    const sck = t.closest('[data-sck]'); if (sck) { const n = Number(sck.dataset.sck); if (pick.seasons.has(n)) pick.seasons.delete(n); else { pick.seasons.add(n); pick.eps.delete(n); } draw(); return; }
    const eck = t.closest('[data-eck]'); if (eck) { const [s, n] = eck.dataset.eck.split(':').map(Number); if (!pick.eps.has(s)) pick.eps.set(s, new Set()); const set = pick.eps.get(s); set.has(n) ? set.delete(n) : set.add(n); draw(); return; }
    if (t.closest('[data-clear]')) { pick.seasons.clear(); pick.eps.clear(); draw(); return; }
    if (t.closest('[data-specials]')) { showSpecials = !showSpecials; draw(); return; }
    const sm = t.closest('[data-smiss]'); if (sm) { const s = d.seasons.find((x) => x.n === Number(sm.dataset.smiss)); return submit({ episodes: { [s.n]: missingEps(s) } }); }
    if (t.closest('[data-sel]')) {
      const parts = {};
      if (pick.seasons.size) parts.seasons = [...pick.seasons].sort((a, b) => a - b);
      for (const [s, set] of pick.eps) if (set.size) (parts.episodes ||= {})[s] = [...set].sort((a, b) => a - b);
      return submit(parts);
    }
    if (t.closest('[data-missing]')) {
      const parts = {};
      for (const s of d.seasons.filter((x) => !x.special && !x.requested)) {
        if (s.status === 'missing') (parts.seasons ||= []).push(s.n);
        else if (s.status === 'partial' && missingEps(s).length) (parts.episodes ||= {})[s.n] = missingEps(s);
      }
      return submit(parts);
    }
    if (t.closest('[data-follow]')) {
      try {
        await rq(d.following ? 'DELETE' : 'POST', `/api/follows/${enc(d.id)}`);
        d.following = !d.following; draw();
        toast(d.following ? `New seasons of ${d.title} will be requested for you when they're announced.` : `Stopped requesting new seasons of ${d.title}.`);
      } catch (err) { toast(String(err), true); }
    }
  };
  draw();
  window.dispatchEvent(new Event('scrappy:ready'));
}

// Open Requests: one list. People see their own open requests; admins see everyone's, with who asked.
const listScope = () => (me.admin || me.manage ? 'all' : 'mine'); // staff manage requests too
const isOpen = (r) => ['requested', 'progress'].includes(r.status);
async function listPage(root, ctx) {
  const scope = listScope(), admin = scope === 'all';
  let showDone = new URLSearchParams(location.hash.split('?')[1] || '').get('done') === '1';
  root.innerHTML = `<div class="rq-page">${loadingHtml()}</div>`;
  rq('POST', '/api/notices/seen', {}).then(refreshBadge).catch(() => {});
  document.querySelector('.rq-avail')?.remove();
  let data;
  const cutoff = Date.now() - 90 * 864e5;
  const load = async () => { data = await get(`/api/requests?scope=${scope}`); };
  try { await load(); } catch (e) { return fail(root, e); }
  if (!ctx.alive()) return;
  const typeName = { movie: 'Movie', tv: 'TV', album: 'Album', song: 'Song', book: 'Audiobook' };
  const rowHtmlFor = (r) => {
    const sq = ['album', 'song', 'book'].includes(r.type);
    const statusCell = admin
      ? `<select class="rq-sel ${r.status}" data-status="${r.id}">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${l}</option>`).join('')}</select>`
      : `<span class="rq-pill ${r.status}">${STATUS[r.status]}</span>`;
    const act = admin ? '' : isOpen(r) || r.status === 'cantfind'
      ? `<button class="btn sm secondary" data-cancel="${r.id}">${r.status === 'cantfind' ? 'Remove' : 'Cancel'}</button>`
      : r.libRef ? `<a class="btn sm secondary" href="${libHref(r.type, r.libRef)}">Open</a>` : '<span></span>';
    const sub = [typeName[r.type], r.type !== 'movie' ? r.subtitle : (r.year || '')].filter(Boolean).map(esc).join(' · ');
    return `<div class="rq-tr">
      <div class="rq-th ${sq ? 'sq' : ''}" style="--h:${hue(r.title)}">${r.poster ? `<img src="${esc(r.poster)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>
      <div class="rq-tx"><div class="t1">${esc(r.title)}</div>
        <div class="t2">${sub}${r.release && r.status !== 'available' ? ` · <span class="rq-soon">${esc(r.release)}</span>` : ''}${admin ? '' : ` · asked ${day(r.createdAt).toLowerCase().replace(/^(\d)/, 'on $1')}`}</div>
        ${r.notes?.length ? `<div class="t2 rq-unote">${r.notes.map((n) => `${admin ? esc(n.user) + ': ' : 'Your note: '}“${esc(n.note)}”`).join('<br>')}</div>` : ''}
        ${r.adminNote && r.status === 'cantfind' ? `<div class="rq-cant">${admin ? 'Your note: ' : ''}${esc(r.adminNote)}</div>` : ''}
        ${admin && r.status === 'cantfind' ? `<button class="rq-link" data-editnote="${r.id}">${r.adminNote ? 'Change note' : 'Add a note'}</button>` : ''}
      </div>
      ${admin ? `<div class="rq-who">${r.users.map((u) => `<span class="rq-av" style="--h:${hue(u)}">${esc(u.slice(0, 1).toUpperCase())}</span><span>${esc(u)}</span>`).join('')}</div>
        <div class="t2" title="${esc(new Date(r.createdAt).toLocaleString())}">${day(r.createdAt)}</div>` : ''}
      <div class="rq-stat">${statusCell}</div>
      ${admin ? '' : `<div class="rq-act">${act}</div>`}
    </div>`;
  };
  const draw = () => {
    history.replaceState(history.state, '', `#/requests${showDone ? '?done=1' : ''}`);
    const open = data.requests.filter(isOpen);
    const done = data.requests.filter((r) => !isOpen(r) && (r.doneAt || r.updatedAt) > cutoff);
    const people = new Set(open.flatMap((r) => r.users.map((u) => u.toLowerCase()))).size;
    const head = `<div class="rq-tr hd"><span></span><span>REQUEST</span>${admin ? '<span>ASKED BY</span><span>WHEN</span>' : ''}<span>STATUS</span>${admin ? '' : '<span></span>'}</div>`;
    root.innerHTML = `<div class="rq-page">
      <div class="rq-top"><div><div class="kicker">REQUESTS</div><h1 class="disp rq-h1">Open Requests</h1></div><a class="btn" href="#/requests/new">${I.req} Make a request</a></div>
      <div class="t2 rq-count">${open.length ? `${open.length} open request${open.length === 1 ? '' : 's'}${admin ? ` from ${people} ${people === 1 ? 'person' : 'people'}` : ''}` : ''}</div>
      ${!admin && data.follows?.length ? `<div class="rq-follows t2">Watching for new seasons: ${data.follows.map((f) => `<span class="rq-chip">${esc(f.title)}<button data-unfollow="${esc(f.tmdbId)}" aria-label="Stop">${I.x}</button></span>`).join('')}</div>` : ''}
      ${open.length ? `<div class="rq-table ${scope}">${head}${open.map(rowHtmlFor).join('')}</div>`
        : `<div class="empty">${admin ? 'No open requests right now.' : 'You have no open requests.'}<br><br><a class="btn" href="#/requests/new">Make a request</a></div>`}
      ${done.length ? `<div class="rq-more t2">Finished and can't-find requests from the last 90 days: <button class="rq-link" data-done>${showDone ? 'Hide' : `Show ${done.length} finished`}</button></div>
        ${showDone ? `<div class="rq-table ${scope} rq-donelist">${head}${done.map(rowHtmlFor).join('')}</div>` : ''}` : ''}
    </div>`;
  };
  root.onclick = async (e) => {
    const t = e.target;
    if (t.closest('[data-done]')) { showDone = !showDone; draw(); return; }
    const c = t.closest('[data-cancel]');
    if (c) { try { await rq('DELETE', `/api/requests/${c.dataset.cancel}`); toast('Removed from your requests.'); await load(); draw(); refreshBadge(); } catch (err) { toast(String(err), true); } return; }
    const en = t.closest('[data-editnote]');
    if (en) {
      const r = data.requests.find((x) => x.id === Number(en.dataset.editnote));
      const note = await noteDialog(r.title, r.adminNote);
      if (note !== null) { try { await rq('PATCH', `/api/requests/${r.id}`, { note }); await load(); draw(); } catch (err) { toast(String(err), true); } }
      return;
    }
    const uf = t.closest('[data-unfollow]');
    if (uf) { try { await rq('DELETE', `/api/follows/${uf.dataset.unfollow}`); await load(); draw(); } catch (err) { toast(String(err), true); } }
  };
  root.onchange = async (e) => {
    const s = e.target.closest('select[data-status]'); if (!s) return;
    const id = Number(s.dataset.status);
    const r = data.requests.find((x) => x.id === id);
    let body = { status: s.value };
    if (s.value === 'cantfind') {
      const note = await noteDialog(r.title, r.adminNote);
      if (note === null) { s.value = r.status; return; }
      body.note = note;
    }
    try {
      await rq('PATCH', `/api/requests/${id}`, body);
      toast(`${r.title}: ${STATUS[s.value]}.`);
      await load(); draw();
    } catch (err) { toast(String(err), true); }
  };
  draw();
  window.dispatchEvent(new Event('scrappy:ready'));
}

// ---------- Request button, badge, and the "Now available" card ----------
let btn = null;
async function refreshBadge() {
  if (!btn) return;
  try {
    const { notices } = await get('/api/notices');
    const dot = btn.querySelector('.rq-dot');
    dot.textContent = notices.length > 9 ? '9+' : String(notices.length);
    dot.hidden = !notices.length;
    return notices;
  } catch { btn.querySelector('.rq-dot').hidden = true; return []; }
}
function availCard(notices) {
  document.querySelector('.rq-avail')?.remove();
  if (!notices.length) return;
  const verb = { movie: 'Watch', tv: 'Watch', album: 'Listen', song: 'Listen', book: 'Listen' };
  const el = document.createElement('div');
  el.className = 'rq-avail';
  const shown = notices.slice(0, 3);
  const anyFound = shown.some((n) => n.request.status === 'available');
  el.innerHTML = `<div class="kicker">${anyFound ? 'NOW AVAILABLE' : 'REQUEST UPDATE'}</div>
    ${shown.map((n) => { const r = n.request; const ok = r.status === 'available';
      return `<div class="rq-av-r"><div class="rq-th ${['album', 'song', 'book'].includes(r.type) ? 'sq' : ''}" style="--h:${hue(r.title)}">${r.poster ? `<img src="${esc(r.poster)}" alt="" onerror="this.remove()">` : ''}</div>
        <div class="rq-tx"><div class="t1">${esc(r.title)}</div><div class="t2">${ok ? esc(r.subtitle || 'Your request') : `Couldn't find it${r.adminNote ? ': ' + esc(r.adminNote) : ''}`}</div></div>
        ${ok && r.libRef ? `<a class="btn sm" href="${libHref(r.type, r.libRef)}" data-go>${verb[r.type]}</a>` : ''}</div>`; }).join('')}
    ${notices.length > 3 ? `<div class="t2">and ${notices.length - 3} more</div>` : ''}
    <div class="rq-av-f"><a href="#/requests" data-go>Open Requests</a><button type="button" data-dismiss>Dismiss</button></div>`;
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-go]') || e.target.closest('[data-dismiss]')) {
      rq('POST', '/api/notices/seen', { ids: notices.map((n) => n.id) }).then(refreshBadge).catch(() => {});
      el.classList.add('out'); setTimeout(() => el.remove(), 200);
    }
  });
  document.body.appendChild(el);
}

/** Add the Request button to the top bar (next to Refresh, Stats and the cog). Call once signed in. */
export async function mountRequests(session) {
  if (btn || !session?.servers?.emby?.signedIn) return;
  const actions = document.querySelector('#topbar .actions'); if (!actions) return;
  btn = document.createElement('a');
  btn.className = 'icon-btn rq-btn';
  btn.href = '#/requests/new';
  btn.title = 'Requests';
  btn.setAttribute('aria-label', 'Requests');
  btn.innerHTML = `${I.req}<span class="rq-dot" hidden>0</span>`;
  // Right-click goes straight to your list.
  // With news waiting, the button opens your list; otherwise Make a request.
  btn.addEventListener('click', (e) => { e.preventDefault(); location.hash = btn.querySelector('.rq-dot').hidden ? '#/requests/new' : '#/requests'; });
  btn.addEventListener('contextmenu', (e) => { e.preventDefault(); location.hash = '#/requests'; });
  actions.prepend(btn);
  const notices = await refreshBadge();
  if (notices?.length) availCard(notices);
  setInterval(refreshBadge, 10 * 60 * 1000);
}
