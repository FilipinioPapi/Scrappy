// Google TV: "Who's watching?" (approved mock "Scrappy TV Loading and Profiles", option C).
//
// Everyone who has signed in on this TV is remembered (tokens only, never passwords). The faces
// screen shows when Scrappy opens, with whoever watched last already highlighted, and the same
// list slides out from your picture at the top of the side bar. A person can lock their profile
// with an optional 4 digit PIN, which is checked on this TV only.
const { invoke } = window.__TAURI__.core;
import { esc } from './components.js';
import { tvPick } from './tvmenu.js';

const ASK = 'tvWhoAsk';        // '0' = don't ask when Scrappy opens
const ONCE = 'tvWhoDone';      // this run of the app has already asked (survives the reload after a switch)
const COLORS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const sget = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const sset = (k, v) => { try { sessionStorage.setItem(k, v); } catch {} };

export const people = async () => { try { return (await invoke('profiles_get')) || { active: '', people: [] }; } catch { return { active: '', people: [] }; } };

const face = (p, i) => {
  const pic = p.emby && p.embyServer && p.embyUserId ? `<img src="${esc(p.embyServer)}/Users/${encodeURIComponent(p.embyUserId)}/Images/Primary?maxWidth=240&quality=90" alt="" onerror="this.remove()">` : '';
  return `<i class="who-face ${COLORS[i % COLORS.length]}${p.hasPin ? ' lock' : ''}">${esc((p.name || '?').trim().charAt(0).toUpperCase())}${pic}</i>`;
};

// One overlay at a time. Back closes it (the app's Back sends Escape to whatever is on top).
function layer(cls, html, onBack) {
  const from = document.activeElement;
  const box = document.createElement('div');
  box.className = `who ${cls}`; box.setAttribute('role', 'dialog');
  box.innerHTML = html;
  const close = () => { removeEventListener('keydown', onKey, true); box.remove(); if (from?.isConnected) from.focus({ preventScroll: true }); };
  const onKey = (e) => { if (e.key === 'Escape' && document.body.lastElementChild === box) { e.preventDefault(); e.stopPropagation(); if (onBack() !== false) close(); } };
  addEventListener('keydown', onKey, true);
  document.body.appendChild(box);
  return { box, close };
}

/** The number pad. Resolves with 4 digits, or null on Back. */
export function askPin(title, person, note = '') {
  return new Promise((done) => {
    let pin = '';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    const { box, close } = layer('pinpad', `<div class="who-pin">
        ${person ? `<div class="who-p">${face(person, person._i || 0)}<span>${esc(person.name)}</span></div>` : ''}
        <h3>${esc(title)}</h3>${note ? `<p class="who-note">${esc(note)}</p>` : ''}
        <div class="who-dots"><b></b><b></b><b></b><b></b></div>
        <div class="who-pad">${keys.map((k) => (k ? `<button type="button" data-k="${k}">${k}</button>` : '<span></span>')).join('')}</div>
      </div>`, () => { done(null); });
    const dots = [...box.querySelectorAll('.who-dots b')];
    const paint = () => dots.forEach((d, i) => { d.textContent = i < pin.length ? '•' : ''; d.classList.toggle('f', i === pin.length); });
    box.addEventListener('click', (e) => {
      const k = e.target.closest('button')?.dataset.k; if (!k) return;
      if (k === '⌫') pin = pin.slice(0, -1); else if (pin.length < 4) pin += k;
      paint();
      if (pin.length === 4) setTimeout(() => { close(); done(pin); }, 120);
    });
    // A keyboard or a remote with number keys can type the PIN directly.
    box.addEventListener('keydown', (e) => { if (/^\d$/.test(e.key)) { e.preventDefault(); box.querySelector(`[data-k="${e.key}"]`)?.click(); } else if (e.key === 'Backspace') { e.preventDefault(); box.querySelector('[data-k="⌫"]').click(); } });
    paint();
    box.querySelector('[data-k="5"]').focus({ preventScroll: true });
  });
}

const reload = () => { sset(ONCE, '1'); try { window.dispatchEvent(new Event('scrappy:rowcache-clear')); } catch {} location.hash = '#/home'; location.reload(); };

// Switch to a person; asks for their PIN when they have one. true = switched (the app restarts).
async function switchTo(p, active) {
  if (p.id === active) return 'same';
  for (let tries = 0; tries < 3; tries++) {
    const pin = p.hasPin ? await askPin('Enter your PIN', p, tries ? 'That PIN was not right. Try again.' : '') : '';
    if (pin === null) return null;
    try { await invoke('profile_switch', { id: p.id, pin }); reload(); return 'switched'; } catch (e) { if (!p.hasPin) { await tvPick(String(e), ['OK']); return null; } }
  }
  return null;
}

