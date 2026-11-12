import { api, load, quiet, img, imgAny, IMG_BASE } from './api.js';
import { esc, card, toast, runtime, epCode, loadingHtml, isPlayable, PLAY_ICON, seriesTarget, seriesPlayLabel, playItem } from './components.js';
import { pref } from './prefs.js';
import { homeRows, rowOff, cachedRow, lowPriority } from './homeedit.js';
import { genreLook } from './gtiles.js';
import { noteCollection } from './tvside.js';

const FIELDS = 'PrimaryImageAspectRatio,ProductionYear,EndDate,BasicSyncInfo';
const IMG_OPTS = 'ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Thumb';

// ---------------- Sign in: one panel for all three servers ----------------

const SERVERS = [
  { kind: 'emby', name: 'Emby', what: 'Movies & TV', eg: '192.168.1.20:8096',
    icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M3 15h18M8 5v4M16 5v4M8 15v4M16 15v4"/>' },
  { kind: 'navidrome', name: 'Navidrome', what: 'Music', eg: '192.168.1.20:4533',
    icon: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>' },
  { kind: 'audiobookshelf', name: 'Audiobookshelf', what: 'Audiobooks', eg: '192.168.1.20:13378',
    icon: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>' },
];
const SPIN = '<svg class="spin" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 3a9 9 0 1 1-9 9"/></svg>';
const svgLine = (d, n = 20) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

// Where to go once signed in: the first tab whose server is signed in.
export function firstTab(session) {
  const s = session?.servers || {};
  if (s.emby?.signedIn) return '#/home';
  if (s.navidrome?.signedIn) return '#/music';
  if (s.audiobookshelf?.signedIn) return '#/audiobooks';
  return '#/login';
}

// "Same username and password as Emby?": the account you just signed in with, kept in memory
// only while you set up the next server. Scrappy never saves passwords.
let reuse = null;
let embyPic = null;
async function embyFace() {
  if (embyPic !== null) return embyPic;
  try { const u = await api.get('/Users/{userId}'); embyPic = u?.PrimaryImageTag ? `${IMG_BASE}/user/${encodeURIComponent(u.Id)}?tag=${encodeURIComponent(u.PrimaryImageTag)}&w=96` : ''; }
  catch { embyPic = ''; }
  return embyPic;
}

addEventListener('hashchange', () => { if (!/^#\/(login|servers)/.test(location.hash)) reuse = null; });

export function loginView(root, ctx, pick = '') {
  embyPic = null;
  let session = ctx.session || {};
  const srv = () => session.servers || {};
  // Start on the server asked for, else the first one not signed in yet.
  let sel = SERVERS.find((x) => x.kind === pick) || SERVERS.find((x) => !srv()[x.kind]?.signedIn) || SERVERS[0];
  const found = {}; // kind -> address that passed the check

  root.innerHTML = `
    <div class="signin">
      <div class="signin-brand">
        <img src="logo.png" alt="">
        <div><div class="brand-name">SCRAPPY</div><div class="brand-sub">MEDIA CENTER <span class="dot">·</span> <span class="nas">JJsNAS</span></div></div>
      </div>
      <div class="signin-card">
        <nav class="signin-list">
          <div class="signin-label">YOUR SERVERS</div>
          <div id="srvList"></div>
          <div class="signin-note">Only the servers you sign in to show up as tabs. You can come back here any time from Settings.</div>
        </nav>
        <form class="signin-form" id="srvForm" autocomplete="off"></form>
      </div>
    </div>`;
  const list = root.querySelector('#srvList');
  const form = root.querySelector('#srvForm');

  function drawList() {
    list.innerHTML = SERVERS.map((x) => {
      const st = srv()[x.kind] || {};
      const status = st.signedIn
        ? `<span class="st ok"><i></i>Signed in as ${esc(st.user)}</span>`
        : x === sel ? `<span class="st set"><i></i>Setting up…</span>` : `<span class="st"><i></i>Not set up</span>`;
      return `<button type="button" class="srv${x === sel ? ' sel' : ''}" data-k="${x.kind}">
        <span class="svc">${svgLine(x.icon)}</span>
        <span class="srv-txt"><b>${x.name}</b>${status}</span></button>`;
    }).join('');
  }

  function drawForm() {
    const st = srv()[sel.kind] || {};
    const anyIn = Object.values(srv()).some((v) => v.signedIn);
    const foot = `
      <div class="signin-foot">
        ${st.signedIn ? '<span></span>' : '<button type="button" class="link" id="skipBtn">Skip for now</button>'}
        <div class="signin-btns">
          <button type="button" class="btn secondary" id="openBtn" ${anyIn ? '' : 'disabled'}>Open Scrappy</button>
          ${st.signedIn ? '<button type="button" class="btn secondary" id="outBtn">Sign out</button>' : '<button type="submit" class="btn" id="goBtn" disabled>Sign in</button>'}
        </div>
      </div>`;
    if (st.signedIn) {
      form.innerHTML = `
        <div><h1>${sel.name}</h1><p class="sub">Signed in. Your ${sel.what.toLowerCase()} shows up in the ${sel.what} tab.</p></div>
        <div class="signed-box">
          <div><span>Server</span><b>${esc(st.address)}</b></div>
          <div><span>Account</span><b>${esc(st.user)}</b></div>
        </div>
        <div class="error" id="srvErr"></div>${foot}`;
    } else {
      const addr = st.address || '';
      form.innerHTML = `
        <div><h1>${sel.name}</h1><p class="sub" id="stepTxt">Step 1: tell Scrappy where your server is.</p></div>
        <div class="field">
          <label for="addr">Server address</label>
          <div class="addr-row">
            <input type="text" id="addr" placeholder="e.g. ${sel.eg}" value="${esc(addr)}" spellcheck="false">
            <button type="button" class="btn secondary" id="chkBtn">Check</button>
          </div>
          <div class="hint" id="addrHint">The same address you use for ${sel.name} in a browser.</div>
        </div>
        <div class="same-card" id="sameCard" hidden></div>
        <div class="creds locked" id="creds">
          <div class="field"><label for="user">Username</label><input type="text" id="user" spellcheck="false" placeholder="Unlocks after the check" value="${esc(st.user || '')}" disabled></div>
          <div class="field"><label for="pass">Password</label><input type="password" id="pass" disabled></div>
        </div>
        <div class="error" id="srvErr"></div>${foot}`;
    }
    wire();
  }

  function next() {
    const i = SERVERS.indexOf(sel);
    const rest = [...SERVERS.slice(i + 1), ...SERVERS.slice(0, i)].find((x) => !srv()[x.kind]?.signedIn);
    if (rest) { sel = rest; drawList(); drawForm(); }
    else location.hash = firstTab(session);
  }

  function wire() {
    const $ = (q) => form.querySelector(q);
    const err = $('#srvErr');
    $('#openBtn').onclick = () => { location.hash = firstTab(session); };
    if ($('#skipBtn')) $('#skipBtn').onclick = next;
    if ($('#outBtn')) $('#outBtn').onclick = async () => {
      try { session = await api.serverLogout(sel.kind); await ctx.refreshSession(); drawList(); drawForm(); }
      catch (e) { err.textContent = String(e); }
    };
    const addr = $('#addr'); if (!addr) return;
    const chk = $('#chkBtn'), hint = $('#addrHint'), creds = $('#creds'), go = $('#goBtn');
    const lock = (on) => {
      creds.classList.toggle('locked', on);
      creds.querySelectorAll('input').forEach((i) => (i.disabled = on));
      go.disabled = on;
      $('#user').placeholder = on ? 'Unlocks after the check' : '';
    };
    let checking = 0;
    async function check() {
      const value = addr.value.trim();
      if (!value) { addr.focus(); return; }
      const my = ++checking;
      err.textContent = '';
      hint.className = 'hint'; hint.textContent = `Looking for ${sel.name} at that address…`;
      chk.disabled = true; chk.innerHTML = `${SPIN}Checking…`;
      try {
        const r = await api.serverCheck(sel.kind, value);
        if (my !== checking) return;
        found[sel.kind] = r.address;
        hint.className = 'hint ok'; hint.textContent = `Found ${r.name} at ${r.address}`;
        chk.innerHTML = `${svgLine('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 16)}Found`;
        $('#stepTxt').textContent = 'Step 2: sign in with your account.';
        lock(false);
        offerSame();
        ($('#user').value ? $('#pass') : $('#user')).focus();
      } catch (e) {
        if (my !== checking) return;
        hint.className = 'hint bad'; hint.textContent = String(e);
        chk.textContent = 'Check';
        lock(true);
      } finally {
        if (my === checking) chk.disabled = false;
      }
    }
    chk.onclick = check;
    addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
    addr.addEventListener('input', () => {
      if (!found[sel.kind]) return;
      delete found[sel.kind]; checking++;
      chk.textContent = 'Check'; chk.disabled = false;
      hint.className = 'hint'; hint.textContent = `The same address you use for ${sel.name} in a browser.`;
      $('#stepTxt').textContent = 'Step 1: tell Scrappy where your server is.';
      lock(true);
      $('#sameCard').hidden = true;
    });
    // Offer the account from another server: one click while the password is still in memory,
    // otherwise it fills in the username and you type the password.
    async function offerSame() {
      const card = $('#sameCard');
      const emby = srv().emby;
      const src = reuse && reuse.kind !== sel.kind ? reuse : emby?.signedIn && sel.kind !== 'emby' ? { kind: 'emby', name: 'Emby', user: emby.user } : null;
      if (!src?.user) { card.hidden = true; return; }
      const full = !!src.pass;
      const pic = src.kind === 'emby' ? await embyFace() : '';
      if (!found[sel.kind]) return;
      card.innerHTML = `<button type="button" class="same-btn" id="sameBtn">
          <span class="av">${esc((src.user[0] || '?').toUpperCase())}${pic ? `<img src="${esc(pic)}" alt="" onerror="this.remove()">` : ''}</span>
          <span class="same-txt"><b>${full ? `Same username and password as ${src.name}?` : `Same username as ${src.name}?`}</b>
          <small>${full ? `Signs in as ${esc(src.user)} with the password you used for ${src.name}` : `Fills in ${esc(src.user)}. Type your password once to finish.`}</small></span>
          <span class="go">${full ? 'Sign in' : 'Use it'}</span></button>
        <div class="same-or">or type a different account</div>`;
      card.hidden = false;
      $('#sameBtn').onclick = () => {
        $('#user').value = src.user;
        if (full) { $('#pass').value = src.pass; form.requestSubmit(); }
        else $('#pass').focus();
      };
    }
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!found[sel.kind]) { check(); return; }
      err.textContent = '';
      go.disabled = true; go.innerHTML = `${SPIN}Signing in…`;
      try {
        session = await api.serverLogin(sel.kind, found[sel.kind], $('#user').value, $('#pass').value);
        reuse = { kind: sel.kind, name: sel.name, user: $('#user').value.trim(), pass: $('#pass').value };
        await ctx.refreshSession();
        toast(`Signed in to ${sel.name}.`);
        next();
      } catch (e2) {
        err.textContent = String(e2);
        go.disabled = false; go.textContent = 'Sign in';
      }
    };
    setTimeout(() => (addr.value ? check() : addr.focus()), 0);
  }

  list.addEventListener('click', (e) => {
    const b = e.target.closest('.srv'); if (!b) return;
    const x = SERVERS.find((y) => y.kind === b.dataset.k);
    if (x === sel) return;
    sel = x; drawList(); drawForm();
  });
  drawList(); drawForm();
}

// ---------------- Home (Watch) ----------------

const NO_LATEST = new Set(['boxsets', 'playlists', 'livetv', 'channels', 'music']);

export async function homeView(root, ctx) {
  root.innerHTML = loadingHtml();
  let views = null;
  await load('/Users/{userId}/Views', (data) => {
    views = (data?.Items || []).filter((v) => v.CollectionType !== 'music');
    if (!views.length) {
      root.innerHTML = '<div class="empty">No libraries found on this server for your account.</div>';
      return;
    }
    // Keep already-loaded rows when the library list is refreshed.
    const oldRows = {};
    root.querySelectorAll('[data-row]').forEach((r) => (oldRows[r.dataset.row] = r));
    const latest = views.filter((v) => !NO_LATEST.has(v.CollectionType));
    root.innerHTML = `
      <div data-row="hero" data-hrow="hero"><section class="hero hero-wait"></section></div>
      <div data-row="resume" data-hrow="resume"></div>
      <div data-row="nextup" data-hrow="nextup"></div>
      <div data-row="because" data-hrow="because"></div>
      <div data-hrow="library"><section class="section">
        <div class="section-head"><h2>Library</h2></div>
        <div class="row">${views.map(libTile).join('')}</div>
      </section></div>
      ${latest.map((v) => `<div data-row="latest-${esc(v.Id)}" data-hrow="latest-${esc(v.Id)}"></div>`).join('')}
      <div data-row="unseen" data-hrow="unseen"></div>
      <div data-row="again" data-hrow="again"></div>
      <div data-row="genres" data-hrow="genres"></div>`;
    root.querySelectorAll('[data-row]').forEach((r) => {
      if (oldRows[r.dataset.row]) r.replaceWith(oldRows[r.dataset.row]);
    });
    homeRows(root, 'tv', [
      { id: 'hero', label: 'Banner' }, { id: 'resume', label: 'Continue Watching' }, { id: 'nextup', label: 'Next Up', smart: true },
      { id: 'because', label: 'Because you watched…', smart: true }, { id: 'library', label: 'Library' },
      ...latest.map((v) => ({ id: 'latest-' + v.Id, label: 'Latest ' + v.Name })),
      { id: 'unseen', label: "Your top genre you haven't seen", smart: true }, { id: 'again', label: 'Watch again', smart: true },
      { id: 'genres', label: 'Browse by genre' },
    ], 'Movies & TV');
    loadRows(root, ctx, views);
  }, ctx.alive).catch((e) => ctx.fail(e));
}

let rowsLoadedFor = null;
function loadRows(root, ctx, views) {
  // Only fetch the rows once per page visit, even if the library list re-renders.
  if (rowsLoadedFor === ctx) return;
  rowsLoadedFor = ctx;
  const q = `Fields=${FIELDS}&${IMG_OPTS}`;

  genreSection(root, ctx, views);
  buildHero(root, ctx);

  load(`/Users/{userId}/Items/Resume?Limit=24&Recursive=true&MediaTypes=Video&${q}`, (data) => {
    const items = data?.Items || [];
    const slot = root.querySelector('[data-row=resume]');
    if (!slot) return;
    slot.innerHTML = items.length
      ? `<section class="section" data-cw><div class="section-head"><h2>Continue Watching</h2></div>
          <div class="row">${items.map((i) => card(i, { shape: 'wide', clickPlay: true })).join('')}</div></section>`
      : '';
  }, ctx.alive).catch(() => {});

  smartRows(root, ctx, q);

  // Libraries you've hidden from "Latest" in Emby stay hidden here too.
  api.get('/Users/{userId}').then((u) => u?.Configuration?.LatestItemsExcludes || []).catch(() => [])
    .then((excluded) => {
      for (const v of views) {
        if (NO_LATEST.has(v.CollectionType)) continue;
        const slot = root.querySelector(`[data-row="latest-${CSS.escape(v.Id)}"]`);
        if (excluded.includes(v.Id)) { slot?.remove(); continue; }
        load(`/Users/{userId}/Items/Latest?ParentId=${v.Id}&Limit=20&${q}`, (data) => {
          const items = Array.isArray(data) ? data : data?.Items || [];
          const s = root.querySelector(`[data-row="latest-${CSS.escape(v.Id)}"]`);
          if (!s) return;
          s.innerHTML = items.length
            ? `<section class="section"><div class="section-head"><h2><a href="#/library/${encodeURIComponent(v.Id)}">Latest ${esc(v.Name)}</a></h2></div>
                <div class="row">${items.map((i) => card(i)).join('')}</div></section>`
            : '';
          fillTileFallback(root, v.Id, items);
        }, ctx.alive).catch(() => {});
      }
    });
}

// ---------------- Smart rows (approved mock) ----------------
function smartRow(root, slot, title, sub, items, opts) {
  const s = root.querySelector(`[data-row="${slot}"]`);
  if (!s) return;
  s.innerHTML = items.length
    ? `<section class="section"><div class="section-head"><h2>${title}${sub ? `<span class="smart-sub">${esc(sub)}</span>` : ''}</h2></div>
        <div class="row">${items.map((i) => card(i, opts)).join('')}</div></section>`
    : '';
}
function smartRows(root, ctx, q) {
  const off = (id) => rowOff('tv', id);
  const lp = lowPriority(ctx.alive);
  const types = 'IncludeItemTypes=Movie,Series&Recursive=true';
  if (!off('nextup')) load(`/Shows/NextUp?UserId={userId}&Limit=20&${q}`, (d) => smartRow(root, 'nextup', 'Next Up', 'The next episode of every show you\'re watching', d?.Items || [], { shape: 'wide', clickPlay: true }), ctx.alive).catch(() => {});
  // Because you watched: the last thing you finished (a show, if it was an episode).
  if (!off('because')) cachedRow('tv', 'because', async () => {
    const d = await api.get(`/Users/{userId}/Items?Recursive=true&IncludeItemTypes=Movie,Episode&Filters=IsPlayed&SortBy=DatePlayed&SortOrder=Descending&Limit=1&Fields=SeriesId`).catch(() => null);
    const last = d?.Items?.[0]; if (!last) return null;
    const id = last.Type === 'Episode' ? last.SeriesId : last.Id, name = last.Type === 'Episode' ? last.SeriesName : last.Name;
    if (!id) return null;
    const r = await api.get(`/Items/${id}/Similar?UserId={userId}&Limit=20&${q}`).catch(() => null);
    return { name, items: (r?.Items || []).filter((i) => !i.UserData?.Played) };
  }, (d) => ctx.alive() && smartRow(root, 'because', `Because you watched ${esc(d.name || '')}`, '', d.items, {}), lp).catch(() => {});
  // Your most watched genre, things you haven't seen yet. Watch again: favorites, oldest watch first.
  if (!off('unseen')) cachedRow('tv', 'unseen', async () => {
    const d = await api.get(`/Users/{userId}/Items?${types}&Filters=IsPlayed&Fields=Genres&Limit=300`).catch(() => null);
    const n = new Map();
    (d?.Items || []).forEach((i) => (i.Genres || []).forEach((g) => n.set(g, (n.get(g) || 0) + 1)));
    const top = [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; if (!top) return null;
    const r = await api.get(`/Users/{userId}/Items?${types}&Genres=${encodeURIComponent(top)}&Filters=IsUnplayed&SortBy=Random&Limit=20&${q}`).catch(() => null);
    return { top, items: r?.Items || [] };
  }, (d) => ctx.alive() && smartRow(root, 'unseen', `${esc(d.top)} you haven't seen`, 'Your most watched genre', d.items, {}), lp).catch(() => {});
  if (!off('again')) load(`/Users/{userId}/Items?${types}&Filters=IsFavorite,IsPlayed&SortBy=DatePlayed&SortOrder=Ascending&Limit=20&${q}`,
    (d) => smartRow(root, 'again', 'Watch again', "Favorites you haven't seen in a while", d?.Items || [], {}), ctx.alive).catch(() => {});
}

// ---------------- Browse by genre ----------------
// One tab per Movies / TV library (so TV shows and anime stay apart), each with
// a row per genre, biggest genres first. Rows fill in as you scroll to them.

const GENRE_LIBS = new Set(['movies', 'tvshows', 'mixed', undefined, null, '']);
const GENRE_MIN = 6;
const GENRE_BROAD = 0.8; // genres on 80%+ of a library's titles are hidden there

function genreTypes(v) {
  if (v.CollectionType === 'movies') return 'Movie';
  if (v.CollectionType === 'tvshows') return 'Series';
  return 'Movie,Series';
}

function genreSection(root, ctx, views) {
  const slot = root.querySelector('[data-row=genres]');
  if (!slot || slot.dataset.ready) return;
  const libs = views.filter((v) => GENRE_LIBS.has(v.CollectionType) && v.CollectionType !== 'boxsets');
  if (!libs.length) return;
  slot.dataset.ready = '1';
  let current = localStorage.getItem('genreLib');
  if (!libs.some((l) => l.Id === current)) current = libs[0].Id;
  slot.innerHTML = `
    <section class="section genre-section">
      <div class="genre-head">
        <h2 class="genre-title">BROWSE BY GENRE</h2>
        ${libs.length > 1 ? `<div class="season-tabs">${libs.map((l) => `<button class="season-tab ${l.Id === current ? 'active' : ''}" data-lib="${esc(l.Id)}">${esc(l.Name)}</button>`).join('')}</div>` : ''}
      </div>
      <div class="genre-rows"></div>
    </section>`;
  const rowsEl = slot.querySelector('.genre-rows');
  slot.querySelectorAll('[data-lib]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.lib === current) return;
    current = b.dataset.lib;
    localStorage.setItem('genreLib', current);
    slot.querySelectorAll('[data-lib]').forEach((t) => t.classList.toggle('active', t === b));
    b.classList.add('live');
    showLib(libs.find((l) => l.Id === current), true);
  }));
  let io = null;
  ctx.onLeave(() => io?.disconnect());
  let gen = 0;
  // Each tab's rows are kept once built, so switching back is instant.
  const built = new Map(); // lib id -> { nodes, observe }
  const observeRows = (lib, types, my) => {
    io?.disconnect();
    io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        fillGenreRow(en.target, lib, types, ctx, my, () => gen);
      }
    }, { rootMargin: '400px' });
    rowsEl.querySelectorAll('.genre-row:not(.filled)').forEach((r) => io.observe(r));
  };
  const swapIn = (fill) => {
    fill();
    rowsEl.classList.remove('out');
    rowsEl.classList.remove('soft-in');
    void rowsEl.offsetWidth;
    rowsEl.classList.add('soft-in');
    // Let the height follow the new rows once they've faded in.
    setTimeout(() => { rowsEl.style.minHeight = ''; }, 450);
  };
  async function showLib(lib, live) {
    const my = ++gen;
    io?.disconnect();
    const types = genreTypes(lib);
    if (live) {
      // Keep the space so the page below doesn't jump, and fade the old rows out.
      rowsEl.style.minHeight = rowsEl.offsetHeight + 'px';
      const prev = [...rowsEl.childNodes];
      const prevLib = rowsEl.dataset.lib;
      rowsEl.querySelectorAll('.genre-row.filled').forEach((r) => r.classList.add('shown'));
      if (prevLib) built.set(prevLib, prev);
      rowsEl.classList.remove('soft-in');
      rowsEl.classList.add('out');
      await new Promise((r) => setTimeout(r, 180));
      if (my !== gen || !ctx.alive()) return;
      const saved = built.get(lib.Id);
      if (saved) {
        swapIn(() => { rowsEl.replaceChildren(...saved); rowsEl.dataset.lib = lib.Id; });
        observeRows(lib, types, my);
        return;
      }
      rowsEl.replaceChildren();
      rowsEl.innerHTML = '<div class="genre-wait"><div class="spinner"></div></div>';
      rowsEl.classList.remove('out');
    } else {
      rowsEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    }
    let genres = [];
    try {
      const path = `/Genres?ParentId=${lib.Id}&UserId={userId}&IncludeItemTypes=${types}&Recursive=true&SortBy=SortName`;
      const data = (await api.cached(path)) || (await api.get(path));
      genres = data?.Items || [];
      api.get(path).catch(() => {}); // keep the saved copy fresh for next time
    } catch { genres = []; }
    if (my !== gen || !ctx.alive()) return;
    // Count each genre so the biggest come first and tiny ones are skipped.
    const counted = await Promise.all(genres.map(async (g) => {
      const path = `/Users/{userId}/Items?ParentId=${lib.Id}&GenreIds=${g.Id}&IncludeItemTypes=${types}&Recursive=true&Limit=0`;
      try {
        const r = (await api.cached(path)) || (await api.get(path));
        api.get(path).catch(() => {});
        return { g, n: r?.TotalRecordCount || 0 };
      } catch { return { g, n: 0 }; }
    }));
    if (my !== gen || !ctx.alive()) return;
    // A genre that covers nearly the whole library says nothing new there
    // (e.g. "Animation" in an animated movies library, or "Anime" in an anime
    // library), so leave it out. Smaller ones, like "Anime" among animated
    // movies, stay.
    let total = 0;
    try {
      const tp = `/Users/{userId}/Items?ParentId=${lib.Id}&IncludeItemTypes=${types}&Recursive=true&Limit=0`;
      total = ((await api.cached(tp)) || (await api.get(tp)))?.TotalRecordCount || 0;
      api.get(tp).catch(() => {});
    } catch {}
    if (my !== gen || !ctx.alive()) return;
    const tooBroad = (n) => total >= 10 && n >= total * GENRE_BROAD;
    const list = counted.filter((x) => x.n >= GENRE_MIN && !tooBroad(x.n)).sort((a, b) => b.n - a.n);
    const html = !list.length ? '<div class="empty">No genres with enough titles yet.</div>' : list.map(({ g, n }) => `
      <div class="genre-row" data-genre="${esc(g.Id)}">
        <div class="section-head"><h2>${esc(g.Name)}</h2><span class="count">${n} titles</span><span class="spacer"></span>
          <a class="see-all" href="#/library/${encodeURIComponent(lib.Id)}/${encodeURIComponent(g.Id)}">See all ›</a></div>
        <div class="row genre-items"><div class="genre-ph"></div></div>
      </div>`).join('');
    const fill = () => { rowsEl.innerHTML = html; rowsEl.dataset.lib = lib.Id; };
    if (live) swapIn(fill); else fill();
    if (list.length) observeRows(lib, types, my);
  }
  showLib(libs.find((l) => l.Id === current), false);
}

