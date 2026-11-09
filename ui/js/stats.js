// Stats pages (approved mock "Stats"): one per tab, with This week / This month /
// This year / All time, plus a Me / Everyone switch for admins.
//  - Audiobooks: Audiobookshelf's own listening log (every app that plays through ABS).
//    Everyone: admins can read every user's sessions.
//  - Music: all time from Navidrome's play counts, dated plays from Navidrome's own
//    history (0.59+). Navidrome only shows each person their own plays, so no Everyone.
//  - Movies & TV: Emby's played items. With the Playback Reporting plugin installed it
//    also gets watch time per day and a "when you watch" grid. Everyone needs an Emby
//    admin account plus Playback Reporting.
import { api, img, IMG_BASE } from './api.js';
import { esc } from './components.js';
import { genreLook } from './gtiles.js';

const PERIODS = [['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['all', 'All time']];
const DAY = 86400000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------- small helpers ----------
const n0 = (n) => Math.round(n || 0).toLocaleString();
const plural = (n, w) => `${n0(n)} ${w}${Math.round(n) === 1 ? '' : 's'}`;
/** seconds -> "3h 12m" */
const hm = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };
const dkey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const startOf = (p) => {
  const now = new Date();
  if (p === 'week') { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }
  if (p === 'month') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).getTime();
  if (p === 'year') return new Date(now.getFullYear(), 0, 1).getTime();
  return 0;
};
/** The same length of time just before the period, for the "vs last ..." line. */
const prevRange = (p) => { const s = startOf(p); if (p === 'year') return [new Date(new Date().getFullYear() - 1, 0, 1).getTime(), s]; const len = Date.now() - s; return [s - len, s]; };
const vs = (cur, prev, p) => {
  if (p === 'all' || !prev) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (!isFinite(pct) || pct === 0) return { t: 'Same as last ' + p, c: 'n' };
  return { t: `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs last ${p}`, c: pct > 0 ? 'up' : 'dn' };
};
/** Bars for the chart: per day (week, month), per month (year) or per year (all). `points` = [[time, value]] */
function buckets(points, p, fmt) {
  const out = [];
  const now = new Date();
  if (p === 'week' || p === 'month') {
    const n = p === 'week' ? 7 : 30, s = startOf(p), m = new Map();
    points.forEach(([t, v]) => { if (t >= s) m.set(dkey(t), (m.get(dkey(t)) || 0) + v); });
    for (let i = 0; i < n; i++) {
      const d = new Date(s); d.setDate(d.getDate() + i);
      const lbl = p === 'week' ? WEEKDAYS[d.getDay()].slice(0, 3) : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
      out.push({ v: m.get(dkey(d)) || 0, l: lbl, axis: p === 'week' || i % 5 === 0 ? (p === 'week' ? lbl : String(d.getDate())) : '', future: d > now });
    }
  } else if (p === 'year') {
    const y = now.getFullYear(), m = new Array(12).fill(0);
    points.forEach(([t, v]) => { const d = new Date(t); if (d.getFullYear() === y) m[d.getMonth()] += v; });
    for (let i = 0; i <= now.getMonth(); i++) out.push({ v: m[i], l: `${MONTHS[i]} ${y}`, axis: MONTHS[i] });
  } else {
    const m = new Map(); points.forEach(([t, v]) => { const y = new Date(t).getFullYear(); m.set(y, (m.get(y) || 0) + v); });
    const ys = [...m.keys()].sort(); const first = ys[0] ?? now.getFullYear();
    for (let y = Math.max(first, now.getFullYear() - 9); y <= now.getFullYear(); y++) out.push({ v: m.get(y) || 0, l: String(y), axis: String(y) });
  }
  const max = Math.max(1, ...out.map((b) => b.v));
  return out.map((b) => ({ ...b, h: (b.v / max) * 100, tip: `${b.l} · ${fmt(b.v)}` }));
}
/** Current and best run of days with listening. `days` = Set of 'YYYY-MM-DD'. */
function streaks(days) {
  let cur = 0; const d = new Date();
  if (!days.has(dkey(d))) d.setDate(d.getDate() - 1); // today not started yet doesn't break it
  while (days.has(dkey(d))) { cur++; d.setDate(d.getDate() - 1); }
  let best = 0, run = 0, last = null;
  [...days].sort().forEach((k) => { const t = Date.parse(k + 'T12:00:00'); run = last && t - last < DAY * 1.5 ? run + 1 : 1; best = Math.max(best, run); last = t; });
  return { cur, best };
}
const busiest = (points) => { const w = new Array(7).fill(0), c = new Array(7).fill(0), seen = new Set(); points.forEach(([t, v]) => { const d = new Date(t); w[d.getDay()] += v; const k = dkey(t); if (!seen.has(k)) { seen.add(k); c[d.getDay()]++; } }); const i = w.indexOf(Math.max(...w)); return { day: WEEKDAYS[i], avg: c[i] ? w[i] / c[i] : 0, any: w[i] > 0 }; };
const favHour = (points) => { const h = new Array(24).fill(0); points.forEach(([t, v]) => { h[new Date(t).getHours()] += v; }); let best = 0, bi = 0; for (let i = 0; i < 24; i++) { const s = h[i] + h[(i + 1) % 24]; if (s > best) { best = s; bi = i; } } const f = (x) => (x % 12 || 12) + (x < 12 ? ' am' : ' pm'); return best ? `${f(bi)} – ${f((bi + 2) % 24)}` : ''; };
const gStyle = (g) => { const c = genreLook(g).c; return `background:linear-gradient(90deg,${c[1]},${c[0]})`; };

// ---------- the page ----------
const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>';
const SOURCES = { abs: absModel, music: musicModel, tv: tvModel };
// Buttons along the top of every stats page: jump to any of the three.
const SECS = [
  ['tv', '#/stats', 'Movies & TV', '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>'],
  ['music', '#/music/stats', 'Music', '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'],
  ['abs', '#/audiobooks/stats', 'Audiobooks', '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>'],
];
const secBar = (kind) => `<nav class="stx-secs">${SECS.map(([k, href, t, d]) => `<a href="${href}" class="${k === kind ? 'on' : ''}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>${t}</a>`).join('')}</nav>`;
const TITLES = { abs: 'Your listening', music: 'Your music', tv: 'Your watching' };
const EVERYONE = { abs: "Everyone's listening", tv: "Everyone's watching" };

