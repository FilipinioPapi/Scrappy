// The Settings page (the cog in the top bar). Sections down the left; the Admin ones only
// show for request-service admins. Each setting is a localStorage key (see prefs.js), so the
// player's own menu and this page always agree.
import { api } from './api.js';
import { esc, toast } from './components.js';
import { pref, setPref, on } from './prefs.js';
import { mountSettings as mountUpdates, updInfo, refreshAdmin } from './updates.js';
import { book, setSpeed } from './bplayer.js';

const { invoke } = window.__TAURI__.core;
const ic = (d) => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const SECTIONS = [
  { h: 'YOU' },
  { id: 'account', name: 'Account & servers', icon: ic('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>') },
  { h: 'PLAYBACK' },
  { id: 'tv', name: 'Movies & TV', icon: ic('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9h17M8 5v4M16 5v4"/>') },
  { id: 'subs', name: 'Subtitles & audio', icon: ic('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 13h4M13 13h4M7 16h7"/>') },
  { id: 'music', name: 'Music', icon: ic('<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>') },
  { id: 'books', name: 'Audiobooks', icon: ic('<path d="M4 13a8 8 0 0 1 16 0"/><rect x="3.5" y="13" width="4" height="7" rx="1.5"/><rect x="16.5" y="13" width="4" height="7" rx="1.5"/>') },
  { h: 'APP' },
  { id: 'look', name: 'Look & feel', icon: ic('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M12 3.5a8.5 8.5 0 0 1 0 17"/>') },
  { id: 'updates', name: 'Updates', icon: ic('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>') },
  { id: 'about', name: 'About & help', icon: ic('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>') },
  { h: 'ADMIN', admin: true },
  { id: 'health', name: 'Server health', admin: true, icon: ic('<path d="M3 12h4l2-5 4 10 2-5h6"/>') },
  { id: 'requests', name: 'Requests', admin: true, icon: ic('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>') },
];
const KICKER = { account: 'SETTINGS', tv: 'PLAYBACK', subs: 'PLAYBACK', music: 'PLAYBACK', books: 'PLAYBACK', look: 'APP', updates: 'APP', about: 'APP', health: 'ADMIN', requests: 'ADMIN' };