async function fillGenreRow(rowEl, lib, types, ctx, my, getGen) {
  const id = rowEl.dataset.genre;
  try {
    // Random order so each visit shows something different.
    const data = await api.get(`/Users/{userId}/Items?ParentId=${lib.Id}&GenreIds=${id}&IncludeItemTypes=${types}&Recursive=true&SortBy=Random&Limit=20&Fields=${FIELDS}&${IMG_OPTS}`);
    if (my !== getGen() || !ctx.alive()) return;
    const items = data?.Items || [];
    const box = rowEl.querySelector('.genre-items');
    box.innerHTML = items.map((i) => card(i, { shape: 'portrait' })).join('');
    rowEl.classList.add('filled');
  } catch {}
}

// ---------------- Home banner ----------------
// Each slide has a reason to be there (shown under the title): something you
// started a while ago, a new episode, a pick based on what you watched, a new
// arrival, a well-rated title you've never watched, or an old favorite.
// Only items whose backdrop is genuinely wide and sharp get in.

const HERO_MIN_WIDTH = 1280;
const HERO_SLIDES = 6;
const DAY = 86400000;
const heroChecked = new Map(); // backdrop url -> true/false (only definite answers are kept)

// Banner and page backdrops always ask for 4K (Jayden's pick: big TVs). Emby never sends more
// than the original, so art that's smaller than 4K comes at its full size.
const bigW = () => 3840;
function heroBackdrop(it) {
  if (it.BackdropImageTags?.length) return { id: it.Id, tag: it.BackdropImageTags[0] };
  if (it.ParentBackdropImageTags?.length && it.ParentBackdropItemId) return { id: it.ParentBackdropItemId, tag: it.ParentBackdropImageTags[0] };
  return null;
}

