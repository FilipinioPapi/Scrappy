// Follow along (approved mocks "Follow-along text" and "Follow along upgrades"): the book's
// words, lit up as the narrator reads them, like lyrics. It shows in the right panel, in
// Now playing, or in its own pop-out window. The text is made on this PC by the speech engine
// (follow.rs) and only while this panel is open. The first time, a short tip says
// what to expect on this PC; the gear has the quality choice and saved text.
import { listen } from './api.js';
import { esc } from './components.js';

const { invoke } = window.__TAURI__.core;
const line = (d, n = 18) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const FOLLOW_ICON = line('<path d="M4 6h16M4 10h16M4 14h10M4 18h7"/><path d="M16.5 15.5l2 2 3.5-4"/>', 20);
// Pop out into its own window / send back to Scrappy (picked: pair B, window with an arrow).
export const POP_ICON = line('<path d="M11 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13"/><path d="M14.5 4.5h5v5M19.5 4.5l-7.5 7.5"/>', 20);
export const BACK_ICON = line('<path d="M11 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13"/><path d="M19.5 4.5L12 12M12 7.5V12h4.5"/>', 20);
const GEAR = line('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>');

const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const F = { root: null, B: null, active: false, remote: false, book: null, chunks: new Map(), paras: [], info: null, status: null, view: 'text', curPara: -1, lastPos: 0, clock: { pos: 0, at: 0 } };

// ---------- How the text looks (approved mock "Highlight styles + options") ----------
export const LOOK_DEFAULT = { style: 'sweep', color: 'white', size: 'M', font: 'app', line: 'normal', focus: false, nudge: 0 };
const STYLES = [['simple', 'Simple'], ['soft', 'Soft fade'], ['sweep', 'Sweep'], ['glow', 'Glow'], ['marker', 'Marker']];
const COLORS = { white: '#FFFFFF', blush: '#F8C6C8', gold: '#FFD99A' };
const SIZES = { panel: { S: 16, M: 18, L: 21, XL: 24 }, now: { S: 21, M: 25, L: 29, XL: 34 }, pop: { S: 24, M: 29, L: 34, XL: 40 } };
const FONTS = { app: ['Scrappy', 'Inter, sans-serif', 700], book: ['Book', 'Literata, Georgia, serif', 500], easy: ['Easy read', '"Atkinson Hyperlegible", Inter, sans-serif', 700] };
const LINES = { snug: ['Snug', 1.35], normal: ['Normal', 1.5], roomy: ['Roomy', 1.8] };
export function getLook() { let v = {}; try { v = JSON.parse(ls.get('faLook') || '{}') || {}; } catch {} return { ...LOOK_DEFAULT, ...v }; }
function setLook(patch) { ls.set('faLook', JSON.stringify({ ...getLook(), ...patch })); applyLook(); }
/** Puts the chosen style, color, size, font and spacing on the text box. */
function applyLook() {
  const box = q('#faTxt'); if (!box) return;
  const L = getLook(), host = F.root?.dataset.faHost || F.root?.querySelector('[data-fa-host]')?.dataset.faHost || 'now';
  const f = FONTS[L.font] || FONTS.app;
  box.dataset.style = L.style; box.classList.toggle('focus', !!L.focus);
  box.style.setProperty('--fa-lit', COLORS[L.color] || COLORS.white);
  box.style.setProperty('--fa-size', (SIZES[host] || SIZES.now)[L.size] + 'px');
  box.style.setProperty('--fa-font', f[1]); box.style.setProperty('--fa-weight', f[2]);
  box.style.setProperty('--fa-line', (LINES[L.line] || LINES.normal)[1]);
}
// Another window (the pop-out) changed the look: follow it here too.
window.addEventListener('storage', (e) => { if (e.key === 'faLook') { applyLook(); if (F.view === 'set') drawSettings(); } });

/** The pane's markup. `host` is 'now' (Now playing), 'panel' (right panel) or 'pop' (its own window).
 *  `extra` goes before the gear, `after` after it. */
