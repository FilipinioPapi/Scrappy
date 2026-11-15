// Scrappy Native: what the native sign-in screen asks for (Signin.kt draws it). Checks an address,
// signs in, skips a server, and runs the phone page (pair.rs) while the screen is open. The last
// username and password used here are kept in memory only, for "Same username and password", and
// are dropped when the screen closes. Nothing here is ever saved.
import { api } from './api.js';
import { SERVERS, firstTab } from './views.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const SAVED = 'tvSigninAddr';
const saved = () => { try { return JSON.parse(localStorage.getItem(SAVED) || '{}'); } catch { return {}; } };
const remember = (kind, v) => { const s = saved(); if (v) s[kind] = v; else delete s[kind]; try { localStorage.setItem(SAVED, JSON.stringify(s)); } catch {} };

let shared = null;        // { user, pass, from, kind }
let results = {};         // kind -> { ok, error, n, phase, address } for the phone page
let skipped = {};
let checked = {};         // kind -> address the phone checked
let qr = null, on = false, unl = [];

const nameOf = (kind) => SERVERS.find((x) => x.kind === kind)?.name || kind;

async function model() {
  const s = await invoke('get_session');
  const sv = s.servers || {};
  const pic = shared?.kind === 'emby' && s.userId && s.server ? `${s.server}/Users/${encodeURIComponent(s.userId)}/Images/Primary?maxWidth=160&quality=90` : '';
  return {
    servers: SERVERS.map((x) => ({ kind: x.kind, name: x.name, what: x.what, eg: x.eg, signedIn: !!sv[x.kind]?.signedIn, user: sv[x.kind]?.user || '',
      address: sv[x.kind]?.address || '', saved: !sv[x.kind]?.signedIn ? saved()[x.kind] || null : null, skipped: !!skipped[x.kind] })),
    shared: shared ? { from: shared.from, user: shared.user, pic } : null,
    qr,
  };
}

async function signIn(kind, address, user, pass) {
  const r = await api.serverCheck(kind, address);
  await api.serverLogin(kind, r.address, user, pass);
  await window.__refreshSession?.();
  shared = { user, pass, from: nameOf(kind), kind };
  remember(kind, null);
  delete skipped[kind];
}

// The phone page's view of things (pair.rs serves it from here).
async function pushPhone(m) {
  const servers = m.servers.map((x) => ({ kind: x.kind, name: x.name, what: x.what, signedIn: x.signedIn, user: x.user, skipped: x.skipped,
    address: checked[x.kind] || x.saved?.address || x.address || '', checked: !!checked[x.kind] }));
  await invoke('pair_state', { state: { v: 2, servers, results, same: !!shared } }).catch(() => {});
}

async function push(ev) {
  const m = await model();
  pushPhone(m);
  if (ev) { try { window.ScrappyNative.signPush(JSON.stringify({ ...m, ev })); } catch {} }
  return m;
}

async function fromPhone(p) {
  const kind = SERVERS.find((y) => y.kind === p?.kind)?.kind;
  if (!kind || !on) return;
  try {
    // A sign-in that the phone typed. Same as the remote, and "same" reuses the last one.
    const user = p.same && shared ? shared.user : String(p.user || ''), pass = p.same && shared ? shared.pass : String(p.pass || '');
    await signIn(kind, String(p.address || ''), user, pass);
    results[kind] = { ok: true, n: p.n, phase: 'login' };
    push({ kind, what: 'login', ok: true });
  } catch (e) {
    results[kind] = { ok: false, error: String(e), n: p.n, phase: 'login' };
    push({ kind, what: 'login', ok: false, err: String(e) });
  }
}

async function phoneAct(p) {
  if (!on) return;
  const kind = SERVERS.find((y) => y.kind === p?.kind)?.kind;
  if (p?.act === 'open') { const s = await invoke('get_session'); location.hash = firstTab(s); return; }
  if (!kind) return;
  if (p.act === 'check') {
    try {
      const r = await api.serverCheck(kind, String(p.address || '').trim());
      checked[kind] = r.address; remember(kind, { address: r.address, ok: true });
      results[kind] = { ok: true, n: p.n, phase: 'check', address: r.address };
      push({ kind, what: 'check', ok: true, address: r.address });
    } catch (e) {
      results[kind] = { ok: false, error: String(e), n: p.n, phase: 'check' };
      push({ kind, what: 'check', ok: false, err: String(e) });
    }
  } else if (p.act === 'skip' || p.act === 'unskip') {
    if (p.act === 'skip') skipped[kind] = true; else delete skipped[kind];
    push({ kind, what: 'skip' });
  } else if (p.act === 'change') {
    delete checked[kind]; push({ kind, what: 'change' });
  }
}

export async function act(a, x = {}) {
  if (a === 'start') {
    if (!on) {
      on = true; results = {}; skipped = {}; checked = {};
      unl.push(await listen('pair-login', ({ payload }) => fromPhone(payload)));
      unl.push(await listen('pair-act', ({ payload }) => phoneAct(payload)));
      try { const r = await invoke('pair_start'); qr = Array.isArray(r?.modules) ? r.modules : null; } catch { qr = null; }
    }
    return push();
  }
  if (a === 'stop') {
    on = false; shared = null; results = {}; skipped = {}; checked = {}; qr = null;
    unl.splice(0).forEach((u) => { try { u(); } catch {} });
    invoke('pair_stop').catch(() => {});
    return { ok: true };
  }
  if (a === 'model') return model();
  if (a === 'check') {
    const r = await api.serverCheck(x.kind, String(x.address || '').trim());
    remember(x.kind, { address: r.address, ok: true }); checked[x.kind] = r.address;
    push();
    return { ok: true, address: r.address };
  }
  if (a === 'addr') { remember(x.kind, String(x.address || '').trim() ? { address: x.address } : null); return { ok: true }; }
  if (a === 'login') { await signIn(x.kind, x.address, String(x.user || '').trim(), String(x.pass || '')); return { ok: true, model: await push() }; }
  if (a === 'same') {
    if (!shared) throw new Error('Type the username and password for this one.');
    await signIn(x.kind, x.address, shared.user, shared.pass);
    return { ok: true, model: await push() };
  }
  if (a === 'logout') { await api.serverLogout(x.kind); await window.__refreshSession?.(); return { ok: true, model: await push() }; }
  if (a === 'skip') { if (x.on) skipped[x.kind] = true; else delete skipped[x.kind]; push(); return { ok: true }; }
  if (a === 'open') { const s = await invoke('get_session'); location.hash = firstTab(s); return { ok: true }; }
  return { ok: false, err: 'Unknown: ' + a };
}