/** Draws the stats page for 'abs', 'music' or 'tv' into `main`. */
export async function statsPage(main, kind, alive) {
  let per = localStorage.getItem('statsPer:' + kind) || 'month';
  if (!PERIODS.some(([k]) => k === per)) per = 'month';
  main.innerHTML = `<div class="stx${kind === 'tv' ? ' full' : ''}">${secBar(kind)}<div class="stx-h"><h1 class="disp">${TITLES[kind]}</h1><span class="t2" id="stxSub"></span><span class="sp"></span>
    <div class="seg" id="stxWho" hidden title="Only admins see this"><button type="button" data-w="me" class="on">Me</button><button type="button" data-w="all">Everyone</button></div>
    <div class="seg" id="stxSeg">${PERIODS.map(([k, l]) => `<button type="button" data-k="${k}" class="${k === per ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div id="stxBody"><div class="stx-load t2">Adding up your stats…</div></div></div>`;
  const body = main.querySelector('#stxBody');
  const src = SOURCES[kind], raws = {};
  let token = 0, who = 'me';
  const draw = async () => {
    const my = ++token;
    try {
      const w = who;
      if (!raws[w]) { if (w === 'all') body.innerHTML = '<div class="stx-load t2">Adding up everyone\'s stats…</div>'; raws[w] = await (w === 'all' ? src.loadAll() : src.load()); }
      if (!alive() || my !== token) return;
      const m = (w === 'all' ? src.buildAll || src.build : src.build)(raws[w], per);
      main.querySelector('#stxSub').textContent = m.sub || '';
      main.querySelector('.stx-h h1').textContent = w === 'all' ? EVERYONE[kind] : TITLES[kind];
      body.innerHTML = html(m);
    } catch (e) {
      if (!alive()) return;
      body.innerHTML = `<div class="empty">Couldn't load your stats: ${esc(e.message || String(e))}</div>`;
    }
  };
  main.querySelector('#stxSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]'); if (!b || b.dataset.k === per) return;
    per = b.dataset.k; try { localStorage.setItem('statsPer:' + kind, per); } catch {}
    main.querySelectorAll('#stxSeg button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  });
  // Admins can switch to the whole server (Audiobookshelf, and Emby with Playback Reporting).
  // Navidrome only ever shows each person their own plays, so Music has no switch.
  if (src.canAll) src.canAll().then((ok) => {
    if (!ok || !alive()) return;
    const seg = main.querySelector('#stxWho'); seg.hidden = false;
    const set = (w) => { who = w; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.w === w)); };
    if (localStorage.getItem('statsWho:' + kind) === 'all') { set('all'); draw(); }
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-w]'); if (!b || b.dataset.w === who) return;
      set(b.dataset.w); try { localStorage.setItem('statsWho:' + kind, who); } catch {}
      draw();
    });
  }).catch(() => {});
  await draw();
}