export function followHTML(host = 'now', extra = '', after = '') {
  return `<div class="bn-pane fa-host-${host}" data-pane="follow" data-fa-host="${host}"><div class="bn-card fa-card">
    <div class="bn-head"><h2 class="disp">FOLLOW ALONG</h2><span class="sp"></span>${host === 'panel' ? '' : '<span class="fa-pill" id="faPill" hidden><i></i><span></span></span>'}${extra}
      <button type="button" class="gb sq fa-gear" id="faGear" title="Follow-along settings" aria-label="Follow-along settings">${GEAR}</button>${after}</div>
    ${host === 'panel' ? '<div class="fa-pillrow"><span class="fa-pill" id="faPill" hidden><i></i><span></span></span></div>' : ''}
    <div id="faTip"></div>
    <div class="fa-prep" id="faPrep" hidden><span class="fa-spin"></span><span></span></div>
    <div class="fa-txt" id="faTxt"></div>
    <div class="fa-set" id="faSet" hidden></div>
    <div class="fa-foot" id="faFoot"><span>Made on this PC, nothing is sent online</span>${host === 'panel' ? '' : '<span class="sp"></span><span>Stops when you close this panel</span>'}</div>
  </div></div>`;
}

/** Hook the pane up after it is (re)built. `B` is the book player state. */
export function followBind(root, B) {
  F.root = root; F.B = B; F.curPara = -1;
  const g = root.querySelector('#faGear');
  if (g) g.onclick = () => openSettings(F.view !== 'set');
  applyLook(); draw();
}
/** Show or hide the settings in the bound pane. */
export function openSettings(on = true) { F.view = on ? 'set' : 'text'; draw(); if (on) drawSettings(); }
/** Which pane shows the text right now (null for none). */
export const followRoot = () => F.root;
/** The pop-out window: it shows the text but the main window runs the speech engine. */
export function followRemote(B) { F.remote = true; F.B = B; }

const q = (s) => F.root?.querySelector(s);
const quality = () => ls.get('faQuality') || 'auto';
const tracks = (B) => (B.tracks || []).map((t) => ({ path: t.contentUrl, offset: t.startOffset || 0, duration: t.duration || 0 }));

/** Turn the worker on or off (on only while some pane shows the text). */
export async function followActive(on) {
  const B = F.B;
  on = !!(on && B?.item);
  if (!on) { if (F.active && !F.remote) invoke('fa_stop').catch(() => {}); F.active = false; return; }
  const id = B.item.id;
  if (F.active && F.book === id) return;
  F.active = true;
  if (F.book !== id) { F.book = id; F.chunks = new Map(); F.paras = []; F.curPara = -1; }
  F.status = null;
  try {
    const cached = await invoke('fa_cached', { book: id });
    cached.forEach(addChunk); rebuild();
  } catch {}
  if (F.remote) { draw(); tick(); return; }
  try { F.info = await invoke('fa_info', { quality: quality() }); } catch { F.info = null; }
  if (!F.active || F.book !== id) return;
  if (F.info && !F.info.engine) { F.status = { state: 'error', msg: 'The speech engine is missing from this copy of Scrappy. Install the latest build.' }; draw(); return; }
  drawTip(); draw(); tick();
  try { await invoke('fa_start', { book: id, tracks: tracks(B), pos: B.pos || 0, quality: quality() }); }
  catch (e) { F.status = { state: 'error', msg: String(e) }; draw(); }
}

listen('fa-status', ({ payload }) => { if (!F.active) return; F.status = payload; drawStatus(); });
listen('fa-chunk', ({ payload }) => { if (!F.active || payload.book !== F.book) return; addChunk(payload); rebuild(); });

function addChunk(c) { if (c && Array.isArray(c.words)) F.chunks.set(c.k, c.words); }

// Words -> paragraphs: break after a sentence once it's long enough, at a long pause,
// or when it gets too long.
function rebuild() {
  const words = [...F.chunks.keys()].sort((a, b) => a - b).flatMap((k) => F.chunks.get(k));
  const paras = []; let cur = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (cur.length && prev && (w[0] - prev[1] > 2.5)) { paras.push(cur); cur = []; }
    cur.push(w);
    const end = /[.!?…]["”’)]?$/.test(w[2]);
    if ((end && cur.length >= 14) || cur.length >= 48) { paras.push(cur); cur = []; }
  });
  if (cur.length) paras.push(cur);
  F.paras = paras; F.curPara = -1;
  drawText(true);
}