function backdropIsGood(url) {
  if (heroChecked.has(url)) return Promise.resolve(heroChecked.get(url));
  return new Promise((resolve) => {
    const im = new Image();
    let settled = false;
    const done = (ok, keep = true) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (keep) heroChecked.set(url, ok);
      resolve(ok);
    };
    im.onload = () => {
      const ratio = im.naturalWidth / im.naturalHeight;
      done(im.naturalWidth >= HERO_MIN_WIDTH && ratio >= 1.55 && ratio <= 2.1);
    };
    im.onerror = () => done(false, false); // could be a hiccup: try again next time
    const timer = setTimeout(() => done(false, false), 12000);
    im.src = url;
  });
}

const ago = (d) => {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / DAY);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const y = Math.round(days / 365);
  return y === 1 ? 'a year ago' : `${y} years ago`;
};

async function heroPools() {
  const f = `Fields=${FIELDS},Overview,DateCreated,Genres&${IMG_OPTS}&EnableUserData=true`;
  const get = (p) => api.get(p).then((d) => (Array.isArray(d) ? d : d?.Items || [])).catch(() => []);
  const now = Date.now();
  const [resume, nextUp, recent, latest, gems, favs] = await Promise.all([
    get(`/Users/{userId}/Items/Resume?Limit=40&Recursive=true&MediaTypes=Video&${f}`),
    get(`/Shows/NextUp?UserId={userId}&Limit=30&${f}`),
    get(`/Users/{userId}/Items?SortBy=DatePlayed&SortOrder=Descending&Filters=IsPlayed&IncludeItemTypes=Movie,Episode&Recursive=true&Limit=6&${f}`),
    get(`/Users/{userId}/Items?SortBy=DateCreated&SortOrder=Descending&IncludeItemTypes=Movie,Series&Recursive=true&Filters=IsUnplayed&Limit=30&${f}`),
    get(`/Users/{userId}/Items?SortBy=Random&IncludeItemTypes=Movie,Series&Recursive=true&Filters=IsUnplayed&MinCommunityRating=7.2&Limit=40&${f}`),
    get(`/Users/{userId}/Items?SortBy=Random&IncludeItemTypes=Movie,Series&Recursive=true&Filters=IsFavorite&Limit=40&${f}`),
  ]);
  // Started but not touched for 3+ days, longest-forgotten first.
  const lastPlayed = (it) => new Date(it.UserData?.LastPlayedDate || 0).getTime();
  const pickBack = resume.filter((it) => lastPlayed(it) && now - lastPlayed(it) > 3 * DAY)
    .sort((a, b) => lastPlayed(a) - lastPlayed(b))
    .map((it) => ({ it, reason: 'pick', kicker: 'PICK BACK UP', why: `You stopped here ${ago(it.UserData.LastPlayedDate)}` }));
  const newEps = nextUp.filter((e) => e.DateCreated && now - new Date(e.DateCreated).getTime() < 14 * DAY)
    .map((it) => ({ it, reason: 'new', kicker: 'NEW EPISODE', why: `A show you watch · added ${ago(it.DateCreated)}` }));
  const added = latest.map((it) => ({ it, reason: 'added', kicker: 'JUST ADDED', why: `Added ${ago(it.DateCreated)}` }));
  const never = gems.filter((it) => it.DateCreated && now - new Date(it.DateCreated).getTime() > 180 * DAY && Number(it.CommunityRating) >= 7.2)
    .map((it) => ({ it, reason: 'never', kicker: 'IN YOUR LIBRARY, NEVER WATCHED', why: `Added in ${new Date(it.DateCreated).getFullYear()} · rated ${Number(it.CommunityRating).toFixed(1)}` }));
  const oldFavs = favs.filter((it) => !it.UserData?.LastPlayedDate || now - lastPlayed(it) > 365 * DAY)
    .map((it) => ({ it, reason: 'fav', kicker: 'FROM YOUR FAVORITES', why: it.UserData?.LastPlayedDate ? `Last watched ${ago(it.UserData.LastPlayedDate)}` : 'One of your favorites' }));
  // "Because you watched": something similar to the last thing you finished.
  let because = [];
  const last = recent[0];
  if (last) {
    const baseId = last.Type === 'Episode' ? last.SeriesId : last.Id;
    const baseName = last.Type === 'Episode' ? last.SeriesName : last.Name;
    const sim = await get(`/Items/${baseId}/Similar?UserId={userId}&Limit=12&${f}`);
    because = sim.filter((it) => !it.UserData?.Played)
      .map((it) => ({ it, reason: 'because', kicker: `BECAUSE YOU WATCHED ${String(baseName || '').toUpperCase()}`, why: it.Genres?.length ? it.Genres.slice(0, 2).join(' · ') : 'Similar to what you watched' }));
  }
  return { pickBack, newEps, because, added, never, oldFavs };
}

let heroTimer = null;
let heroGen = 0;
const heroReady = () => window.dispatchEvent(new Event('scrappy:ready'));
// Settings: the banner shows picks for you (default), only recently added, or nothing.
const heroMode = () => (pref('heroMode') === 'recent' ? 'recent' : pref('heroMode') === 'off' ? 'off' : 'picks');
const heroCacheKey = (ctx) => `heroCache:${ctx.session?.server || ''}:${ctx.session?.userId || ''}${heroMode() === 'recent' ? ':recent' : ''}`;
// Just what a slide needs, so the saved copy stays small.
const HERO_KEEP = ['Id', 'Type', 'Name', 'SeriesId', 'SeriesName', 'ProductionYear', 'ChildCount', 'RunTimeTicks', 'OfficialRating', 'Overview', 'UserData', 'IndexNumber', 'ParentIndexNumber'];
function saveHeroCache(ctx, picks, seriesInfo) {
  try {
    const slim = picks.slice(0, 1).map((p) => ({ url: p.url, kicker: p.kicker, why: p.why, it: Object.fromEntries(HERO_KEEP.filter((k) => p.it[k] != null).map((k) => [k, p.it[k]])) }));
    const info = {};
    slim.forEach((p) => { const s = seriesInfo[p.it.SeriesId]; if (s) info[p.it.SeriesId] = { Name: s.Name, Overview: s.Overview }; });
    localStorage.setItem(heroCacheKey(ctx), JSON.stringify({ picks: slim, seriesInfo: info }));
  } catch {}
}

async function buildHero(root, ctx) {
  const slot = root.querySelector('[data-row=hero]');
  if (!slot) return;
  const my = ++heroGen;
  if (heroMode() === 'off') { clearInterval(heroTimer); slot.innerHTML = ''; slot._hero = null; heroReady(); return; }
  // Show last time's first slide straight away; the rest are fetched fresh.
  if (!slot._hero) {
    try {
      const c = JSON.parse(localStorage.getItem(heroCacheKey(ctx)) || 'null');
      if (c?.picks?.length) { slot._hero = renderHero(slot, ctx, c.picks, c.seriesInfo || {}); heroReady(); }
    } catch {}
  }
  try {
    await fillHero(slot, ctx, my);
  } catch (e) {
    // Never let one odd item take the whole banner down.
    console.error('banner', e);
  }
  if (my === heroGen && slot.querySelector('.hero-wait')) slot.innerHTML = '';
  heroReady();
}

