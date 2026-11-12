// Google TV: one simple pick-from-a-list card (approved mock). Used for Sort / Show / Genre
// on the grids, the Hold OK quick menu and anything else that is a short list on the TV.
// Up/Down move, OK picks, Back closes. Resolves with the picked index, or null.
import { esc } from './components.js';

export function tvPick(title, options, selected = -1, note = '') {
  return new Promise((done) => {
    const from = document.activeElement;
    const box = document.createElement('div');
    box.className = 'tvm'; box.setAttribute('role', 'dialog');
    box.innerHTML = `<div class="tvm-card"><h4>${esc(title)}${note ? `<small>${esc(note)}</small>` : ''}</h4><div class="tvm-list">${options.map((o, i) => `<button type="button" class="tvm-opt${i === selected ? ' sel' : ''}" data-i="${i}">${selected >= 0 ? '<i></i>' : ''}<span>${esc(o)}</span></button>`).join('')}</div></div>`;
    const close = (v) => { removeEventListener('keydown', onKey, true); box.remove(); if (from?.isConnected) from.focus({ preventScroll: true }); done(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } };
    addEventListener('keydown', onKey, true);
    box.addEventListener('click', (e) => { const o = e.target.closest('.tvm-opt'); if (o) close(Number(o.dataset.i)); else if (e.target === box) close(null); });
    document.body.appendChild(box);
    const first = box.querySelector('.tvm-opt.sel') || box.querySelector('.tvm-opt');
    first?.focus({ preventScroll: true }); first?.scrollIntoView({ block: 'center' });
  });
}
