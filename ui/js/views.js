import { api, load, img, imgAny } from './api.js';
import { esc, card, toast, runtime, epCode, loadingHtml, isPlayable, PLAY_ICON, seriesTarget, seriesPlayLabel, playItem } from './components.js';

const FIELDS = 'PrimaryImageAspectRatio,ProductionYear,EndDate,BasicSyncInfo';
const IMG_OPTS = 'ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Thumb';

// ---------------- Login ----------------

export function loginView(root, ctx) {
  const s = ctx.session || {};
  root.innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="loginForm" autocomplete="off">
        <img class="login-logo" src="logo.png" alt="">
        <h1>Scrappy<small>MEDIA CENTER</small></h1>
        <p class="sub">Sign in to your Emby server</p>
        <div class="field">
          <label for="server">Server address</label>
          <input type="text" id="server" placeholder="e.g. 192.168.1.20:8096" value="${esc(s.server || '')}" spellcheck="false">
          <div class="hint">The same address you use for Emby in a browser.</div>
        </div>
        <div class="field">
          <label for="username">Username</label>
          <input type="text" id="username" value="${esc(s.userName || '')}" spellcheck="false">
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input type="password" id="password">
        </div>
        <button class="btn" type="submit" id="loginBtn">Sign in</button>
        <div class="error" id="loginError"></div>
      </form>
    </div>`;
  const form = root.querySelector('#loginForm');
  const btn = root.querySelector('#loginBtn');
  const err = root.querySelector('#loginError');
  (s.server ? root.querySelector(s.userName ? '#password' : '#username') : root.querySelector('#server')).focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await api.login(form.server.value, form.username.value, form.password.value);
      location.hash = '#/home';
      ctx.refreshSession();
    } catch (e2) {
      err.textContent = String(e2);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
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
    root.innerHTML = `
      <div data-row="hero"></div>
      <div data-row="resume"></div>
      <section class="section">
        <div class="section-head"><h2>Library</h2></div>
        <div class="row">${views.map(libTile).join('')}</div>
      </section>
      ${views.filter((v) => !NO_LATEST.has(v.CollectionType)).map((v) => `<div data-row="latest-${esc(v.Id)}"></div>`).join('')}
      <div data-row="genres"></div>`;
    root.querySelectorAll('[data-row]').forEach((r) => {
      if (oldRows[r.dataset.row]) r.replaceWith(oldRows[r.dataset.row]);
    });
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

// ---------------- Browse by genre ----------------
// One tab per Movies / TV library (so TV shows and anime stay apart), each with
// a row per genre, biggest genres first. Rows fill in as you scroll to them.

const GENRE_LIBS = new Set(['movies', 'tvshows', 'mixed', undefined, null, '']);
const GENRE_MIN = 6;

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
    const list = counted.filter((x) => x.n >= GENRE_MIN).sort((a, b) => b.n - a.n);
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
async function buildHero(root, ctx) {
  const slot = root.querySelector('[data-row=hero]');
  if (!slot) return;
  const my = ++heroGen;
  try {
    await fillHero(slot, ctx, my);
  } catch (e) {
    // Never let one odd item take the whole banner down.
    console.error('banner', e);
  }
}

async function fillHero(slot, ctx, my) {
  let P;
  try { P = await heroPools(); } catch { P = {}; }
  for (const k of ['pickBack', 'newEps', 'because', 'added', 'never', 'oldFavs']) P[k] = P[k] || [];
  if (my !== heroGen || !ctx.alive()) return;
  // Take turns from each reason so the banner is a mix; at most 2 "pick back up".
  const order = [P.pickBack, P.newEps, P.because, P.added, P.never, P.oldFavs];
  const caps = new Map([[P.pickBack, 2]]);
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
      c.url = img(b.id, 'Backdrop', b.tag, 1920, 0);
      return backdropIsGood(c.url);
    }));
    if (my !== heroGen || !ctx.alive()) return;
    batch.forEach((c, k) => { if (ok[k] && picks.length < HERO_SLIDES) picks.push(c); });
  }
  // Nothing usable this time: keep whatever banner is already showing.
  if (!picks.length) return;
  const seriesInfo = {};
  await Promise.all(picks.filter((p) => p.it.Type === 'Episode' && p.it.SeriesId).map(async (p) => {
    try { seriesInfo[p.it.SeriesId] = (await api.cached(`/Users/{userId}/Items/${p.it.SeriesId}`)) || (await api.get(`/Users/{userId}/Items/${p.it.SeriesId}`)); } catch {}
  }));
  if (my !== heroGen || !ctx.alive()) return;
  renderHero(slot, ctx, picks, seriesInfo);
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
  const many = picks.length > 1;
  slot.innerHTML = `
    <section class="hero">
      <div class="hero-slide fwd">${slide(picks[0])}</div>
      ${many ? `<button class="hero-arrow l" aria-label="Previous">${CHEVRON_L}</button><button class="hero-arrow r" aria-label="Next">${CHEVRON_R}</button>` : ''}
      ${many ? `<div class="hero-dots">${picks.map((_, n) => `<button class="hero-dot ${n === 0 ? 'on' : ''}" data-n="${n}" aria-label="Show item ${n + 1}"></button>`).join('')}</div>` : ''}
    </section>`;
  const box = slot.querySelector('.hero-slide');
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
    slot.querySelectorAll('.hero-dot').forEach((d, k) => d.classList.toggle('on', k === i));
    fillSeriesLabel();
  };
  fillSeriesLabel();
  slot.querySelectorAll('.hero-dot').forEach((d) => d.addEventListener('click', () => { const n = Number(d.dataset.n); show(n, n >= i ? 'fwd' : 'back'); restart(); }));
  slot.querySelector('.hero-arrow.l')?.addEventListener('click', () => { show(i - 1, 'back'); restart(); });
  slot.querySelector('.hero-arrow.r')?.addEventListener('click', () => { show(i + 1, 'fwd'); restart(); });
  let paused = false;
  slot.querySelector('.hero').addEventListener('mouseenter', () => (paused = true));
  slot.querySelector('.hero').addEventListener('mouseleave', () => (paused = false));
  const restart = () => {
    clearInterval(heroTimer);
    if (many) heroTimer = setInterval(() => { if (!ctx.alive()) { clearInterval(heroTimer); return; } if (!paused && !document.hidden) show(i + 1); }, 8000);
  };
  restart();
  ctx.onLeave(() => clearInterval(heroTimer));
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

export async function itemView(root, ctx, id, seasonId = '') {
  root.innerHTML = loadingHtml();
  let moved = false;
  try {
    await load(`/Users/{userId}/Items/${id}`, (it) => {
      // A season opens as its show's page with that season's tab picked,
      // so every season stays one click away.
      if (it.Type === 'Season' && it.SeriesId) {
        if (!moved) { moved = true; location.replace(`#/item/${encodeURIComponent(it.SeriesId)}/${encodeURIComponent(it.Id)}`); }
        return;
      }
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
    <button class="icon-toggle ${ud.IsFavorite ? 'on' : ''}" data-toggle="fav" aria-label="Add to favorites">${ICON_HEART}<span class="tip">${ud.IsFavorite ? 'Remove from favorites' : 'Add to favorites'}</span></button>`;
}

function wireIconButtons(scope, it) {
  scope.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const kind = b.dataset.toggle;
    const on = !b.classList.contains('on');
    const path = kind === 'played' ? `/Users/{userId}/PlayedItems/${it.Id}` : `/Users/{userId}/FavoriteItems/${it.Id}`;
    try {
      await (on ? api.post(path) : api.del(path));
      b.classList.toggle('on', on);
      b.querySelector('.tip').textContent = kind === 'played'
        ? (on ? 'Mark unwatched' : it.Type === 'Series' ? 'Mark whole show watched' : 'Mark watched')
        : (on ? 'Remove from favorites' : 'Add to favorites');
      toast(kind === 'played' ? (on ? `Marked ${it.Name} as watched` : `Marked ${it.Name} as unwatched`) : (on ? `Added ${it.Name} to Favorites` : `Removed ${it.Name} from Favorites`));
      if (kind === 'played') window.dispatchEvent(new Event('scrappy:refresh'));
    } catch (e) { toast(String(e), true); }
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
  if (it.BackdropImageTags?.length) backdrop = img(it.Id, 'Backdrop', it.BackdropImageTags[0], 1920, 0);
  else if (it.ParentBackdropImageTags?.length) backdrop = img(it.ParentBackdropItemId, 'Backdrop', it.ParentBackdropImageTags[0], 1920, 0);

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
    const pick =
      seasons.find((s) => s.Id === (selected || wantSeasonId)) ||
      seasons.find((s) => s.IndexNumber !== 0 && s.UserData?.UnplayedItemCount) ||
      seasons[0];
    selected = pick.Id;
    const tabs = seasons.length > 1
      ? `<div class="season-tabs" role="tablist">${seasons.map((s) => `
          <button class="season-tab ${s.Id === selected ? 'active' : ''}" role="tab" data-season="${esc(s.Id)}" data-name="${esc(s.Name)}">
            ${esc(s.Name)}${s.ChildCount ? `<span class="n">${s.ChildCount}</span>` : ''}
          </button>`).join('')}</div>`
      : '';
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
    setCrumb(pick.Name, false);
    el.querySelectorAll('.season-tab').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.season === selected) return;
      selected = b.dataset.season;
      el.querySelectorAll('.season-tab').forEach((t) => t.classList.toggle('active', t === b));
      b.classList.add('live');
      setCrumb(b.dataset.name, true);
      // Keep the address in step so Back and refresh land on this season.
      if (crumbEl) history.replaceState(null, '', `#/item/${encodeURIComponent(seriesId)}/${encodeURIComponent(selected)}`);
      renderEpisodeList(list, count, ctx, seriesId, selected, currentEpId, true, view);
    }));
    el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.view === view) return;
      view = b.dataset.view;
      localStorage.setItem(viewKey, view);
      el.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', x === b));
      list.className = `episodes view-${view}`;
      renderEpisodeList(list, count, ctx, seriesId, selected, currentEpId, true, view);
    }));
    renderEpisodeList(list, count, ctx, seriesId, selected, currentEpId, false, view);
  }, ctx.alive).catch(() => {});
}