// The banner keeps the same set of picks for a few hours, so it doesn't
// reshuffle every time Home reloads (after watching or editing something).
const HERO_KEEP_FOR = 6 * 60 * 60 * 1000;
const heroSetKey = (ctx) => `heroSet:${ctx.session?.server || ''}:${ctx.session?.userId || ''}${heroMode() === 'recent' ? ':recent' : ''}`;
async function keptHeroPicks(ctx) {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(heroSetKey(ctx)) || 'null'); } catch {}
  if (!saved?.list?.length || Date.now() - saved.at > HERO_KEEP_FOR) return null;
  const d = await api.get(`/Users/{userId}/Items?Ids=${saved.list.map((x) => x.id).join(',')}&Fields=${FIELDS},Overview,DateCreated,Genres&${IMG_OPTS}&EnableUserData=true`);
  const byId = new Map((d?.Items || []).map((it) => [it.Id, it]));
  const picks = [];
  for (const x of saved.list) {
    const it = byId.get(x.id);
    // Gone from the server, or a movie/episode you've since finished: drop it.
    if (!it || (it.Type !== 'Series' && it.UserData?.Played)) continue;
    const b = heroBackdrop(it);
    if (!b) continue;
    picks.push({ it, kicker: x.kicker, why: x.why, url: img(b.id, 'Backdrop', b.tag, bigW(), 0) });
  }
  return picks.length >= Math.min(3, saved.list.length) ? picks : null;
}

async function fillHero(slot, ctx, my) {
  let kept = null;
  try { kept = await keptHeroPicks(ctx); } catch {}
  if (my !== heroGen || !ctx.alive()) return;
  if (kept) return showHeroPicks(slot, ctx, my, kept, false);
  let P;
  try { P = await heroPools(); } catch { P = {}; }
  for (const k of ['pickBack', 'newEps', 'because', 'added', 'never', 'oldFavs']) P[k] = P[k] || [];
  if (my !== heroGen || !ctx.alive()) return;
  // Take turns from each reason so the banner is a mix; at most 2 "pick back up".
  const order = heroMode() === 'recent' ? [P.added] : [P.pickBack, P.newEps, P.because, P.added, P.never, P.oldFavs];
  const caps = new Map(heroMode() === 'recent' ? [[P.added, 99]] : [[P.pickBack, 2]]);
  const seen = new Set();
  const queue = [];
  for (let round = 0; round < 8; round++) {
    for (const list of order) {
      const taken = queue.filter((q) => q.list === list).length;
      if (taken >= (caps.get(list) ?? 3)) continue;
      while (list.length) {
        const c = list.shift();
        const key = c.it.SeriesId || c.it.Id;
        if (seen.has(key) || !heroBackdrop(c.it)) continue;
        seen.add(key);
        queue.push({ ...c, list });
        break;
      }
    }
  }
  // Check backdrops a few at a time, keeping the mixed order.
  const picks = [];
  for (let i = 0; i < queue.length && picks.length < HERO_SLIDES; i += 4) {
    const batch = queue.slice(i, i + 4);
    const ok = await Promise.all(batch.map((c) => {
      const b = heroBackdrop(c.it);
      c.url = img(b.id, 'Backdrop', b.tag, bigW(), 0);
      return backdropIsGood(c.url);
    }));
    if (my !== heroGen || !ctx.alive()) return;
    batch.forEach((c, k) => { if (ok[k] && picks.length < HERO_SLIDES) picks.push(c); });
  }
  // Nothing usable this time: keep whatever banner is already showing.
  if (!picks.length) return;
  return showHeroPicks(slot, ctx, my, picks, true);
}

async function showHeroPicks(slot, ctx, my, picks, isNew) {
  if (isNew) try { localStorage.setItem(heroSetKey(ctx), JSON.stringify({ at: Date.now(), list: picks.map((p) => ({ id: p.it.Id, kicker: p.kicker, why: p.why })) })); } catch {}
  const seriesInfo = {};
  await Promise.all(picks.filter((p) => p.it.Type === 'Episode' && p.it.SeriesId).map(async (p) => {
    try { seriesInfo[p.it.SeriesId] = (await api.cached(`/Users/{userId}/Items/${p.it.SeriesId}`)) || (await api.get(`/Users/{userId}/Items/${p.it.SeriesId}`)); } catch {}
  }));
  if (my !== heroGen || !ctx.alive()) return;
  saveHeroCache(ctx, picks, seriesInfo);
  // A banner is already showing (saved copy, or coming back to Home): keep the
  // current slide where it is and slot the fresh ones in after it.
  if (slot._hero && slot.contains(slot._hero.el)) slot._hero.update(ctx, picks, seriesInfo);
  else slot._hero = renderHero(slot, ctx, picks, seriesInfo);
}

const CHEVRON_L = '<svg viewBox="0 0 28 56" aria-hidden="true"><path d="M22 4 6 28l16 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEVRON_R = '<svg viewBox="0 0 28 56" aria-hidden="true"><path d="M6 4l16 24L6 52" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderHero(slot, ctx, picks, seriesInfo) {
  let i = 0;
  const slide = (p) => {
    const it = p.it;
    const ser = it.Type === 'Episode' ? seriesInfo[it.SeriesId] : null;
    const ud = it.UserData || {};
    const resumable = ud.PlaybackPositionTicks > 0 && it.RunTimeTicks;
    const title = ser?.Name || it.SeriesName || it.Name;
    const meta = it.Type === 'Episode'
      ? [epCode(it), it.Name, resumable ? `${runtime(it.RunTimeTicks - ud.PlaybackPositionTicks)} left` : ''].filter(Boolean).join(' · ')
      : [it.ProductionYear, it.Type === 'Series' ? (it.ChildCount ? `${it.ChildCount} season${it.ChildCount === 1 ? '' : 's'}` : '') : it.RunTimeTicks ? runtime(it.RunTimeTicks) : '', it.OfficialRating, resumable ? `${runtime(it.RunTimeTicks - ud.PlaybackPositionTicks)} left` : ''].filter(Boolean).join(' · ');
    const overview = (ser?.Overview || it.Overview || '');
    const play = it.Type === 'Series'
      ? `<button class="btn big" data-play-series="${esc(it.Id)}">${PLAY_ICON} <span class="lbl">Play</span></button>`
      : `<button class="btn big" data-play="${esc(it.Id)}">${PLAY_ICON} ${resumable ? 'Resume' : 'Play'}</button>`;
    return `
      <div class="hero-bg"><img src="${esc(p.url)}" alt=""></div>
      <div class="hero-text">
        <div class="hero-kicker"><i></i>${esc(p.kicker)}</div>
        <h1 class="hero-title">${esc(title)}</h1>
        <div class="hero-meta">${esc(meta)}</div>
        <div class="hero-why">${esc(p.why)}</div>
        <p class="hero-overview">${esc(overview)}</p>
        <div class="hero-buttons">
          ${play}
          <a class="btn secondary big" href="#/item/${encodeURIComponent(it.SeriesId && it.Type === 'Episode' ? it.SeriesId : it.Id)}">More info</a>
        </div>
      </div>`;
  };
  slot.innerHTML = `
    <section class="hero">
      <div class="hero-slide fwd">${slide(picks[0])}</div>
      <div class="hero-nav"></div>
    </section>`;
  const box = slot.querySelector('.hero-slide');
  const nav = slot.querySelector('.hero-nav');
  // Fade the picture in only once it has loaded, so it never pops in.
  const softImg = () => {
    const im = box.querySelector('.hero-bg img');
    if (im && !im.complete) { im.classList.add('wait'); im.addEventListener('load', () => im.classList.remove('wait'), { once: true }); im.addEventListener('error', () => im.classList.remove('wait'), { once: true }); }
  };
  softImg();
  const drawNav = () => {
    const many = picks.length > 1;
    nav.innerHTML = many
      ? `<button class="hero-arrow l" aria-label="Previous">${CHEVRON_L}</button><button class="hero-arrow r" aria-label="Next">${CHEVRON_R}</button>
         <div class="hero-dots">${picks.map((_, n) => `<button class="hero-dot ${n === i ? 'on' : ''}" data-n="${n}" aria-label="Show item ${n + 1}"></button>`).join('')}</div>`
      : '';
    nav.querySelectorAll('.hero-dot').forEach((d) => d.addEventListener('click', () => { const n = Number(d.dataset.n); show(n, n >= i ? 'fwd' : 'back'); restart(); }));
    nav.querySelector('.hero-arrow.l')?.addEventListener('click', () => { show(i - 1, 'back'); restart(); });
    nav.querySelector('.hero-arrow.r')?.addEventListener('click', () => { show(i + 1, 'fwd'); restart(); });
  };
  // Shows: the Play button says which episode it will start.
  const fillSeriesLabel = () => {
    const b = box.querySelector('[data-play-series]');
    if (!b) return;
    const id = b.dataset.playSeries;
    seriesTarget(id).then((t) => { const l = box.querySelector(`[data-play-series="${CSS.escape(id)}"] .lbl`); if (l) l.textContent = seriesPlayLabel(t); });
  };
  const show = (n, dir = 'fwd') => {
    i = (n + picks.length) % picks.length;
    box.classList.remove('fwd', 'back');
    void box.offsetWidth;
    box.innerHTML = slide(picks[i]);
    box.classList.add(dir);
    softImg();
    slot.querySelectorAll('.hero-dot').forEach((d, k) => d.classList.toggle('on', k === i));
    fillSeriesLabel();
  };
  fillSeriesLabel();
  let paused = false;
  const el = slot.querySelector('.hero');
  el.addEventListener('mouseenter', () => (paused = true));
  el.addEventListener('mouseleave', () => (paused = false));
  const restart = () => {
    clearInterval(heroTimer);
    if (picks.length > 1) heroTimer = setInterval(() => { if (!ctx.alive()) { clearInterval(heroTimer); return; } if (!paused && !document.hidden && !document.documentElement.classList.contains('calm')) show(i + 1); }, 8000);
  };
  drawNav();
  restart();
  ctx.onLeave(() => clearInterval(heroTimer));
  return {
    el,
    // Swap in a fresh set of slides without touching the one on screen.
    update(newCtx, fresh, info) {
      ctx = newCtx;
      Object.assign(seriesInfo, info);
      const cur = picks[i];
      const key = (p) => p.it.SeriesId || p.it.Id;
      const same = fresh.find((p) => key(p) === key(cur));
      // Same title but a new picture (e.g. after Edit images): swap it in place.
      if (same && same.url !== cur.url) { const im = box.querySelector('.hero-bg img'); if (im) im.src = same.url; }
      picks = [same || cur, ...fresh.filter((p) => key(p) !== key(cur))].slice(0, HERO_SLIDES);
      i = 0;
      drawNav();
      restart();
      ctx.onLeave(() => clearInterval(heroTimer));
    },
  };
}

function libTile(v) {
  const t = v.ImageTags || {};
  // Emby makes library pictures automatically but doesn't always list them,
  // so ask for one anyway; if there isn't one, a backdrop is filled in later.
  const src = t.Primary ? img(v.Id, 'Primary', t.Primary, 640) : imgAny(v.Id, 'Primary', 640);
  return `
    <a class="card lib-tile" href="#/library/${encodeURIComponent(v.Id)}" data-lib="${esc(v.Id)}">
      <div class="art">
        <div class="ph">${esc(v.Name)}</div>
        <img src="${esc(src)}" alt="" onload="this.classList.add('loaded')" onerror="this.closest('.card').classList.add('noimg');this.removeAttribute('src')">
      </div>
      <div class="title">${esc(v.Name)}</div>
    </a>`;
}

// For a library with no picture, use the backdrop of its newest item.
function fillTileFallback(root, viewId, items) {
  const tile = root.querySelector(`[data-lib="${CSS.escape(viewId)}"]`);
  if (!tile) return;
  const apply = () => {
    if (!tile.classList.contains('noimg')) return;
    const it = items.find((i) => i.BackdropImageTags?.length || i.ParentBackdropImageTags?.length);
    if (!it) return;
    const src = it.BackdropImageTags?.length
      ? img(it.Id, 'Backdrop', it.BackdropImageTags[0], 640, 0)
      : img(it.ParentBackdropItemId, 'Backdrop', it.ParentBackdropImageTags[0], 640, 0);
    const im = tile.querySelector('img');
    tile.classList.remove('noimg');
    tile.classList.add('fallback');
    im.onerror = () => im.remove();
    im.src = src;
  };
  apply();
  // The library picture may still be loading; check again once it settles.
  const im = tile.querySelector('img');
  if (im && !im.complete) im.addEventListener('error', () => setTimeout(apply, 0), { once: true });
}