function paraAt(t) {
  const P = F.paras; let lo = 0, hi = P.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (P[m][0][0] <= t + 0.05) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

// The player only reports its spot a few times a second, so glide between reports.
function now() {
  const B = F.B; if (!B) return 0;
  const raw = B.pos || 0, ms = performance.now();
  if (raw !== F.clock.pos) F.clock = { pos: raw, at: ms };
  const run = B.playing && (B.started !== false) ? Math.min(1.5, ((ms - F.clock.at) / 1000) * (B.speed || 1)) : 0;
  return raw + run + (Number(getLook().nudge) || 0);
}

/** Called every frame: light up the words read so far. */
function drawText(force) {
  const box = q('#faTxt'); if (!box || F.view !== 'text') return;
  const t = now();
  let pi = paraAt(t);
  const p = F.paras[pi];
  const have = p && t <= p[p.length - 1][1] + 3; // inside text we have
  if (!have) {
    if (force || box.dataset.empty !== '1') {
      box.dataset.empty = '1'; F.curPara = -1;
      const st = F.status?.state;
      box.innerHTML = `<div class="fa-wait">${st === 'error' ? '' : st === 'setup' ? 'The text starts as soon as setup finishes.' : '<span class="fa-spin"></span>Getting the text for this part ready…'}</div>`;
    }
    return;
  }
  if (force || pi !== F.curPara || box.dataset.empty === '1') {
    const fresh = force || box.dataset.empty === '1';
    box.dataset.empty = '';
    F.curPara = pi;
    let el = box.querySelector(`p[data-i="${pi}"]`);
    const last = box.lastElementChild ? Number(box.lastElementChild.dataset.i) : -1;
    if (!el || fresh || pi > last - 3) {
      // Draw a fresh stretch of text, keeping the old line where it was so the scroll glides.
      const was = box.querySelector('p.cur'), wasTop = was ? was.offsetTop - box.scrollTop : null;
      const from = Math.max(0, pi - 3), to = Math.min(F.paras.length, pi + 12);
      let html = '';
      for (let i = from; i < to; i++) html += `<p data-i="${i}">${F.paras[i].map((w, j) => `<span data-j="${j}">${esc(w[2])}</span>`).join(' ')}</p>`;
      box.innerHTML = html;
      const prevEl = was && box.querySelector(`p[data-i="${was.dataset.i}"]`);
      if (prevEl && wasTop !== null && !fresh) box.scrollTop = prevEl.offsetTop - wasTop;
      el = box.querySelector(`p[data-i="${pi}"]`);
    }
    box.querySelectorAll('p').forEach((x) => { const i = Number(x.dataset.i); x.className = i < pi ? 'past' : i === pi ? 'cur' : 'ahead'; if (i < pi) [...x.children].forEach((s) => s.classList.add('on')); });
    if (el) box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.32, behavior: fresh ? 'auto' : 'smooth' });
  }
  const curEl = box.querySelector('p.cur'); if (!curEl) return;
  const spans = curEl.children;
  for (let j = 0; j < p.length; j++) {
    const s = spans[j]; if (!s) continue;
    const w = p[j], on = w[0] <= t + 0.03, cur = on && t < w[1];
    if (s.classList.contains('on') !== on) s.classList.toggle('on', on);
    if (s.classList.contains('cur') !== cur) s.classList.toggle('cur', cur);
    if (cur) s.style.setProperty('--p', Math.min(1, (t - w[0]) / Math.max(0.05, w[1] - w[0])).toFixed(3));
  }
}

// One animation loop while the text shows, so the highlight moves smoothly.
let raf = 0;
function tick() {
  if (raf) return;
  const step = () => { raf = 0; if (!F.active || !F.root || F.view !== 'text') return; if (!document.hidden) drawText(false); raf = requestAnimationFrame(step); };
  raf = requestAnimationFrame(step);
}

function short(gpu) {
  return String(gpu || '').replace(/\((TM|R)\)/gi, '').replace(/^(AMD|NVIDIA|Intel)\s+/i, '').replace(/^(Radeon|GeForce)\s+/i, '').replace(/\s+Graphics$/i, '').replace(/\s+/g, ' ').trim() || 'graphics card';
}

