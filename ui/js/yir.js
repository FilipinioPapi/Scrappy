// Your Year in Review (approved mocks "Your Year in Review on PC / Google TV").
// A short slideshow per tab (Audiobooks, Music, Movies & TV) that ends on a summary card.
// It reuses the data the Stats pages already load, so opening it is quick.
//  - PC: a banner at the top of each Stats page from December 1 (and through January),
//    plus "Past years" chips. Settings › "Show Year in Review early" shows it any time.
//  - Google TV: the same slideshow, driven by the remote. tv.js adds class "tv" on <html>.
import { esc } from './components.js';
import { img, IMG_BASE } from './api.js';
import { loadRaw, absImg, ndImg, hue, hm, n0, plural, dkey, streaks, mergeGenres } from './stats.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON1 = 'JFMAMJJASOND'.split('');
const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const DAY = 86400000;
const G = {
  RED: ['#D8232A', '#5A0A0D'], PUR: ['#6E3590', '#1B0A2A'], TEAL: ['#22857A', '#062A26'], BLUE: ['#1A72B8', '#071C3A'],
  AMB: ['#C9662A', '#3A1206'], PINK: ['#C23E66', '#3A0818'], DARK: ['#3A2020', '#0C0606'], GREEN: ['#2F7D4A', '#0A2414'], INDIGO: ['#3D4FB8', '#0D1236'],
};
const grad = (k) => `linear-gradient(150deg,${G[k][0]} 0%,${G[k][1]} 100%)`;
const NAMES = { abs: 'AUDIOBOOKS', music: 'MUSIC', tv: 'MOVIES & TV' };
const WORD = { abs: 'BOOKS', music: 'MUSIC', tv: 'MOVIES & TV' };
const CARD_VARS = { abs: '--acc:#F4A259;--glow:rgba(232,128,58,.35)', music: '--acc:#FF7A7F;--glow:rgba(236,40,46,.35)', tv: '--acc:#7CC0FF;--glow:rgba(31,143,224,.35)' };
const ACC = { abs: ['#F4A259', 'rgba(232,128,58,.35)'], music: ['#FF7A7F', 'rgba(236,40,46,.35)'], tv: ['#7CC0FF', 'rgba(31,143,224,.35)'] };