// Same choices as the player's own menu.
const QUALITIES = [['', 'Original'], ['40000000', '40 Mbps · 4K'], ['20000000', '20 Mbps · 1080p'], ['10000000', '10 Mbps · 1080p'], ['6000000', '6 Mbps · 720p'], ['3000000', '3 Mbps · 720p'], ['1500000', '1.5 Mbps · 480p']];
const LANGS = [['eng', 'English'], ['spa', 'Spanish'], ['fre', 'French'], ['ger', 'German'], ['ita', 'Italian'], ['por', 'Portuguese'], ['dut', 'Dutch'], ['swe', 'Swedish'], ['nor', 'Norwegian'], ['dan', 'Danish'], ['fin', 'Finnish'], ['pol', 'Polish'], ['rus', 'Russian'], ['tur', 'Turkish'], ['ara', 'Arabic'], ['hin', 'Hindi'], ['jpn', 'Japanese'], ['kor', 'Korean'], ['chi', 'Chinese']];
const COUNTRIES = [['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['NZ', 'New Zealand'], ['IE', 'Ireland'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'], ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'], ['FI', 'Finland'], ['PL', 'Poland'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['JP', 'Japan'], ['KR', 'South Korea'], ['IN', 'India'], ['PH', 'Philippines'], ['ZA', 'South Africa']];

// ---------- Row helpers ----------
const head = (title, desc) => `<div class="set-tx"><b>${title}</b>${desc ? `<span class="t2">${desc}</span>` : ''}</div>`;
const row = (title, desc, control, cls = '') => `<div class="set-row${cls}">${head(title, desc)}${control}</div>`;
/** A switch for an on/off setting. key = pref key; or pass { id } for one handled by hand. */
const sw = (key, title, desc, { checked, id } = {}) => `<label class="set-row">${head(title, desc)}<span class="set-sw"><input type="checkbox" ${id ? `id="${id}"` : `data-pref="${key}"`}${(checked ?? on(key)) ? ' checked' : ''}><i></i></span></label>`;
const seg = (key, title, desc, opts, cur = pref(key)) => row(title, desc, `<div class="set-seg" data-seg="${key}">${opts.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`);
const dd = (key, title, desc, opts, cur = pref(key)) => row(title, desc, `<select class="set-dd" data-pref="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
const btn = (title, desc, label, act, cls = 'secondary') => row(title, desc, `<button type="button" class="btn small ${cls}" data-act="${act}">${label}</button>`);
const card = (grp, rows) => `${grp ? `<div class="set-grp">${grp}</div>` : ''}<div class="set-card">${rows.join('')}</div>`;
const fmtMB = (b) => (b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(1) + ' GB' : Math.max(0, Math.round(b / 1024 ** 2)) + ' MB');

// ---------- Sections ----------
const SRV = [['emby', 'Emby', 'Movies & TV', 'E'], ['navidrome', 'Navidrome', 'Music', 'N'], ['audiobookshelf', 'Audiobookshelf', 'Audiobooks', 'A']];
function accountHtml(ctx) {
  const sv = ctx.session?.servers || {};
  const srv = SRV.map(([k, name, what, letter]) => {
    const s = sv[k] || {};
    return `<div class="set-srv"><span class="set-ic">${letter}</span><div class="set-tx"><b>${name} · ${what}</b><span class="t2">${s.signedIn ? `${esc(s.user || '')}${s.name ? ' on ' + esc(s.name) : ''} · <span class="set-ok">● Connected</span>` : '<span class="set-off">Not signed in</span>'}</span></div>
      ${s.signedIn ? `<button type="button" class="btn small secondary" data-act="switch" data-k="${k}">Switch account</button><button type="button" class="btn small secondary" data-act="signout" data-k="${k}">Sign out</button>` : `<button type="button" class="btn small" data-act="switch" data-k="${k}">Sign in</button>`}</div>`;
  }).join('');
  return card('SIGNED IN', [srv]) + card('THIS PC', [
    seg('startTab', 'Start on', 'Which tab opens when Scrappy starts.', [['last', 'Last used'], ['#/home', 'Movies & TV'], ['#/music', 'Music'], ['#/audiobooks', 'Audiobooks']]),
    sw('', 'Open Scrappy when Windows starts', 'Starts quietly in the tray, ready when you are.', { id: 'setAutostart', checked: false }),
    sw('closeTray', 'Keep playing music when the window is closed', 'Closing the window hides Scrappy to the tray (by the clock) instead of quitting. Quit from the tray icon.'),
    btn('Sign out of everything', 'Removes all three accounts from this PC.', 'Sign out of all', 'signoutAll'),
  ]);
}
const seekCur = () => (pref('skipBack') === pref('skipFwd') ? pref('skipBack') : '');
const tvHtml = () => card('PLAYING', [
  sw('autoplay', 'Auto-play next episode', 'Starts the next episode when one ends.'),
  seg('upNextSecs', 'Countdown before the next episode', 'How long the “Up next” card waits.', [['5', '5s'], ['10', '10s'], ['20', '20s']]),
  sw('skipIntro', 'Skip intros automatically', 'Uses the intro markers on Emby. Off: shows a Skip Intro button.'),
  sw('skipCredits', 'Skip credits to the next episode', 'Only when Emby marks where the credits start. Otherwise Up next shows near the end, as now.'),
  sw('', 'Play in a separate mpv window', 'Opens videos in their own window instead of inside Scrappy.', { id: 'setWindow', checked: pref('playerMode') === 'window' }),
  seg('seek', 'Seek step', 'How far the arrow keys and skip buttons jump.', [['5', '5s'], ['10', '10s'], ['30', '30s']], seekCur()),
]) + card('QUALITY', [
  dd('quality', 'Streaming quality', 'Original plays the file as it is. Lower saves data and avoids buffering on a slow connection.', QUALITIES),
  dd('hwdec', 'Hardware decoding', 'Uses your graphics card for smoother playback. Turn off only if videos show glitches.', [['auto-safe', 'Auto'], ['no', 'Off']]),
]) + card('HOME SCREEN', [
  seg('heroMode', 'Home banner', 'What the big banner at the top shows.', [['picks', 'Picks for you'], ['recent', 'Recently added'], ['off', 'Off']]),
]);
const subsHtml = () => card('SUBTITLES', [
  dd('subStart', 'Which subtitles start', 'A pick you make for a show always wins.', [['default', 'Show’s own default'], ['mine', 'Always my language'], ['off', 'Off unless I turn them on']]),
  dd('subLang', 'Subtitle language', 'Used by “Always my language”, the C key and subtitle downloads.', LANGS),
  seg('subScale', 'Subtitle size', '', [['0.8', 'Small'], ['1', 'Medium'], ['1.25', 'Large'], ['1.5', 'Extra large']]),
  seg('subStyle', 'Subtitle style', 'Outline, shadow or a dark box behind the text.', [['outline', 'Outline'], ['shadow', 'Shadow'], ['box', 'Box']]),
  btn('Forget my per-show picks', 'Go back to every show’s own default.', 'Reset', 'resetSubs'),
]) + card('AUDIO', [
  dd('audioLang', 'Preferred audio language', 'Picked when a film or show has more than one.', [['', 'Original language'], ...LANGS]),
  sw('nightMode', 'Night mode', 'Evens out loud explosions and quiet voices.'),
  sw('volBoost', 'Volume boost', 'Lets the volume go up to 150% for quiet files.'),
]);
const musicHtml = () => card('PLAYING', [
  sw('gapless', 'Gapless playback', 'No silence between songs on an album.'),
  sw('rgain', 'Volume levelling', 'Keeps loud and quiet songs at a similar volume (uses the songs’ ReplayGain tags).'),
]) + card('NOW PLAYING', [
  sw('mnowviz', 'Visualizer', 'The moving bars in Now playing.'),
  sw('lyricsAuto', 'Fetch lyrics automatically', 'Looks online (LRCLIB) when Navidrome has none, without pressing the button.'),
]);
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const booksHtml = () => card('LISTENING', [
  seg('bspeed', 'Speed', 'Same as the speed button in the player.', SPEEDS.map((v) => [String(v), v + '×']), String(book.speed || 1)),
  seg('bSkip', 'Skip back / forward', 'What the skip buttons jump, in seconds.', [['10/10', '10 / 10'], ['10/30', '10 / 30'], ['15/30', '15 / 30'], ['30/30', '30 / 30']]),
  sw('bRewind', 'Rewind a little after a pause', 'Goes back 5 seconds when you carry on after a minute or more (15 after half an hour).'),
]);
const ZOOMS = [['0.9', '90%'], ['1', '100%'], ['1.1', '110%'], ['1.25', '125%']];
const lookHtml = (admin) => card('DISPLAY', [
  seg('zoom', 'App size', 'Same as Ctrl + and Ctrl −.', ZOOMS, (() => { try { return localStorage.getItem('zoom') || '1'; } catch { return '1'; } })()),
  sw('reduceMotion', 'Reduce motion', 'Fewer animations, and the home banner doesn’t slide by itself.'),
  sw('introSplash', 'Intro splash', 'The “Powered by Jaydenater” intro when Scrappy opens.'),
  admin ? sw('yirEarly', 'Show Year in Review early', 'Normally appears on December 1. Only admins see this.') : '',
]) + card('STORAGE', [
  row('Image cache', '<span id="setCache">Posters and covers kept on this PC so pages load fast.</span>', '<button type="button" class="btn small secondary" data-act="clearCache">Clear</button>'),
  dd('cacheMax', 'Cache size limit', 'The oldest pictures are removed when it gets bigger.', [['0', 'No limit'], ['500', '500 MB'], ['1024', '1 GB'], ['2048', '2 GB'], ['5120', '5 GB']]),
]);
const updatesHtml = () => `<div class="set-card" id="updSettings">
    <div class="set-row"><div class="set-tx"><b id="updVer"></b><span class="upd-state" id="updState"></span></div><button type="button" class="btn small secondary upd-check" id="updCheckBtn">Check now</button></div>
    <div class="set-row" id="updCh" hidden><div class="set-tx"><b>Update channel</b><span class="t2">Only admins see this. Everyone else gets Stable.</span></div><div class="set-seg upd-seg"><button type="button" data-ch="preview">Preview</button><button type="button" data-ch="stable">Stable</button></div></div>
    <label class="set-row"><div class="set-tx"><b>Install updates when Scrappy starts</b><span class="t2">A downloaded update installs the next time Scrappy opens. You can also install it straight away from the green Update ready button.</span></div><span class="set-sw"><input type="checkbox" id="updAuto"><i></i></span></label>
  </div>`;
const KEYS = [['Space', 'Play / pause'], ['← →', 'Skip back / forward (Shift: 1 minute)'], ['↑ ↓', 'Volume'], ['F', 'Full screen'], ['C', 'Subtitles on / off'], ['M', 'Mute'], ['N', 'Next episode'], ['E', 'Episodes'], ['B', 'Bookmark (audiobooks)'], ['Ctrl + / Ctrl −', 'App size'], ['Backspace', 'Back']];
const aboutHtml = () => card('SCRAPPY', [
  row(`Version ${esc(updInfo().current || '')}`, 'Scrappy Media Center for Emby, Navidrome and Audiobookshelf.', '<a class="btn small secondary" href="#/settings/updates">Updates</a>'),
]) + card('KEYBOARD SHORTCUTS', [`<div class="set-keys">${KEYS.map(([k, d]) => `<kbd>${esc(k)}</kbd><span>${esc(d)}</span>`).join('')}</div>`]);

// ---------- Admin: Server health ----------
const req = (method, path, body = null) => invoke('req_call', { method, path, body });
async function fillHealth(box, alive) {
  box.innerHTML = '<div class="set-grp">RIGHT NOW</div><div class="set-card"><div class="set-row"><span class="t2">Checking the servers…</span></div></div>';
  let h;
  try { const u = updInfo(); h = await req('GET', `/api/admin/health?latest=${encodeURIComponent(u.found || u.current || '')}`); }
  catch (e) { if (alive()) box.innerHTML = `<div class="set-card"><div class="set-row"><span class="set-off">Couldn't ask the request service: ${esc(String(e).replace(/^Error:\s*/, ''))}</span></div></div>`; return; }
  if (!alive()) return;
  const line = (s) => {
    const v = s.v || {};
    const bits = [v.version ? `Version ${esc(v.version)}` : ''];
    if (s.key === 'emby' && s.ok) { bits.push(`${v.watching || 0} ${v.watching === 1 ? 'person' : 'people'} watching`); bits.push(v.reporting ? 'Playback Reporting on' : 'No Playback Reporting'); }
    const st = !s.set ? '<span class="set-warn">Not set up on the request service</span>' : s.ok ? `<span class="set-ok">● Online · ${s.ms} ms</span>` : `<span class="set-off">● Not answering</span>`;
    return `<div class="set-srv"><span class="set-ic">${s.name[0]}</span><div class="set-tx"><b>${s.name}</b><span class="t2">${bits.filter(Boolean).join(' · ') || (s.ok === false ? esc(s.error || '') : '')}</span></div>${st}</div>`;
  };
  const p = h.people;
  box.innerHTML = card('RIGHT NOW', [
    h.servers.map(line).join(''),
    `<div class="set-srv"><span class="set-ic">R</span><div class="set-tx"><b>Request service</b><span class="t2">Version ${esc(h.service?.version || '')} · TMDB ${h.service?.tmdb ? 'connected' : 'not set up'}</span></div><span class="set-ok">● Online</span></div>`,
  ]) + `<div class="set-grp">WHO’S USING SCRAPPY</div>
    <div class="set-stats">${[['Active this week', p ? p.active : '–'], ['PCs this week', p ? p.devices : '–'], ['On an old version', p ? p.old : '–'], ['Open requests', h.openRequests ?? '–']].map(([l, n]) => `<div><b>${n}</b><span class="t2">${l}</span></div>`).join('')}</div>
    <div class="set-note">Comes from Emby’s own list of devices, so there’s no extra tracking. “Old version” means their Scrappy hasn’t updated to ${p?.newest ? 'version ' + esc(p.newest) : 'the newest version'} yet${p ? '' : '. Emby didn’t answer, so these are blank'}.</div>`;
}

// ---------- Admin: Requests ----------
async function fillRequests(box, alive) {
  box.innerHTML = '<div class="set-card"><div class="set-row"><span class="t2">Loading…</span></div></div>';
  let s, people = [];
  try { [s, people] = await Promise.all([req('GET', '/api/admin/settings'), req('GET', '/api/admin/people').then((r) => r.people || []).catch(() => [])]); }
  catch (e) { if (alive()) box.innerHTML = `<div class="set-card"><div class="set-row"><span class="set-off">Couldn't ask the request service: ${esc(String(e).replace(/^Error:\s*/, ''))}</span></div></div>`; return; }
  if (!alive()) return;
  const draw = () => {
    const S = s.settings, fixed = s.fixedAdmins || [];
    const chips = (list, kind, locked = []) => list.map((n) => `<span class="set-chip">${esc(n)}${locked.includes(n.toLowerCase()) ? '' : `<button type="button" data-rm="${kind}" data-n="${esc(n)}" aria-label="Remove ${esc(n)}">×</button>`}</span>`).join('');
    const taken = new Set([...fixed, ...S.admins, ...S.staff].map((x) => x.toLowerCase()));
    const addSel = (kind) => `<select class="set-dd" data-add="${kind}"><option value="">Add person +</option>${people.filter((n) => !taken.has(n.toLowerCase())).map((n) => `<option>${esc(n)}</option>`).join('')}</select>`;
    const fixedNames = people.filter((n) => fixed.includes(n.toLowerCase()));
    const sel = (key, opts) => `<select class="set-dd" data-rs="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(S[key]) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const tog = (key) => `<span class="set-sw"><input type="checkbox" data-rs="${key}"${S[key] ? ' checked' : ''}><i></i></span>`;
    box.innerHTML = card('WHO CAN MANAGE REQUESTS', [
      row('Admins', 'Can see everyone’s requests, change their status and change these settings. The ones set on the server can’t be removed here.', `<div class="set-chips">${chips([...new Set([...(fixedNames.length ? fixedNames : fixed), ...S.admins])], 'admins', fixed)}${addSel('admins')}</div>`, ' wrap'),
      row('Staff', 'Same as admins, except they can’t change these settings.', `<div class="set-chips">${chips(S.staff, 'staff')}${addSel('staff')}</div>`, ' wrap'),
    ]) + card('HOW REQUESTS WORK', [
      row('Release dates from', 'Which country’s cinema and digital release dates to show.', sel('region', COUNTRIES.some(([c]) => c === S.region) ? COUNTRIES : [[S.region, S.region], ...COUNTRIES])),
      `<label class="set-row">${head('Hide adult titles', '')}${tog('hideAdult')}</label>`,
      `<label class="set-row">${head('Mark requests Available automatically', 'When something requested shows up on a server.')}${tog('autoAvailable')}</label>`,
      row('Check for arrivals every', '', `<div class="set-seg" data-rseg="checkEvery">${[5, 10, 30].map((v) => `<button type="button" data-v="${v}" class="${S.checkEvery === v ? 'on' : ''}">${v} min</button>`).join('')}</div>`),
      row('Limit per person', 'Most open requests one person can have at once. Admins and staff have no limit.', sel('limit', [[0, 'No limit'], [3, '3'], [5, '5'], [10, '10'], [20, '20']])),
      row('Keep finished requests for', 'How long people still see requests that arrived or couldn’t be found.', sel('keepDays', [[30, '30 days'], [90, '90 days'], [180, '180 days'], [365, '1 year']])),
    ]) + card('NOTIFY ME', [
      row('Discord messages from Jaydenater', 'New requests, with buttons to mark them. Comes with the Discord step.', '<span class="set-soon">Later</span>'),
    ]) + '<div class="set-note">These used to be Docker settings on the server. Changing them here takes effect straight away; the Docker values are only the starting point now.</div>';
  };
  const save = async (patch) => {
    try { s = await req('PATCH', '/api/admin/settings', patch); toast('Saved.'); }
    catch (e) { toast(String(e).replace(/^Error:\s*/, ''), true); }
    if (alive()) draw();
  };
  box.onchange = (e) => {
    const t = e.target;
    if (t.dataset.add) { if (t.value) save({ [t.dataset.add]: [...s.settings[t.dataset.add], t.value] }); return; }
    const k = t.dataset.rs; if (!k) return;
    save({ [k]: t.type === 'checkbox' ? t.checked : (k === 'region' ? t.value : Number(t.value)) });
  };
  box.onclick = (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { const k = rm.dataset.rm; save({ [k]: s.settings[k].filter((n) => n !== rm.dataset.n) }); return; }
    const b = e.target.closest('[data-rseg] [data-v]');
    if (b) save({ checkEvery: Number(b.dataset.v) });
  };
  draw();
}

// ---------- The page ----------
export async function settingsPage(root, ctx, secId) {
  let admin = updInfo().admin;
  const visible = () => SECTIONS.filter((s) => !s.admin || admin);
  if (!SECTIONS.some((s) => s.id === secId) || (SECTIONS.find((s) => s.id === secId).admin && !admin)) secId = 'account';
  const sec = SECTIONS.find((s) => s.id === secId);
  const nav = () => visible().map((s) => (s.h ? `<div class="set-nh">${s.h}</div>` : `<a href="#/settings/${s.id}" class="${s.id === secId ? 'on' : ''}">${s.icon}<span>${s.name}</span>${s.admin ? '<em>ADMIN</em>' : ''}</a>`)).join('');
  root.innerHTML = `<div class="set-page"><nav class="set-side" id="setNav">${nav()}</nav>
    <div class="set-body"><div class="kicker">${KICKER[secId]}</div><h1 class="set-title disp">${sec.name}</h1>${secId === 'health' ? '<div class="set-note top">Only you (and other admins) see the Admin section.</div>' : ''}<div id="setSec"></div></div></div>`;
  const box = root.querySelector('#setSec');
  const draw = () => {
    box.innerHTML = { account: () => accountHtml(ctx), tv: tvHtml, subs: subsHtml, music: musicHtml, books: booksHtml, look: () => lookHtml(admin), updates: updatesHtml, about: aboutHtml, health: () => '', requests: () => '' }[secId]();
    if (secId === 'updates') mountUpdates();
    if (secId === 'health') fillHealth(box, ctx.alive);
    if (secId === 'requests') fillRequests(box, ctx.alive);
    if (secId === 'look') invoke('cache_size').then((c) => { const el = box.querySelector('#setCache'); if (el) el.textContent = `Posters and covers kept on this PC so pages load fast. Using ${fmtMB(c.bytes)}.`; }).catch(() => {});
    if (secId === 'account') invoke('autostart_get').then((v) => { const el = box.querySelector('#setAutostart'); if (el) el.checked = !!v; }).catch(() => {});
  };
  draw();
  // The admin list can change (or be unknown on first run): check, then show or hide the Admin sections.
  refreshAdmin().then((a) => { if (!ctx.alive() || a === admin) return; admin = a; if (sec.admin && !a) { location.replace('#/settings/account'); return; } root.querySelector('#setNav').innerHTML = nav(); if (secId === 'look') draw(); }).catch(() => {});

  if (secId === 'health' || secId === 'requests') return; // wired in their own fill functions

  box.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'setWindow') { setPref('playerMode', t.checked ? 'window' : 'embedded'); return; }
    if (t.id === 'setAutostart') {
      try { t.checked = await invoke('autostart_set', { on: t.checked }); toast(t.checked ? 'Scrappy will open when Windows starts.' : 'Scrappy won’t open when Windows starts.'); }
      catch (err) { t.checked = !t.checked; toast("Couldn't change it: " + err, true); }
      return;
    }
    const k = t.dataset.pref; if (!k) return;
    setPref(k, t.type === 'checkbox' ? (t.checked ? 'on' : 'off') : t.value);
    if (k === 'cacheMax' && Number(t.value)) invoke('cache_trim', { maxMb: Number(t.value) }).then(() => draw()).catch(() => {});
  });
  box.addEventListener('click', async (e) => {
    const sb = e.target.closest('[data-seg] [data-v]');
    if (sb) {
      const k = sb.closest('[data-seg]').dataset.seg, v = sb.dataset.v;
      if (k === 'seek') { setPref('skipBack', v); setPref('skipFwd', v); }
      else if (k === 'zoom') window.dispatchEvent(new CustomEvent('scrappy:zoom', { detail: Number(v) }));
      else if (k === 'bspeed') setSpeed(Number(v));
      else setPref(k, v);
      sb.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === sb));
      if (k === 'zoom') setTimeout(() => { if (ctx.alive() && secId === 'look') draw(); }, 400);
      return;
    }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'switch') location.hash = `#/servers/${b.dataset.k}`;
    else if (act === 'signout') {
      const name = SRV.find((x) => x[0] === b.dataset.k)?.[1];
      await api.serverLogout(b.dataset.k).catch((err) => toast(String(err), true));
      await ctx.refreshSession();
      toast(`Signed out of ${name}.`);
      if (ctx.alive()) settingsPage(root, { ...ctx, session: await api.session().catch(() => ctx.session) }, 'account');
    } else if (act === 'signoutAll') {
      if (!confirm('Sign out of Emby, Navidrome and Audiobookshelf on this PC?')) return;
      await api.logout().catch(() => {});
      await ctx.refreshSession();
      location.hash = '#/login';
    } else if (act === 'resetSubs') {
      let n = 0;
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (!k || !k.startsWith('tracks:')) continue;
          const v = JSON.parse(localStorage.getItem(k) || '{}');
          if (v?.sub) { delete v.sub; localStorage.setItem(k, JSON.stringify(v)); n++; }
        }
      } catch {}
      toast(n ? `Forgot your subtitle picks for ${n} ${n === 1 ? 'show' : 'shows'}.` : 'There were no picks to forget.');
    } else if (act === 'clearCache') {
      await api.clearCache().catch(() => {});
      toast('Image and library cache cleared.');
      draw();
    }
  });
}
