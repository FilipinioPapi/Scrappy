// Edit home (approved mock): each tab keeps its own row order and hidden rows.
// A home page marks each row's wrapper with data-hrow="<id>" and calls homeRows().
import { esc } from './components.js';

const KEY = (tab) => 'homeRows:' + tab;
const read = (tab) => { try { return JSON.parse(localStorage.getItem(KEY(tab)) || '{}') || {}; } catch { return {}; } };
const write = (tab, l) => { try { if (l) localStorage.setItem(KEY(tab), JSON.stringify(l)); else localStorage.removeItem(KEY(tab)); } catch {} };

// Saved order first; rows the saved order doesn't know yet (new smart rows, a new
// library) slot in right after the row they follow by default.
function ordered(tab, rows) {
  const ids = rows.map((r) => r.id);
  const saved = (read(tab).order || []).filter((id) => ids.includes(id));
  const out = saved.slice();
  ids.forEach((id, i) => {
    if (out.includes(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const k = out.indexOf(ids[j]); if (k >= 0) { at = k + 1; break; } }
    out.splice(at, 0, id);
  });
  return out;
}
const hiddenSet = (tab) => new Set(read(tab).off || []);

function apply(box, tab, rows) {
  const off = hiddenSet(tab);
  const tail = box.querySelector(':scope > .hedit-wrap');
  for (const id of ordered(tab, rows)) {
    const el = box.querySelector(`:scope > [data-hrow="${CSS.escape(id)}"]`);
    if (!el) continue;
    box.insertBefore(el, tail);
    el.classList.toggle('hrow-off', off.has(id));
  }
}

/** Order and hide the rows in `box`, and add the Edit home button under them.
 *  rows: [{ id, label, smart? }] in their default order. */
export function homeRows(box, tab, rows, tabName) {
  let wrap = box.querySelector(':scope > .hedit-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'hedit-wrap';
    wrap.innerHTML = '<button type="button" class="hedit"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h10M4 12h16M4 17h7"/><circle cx="17" cy="7" r="2"/><circle cx="14" cy="17" r="2"/></svg><span>Edit home</span></button>';
    box.appendChild(wrap);
  }
  wrap.querySelector('.hedit').onclick = () => openEditor(box, tab, rows, tabName);
  apply(box, tab, rows);
}

/** True when a row is switched off, so a page can skip loading it. */
export const rowOff = (tab, id) => hiddenSet(tab).has(id);

function openEditor(box, tab, rows, tabName) {
  document.querySelector('.hed-shade')?.remove();
  const shade = document.createElement('div');
  shade.className = 'hed-shade';
  shade.innerHTML = `<aside class="hed" role="dialog" aria-label="Edit home"><div class="hed-h"><div><h2>Edit home</h2><div class="t2">${esc(tabName)} · drag to reorder, switch off to hide</div></div>
    <button type="button" class="gb sq hed-x" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="hed-l"></div><div class="hed-f"><button type="button" class="btn secondary hed-reset">Reset to default</button><span class="sp"></span><button type="button" class="btn hed-done">Done</button></div></aside>`;
  document.body.appendChild(shade);
  const list = shade.querySelector('.hed-l');
  const byId = new Map(rows.map((r) => [r.id, r]));
  const draw = () => {
    const off = hiddenSet(tab);
    list.innerHTML = ordered(tab, rows).map((id) => { const r = byId.get(id); return `<div class="hed-it${off.has(id) ? ' off' : ''}" draggable="true" data-id="${esc(id)}">
      <span class="hed-grip" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg></span>
      <span class="hed-n">${esc(r.label)}</span>${r.smart ? '<span class="hed-smart">Smart</span>' : ''}
      <button type="button" class="hed-sw" role="switch" aria-checked="${!off.has(id)}" aria-label="Show ${esc(r.label)}"><i></i></button></div>`; }).join('');
  };
  const save = (order, off) => { write(tab, { order, off: [...off] }); apply(box, tab, rows); };
  const current = () => [...list.querySelectorAll('.hed-it')].map((e) => e.dataset.id);
  draw();
  list.addEventListener('click', (e) => {
    const sw = e.target.closest('.hed-sw'); if (!sw) return;
    const it = sw.closest('.hed-it'); const off = hiddenSet(tab);
    if (off.has(it.dataset.id)) off.delete(it.dataset.id); else off.add(it.dataset.id);
    it.classList.toggle('off'); sw.setAttribute('aria-checked', String(!off.has(it.dataset.id)));
    save(current(), off);
  });
  // Drag to reorder: the row follows the pointer and the page updates when you let go.
  let drag = null;
  list.addEventListener('dragstart', (e) => { drag = e.target.closest('.hed-it'); if (!drag) return; drag.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', drag.dataset.id); } catch {} });
  list.addEventListener('dragover', (e) => {
    if (!drag) return; e.preventDefault();
    const over = e.target.closest('.hed-it'); if (!over || over === drag) return;
    const r = over.getBoundingClientRect();
    list.insertBefore(drag, e.clientY < r.top + r.height / 2 ? over : over.nextSibling);
  });
  list.addEventListener('dragend', () => { if (!drag) return; drag.classList.remove('drag'); drag = null; save(current(), hiddenSet(tab)); });
  const close = () => { shade.classList.add('closing'); setTimeout(() => shade.remove(), 220); window.removeEventListener('keydown', esc_); window.removeEventListener('hashchange', close); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', esc_); window.addEventListener('hashchange', close);
  shade.addEventListener('click', (e) => { if (e.target === shade) close(); });
  shade.querySelector('.hed-x').onclick = close;
  shade.querySelector('.hed-done').onclick = close;
  shade.querySelector('.hed-reset').onclick = () => { write(tab, null); apply(box, tab, rows); draw(); };
}

// Smart rows remember what they showed for a while, so switching tabs draws them straight
// away instead of rows popping in one by one (and shuffled rows don't reshuffle each visit).
const MEM = new Map();
window.addEventListener('scrappy:rowcache-clear', () => MEM.clear());
export function rowCache(tab, id, ttl = 30 * 60e3) {
  const k = `hr:${tab}:${id}`;
  return {
    get() {
      let c = MEM.get(k);
      if (!c) { try { c = JSON.parse(localStorage.getItem(k) || 'null'); } catch {} if (c) MEM.set(k, c); }
      return c && Date.now() - c.t < ttl ? c.d : null;
    },
    set(d) { const c = { t: Date.now(), d }; MEM.set(k, c); try { localStorage.setItem(k, JSON.stringify(c)); } catch {} },
  };
}
/** Draw a smart row from its saved copy if it's fresh, otherwise fetch, save and draw. */
export async function cachedRow(tab, id, fetcher, render, run = (f) => f()) {
  const c = rowCache(tab, id);
  const d = c.get();
  if (d != null) { render(d); return; }
  const fresh = await run(fetcher);
  if (fresh == null) return;
  c.set(fresh); render(fresh);
}

/** A one-at-a-time queue that starts once the page has settled and stops when you leave,
 *  so smart-row lookups never compete with the covers and pages you're looking at. */
export function lowPriority(alive, delay = 900) {
  let chain = new Promise((r) => setTimeout(r, delay));
  return (task) => {
    const p = chain.then(() => (alive() ? task() : null));
    chain = p.catch(() => {}).then(() => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 400 }) : setTimeout(r, 30))));
    return p;
  };
}