const GRID_BLOCK = 100;
let epListToken = 0;
async function renderEpisodeList(list, count, ctx, seriesId, seasonId, currentId, live, view = 'list') {
  const my = ++epListToken;
  const alive = () => ctx.alive() && my === epListToken && list.isConnected;
  list.classList.toggle('live', live);
  await load(`/Shows/${seriesId}/Episodes?SeasonId=${seasonId}&UserId={userId}&Fields=Overview,PrimaryImageAspectRatio`, (data) => {
    const eps = data?.Items || [];
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
      const blocks = Math.ceil(eps.length / GRID_BLOCK);
      let block = Math.max(0, Math.floor(Math.max(0, eps.indexOf(upNext)) / GRID_BLOCK));
      const draw = () => {
        const part = eps.slice(block * GRID_BLOCK, block * GRID_BLOCK + GRID_BLOCK);
        list.innerHTML = `
          ${blocks > 1 ? `<div class="ep-blocks">${Array.from({ length: blocks }, (_, b) => {
            const a = eps[b * GRID_BLOCK], z = eps[Math.min(eps.length, (b + 1) * GRID_BLOCK) - 1];
            return `<button class="ep-block ${b === block ? 'on' : ''}" data-block="${b}">${a?.IndexNumber ?? b * GRID_BLOCK + 1}–${z?.IndexNumber ?? (b + 1) * GRID_BLOCK}</button>`;
          }).join('')}</div>` : ''}
          <div class="ep-grid">${part.map((e, i) => `
            <div class="ep-thumb ${e === upNext ? 'next' : ''} ${e.UserData?.Played ? 'watched' : ''} ${e.Id === currentId ? 'current' : ''}" data-ep="${esc(e.Id)}" title="${esc(num(e) + e.Name)}" style="animation-delay:${Math.min(i, 18) * 18}ms">
              ${card(e, { shape: 'wide', noTitle: true })}
              <span class="ep-num">${e.IndexNumber ?? '•'}</span>
              <div class="ep-name">${esc(e.Name)}</div>
            </div>`).join('')}</div>`;
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
      list.innerHTML = eps.map((e, i) => `
        <div class="episode ${e.Id === currentId ? 'current' : ''}" data-ep="${esc(e.Id)}" style="animation-delay:${Math.min(i, 10) * 35}ms">
          ${card(e, { shape: 'wide', noTitle: true })}
          <div class="ep-text">
            <div class="ep-title">${num(e)}${esc(e.Name)}</div>
            <div class="ep-meta">${metaOf(e)}</div>
            <div class="ep-overview">${esc(e.Overview || '')}</div>
          </div>
        </div>`).join('');
    }
  }, alive).catch(() => {});
}