function html(m) {
  const card = (c) => `<div class="stx-card${c.hot ? ' hot' : ''}"><div class="k">${esc(c.k)}</div><div class="v disp">${esc(c.v)}<small>${esc(c.u || '')}</small></div>${c.d ? `<div class="d ${c.d.c || 'n'}">${esc(c.d.t)}</div>` : ''}<span class="gl" aria-hidden="true">${c.g || ''}</span></div>`;
  const bars = (b) => `<div class="stx-bars">${b.map((x) => `<div class="b${x.v ? '' : ' z'}${x.future ? ' f' : ''}"><i style="height:${Math.max(x.v ? 3 : 1.5, x.h).toFixed(1)}%"></i><span class="tt">${esc(x.tip)}</span></div>`).join('')}</div><div class="stx-axis">${b.map((x) => `<span>${esc(x.axis)}</span>`).join('')}</div>`;
  const list = (t, meter) => `<ol class="stx-top">${t.items.map((x, i) => `<li>${x.href ? `<a href="${x.href}">` : '<span class="li">'}<span class="rk">${i + 1}</span><span class="cv ${x.shape || ''}" style="--h:${x.hue || 0}">${x.ini ? `<em>${esc(x.ini)}</em>` : ''}${x.img ? `<img loading="lazy" src="${x.img}" alt="" onload="this.classList.add('in')" onerror="this.remove()">` : ''}</span><span class="tx"><b>${esc(x.a)}</b><span>${esc(x.b || '')}</span></span>${meter ? `<span class="meter"><i style="width:${(x.w * 100).toFixed(1)}%"></i></span>` : ''}<span class="val">${esc(x.v)}</span>${x.href ? '</a>' : '</span>'}</li>`).join('')}</ol>`;
  const box = (title, sub, inner, cls = '') => `<section class="stx-box ${cls}"><div class="bh"><b>${esc(title)}</b>${sub ? `<span class="t2">${esc(sub)}</span>` : ''}</div>${inner}</section>`;
  const empty = (t) => `<div class="t2 stx-none">${esc(t)}</div>`;
  return [
    m.chip ? `<div class="stx-chip">${ICON}<span>${esc(m.chip)}</span></div>` : '',
    m.callout ? `<div class="stx-call"><div class="ic">📊</div><div><b>${esc(m.callout.t)}</b><div class="t2">${esc(m.callout.d)}</div></div></div>` : '',
    m.people ? box(m.people.title, m.people.sub, m.people.items.length ? list(m.people, true) : empty('Nobody yet.'), 'stx-ppl') : '',
    `<div class="stx-cards">${m.cards.map(card).join('')}</div>`,
    m.bars ? box(m.bars.title, m.bars.sub, m.bars.list.some((b) => b.v) ? bars(m.bars.list) : empty('Nothing played in this stretch yet.')) : '',
    m.heat ? box('Every day this year', m.heat.sub, `<div class="stx-heat">${m.heat.cells.map((c) => `<i class="l${c.l}" title="${esc(c.t)}"></i>`).join('')}</div><div class="stx-hleg">Less <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> More</div>`) : '',
    m.wk ? box(m.wk.title || 'When you watch', m.wk.sub, `<div class="stx-wk"><span></span>${Array.from({ length: 24 }, (_, h) => `<span class="hl">${h % 3 ? '' : (h % 12 || 12) + (h < 12 ? 'a' : 'p')}</span>`).join('')}${m.wk.rows.map((r) => `<span class="dl">${r.d}</span>${r.c.map((v) => `<i style="${v > 0.04 ? `background:rgba(236,40,46,${(0.15 + v * 0.85).toFixed(2)})` : ''}"></i>`).join('')}`).join('')}</div>`) : '',
    `<div class="stx-g2">${box(m.top.title, m.top.by, m.top.items.length ? list(m.top, true) : empty(m.top.none || 'Nothing yet.'))}${box(m.top2.title, '', m.top2.items.length ? list(m.top2, false) : empty(m.top2.none || 'Nothing yet.'))}</div>`,
    m.genres === null ? `${box('Fun facts', '', `<div class="stx-fun wide">${m.facts.filter((f) => f.v).map((f) => `<div><span>${esc(f.k)}</span><b>${esc(f.v)}</b><span>${esc(f.s || '')}</span></div>`).join('') || empty('Nothing yet.')}</div>`)}` : `<div class="stx-g2">${box('Top genres', m.genres.sub, m.genres.items.length ? `<div class="stx-gen">${m.genres.items.map((g) => `<div class="gr"><span class="nm">${esc(g.n)}</span><div class="tr"><i style="width:${Math.max(14, g.w * 100).toFixed(1)}%;${gStyle(g.n)}">${esc(g.v)}</i></div></div>`).join('')}</div>` : empty('No genres to show yet.'))}${box('Fun facts', '', `<div class="stx-fun">${m.facts.filter((f) => f.v).map((f) => `<div><span>${esc(f.k)}</span><b>${esc(f.v)}</b><span>${esc(f.s || '')}</span></div>`).join('') || empty('Play a bit more and these fill in.')}</div>`)}</div>`,
    m.shelf ? box(m.shelf.title, m.shelf.sub, m.shelf.items.length ? `<div class="row stx-shelf">${m.shelf.items.map((x) => `<a class="stx-mini${x.wide ? ' wide' : ''}" href="${x.href || '#'}"><span class="art" style="--h:${x.hue || 0}"><b>${esc(x.t)}</b>${x.img ? `<img loading="lazy" src="${x.img}" alt="" onload="this.classList.add('in')" onerror="this.remove()">` : ''}</span><span class="m">${esc(x.m || '')}</span></a>`).join('')}</div>` : empty(m.shelf.none || 'Nothing yet.')) : '',
  ].join('');
}
const hue = (s) => [...String(s || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
/** "Top listeners" list: rows = [{ u: name, t: time, what: title }] already in the period. */
function people(rows, title, sub, fmt) {
  const by = new Map();
  rows.forEach((r) => { const o = by.get(r.u) || { n: r.u, t: 0, w: new Map() }; o.t += r.t; if (r.what) o.w.set(r.what, (o.w.get(r.what) || 0) + r.t); by.set(r.u, o); });
  const l = [...by.values()].sort((a, b) => b.t - a.t);
  return { title, sub, items: l.map((o) => ({ a: o.n, b: [...o.w.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '', shape: 'rd', ini: (o.n[0] || '?').toUpperCase(), hue: hue(o.n), w: o.t / (l[0]?.t || 1), v: fmt(o.t) })) };
}
const perWord = (p) => ({ week: 'this week', month: 'in the last 30 days', year: 'this year', all: 'all time' }[p]);
const chartSub = (p) => ({ week: 'per day this week', month: 'per day, last 30 days', year: 'per month this year', all: 'per year' }[p]);

// ---------- Audiobooks (Audiobookshelf) ----------
const absImg = (id, w = 120) => (id ? `${IMG_BASE}/abs/${encodeURIComponent(id)}?w=${w}&u=` : '');
async function absModel_load() {
  const [stats, me] = await Promise.all([api.abs('/api/me/listening-stats'), api.abs('/api/me').catch(() => ({}))]);
  // Sessions carry the time of day, author and genres. Newest first; stop after ~3000.
  const sessions = [];
  for (let page = 0; page < 6; page++) {
    let r; try { r = await api.abs(`/api/me/listening-sessions?itemsPerPage=500&page=${page}`); } catch { break; }
    sessions.push(...(r.sessions || []));
    if (!r.sessions?.length || page + 1 >= (r.numPages || 1)) break;
  }
  return { stats, me, sessions };
}
function absModel_build({ stats, me, sessions }, p) {
  const s0 = startOf(p), [ps, pe] = prevRange(p);
  const days = Object.entries(stats.days || {}).map(([k, v]) => [Date.parse(k + 'T12:00:00'), v]);
  const inP = days.filter(([t]) => t >= s0), prev = days.filter(([t]) => t >= ps && t < pe);
  const total = p === 'all' ? (stats.totalTime || inP.reduce((a, [, v]) => a + v, 0)) : inP.reduce((a, [, v]) => a + v, 0);
  const prevTotal = prev.reduce((a, [, v]) => a + v, 0);
  const daySet = new Set(Object.keys(stats.days || {}).filter((k) => (stats.days[k] || 0) > 0));
  const st = streaks(daySet);
  const nDays = p === 'all' ? Math.max(1, daySet.size) : Math.max(1, Math.ceil((Date.now() - s0) / DAY));
  const avg = total / nDays, prevAvg = prevTotal / Math.max(1, Math.ceil((pe - ps) / DAY));
  const prog = (me.mediaProgress || []).filter((x) => !x.episodeId && x.isFinished);
  const fin = prog.filter((x) => (x.finishedAt || x.lastUpdate || 0) >= s0).sort((a, b) => (b.finishedAt || b.lastUpdate || 0) - (a.finishedAt || a.lastUpdate || 0));
  const finPrev = prog.filter((x) => { const t = x.finishedAt || x.lastUpdate || 0; return t >= ps && t < pe; }).length;
  // Per book / author / genre from sessions in the period (all time: the server's own per-book totals).
  const ses = sessions.filter((x) => (x.updatedAt || x.startedAt || 0) >= s0);
  const books = new Map(), authors = new Map(), genres = new Map();
  ses.forEach((x) => {
    const t = x.timeListening || 0; if (!t) return;
    const b = books.get(x.libraryItemId) || { id: x.libraryItemId, title: x.displayTitle || x.mediaMetadata?.title || '', author: x.displayAuthor || x.mediaMetadata?.authorName || '', t: 0 };
    b.t += t; books.set(x.libraryItemId, b);
    String(b.author || '').split(/,\s*|\s+&\s+/).filter(Boolean).forEach((a) => { const o = authors.get(a) || { n: a, t: 0, b: new Set() }; o.t += t; o.b.add(x.libraryItemId); authors.set(a, o); });
    (x.mediaMetadata?.genres || []).forEach((g) => genres.set(g, (genres.get(g) || 0) + t));
  });
  if (p === 'all' && stats.items) Object.values(stats.items).forEach((it) => { const b = books.get(it.id); if (b) b.t = Math.max(b.t, it.timeListening || 0); else books.set(it.id, { id: it.id, title: it.mediaMetadata?.title || '', author: it.mediaMetadata?.authorName || '', t: it.timeListening || 0 }); });
  const topB = [...books.values()].sort((a, b) => b.t - a.t).slice(0, 6);
  const topA = [...authors.values()].sort((a, b) => b.t - a.t).slice(0, 6);
  const gTot = [...genres.values()].reduce((a, b) => a + b, 0) || 1;
  const topG = [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const pts = ses.map((x) => [x.startedAt || x.updatedAt, x.timeListening || 0]);
  const longest = ses.reduce((a, x) => ((x.timeListening || 0) > (a?.timeListening || 0) ? x : a), null);
  const bz = busiest(days.filter(([t]) => t >= s0));
  // Year heat map: Mondays down the side, weeks across.
  const y = new Date().getFullYear(), jan1 = new Date(y, 0, 1), pad = (jan1.getDay() + 6) % 7;
  const vals = Object.entries(stats.days || {}).filter(([k]) => k.startsWith(String(y))).map(([, v]) => v).filter(Boolean).sort((a, b) => a - b);
  const q = (f) => vals[Math.floor(f * (vals.length - 1))] || 0;
  const cells = Array.from({ length: pad }, () => ({ l: 'x', t: '' }));
  for (let d = new Date(jan1); d <= new Date(); d.setDate(d.getDate() + 1)) { const v = stats.days?.[dkey(d)] || 0; cells.push({ l: !v ? 0 : v <= q(0.25) ? 1 : v <= q(0.5) ? 2 : v <= q(0.8) ? 3 : 4, t: `${MONTHS[d.getMonth()]} ${d.getDate()}: ${v ? hm(v) : 'nothing'}` }); }
  return {
    sub: 'From Audiobookshelf',
    cards: [
      { hot: true, k: 'TIME LISTENED', v: hm(total).replace(/(\d+)h (\d+)m/, '$1h $2m'), d: vs(total, prevTotal, p), g: '🎧' },
      { k: 'BOOKS FINISHED', v: n0(fin.length), d: vs(fin.length, finPrev, p) || { t: p === 'all' ? 'in your library' : '', c: 'n' }, g: '✔' },
      { k: 'DAY STREAK', v: n0(st.cur), u: st.cur === 1 ? ' day' : ' days', d: { t: `Best: ${plural(st.best, 'day')}`, c: 'n' }, g: '🔥' },
      { k: 'AVERAGE A DAY', v: hm(avg), d: vs(avg, prevAvg, p), g: '⏱' },
    ],
    bars: { title: 'Listening time', sub: chartSub(p), list: buckets(days, p, hm) },
    heat: { sub: `Darker red means more listening · longest streak ${plural(st.best, 'day')}`, cells },
    top: { title: 'Most listened books', by: 'by time', none: `No listening ${perWord(p)}.`, items: topB.map((b) => ({ a: b.title, b: b.author, img: absImg(b.id), hue: hue(b.title), w: b.t / (topB[0]?.t || 1), v: hm(b.t), href: `#/audiobooks/book/${encodeURIComponent(b.id)}` })) },
    top2: { title: 'Top authors', items: topA.map((a) => ({ a: a.n, b: plural(a.b.size, 'book'), shape: 'rd', hue: hue(a.n), v: hm(a.t) })) },
    genres: { sub: 'share of your listening', items: topG.map(([g, t]) => ({ n: g, w: t / (topG[0][1] || 1), v: Math.round((t / gTot) * 100) + '%' })) },
    facts: [
      { k: 'Favourite time', v: favHour(pts), s: 'when you listen most' },
      { k: 'Busiest day', v: bz.any ? bz.day : '', s: bz.any ? `${hm(bz.avg)} on average` : '' },
      { k: 'Longest session', v: longest ? hm(longest.timeListening) : '', s: longest ? `${longest.displayTitle || ''}, ${new Date(longest.startedAt || longest.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '' },
      { k: 'Listening sessions', v: ses.length ? n0(ses.length) : '', s: ses.length ? `about ${hm(ses.reduce((a, x) => a + (x.timeListening || 0), 0) / ses.length)} each` : '' },
    ],
    shelf: { title: 'Finished ' + perWord(p), sub: 'newest first', none: `No books finished ${perWord(p)}.`, items: fin.slice(0, 20).map((x) => ({ t: '', img: absImg(x.libraryItemId, 200), hue: hue(x.libraryItemId), m: x.finishedAt ? new Date(x.finishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '', href: `#/audiobooks/book/${encodeURIComponent(x.libraryItemId)}` })) },
  };
}
// Everyone (admins): every user's sessions, added up the same way as one person's.
async function absModel_canAll() { const me = await api.abs('/api/me'); return me?.type === 'admin' || me?.type === 'root'; }
async function absModel_loadAll() {
  const sessions = [];
  for (let page = 0; page < 20; page++) {
    let r; try { r = await api.abs(`/api/sessions?itemsPerPage=500&page=${page}&sort=updatedAt&desc=1`); } catch { break; }
    sessions.push(...(r.sessions || []));
    if (!r.sessions?.length || page + 1 >= (r.numPages || 1)) break;
  }
  const days = {}; let totalTime = 0;
  sessions.forEach((x) => { const t = x.timeListening || 0; const k = x.date || dkey(x.startedAt || x.updatedAt); days[k] = (days[k] || 0) + t; totalTime += t; });
  // Finished books for every user.
  const users = (await api.abs('/api/users').catch(() => ({}))).users || [];
  const full = await Promise.all(users.map((u) => api.abs(`/api/users/${encodeURIComponent(u.id)}`).catch(() => null)));
  const mediaProgress = [];
  full.forEach((u) => (u?.mediaProgress || []).forEach((m) => { mediaProgress.push(m); }));
  mediaProgress.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  return { stats: { days, totalTime }, me: { mediaProgress }, sessions };
}
function absModel_buildAll(raw, p) {
  const m = absModel_build(raw, p), s0 = startOf(p);
  // The finished shelf shows each book once even if several people finished it.
  const ids = new Set(); m.shelf.items = m.shelf.items.filter((x) => (ids.has(x.href) ? false : ids.add(x.href)));
  m.sub = 'From Audiobookshelf, everyone on the server';
  m.cards[2] = { ...m.cards[2], k: 'SERVER STREAK' };
  m.people = people(raw.sessions.filter((x) => (x.updatedAt || x.startedAt || 0) >= s0 && x.user).map((x) => ({ u: x.user.username, t: x.timeListening || 0, what: x.displayTitle || '' })), 'Top listeners', 'everyone on the server, ' + (p === 'all' ? 'all time' : perWord(p)), hm);
  return m;
}
function absModel() {}
absModel.load = absModel_load; absModel.build = absModel_build;
absModel.canAll = absModel_canAll; absModel.loadAll = absModel_loadAll; absModel.buildAll = absModel_buildAll;

// ---------- Music (Navidrome + Scrappy's own play log) ----------
const ndImg = (id, w = 120) => (id ? `${IMG_BASE}/nd/${encodeURIComponent(id)}?w=${w}` : '');
const { invoke } = window.__TAURI__.core;
// Navidrome (0.59+) keeps a dated history of every play, from every app, for each user.
// We keep a copy on disk and only ask for plays newer than the last one we have.
async function ndHistory() {
  const me = (await api.session())?.servers?.navidrome?.user || '';
  let c = null; try { c = JSON.parse(localStorage.getItem('ndHist') || 'null'); } catch {}
  if (!c || c.u !== me) c = { u: me, l: [] };
  const newest = c.l.length ? c.l[c.l.length - 1][0] : 0;
  const fresh = [];
  for (let start = 0; start < 500000; start += 5000) {
    const q = `/api/scrobble?_sort=submission_time&_order=ASC&_start=${start}&_end=${start + 5000}${newest ? `&from=${newest + 1}` : ''}`;
    const r = await invoke('nd_native_get', { path: q });
    const rows = Array.isArray(r?.data) ? r.data : [];
    rows.forEach((x) => fresh.push([x.submissionTime, x.mediaFileId]));
    if (rows.length < 5000) break;
  }
  c.l = c.l.concat(fresh);
  try { localStorage.setItem('ndHist', JSON.stringify(c)); } catch {}
  return c.l;
}
async function musicModel_load() {
  const m = await import('./music.js');
  const songs = await m.allSongs();
  let hist = [], histErr = '';
  try { hist = await ndHistory(); }
  catch (e) {
    const err = String(e);
    if (err === 'ND_NATIVE_EXPIRED') {
      // Navidrome's web session ran out: ask for the password once, then try again.
      try { const { withNdSession } = await import('./music2.js'); hist = await withNdSession(ndHistory, 'Your weekly, monthly and yearly music stats use Navidrome\'s own sign-in. Scrappy doesn\'t keep your password.'); }
      catch { histErr = 'expired'; }
    } else histErr = err === 'ND_TOO_OLD' ? 'old' : err;
  }
  const by = new Map(songs.map((s) => [s.id, s]));
  const log = hist.map(([t, id]) => { const s = by.get(id); return s ? { t: t * 1000, id, ti: s.title, ar: s.artist, arId: s.artistId, al: s.album, alId: s.albumId, cv: s.coverArt, d: s.duration || 0, g: s.genre || '' } : { t: t * 1000, id, ti: 'Removed song', ar: '', al: '', alId: '', d: 0, g: '' }; });
  return { songs, log, histErr };
}
function musicModel_build({ songs, log, histErr }, p) {
  const all = p === 'all';
  const s0 = startOf(p), [ps, pe] = prevRange(p);
  // One list of "plays" either way: Navidrome's lifetime counts, or dated plays from the log.
  let plays;
  if (all) plays = songs.filter((s) => s.playCount > 0).map((s) => ({ n: s.playCount, id: s.id, ti: s.title, ar: s.artist, arId: s.artistId, al: s.album, alId: s.albumId, cv: s.coverArt, d: s.duration || 0, g: s.genre || '' }));
  else { const m = new Map(); log.filter((x) => x.t >= s0 && x.alId).forEach((x) => { const o = m.get(x.id) || { ...x, n: 0 }; o.n++; m.set(x.id, o); }); plays = [...m.values()]; }
  const count = plays.reduce((a, x) => a + x.n, 0);
  const secs = plays.reduce((a, x) => a + x.n * x.d, 0);
  const prevCount = all ? 0 : log.filter((x) => x.t >= ps && x.t < pe).length;
  const sum = (key, extra) => { const m = new Map(); plays.forEach((x) => { const k = x[key]; if (!k) return; const o = m.get(k) || { k, n: 0, ...extra(x) }; o.n += x.n; m.set(k, o); }); return [...m.values()].sort((a, b) => b.n - a.n); };
  const artists = sum('ar', (x) => ({ id: x.arId, cv: x.cv }));
  const albums = sum('alId', (x) => ({ name: x.al, ar: x.ar, cv: x.cv }));
  const top = plays.slice().sort((a, b) => b.n - a.n);
  const gen = sum('g', () => ({}));
  const gTot = gen.reduce((a, g) => a + g.n, 0) || 1;
  const pts = all ? [] : log.map((x) => [x.t, x.d]);
  const firstLog = log[0]?.t;
  const day = new Map(); if (!all) log.filter((x) => x.t >= s0).forEach((x) => { const k = dkey(x.t) + '|' + x.id; day.set(k, (day.get(k) || 0) + 1); });
  const rep = [...day.entries()].sort((a, b) => b[1] - a[1])[0];
  const repSong = rep && log.find((x) => x.id === rep[0].split('|')[1]);
  const fav = songs.filter((s) => s.starred).length, never = songs.filter((s) => !s.playCount).length;
  return {
    sub: 'From Navidrome, plays from every app',
    chip: all || !histErr ? '' : histErr === 'old' ? 'Week, month and year need Navidrome 0.59 or newer, which keeps a dated play history. Update Navidrome and these fill in from then on.' : histErr === 'expired' ? "Couldn't read your play history because Navidrome's sign-in ran out. Open this page again to sign in." : `Couldn't read your play history from Navidrome (${histErr}).`,
    cards: [
      { hot: true, k: 'PLAYS', v: n0(count), d: all ? { t: 'from every app', c: 'n' } : vs(count, prevCount, p), g: '▶' },
      { k: 'LISTENING TIME', v: n0(secs / 3600), u: ' hours', d: { t: secs < 86400 ? `${n0(secs / 60)} minutes in all` : `about ${plural(secs / 86400, 'day')}`, c: 'n' }, g: '⏱' },
      { k: 'ARTISTS', v: n0(artists.length), d: { t: all ? 'played at least once' : 'played ' + perWord(p), c: 'n' }, g: '🎤' },
      { k: 'SONGS', v: n0(plays.length), d: { t: all ? `of ${n0(songs.length)} in your library` : 'different songs', c: 'n' }, g: '♪' },
    ],
    bars: all ? null : { title: 'Listening time', sub: chartSub(p), list: buckets(pts, p, hm) },
    top: { title: 'Top artists', by: 'by plays', none: `Nothing played ${perWord(p)}.`, items: artists.slice(0, 6).map((a) => ({ a: a.k, b: '', shape: 'rd', img: a.id ? ndImg(a.id) : ndImg(a.cv), hue: hue(a.k), w: a.n / (artists[0]?.n || 1), v: plural(a.n, 'play'), href: a.id ? `#/music/artist/${encodeURIComponent(a.id)}` : '' })) },
    top2: { title: 'Top songs', items: top.slice(0, 6).map((s) => ({ a: s.ti, b: s.ar, img: ndImg(s.cv), hue: hue(s.ti), v: plural(s.n, 'play'), href: s.alId ? `#/music/album/${encodeURIComponent(s.alId)}?song=${encodeURIComponent(s.id)}` : '' })) },
    genres: { sub: 'share of your plays', items: gen.slice(0, 6).map((g) => ({ n: g.k, w: g.n / (gen[0]?.n || 1), v: Math.round((g.n / gTot) * 100) + '%' })) },
    facts: [
      { k: 'Most played album', v: albums[0]?.name || '', s: albums[0] ? plural(albums[0].n, 'play') : '' },
      { k: 'On repeat', v: repSong?.ti || '', s: rep ? `${plural(rep[1], 'play')} in one day, ${new Date(rep[0].split('|')[0] + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '' },
      { k: 'Favourites', v: fav ? plural(fav, 'song') : '', s: 'hearted songs' },
      { k: 'Never played', v: never ? plural(never, 'song') : '', s: 'try "is:unplayed" in search' },
    ],
    shelf: { title: 'Top albums', sub: (all ? 'all time' : perWord(p)) + ', by plays', none: 'No albums played yet.', items: albums.slice(0, 20).map((a) => ({ t: a.name, img: ndImg(a.cv, 200), hue: hue(a.name), m: plural(a.n, 'play'), href: `#/music/album/${encodeURIComponent(a.k)}` })) },
  };
}
function musicModel() {}
musicModel.load = musicModel_load; musicModel.build = musicModel_build;

// ---------- Movies & TV (Emby, plus Playback Reporting when installed) ----------
const embyImg = (it, w = 160) => img(it.Id, 'Primary', it.ImageTags?.Primary, w);
async function tvModel_load() {
  const q = (types, extra = '') => api.get(`/Users/{userId}/Items?Recursive=true&IncludeItemTypes=${types}&Fields=Genres,UserData,RunTimeTicks,SeriesId,SeriesName,ImageTags,ParentIndexNumber,IndexNumber${extra}`);
  const [eps, movies, series, favs, resume] = await Promise.all([
    q('Episode', '&Filters=IsPlayed&SortBy=DatePlayed&SortOrder=Descending&Limit=8000'),
    q('Movie', '&Filters=IsPlayed&SortBy=DatePlayed&SortOrder=Descending&Limit=3000'),
    q('Series', '&Limit=3000'),
    api.get('/Users/{userId}/Items?Recursive=true&Filters=IsFavorite&IncludeItemTypes=Movie,Series,Episode&Limit=0').catch(() => ({})),
    api.get('/Users/{userId}/Items/Resume?Limit=50&MediaTypes=Video').catch(() => ({})),
  ]);
  // Playback Reporting plugin: real watch sessions with dates and durations.
  let pr = null;
  try {
    const r = await api.post('/user_usage_stats/submit_custom_query', { CustomQueryString: "SELECT DateCreated, PlayDuration, ItemType, ItemName, ItemId FROM PlaybackActivity WHERE UserId = '{userId}' ORDER BY DateCreated DESC LIMIT 50000", ReplaceUserId: false });
    const cols = (r?.colums || r?.columns || []).map((c) => String(c).toLowerCase());
    if (Array.isArray(r?.results)) {
      const ix = (n) => cols.indexOf(n.toLowerCase());
      pr = r.results.map((x) => ({ t: Date.parse(String(x[ix('DateCreated')]).replace(' ', 'T')), d: Number(x[ix('PlayDuration')]) || 0, type: x[ix('ItemType')], name: x[ix('ItemName')] })).filter((x) => x.t);
    }
  } catch {}
  return { eps: eps.Items || [], movies: movies.Items || [], series: series.Items || [], favCount: favs.TotalRecordCount || 0, resume: resume.Items || [], pr };
}
function tvModel_build({ eps, movies, series, favCount, resume, pr }, p) {
  const s0 = startOf(p), [ps, pe] = prevRange(p);
  const when = (it) => Date.parse(it.UserData?.LastPlayedDate || '') || 0;
  const epsP = eps.filter((e) => when(e) >= s0), movP = movies.filter((m) => when(m) >= s0);
  const epsPrev = eps.filter((e) => { const t = when(e); return t >= ps && t < pe; }).length;
  const byId = new Map(series.map((s) => [s.Id, s]));
  const shows = new Map();
  epsP.forEach((e) => { const k = e.SeriesId || e.SeriesName; const o = shows.get(k) || { id: e.SeriesId, name: e.SeriesName || '', n: 0, secs: 0, last: 0 }; o.n++; o.secs += (e.RunTimeTicks || 0) / 1e7; o.last = Math.max(o.last, when(e)); shows.set(k, o); });
  const finished = series.filter((s) => s.UserData?.Played && when(s) >= s0);
  const gen = new Map(); const addG = (gs, w) => (gs || []).forEach((g) => gen.set(g, (gen.get(g) || 0) + w));
  epsP.forEach((e) => addG(byId.get(e.SeriesId)?.Genres || e.Genres, (e.RunTimeTicks || 0) / 1e7));
  movP.forEach((m) => addG(m.Genres, (m.RunTimeTicks || 0) / 1e7));
  const gList = [...gen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6), gTot = [...gen.values()].reduce((a, b) => a + b, 0) || 1;
  const binge = new Map(); epsP.forEach((e) => { const k = dkey(when(e)) + '|' + (e.SeriesName || ''); binge.set(k, (binge.get(k) || 0) + 1); });
  const bg = [...binge.entries()].sort((a, b) => b[1] - a[1])[0];
  const rew = [...eps, ...movies].filter((x) => (x.UserData?.PlayCount || 0) > 1).sort((a, b) => b.UserData.PlayCount - a.UserData.PlayCount)[0];
  const top = [...shows.values()].sort((a, b) => (pr ? b.secs - a.secs : b.n - a.n)).slice(0, 6);
  // Playback Reporting numbers when available
  let watch = null, prev = 0, bars = null, wk = null;
  if (pr) {
    const inP = pr.filter((x) => x.t >= s0);
    watch = inP.reduce((a, x) => a + x.d, 0); prev = pr.filter((x) => x.t >= ps && x.t < pe).reduce((a, x) => a + x.d, 0);
    bars = { title: 'Watch time', sub: chartSub(p), list: buckets(pr.map((x) => [x.t, x.d]), p, hm) };
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    inP.forEach((x) => { const d = new Date(x.t); grid[(d.getDay() + 6) % 7][d.getHours()] += x.d; });
    const mx = Math.max(1, ...grid.flat());
    let bd = 0, bh = 0; grid.forEach((r, di) => r.forEach((v, h) => { if (v > grid[bd][bh]) { bd = di; bh = h; } }));
    const f = (x) => (x % 12 || 12) + (x < 12 ? ' am' : ' pm');
    wk = { sub: grid[bd][bh] ? `Busiest: ${WEEKDAYS[(bd + 1) % 7]}s around ${f(bh)}` : '', rows: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => ({ d, c: grid[i].map((v) => v / mx) })) };
  }
  const days = p === 'all' ? Math.max(1, new Set(pr ? pr.map((x) => dkey(x.t)) : []).size) : Math.max(1, Math.ceil((Date.now() - s0) / DAY));
  return {
    sub: pr ? 'From Emby + Playback Reporting' : 'From Emby',
    callout: pr ? null : { t: 'Want charts of when you watch?', d: 'Emby only keeps play counts on its own. Install the free Playback Reporting plugin (Emby dashboard › Plugins › Catalog) and this page adds watch time per day, your busiest days and hours, and time per show. If it\'s installed and this still shows, your Emby account may need permission to read its reports.' },
    cards: [
      pr ? { hot: true, k: 'TIME WATCHED', v: hm(watch), d: vs(watch, prev, p), g: '📺' } : { hot: true, k: 'EPISODES WATCHED', v: n0(epsP.length), d: vs(epsP.length, epsPrev, p) || { t: `across ${plural(shows.size, 'show')}`, c: 'n' }, g: '📺' },
      { k: 'MOVIES', v: n0(movP.length), d: { t: 'finished', c: 'n' }, g: '🎬' },
      { k: 'SHOWS FINISHED', v: n0(finished.length), d: { t: finished[0] ? 'Latest: ' + finished.sort((a, b) => when(b) - when(a))[0].Name : '', c: 'n' }, g: '✔' },
      pr ? { k: 'AVERAGE A DAY', v: hm(watch / days), d: null, g: '⏱' } : { k: 'IN PROGRESS', v: n0(resume.length), u: resume.length === 1 ? ' title' : ' titles', d: { t: 'see Continue watching', c: 'n' }, g: '⏱' },
    ],
    bars, wk,
    top: { title: 'Top shows', by: pr ? 'by time' : 'by episodes', none: `No episodes watched ${perWord(p)}.`, items: top.map((s) => { const it = byId.get(s.id); return { a: s.name, b: plural(s.n, 'episode'), shape: 'ps', img: it ? img(it.Id, 'Thumb', it.ImageTags?.Thumb, 200) || embyImg(it, 200) : '', hue: hue(s.name), w: (pr ? s.secs / (top[0]?.secs || 1) : s.n / (top[0]?.n || 1)), v: pr ? hm(s.secs) : plural(s.n, 'ep'), href: s.id ? `#/item/${encodeURIComponent(s.id)}` : '' }; }) },
    top2: { title: 'Recently finished movies', none: `No movies ${perWord(p)}.`, items: movP.slice(0, 6).map((m) => ({ a: m.Name, b: [(m.Genres || [])[0], m.RunTimeTicks ? hm(m.RunTimeTicks / 1e7) : ''].filter(Boolean).join(' · '), shape: 'po', img: embyImg(m, 120), hue: hue(m.Name), v: new Date(when(m)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), href: `#/item/${encodeURIComponent(m.Id)}` })) },
    genres: { sub: 'share of what you watched', items: gList.map(([g, t]) => ({ n: g, w: t / (gList[0][1] || 1), v: Math.round((t / gTot) * 100) + '%' })) },
    facts: [
      { k: 'Biggest binge', v: bg && bg[1] > 1 ? plural(bg[1], 'episode') : '', s: bg ? `${bg[0].split('|')[1]}, ${new Date(bg[0].split('|')[0] + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '' },
      { k: 'Rewatched most', v: rew ? (rew.SeriesName ? `${rew.SeriesName}` : rew.Name) : '', s: rew ? `${rew.SeriesName ? rew.Name + ', ' : ''}played ${rew.UserData.PlayCount} times` : '' },
      { k: 'Favorites', v: favCount ? plural(favCount, 'title') : '', s: 'in Emby' },
      { k: 'Time in episodes', v: epsP.length ? hm(epsP.reduce((a, e) => a + (e.RunTimeTicks || 0) / 1e7, 0)) : '', s: perWord(p) },
    ],
    shelf: { title: 'Recently watched', sub: 'shows and movies', none: `Nothing watched ${perWord(p)}.`, items: [...[...shows.values()].map((s) => ({ last: s.last, it: byId.get(s.id), t: s.name, m: plural(s.n, 'episode') })), ...movP.map((m) => ({ last: when(m), it: m, t: m.Name, m: 'Movie' }))].sort((a, b) => b.last - a.last).slice(0, 20).map((x) => ({ wide: true, t: x.t, m: x.m, hue: hue(x.t), img: x.it ? img(x.it.Id, 'Thumb', x.it.ImageTags?.Thumb, 300) || img(x.it.Id, 'Backdrop', x.it.BackdropImageTags?.[0], 300) || embyImg(x.it, 300) : '', href: x.it ? `#/item/${encodeURIComponent(x.it.Id)}` : '' })) },
  };
}
// Everyone (admins): Playback Reporting records every user, so this view is built only from it.
async function prQuery(sql) {
  const r = await api.post('/user_usage_stats/submit_custom_query', { CustomQueryString: sql, ReplaceUserId: false });
  const cols = (r?.colums || r?.columns || []).map((c) => String(c).toLowerCase());
  if (!Array.isArray(r?.results)) throw new Error('no reports');
  return r.results.map((x) => Object.fromEntries(cols.map((c, i) => [c, x[i]])));
}
async function tvModel_canAll() {
  const me = await api.get('/Users/{userId}');
  if (!me?.Policy?.IsAdministrator) return false;
  await prQuery('SELECT DateCreated FROM PlaybackActivity LIMIT 1');
  return true;
}
async function tvModel_loadAll() {
  const [rows, users] = await Promise.all([
    prQuery('SELECT DateCreated, UserId, PlayDuration, ItemType, ItemName FROM PlaybackActivity ORDER BY DateCreated DESC LIMIT 100000'),
    api.get('/Users').catch(() => []),
  ]);
  const names = new Map((Array.isArray(users) ? users : users?.Items || []).map((u) => [String(u.Id).replace(/-/g, '').toLowerCase(), u.Name]));
  return rows.map((x) => ({ t: Date.parse(String(x.datecreated).replace(' ', 'T')), d: Number(x.playduration) || 0, type: x.itemtype, name: String(x.itemname || ''), u: names.get(String(x.userid).replace(/-/g, '').toLowerCase()) || 'Someone' })).filter((x) => x.t);
}
function tvModel_buildAll(pr, p) {
  const s0 = startOf(p), [ps, pe] = prevRange(p);
  const inP = pr.filter((x) => x.t >= s0);
  const watch = inP.reduce((a, x) => a + x.d, 0), prev = pr.filter((x) => x.t >= ps && x.t < pe).reduce((a, x) => a + x.d, 0);
  // Playback Reporting names episodes "Show - s01e02 - Title".
  const show = (x) => (x.type === 'Episode' ? x.name.split(' - ')[0] : x.name);
  const group = (l) => { const m = new Map(); l.forEach((x) => { const k = show(x); const o = m.get(k) || { n: k, t: 0, c: 0 }; o.t += x.d; o.c++; m.set(k, o); }); return [...m.values()].sort((a, b) => b.t - a.t); };
  const shows = group(inP.filter((x) => x.type === 'Episode')), movies = group(inP.filter((x) => x.type === 'Movie'));
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  inP.forEach((x) => { const d = new Date(x.t); grid[(d.getDay() + 6) % 7][d.getHours()] += x.d; });
  const mx = Math.max(1, ...grid.flat());
  let bd = 0, bh = 0; grid.forEach((r, di) => r.forEach((v, h) => { if (v > grid[bd][bh]) { bd = di; bh = h; } }));
  const f = (x) => (x % 12 || 12) + (x < 12 ? ' am' : ' pm');
  const days = p === 'all' ? Math.max(1, new Set(pr.map((x) => dkey(x.t))).size) : Math.max(1, Math.ceil((Date.now() - s0) / DAY));
  const ppl = new Set(inP.map((x) => x.u));
  const bz = busiest(inP.map((x) => [x.t, x.d]));
  const dayTot = new Map(); inP.forEach((x) => { const k = dkey(x.t); dayTot.set(k, (dayTot.get(k) || 0) + x.d); });
  const big = [...dayTot.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    sub: 'From Emby + Playback Reporting, everyone on the server',
    people: people(inP.map((x) => ({ u: x.u, t: x.d, what: show(x) })), 'Top watchers', 'everyone on the server, ' + (p === 'all' ? 'all time' : perWord(p)), hm),
    cards: [
      { hot: true, k: 'TIME WATCHED', v: hm(watch), d: vs(watch, prev, p), g: '📺' },
      { k: 'PLAYS', v: n0(inP.length), d: { t: 'episodes and movies', c: 'n' }, g: '▶' },
      { k: 'PEOPLE WATCHING', v: n0(ppl.size), d: { t: perWord(p), c: 'n' }, g: '👥' },
      { k: 'AVERAGE A DAY', v: hm(watch / days), d: null, g: '⏱' },
    ],
    bars: { title: 'Watch time', sub: chartSub(p), list: buckets(pr.map((x) => [x.t, x.d]), p, hm) },
    wk: { title: 'When people watch', sub: grid[bd][bh] ? `Busiest: ${WEEKDAYS[(bd + 1) % 7]}s around ${f(bh)}` : '', rows: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => ({ d, c: grid[i].map((v) => v / mx) })) },
    top: { title: 'Top shows', by: 'by time', none: `No episodes watched ${perWord(p)}.`, items: shows.slice(0, 6).map((x) => ({ a: x.n, b: plural(x.c, 'play'), shape: 'ps', hue: hue(x.n), w: x.t / (shows[0]?.t || 1), v: hm(x.t) })) },
    top2: { title: 'Top movies', none: `No movies ${perWord(p)}.`, items: movies.slice(0, 6).map((x) => ({ a: x.n, b: plural(x.c, 'play'), shape: 'po', hue: hue(x.n), v: hm(x.t) })) },
    genres: null,
    facts: [
      { k: 'Busiest day', v: bz.any ? bz.day : '', s: bz.any ? `${hm(bz.avg)} on average` : '' },
      { k: 'Favourite time', v: favHour(inP.map((x) => [x.t, x.d])), s: 'when the server is busiest' },
      { k: 'Biggest day', v: big ? hm(big[1]) : '', s: big ? new Date(big[0] + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '' },
      { k: 'Different shows', v: shows.length ? n0(shows.length) : '', s: `and ${plural(movies.length, 'movie')}` },
    ],
    shelf: null,
  };
}
function tvModel() {}
tvModel.load = tvModel_load; tvModel.build = tvModel_build;
tvModel.canAll = tvModel_canAll; tvModel.loadAll = tvModel_loadAll; tvModel.buildAll = tvModel_buildAll;