// ---------------- Library page ----------------

const SORTS = [
  ['SortName', 'Ascending', 'Name'],
  ['DateCreated', 'Descending', 'Date added'],
  ['PremiereDate,ProductionYear', 'Descending', 'Release date'],
  ['CommunityRating', 'Descending', 'Rating'],
  ['DatePlayed', 'Descending', 'Last played'],
];

function libraryQuery(view) {
  switch (view.CollectionType) {
    case 'movies': return 'IncludeItemTypes=Movie&Recursive=true';
    case 'tvshows': return 'IncludeItemTypes=Series&Recursive=true';
    case 'boxsets': return 'IncludeItemTypes=BoxSet&Recursive=true';
    case 'musicvideos': return 'IncludeItemTypes=MusicVideo&Recursive=true';
    default: return 'Recursive=false';
  }
}

// genreId: show only that genre inside the library ("See all" from a genre row).
export async function libraryView(root, ctx, id, genreId = '') {
  root.innerHTML = loadingHtml();
  let view, genre = null;
  try {
    view = (await api.cached(`/Users/{userId}/Items/${id}`)) || (await api.get(`/Users/{userId}/Items/${id}`));
    if (genreId) genre = (await api.cached(`/Users/{userId}/Items/${genreId}`)) || (await api.get(`/Users/{userId}/Items/${genreId}`));
  } catch (e) {
    return ctx.fail(e);
  }
  if (!ctx.alive()) return;
  const sortKey = 'sort:' + id + (genreId ? ':g' : '');
  let sortIdx = Number(localStorage.getItem(sortKey) || 0);
  if (!SORTS[sortIdx]) sortIdx = 0;

  root.innerHTML = `
    <section class="section">
      <div class="section-head">
        <h2>${genre ? `${esc(genre.Name)} <span class="h-dim">· ${esc(view.Name)}</span>` : esc(view.Name)}</h2><span class="count" id="count"></span>
        <span class="spacer"></span>
        <select id="sort">${SORTS.map((s, i) => `<option value="${i}" ${i === sortIdx ? 'selected' : ''}>${s[2]}</option>`).join('')}</select>
      </div>
      <div class="grid" id="grid"></div>
      <div class="sentinel" id="sentinel"></div>
    </section>`;
  const grid = root.querySelector('#grid');
  const count = root.querySelector('#count');
  const sentinel = root.querySelector('#sentinel');
  const PAGE = 120;
  let start = 0, total = Infinity, busy = false, gen = 0;

  const base = () => {
    const [by, order] = SORTS[sortIdx];
    return `/Users/{userId}/Items?ParentId=${id}&${libraryQuery(view)}${genreId ? `&GenreIds=${genreId}` : ''}&SortBy=${by},SortName&SortOrder=${order}&Fields=${FIELDS}&${IMG_OPTS}&Limit=${PAGE}`;
  };

  async function more() {
    if (busy || start >= total || !ctx.alive()) return;
    busy = true;
    const myGen = gen;
    const path = `${base()}&StartIndex=${start}`;
    try {
      const apply = (data) => {
        total = data.TotalRecordCount ?? 0;
        count.textContent = total ? `${total.toLocaleString()} items` : '';
        if (!total) grid.innerHTML = '<div class="empty">This library is empty.</div>';
        return data.Items || [];
      };
      if (start === 0) {
        // First page: show the saved copy instantly, then refresh.
        let rendered = 0;
        await load(path, (data) => {
          if (myGen !== gen) return;
          grid.innerHTML = '';
          const items = apply(data);
          grid.insertAdjacentHTML('beforeend', items.map((it) => card(it)).join(''));
          rendered = items.length;
        }, () => ctx.alive() && myGen === gen);
        start = rendered;
      } else {
        const data = await api.get(path);
        if (myGen !== gen || !ctx.alive()) return;
        const items = data.Items || [];
        grid.insertAdjacentHTML('beforeend', items.map((it) => card(it)).join(''));
        start += items.length;
        if (!items.length) total = start;
      }
    } catch (e) {
      ctx.fail(e, true);
    } finally {
      busy = false;
    }
    // Keep filling if the screen isn't full yet.
    if (myGen === gen && start < total && sentinel.getBoundingClientRect().top < innerHeight + 800) more();
  }

  const io = new IntersectionObserver((entries) => entries[0].isIntersecting && more(), { rootMargin: '800px' });
  io.observe(sentinel);
  ctx.onLeave(() => io.disconnect());

  root.querySelector('#sort').addEventListener('change', (e) => {
    sortIdx = Number(e.target.value);
    localStorage.setItem(sortKey, String(sortIdx));
    gen++; start = 0; total = Infinity; busy = false;
    grid.innerHTML = '';
    more();
  });
  more();
}

// ---------------- Item detail ----------------

// Everything about the item except the play-history details that change on their own
// (last played time, play count), so an edit to any field (year, rating, tagline, cast...) redraws.
const itemKey = (it) => { const { UserData: u = {}, ...rest } = it; return JSON.stringify([rest, u.Played, u.IsFavorite, Math.round((u.PlaybackPositionTicks || 0) / 6e8), u.UnplayedItemCount]); };
export async function itemView(root, ctx, id, seasonId = '') {
  root.innerHTML = loadingHtml();
  let moved = false, shownKey = '';
  try {
    await load(`/Users/{userId}/Items/${id}`, (it) => {
      // A season opens as its show's page with that season's tab picked,
      // so every season stays one click away.
      if (it.Type === 'Season' && it.SeriesId) {
        if (!moved) { moved = true; location.replace(`#/item/${encodeURIComponent(it.SeriesId)}/${encodeURIComponent(it.Id)}`); }
        return;
      }
      // Fresh data that only differs in small details (last played time, etc.) doesn't redraw
      // the whole page; that redraw is what made it blink.
      const key = itemKey(it);
      if (it.Type === 'BoxSet' && !shownKey) noteCollection(it);
      if (key === shownKey) return;
      shownKey = key;
      renderItem(root, ctx, it, seasonId);
    }, () => ctx.alive() && !moved);
  } catch (e) {
    ctx.fail(e);
  }
}

const BACK_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// "Movies & TV › Dark › Season 1" with a round back button.
function crumbsHtml(it) {
  const parts = ['<a href="#/home">Movies &amp; TV</a>'];
  if (it.Type === 'Episode') {
    parts.push(`<a href="#/item/${esc(it.SeriesId)}">${esc(it.SeriesName)}</a>`);
    if (it.SeasonId) parts.push(`<a href="#/item/${esc(it.SeriesId)}/${esc(it.SeasonId)}">${esc(it.SeasonName || 'Season')}</a>`);
    parts.push(`<span class="here">${esc(it.Name)}</span>`);
  } else if (it.Type === 'Series' || it.Type === 'Person') {
    parts.push(`<span class="here">${esc(it.Name)}</span>`);
  } else {
    parts.push(`<span class="here">${esc(it.Name)}</span>`);
  }
  return `<div class="crumbs">
    <button class="back-btn" id="backBtn" title="Back (Backspace)" aria-label="Back">${BACK_ICON}</button>
    <div class="crumb-trail">${parts.join('<span class="sep">›</span>')}${it.Type === 'Series' ? '<span class="sep" hidden>›</span><span class="here red" id="crumbSeason" hidden></span>' : ''}</div>
  </div>`;
}

// ---- Detail page pieces ----

const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_COG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
const ICON_HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="var(--heart-fill, none)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
const CHEV = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
const PERSON_ICON = '<svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

// Red quality tag (4K / 1080p / 720p / SD, plus HDR) and the sound format.
function qualityTags(it) {
  const src = it.MediaSources?.[0];
  const streams = src?.MediaStreams || it.MediaStreams || [];
  const v = streams.find((s) => s.Type === 'Video');
  const tags = [];
  if (v) {
    const w = v.Width || 0, h = v.Height || 0;
    const res = w >= 3200 || h >= 1800 ? '4K' : w >= 1800 || h >= 1000 ? '1080p' : w >= 1200 || h >= 700 ? '720p' : w ? 'SD' : '';
    const hdr = v.VideoRange && v.VideoRange !== 'SDR' ? (/dolby|dovi/i.test(v.VideoRangeType || '') ? 'Dolby Vision' : 'HDR') : '';
    if (res) tags.push(`<span class="tag q">${res}${hdr ? ' ' + hdr : ''}</span>`);
  }
  const a = streams.find((s) => s.Type === 'Audio' && s.IsDefault) || streams.find((s) => s.Type === 'Audio');
  if (a) {
    const atmos = /atmos/i.test(`${a.Profile || ''} ${a.DisplayTitle || ''}`);
    const ch = a.Channels || 0;
    const sound = atmos ? 'Atmos' : ch >= 8 ? '7.1' : ch >= 6 ? '5.1' : ch === 2 ? 'Stereo' : ch === 1 ? 'Mono' : '';
    if (sound) tags.push(`<span class="tag">${sound}</span>`);
  }
  return tags.join('');
}

function detailMeta(it) {
  const parts = [];
  if (it.CommunityRating) parts.push(`<span class="star-rating"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" fill="var(--red)"/></svg>${it.CommunityRating.toFixed(1)}</span>`);
  if (it.Type === 'Episode' && it.PremiereDate) parts.push(esc(new Date(it.PremiereDate).toLocaleDateString()));
  else if (it.Type === 'Series' && it.ProductionYear) {
    const end = it.Status === 'Ended' && it.EndDate ? new Date(it.EndDate).getFullYear() : '';
    parts.push(`${it.ProductionYear}–${end && end !== it.ProductionYear ? end : end ? '' : ''}`.replace(/–$/, it.Status === 'Ended' ? '' : '–'));
  } else if (it.ProductionYear) parts.push(String(it.ProductionYear));
  if (it.Type === 'Series' && it.ChildCount) parts.push(`${it.ChildCount} Season${it.ChildCount === 1 ? '' : 's'}`);
  if (it.RunTimeTicks && it.Type !== 'Series') parts.push(runtime(it.RunTimeTicks));
  if (it.OfficialRating) parts.push(`<span class="tag">${esc(it.OfficialRating)}</span>`);
  parts.push(`<span class="qtags">${qualityTags(it)}</span>`);
  if (it.Genres?.length) parts.push(esc(it.Genres.slice(0, 3).join(', ')));
  if (it.RunTimeTicks && it.Type !== 'Series') {
    const end = new Date(Date.now() + (it.RunTimeTicks - (it.UserData?.PlaybackPositionTicks || 0)) / 10000);
    parts.push(`<span class="dim">Ends at ${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>`);
  }
  return parts.map((x) => (x.startsWith('<span') ? x : `<span>${x}</span>`)).join('');
}

// Title: the show's or film's logo art when it has one, plain text otherwise.
function titleHtml(it) {
  const logo = it.Type !== 'Episode' && it.ImageTags?.Logo ? img(it.Id, 'Logo', it.ImageTags.Logo, 800) : null;
  const text = `<h1>${esc(it.Name)}</h1>`;
  if (!logo) return text;
  return `<h1 class="title-logo"><img src="${esc(logo)}" alt="${esc(it.Name)}" onerror="this.parentNode.outerHTML='${esc(text).replace(/'/g, '&#39;')}'"></h1>`;
}

// Audio / Subtitles pickers. What you pick is what the player starts with,
// and it's remembered for the whole show (or this film).
const prefKey = (it) => 'show:' + (it.SeriesId || it.Id);
const readPrefs = (it) => { try { return JSON.parse(localStorage.getItem(prefKey(it)) || '{}'); } catch { return {}; } };
const writePrefs = (it, patch) => localStorage.setItem(prefKey(it), JSON.stringify({ ...readPrefs(it), ...patch }));
const streamRef = (s) => ({ lang: s.Language || '', title: s.Title || '', forced: !!s.IsForced });
const sameRef = (s, r) => r && (s.Language || '') === r.lang && !!s.IsForced === !!r.forced && (!r.title || (s.Title || '') === r.title);

