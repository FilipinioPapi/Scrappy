// The side menu the three tabs share (approved mock: one menu, three tabs).
// Size and collapse are shared, so switching tabs never moves the page. Each tab
// fills in its own pages and its own "Your Library" (pinned + recents).
import { esc } from './components.js';

const line = (d, n = 20) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const SI = {
  collapse: line('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16M15 10l-2 2 2 2"/>'),
  pin: line('<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z"/><path d="M12 14v6"/>', 14),
  pinOn: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z" fill="currentColor" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M12 14v6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>',
};
export { line as sideLine };

// ---------- Shared size ----------
const SIZE_KEY = 'sideSize';
export const side = { collapsed: false, width: 272 };
try {
  const saved = JSON.parse(localStorage.getItem(SIZE_KEY) || 'null');
  if (saved) Object.assign(side, saved);
  else { const m = JSON.parse(localStorage.getItem('mlib') || '{}'); side.collapsed = !!m.collapsed; if (m.width) side.width = m.width; }
} catch {}
export const saveSide = () => { try { localStorage.setItem(SIZE_KEY, JSON.stringify(side)); } catch {} };
export const sideW = () => (side.collapsed ? 76 : side.width);
/** Class and style for a shell element. */
export const shellAttrs = (cls) => `class="mshell ${cls}${side.collapsed ? ' collapsed' : ''}" style="--mside:${sideW()}px"`;
export const headHtml = (label) => `<div class="mhead"><span class="lbl">${label}</span><button type="button" class="gb side-col" title="Collapse / expand" aria-label="Collapse or expand the side menu">${SI.collapse}</button></div>`;
export const navHtml = (nav) => nav.map(([p, l, d, href]) => `<a class="mnav" data-p="${esc(p)}" href="${href}" title="${esc(l)}">${line(d)}<span class="lbl">${esc(l)}</span></a>`).join('');
/** The collapse button and the drag-to-resize edge. */
export function wireSize(shell) {
  const apply = () => { shell.classList.toggle('collapsed', side.collapsed); shell.style.setProperty('--mside', sideW() + 'px'); };
  apply();
  shell.querySelector('.side-col')?.addEventListener('click', () => { side.collapsed = !side.collapsed; saveSide(); apply(); });
  shell.querySelector('.mgrab')?.addEventListener('pointerdown', (e) => {
    if (side.collapsed) return;
    const g = e.currentTarget; g.setPointerCapture(e.pointerId); shell.classList.add('resizing');
    const mv = (ev) => { side.width = Math.max(220, Math.min(420, ev.clientX)); shell.style.setProperty('--mside', side.width + 'px'); };
    const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); shell.classList.remove('resizing'); saveSide(); };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
  });
}
/** Light up the page you're on. */
export const markNav = (root, p) => root.querySelectorAll('.mnav[data-p]').forEach((a) => a.classList.toggle('on', a.dataset.p === p));

// ---------- Your Library ----------
// entry: { k, kind, t, sub, img, shape: ''|'round'|'poster'|'stack', href, prog (0-1) }
export function libStore(key) {
  const K = 'side:' + key;
  const st = { pins: [], saved: {}, fil: 'all' };
  try { Object.assign(st, JSON.parse(localStorage.getItem(K) || '{}')); } catch {}
  st.save = () => { try { const { save, ...rest } = st; localStorage.setItem(K, JSON.stringify(rest)); } catch {} };
  return st;
}
const hueOf = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
function libItem(e, pinned) {
  return `<a class="mli${pinned ? ' pinned' : ''}" href="${esc(e.href)}" data-k="${esc(e.k)}" title="${esc(e.t)}">
    <div class="mcv ${e.shape || ''}" style="--h:${hueOf(e.t)}"><span>${esc(e.t)}</span>${e.img ? `<img loading="lazy" src="${esc(e.img)}" alt="" onload="this.classList.add('in')" onerror="this.remove()">` : ''}</div>
    <div class="mli-txt"><div class="t1">${esc(e.t)}</div><div class="t2">${pinned ? `<span class="pinmark">${SI.pinOn}</span>` : ''}${esc(e.sub || '')}</div>${e.prog ? `<div class="mli-prog"><i style="width:${Math.round(Math.min(1, e.prog) * 100)}%"></i></div>` : ''}</div>
    <button type="button" class="mli-pin" data-pin="${esc(e.k)}" title="${pinned ? 'Unpin' : 'Pin to side menu'}" aria-label="${pinned ? 'Unpin' : 'Pin to side menu'}">${pinned ? SI.pinOn : SI.pin}</button>
  </a>`;
}
export const libHtml = (chips) => `<div class="msep"></div><div class="mlibh lbl">YOUR LIBRARY</div>
  <div class="mchips lbl">${chips.map(([f, l]) => `<button type="button" class="mchip" data-f="${esc(f)}">${esc(l)}</button>`).join('')}</div>
  <div class="slib"></div>`;
/** Draw pinned + recents into the shell's .slib. recents: newest first. */
export function drawLib(shell, st, recents) {
  const box = shell.querySelector('.slib'); if (!box) return;
  const ok = (e) => st.fil === 'all' || e.kind === st.fil;
  const byK = new Map(recents.map((e) => [e.k, e]));
  // A pinned item keeps its saved copy, refreshed whenever it shows up in recents.
  for (const k of st.pins) if (byK.has(k)) st.saved[k] = byK.get(k);
  const pins = st.pins.map((k) => byK.get(k) || st.saved[k]).filter(Boolean).filter(ok);
  // onlyFil entries (series, collections) only show under their own chip.
  const rest = recents.filter((e) => !st.pins.includes(e.k)).filter((e) => !e.onlyFil || st.fil === e.kind).filter(ok).slice(0, 10);
  box.innerHTML = (pins.length ? `<div class="mlsec">PINNED</div>${pins.map((e) => libItem(e, true)).join('')}<div class="mlsec">RECENTS</div>` : '')
    + rest.map((e) => libItem(e, false)).join('')
    + (!pins.length && !rest.length ? '<div class="t2 mlempty">Nothing here yet</div>' : '');
  shell.querySelectorAll('.mchip').forEach((c) => c.classList.toggle('on', c.dataset.f === st.fil));
  const h = decodeURIComponent(location.hash.split('?')[0]);
  box.querySelectorAll('.mli').forEach((a) => a.classList.toggle('on', decodeURIComponent(a.getAttribute('href')) === h));
}
/** Chips filter, pin buttons. redraw() draws again with fresh recents. */
export function wireLib(shell, st, redraw, find) {
  shell.querySelector('.mchips')?.addEventListener('click', (e) => {
    const c = e.target.closest('.mchip'); if (!c) return;
    st.fil = st.fil === c.dataset.f ? 'all' : c.dataset.f; st.save(); redraw();
  });
  shell.querySelector('.slib')?.addEventListener('click', (e) => {
    const p = e.target.closest('[data-pin]'); if (!p) return;
    e.preventDefault(); e.stopPropagation();
    const k = p.dataset.pin;
    if (st.pins.includes(k)) { st.pins = st.pins.filter((x) => x !== k); delete st.saved[k]; }
    else { st.pins = [k, ...st.pins]; const ent = find(k); if (ent) st.saved[k] = ent; }
    st.save(); redraw();
  });
}