const isTv = () => document.documentElement.classList.contains('tv');
const y0 = (y) => new Date(y, 0, 1).getTime();
const inY = (t, y) => t >= y0(y) && t < y0(y + 1);
/** Days of the year so far (the whole year once it's over). */
const daysIn = (y) => Math.max(1, Math.ceil((Math.min(Date.now(), y0(y + 1)) - y0(y)) / DAY));
const hr = (h) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
const short = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const ini = (s) => String(s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
/** A picture as a CSS background, over a colour made from `seed` in case it's missing. */
const pic = (url, seed) => `background:${url ? `url('${url}') center/cover no-repeat,` : ''}linear-gradient(135deg,hsl(${hue(seed)} 50% 42%),hsl(${hue(seed)} 55% 16%))`;
const top = (m, n = 5) => [...m.values()].sort((a, b) => b.t - a.t).slice(0, n);
const bump = (m, k, t, extra) => { if (!k) return null; const o = m.get(k) || { k, t: 0, n: 0, ...(extra ? extra() : {}) }; o.t += t; o.n++; m.set(k, o); return o; };
const months = (vals) => { const mx = Math.max(1, ...vals), hi = vals.indexOf(Math.max(...vals)); return vals.map((v, i) => ({ h: Math.max(3, (v / mx) * 100), hi: i === hi && v > 0, l: MON1[i] })); };
const clock = (vals) => { const mx = Math.max(1, ...vals), hi = vals.indexOf(Math.max(...vals)); return vals.map((v, i) => ({ h: Math.max(3, (v / mx) * 100), hi: i === hi, l: i % 6 === 0 ? ['12a', '6a', '12p', '6p'][i / 6] : '' })); };
const bestStreak = (keys) => streaks(new Set(keys)).best;
/** Three-hour peak window and the quietest hour, from 24 totals. */
function peak(h24) {
  let b = 0, bi = 0; for (let i = 0; i < 24; i++) { const s = h24[i] + h24[(i + 1) % 24] + h24[(i + 2) % 24]; if (s > b) { b = s; bi = i; } }
  const hi = h24.indexOf(Math.max(...h24)), lo = h24.indexOf(Math.min(...h24));
  return { from: bi, to: (bi + 3) % 24, hi, lo };
}
const clockWord = (h, tv) => (h >= 5 && h < 12 ? 'EARLY BIRD' : h >= 12 && h < 17 ? 'AFTERNOONS' : h >= 17 && h < 21 ? (tv ? 'PRIME TIME' : 'EVENINGS') : 'AFTER DARK');
// No picture twice: keep the first of each (same album cover, same poster).
const uniq = (list, key = (x) => x) => { const seen = new Set(); return list.filter((x) => { const k = key(x); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
const fan3 = (list) => uniq(list, (f) => f.k || f.url || f.seed).slice(0, 3);
const collage = (urls) => { urls = uniq(urls); const pos = [[0, 40, -8], [150, 0, 4], [300, 50, -3], [60, 220, 6], [250, 230, -6]]; return urls.slice(0, 5).map((u, j) => `${u};left:${pos[j][0]}px;top:${pos[j][1]}px;transform:rotate(${pos[j][2]}deg)`); };
const share = (m, n = 5) => { const l = [...mergeGenres(m).entries()].sort((a, b) => b[1] - a[1]); const tot = l.reduce((a, x) => a + x[1], 0) || 1; return l.slice(0, n).map(([g, t]) => [g, Math.round((t / tot) * 100)]); };
const genreLine = (g) => {
  const s = String(g || '').toLowerCase();
  if (/fantasy/.test(s)) return 'Dragons, magic and swords. Excellent taste.';
  if (/sci|space/.test(s)) return 'Spaceships and big ideas. Excellent taste.';
  if (/myster|thrill|crime|suspense/.test(s)) return 'Always looking for the twist.';
  if (/romance/.test(s)) return 'A softie at heart.';
  if (/horror/.test(s)) return 'Sleeping with the lights on?';
  if (/hist/.test(s)) return 'A history buff, then.';
  if (/biograph|memoir/.test(s)) return 'Real lives, real stories.';
  if (/self|business|help|psych/.test(s)) return 'Always levelling up.';
  if (/rock|metal|punk/.test(s)) return 'Turn it up. Respect.';
  if (/hip|rap/.test(s)) return 'Bars all year long. Respect.';
  if (/electro|dance|house|techno/.test(s)) return 'Bass first, questions later.';
  if (/drama/.test(s)) return 'You like the heavy stuff.';
  if (/comed/.test(s)) return 'Laughs all year. Good call.';
  if (/anim/.test(s)) return 'Cartoons are for everyone.';
  return `${g} all the way. Excellent taste.`;
};
/** Card list rows from [[name]]. */
const rows = (l) => l.slice(0, 5).map((t, i) => ({ n: i + 1, t, f: i === 0 }));

// ---------- year models ----------
// Each returns { slides, card, fan, intro } for one year, or null when there's nothing to show.

async function absYear(raw, y) {
  const { stats, me, sessions } = raw;
  const days = Object.entries(stats.days || {}).filter(([k, v]) => k.startsWith(y + '-') && v > 0);
  const total = days.reduce((a, [, v]) => a + v, 0);
  if (total < 600) return null;
  const mon = new Array(12).fill(0); days.forEach(([k, v]) => { mon[Number(k.slice(5, 7)) - 1] += v; });
  const ses = sessions.filter((x) => inY(x.startedAt || x.updatedAt || 0, y) && x.timeListening > 0);
  const titles = new Map(); sessions.forEach((x) => { if (x.libraryItemId && !titles.has(x.libraryItemId)) titles.set(x.libraryItemId, x.displayTitle || x.mediaMetadata?.title || ''); });
  const books = new Map(), authors = new Map(), genres = new Map(), series = new Map(), h24 = new Array(24).fill(0);
  ses.forEach((x) => {
    const t = x.timeListening;
    const b = bump(books, x.libraryItemId, t, () => ({ id: x.libraryItemId, title: x.displayTitle || x.mediaMetadata?.title || '', author: x.displayAuthor || x.mediaMetadata?.authorName || '' }));
    String(b?.author || '').split(/,\s*|\s+&\s+/).filter(Boolean).forEach((a) => { const o = bump(authors, a, t, () => ({ b: new Set() })); o.b.add(x.libraryItemId); });
    (x.mediaMetadata?.genres || []).forEach((g) => genres.set(g, (genres.get(g) || 0) + t));
    const sr = x.mediaMetadata?.series;
    const sn = Array.isArray(sr) ? sr[0]?.name : String(x.mediaMetadata?.seriesName || '').replace(/\s*#.*$/, '');
    if (sn) bump(series, sn, t);
    h24[new Date(x.startedAt || x.updatedAt).getHours()] += t;
  });
  const tb = top(books), ta = top(authors), gs = share(genres), ts = top(series, 1)[0];
  const fin = (me.mediaProgress || []).filter((x) => !x.episodeId && x.isFinished && inY(x.finishedAt || 0, y)).sort((a, b) => b.finishedAt - a.finishedAt);
  const fast = fin.filter((x) => x.startedAt && titles.get(x.libraryItemId)).map((x) => ({ t: titles.get(x.libraryItemId), d: Math.max(1, Math.round((x.finishedAt - x.startedAt) / DAY)) })).sort((a, b) => a.d - b.d)[0];
  const longest = ses.reduce((a, x) => (x.timeListening > (a?.timeListening || 0) ? x : a), null);
  const hrs = total / 3600, dd = total / 86400, pk = peak(h24);
  const streak = bestStreak(days.map(([k]) => k));
  // Author photos: Audiobookshelf keeps them per author, so look the names up once.
  const aImg = await authorPhotos(ta.map((a) => a.k));
  const cover = (id, w = 400) => absImg(id, w);
  const per = fin.length ? daysIn(y) / fin.length : 0;
  const pace = !fin.length ? '' : per <= 1.5 ? 'About one a day.' : per < 12 ? `About one every ${Math.round(per)} days.` : per < 21 ? 'About one every two weeks.' : per < 45 ? 'About one a month.' : '';
  const s = [];
  s.push({ t: 'intro', bg: 'AMB', logo: true, k: 'Audiobooks', v: `YOUR ${y}\nYEAR IN REVIEW`, a: 'Your year in audiobooks, from every app that plays through Audiobookshelf.', b: 'About a minute. Use the arrows to go at your own pace.', collage: collage(tb.map((b) => pic(cover(b.id), b.title))), q: 'Grab a coffee. This one is all about you.' });
  s.push(hrs >= 10
    ? { t: 'big', bg: 'PUR', k: 'You listened for', v: n0(hrs), a: dd >= 1 ? `hours. That's ${plural(dd, 'whole day')} of stories.` : 'hours of stories.', b: `About ${hm(total / daysIn(y))} a day on average.`, tag: dd >= 2 ? `${n0(dd)} DAYS!` : '', mb: months(mon), q: `${n0(hrs)} hours. That is a lot of naps you skipped. Worth it.` }
    : { t: 'big', bg: 'PUR', k: 'You listened for', v: n0(total / 60), a: 'minutes of stories.', b: `${MON[mon.indexOf(Math.max(...mon))]} was your biggest month.`, mb: months(mon), q: 'Every minute counts.' });
  if (fin.length) s.push({ t: 'wall', bg: 'DARK', k: 'You finished', v: plural(fin.length, 'book').toUpperCase(), a: pace, b: fast ? `Fastest: ${fast.t}, in ${plural(fast.d, 'day')}.` : '', tag: fin.length >= 12 ? 'BOOKWORM' : '', wall: fin.slice(0, 18).map((x) => pic(cover(x.libraryItemId, 200), x.libraryItemId)), q: `${plural(fin.length, 'book')}. ${fin.length >= 20 ? 'Your shelf is starting to sag.' : fin.length >= 8 ? 'That is a proper reading list.' : 'Every one of them counts.'}` });
  if (tb[0]) s.push({ t: 'hero', bg: 'BLUE', k: 'Your book of the year', art: { st: pic(cover(tb[0].id, 600), tb[0].title) + ';width:420px;height:420px;font-size:46px', cls: '', t: tb[0].title }, v: tb[0].title, a: tb[0].author, b: `${hm(tb[0].t).replace(/ 0m$/, '')} with it. Your most-listened book.`, q: tb[0].t >= 36000 ? `${n0(tb[0].t / 3600)} hours with one book. That is commitment.` : 'A clear favourite.' });
  if (ta.length) s.push({ t: 'list', bg: 'TEAL', k: 'Your top authors', v: 'ON YOUR SHELF', a: 'The voices you spent the most time with.', items: ta.map((a) => ({ a: a.k, b: `${plural(a.t / 3600, 'hour')} · ${plural(a.b.size, 'book')}`, cc: 'rd', st: pic(aImg[a.k], a.k) })), q: `${ta[0].k} owes you a thank-you card.` });
  if (gs.length) s.push({ t: 'facts', bg: 'PINK', k: 'Your genre', v: gs[0][0].toUpperCase(), a: `${gs[0][1]}% of your listening.${gs[1] ? ` ${gs[1][0]} came second.` : ''}`, tag: `${gs[0][0].toUpperCase()} FAN`, facts: [
    ts && { k: 'TOP SERIES', v: ts.k },
    longest && { k: 'LONGEST SESSION', v: hm(longest.timeListening) },
    { k: 'FAVOURITE TIME', v: `${hr(pk.from)} to ${hr(pk.to)}` },
    { k: 'LONGEST STREAK', v: plural(streak, 'day') },
  ].filter(Boolean).slice(0, 4), q: genreLine(gs[0][0]) });
  const card = {
    fan: fan3(tb.map((b) => ({ url: cover(b.id), seed: b.title }))), po: false,
    av: { url: aImg[ta[0]?.k] || '', seed: ta[0]?.k || '', ini: ini(ta[0]?.k), name: ta[0]?.k || '', pp: false },
    h1: 'TOP BOOKS', L1: rows(tb.map((b) => b.title)), h2: 'TOP AUTHORS', L2: rows(ta.map((a) => a.k)),
    stats: [['HOURS', n0(hrs)], ['FINISHED', plural(fin.length, 'book').toUpperCase()], ['TOP GENRE', (gs[0]?.[0] || '—').toUpperCase()], ['BEST STREAK', plural(streak, 'day').toUpperCase()]],
  };
  s.push({ t: 'sum', bg: 'AMB', q: 'Good year. Same time next year?' });
  return { slides: s, card };
}
let authorCache = null;
async function authorPhotos(names) {
  const out = {};
  try {
    if (!authorCache) {
      authorCache = new Map();
      const { api } = await import('./api.js');
      const libs = (await api.abs('/api/libraries'))?.libraries || [];
      for (const l of libs.filter((x) => x.mediaType === 'book')) {
        const r = await api.abs(`/api/libraries/${encodeURIComponent(l.id)}/authors`).catch(() => null);
        (r?.authors || []).forEach((a) => { if (a.imagePath) authorCache.set(a.name, `${IMG_BASE}/absa/${encodeURIComponent(a.id)}?w=300&u=${a.updatedAt || ''}`); });
      }
    }
    names.forEach((n) => { if (authorCache.has(n)) out[n] = authorCache.get(n); });
  } catch {}
  return out;
}

function musicYear(raw, y) {
  const { log, histErr } = raw;
  const L = log.filter((x) => inY(x.t, y) && x.alId);
  if (L.length < 10) return histErr ? { err: histErr } : null;
  const secs = L.reduce((a, x) => a + x.d, 0), mins = secs / 60, dd = secs / 86400;
  const mon = new Array(12).fill(0), h24 = new Array(24).fill(0), dayT = new Map();
  const songs = new Map(), albums = new Map(), artists = new Map(), genres = new Map();
  L.forEach((x) => {
    const d = new Date(x.t); mon[d.getMonth()] += x.d; h24[d.getHours()] += x.d || 180;
    dayT.set(dkey(x.t), (dayT.get(dkey(x.t)) || 0) + x.d);
    const s = bump(songs, x.id, 1, () => ({ ti: x.ti, ar: x.ar, cv: x.cv, al: x.al, alId: x.alId, d: x.d, hrs: new Array(24).fill(0) })); s.hrs[d.getHours()]++;
    bump(albums, x.alId, 1, () => ({ id: x.alId, name: x.al, ar: x.ar, cv: x.cv }));
    const a = bump(artists, x.ar, 1, () => ({ id: x.arId, secs: 0, days: new Set() })); if (a) { a.secs += x.d; a.days.add(dkey(x.t)); }
    if (x.g) genres.set(x.g, (genres.get(x.g) || 0) + 1);
  });
  const tS = top(songs), tA = top(albums), tR = top(artists), gs = share(genres), pk = peak(h24);
  const before = new Set(log.filter((x) => x.t < y0(y)).map((x) => x.ar));
  const fresh = new Set(L.map((x) => x.ar).filter((a) => a && !before.has(a)));
  const histStart = log[0]?.t || 0;
  const late = inY(histStart, y) && histStart - y0(y) > 7 * DAY;
  const bigDay = Math.max(0, ...dayT.values());
  const streak = bestStreak([...dayT.keys()]);
  const bm = mon.indexOf(Math.max(...mon));
  const first = L[0], last = L[L.length - 1];
  const song = tS[0], sh = song.hrs.indexOf(Math.max(...song.hrs));
  const s = [];
  s.push({ t: 'intro', bg: 'RED', logo: true, k: 'Music', v: `YOUR ${y}\nYEAR IN REVIEW`, a: 'Your year in music, from every app that plays through Navidrome.', b: 'About a minute. Use the arrows to go at your own pace.', badge: late ? `Counting from ${short(histStart)}, when your Navidrome started keeping history` : '', collage: collage(tA.map((a) => pic(ndImg(a.cv, 400), a.name))), q: 'Headphones on. Here is what you had playing.' });
  s.push({ t: 'big', bg: 'PUR', k: 'You listened for', v: n0(mins), a: dd >= 1 ? `minutes. That's ${plural(dd, 'day')} of music.` : 'minutes of music.', b: `${MON[bm]} was your biggest month.`, tag: dd >= 2 ? `${n0(dd)} DAYS!` : '', mb: months(mon), q: mins > 20000 ? 'Your speakers deserve a break.' : 'Good tunes, well spent.' });
  s.push({ t: 'clock', bg: 'INDIGO', k: 'Your listening clock', v: clockWord((pk.from + 1) % 24, false), a: `You listened most between ${hr(pk.from)} and ${hr(pk.to)}.`, b: `Quietest hour: ${hr(pk.lo)}.`, tag: `${hr(pk.hi).toUpperCase()} PEAK`, clock: clock(h24), q: (pk.from + 1) % 24 >= 21 || (pk.from + 1) % 24 < 4 ? 'The best songs come out after dark.' : (pk.from + 1) % 24 < 12 ? 'Starting the day the right way.' : 'Soundtrack to the whole day.' });
  s.push({ t: 'hero', bg: 'BLUE', k: 'Your song of the year', art: { st: pic(ndImg(song.cv, 600), song.al) + ';width:420px;height:420px;font-size:38px', cls: '', t: song.al }, v: song.ti, a: song.ar, b: `Played ${plural(song.t, 'time')}. Mostly around ${hr(sh)}.`, q: song.t >= 50 ? `${n0(song.t)} plays. The neighbours know the words by now.` : 'You had this one on repeat.' });
  s.push({ t: 'list', bg: 'DARK', k: 'Your top songs', v: 'ON REPEAT', a: 'The five you kept coming back to.', tag: 'ON REPEAT', items: tS.map((x) => ({ a: x.ti, b: `${x.ar} · ${plural(x.t, 'play')}`, cc: '', st: pic(ndImg(x.cv), x.al) })), q: 'Five songs, zero skips.' });
  s.push({ t: 'list', bg: 'GREEN', k: 'Your top albums', v: 'FRONT TO BACK', a: 'The records you played the most.', items: tA.map((x) => ({ a: x.name, b: `${x.ar} · ${plural(x.t, 'play')}`, cc: '', st: pic(ndImg(x.cv), x.name) })), q: 'Front to back, no shuffle needed.' });
  const ar = tR[0];
  s.push({ t: 'hero', bg: 'AMB', k: 'Your artist of the year', art: { st: pic(ndImg(ar.id || ar.cv, 600), ar.k) + ';width:400px;height:400px;font-size:52px', cls: 'rd', t: ini(ar.k), round: true }, v: ar.k, a: `${plural(ar.t, 'play')}, ${plural(ar.secs / 3600, 'hour')}`, b: `You played them on ${plural(ar.days.size, 'different day')}.`, q: ar.days.size >= 60 ? `${n0(ar.days.size)} days with ${ar.k}. That is basically a relationship.` : `${ar.k}, on repeat.` });
  s.push({ t: 'list', bg: 'TEAL', k: 'Your top artists', v: 'THE LINEUP', a: 'Your most-played artists this year.', items: tR.map((x) => ({ a: x.k, b: plural(x.t, 'play'), cc: 'rd', st: pic(ndImg(x.id || x.cv), x.k) })), q: 'Quite the lineup. We would buy a ticket.' });
  if (gs.length >= 2) s.push({ t: 'hbars', bg: 'PINK', k: 'Your sound', v: `${gs[0][0]}, THEN\n${gs[1][0]}`.toUpperCase(), a: 'Your top genres by plays.', hb: gs, q: genreLine(gs[0][0]) });
  if (first && last && first !== last) s.push({ t: 'pair', bg: 'BLUE', k: 'Bookends', v: 'FIRST & LATEST', a: y === new Date().getFullYear() ? 'How your year started, and where it is now.' : 'How your year started, and how it ended.', pair: [
    { k: `FIRST SONG OF ${y}`, st: pic(ndImg(first.cv, 300), first.al), t: first.ti, b: `${first.ar} · ${short(first.t)}` },
    { k: y === new Date().getFullYear() ? 'MOST RECENT' : `LAST SONG OF ${y}`, st: pic(ndImg(last.cv, 300), last.al), t: last.ti, b: `${last.ar} · ${short(last.t)}` },
  ], q: first.ar && last.ar && first.ar !== last.ar ? `From ${first.ar} to ${last.ar}. What a ride.` : 'Full circle.' });
  s.push({ t: 'facts', bg: 'PUR', k: 'Fun facts', v: 'BY THE\nNUMBERS', a: 'The little things that made your year.', facts: [
    late || !before.size ? { k: 'ARTISTS PLAYED', v: n0(artists.size) } : { k: 'NEW ARTISTS', v: `${n0(fresh.size)} found` },
    { k: 'BEST MONTH', v: new Date(y, bm, 1).toLocaleDateString(undefined, { month: 'long' }) },
    { k: 'MOST IN ONE DAY', v: hm(bigDay) },
    { k: 'LONGEST STREAK', v: plural(streak, 'day') },
  ], q: 'One more for the road.' });
  s.push({ t: 'sum', bg: 'RED', q: 'What a year of tunes.' });
  // Song snippets (approved mock): each slide about one song plays a bit of it; the others
  // keep the last one going. Never the same song twice in a row where there's a choice.
  const ranked = [...songs.values()].filter((x) => x.d > 20).sort((a, b) => b.t - a.t), used = new Set();
  const pick = (f = () => true) => { const x = ranked.find((y) => f(y) && !used.has(y.k)) || ranked.find(f); if (x) used.add(x.k); return x ? { id: x.k, d: x.d, ti: x.ti, ar: x.ar } : null; };
  const SND = {
    'Music': () => pick((x) => x !== ranked[0] && x !== ranked[1]),
    'Your song of the year': () => pick((x) => x.k === song.k),
    'Your top songs': () => pick((x) => x.k === tS[1]?.k) || pick(),
    'Your top albums': () => pick((x) => x.alId === tA[0]?.k),
    'Your artist of the year': () => pick((x) => x.ar === ar.k),
    'Your top artists': () => pick((x) => x.ar === tR[1]?.k),
    'Bookends': () => pick((x) => x.k === first.id),
  };
  s.forEach((sl) => { const f = SND[sl.k]; if (f) sl.snd = f(); });
  const ts = s.find((sl) => sl.k === 'Your top songs'); if (ts?.snd) ts.playRow = tS.findIndex((x) => x.k === ts.snd.id);
  s[s.length - 1].snd = pick((x) => x.k === song.k);
  const card = {
    fan: fan3([...tS.map((x) => ({ k: x.alId, url: x.cv && ndImg(x.cv, 300), seed: x.al })), ...tA.map((x) => ({ k: x.id, url: x.cv && ndImg(x.cv, 300), seed: x.name }))]), po: false,
    av: { url: ndImg(ar.id || ar.cv, 300), seed: ar.k, ini: ini(ar.k), name: ar.k, pp: false },
    h1: 'TOP SONGS', L1: rows(tS.map((x) => x.ti)), h2: 'TOP ARTISTS', L2: rows(tR.map((x) => x.k)),
    stats: [['MINUTES', n0(mins)], ['TOP GENRE', (gs[0]?.[0] || '—').toUpperCase()], late || !before.size ? ['ARTISTS', n0(artists.size)] : ['NEW ARTISTS', n0(fresh.size)], ['BEST STREAK', plural(streak, 'day').toUpperCase()]],
  };
  return { slides: s, card };
}

function tvYear(raw, y) {
  const { eps, movies, series, pr } = raw;
  const when = (it) => Date.parse(it.UserData?.LastPlayedDate || '') || 0;
  const byS = new Map(series.map((s) => [s.Id, s]));
  const epById = new Map(eps.map((e) => [e.Id, e]));
  const movById = new Map(movies.map((m) => [m.Id, m]));
  const epsY = eps.filter((e) => inY(when(e), y)), movY = movies.filter((m) => inY(when(m), y));
  const P = pr ? pr.filter((x) => inY(x.t, y) && x.d > 60).sort((a, b) => a.t - b.t) : null;
  if (!epsY.length && !movY.length && !P?.length) return null;
  const isEp = (x) => /episode/i.test(x.type || '');
  const showOf = (x) => { const e = epById.get(String(x.id)); return e ? { id: e.SeriesId, name: e.SeriesName } : { id: '', name: String(x.name || '').split(' - ')[0] }; };
  const shows = new Map(), mov = new Map(), genres = new Map(), mon = new Array(12).fill(0), h24 = new Array(24).fill(0), binge = new Map(), wd = new Array(7).fill(0);
  const addG = (gs, w) => (gs || []).forEach((g) => genres.set(g, (genres.get(g) || 0) + w));
  let secs = 0;
  if (P && P.length) {
    P.forEach((x) => {
      const d = new Date(x.t); secs += x.d; mon[d.getMonth()] += x.d; h24[d.getHours()] += x.d; wd[d.getDay()] += x.d;
      if (isEp(x)) { const sh = showOf(x); const o = bump(shows, sh.id || sh.name, x.d, () => ({ id: sh.id, name: sh.name, eps: new Set(), first: x.t, last: 0 })); o.eps.add(String(x.id)); o.last = x.t; addG(byS.get(sh.id)?.Genres, x.d); const bk = dkey(x.t) + '|' + sh.name; binge.set(bk, (binge.get(bk) || 0) + 1); }
      else { const m = movById.get(String(x.id)); bump(mov, String(m?.Name || x.name || x.id).toLowerCase(), x.d, () => ({ id: m?.Id || '', name: m?.Name || x.name, it: m })); addG(m?.Genres, x.d); }
    });
  } else {
    epsY.forEach((e) => { const t = (e.RunTimeTicks || 0) / 1e7; secs += t; mon[new Date(when(e)).getMonth()] += t; const o = bump(shows, e.SeriesId || e.SeriesName, t, () => ({ id: e.SeriesId, name: e.SeriesName || '', eps: new Set(), first: when(e), last: 0 })); o.eps.add(e.Id); o.first = Math.min(o.first, when(e)); o.last = Math.max(o.last, when(e)); addG(byS.get(e.SeriesId)?.Genres, t); });
    movY.forEach((m) => { const t = (m.RunTimeTicks || 0) / 1e7; secs += t; mon[new Date(when(m)).getMonth()] += t; bump(mov, m.Id, t, () => ({ id: m.Id, name: m.Name, it: m })); addG(m.Genres, t); });
  }
  const tSh = top(shows), tMv = [...mov.values()].sort((a, b) => b.n - a.n || b.t - a.t).slice(0, 5), gs = share(genres);
  const hrs = secs / 3600, dd = secs / 86400;
  const thumb = (id, w = 400) => { const it = byS.get(id); return it ? img(it.Id, 'Thumb', it.ImageTags?.Thumb, w) || img(it.Id, 'Backdrop', it.BackdropImageTags?.[0], w) || img(it.Id, 'Primary', it.ImageTags?.Primary, w) : ''; };
  const poster = (it, w = 300) => (it ? img(it.Id, 'Primary', it.ImageTags?.Primary, w) : '');
  const sPoster = (id, w = 300) => poster(byS.get(id), w);
  const epN = P ? new Set(P.filter(isEp).map((x) => String(x.id))).size || epsY.length : epsY.length;
  const mvN = P ? new Set(P.filter((x) => !isEp(x)).map((x) => String(x.id || x.name))).size || movY.length : movY.length;
  const s = [];
  s.push({ t: 'intro', bg: 'BLUE', logo: true, k: 'Movies & TV', v: `YOUR ${y}\nYEAR IN REVIEW`, a: 'Your year in movies and TV on Emby.', b: 'About a minute. Use the arrows to go at your own pace.', badge: P ? '' : 'Install Playback Reporting in Emby for watch times and your watching clock', collage: collage([...tSh.map((x) => pic(sPoster(x.id), x.name)), ...tMv.map((m) => pic(poster(m.it), m.name))]), q: 'Grab the popcorn. Here is your year on screen.' });
  s.push({ t: 'big', bg: 'PUR', k: P ? 'You watched for' : 'You watched about', v: n0(hrs), a: dd >= 1 ? `hours. That's ${plural(dd, 'day')} in front of the screen.` : 'hours in front of the screen.', b: `${plural(epN, 'episode')} and ${plural(mvN, 'movie')}.`, tag: dd >= 2 ? `${n0(dd)} DAYS!` : '', mb: months(mon), q: 'Time well spent.' });
  if (P && P.length) { const pk = peak(h24); s.push({ t: 'clock', bg: 'INDIGO', k: 'Your watching clock', v: clockWord((pk.from + 1) % 24, true), a: `Most of your watching happened between ${hr(pk.from)} and ${hr(pk.to)}.`, b: `Busiest hour: ${hr(pk.hi)}.`, tag: (pk.from + 1) % 24 >= 22 || (pk.from + 1) % 24 < 4 ? 'NIGHT OWL' : '', clock: clock(h24), q: 'Prime time is whenever you say it is.' }); }
  const sh = tSh[0];
  if (sh) { const span = Math.max(1, Math.round((sh.last - sh.first) / DAY) + 1); s.push({ t: 'hero', bg: 'DARK', k: 'Your show of the year', art: { st: pic(thumb(sh.id, 800), sh.name) + ';width:520px;height:292px;font-size:60px', cls: '', t: sh.name }, v: sh.name, a: `${plural(sh.eps.size, 'episode')}, ${plural(sh.t / 3600, 'hour')}`, b: span > 1 ? `You watched it over ${plural(span, 'day')}.` : 'All in one day.', q: span <= 30 && sh.eps.size >= 8 ? `${sh.eps.size} episodes in ${plural(span, 'day')}. Did you sleep?` : `${sh.name} kept you company.` }); }
  if (tSh.length >= 2) s.push({ t: 'list', bg: 'TEAL', k: 'Your top shows', v: 'BINGE LIST', a: P ? 'Ranked by hours watched.' : 'Ranked by episodes watched.', items: tSh.map((x) => ({ a: x.name, b: P ? plural(x.t / 3600, 'hour') : plural(x.eps.size, 'episode'), cc: 'wd', st: pic(thumb(x.id, 300), x.name) })), q: 'Solid binge list. No notes.' });
  if (tMv.length) s.push({ t: 'list', bg: 'RED', k: 'Your top movies', v: 'MOVIE NIGHTS', a: 'Your most-watched films.', items: tMv.map((m) => ({ a: m.name, b: m.n > 1 ? `Watched ${m.n} times` : (m.it?.Genres?.[0] || 'Movie'), cc: 'po', st: pic(poster(m.it, 200), m.name) })), q: tMv[0].n > 2 ? `${tMv[0].name}, ${tMv[0].n} times. Must be good.` : 'Movie nights done right.' });
  if (gs.length >= 2) s.push({ t: 'hbars', bg: 'PINK', k: 'Your genres', v: `${gs[0][0]}\nON TOP`.toUpperCase(), a: 'Your top genres by hours watched.', hb: gs, q: `${gs[0][0]} on top. ${genreLine(gs[0][0])}` });
  if (P && P.length >= 2) {
    const look = (x) => { if (isEp(x)) { const o = showOf(x); const e = epById.get(String(x.id)); return { st: pic(sPoster(o.id) || poster(e), o.name), t: o.name, b: `${e && e.ParentIndexNumber != null ? `S${e.ParentIndexNumber}:E${e.IndexNumber} · ` : ''}${short(x.t)}` }; } const m = movById.get(String(x.id)); return { st: pic(poster(m), x.name), t: m?.Name || x.name, b: `Movie · ${short(x.t)}` }; };
    const f = look(P[0]), l = look(P[P.length - 1]);
    const cur = y === new Date().getFullYear();
    s.push({ t: 'pair', bg: 'GREEN', k: 'Bookends', v: 'FIRST & LATEST', a: cur ? 'How your year started, and where it is now.' : 'How your year started, and how it ended.', pair: [{ k: `FIRST WATCH OF ${y}`, ...f }, { k: cur ? 'MOST RECENT' : `LAST WATCH OF ${y}`, ...l }], q: f.t !== l.t ? `From ${f.t} to ${l.t}.` : 'Full circle.' });
  }
  const bg = [...binge.entries()].sort((a, b) => b[1] - a[1])[0];
  const rew = [...epsY, ...movY].filter((x) => (x.UserData?.PlayCount || 0) > 1).sort((a, b) => b.UserData.PlayCount - a.UserData.PlayCount)[0];
  const lm = movY.slice().sort((a, b) => (b.RunTimeTicks || 0) - (a.RunTimeTicks || 0))[0];
  const facts = [
    bg && bg[1] > 1 && { k: 'BIGGEST BINGE', v: `${bg[1]} eps of ${bg[0].split('|')[1]}` },
    P && P.length && { k: 'BUSIEST DAY', v: WEEKDAYS[wd.indexOf(Math.max(...wd))] },
    rew && { k: 'REWATCHED MOST', v: rew.SeriesName || rew.Name },
    lm && { k: 'LONGEST MOVIE', v: lm.Name },
    { k: 'SHOWS WATCHED', v: n0(shows.size) },
  ].filter(Boolean).slice(0, 4);
  if (facts.length >= 2) s.push({ t: 'facts', bg: 'AMB', k: 'Fun facts', v: 'BINGE MODE', a: 'You do not do things halfway.', facts, q: 'Binge mode: fully unlocked.' });
  s.push({ t: 'sum', bg: 'BLUE', q: 'Great year of watching. Roll credits.' });
  const tm = tMv[0];
  const card = {
    fan: fan3(tSh.length >= 3 ? tSh.map((x) => ({ url: sPoster(x.id), seed: x.name })) : [...tSh.map((x) => ({ url: sPoster(x.id), seed: x.name })), ...tMv.map((m) => ({ url: poster(m.it), seed: m.name }))]), po: true,
    av: tm ? { url: poster(tm.it), seed: tm.name, ini: ini(tm.name), name: tm.name, pp: true } : { url: sPoster(sh?.id), seed: sh?.name, ini: ini(sh?.name), name: sh?.name || '', pp: true },
    h1: 'TOP SHOWS', L1: rows(tSh.map((x) => x.name)), h2: 'TOP MOVIES', L2: rows(tMv.map((m) => m.name)),
    stats: [['HOURS', n0(hrs)], ['EPISODES', n0(epN)], ['MOVIES', n0(mvN)], ['TOP GENRE', (gs[0]?.[0] || '—').toUpperCase()]],
  };
  return { slides: s, card };
}

const YEAR = { abs: absYear, music: musicYear, tv: tvYear };
/** Years with something in them, newest first. */
function yearsOf(kind, raw) {
  const ys = new Set();
  if (kind === 'abs') Object.keys(raw.stats?.days || {}).forEach((k) => ys.add(Number(k.slice(0, 4))));
  if (kind === 'music') raw.log.forEach((x) => ys.add(new Date(x.t).getFullYear()));
  if (kind === 'tv') { (raw.pr || []).forEach((x) => ys.add(new Date(x.t).getFullYear())); [...raw.eps, ...raw.movies].forEach((x) => { const t = Date.parse(x.UserData?.LastPlayedDate || ''); if (t) ys.add(new Date(t).getFullYear()); }); }
  return [...ys].filter((y) => y > 2000).sort((a, b) => b - a);
}
const models = new Map();
async function model(kind, y) {
  const k = kind + y;
  if (!models.has(k)) models.set(k, (async () => YEAR[kind](await loadRaw(kind), y))().catch((e) => { models.delete(k); throw e; }));
  return models.get(k);
}

// ---------- banner on the Stats pages ----------
const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 600 }) : setTimeout(r, 60)));
/** Wait (briefly) until these pictures are ready, so the banner appears in one smooth step. */
const decoded = (urls) => Promise.race([
  Promise.all(urls.filter(Boolean).map((u) => { const im = new Image(); im.src = u; return im.decode().catch(() => {}); })),
  new Promise((r) => setTimeout(r, 1200)),
]);
const PLAY = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L8.5 4.6A1 1 0 0 0 7 5.5z" fill="currentColor"/></svg>';
const early = () => { try { return localStorage.getItem('yirEarly') === 'on'; } catch { return false; } };
/** Which year the big banner shows: this year from Dec 1, last year through January. */
function bannerYear() {
  const d = new Date();
  if (d.getMonth() === 11 || early()) return d.getFullYear();
  if (d.getMonth() === 0) return d.getFullYear() - 1;
  return 0;
}
const SUBS = { abs: 'audiobook', music: 'music', tv: 'movie and TV' };

/** Fills `slot` with the Year in Review banner and Past years chips for this tab. */
export async function yirBanner(slot, kind, alive) {
  // Hold the banner's place straight away so the page below doesn't jump when it arrives.
  if (bannerYear() && !slot.innerHTML.trim()) slot.innerHTML = '<div class="yb yb-ph" aria-hidden="true"></div>';
  let raw; try { raw = await loadRaw(kind); } catch { if (alive()) slot.innerHTML = ''; return; }
  // The Stats numbers draw first; the year is added up once the page has settled.
  await idle();
  if (!alive()) return;
  const by = bannerYear();
  const years = yearsOf(kind, raw).filter((y) => y < new Date().getFullYear() || y === by);
  let m = null;
  if (by && years.includes(by)) { try { m = await model(kind, by); } catch {} }
  if (!alive()) return;
  const past = years.filter((y) => y !== (m && !m.err ? by : 0));
  if (!m && !past.length) { slot.innerHTML = ''; return; }
  const note = !m ? '' : m.err ? (m.err === 'old' ? 'Needs Navidrome 0.59 or newer, which keeps a dated play history.' : "Couldn't read your play history from Navidrome. Open this page again to sign in.") : `Your ${SUBS[kind]} year in about a minute.${early() && new Date().getMonth() !== 11 ? ' Early preview: it shows up for real on December 1.' : ''}`;
  const fan = m && !m.err ? m.card.fan.map((f, j, a) => { const L = [[60], [30, 90], [0, 60, 120]][a.length - 1], R = [[0], [-6, 6], [-10, 0, 10]][a.length - 1]; return `<i style="${esc(pic(f.url, f.seed))};left:${L[j]}px;transform:rotate(${R[j]}deg)${a.length === 3 && j === 1 ? ';z-index:2' : ''}"></i>`; }).join('') : '';
  if (m && !m.err) await decoded(m.card.fan.map((f) => f.url));
  if (!alive()) return;
  slot.innerHTML = `${m ? `<div class="yb${m.err ? ' off' : ''}"${m.err ? '' : ' data-yir="' + by + '" tabindex="0" role="button" aria-label="Play your ' + by + ' Year in Review"'}>
      <div class="yb-yr">${by}</div>
      <div class="yb-t"><b>YOUR YEAR<br>IN REVIEW</b><span>${esc(note)}</span>${m.err ? '' : `<div class="yb-ok">${PLAY}Press OK to play</div>`}</div>
      <div class="yb-fan">${fan}</div>
      ${m.err ? '' : `<button type="button" class="yb-go" data-yir="${by}" tabindex="-1">${PLAY}Play</button>`}
    </div>` : ''}
    ${past.length ? `<div class="yb-past"><span class="t2">${m ? 'Past years:' : 'Year in Review:'}</span>${past.map((y) => `<button type="button" class="yb-chip" data-yir="${y}">${y}</button>`).join('')}</div>` : ''}`;
  slot.onclick = (e) => { const b = e.target.closest('[data-yir]'); if (b) openYir(kind, Number(b.dataset.yir)); };
  slot.onkeydown = (e) => { if (e.key === 'Enter' && e.target.classList.contains('yb')) { e.preventDefault(); openYir(kind, Number(e.target.dataset.yir)); } };
}

// ---------- the slideshow ----------
const SVG = {
  play: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
  snd: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  mute: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  save: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
};
const SQUIGGLE = '<svg class="y-sq1" width="180" height="40" viewBox="0 0 180 40" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"><path d="M4 20c14-18 28 18 43 0s28-18 43 0 28 18 43 0 28-18 43 0"/></svg>';
const CONFETTI = [[8, 18, '#FFD43B'], [22, 82, '#fff'], [38, 12, '#EDA7AA'], [55, 88, '#FFD43B'], [70, 22, '#fff'], [86, 70, '#EDA7AA'], [93, 30, '#FFD43B'], [14, 60, '#fff'], [62, 52, '#FFD43B'], [47, 30, '#fff']]
  .map((d, k) => `<i class="y-cf" style="left:${d[0]}%;top:${d[1]}%;background:${d[2]};opacity:.55;animation-delay:${(k * 0.37).toFixed(2)}s${k % 3 === 0 ? ';border-radius:50%' : ''}"></i>`).join('');

const flav = (q) => `<div class="y-flav">${String(q || '').split(' ').map((w, k) => `<span class="y-w"><span style="animation-delay:${(0.5 + k * 0.07).toFixed(2)}s">${esc(w)}</span></span>`).join('')}</div>`;
const midCls = (v) => { const n = String(v).length; return n > 34 ? ' xs' : n > 20 ? ' sm' : ''; };

function right(s) {
  const bars = (l, clk) => `<div class="y-mb${clk ? ' y-clk' : ''}">${l.map((m, i) => `<div><i class="${m.hi ? 'y-hi' : ''}" style="height:${m.h.toFixed(1)}%;animation-delay:${i * (clk ? 25 : 40)}ms"></i><span>${m.l}</span></div>`).join('')}</div>`;
  switch (s.t) {
    case 'intro': return `<div class="y-collage y-anim2">${s.collage.map((c) => `<i style="${esc(c)}"></i>`).join('')}</div>`;
    case 'big': return bars(s.mb);
    case 'clock': return bars(s.clock, true);
    case 'hero': { const hasImg = s.art.st.includes('url('); return `<div class="y-artw"><div class="y-art y-anim2${s.art.cls ? ' y-' + s.art.cls : ''}" style="${esc(s.art.st)}">${hasImg ? '' : esc(s.art.t)}</div><span class="y-stk">#1</span></div>`; }
    case 'list': return `<div class="y-lst">${s.items.map((x, k) => `<div class="y-it y-anim2${k === 0 ? ' y-first' : ''}${k === s.playRow ? ' y-on' : ''}" style="animation-delay:${0.12 + k * 0.06}s"><span class="y-n">${k + 1}</span><i class="y-c${x.cc ? ' y-' + x.cc : ''}" style="${esc(x.st)}"></i><div><b>${esc(x.a)}</b><span>${esc(x.b)}</span></div></div>`).join('')}</div>`;
    case 'wall': return `<div class="y-wall y-anim2">${s.wall.map((w) => `<i style="${esc(w)}"></i>`).join('')}</div>`;
    case 'facts': return `<div class="y-facts y-anim2">${s.facts.map((f) => `<div><span>${esc(f.k)}</span><b>${esc(f.v)}</b></div>`).join('')}</div>`;
    case 'hbars': return `<div class="y-hb">${s.hb.map(([t, v], k) => `<div class="y-r"><span>${esc(t)}</span><div class="y-tr"><i style="width:${Math.round((v / s.hb[0][1]) * 100)}%;animation-delay:${k * 80}ms"></i></div><span class="y-v">${v}%</span></div>`).join('')}</div>`;
    case 'pair': return `<div class="y-pair y-anim2">${s.pair.map((p) => `<div class="y-pc"><span>${esc(p.k)}</span><i style="${esc(p.st)}"></i><b>${esc(p.t)}</b><em>${esc(p.b)}</em></div>`).join('')}</div>`;
  }
  return '';
}

function cardHtml(kind, y, c) {
  const POS = c.po ? [[0, -8, 8], [92, 8, 8], [46, 0, 2]] : [[0, -8, 14], [106, 8, 14], [53, 0, 4]];
  const order = [c.fan[1], c.fan[2], c.fan[0]];
  if (c.fan.length === 2) { const w = c.po ? 78 : 100, mid = POS[2][0] + w / 2; POS[0] = [mid - w + 12, -6, POS[0][2]]; POS[1] = [mid - 12, 6, POS[1][2]]; order[1] = c.fan[0]; order[2] = null; }
  const fan = order.map((f, p) => (f ? `<i class="${c.po ? 'y-po' : ''}" data-r="${POS[p][1]}" data-s="${esc(f.seed || '')}" style="${esc(pic(f.url, f.seed))};left:${POS[p][0]}px;top:${POS[p][2]}px;transform:rotate(${POS[p][1]}deg)${p === 2 ? ';z-index:2' : ''}"></i>` : '')).join('');
  const list = (h, l) => `<div><h6>${esc(h)}</h6>${l.map((x) => `<div class="y-li${x.f ? ' y-f' : ''}"><span class="y-rk">${x.n}</span><span class="y-nm">${esc(x.t)}</span></div>`).join('')}</div>`;
  const avImg = !!c.av.url;
  return `<div class="y-card y-anim" style="${CARD_VARS[kind]}">
    <div class="y-ch"><img src="logo.png" alt=""><div><div class="y-t">MY ${y} IN ${WORD[kind]}</div><div class="y-s">Scrappy · JJsNAS</div></div></div>
    <div class="y-hero"><div class="y-fan3">${fan}</div><div class="y-per"><i class="${c.av.pp ? 'y-pp' : ''}" style="${esc(pic(c.av.url, c.av.seed))}">${avImg ? '' : esc(c.av.ini)}</i><b>${esc(c.av.name)}</b></div></div>
    <div class="y-two">${list(c.h1, c.L1)}${list(c.h2, c.L2)}</div>
    <div class="y-stats">${c.stats.map(([k, v]) => `<div><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>
  </div>`;
}

// ---------- Song snippets (Music only) ----------
// Two audio players crossfade: each slide's song starts about 40% in (the part people know)
// and plays while the slide is up. The sound switch is remembered.
const soundOn = () => { try { return localStorage.getItem('yirSound') !== 'off'; } catch { return true; } };
function snippets() {
  const { invoke } = window.__TAURI__.core;
  const A = [new Audio(), new Audio()], timers = new Map();
  let cur = 0, curId = '', on = soundOn(), held = false, gen = 0, now = null;
  const VOL = 0.85;
  const ramp = (a, to, ms, done) => {
    clearInterval(timers.get(a));
    const from = a.volume, t0 = performance.now();
    timers.set(a, setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      a.volume = Math.max(0, Math.min(1, from + (to - from) * p));
      if (p >= 1) { clearInterval(timers.get(a)); done?.(); }
    }, 30));
  };
  const live = () => A[cur];
  const start = (a) => { if (on && !held && a.src) a.play().then(() => ramp(a, VOL, 900)).catch(() => {}); };
  return {
    play(snd) {
      if (!snd || snd.id === curId) return;
      curId = snd.id; now = snd; const my = ++gen;
      const old = live(); cur = 1 - cur; const next = live();
      ramp(old, 0, 700, () => old.pause());
      invoke('nd_snippet_url', { id: snd.id, at: Math.floor((snd.d || 0) * 0.4) }).then((u) => {
        if (my !== gen) return;
        next.pause(); next.volume = 0; next.src = u; start(next);
      }).catch(() => {});
    },
    hold(h) { held = h; const a = live(); if (h) ramp(a, 0, 300, () => a.pause()); else start(a); },
    toggle() { on = !on; try { localStorage.setItem('yirSound', on ? 'on' : 'off'); } catch {} const a = live(); if (on) start(a); else ramp(a, 0, 300, () => a.pause()); return on; },
    get on() { return on; },
    get now() { return now; },
    stop() { gen++; A.forEach((a) => ramp(a, 0, 250, () => { a.pause(); a.removeAttribute('src'); a.load(); })); },
  };
}
/** Pause whatever Scrappy is playing while the review plays; returns a function that resumes it. */
async function hushMusic() {
  const { invoke } = window.__TAURI__.core;
  try {
    const [p, idle] = await Promise.all([invoke('music_get', { name: 'pause' }), invoke('music_get', { name: 'idle-active' })]);
    if (p !== false || idle !== false) return () => {};
    await invoke('music_command', { args: ['set', 'pause', 'yes'] });
    return () => invoke('music_command', { args: ['set', 'pause', 'no'] }).catch(() => {});
  } catch { return () => {}; }
}

let openNow = null;
/** Opens the Year in Review slideshow for `kind` ('abs', 'music' or 'tv') and `year`. */
export async function openYir(kind, year) {
  if (openNow) openNow.close();
  const tv = isTv(), D = tv ? 8000 : 7000;
  const el = document.createElement('div');
  el.className = 'yir';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', `Your ${year} Year in Review`);
  el.style.background = grad({ abs: 'AMB', music: 'RED', tv: 'BLUE' }[kind]);
  el.innerHTML = `<div class="y-decor" aria-hidden="true"><div class="y-o1"></div><div class="y-o2"></div>${SQUIGGLE}<div class="y-big">${year}</div>${CONFETTI}</div><div class="y-stage"><div class="y-wait">Getting your year ready…</div></div>`;
  document.body.appendChild(el);
  const prevFocus = document.activeElement;
  const stage = el.querySelector('.y-stage');
  const fit = () => { const k = Math.min(innerWidth / 1440, innerHeight / 900); stage.style.setProperty('--k', String(k)); };
  fit(); addEventListener('resize', fit);
  let m;
  try { m = await model(kind, year); } catch (e) { m = { err: String(e.message || e) }; }
  if (!el.isConnected) return;
  if (!m || m.err) { stage.innerHTML = `<div class="y-wait">Nothing to show for ${year} yet.<button type="button" class="y-btn y-g" data-a="close">Close</button></div>`; }
  const L = m?.slides || [];
  const snd = kind === 'music' && L.some((x) => x.snd) ? snippets() : null;
  const unhush = snd ? await hushMusic() : () => {};
  if (!el.isConnected) { unhush(); return; }
  let i = 0, paused = false, to = 0, left = D, t0 = 0, raf = 0;
  const arm = (ms) => { clearTimeout(to); left = ms; t0 = Date.now(); to = setTimeout(() => { if (!paused && i < L.length - 1) go(i + 1); }, ms); };
  const draw = () => {
    const s = L[i], sum = s.t === 'sum';
    el.style.background = grad(s.bg);
    el.querySelector('.y-big').textContent = s.t === 'list' || s.t === 'hero' ? '#1' : String(year);
    const left = sum ? `<div>
        <div class="y-k y-anim">That's a wrap</div>
        <div class="y-mid y-anim">YOUR ${year}<br>IN ${WORD[kind]}</div>
        <div class="y-lede y-anim2">${tv ? 'Watch it again, or head back.' : 'Save this card to share it, or watch the whole thing again.'}</div>
        ${flav(s.q)}
        <div class="y-acts y-anim3">
          ${tv ? '' : `<button type="button" class="y-btn" data-a="save">${SVG.save}Save as image</button>`}
          <button type="button" class="y-btn${tv ? '' : ' y-g'}" data-a="again">Watch again</button>
          <button type="button" class="y-btn y-g" data-a="close">${tv ? 'Done' : 'Back to stats'}</button>
          ${tv ? '<div class="y-tvnote">Want to keep this card? Open Year in Review on your PC and press Save as image.</div>' : ''}
        </div></div>` : '';
    const big = s.t === 'big' || s.t === 'wall';
    stage.innerHTML = `<div class="y-bars">${L.map((_, j) => `<i class="${j < i ? 'y-done' : j === i ? 'y-cur' + (paused ? ' y-hold' : '') : ''}"></i>`).join('')}</div>
      <div class="y-shead"><span class="y-lab">${NAMES[kind]} · YOUR ${year} YEAR IN REVIEW</span><span class="y-sp"></span>
        ${snd ? `<button type="button" class="y-ib" data-a="snd" aria-label="${snd.on ? 'Turn sound off' : 'Turn sound on'}"${tv ? ' tabindex="-1"' : ''}>${snd.on ? SVG.snd : SVG.mute}</button>` : ''}
        <button type="button" class="y-ib" data-a="pause" aria-label="${paused ? 'Play' : 'Pause'}"${tv ? ' tabindex="-1"' : ''}>${paused ? SVG.play : SVG.pause}</button>
        <button type="button" class="y-ib" data-a="close" aria-label="Close"${tv ? ' tabindex="-1"' : ''}>${SVG.close}</button></div>
      ${sum ? `<div class="y-slide">${cardHtml(kind, year, m.card)}${left}</div>` : `<div class="y-slide"><div>
        ${s.logo ? '<img class="y-logo y-anim" src="logo.png" alt="">' : ''}
        <div class="y-k y-anim">${esc(s.k)}</div>
        <div class="${big ? 'y-huge' : 'y-mid' + midCls(s.v)} y-anim" style="white-space:pre-line"${big && /^[\d,]+/.test(s.v) ? ` data-n="${esc(s.v)}"` : ''}>${esc(s.v)}</div>
        ${s.a ? `<div class="y-lede y-anim2">${esc(s.a)}</div>` : ''}
        ${s.b ? `<div class="y-sub y-anim3">${esc(s.b)}</div>` : ''}
        ${s.badge ? `<div class="y-badge y-anim3">${esc(s.badge)}</div>` : ''}
        ${s.tag ? `<div><span class="y-tag">${esc(s.tag)}</span></div>` : ''}
        ${flav(s.q)}
      </div><div class="y-R">${right(s)}</div></div>`}
      <button type="button" class="y-nav y-l" data-a="prev" aria-label="Previous"${i === 0 ? ' hidden' : ''}>${SVG.prev}</button>
      <button type="button" class="y-nav y-r" data-a="next" aria-label="Next">${SVG.next}</button>
      <div class="y-foot">${tv ? `<span><b>◀ ▶</b>Move</span><span><b>OK</b>${sum ? 'Select' : paused ? 'Play' : 'Pause'}</span><span><b>Back</b>Close</span>` : `<span>Moves on by itself every 7 seconds.</span><span style="flex:1"></span><span><kbd>←</kbd><kbd>→</kbd> move</span><span><kbd>Space</kbd> pause</span><span><kbd>Esc</kbd> close</span>`}</div>`;
    stage.style.setProperty('--dur', D + 'ms');
    if (snd) {
      snd.play(s.snd);
      const np = snd.now;
      if (np && !sum) stage.querySelector('.y-sp')?.insertAdjacentHTML('beforebegin', `<div class="y-np${snd.on ? '' : ' off'}" aria-hidden="true"><span class="y-eq"><i></i><i></i><i></i></span><b>${esc(np.ti)}</b><span>${esc(np.ar || '')}</span></div>`);
    }
    // Big numbers count up.
    const n = stage.querySelector('[data-n]');
    cancelAnimationFrame(raf);
    if (n) { const mm = n.dataset.n.match(/^([\d,]+)(.*)$/s), to = Number(mm[1].replace(/,/g, '')), st = performance.now(); const tick = (now) => { const p = Math.min(1, (now - st) / 900), e = 1 - Math.pow(1 - p, 3); n.textContent = Math.round(to * e).toLocaleString() + mm[2]; if (p < 1) raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); }
    if (sum && tv) stage.querySelector('[data-a="again"]')?.focus();
  };
  const go = (j) => { i = Math.max(0, Math.min(L.length - 1, j)); draw(); if (!paused) arm(D); else left = D; };
  const togglePause = () => {
    paused = !paused;
    if (paused) { clearTimeout(to); left = Math.max(300, left - (Date.now() - t0)); } else arm(left || D);
    snd?.hold(paused);
    stage.querySelector('.y-cur')?.classList.toggle('y-hold', paused);
    const b = stage.querySelector('[data-a="pause"]'); if (b) { b.innerHTML = paused ? SVG.play : SVG.pause; b.setAttribute('aria-label', paused ? 'Play' : 'Pause'); }
    if (tv && L[i]?.t !== 'sum') { const f = stage.querySelectorAll('.y-foot b')[1]; if (f) f.nextSibling.textContent = paused ? 'Play' : 'Pause'; }
  };
  const close = () => {
    clearTimeout(to); cancelAnimationFrame(raf);
    snd?.stop(); unhush();
    removeEventListener('keydown', onKey, true); removeEventListener('keyup', onKeyUp, true); removeEventListener('resize', fit);
    el.classList.add('out'); setTimeout(() => el.remove(), 250);
    openNow = null;
    try { prevFocus?.focus?.(); } catch {}
  };
  const act = (a, btn) => {
    if (a === 'close') close();
    else if (a === 'pause') togglePause();
    else if (a === 'prev') go(i - 1);
    else if (a === 'next') { if (i >= L.length - 1) close(); else go(i + 1); }
    else if (a === 'again') { if (paused) snd?.hold(false); paused = false; go(0); }
    else if (a === 'snd' && snd) { const o = snd.toggle(); stage.querySelector('.y-np')?.classList.toggle('off', !o); btn.innerHTML = o ? SVG.snd : SVG.mute; btn.setAttribute('aria-label', o ? 'Turn sound off' : 'Turn sound on'); }
    else if (a === 'save') saveCard(kind, year, m.card, btn);
  };
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (!b) return; act(b.dataset.a, b); if (!tv) b.blur(); });
  // Keys: listen first (capture) so the TV's own D-pad handling and Backspace-to-go-back don't also run.
  const onKey = (e) => {
    if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'BrowserBack') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (!L.length) return;
    const sum = L[i].t === 'sum';
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); if (i < L.length - 1) go(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(i - 1); }
    else if (e.key === ' ' || e.key === 'MediaPlayPause') { e.preventDefault(); e.stopPropagation(); if (!sum) togglePause(); }
    else if (e.key === 'Enter' && tv && !sum) { e.preventDefault(); e.stopPropagation(); togglePause(); }
    else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !sum) { e.preventDefault(); e.stopPropagation(); }
  };
  const onKeyUp = (e) => { if (e.key === ' ') e.preventDefault(); };
  addEventListener('keydown', onKey, true); addEventListener('keyup', onKeyUp, true);
  openNow = { close };
  if (L.length) { el.focus?.(); go(0); }
}

// ---------- Save as image ----------
// Draws the summary card onto a canvas at 2.5x (1000 x 1725) using the card's own
// layout on screen, then saves a PNG in Pictures\Scrappy.
const loadImg = (src) => new Promise((ok) => { if (!src) return ok(null); const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });
const urlOf = (el) => (el.getAttribute('style') || '').match(/url\('([^']+)'\)/)?.[1] || '';
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function cover(ctx, im, x, y, w, h, seed) {
  if (im) { const s = Math.max(w / im.width, h / im.height), sw = w / s, sh = h / s; ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, x, y, w, h); return; }
  const g = ctx.createLinearGradient(x, y, x + w, y + h); const hh = hue(seed); g.addColorStop(0, `hsl(${hh} 50% 42%)`); g.addColorStop(1, `hsl(${hh} 55% 16%)`); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
}
function fitText(ctx, t, w) { if (ctx.measureText(t).width <= w) return t; while (t.length > 1 && ctx.measureText(t + '…').width > w) t = t.slice(0, -1); return t.trimEnd() + '…'; }

async function cardPng(kind, cardEl) {
  await Promise.all(['24px "Luckiest Guy"', '800 14px Inter', '700 14px Inter', '600 14px Inter', '400 12px Inter'].map((f) => document.fonts.load(f).catch(() => {})));
  const W = 400, H = 690, S = 2.5;
  const box = cardEl.getBoundingClientRect(), k = box.width / W;
  const at = (el) => { const r = el.getBoundingClientRect(); return { x: (r.left - box.left) / k, y: (r.top - box.top) / k, w: r.width / k, h: r.height / k }; };
  const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S;
  const ctx = cv.getContext('2d'); ctx.scale(S, S);
  const [acc, glow] = ACC[kind];
  // Background, glow and border
  rr(ctx, 0, 0, W, H, 26); ctx.save(); ctx.clip();
  const ang = (170 - 90) * Math.PI / 180, dx = Math.cos(ang) * H / 2, dy = Math.sin(ang) * H / 2;
  const bg = ctx.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy); bg.addColorStop(0, '#241614'); bg.addColorStop(1, '#140D0C'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(W * 0.85, -H * 0.1); ctx.scale(1, 260 / 420); const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 420); rg.addColorStop(0, glow); rg.addColorStop(0.7, 'rgba(0,0,0,0)'); ctx.fillStyle = rg; ctx.fillRect(-420, -420, 840, 840); ctx.restore();
  ctx.restore(); rr(ctx, 0.5, 0.5, W - 1, H - 1, 26); ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1; ctx.stroke();
  const text = (el, font, color, align = 'left') => { const r = at(el); ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; const t = fitText(ctx, el.textContent, r.w + 1); ctx.fillText(t, align === 'center' ? r.x + r.w / 2 : r.x, r.y + r.h / 2 + 1); };
  // Header
  const logo = await loadImg(cardEl.querySelector('.y-ch img').src); const lr = at(cardEl.querySelector('.y-ch img'));
  if (logo) { const s = Math.min(lr.w / logo.width, lr.h / logo.height); ctx.drawImage(logo, lr.x + (lr.w - logo.width * s) / 2, lr.y + (lr.h - logo.height * s) / 2, logo.width * s, logo.height * s); }
  text(cardEl.querySelector('.y-ch .y-t'), '24px "Luckiest Guy"', '#F6E9E9');
  text(cardEl.querySelector('.y-ch .y-s'), '400 12px Inter', '#BFA7A8');
  // Fanned covers (drawn in page order so #1 ends on top)
  for (const c of cardEl.querySelectorAll('.y-fan3 i')) {
    const r = at(c), w = c.offsetWidth, h = c.offsetHeight, im = await loadImg(urlOf(c));
    ctx.save(); ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.rotate(Number(c.dataset.r || 0) * Math.PI / 180);
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 12; rr(ctx, -w / 2, -h / 2, w, h, 10); ctx.fillStyle = '#000'; ctx.fill();
    ctx.shadowColor = 'transparent'; rr(ctx, -w / 2, -h / 2, w, h, 10); ctx.clip(); cover(ctx, im, -w / 2, -h / 2, w, h, c.dataset.s || '');
    ctx.restore();
  }
  // Author / artist / movie
  const av = cardEl.querySelector('.y-per i'), ar = at(av), aim = await loadImg(urlOf(av)), pp = av.classList.contains('y-pp');
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 12;
  if (pp) rr(ctx, ar.x - 3, ar.y - 3, ar.w + 6, ar.h + 6, 11); else { ctx.beginPath(); ctx.arc(ar.x + ar.w / 2, ar.y + ar.h / 2, ar.w / 2 + 3, 0, Math.PI * 2); }
  ctx.fillStyle = acc; ctx.fill(); ctx.restore();
  ctx.save(); if (pp) rr(ctx, ar.x, ar.y, ar.w, ar.h, 8); else { ctx.beginPath(); ctx.arc(ar.x + ar.w / 2, ar.y + ar.h / 2, ar.w / 2, 0, Math.PI * 2); } ctx.clip();
  cover(ctx, aim, ar.x, ar.y, ar.w, ar.h, cardEl.querySelector('.y-per b').textContent); ctx.restore();
  if (!aim && av.textContent) { ctx.font = `${pp ? 16 : 30}px "Luckiest Guy"`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(av.textContent, ar.x + ar.w / 2, ar.y + ar.h / 2 + 2); }
  // Name under the picture (wraps like the card)
  const nb = cardEl.querySelector('.y-per b'), nr = at(nb); ctx.font = '700 14px Inter'; ctx.fillStyle = '#F6E9E9'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const lines = []; let ln = ''; nb.textContent.split(' ').forEach((w) => { const t = ln ? ln + ' ' + w : w; if (ctx.measureText(t).width > nr.w && ln) { lines.push(ln); ln = w; } else ln = t; }); if (ln) lines.push(ln);
  lines.slice(0, 3).forEach((l, j) => ctx.fillText(fitText(ctx, l, nr.w), nr.x + nr.w / 2, nr.y + j * 17.5 + 1));
  // Lists
  cardEl.querySelectorAll('.y-two h6').forEach((h) => { const r = at(h); ctx.font = '800 10px Inter'; ctx.fillStyle = acc; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; if ('letterSpacing' in ctx) ctx.letterSpacing = '1.8px'; ctx.fillText(h.textContent, r.x, r.y + r.h / 2); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; });
  cardEl.querySelectorAll('.y-li').forEach((li) => { text(li.querySelector('.y-rk'), '700 12px Inter', '#8F7778'); const f = li.classList.contains('y-f'); text(li.querySelector('.y-nm'), `${f ? 800 : 600} 14px Inter`, f ? '#fff' : '#F6E9E9'); });
  // Stats with divider lines
  const sg = at(cardEl.querySelector('.y-stats')); ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(sg.x, sg.y, sg.w, 1);
  cardEl.querySelectorAll('.y-stats > div').forEach((d, j) => { if (j >= 2) { const r = at(d); ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(r.x, r.y, r.w, 1); } text(d.querySelector('b'), '30px "Luckiest Guy"', acc); ctx.save(); if ('letterSpacing' in ctx) ctx.letterSpacing = '1.2px'; text(d.querySelector('span'), '700 11px Inter', '#BFA7A8'); ctx.restore(); });
  return new Promise((ok, bad) => cv.toBlob((b) => (b ? ok(b) : bad(new Error('Could not make the picture'))), 'image/png'));
}
async function saveCard(kind, year, card, btn) {
  const cardEl = btn.closest('.y-slide')?.querySelector('.y-card'); if (!cardEl) return;
  const label = btn.innerHTML; btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const blob = await cardPng(kind, cardEl);
    const data = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const { invoke } = window.__TAURI__.core;
    await invoke('save_png', { name: `Scrappy ${year} ${WORD[kind].replace(/ & /, ' and ')} Year in Review`, data });
    btn.textContent = 'Saved to Pictures › Scrappy';
  } catch (e) {
    btn.textContent = "Couldn't save: " + String(e.message || e).slice(0, 60);
  }
  setTimeout(() => { if (btn.isConnected) { btn.innerHTML = label; btn.disabled = false; } }, 3500);
}