function streamLabel(s) {
  if (s.DisplayTitle) return s.DisplayTitle;
  return [s.Language, s.Codec?.toUpperCase(), s.Title].filter(Boolean).join(' · ') || `Track ${s.Index}`;
}

function streamPickersHtml(prefsOwner, media) {
  const streams = media?.MediaSources?.[0]?.MediaStreams || media?.MediaStreams || [];
  const audio = streams.filter((s) => s.Type === 'Audio');
  const subs = streams.filter((s) => s.Type === 'Subtitle');
  if (!audio.length && !subs.length) return '';
  const p = readPrefs(prefsOwner);
  const aSel = audio.findIndex((s) => sameRef(s, p.audio)) >= 0 ? audio.findIndex((s) => sameRef(s, p.audio)) : Math.max(0, audio.findIndex((s) => s.IsDefault));
  let sSel = p.sub === 'off' ? -1 : subs.findIndex((s) => sameRef(s, p.sub));
  if (sSel < 0 && p.sub !== 'off') sSel = subs.findIndex((s) => s.IsDefault || s.IsForced);
  const sel = (name, opts) => `<span class="pick-wrap"><select class="pick" data-pick="${name}">${opts}</select>${CHEV}</span>`;
  return `
    <div class="streams">
      ${audio.length > 1 || audio.length === 1 ? `<label class="stream"><span>Audio</span>${sel('audio', audio.map((s, i) => `<option value="${i}" ${i === aSel ? 'selected' : ''}>${esc(streamLabel(s))}</option>`).join(''))}</label>` : ''}
      <label class="stream"><span>Subtitles</span>${sel('sub', `<option value="off" ${sSel < 0 ? 'selected' : ''}>Off</option>${subs.map((s, i) => `<option value="${i}" ${i === sSel ? 'selected' : ''}>${esc(streamLabel(s))}</option>`).join('')}<option value="search">Search for more…</option>`)}</label>
    </div>`;
}

function wireStreamPickers(scope, prefsOwner, media) {
  const streams = media?.MediaSources?.[0]?.MediaStreams || media?.MediaStreams || [];
  const audio = streams.filter((s) => s.Type === 'Audio');
  const subs = streams.filter((s) => s.Type === 'Subtitle');
  scope.querySelector('[data-pick=audio]')?.addEventListener('change', (e) => {
    const s = audio[Number(e.target.value)];
    if (s) writePrefs(prefsOwner, { audio: streamRef(s) });
  });
  const subSel = scope.querySelector('[data-pick=sub]');
  let lastSub = subSel?.value;
  subSel?.addEventListener('change', async (e) => {
    const v = e.target.value;
    if (v === 'search') {
      e.target.value = lastSub;
      const { subtitlesDialog } = await import('./menu.js');
      subtitlesDialog(media.Id);
      return;
    }
    lastSub = v;
    writePrefs(prefsOwner, { sub: v === 'off' ? 'off' : streamRef(subs[Number(v)]) });
  });
}

// Round Mark watched / Add to favorites buttons.
function iconButtonsHtml(it) {
  const ud = it.UserData || {};
  return `
    <button class="icon-toggle ${ud.Played ? 'on' : ''}" data-toggle="played" aria-label="Mark watched">${ICON_CHECK}<span class="tip">${ud.Played ? 'Mark unwatched' : it.Type === 'Series' ? 'Mark whole show watched' : 'Mark watched'}</span></button>
    <button class="icon-toggle ${ud.IsFavorite ? 'on' : ''}" data-toggle="fav" aria-label="Add to favorites">${ICON_HEART}<span class="tip">${ud.IsFavorite ? 'Remove from favorites' : 'Add to favorites'}</span></button>
    <button class="icon-toggle cog" data-manage aria-label="Manage">${ICON_COG}<span class="tip">Manage</span></button>`;
}

function wireIconButtons(scope, it) {
  const cog = scope.querySelector('[data-manage]');
  if (cog) {
    import('./menu.js').then(({ canManage, toggleManageMenu }) => {
      canManage(it).then((ok) => { if (!ok) cog.remove(); });
      cog.addEventListener('click', (e) => { e.stopPropagation(); toggleManageMenu(it.Id, cog); });
    });
  }
  scope.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const kind = b.dataset.toggle;
    const on = !b.classList.contains('on');
    const path = kind === 'played' ? `/Users/{userId}/PlayedItems/${it.Id}` : `/Users/{userId}/FavoriteItems/${it.Id}`;
    // Change the button straight away; Emby can take a moment for a whole show.
    const setTip = (v) => { b.querySelector('.tip').textContent = kind === 'played'
      ? (v ? 'Mark unwatched' : it.Type === 'Series' ? 'Mark whole show watched' : 'Mark watched')
      : (v ? 'Remove from favorites' : 'Add to favorites'); };
    b.classList.toggle('on', on); setTip(on); b.disabled = true;
    try {
      await (on ? api.post(path) : api.del(path));
      toast(kind === 'played' ? (on ? `Marked ${it.Name} as watched` : `Marked ${it.Name} as unwatched`) : (on ? `Added ${it.Name} to Favorites` : `Removed ${it.Name} from Favorites`));
      // Only the episode list updates (in place, no reload of the page).
      if (kind === 'played') document.getElementById('epList')?._soft?.();
    } catch (e) { b.classList.toggle('on', !on); setTip(!on); toast(String(e), true); }
    b.disabled = false;
  }));
}

function personCard(p) {
  const src = p.PrimaryImageTag ? img(p.Id, 'Primary', p.PrimaryImageTag, 300) : null;
  const role = p.Role || (p.Type && p.Type !== 'Actor' ? p.Type.replace(/([a-z])([A-Z])/g, '$1 $2') : '');
  return `
    <a class="card person" href="#/person/${encodeURIComponent(p.Id)}" data-id="${esc(p.Id)}">
      <div class="art">${src ? `<img loading="lazy" src="${esc(src)}" alt="" onload="this.classList.add('loaded')" onerror="this.remove()">` : ''}<div class="ph person-ph">${PERSON_ICON}</div></div>
      <div class="title">${esc(p.Name)}</div><div class="subtitle">${esc(role)}</div>
    </a>`;
}

function castSection(it) {
  const people = (it.People || []).filter((p) => p.Id);
  if (!people.length) return '';
  const rank = (p) => (p.Type === 'Actor' || p.Type === 'GuestStar' ? 0 : p.Type === 'Director' ? 1 : p.Type === 'Writer' ? 2 : 3);
  const sorted = people.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p).slice(0, 40);
  return `<section class="section"><div class="section-head"><h2>Cast &amp; Crew</h2></div>
    <div class="row">${sorted.map(personCard).join('')}</div></section>`;
}

async function similarSection(el, ctx, it) {
  if (!['Movie', 'Series'].includes(it.Type)) return;
  await load(`/Items/${it.Id}/Similar?UserId={userId}&Limit=20&Fields=${FIELDS}&${IMG_OPTS}`, (data) => {
    const items = (Array.isArray(data) ? data : data?.Items || []);
    el.innerHTML = items.length
      ? `<section class="section"><div class="section-head"><h2>More Like This</h2></div>
          <div class="row">${items.map((i) => card(i, { shape: 'portrait' })).join('')}</div></section>`
      : '';
  }, ctx.alive).catch(() => {});
}

function renderItem(root, ctx, it, seasonId = '') {
  const ud = it.UserData || {};
  const isEp = it.Type === 'Episode';
  const isSeries = it.Type === 'Series';
  const t = it.ImageTags || {};
  let backdrop = null;
  if (it.BackdropImageTags?.length) backdrop = img(it.Id, 'Backdrop', it.BackdropImageTags[0], bigW(), 0);
  else if (it.ParentBackdropImageTags?.length) backdrop = img(it.ParentBackdropItemId, 'Backdrop', it.ParentBackdropImageTags[0], bigW(), 0);

  let poster, wide = false;
  if (isEp && t.Primary) { poster = img(it.Id, 'Primary', t.Primary, 800); wide = true; }
  else if (t.Primary) poster = img(it.Id, 'Primary', t.Primary, 600);
  else if (it.SeriesPrimaryImageTag) poster = img(it.SeriesId, 'Primary', it.SeriesPrimaryImageTag, 600);

  const kicker = isEp ? esc(epCode(it)) : '';
  const resumable = isPlayable(it) && ud.PlaybackPositionTicks > 0;
  let buttons = '';
  if (isPlayable(it)) {
    buttons = resumable
      ? `<button class="btn" data-play="${esc(it.Id)}">${PLAY_ICON} Resume</button>
         <button class="btn secondary" data-play="${esc(it.Id)}" data-from-start="1">Play from start</button>`
      : `<button class="btn" data-play="${esc(it.Id)}">${PLAY_ICON} Play</button>`;
  } else if (isSeries) {
    buttons = `<button class="btn" data-play-series="${esc(it.Id)}">${PLAY_ICON} <span class="lbl">Play</span></button>
      <button class="btn secondary" data-play-series="${esc(it.Id)}" data-from-start="1" hidden>Play from start</button>`;
  }
  const canToggle = isPlayable(it) || isSeries || it.Type === 'BoxSet';

  const facts = [];
  if (it.Genres?.length) facts.push(['Genres', it.Genres.join(', ')]);
  const directors = (it.People || []).filter((p) => p.Type === 'Director').map((p) => p.Name);
  if (directors.length && !isSeries) facts.push(['Director', directors.join(', ')]);
  const creators = (it.People || []).filter((p) => p.Type === 'Creator').map((p) => p.Name);
  if (creators.length) facts.push(['Created by', creators.join(', ')]);
  if (it.Studios?.length) facts.push([isSeries ? 'Network' : 'Studio', it.Studios.map((s) => s.Name).join(', ')]);

  root.innerHTML = `
    <div class="detail">
      <div class="backdrop">${backdrop ? `<img src="${esc(backdrop)}" alt="" onload="this.classList.add('loaded')">` : ''}</div>
      <div class="detail-main">
        <div class="detail-poster ${wide ? 'wide' : ''}">
          <div class="art">${poster ? `<img src="${esc(poster)}" alt="">` : ''}</div>
        </div>
        <div class="detail-info">
          ${crumbsHtml(it)}
          ${kicker ? `<div class="kicker">${kicker}</div>` : ''}
          ${titleHtml(it)}
          <div class="meta">${detailMeta(it)}</div>
          ${resumable && it.RunTimeTicks ? `<div class="resume-bar"><i style="width:${(100 * ud.PlaybackPositionTicks / it.RunTimeTicks).toFixed(1)}%"></i></div>` : ''}
          <div class="detail-buttons">${buttons}${canToggle ? iconButtonsHtml(it) : ''}</div>
          ${isSeries ? '<div class="play-sub" id="playSub"></div>' : ''}
          <div id="streams">${isPlayable(it) ? streamPickersHtml(it, it) : ''}</div>
          ${it.Taglines?.[0] ? `<p><i>${esc(it.Taglines[0])}</i></p>` : ''}
          <div class="overview">${esc(it.Overview || '')}</div>
          ${facts.length ? `<div class="facts">${facts.map(([k, v]) => `<span>${k}</span><b>${esc(v)}</b>`).join('')}</div>` : ''}
        </div>
      </div>
      <div id="children"></div>
      <div id="cast">${castSection(it)}</div>
      <div id="similar"></div>
    </div>`;

  root.querySelector('#backBtn').addEventListener('click', () => {
    if (history.length > 1) history.back(); else location.hash = '#/home';
  });
  wireIconButtons(root, it);
  if (isPlayable(it)) wireStreamPickers(root.querySelector('#streams'), it, it);

  if (isSeries) fillSeriesButtons(root, ctx, it);

  const kids = root.querySelector('#children');
  if (isSeries) renderSeasonBrowser(kids, ctx, it.Id, seasonId, '', root.querySelector('#crumbSeason'));
  else if (isEp) renderSeasonBrowser(kids, ctx, it.SeriesId, it.SeasonId, it.Id, null);
  else if (it.IsFolder) renderChildren(kids, ctx, it);
  similarSection(root.querySelector('#similar'), ctx, it);
}