async function addPerson() {
  try { await invoke('profile_new'); } catch { return; }
  sset(ONCE, '1'); location.hash = '#/login'; location.reload();
}

// "Manage people": PINs, removing someone, and whether Scrappy asks when it opens.
async function manage(data, startAt = -1) {
  const ask = get(ASK) !== '0';
  const opts = [...data.people.map((p) => p.name + (p.hasPin ? '  (PIN on)' : '')), `Ask who's watching when Scrappy opens: ${ask ? 'On' : 'Off'}`];
  const i = await tvPick('People on this TV', opts, -1, '', startAt);
  if (i == null) return;
  if (i === data.people.length) { set(ASK, ask ? '0' : '1'); return manage(data, i); }
  const p = data.people[i];
  const acts = p.hasPin ? ['Change PIN', 'Turn PIN off', `Remove ${p.name} from this TV`] : ['Set a PIN', `Remove ${p.name} from this TV`];
  const a = await tvPick(p.name, acts, -1, p.hasPin ? 'PIN on' : 'No PIN');
  if (a == null) return manage(data);
  const act = acts[a];
  try {
    if (act === 'Set a PIN' || act === 'Change PIN') {
      const cur = p.hasPin ? await askPin('Enter the current PIN', p) : '';
      if (cur === null) return;
      const one = await askPin('Choose a 4 digit PIN', p, 'Only checked on this TV. It is not your server password.');
      if (one === null) return;
      const two = await askPin('Enter it once more', p);
      if (two === null) return;
      if (one !== two) { await tvPick('Those two did not match. Nothing was changed.', ['OK']); return; }
      await invoke('profile_pin', { id: p.id, current: cur, pin: one });
    } else if (act === 'Turn PIN off') {
      const cur = await askPin('Enter the current PIN', p);
      if (cur === null) return;
      await invoke('profile_pin', { id: p.id, current: cur, pin: '' });
    } else {
      const sure = await tvPick(`Remove ${p.name} from this TV?`, ['Remove', 'Cancel'], -1, 'They can sign in again any time');
      if (sure !== 0) return;
      const cur = p.hasPin ? await askPin('Enter their PIN', p) : '';
      if (cur === null) return;
      await invoke('profile_remove', { id: p.id, pin: cur });
      if (p.id === data.active) { reload(); return; }
    }
  } catch (e) { await tvPick(String(e), ['OK']); }
}

let open = false;
/** Show the list. `side`: the panel from the side bar; otherwise the full faces screen. */
export async function who({ side = false, must = false } = {}) {
  if (open) return; open = true;
  try {
    for (;;) {
      const data = await people();
      data.people.forEach((p, i) => { p._i = i; });
      const picked = await new Promise((done) => {
        const cards = data.people.map((p, i) => `<button type="button" class="who-p${p.id === data.active ? ' cur' : ''}" data-i="${i}">${face(p, i)}<span>${esc(p.name)}</span>${p.id === data.active ? `<small>${side ? 'Watching now' : 'Watched last'}</small>` : p.hasPin && side ? '<small>PIN</small>' : ''}</button>`).join('');
        const extra = `<button type="button" class="who-p add" data-do="add"><i class="who-face add">+</i><span>Add person</span></button>${side ? '<button type="button" class="who-p add" data-do="manage"><i class="who-face add">⚙</i><span>Manage people</span></button>' : ''}`;
        const { box, close } = layer(side ? 'side' : 'full', side
          ? `<div class="who-panel"><h3>Who's watching?</h3>${cards}${extra}</div>`
          : `<div class="who-full"><h3>Who's watching?</h3><div class="who-ppl">${cards}${extra}</div><p class="who-note">Switch any time from your picture in the side bar</p></div>`,
        () => { if (must) return false; done(null); });
        box.addEventListener('click', (e) => {
          const b = e.target.closest('.who-p'); if (!b) { if (e.target === box && !must) { close(); done(null); } return; }
          close(); done(b.dataset.do || data.people[Number(b.dataset.i)]);
        });
        (box.querySelector('.who-p.cur') || box.querySelector('.who-p')).focus({ preventScroll: true });
      });
      if (picked == null) return;
      if (picked === 'add') { await addPerson(); return; }
      if (picked === 'manage') { await manage(data); continue; }
      const r = await switchTo(picked, data.active);
      if (r) return;   // 'same' closes the list; 'switched' restarts the app
    }
  } finally { open = false; }
}

/** When Scrappy opens: ask who is watching if more than one person is on this TV. */
export async function whoAtStart(session) {
  if (sget(ONCE)) return;
  sset(ONCE, '1');
  const data = await people();
  const signed = !!session?.loggedIn;
  if (!data.people.length) return;
  // Nobody active (the last person was removed or signed out) but others are saved: always ask.
  if (!signed) return who({ must: false });
  if (data.people.length < 2 || get(ASK) === '0') return;
  return who();
}