// Clicking anywhere on an episode plays it (or resumes it if you're part-way).
document.addEventListener('click', (e) => {
  const row = e.target.closest('#epList [data-ep]');
  if (!row || e.target.closest('[data-play], [data-block]')) return;
  e.preventDefault();
  e.stopPropagation();
  playItem(row.dataset.ep);
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
  const groups = (await Promise.all(views.map(async (v) => {
    try { const d = await api.get(`/Users/{userId}/Items?ParentId=${v.Id}&${q}`); return { v, items: d?.Items || [] }; }
    catch { return { v, items: [] }; }
  }))).filter((g) => g.items.length);
  if (!ctx.alive()) return;
  const all = groups.flatMap((g) => g.items);
  if (!all.length) { box.innerHTML = '<div class="empty">Nothing on your server with them in it yet.</div>'; return; }
  const roleOf = (it) => {
    const me = (it.People || []).find((x) => x.Id === id);
    return me?.Role || (me?.Type && me.Type !== 'Actor' ? me.Type : '') || String(it.ProductionYear || '');
  };
  let tab = 'all';
  const draw = () => {
    const items = tab === 'all' ? all : groups.find((g) => g.v.Id === tab)?.items || [];
    box.innerHTML = `
      <div class="section-head"><h2>On your server</h2><span class="count">${all.length} title${all.length === 1 ? '' : 's'}</span></div>
      ${groups.length > 1 ? `<div class="season-tabs">${[['all', 'All'], ...groups.map((g) => [g.v.Id, g.v.Name])].map(([k, n]) => `<button class="season-tab ${k === tab ? 'active' : ''}" data-tab="${esc(k)}">${esc(n)}</button>`).join('')}</div>` : ''}
      <div class="grid">${items.map((it) => card(it, { shape: 'portrait', subtitle: roleOf(it) })).join('')}</div>`;
    box.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  };
  draw();
}

// ---------------- Search ----------------

export function searchView(root, ctx) {
  root.innerHTML = `
    <section class="section">
      <div class="search-box"><input type="search" id="q" placeholder="Search movies, shows and episodes" spellcheck="false"></div>
      <div id="results"></div>
    </section>`;
  const q = root.querySelector('#q');
  const out = root.querySelector('#results');
  q.value = sessionStorage.getItem('lastSearch') || '';
  q.focus();
  let timer, seq = 0;
  const run = async () => {
    const term = q.value.trim();
    sessionStorage.setItem('lastSearch', term);
    if (term.length < 2) { out.innerHTML = ''; return; }
    const my = ++seq;
    try {
      const data = await api.get(`/Users/{userId}/Items?SearchTerm=${encodeURIComponent(term)}&Recursive=true&IncludeItemTypes=Movie,Series,Episode,BoxSet&Limit=80&Fields=${FIELDS}&${IMG_OPTS}`);
      if (my !== seq || !ctx.alive()) return;
      const items = data.Items || [];
      if (!items.length) { out.innerHTML = `<div class="empty">Nothing found for “${esc(term)}”.</div>`; return; }
      const groups = [['Movie', 'Movies'], ['Series', 'Shows'], ['BoxSet', 'Collections'], ['Episode', 'Episodes']];
      out.innerHTML = groups.map(([type, label]) => {
        const g = items.filter((i) => i.Type === type);
        if (!g.length) return '';
        return `<div class="section-head" style="margin-top:10px"><h2>${label}</h2><span class="count">${g.length}</span></div>
          <div class="grid ${type === 'Episode' ? 'wide' : ''}" style="margin-bottom:28px">${g.map((i) => card(i)).join('')}</div>`;
      }).join('');
    } catch (e) {
      ctx.fail(e, true);
    }
  };
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  if (q.value) run();
}

// ---------------- Music / Audiobooks (later) ----------------

export function comingSoonView(root, text) {
  root.innerHTML = `
    <div class="coming-soon"><div>
      <h1>Coming soon</h1>
      <p>${esc(text)}</p>
    </div></div>`;
}

export { toast };