// Show page: "Play" or "Play S1:E4", Play from start, the episode's quality
// tags and its audio / subtitle choices.
async function fillSeriesButtons(root, ctx, it) {
  const tgt = await seriesTarget(it.Id, true);
  if (!ctx.alive() || !tgt.ep) return;
  const lbl = root.querySelector('[data-play-series]:not([data-from-start]) .lbl');
  if (lbl) lbl.textContent = seriesPlayLabel(tgt);
  const fromStart = root.querySelector('[data-play-series][data-from-start]');
  if (fromStart) fromStart.hidden = !tgt.started;
  const sub = root.querySelector('#playSub');
  const e = tgt.ep;
  const left = tgt.resume && e.RunTimeTicks && e.UserData?.PlaybackPositionTicks ? `${runtime(e.RunTimeTicks - e.UserData.PlaybackPositionTicks)} left` : '';
  if (sub) sub.textContent = tgt.started ? [epCode(e), e.Name, left].filter(Boolean).join(' · ') : `Starts ${[epCode(e), e.Name].filter(Boolean).join(' · ')}`;
  // Full details of that episode for quality tags and track lists.
  try {
    const full = (await api.cached(`/Users/{userId}/Items/${e.Id}`)) || (await api.get(`/Users/{userId}/Items/${e.Id}`));
    if (!ctx.alive() || !full) return;
    const q = root.querySelector('.qtags');
    if (q) q.innerHTML = qualityTags(full);
    const box = root.querySelector('#streams');
    if (box) { box.innerHTML = streamPickersHtml(it, full); wireStreamPickers(box, it, full); }
  } catch {}
}

// Season tabs with episodes underneath, shown as a List, a Row or a Grid
// (remembered per show). Clicking a tab swaps the episodes in place.
const EP_VIEWS = [
  ['list', 'List', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="6" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="3" y="15" width="6" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 6.5h9M12 17.5h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'],
  ['row', 'Row', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="7" width="6" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="9" y="7" width="6" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="16" y="7" width="6" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>'],
  ['grid', 'Grid', '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="10" y="3" width="5" height="5" rx="1"/><rect x="17" y="3" width="4" height="5" rx="1"/><rect x="3" y="10" width="5" height="5" rx="1"/><rect x="10" y="10" width="5" height="5" rx="1"/><rect x="17" y="10" width="4" height="5" rx="1"/><rect x="3" y="17" width="5" height="4" rx="1"/><rect x="10" y="17" width="5" height="4" rx="1"/></g></svg>'],
];

async function renderSeasonBrowser(el, ctx, seriesId, wantSeasonId, currentEpId, crumbEl) {
  if (!seriesId) return;
  let selected = '';
  const viewKey = 'epView:' + seriesId;
  let view = localStorage.getItem(viewKey) || 'list';
  await load(`/Shows/${seriesId}/Seasons?UserId={userId}&Fields=${FIELDS},ChildCount`, (data) => {
    let seasons = data?.Items || [];
    // Specials go last.
    seasons = [...seasons.filter((s) => s.IndexNumber !== 0), ...seasons.filter((s) => s.IndexNumber === 0)];
    if (!seasons.length) { el.innerHTML = ''; return; }
    const many = seasons.length > 1;
    const pick =
      seasons.find((s) => s.Id === (selected || wantSeasonId)) ||
      seasons.find((s) => s.IndexNumber !== 0 && s.UserData?.UnplayedItemCount) ||
      seasons[0];
    // Shows with more than one season get an "All" tab at the end: every episode in one
    // long list. The Grid layout opens on it.
    selected = many && (selected === 'all' || (!selected && view === 'grid')) ? 'all' : pick.Id;
    const total = seasons.reduce((n, s) => n + (s.ChildCount || 0), 0);
    const tabs = many
      ? `<div class="season-tabs" role="tablist">${[...seasons, { Id: 'all', Name: 'All', ChildCount: total }].map((s) => `
          <button class="season-tab ${s.Id === selected ? 'active' : ''}" role="tab" data-season="${esc(s.Id)}" data-name="${esc(s.Name)}">
            ${esc(s.Name)}${s.ChildCount ? `<span class="n">${s.ChildCount}</span>` : ''}
          </button>`).join('')}</div>`
      : '';
    const seasonName = (id) => (id === 'all' ? 'All episodes' : (seasons.find((s) => s.Id === id) || pick).Name);
    el.innerHTML = `
      <section class="section">
        <div class="section-head"><h2>${seasons.length > 1 ? 'Episodes' : esc(pick.Name || 'Episodes')}</h2><span class="count" id="epCount"></span><span class="spacer"></span>
          <div class="seg" role="group" aria-label="Episode layout">${EP_VIEWS.map(([k, n, ic]) => `<button class="${k === view ? 'on' : ''}" data-view="${k}">${ic}${n}</button>`).join('')}</div>
        </div>
        ${tabs}
        <div class="episodes view-${view}" id="epList"></div>
      </section>`;
    const list = el.querySelector('#epList');
    const count = el.querySelector('#epCount');
    const setCrumb = (name, animate) => {
      if (!crumbEl) return;
      crumbEl.hidden = false;
      crumbEl.textContent = name;
      crumbEl.previousElementSibling?.removeAttribute('hidden');
      if (animate) { crumbEl.style.animation = 'none'; void crumbEl.offsetWidth; crumbEl.style.animation = ''; }
    };
    setCrumb(seasonName(selected), false);
    el.querySelectorAll('.season-tab').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.season === selected) return;
      selected = b.dataset.season;
      el.querySelectorAll('.season-tab').forEach((t) => t.classList.toggle('active', t === b));
      b.classList.add('live');
      setCrumb(seasonName(selected), true);
      // Keep the address in step so Back and refresh land on this season.
      if (crumbEl && selected !== 'all') history.replaceState(history.state, '', `#/item/${encodeURIComponent(seriesId)}/${encodeURIComponent(selected)}`);
      renderEpisodeList(list, count, ctx, seriesId, selected, currentEpId, true, view);
    }));
    el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.view === view) return;
      view = b.dataset.view;
      localStorage.setItem(viewKey, view);
      el.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', x === b));
      list.className = `episodes view-${view}`;
      // Picking Grid opens on All.
      if (view === 'grid' && many && selected !== 'all') {
        selected = 'all';
        el.querySelectorAll('.season-tab').forEach((t) => t.classList.toggle('active', t.dataset.season === 'all'));
        setCrumb(seasonName(selected), true);
      }
      renderEpisodeList(list, count, ctx, seriesId, selected, currentEpId, true, view);
    }));
    renderEpisodeList(list, count, ctx, seriesId, selected, currentEpId, false, view);
    // Quiet redraw after Mark watched: same list, new ticks, no entrance animation.
    list._soft = () => { list.classList.add('soft'); renderEpisodeList(list, count, ctx, seriesId, selected, currentEpId, false, view).finally(() => setTimeout(() => list.classList.remove('soft'), 400)); };
  }, ctx.alive).catch(() => {});
}

const GRID_BLOCK = 100;
let epListToken = 0;
async function renderEpisodeList(list, count, ctx, seriesId, seasonId, currentId, live, view = 'list') {
  const my = ++epListToken;
  const alive = () => ctx.alive() && my === epListToken && list.isConnected;
  list.classList.toggle('live', live);
  const all = seasonId === 'all';
  await load(`/Shows/${seriesId}/Episodes?${all ? '' : `SeasonId=${seasonId}&`}UserId={userId}&Fields=Overview,PrimaryImageAspectRatio`, (data) => {
    let eps = data?.Items || [];
    // All: specials go last, like the tabs.
    if (all) eps = [...eps.filter((e) => e.ParentIndexNumber !== 0), ...eps.filter((e) => e.ParentIndexNumber === 0)];
    // A small heading where each season starts (All only).
    const groups = [];
    for (const e of eps) { const k = e.SeasonId || e.ParentIndexNumber; if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, name: e.SeasonName || (e.ParentIndexNumber ? `Season ${e.ParentIndexNumber}` : 'Specials'), eps: [] }); groups[groups.length - 1].eps.push(e); }
    const head = (g) => (all ? `<h3 class="ep-season">${esc(g.name)}</h3>` : '');
    count.textContent = `${eps.length} episode${eps.length === 1 ? '' : 's'}`;
    const metaOf = (e) => {
      const ud = e.UserData || {};
      const left = ud.PlaybackPositionTicks && e.RunTimeTicks ? runtime(e.RunTimeTicks - ud.PlaybackPositionTicks) + ' left' : '';
      return [runtime(e.RunTimeTicks), view === 'list' && e.PremiereDate ? new Date(e.PremiereDate).toLocaleDateString() : '', left, ud.Played ? '<span class="watched">Watched</span>' : ''].filter(Boolean).join(' · ');
    };
    const num = (e) => (e.IndexNumber != null ? `${e.IndexNumber}. ` : '');
    if (view === 'grid') {
      // Every episode as a small picture with its number and name; long seasons
      // split into blocks of 100, opening on the block with your next episode.
      const upNext = eps.find((e) => e.UserData?.PlaybackPositionTicks > 0 && !e.UserData?.Played) || eps.find((e) => !e.UserData?.Played);
      const thumb = (e, i) => `
            <div class="ep-thumb ${e === upNext ? 'next' : ''} ${e.UserData?.Played ? 'watched' : ''} ${e.Id === currentId ? 'current' : ''}" data-ep="${esc(e.Id)}" title="${esc(num(e) + e.Name)}" style="animation-delay:${Math.min(i, 18) * 18}ms">
              ${card(e, { shape: 'wide', noTitle: true })}
              <span class="ep-num">${e.IndexNumber ?? '•'}</span>
              <div class="ep-name">${esc(e.Name)}</div>
            </div>`;
      if (all) {
        // Every episode, season by season, in one long grid.
        let i = 0;
        list.innerHTML = groups.map((g) => `<div class="ep-sgroup">${head(g)}<div class="ep-grid">${g.eps.map((e) => thumb(e, i++)).join('')}</div></div>`).join('');
        return;
      }
      const blocks = Math.ceil(eps.length / GRID_BLOCK);
      let block = Math.max(0, Math.floor(Math.max(0, eps.indexOf(upNext)) / GRID_BLOCK));
      const draw = () => {
        const part = eps.slice(block * GRID_BLOCK, block * GRID_BLOCK + GRID_BLOCK);
        list.innerHTML = `
          ${blocks > 1 ? `<div class="ep-blocks">${Array.from({ length: blocks }, (_, b) => {
            const a = eps[b * GRID_BLOCK], z = eps[Math.min(eps.length, (b + 1) * GRID_BLOCK) - 1];
            return `<button class="ep-block ${b === block ? 'on' : ''}" data-block="${b}">${a?.IndexNumber ?? b * GRID_BLOCK + 1}–${z?.IndexNumber ?? (b + 1) * GRID_BLOCK}</button>`;
          }).join('')}</div>` : ''}
          <div class="ep-grid">${part.map(thumb).join('')}</div>`;
        list.querySelectorAll('[data-block]').forEach((b) => b.addEventListener('click', () => { block = Number(b.dataset.block); draw(); }));
      };
      draw();
    } else if (view === 'row') {
      list.innerHTML = `<div class="row ep-row">${eps.map((e, i) => `
        <div class="ep-card ${e.Id === currentId ? 'current' : ''}" data-ep="${esc(e.Id)}" style="animation-delay:${Math.min(i, 8) * 35}ms">
          ${card(e, { shape: 'wide', noTitle: true })}
          <div class="ep-title">${num(e)}${esc(e.Name)}</div>
          <div class="ep-meta">${metaOf(e)}</div>
          <div class="ep-overview">${esc(e.Overview || '')}</div>
        </div>`).join('')}</div>`;
      const cur = list.querySelector('.ep-card.current') || list.querySelector('.ep-card:has(.progress)');
      cur?.scrollIntoView({ block: 'nearest', inline: 'start' });
    } else {
      let n = 0;
      list.innerHTML = groups.map((g) => head(g) + g.eps.map((e) => [e, n++]).map(([e, i]) => `
        <div class="episode ${e.Id === currentId ? 'current' : ''}" data-ep="${esc(e.Id)}" style="animation-delay:${Math.min(i, 10) * 35}ms">
          ${card(e, { shape: 'wide', noTitle: true })}
          <div class="ep-text">
            <div class="ep-title">${num(e)}${esc(e.Name)}</div>
            <div class="ep-meta">${metaOf(e)}</div>
            <div class="ep-overview">${esc(e.Overview || '')}</div>
          </div>
        </div>`).join('')).join('');
    }
  }, alive).catch(() => {});
}

