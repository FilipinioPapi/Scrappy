// Music screens, part 2: Genres, a genre's page, Playlists and a playlist's page.
import { esc, toast, loadingHtml } from './components.js';
import { api } from './api.js';
import { music, current, playSongs, setFavorite, cover, fmt, IC } from './mplayer.js';
import {
  EXTRA, nd, ndLoad, coverHtml, songTable, songRow, wireSongs, albumCard, artistCard, row, wireCards, wireMoods, moodTile,
  bump, listMenu, refreshPlaylists, totalTime, plural, hue, genreHue, href, MI, ready, lib, saveLib, syncNow, variety,
} from './music.js';

const line = (d, n = 18) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const PEN = line('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>');
const shuffleArr = (a) => a.slice().sort(() => Math.random() - 0.5);
const IMG = line('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>', 24);

// ---------- Playlist art ----------
// Shrinks big pictures before sending. PNG stays PNG so see-through art keeps its transparency.
async function prepImage(file) {
  const png = /png|gif|webp/.test(file.type);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej('That file is not a picture Scrappy can read.'); i.src = URL.createObjectURL(file); });
  const max = 1200, k = Math.min(1, max / Math.max(img.width, img.height));
  if (k === 1 && file.size < 4e6) return { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name || 'cover.png' };
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.9));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), name: png ? 'cover.png' : 'cover.jpg' };
}
// Navidrome's web session can run out; then we ask for the password once and try again.
export async function withNdSession(run, why = 'Changing playlist art uses Navidrome\'s own sign-in. Scrappy doesn\'t keep your password.') {
  try { return await run(); } catch (e) {
    if (String(e) !== 'ND_NATIVE_EXPIRED') throw e;
    const { dialog } = await import('./menu.js');
    const ok = await new Promise((resolve) => {
      const d = dialog('Confirm your Navidrome password', why,
        '<label class="fld"><span>Password</span><input type="password" id="ndpw" autocomplete="current-password"></label><div class="t2" id="ndpwErr"></div>',
        '<button type="button" class="btn secondary" id="ndpwNo">Cancel</button><button type="button" class="btn" id="ndpwGo">Continue</button>');
      const go = async () => { const b = d.$('#ndpwGo'); b.disabled = true; try { await api.ndReauth(d.$('#ndpw').value); d.close(); resolve(true); } catch (err) { d.$('#ndpwErr').textContent = String(err); b.disabled = false; } };
      d.$('#ndpwGo').onclick = go; d.$('#ndpw').onkeydown = (e) => { if (e.key === 'Enter') go(); };
      d.$('#ndpwNo').onclick = () => { d.close(); resolve(false); };
      setTimeout(() => d.$('#ndpw').focus(), 50);
    });
    if (!ok) throw new Error('cancelled');
    return run();
  }
}
async function changePlaylistArt(id, remove = false) {
  let payload = null;
  if (!remove) {
    const file = await new Promise((res) => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp,image/gif'; inp.onchange = () => res(inp.files[0] || null); inp.click(); });
    if (!file) return false;
    payload = await prepImage(file);
  }
  try {
    await withNdSession(() => api.ndPlaylistImage(id, payload ? Array.from(payload.bytes) : null, payload ? payload.name : null));
    toast(remove ? 'Playlist art reset.' : 'Playlist art updated.');
    await refreshPlaylists();
    return true;
  } catch (e) { if (String(e?.message || e) !== 'cancelled') toast(String(e?.message || e), true); return false; }
}

// ---------- Genres ----------
EXTRA.genres = async (v) => {
  const { main, alive } = v;
  await ndLoad('getGenres', {}, (r) => {
    const gs = (r.genres?.genre || []).filter((g) => g.songCount).sort((a, b) => b.songCount - a.songCount);
    main.innerHTML = `<div class="mpage-h"><div><h1 class="disp">Genres</h1><div class="t2 cnt">${plural(gs.length, 'genre')}</div></div>
      <label class="msearch" style="margin-left:auto">${MI.search}<input type="search" id="gFind" placeholder="Filter genres" spellcheck="false"></label></div>
      <div class="gtiles" id="gTiles"></div>`;
    const box = main.querySelector('#gTiles');
    const draw = (f = '') => {
      f = f.trim().toLowerCase();
      box.innerHTML = gs.filter((g) => !f || g.value.toLowerCase().includes(f)).map((g) => `<a class="gtile" href="#/music/genre/${encodeURIComponent(g.value)}" style="--h:${genreHue(g.value)}" data-g="${esc(g.value)}">
        <div class="shine"></div><div class="nm">${esc(g.value)}</div><div class="ct">${plural(g.songCount, 'song')} · ${plural(g.albumCount, 'album')}</div><div class="fan"></div></a>`).join('') || '<div class="empty">No genres match.</div>';
      box.querySelectorAll('.gtile').forEach((t) => io.observe(t));
    };
    // Two album covers fanned out on each tile, loaded as tiles come into view.
    const io = new IntersectionObserver((ents) => ents.forEach((en) => {
      if (!en.isIntersecting) return; io.unobserve(en.target);
      nd('getAlbumList2', { type: 'byGenre', genre: en.target.dataset.g, size: 2 }).then((x) => {
        const as = x.albumList2?.album || [];
        en.target.querySelector('.fan').innerHTML = as.map((a) => `<span style="background-image:url('${cover(a.coverArt, 160)}')"></span>`).join('');
      }).catch(() => {});
    }), { rootMargin: '300px' });
    v.ctx.onLeave(() => io.disconnect());
    draw();
    main.querySelector('#gFind').addEventListener('input', (e) => draw(e.target.value));
    ready();
  }, alive);
};

EXTRA.genre = async (v, name) => {
  const { main, alive } = v;
  const [sr, ar] = await Promise.all([nd('getSongsByGenre', { genre: name, count: 500 }), nd('getAlbumList2', { type: 'byGenre', genre: name, size: 500 })]);
  if (!alive()) return;
  const songs = sr.songsByGenre?.song || [];
  const albums = ar.albumList2?.album || [];
  const artistMap = new Map();
  songs.forEach((s) => { if (!s.artistId) return; const a = artistMap.get(s.artistId) || { id: s.artistId, name: s.artist, coverArt: 'ar-' + s.artistId, plays: 0, n: 0 }; a.plays += s.playCount || 0; a.n++; artistMap.set(s.artistId, a); });
  const artists = [...artistMap.values()].sort((a, b) => b.plays - a.plays || b.n - a.n);
  const years = albums.map((a) => a.year).filter(Boolean);
  const total = songs.reduce((n, s) => n + (s.duration || 0), 0);
  const from = { type: 'genre', id: name, name };
  const deep = songs.filter((s) => (s.playCount || 0) <= 1);
  const recentCut = Date.now() - 1000 * 60 * 60 * 24 * 120;
  const fresh = songs.filter((s) => s.created && Date.parse(s.created) > recentCut);
  const essentials = songs.slice().sort((a, b) => (b.playCount || 0) - (a.playCount || 0)).slice(0, 9);
  const mixes = [
    { k: 'all', n: `${name} Mix`, d: `A spread of ${name} from across your library`, s: variety(shuffleArr(songs), 3, 40).slice(0, 80), cls: 'm1' },
    { k: 'deep', n: 'Deep Cuts', d: 'The ones you rarely play', s: variety(shuffleArr(deep), 2).slice(0, 60), cls: 'm2' },
    { k: 'fresh', n: 'Fresh Finds', d: 'Added in the last few months', s: variety(shuffleArr(fresh), 4).slice(0, 60), cls: 'm3' },
  ].filter((m) => m.s.length);
  const decades = {};
  albums.forEach((a) => { if (!a.year) return; const d = Math.floor(a.year / 10) * 10; (decades[d] = decades[d] || []).push(a); });
  main.innerHTML = `
    <div class="ghero" style="--h:${genreHue(name)}">
      <div class="ghero-in"><a class="back-pill" href="#/music/genres">${MI.back}<span>All genres</span></a>
        <div class="kicker">GENRE</div><h1 class="disp mtitle">${esc(name)}</h1>
        <div class="meta">${[plural(songs.length, 'song'), plural(albums.length, 'album'), plural(artists.length, 'artist'), totalTime(total), years.length ? `${Math.min(...years)}–${Math.max(...years)}` : ''].filter(Boolean).join(' · ')}</div>
        <div class="mbtns"><button type="button" class="arplay" id="gPlay" aria-label="Play" data-playctx="genre:${esc(name)}">${IC.play}</button><button type="button" class="gb sq" id="gShuf" aria-label="Shuffle">${IC.shuffle}</button></div></div>
      <div class="mosaic">${albums.slice(0, 4).map((a, i) => `<a href="${href('album', a.id)}" class="mo mo${i}">${coverHtml(a.coverArt, a.name, 300)}</a>`).join('')}</div>
    </div>
    ${mixes.length ? `<section class="msec"><h2>Made for you from your library</h2><div class="gmixes">${mixes.map((m) => `<button type="button" class="gmix ${m.cls}" data-mix="${m.k}" style="--h:${genreHue(name)}">
      <span class="stack">${shuffleArr(m.s).slice(0, 3).map((s) => coverHtml(s.coverArt, '', 160)).join('')}</span>
      <span class="gm-txt"><span class="disp">${esc(m.n)}</span><span class="d">${esc(m.d)}</span><b>${plural(m.s.length, 'song')}</b></span></button>`).join('')}</div></section>` : ''}
    ${essentials.length ? `<section class="msec"><h2>Essentials</h2><div class="ess" id="gEss">${essentials.map((s, i) => `<div class="srow ess-it" data-i="${i}" data-id="${esc(s.id)}">${coverHtml(s.coverArt, '', 100, 'sm')}<span class="c-n" style="display:none"></span><span class="tt"><span class="t1">${esc(s.title)}</span><span class="t2">${esc(s.artist || '')}</span></span><span class="t2 c-l">${fmt(s.duration)}</span></div>`).join('')}</div></section>` : ''}
    ${artists.length ? row('Top artists', artists.slice(0, 16).map((a) => artistCard({ ...a, albumCount: null })).join('')) : ''}
    ${Object.keys(decades).sort((a, b) => b - a).map((d) => row(`Albums from the ${String(d).slice(2)}s`.replace('the 00s', 'the 2000s'), decades[d].map((a) => albumCard(a)).join(''))).join('')}
    ${row('Recently added', albums.slice().sort((a, b) => (b.created || '').localeCompare(a.created || '')).slice(0, 16).map((a) => albumCard(a)).join(''))}
    <div id="gRel"></div>`;
  wireCards(main);
  main.querySelector('#gPlay').onclick = () => playSongs(songs, 0, { from, shuffle: true });
  main.querySelector('#gShuf').onclick = () => playSongs(songs, 0, { from, shuffle: true });
  main.querySelectorAll('[data-mix]').forEach((b) => (b.onclick = () => { const m = mixes.find((x) => x.k === b.dataset.mix); playSongs(m.s, 0, { from: { type: 'genremix', id: name + m.k, name: m.n }, shuffle: false }); }));
  const ess = main.querySelector('#gEss');
  if (ess) { ess.addEventListener('click', (e) => { const r = e.target.closest('[data-i]'); if (r) playSongs(essentials, +r.dataset.i, { from, shuffle: false }); }); }
  // Related genres: others that share artists with this one.
  nd('getGenres').then(async (g) => {
    const others = (g.genres?.genre || []).filter((x) => x.value !== name && x.songCount).sort((a, b) => b.songCount - a.songCount).slice(0, 12);
    const ids = new Set(artists.map((a) => a.id));
    const scored = await Promise.all(others.map(async (o) => { try { const x = await nd('getAlbumList2', { type: 'byGenre', genre: o.value, size: 60 }); return { o, n: (x.albumList2?.album || []).filter((a) => ids.has(a.artistId)).length }; } catch { return { o, n: 0 }; } }));
    const rel = scored.sort((a, b) => b.n - a.n).slice(0, 4).map((x) => x.o);
    if (alive() && rel.length) { const el = main.querySelector('#gRel'); el.innerHTML = `<section class="msec"><h2>Related genres</h2><div class="moods">${rel.map(moodTile).join('')}</div></section>`; wireMoods(el); }
  }).catch(() => {});
  syncNow(); ready();
};

// ---------- Playlists ----------
const AUTO = [
  { id: 'auto:fav', name: 'Favorite songs', blurb: 'Every song you added to Favorites' },
  { id: 'auto:most', name: 'Most played', blurb: 'Your top songs by plays' },
  { id: 'auto:new', name: 'Recently added', blurb: 'Songs from your newest albums' },
];
async function autoSongs(id) {
  if (id === 'auto:fav') return (await nd('getStarred2')).starred2?.song || [];
  if (id === 'auto:most') {
    const r = await nd('getAlbumList2', { type: 'frequent', size: 30 });
    const all = (await Promise.all((r.albumList2?.album || []).map((a) => nd('getAlbum', { id: a.id }).then((x) => x.album.song || []).catch(() => [])))).flat();
    return all.filter((s) => s.playCount).sort((a, b) => b.playCount - a.playCount).slice(0, 100);
  }
  const r = await nd('getAlbumList2', { type: 'newest', size: 12 });
  return (await Promise.all((r.albumList2?.album || []).map((a) => nd('getAlbum', { id: a.id }).then((x) => x.album.song || []).catch(() => [])))).flat();
}

EXTRA.playlists = async (v) => {
  const { main, alive } = v;
  let sort = localStorage.getItem('mplsort') || 'updated';
  await ndLoad('getPlaylists', {}, (r) => {
    const lists = r.playlists?.playlist || [];
    const draw = () => {
      const pins = lib.hpins || [];
      const sorted = lists.slice().sort((a, b) => sort === 'az' ? a.name.localeCompare(b.name) : sort === 'songs' ? b.songCount - a.songCount : (b.changed || '').localeCompare(a.changed || ''));
      sorted.sort((a, b) => (pins.includes(b.id) ? 1 : 0) - (pins.includes(a.id) ? 1 : 0) || (pins.includes(a.id) ? pins.indexOf(a.id) - pins.indexOf(b.id) : 0));
      const before = new Map(); main.querySelectorAll('#plGrid [data-pk]').forEach((el) => before.set(el.dataset.pk, el.getBoundingClientRect()));
      main.innerHTML = `<div class="mpage-h"><div><h1 class="disp">Playlists</h1><div class="t2 cnt">${plural(lists.length, 'playlist')}</div></div>
        <div class="seg" style="margin-left:auto">${[['updated', 'Recently updated'], ['az', 'A–Z'], ['songs', 'Most songs']].map(([k, l]) => `<a href="#" data-sort="${k}" class="${sort === k ? 'on' : ''}">${l}</a>`).join('')}</div></div>
        <div class="mgrid plgrid" id="plGrid">
          <button type="button" class="mcard newpl" id="plNew"><div class="mcard-art"><div class="mcv newtile"><i>${MI.plus}</i></div></div><div class="t1">New playlist</div><div class="t2">Start from scratch</div></button>
          ${sorted.map((p) => { const pinned = pins.includes(p.id); return `<a class="mcard plc${pinned ? ' pinned' : ''}" href="${href('playlist', p.id)}" data-pk="${esc(p.id)}">
            <div class="mcard-art">${coverHtml(p.coverArt, p.name, 300)}<button type="button" class="hoverplay" data-playpl="${esc(p.id)}" aria-label="Play">${IC.play}</button>
            <button type="button" class="plcpin" data-hpin="${esc(p.id)}" title="${pinned ? 'Unpin' : 'Pin to the top'}" aria-label="${pinned ? 'Unpin' : 'Pin to the top'}">${pinned ? MI.pinOn : MI.pin}</button></div>
            <div class="t1">${esc(p.name)}</div><div class="t2">${pinned ? `<span class="pinmark">${MI.pinOn}</span>` : ''}${plural(p.songCount, 'song')}</div></a>`; }).join('')}
        </div>
        <section class="msec"><div class="msec-h" style="justify-content:flex-start;gap:12px"><h2>Made automatically</h2><span class="badge-s">Updates by itself</span></div>
          <div class="t2" style="margin:-8px 0 16px">Built from your favorites and your listening</div>
          <div class="mgrid">${AUTO.map((a) => `<a class="mcard" href="${href('playlist', a.id)}"><div class="mcard-art"><div class="mcv auto" style="--h:${hue(a.name)}"><span>${esc(a.name)}</span></div><button type="button" class="hoverplay" data-playpl="${a.id}" aria-label="Play">${IC.play}</button></div><div class="t1">${esc(a.name)}</div><div class="t2">${esc(a.blurb)}</div></a>`).join('')}</div></section>`;
      // Slide cards to their new spots when pinning.
      main.querySelectorAll('#plGrid [data-pk]').forEach((el) => { const b = before.get(el.dataset.pk); if (!b) return; const a = el.getBoundingClientRect(); const dx = b.left - a.left, dy = b.top - a.top; if (dx || dy) el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' }); });
    };
    draw();
    main.onclick = async (e) => {
      const s = e.target.closest('[data-sort]'); if (s) { e.preventDefault(); sort = s.dataset.sort; localStorage.setItem('mplsort', sort); draw(); return; }
      const pin = e.target.closest('[data-hpin]'); if (pin) { e.preventDefault(); e.stopPropagation(); const id = pin.dataset.hpin; lib.hpins = (lib.hpins || []).includes(id) ? lib.hpins.filter((x) => x !== id) : [id, ...(lib.hpins || [])]; saveLib(); draw(); return; }
      const pl = e.target.closest('[data-playpl]'); if (pl) { e.preventDefault(); e.stopPropagation(); try { const { songs, name } = await loadPlaylist(pl.dataset.playpl); playSongs(songs, 0, { from: { type: 'playlist', id: pl.dataset.playpl, name }, shuffle: false }); } catch (err) { toast(String(err), true); } return; }
      if (e.target.closest('#plNew')) newPlaylist();
    };
    ready();
  }, alive);
};

export async function newPlaylist(songIds = []) {
  const name = prompt('Name your new playlist', 'New playlist');
  if (!name) return;
  try {
    const r = await nd('createPlaylist', `name=${encodeURIComponent(name)}${songIds.map((id) => '&songId=' + encodeURIComponent(id)).join('')}`);
    await refreshPlaylists();
    const id = r.playlist?.id || (await nd('getPlaylists')).playlists?.playlist?.find((p) => p.name === name)?.id;
    if (id) location.hash = href('playlist', id) + '?edit=1';
  } catch (e) { toast(String(e), true); }
}

async function loadPlaylist(id) {
  if (id.startsWith('auto:')) { const a = AUTO.find((x) => x.id === id); return { songs: await autoSongs(id), name: a.name, auto: a }; }
  const r = await nd('getPlaylist', { id });
  return { songs: r.playlist.entry || [], name: r.playlist.name, pl: r.playlist };
}

EXTRA.playlist = async (v, id) => {
  const { main, alive, params } = v;
  const { songs: loaded, pl, auto } = await loadPlaylist(id);
  if (!alive()) return;
  let songs = loaded.slice();
  const meta = pl || { name: auto.name, comment: auto.blurb, coverArt: '', readonly: true };
  const canEdit = !!pl && !pl.readonly;
  if (pl) bump({ k: 'pl:' + pl.id, t: pl.name, sub: `Playlist · ${plural(songs.length, 'song')}`, cv: pl.coverArt });
  let editing = false;
  const from = { type: 'playlist', id, name: meta.name };
  const ago = (iso) => { if (!iso) return ''; const d = (Date.now() - Date.parse(iso)) / 864e5; return d < 1 ? 'Updated today' : d < 2 ? 'Updated yesterday' : d < 8 ? 'Updated this week' : d < 15 ? 'Updated last week' : `Updated ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`; };
  main.innerHTML = `
    <div class="plwrap" id="plWrap"><div class="plpage">
    <div class="mhero" style="--h:${hue(meta.name)}"><div class="mhero-bg">${meta.coverArt ? `<img src="${cover(meta.coverArt, 600)}" alt="" onload="this.classList.add('in')" onerror="this.remove()">` : ''}</div>
      <div class="mhero-in">${canEdit ? `<button type="button" class="plcv" id="plCover" title="Change playlist art">${coverHtml(meta.coverArt, meta.name, 600, 'big')}<span class="ov">${IMG}<span>Change image</span></span></button>` : coverHtml(meta.coverArt, meta.name, 600, 'big')}
        <div style="min-width:0"><div class="kicker">${auto ? 'MADE AUTOMATICALLY' : 'PLAYLIST'}</div>
          <h1 class="disp mtitle" id="plName">${esc(meta.name)}</h1>
          <div class="pldesc" id="plDesc">${esc(meta.comment || '')}</div>
          <div class="meta" id="plMeta"></div></div></div></div>
    <div class="mbtns plbtns"><button type="button" class="arplay" id="plPlay" aria-label="Play" data-playctx="playlist:${esc(id)}">${IC.play}</button><button type="button" class="gb sq" id="plShuf" aria-label="Shuffle">${IC.shuffle}</button>
      ${canEdit ? `<button type="button" class="btn secondary sm" id="plEdit">${PEN}<span>Edit</span></button>` : ''}<button type="button" class="gb sq" id="plMore" aria-label="More">${IC.more}</button></div>
    <div class="stable pltable" id="plSongs"></div><div id="plRec"></div></div>
    <aside class="pldrawer" id="plDrawer" hidden></aside></div>`;
  const table = main.querySelector('#plSongs');
  const drawMeta = () => { const t = songs.reduce((n, s) => n + (s.duration || 0), 0); main.querySelector('#plMeta').innerHTML = [plural(songs.length, 'song'), totalTime(t), pl ? ago(pl.changed) : ''].filter(Boolean).map((x) => `<b>${esc(x)}</b>`).join('<i class="dot">•</i>'); };
  const drawTable = () => {
    table.classList.toggle('editing', editing);
    table.innerHTML = songTable(songs, { cols: ['cover', 'album', 'added'] }).replace(/class="srow"/g, 'class="srow" draggable="false"')
      + (songs.length ? '' : `<div class="empty plempty">${canEdit ? 'No songs yet. Press Edit to add some.' : 'Nothing here yet.'}</div>`);
    if (editing) table.querySelectorAll('.srow[data-i]').forEach((r) => { r.draggable = true; r.querySelector('.c-n').insertAdjacentHTML('afterbegin', `<span class="dgrip">${MI.grip}</span>`); r.querySelector('.c-m').innerHTML = `<button type="button" class="gb srm" title="Remove" aria-label="Remove">${MI.close}</button>`; });
    drawMeta(); syncNow();
  };
  drawTable();
  wireSongs(table, () => songs, from);
  main.querySelector('#plPlay').onclick = () => playSongs(songs, 0, { from, shuffle: false });
  main.querySelector('#plShuf').onclick = () => playSongs(songs, 0, { from, shuffle: true });
  const reloadPage = () => { if (alive()) EXTRA.playlist(v, id); };
  main.querySelector('#plCover')?.addEventListener('click', async () => { if (await changePlaylistArt(id)) reloadPage(); });
  main.querySelector('#plMore').onclick = (e) => listMenu(songs, e.currentTarget, canEdit ? [{ label: 'Change playlist art', icon: IMG.replace('width="24" height="24"', 'width="18" height="18"'), run: async () => { if (await changePlaylistArt(id)) reloadPage(); } }, { label: 'Reset playlist art', icon: MI.close, run: async () => { if (await changePlaylistArt(id, true)) reloadPage(); } }, { label: 'Delete playlist', icon: MI.close, cls: 'danger', run: async () => { if (!confirm(`Delete "${meta.name}"? This can't be undone.`)) return; try { await nd('deletePlaylist', { id }); lib.rec = lib.rec.filter((r) => r.k !== 'pl:' + id); saveLib(); await refreshPlaylists(); location.hash = '#/music/playlists'; } catch (err) { toast(String(err), true); } } }] : []);
  if (!canEdit) { syncNow(); ready(); return; }

  // ----- Edit mode: rename, reorder, remove with Undo, Add songs drawer -----
  let saveT;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(async () => {
    try { await nd('createPlaylist', `playlistId=${encodeURIComponent(id)}${songs.map((s) => '&songId=' + encodeURIComponent(s.id)).join('')}`); refreshPlaylists(); }
    catch (e) { toast(String(e), true); }
  }, 500); };
  const editBtn = main.querySelector('#plEdit');
  const nameEl = main.querySelector('#plName'), descEl = main.querySelector('#plDesc');
  const setEditing = (on) => {
    editing = on;
    editBtn.innerHTML = on ? `${MI.check}<span>Done</span>` : `${PEN}<span>Edit</span>`;
    editBtn.classList.toggle('on', on);
    nameEl.contentEditable = on ? 'plaintext-only' : 'false'; descEl.contentEditable = on ? 'plaintext-only' : 'false';
    nameEl.classList.toggle('editable', on); descEl.classList.toggle('editable', on);
    if (on && !descEl.textContent) descEl.dataset.ph = 'Add a description';
    main.querySelector('#plWrap').classList.toggle('drawer-open', on);
    const dr = main.querySelector('#plDrawer'); dr.hidden = !on;
    if (on) drawDrawer();
    drawTable();
  };
  editBtn.onclick = () => setEditing(!editing);
  const saveDetails = async () => {
    const name = nameEl.textContent.trim() || meta.name; const comment = descEl.textContent.trim();
    if (name === meta.name && comment === (meta.comment || '')) return;
    try { await nd('updatePlaylist', { playlistId: id, name, comment }); meta.name = name; meta.comment = comment; bump({ k: 'pl:' + id, t: name, sub: `Playlist · ${plural(songs.length, 'song')}`, cv: meta.coverArt }); refreshPlaylists(); }
    catch (e) { toast(String(e), true); }
  };
  nameEl.addEventListener('blur', saveDetails); descEl.addEventListener('blur', saveDetails);
  [nameEl, descEl].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } }));
  // Remove with Undo.
  table.addEventListener('click', (e) => {
    const rm = e.target.closest('.srm'); if (!rm) return; e.stopPropagation();
    const i = +rm.closest('[data-i]').dataset.i; const [gone] = songs.splice(i, 1);
    drawTable(); save();
    undoToast(`Removed "${gone.title}".`, () => { songs.splice(i, 0, gone); drawTable(); save(); });
  }, true);
  // Drag handles to reorder.
  let dragI = null;
  table.addEventListener('dragstart', (e) => { const r = e.target.closest('[data-i]'); if (!editing || !r) return; dragI = +r.dataset.i; r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
  table.addEventListener('dragover', (e) => { const r = e.target.closest('[data-i]'); if (dragI == null || !r) return; e.preventDefault(); table.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); r.classList.add('over'); });
  table.addEventListener('dragend', () => { dragI = null; table.querySelectorAll('.dragging,.over').forEach((x) => x.classList.remove('dragging', 'over')); });
  table.addEventListener('drop', (e) => { const r = e.target.closest('[data-i]'); if (dragI == null || !r) return; e.preventDefault(); const to = +r.dataset.i; const [s] = songs.splice(dragI, 1); songs.splice(to, 0, s); dragI = null; drawTable(); save(); });
  // Add songs drawer.
  function drawDrawer() {
    const dr = main.querySelector('#plDrawer');
    dr.innerHTML = `<div class="dr-h"><h3>Add songs</h3><button type="button" class="gb" id="drClose" aria-label="Close">${MI.close}</button></div>
      <label class="msearch">${MI.search}<input type="search" id="drFind" placeholder="Search your music" spellcheck="false"></label>
      <div class="kicker dr-k" id="drK">SUGGESTED</div><div id="drList" class="dr-list"><div class="t2">…</div></div>`;
    dr.querySelector('#drClose').onclick = () => setEditing(false);
    const list = dr.querySelector('#drList');
    let results = [];
    const show = (arr, label) => {
      results = arr; dr.querySelector('#drK').textContent = label;
      const have = new Set(songs.map((s) => s.id));
      list.innerHTML = arr.map((s, i) => `<div class="dr-it" data-di="${i}">${coverHtml(s.coverArt, '', 100, 'sm')}<div class="qt"><div class="t1">${esc(s.title)}</div><div class="t2">${esc(s.artist || '')} · ${esc(s.album || '')}</div></div><button type="button" class="gb dr-add${have.has(s.id) ? ' added' : ''}" aria-label="Add">${have.has(s.id) ? MI.check : MI.plus}</button></div>`).join('') || '<div class="t2">No songs found.</div>';
    };
    const suggest = async () => {
      const artistIds = [...new Set(songs.map((s) => s.artistId).filter(Boolean))].slice(0, 4);
      let pool = [];
      for (const a of artistIds) { try { const r = await nd('getTopSongs', { artist: songs.find((s) => s.artistId === a).artist, count: 8 }); pool.push(...(r.topSongs?.song || [])); } catch {} }
      if (pool.length < 10) { try { pool.push(...((await nd('getRandomSongs', { size: 20 })).randomSongs?.song || [])); } catch {} }
      const have = new Set(songs.map((s) => s.id));
      const seen = new Set();
      show(shuffleArr(pool.filter((s) => !have.has(s.id) && !seen.has(s.id) && seen.add(s.id))).slice(0, 20), 'SUGGESTED');
    };
    suggest();
    let t; dr.querySelector('#drFind').addEventListener('input', (e) => { clearTimeout(t); const qv = e.target.value.trim(); t = setTimeout(async () => {
      if (!qv) return suggest();
      try { const r = await nd('search3', { query: qv, songCount: 40, albumCount: 0, artistCount: 0 }); show(r.searchResult3?.song || [], `RESULTS FOR “${qv.toUpperCase()}”`); } catch (err) { toast(String(err), true); }
    }, 220); });
    list.onclick = (e) => {
      const b = e.target.closest('.dr-add'); if (!b || b.classList.contains('added')) return;
      const s = results[+b.closest('[data-di]').dataset.di];
      songs.push(s); b.classList.add('added', 'tap'); b.innerHTML = MI.check;
      drawTable(); save();
    };
  }
  // ----- Recommended songs: similar-vibe songs to add, 10 at a time -----
  const recBox = main.querySelector('#plRec');
  const REFRESH = line('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>', 15);
  let recPool = [], recOff = 0;
  const recShown = () => { const have = new Set(songs.map((x) => x.id)); return recPool.filter((x) => !have.has(x.id)); };
  const drawRec = (anim) => {
    const left = recShown();
    if (!left.length) { recBox.innerHTML = ''; return; }
    if (recOff >= left.length) recOff = 0;
    const pick = left.slice(recOff, recOff + 10);
    recBox.innerHTML = `<section class="plrec"><div class="plrec-h"><div><h2>Recommended songs</h2><div class="t2">${songs.length ? 'Based on what is in this playlist' : 'Your most played songs, to get you started'}</div></div>
      <button type="button" class="plrefresh" id="plRecRefresh">${REFRESH}<span>Refresh</span></button></div>
      <div class="plrec-l${anim ? ' swap' : ''}">${pick.map((x) => `<div class="plrec-it" data-id="${esc(x.id)}"><button type="button" class="plrec-cv" aria-label="Play">${coverHtml(x.coverArt, '', 100, 'sm')}<span class="pp">${IC.play}</span></button>
        <div class="qt"><div class="t1">${esc(x.title)}</div><div class="t2">${esc(x.artist || '')}</div></div><span class="t2 plrec-al">${esc(x.album || '')}</span><span class="t2 plrec-d">${fmt(x.duration || 0)}</span>
        <button type="button" class="plrec-add" title="Add to this playlist">${MI.plus}<span>Add</span></button></div>`).join('')}</div></section>`;
    recBox.querySelector('#plRecRefresh').onclick = () => { recOff += 10; if (recOff >= recShown().length) { recOff = 0; recPool = shuffleArr(recPool); } drawRec(true); };
  };
  recBox.addEventListener('click', (e) => {
    const it = e.target.closest('.plrec-it'); if (!it) return;
    const x = recPool.find((y) => y.id === it.dataset.id); if (!x) return;
    if (e.target.closest('.plrec-cv')) { playSongs([x], 0, { shuffle: false }); return; }
    if (!e.target.closest('.plrec-add')) return;
    it.classList.add('gone');
    setTimeout(() => { songs.push(x); drawTable(); save(); drawRec(false); toast(`Added "${x.title}".`); }, 260);
  });
  (async () => {
    const have = new Set(songs.map((x) => x.id)), score = new Map();
    const put = (arr, w) => (arr || []).forEach((x) => { if (x && x.id && !have.has(x.id)) score.set(x.id, { x, s: (score.get(x.id)?.s || 0) + w + Math.random() * 0.5 }); });
    const seeds = shuffleArr(songs).slice(0, 4);
    await Promise.all(seeds.map((x) => nd('getSimilarSongs2', { id: x.id, count: 15 }).then((r) => put(r.similarSongs2?.song, 3)).catch(() => {})));
    const artists = [...new Set(songs.map((x) => x.artist).filter(Boolean))].slice(0, 5);
    await Promise.all(artists.map((a) => nd('getTopSongs', { artist: a, count: 10 }).then((r) => put(r.topSongs?.song, 2)).catch(() => {})));
    const genres = Object.entries(songs.reduce((m, x) => (x.genre ? ((m[x.genre] = (m[x.genre] || 0) + 1), m) : m), {})).sort((a, b) => b[1] - a[1]).slice(0, 2).map((g) => g[0]);
    await Promise.all(genres.map((g) => nd('getSongsByGenre', { genre: g, count: 40 }).then((r) => put(shuffleArr(r.songsByGenre?.song || []).slice(0, 15), 1)).catch(() => {})));
    if (score.size < 10) await nd('getRandomSongs', { size: 30 }).then((r) => put(r.randomSongs?.song, 0)).catch(() => {});
    if (!alive()) return;
    recPool = variety([...score.values()].sort((a, b) => b.s - a.s).map((o) => o.x), 3, 30).slice(0, 50);
    drawRec(false);
  })();
  if (params.get('edit') === '1') setEditing(true);
  syncNow(); ready();
};

function undoToast(msg, undo) {
  const el = document.createElement('div');
  el.className = 'toast with-action';
  el.innerHTML = `<span>${esc(msg)}</span><button type="button">Undo</button>`;
  document.getElementById('toasts').appendChild(el);
  const t = setTimeout(() => el.remove(), 6000);
  el.querySelector('button').onclick = () => { clearTimeout(t); el.remove(); undo(); };
}
