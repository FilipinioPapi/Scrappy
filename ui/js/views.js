import { api, load, img } from './api.js';
import { esc, card, toast, runtime, epCode, loadingHtml, isPlayable, PLAY_ICON } from './components.js';

const FIELDS = 'PrimaryImageAspectRatio,ProductionYear,EndDate,BasicSyncInfo';
const IMG_OPTS = 'ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Thumb';

// ---------------- Login ----------------

export function loginView(root, ctx) {
  const s = ctx.session || {};
  root.innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="loginForm" autocomplete="off">
        <h1>Scrappy</h1>
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

export async function homeView(root, ctx) {
  root.innerHTML = loadingHtml();
  await load('/Users/{userId}/Views', (data) => {
    const views = (data?.Items || []).filter((v) => v.CollectionType !== 'music');
    if (!views.length) {
      root.innerHTML = '<div class="empty">No libraries found on this server for your account.</div>';
      return;
    }
    root.innerHTML = `
      <section class="section">
        <div class="section-head"><h2>My Media</h2></div>
        <div class="row">
          ${views.map(libTile).join('')}
        </div>
      </section>
      <section class="section">
        <div class="empty" style="padding:40px 0">Continue Watching and Latest rows arrive in step 2.</div>
      </section>`;
  }, ctx.alive);
}

function libTile(v) {
  const t = v.ImageTags || {};
  const src = t.Primary ? img(v.Id, 'Primary', t.Primary, 600) : null;
  return `
    <a class="card lib-tile" href="#/library/${encodeURIComponent(v.Id)}">
      <div class="art">
        ${src ? `<img src="${esc(src)}" alt="" onload="this.classList.add('loaded')" onerror="this.remove()">` : ''}
        <div class="ph">${src ? '' : esc(v.Name)}</div>
      </div>
      <div class="title">${esc(v.Name)}</div>
    </a>`;
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

export async function libraryView(root, ctx, id) {
  root.innerHTML = loadingHtml();
  let view;
  try {
    view = (await api.cached(`/Users/{userId}/Items/${id}`)) || (await api.get(`/Users/{userId}/Items/${id}`));
  } catch (e) {
    return ctx.fail(e);
  }
  if (!ctx.alive()) return;
  const sortKey = 'sort:' + id;
  let sortIdx = Number(localStorage.getItem(sortKey) || 0);
  if (!SORTS[sortIdx]) sortIdx = 0;

  root.innerHTML = `
    <section class="section">
      <div class="section-head">
        <h2>${esc(view.Name)}</h2><span class="count" id="count"></span>
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
    return `/Users/{userId}/Items?ParentId=${id}&${libraryQuery(view)}&SortBy=${by},SortName&SortOrder=${order}&Fields=${FIELDS}&${IMG_OPTS}&Limit=${PAGE}`;
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

export async function itemView(root, ctx, id) {
  root.innerHTML = loadingHtml();
  try {
    await load(`/Users/{userId}/Items/${id}`, (it) => renderItem(root, ctx, it), ctx.alive);
  } catch (e) {
    ctx.fail(e);
  }
}

function metaLine(it) {
  const parts = [];
  if (it.Type === 'Episode' && it.PremiereDate) parts.push(new Date(it.PremiereDate).toLocaleDateString());
  else if (it.ProductionYear) parts.push(String(it.ProductionYear));
  if (it.RunTimeTicks && it.Type !== 'Series') parts.push(runtime(it.RunTimeTicks));
  if (it.OfficialRating) parts.push(`<span class="rating">${esc(it.OfficialRating)}</span>`);
  if (it.CommunityRating) parts.push(`<span><span class="star">★</span> ${it.CommunityRating.toFixed(1)}</span>`);
  if (it.Type === 'Series' && it.Status) parts.push(esc(it.Status === 'Continuing' ? 'Ongoing' : it.Status));
  if (it.RunTimeTicks && it.Type !== 'Series') {
    const end = new Date(Date.now() + (it.RunTimeTicks - (it.UserData?.PlaybackPositionTicks || 0)) / 10000);
    parts.push(`Ends at ${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  }
  return parts.join('');
}

function renderItem(root, ctx, it) {
  const ud = it.UserData || {};
  const isEp = it.Type === 'Episode';
  const t = it.ImageTags || {};
  let backdrop = null;
  if (it.BackdropImageTags?.length) backdrop = img(it.Id, 'Backdrop', it.BackdropImageTags[0], 1920, 0);
  else if (it.ParentBackdropImageTags?.length) backdrop = img(it.ParentBackdropItemId, 'Backdrop', it.ParentBackdropImageTags[0], 1920, 0);

  let poster, wide = false;
  if (isEp && t.Primary) { poster = img(it.Id, 'Primary', t.Primary, 800); wide = true; }
  else if (t.Primary) poster = img(it.Id, 'Primary', t.Primary, 600);
  else if (it.SeriesPrimaryImageTag) poster = img(it.SeriesId, 'Primary', it.SeriesPrimaryImageTag, 600);

  let kicker = '';
  if (isEp) kicker = `<a href="#/item/${esc(it.SeriesId)}">${esc(it.SeriesName)}</a> · ${esc(epCode(it))}`;
  else if (it.Type === 'Season') kicker = `<a href="#/item/${esc(it.SeriesId)}">${esc(it.SeriesName)}</a>`;

  const resumable = isPlayable(it) && ud.PlaybackPositionTicks > 0;
  let buttons = '';
  if (isPlayable(it)) {
    buttons = resumable
      ? `<button class="btn" data-play="${esc(it.Id)}">${PLAY_ICON} Resume</button>
         <button class="btn secondary" data-play="${esc(it.Id)}" data-from-start="1">Play from start</button>`
      : `<button class="btn" data-play="${esc(it.Id)}">${PLAY_ICON} Play</button>`;
  }

  const facts = [];
  if (it.Genres?.length) facts.push(['Genres', it.Genres.join(', ')]);
  const directors = (it.People || []).filter((p) => p.Type === 'Director').map((p) => p.Name);
  if (directors.length) facts.push(['Director', directors.join(', ')]);
  if (it.Studios?.length) facts.push(['Studio', it.Studios.map((s) => s.Name).join(', ')]);
  const cast = (it.People || []).filter((p) => p.Type === 'Actor').slice(0, 6).map((p) => p.Name);
  if (cast.length) facts.push(['Cast', cast.join(', ')]);

  root.innerHTML = `
    <div class="detail">
      <div class="backdrop">${backdrop ? `<img src="${esc(backdrop)}" alt="" onload="this.classList.add('loaded')">` : ''}</div>
      <div class="detail-main">
        <div class="detail-poster ${wide ? 'wide' : ''}">
          <div class="art">${poster ? `<img src="${esc(poster)}" alt="">` : ''}</div>
        </div>
        <div class="detail-info">
          ${kicker ? `<div class="kicker">${kicker}</div>` : ''}
          <h1>${esc(it.Name)}</h1>
          <div class="meta">${metaLine(it)}</div>
          ${resumable && it.RunTimeTicks ? `<div class="resume-bar"><i style="width:${(100 * ud.PlaybackPositionTicks / it.RunTimeTicks).toFixed(1)}%"></i></div>` : ''}
          <div class="detail-buttons">${buttons}</div>
          ${it.Taglines?.[0] ? `<p><i>${esc(it.Taglines[0])}</i></p>` : ''}
          <div class="overview">${esc(it.Overview || '')}</div>
          ${facts.length ? `<div class="facts">${facts.map(([k, v]) => `<span>${k}</span><b>${esc(v)}</b>`).join('')}</div>` : ''}
        </div>
      </div>
      <div id="children"></div>
    </div>`;

  const kids = root.querySelector('#children');
  if (it.Type === 'Series') renderSeasons(kids, ctx, it);
  else if (it.Type === 'Season') renderEpisodes(kids, ctx, it.SeriesId, it.Id, 'Episodes');
  else if (isEp) renderEpisodes(kids, ctx, it.SeriesId, it.SeasonId, it.SeasonName || 'More from this season', it.Id);
  else if (it.IsFolder) renderChildren(kids, ctx, it);
}

async function renderSeasons(el, ctx, series) {
  await load(`/Shows/${series.Id}/Seasons?UserId={userId}&Fields=${FIELDS}`, (data) => {
    const seasons = data?.Items || [];
    el.innerHTML = seasons.length
      ? `<section class="section"><div class="section-head"><h2>Seasons</h2><span class="count">${seasons.length}</span></div>
          <div class="row">${seasons.map((s) => card(s, { shape: 'portrait', subtitle: s.UserData?.UnplayedItemCount ? `${s.UserData.UnplayedItemCount} unwatched` : '' })).join('')}</div></section>`
      : '';
  }, ctx.alive).catch(() => {});
}

async function renderEpisodes(el, ctx, seriesId, seasonId, heading, currentId) {
  if (!seriesId || !seasonId) return;
  await load(`/Shows/${seriesId}/Episodes?SeasonId=${seasonId}&UserId={userId}&Fields=Overview,PrimaryImageAspectRatio`, (data) => {
    const eps = data?.Items || [];
    el.innerHTML = `
      <section class="section"><div class="section-head"><h2>${esc(heading)}</h2><span class="count">${eps.length} episodes</span></div>
        <div class="episodes">
          ${eps.map((e) => `
            <div class="episode" data-href="#/item/${esc(e.Id)}" ${e.Id === currentId ? 'style="background:var(--bg-2)"' : ''}>
              ${card(e, { shape: 'wide', noTitle: true })}
              <div class="ep-text">
                <div class="ep-title">${e.IndexNumber != null ? `${e.IndexNumber}. ` : ''}${esc(e.Name)}</div>
                <div class="ep-meta">${[runtime(e.RunTimeTicks), e.PremiereDate ? new Date(e.PremiereDate).toLocaleDateString() : ''].filter(Boolean).join(' · ')}</div>
                <div class="ep-overview">${esc(e.Overview || '')}</div>
              </div>
            </div>`).join('')}
        </div></section>`;
    el.querySelectorAll('.episode').forEach((row) =>
      row.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-play]') || ev.target.closest('a')) return;
        location.hash = row.dataset.href;
      }));
  }, ctx.alive).catch(() => {});
}

async function renderChildren(el, ctx, folder) {
  await load(`/Users/{userId}/Items?ParentId=${folder.Id}&SortBy=SortName&Fields=${FIELDS}&${IMG_OPTS}&Limit=500`, (data) => {
    const items = data?.Items || [];
    el.innerHTML = items.length
      ? `<section class="section"><div class="section-head"><h2>Items</h2><span class="count">${items.length}</span></div>
          <div class="grid">${items.map((i) => card(i)).join('')}</div></section>`
      : '';
  }, ctx.alive).catch(() => {});
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

// ---------------- Listen ----------------

export function listenView(root) {
  root.innerHTML = `
    <div class="coming-soon"><div>
      <h1>Coming soon</h1>
      <p>Music from Navidrome will live here.</p>
    </div></div>`;
}

export { toast };