// Episodes: the picture plays it (or resumes it); the name and text open the episode's page.
document.addEventListener('click', (e) => {
  const row = e.target.closest('#epList [data-ep]');
  if (!row || e.target.closest('[data-play], [data-block]')) return;
  e.preventDefault();
  e.stopPropagation();
  const onPicture = e.target.closest('.art') && !e.target.closest('.ep-name');
  if (onPicture) playItem(row.dataset.ep);
  else location.hash = `#/item/${encodeURIComponent(row.dataset.ep)}`;
}, true);

async function renderChildren(el, ctx, folder) {
  await load(`/Users/{userId}/Items?ParentId=${folder.Id}&SortBy=SortName&Fields=${FIELDS}&${IMG_OPTS}&Limit=500`, (data) => {
    const items = data?.Items || [];
    el.innerHTML = items.length
      ? `<section class="section"><div class="section-head"><h2>Items</h2><span class="count">${items.length}</span></div>
          <div class="grid">${items.map((i) => card(i)).join('')}</div></section>`
      : '';
  }, ctx.alive).catch(() => {});
}


// ---------------- Genres and Favorites (side menu pages) ----------------

// Every genre in your movie and TV libraries as colour tiles; a tile opens that library filtered by it.
export async function genresView(root, ctx) {
  root.innerHTML = loadingHtml();
  let vs = [];
  try { vs = ((await api.cached('/Users/{userId}/Views')) || (await api.get('/Users/{userId}/Views')))?.Items || []; } catch (e) { return ctx.fail(e); }
  const libs = vs.filter((v) => GENRE_LIBS.has(v.CollectionType) && v.CollectionType !== 'boxsets');
  if (!ctx.alive()) return;
  if (!libs.length) { root.innerHTML = '<div class="empty">No movie or TV libraries found.</div>'; return; }
  let cur = localStorage.getItem('tvGenLib');
  if (!libs.some((l) => l.Id === cur)) cur = libs[0].Id;
  root.innerHTML = `<section class="section">
      <div class="section-head"><h2>Genres</h2><span class="count" id="gcount"></span></div>
      ${libs.length > 1 ? `<div class="season-tabs">${libs.map((l) => `<button class="season-tab ${l.Id === cur ? 'active' : ''}" data-lib="${esc(l.Id)}">${esc(l.Name)}</button>`).join('')}</div>` : ''}
      <div class="tvgen-grid" id="ggrid"></div></section>`;
  const grid = root.querySelector('#ggrid'), count = root.querySelector('#gcount');
  const draw = async () => {
    const lib = libs.find((l) => l.Id === cur);
    await load(`/Genres?ParentId=${lib.Id}&UserId={userId}&SortBy=SortName&Recursive=true&IncludeItemTypes=${genreTypes(lib)}&Fields=ItemCounts`, (d) => {
      const gs = d?.Items || [];
      count.textContent = `${gs.length} genre${gs.length === 1 ? '' : 's'}`;
      grid.innerHTML = gs.map((g) => {
        const look = genreLook(g.Name), n = g.MovieCount || g.SeriesCount || g.ChildCount || 0;
        return `<a class="tvgen" href="#/library/${encodeURIComponent(lib.Id)}/${encodeURIComponent(g.Id)}" style="--c1:${look.c[0]};--c2:${look.c[1]};--c3:${look.c[2]}"><span class="gf-sym" aria-hidden="true">${look.sym}</span><b>${esc(g.Name)}</b>${n ? `<small>${n} title${n === 1 ? '' : 's'}</small>` : ''}</a>`;
      }).join('') || '<div class="empty">No genres in this library yet.</div>';
    }, ctx.alive).catch(() => {});
  };
  root.querySelectorAll('[data-lib]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.lib === cur) return;
    cur = b.dataset.lib; try { localStorage.setItem('tvGenLib', cur); } catch {}
    root.querySelectorAll('[data-lib]').forEach((x) => x.classList.toggle('active', x === b));
    draw();
  }));
  draw();
}

// Everything you've hearted, split into Movies, Shows, Episodes and Collections.
export async function favoritesView(root, ctx) {
  root.innerHTML = loadingHtml();
  await load(`/Users/{userId}/Items?Filters=IsFavorite&Recursive=true&IncludeItemTypes=Movie,Series,Episode,BoxSet&SortBy=SortName&Fields=${FIELDS}&${IMG_OPTS}&Limit=1000`, (d) => {
    const items = d?.Items || [];
    const groups = [['Movie', 'Movies'], ['Series', 'Shows'], ['Episode', 'Episodes'], ['BoxSet', 'Collections']]
      .map(([t, name]) => [name, items.filter((i) => i.Type === t)]).filter(([, l]) => l.length);
    root.innerHTML = groups.length
      ? groups.map(([name, l], k) => `<section class="section"><div class="section-head">${k === 0 ? `<h2>Favorites <span class="h-dim">· ${esc(name)}</span></h2>` : `<h2>${esc(name)}</h2>`}<span class="count">${l.length}</span></div>
          <div class="grid">${l.map((i) => card(i, i.Type === 'Episode' ? { shape: 'wide' } : {})).join('')}</div></section>`).join('')
      : `<section class="section"><div class="section-head"><h2>Favorites</h2></div><div class="empty">Nothing here yet. Press the heart on any movie or show to add it.</div></section>`;
  }, ctx.alive).catch((e) => ctx.fail(e));
}


// ---------------- Person page ----------------
// Photo, short bio, and everything on the server they appear in, split by library.

export async function personView(root, ctx, id) {
  root.innerHTML = loadingHtml();
  let p;
  try { p = (await api.cached(`/Users/{userId}/Items/${id}`)) || (await api.get(`/Users/{userId}/Items/${id}`)); }
  catch (e) { return ctx.fail(e); }
  if (!ctx.alive()) return;
  const photo = p.ImageTags?.Primary ? img(p.Id, 'Primary', p.ImageTags.Primary, 500) : null;
  const born = p.PremiereDate ? new Date(p.PremiereDate) : null;
  const facts = [born ? `Born ${born.getFullYear()}` : '', p.ProductionLocations?.[0] || ''].filter(Boolean).join(' · ');
  root.innerHTML = `
    <div class="detail person-page">
      <div class="detail-main">
        <div class="detail-poster person-photo"><div class="art">${photo ? `<img src="${esc(photo)}" alt="">` : `<div class="person-ph">${PERSON_ICON}</div>`}</div></div>
        <div class="detail-info">
          ${crumbsHtml(p)}
          <h1>${esc(p.Name)}</h1>
          ${facts ? `<div class="meta"><span>${esc(facts)}</span></div>` : ''}
          <div class="overview bio">${esc(p.Overview || '')}</div>
        </div>
      </div>
      <section class="section" id="credits">${loadingHtml()}</section>
    </div>`;
  root.querySelector('#backBtn').addEventListener('click', () => { if (history.length > 1) history.back(); else location.hash = '#/home'; });
  const box = root.querySelector('#credits');
  let views = [];
  try { views = ((await api.cached('/Users/{userId}/Views')) || (await api.get('/Users/{userId}/Views')))?.Items || []; } catch {}
  views = views.filter((v) => GENRE_LIBS.has(v.CollectionType) && v.CollectionType !== 'boxsets');
  const q = `PersonIds=${id}&Recursive=true&IncludeItemTypes=Movie,Series&SortBy=PremiereDate,ProductionYear,SortName&SortOrder=Descending&Fields=${FIELDS},People&${IMG_OPTS}&Limit=300`;
  const paths = views.map((v) => `/Users/{userId}/Items?ParentId=${v.Id}&${q}`);
  let groups = [], all = [], tab = 'all';
  const use = (answers) => { groups = views.map((v, i) => ({ v, items: answers[i]?.Items || [] })).filter((g) => g.items.length); all = groups.flatMap((g) => g.items); if (tab !== 'all' && !groups.some((g) => g.v.Id === tab)) tab = 'all'; };
  const roleOf = (it) => {
    const me = (it.People || []).find((x) => x.Id === id);
    return me?.Role || (me?.Type && me.Type !== 'Actor' ? me.Type : '') || String(it.ProductionYear || '');
  };
  const draw = () => {
    if (!all.length) { box.innerHTML = '<div class="empty">Nothing on your server with them in it yet.</div>'; return; }
    const items = tab === 'all' ? all : groups.find((g) => g.v.Id === tab)?.items || [];
    box.innerHTML = `
      <div class="section-head"><h2>On your server</h2><span class="count">${all.length} title${all.length === 1 ? '' : 's'}</span></div>
      ${groups.length > 1 ? `<div class="season-tabs">${[['all', 'All'], ...groups.map((g) => [g.v.Id, g.v.Name])].map(([k, n]) => `<button class="season-tab ${k === tab ? 'active' : ''}" data-tab="${esc(k)}">${esc(n)}</button>`).join('')}</div>` : ''}
      <div class="grid">${items.map((it) => card(it, { shape: 'portrait', subtitle: roleOf(it) })).join('')}</div>`;
    box.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  };
  // What they are in: the copy saved last time straight away, then the server's answer
  // (drawn again only if it differs).
  const saved = await Promise.all(paths.map((path) => api.cached(path).catch(() => null)));
  if (!ctx.alive()) return;
  const had = saved.length > 0 && saved.every(Boolean);
  if (had) { use(saved); draw(); }
  const fresh = await Promise.all(paths.map((path, i) => api.get(path).catch(() => saved[i])));
  if (!ctx.alive()) return;
  if (had && JSON.stringify(fresh) === JSON.stringify(saved)) return;
  if (had) quiet();
  use(fresh); draw();
}

// ---------------- Music / Audiobooks (later) ----------------

export function comingSoonView(root, text) {
  root.innerHTML = `
    <div class="coming-soon"><div>
      <h1>Coming soon</h1>
      <p>${esc(text)}</p>
    </div></div>`;
}

// Shown on a tab whose server isn't signed in yet.
export function connectView(root, kind) {
  const info = {
    emby: ['Movies & TV', 'Emby'],
    navidrome: ['Music', 'Navidrome'],
    audiobookshelf: ['Audiobooks', 'Audiobookshelf'],
  }[kind];
  root.innerHTML = `
    <div class="coming-soon"><div>
      <h1>${esc(info[0])}</h1>
      <p>Sign in to ${esc(info[1])} to see your ${esc(info[0].toLowerCase())} here.</p>
      <a class="btn" href="#/servers/${kind}">Sign in to ${esc(info[1])}</a>
    </div></div>`;
}

export { toast };
