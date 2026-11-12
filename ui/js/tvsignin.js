// Google TV sign-in (approved mock): the three servers across the top, one question at a
// time below (address, then username, then password), and a QR code on the right so the
// sign-ins can be typed on a phone instead. After the first sign-in the next server offers
// "Same username and password". The phone page lives in src-tauri/src/pair.rs.
import { api } from './api.js';
import { esc, toast } from './components.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

export function tvLoginView(root, ctx, SERVERS, pick, firstTab) {
  let session = ctx.session || {};
  const srv = () => session.servers || {};
  let sel = SERVERS.find((x) => x.kind === pick) || SERVERS.find((x) => !srv()[x.kind]?.signedIn) || SERVERS[0];
  const st = {};                 // kind -> { step, address, user }
  let shared = null;             // { user, pass, from } from the latest sign-in on this screen
  const results = {};            // kind -> { ok, error, n } for the phone page
  let busy = false, err = '', alive = true;
  const cur = () => (st[sel.kind] ||= { step: 'addr', address: srv()[sel.kind]?.address || '', user: '' });
  const anyIn = () => Object.values(srv()).some((v) => v?.signedIn);

  root.innerHTML = `
    <div class="tvsi">
      <div class="tvsi-brand"><img src="logo.png" alt=""><div><div class="brand-name">SCRAPPY</div><div class="brand-sub">MEDIA CENTER</div></div></div>
      <div class="tvsi-tiles" id="siTiles"></div>
      <div class="tvsi-main">
        <form class="tvsi-q" id="siQ" autocomplete="off"></form>
        <div class="tvsi-qr" id="siQr" hidden><div class="tvsi-code" id="siCode"></div><b>Or use your phone</b><span>Point its camera here and type your sign-ins there. Same Wi-Fi as the TV.</span></div>
      </div>
    </div>`;
  const tiles = root.querySelector('#siTiles'), q = root.querySelector('#siQ');

  const push = () => invoke('pair_state', { state: { servers: SERVERS.map((x) => ({ kind: x.kind, name: x.name, what: x.what, signedIn: !!srv()[x.kind]?.signedIn, user: srv()[x.kind]?.user || '', address: st[x.kind]?.address || srv()[x.kind]?.address || '' })), results } }).catch(() => {});

  function drawTiles() {
    tiles.innerHTML = SERVERS.map((x) => {
      const s = srv()[x.kind] || {}, c = st[x.kind];
      const n = { addr: 1, who: 2, user: 2, pass: 3 }[c?.step] || 1;
      const status = s.signedIn ? `<span class="ok">✓ Signed in as ${esc(s.user)}</span>` : x === sel ? `<span class="set">Step ${n} of 3</span>` : '<span>Not set up</span>';
      return `<button type="button" class="tvsi-tile${x === sel ? ' sel' : ''}" data-k="${x.kind}"><small>${esc(x.what.toUpperCase())}</small><b>${x.name}</b>${status}</button>`;
    }).join('');
  }

  const btn = (id, label, cls = 'secondary', first = false) => `<button type="button" class="btn ${cls}" id="${id}"${first ? ' data-tvfirst' : ''}>${label}</button>`;
  function draw(focus = true) {
    drawTiles();
    const s = srv()[sel.kind] || {}, c = cur();
    const open = anyIn() ? btn('siOpen', 'Open Scrappy') : '';
    const skip = btn('siSkip', `Skip ${sel.name}`);
    const field = (type, val, ph) => `<input class="tvsi-in" id="siIn" type="${type}" value="${esc(val)}" placeholder="${esc(ph)}" spellcheck="false" autocapitalize="off" autocorrect="off" readonly data-tvfirst>`;
    let h;
    if (s.signedIn) {
      h = `<h1>${sel.name} is signed in</h1><p>${esc(s.user)} on ${esc(s.address || '')}</p>
        <div class="tvsi-btns">${btn('siOpen', 'Open Scrappy', '', true)}${SERVERS.some((x) => !srv()[x.kind]?.signedIn) ? btn('siSkip', 'Next server') : ''}${btn('siOut', 'Sign out')}</div>`;
    } else if (c.step === 'addr') {
      h = `<h1>Where is your ${sel.name} server?</h1><p>The same address you use for ${sel.name} in a browser.</p>
        ${field('url', c.address, 'e.g. ' + sel.eg)}
        <div class="tvsi-btns">${btn('siNext', 'Next', '')}${skip}<span class="spacer"></span>${open}</div>`;
    } else if (c.step === 'who') {
      h = `<h1>Who is signing in to ${sel.name}?</h1><p>Found your server at ${esc(c.address)}</p>
        <div class="tvsi-col">${btn('siSame', `Same username and password as ${esc(shared.from)} (${esc(shared.user)})`, '', true)}${btn('siOther', 'Type a different username')}${skip}</div>`;
    } else if (c.step === 'user') {
      h = `<h1>Your ${sel.name} username</h1><p>Found your server at ${esc(c.address)}</p>
        ${field('text', c.user, 'Username')}
        <div class="tvsi-btns">${btn('siNext', 'Next', '')}${btn('siBack', 'Back')}${skip}</div>`;
    } else {
      h = `<h1>Password for ${esc(c.user)}</h1><p>${sel.name} at ${esc(c.address)}</p>
        ${field('password', '', 'Password')}
        <div class="tvsi-btns">${btn('siNext', 'Sign in', '')}${btn('siBack', 'Back')}${skip}</div>`;
    }
    q.innerHTML = `${h}<div class="tvsi-err" id="siErr">${esc(err)}</div>`;
    q.classList.toggle('busy', busy);
    if (focus) q.querySelector('[data-tvfirst]')?.focus({ preventScroll: true });
    push();
  }

  function next() {
    const i = SERVERS.indexOf(sel);
    const rest = [...SERVERS.slice(i + 1), ...SERVERS.slice(0, i)].find((x) => !srv()[x.kind]?.signedIn);
    err = '';
    if (rest) { sel = rest; draw(); } else location.hash = firstTab(session);
  }

  async function signIn(kind, address, user, pass) {
    const name = SERVERS.find((x) => x.kind === kind).name;
    const r = await api.serverCheck(kind, address);
    session = await api.serverLogin(kind, r.address, user, pass);
    await ctx.refreshSession();
    shared = { user, pass, from: name };
    toast(`Signed in to ${name}.`);
  }

  async function act(what) {
    if (busy) return;
    const c = cur(), val = q.querySelector('#siIn')?.value ?? '';
    const run = async (label, fn) => {
      busy = true; err = ''; const b = q.querySelector('#siNext, #siSame'); if (b) b.textContent = label; q.classList.add('busy');
      try { await fn(); } catch (e) { err = String(e); } finally { busy = false; }
      if (alive) draw();
    };
    if (what === 'next' && c.step === 'addr') {
      if (!val.trim()) return;
      await run('Checking…', async () => { const r = await api.serverCheck(sel.kind, val.trim()); c.address = r.address; c.step = shared ? 'who' : 'user'; });
    } else if (what === 'next' && c.step === 'user') {
      if (!val.trim()) return;
      c.user = val.trim(); c.step = 'pass'; err = ''; draw();
    } else if (what === 'next' && c.step === 'pass') {
      const k = sel.kind;
      await run('Signing in…', async () => { await signIn(k, c.address, c.user, val); delete st[k]; });
      if (alive && srv()[k]?.signedIn) next();
    } else if (what === 'same') {
      const k = sel.kind;
      await run('Signing in…', async () => { await signIn(k, c.address, shared.user, shared.pass); delete st[k]; });
      if (alive && srv()[k]?.signedIn) next(); else if (alive && err) { c.step = 'user'; draw(); }
    } else if (what === 'back') {
      c.step = c.step === 'pass' ? 'user' : c.step === 'user' && shared ? 'who' : 'addr'; err = ''; draw();
    }
  }

  // While typing, the tiles step aside so the question, buttons and any error sit above the TV keyboard.
  function typing(inp, on) {
    if (on && inp) inp.blur();
    root.querySelector('.tvsi').classList.toggle('typing', on);
    if (!inp) return;
    inp.readOnly = !on;
    if (on) { inp.focus({ preventScroll: true }); const n = inp.value.length; try { inp.setSelectionRange(n, n); } catch {} }
  }
  // Back closes the TV keyboard without telling the box: put the screen back as it was.
  const imeGone = (e) => { if (e.detail === false) { const inp = q.querySelector('#siIn'); if (inp && !inp.readOnly) { inp.readOnly = true; root.querySelector('.tvsi')?.classList.remove('typing'); } } };
  addEventListener('tv-ime', imeGone);
  // Down from a server tile goes to its question (the box, or the first button), never past it.
  tiles.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown') return;
    const to = q.querySelector('[data-tvfirst]') || q.querySelector('button');
    if (to) { e.preventDefault(); e.stopPropagation(); to.focus({ preventScroll: true }); }
  }, true);
  q.addEventListener('focusout', (e) => { if (e.target.id === 'siIn') { e.target.readOnly = true; root.querySelector('.tvsi')?.classList.remove('typing'); } });
  q.addEventListener('click', (e) => { if (e.target.id === 'siIn' && e.target.readOnly) typing(e.target, true); });
  q.addEventListener('submit', (e) => { e.preventDefault(); act('next'); });
  q.addEventListener('keydown', (e) => {
    const inp = e.target.id === 'siIn' ? e.target : null;
    // The TV keyboard only opens when you press OK on the box, so the remote can move past it freely.
    if (e.key === 'Enter' && inp?.readOnly) { e.preventDefault(); e.stopPropagation(); typing(inp, true); return; }
    if (e.key === 'Enter' && inp) { e.preventDefault(); e.stopPropagation(); if (inp.value.trim() || cur().step === 'pass') act('next'); return; }
    // Up from the question goes to the server you are setting up.
    if (e.key === 'ArrowUp' && (inp || e.target === q.querySelector('.tvsi-col .btn'))) { e.preventDefault(); e.stopPropagation(); typing(inp, false); tiles.querySelector('.tvsi-tile.sel')?.focus({ preventScroll: true }); return; }
    if (inp && !inp.readOnly && /^Arrow(Left|Right)$/.test(e.key)) { e.stopPropagation(); return; }
    if (e.key === 'ArrowDown' && inp) { e.preventDefault(); e.stopPropagation(); typing(inp, false); q.querySelector('#siNext')?.focus({ preventScroll: true }); }
    if (e.key === 'Escape' && !srv()[sel.kind]?.signedIn && cur().step !== 'addr') { e.preventDefault(); e.stopImmediatePropagation(); act('back'); }
  }, true);
  q.addEventListener('input', (e) => { if (e.target.id === 'siIn' && cur().step === 'addr') cur().address = e.target.value; });
  q.addEventListener('click', async (e) => {
    const id = e.target.closest('button')?.id;
    if (id === 'siNext') act('next');
    else if (id === 'siSame') act('same');
    else if (id === 'siOther') { cur().step = 'user'; err = ''; draw(); }
    else if (id === 'siBack') act('back');
    else if (id === 'siSkip') next();
    else if (id === 'siOpen') location.hash = firstTab(session);
    else if (id === 'siOut') { try { session = await api.serverLogout(sel.kind); await ctx.refreshSession(); } catch (e2) { err = String(e2); } draw(); }
  });
  tiles.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    sel = SERVERS.find((x) => x.kind === b.dataset.k); err = ''; draw();
  });

  // Phone: show the QR code, and sign in with whatever the phone sends.
  let unlisten = null;
  listen('pair-login', async ({ payload: p }) => {
    const x = SERVERS.find((y) => y.kind === p?.kind); if (!x || !alive) return;
    try { await signIn(x.kind, String(p.address || ''), String(p.user || ''), String(p.pass || '')); delete st[x.kind]; results[x.kind] = { ok: true, n: p.n }; }
    catch (e) { results[x.kind] = { ok: false, error: String(e), n: p.n }; }
    if (!alive) return;
    if (sel === x && srv()[x.kind]?.signedIn && SERVERS.some((y) => !srv()[y.kind]?.signedIn)) next(); else draw(!q.contains(document.activeElement) || !q.querySelector('#siIn'));
  }).then((u) => { if (alive) unlisten = u; else u(); });
  invoke('pair_start').then((r) => {
    if (!alive || !r?.qr) return;
    root.querySelector('#siCode').innerHTML = r.qr;
    root.querySelector('#siQr').hidden = false;
    push();
  }).catch(() => {});
  ctx.onLeave?.(() => { alive = false; removeEventListener('tv-ime', imeGone); unlisten?.(); invoke('pair_stop').catch(() => {}); });

  draw();
}