/** The one-time tip: what to expect on this PC. */
function drawTip() {
  const el = q('#faTip'); if (!el) return;
  const i = F.info;
  if (!i || ls.get('faTipSeen')) { el.innerHTML = ''; return; }
  const T = {
    best: ['⚡', 'Follow along runs great here', `Your ${esc(short(i.gpu))} handles this easily: best accuracy, and the text stays about ${i.aheadMin} minutes ahead. It only runs while this panel is open.`],
    good: ['👍', 'Follow along runs well here', 'Scrappy uses your processor with a lighter setup. It keeps up fine, but expect the odd misspelled name and some fan noise. It only runs while this panel is open.'],
    basic: ['🐢', 'Follow along works here', 'This PC is on the slower side, so Scrappy uses its lightest setup. It keeps up at normal speeds; at fast speeds the text may lag a little. It only runs while this panel is open.'],
  }[i.tier] || null;
  if (!T) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="fa-tip"><span class="ic">${T[0]}</span><div><b>${T[1]}</b><span>${T[2]}</span></div><button type="button" class="x" aria-label="Close tip">✕</button></div>`;
  el.querySelector('.x').onclick = () => { ls.set('faTipSeen', '1'); el.innerHTML = ''; };
}

function drawStatus() {
  const s = F.status || {};
  const pill = q('#faPill'), prep = q('#faPrep');
  if (!pill) return;
  if (s.state === 'running') {
    pill.hidden = false;
    const ahead = Math.floor((s.ahead || 0) / 60);
    pill.querySelector('span').textContent = `On your ${s.on === 'gpu' ? 'graphics card' : 'processor'} · ${ahead >= 1 ? `~${ahead} min ahead` : 'catching up'}`;
  } else pill.hidden = true;
  if (s.state === 'setup') {
    prep.hidden = false; prep.classList.remove('err');
    prep.lastElementChild.textContent = `Getting set up for this PC (one time)… ${s.pct || 0}%`;
  } else if (s.state === 'error') {
    prep.hidden = false; prep.classList.add('err');
    prep.lastElementChild.innerHTML = `${esc(s.msg || 'Something went wrong.')} <button type="button" class="btn sm" id="faRetry">Try again</button>`;
    prep.querySelector('#faRetry').onclick = () => { F.active = false; F.status = null; draw(); followActive(true); };
  } else prep.hidden = true;
  if (s.state !== 'running') drawText(true);
}

function draw() {
  if (!F.root) return;
  const set = F.view === 'set';
  q('#faTxt').hidden = set; q('#faSet').hidden = !set; q('#faFoot').hidden = set;
  q('#faGear').classList.toggle('on', set);
  drawTip(); drawStatus();
  if (!set) { applyLook(); drawText(true); tick(); }
}

// The look options: style, color, size, font, spacing, focus and timing.
function lookRows() {
  const L = getLook();
  const seg = (key, list) => `<div class="fa-seg">${list.map(([k, t, st]) => `<button type="button" class="${String(L[key]) === k ? 'on' : ''}" data-look="${key}" data-v="${k}"${st ? ` style="${st}"` : ''}>${t}</button>`).join('')}</div>`;
  const nudge = Number(L.nudge) || 0;
  return `
    <div class="fa-row"><b>Highlight style</b><span>How words light up as they're read</span>${seg('style', STYLES)}</div>
    <div class="fa-row"><b>Highlight color</b><span>White, a soft pink, or warm gold</span><div class="fa-sw">${Object.entries(COLORS).map(([k, c]) => `<button type="button" class="${L.color === k ? 'on' : ''}" data-look="color" data-v="${k}" style="background:${c}" title="${k === 'blush' ? 'Pink' : k === 'gold' ? 'Gold' : 'White'}" aria-label="${k}"></button>`).join('')}</div></div>
    <div class="fa-row"><b>Text size</b><span>The side panel, Now playing and the pop-out window each scale it to fit</span>${seg('size', ['S', 'M', 'L', 'XL'].map((k) => [k, k]))}</div>
    <div class="fa-row"><b>Font</b><span>Book is a serif made for long reading. Easy read helps with dyslexia.</span>${seg('font', Object.entries(FONTS).map(([k, f]) => [k, f[0], `font-family:${f[1].replace(/"/g, '&quot;')}`]))}</div>
    <div class="fa-row"><b>Line spacing</b>${seg('line', Object.entries(LINES).map(([k, l]) => [k, l[0]]))}</div>
    <div class="fa-row fa-tg"><div><b>Focus on the paragraph being read</b><span>Fades the rest of the page way down</span></div><button type="button" class="fa-switch${L.focus ? ' on' : ''}" data-look="focus" data-v="${L.focus ? '' : '1'}" aria-label="Focus on the paragraph being read"><i></i></button></div>
    <div class="fa-row fa-tg"><div><b>Text timing</b><span>Nudge if words light up early or late</span></div><div class="fa-step"><button type="button" data-nudge="-0.1" aria-label="Earlier">−</button><b>${nudge > 0 ? '+' : nudge < 0 ? '−' : ''}${Math.abs(nudge).toFixed(1)} s</b><button type="button" data-nudge="0.1" aria-label="Later">+</button></div></div>`;
}
function bindLook(el) {
  el.querySelectorAll('[data-look]').forEach((b) => (b.onclick = () => { const k = b.dataset.look; setLook({ [k]: k === 'focus' ? !!b.dataset.v : b.dataset.v }); drawSettings(); }));
  el.querySelectorAll('[data-nudge]').forEach((b) => (b.onclick = () => { const v = Math.max(-1, Math.min(1, Math.round(((Number(getLook().nudge) || 0) + Number(b.dataset.nudge)) * 10) / 10)); setLook({ nudge: v }); drawSettings(); }));
}

async function drawSettings() {
  const el = q('#faSet'); if (!el) return;
  if (F.remote) { el.innerHTML = lookRows(); bindLook(el); return; }
  let i = F.info; try { i = F.info = await invoke('fa_info', { quality: quality() }); } catch {}
  let saved = null; try { saved = await invoke('fa_saved'); } catch {}
  const gb = (mb) => (mb >= 1024 ? `${Math.round(mb / 1024)} GB` : `${mb} MB`);
  const pc = i ? [i.gpu ? `${short(i.gpu)}${i.vramMb >= 512 ? ` (${gb(i.vramMb)})` : ''}` : 'No graphics card found', `${i.threads} processor threads`, `${gb(i.ramMb)} memory`].join(' · ') : '';
  const qv = quality();
  const Q = [['auto', 'Auto (recommended)', i ? `Right now: ${i.model.toLowerCase()} on your ${i.useGpu ? 'graphics card' : 'processor'}` : ''], ['fast', 'Faster', 'Lighter model, less work for this PC'], ['best', 'More accurate', i?.tier === 'best' ? 'Already using the most accurate model' : 'Bigger model; may fall behind at fast speeds']];
  const mins = saved ? saved.chunks : 0;
  el.innerHTML = lookRows() + `
    <div class="fa-row"><b>This PC</b><span>${esc(pc)}</span></div>
    <div class="fa-row"><b>Quality</b><span>Auto picks what this PC runs smoothly.</span>
      <div class="fa-q">${Q.map(([k, t, s]) => `<button type="button" class="${k === qv ? 'on' : ''}" data-q="${k}"><i></i><span><b>${t}</b><span>${esc(s)}</span></span></button>`).join('')}</div></div>
    <div class="fa-row"><b>Saved text</b><span>${mins ? `${mins} minute${mins === 1 ? '' : 's'} of text from ${saved.books} book${saved.books === 1 ? '' : 's'} · ${(saved.bytes / 1048576).toFixed(1)} MB. Saved text is reused, so listening again costs nothing.` : 'Nothing saved yet.'}</span>
      ${mins ? '<div><button type="button" class="btn sm" id="faClear">Clear saved text</button></div>' : ''}</div>`;
  bindLook(el);
  el.querySelectorAll('[data-q]').forEach((b) => (b.onclick = async () => {
    ls.set('faQuality', b.dataset.q);
    await invoke('fa_stop').catch(() => {}); F.active = false;
    drawSettings(); followActive(true);
  }));
  const c = el.querySelector('#faClear');
  if (c) c.onclick = async () => {
    await invoke('fa_clear').catch(() => {}); F.active = false; F.chunks = new Map(); F.paras = []; F.book = null;
    drawSettings(); followActive(true);
  };
}

// Tell the worker where we are.
setInterval(() => {
  if (!F.active || !F.B || F.remote) return;
  const p = F.B.pos || 0;
  if (Math.abs(p - F.lastPos) > 0.5) { F.lastPos = p; invoke('fa_pos', { pos: p }).catch(() => {}); }
}, 2000);
