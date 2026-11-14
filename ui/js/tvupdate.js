// Google TV: update Scrappy from inside the app (approved mock: canvas boards TvUpd1-3).
// At start, if a newer TV build is out, a card asks "Update now / Later". Update now
// downloads it with a progress bar, then the TV's own installer screen takes over.
import { esc, toast } from './components.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const tv = (what) => invoke('tv_update', { what });
const mb = (n) => Math.max(1, Math.round((n || 0) / 1048576));

let box = null, found = null, before = null, unlisten = null;

function close() {
  if (!box) return;
  box.remove(); box = null;
  if (unlisten) { unlisten(); unlisten = null; }
  if (before?.isConnected) before.focus({ preventScroll: true });
}

function open(html) {
  if (!box) {
    before = document.activeElement;
    box = document.createElement('div');
    box.className = 'tvu'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    document.body.appendChild(box);
    // Back on the remote (sent as Escape) = the card's second button (Later / Cancel).
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      (box.querySelector('[data-back]') || box.querySelector('button'))?.click();
    });
  }
  box.innerHTML = `<div class="tvu-card">${html}</div>`;
  box.querySelector('[data-first]')?.focus({ preventScroll: true });
}

const head = (title, sub) => `<div class="tvu-h"><img src="logo.png" alt=""><div><div class="tvu-t">${title}</div><div class="tvu-v">${sub}</div></div></div>`;

function ask() {
  const notes = (Array.isArray(found.notes) ? found.notes : String(found.notes || '').split('\n'))
    .map((l) => String(l).replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean).slice(0, 5);
  open(`${head('A new Scrappy is ready', `Version ${esc(found.version)} · you have ${esc(found.current)}`)}
    ${notes.length ? `<div class="tvu-k">WHAT'S NEW</div><ul class="tvu-l">${notes.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    <div class="tvu-s">Takes under a minute. You stay signed in and keep your spot in every show.</div>
    <div class="tvu-b"><button type="button" class="tvu-btn red" data-first id="tvuGo">Update now</button><button type="button" class="tvu-btn" data-back id="tvuLater">Later</button></div>`);
  box.querySelector('#tvuGo').onclick = download;
  box.querySelector('#tvuLater').onclick = close;
}

async function download() {
  open(`${head('Getting the update…', `Version ${esc(found.version)}`)}
    <div class="tvu-p"><i id="tvuBar"></i></div>
    <div class="tvu-n"><span id="tvuGot">Starting…</span><span id="tvuLeft"></span></div>
    <div class="tvu-s">When it's done, the TV asks you to confirm. Press OK on <b>Update</b>, then <b>Open</b>.</div>
    <div class="tvu-b"><button type="button" class="tvu-btn" data-first data-back id="tvuCancel">Cancel</button></div>`);
  const t0 = Date.now();
  unlisten = await listen('tv-upd', (e) => {
    if (!box) return;
    const { got = 0, total = 0 } = e.payload || {};
    const bar = box.querySelector('#tvuBar'); if (!bar) return;
    bar.style.width = (total ? Math.min(100, (got / total) * 100) : 0) + '%';
    box.querySelector('#tvuGot').textContent = total ? `${mb(got)} of ${mb(total)} MB` : `${mb(got)} MB`;
    const secs = (Date.now() - t0) / 1000;
    const left = total && got > 0 && secs > 1 ? Math.round(((total - got) / got) * secs) : 0;
    box.querySelector('#tvuLeft').textContent = left > 60 ? `about ${Math.round(left / 60)} min left` : left > 2 ? `about ${left} seconds left` : '';
  });
  box.querySelector('#tvuCancel').onclick = () => { tv('cancel').catch(() => {}); close(); };
  try {
    await tv('download');
    if (!box) return; // cancelled meanwhile
    await install();
  } catch (e) {
    if (String(e) === 'cancelled') return;
    failed(e);
  }
}

async function install() {
  open(`${head('Ready to install', `Version ${esc(found.version)}`)}
    <div class="tvu-s">The TV's own screen comes up next. Press OK on <b>Update</b>, then <b>Open</b>.<br>The very first time it also asks you to allow Scrappy to install updates: switch that on once and press Back.</div>
    <div class="tvu-b"><button type="button" class="tvu-btn red" data-first id="tvuInst">Install</button><button type="button" class="tvu-btn" data-back id="tvuLater">Later</button></div>`);
  box.querySelector('#tvuLater').onclick = close;
  const go = () => tv('install').catch(failed);
  box.querySelector('#tvuInst').onclick = go;
  go();
}

function failed(e) {
  open(`${head("The update didn't work", esc(String(e)))}
    <div class="tvu-s">Nothing was changed. You can try again now or later from Settings.</div>
    <div class="tvu-b"><button type="button" class="tvu-btn red" data-first id="tvuAgain">Try again</button><button type="button" class="tvu-btn" data-back id="tvuLater">Later</button></div>`);
  box.querySelector('#tvuAgain').onclick = download;
  box.querySelector('#tvuLater').onclick = close;
}

const playing = () => { const p = document.getElementById('player'); return !!(p && (p.classList.contains('open') || !p.hidden && p.offsetParent)); };

/** Look for a newer TV build. `manual` = asked for from Settings (always answers). */
export async function checkNow(manual = false) {
  if (box) return;
  try {
    const r = await tv('check');
    found = r?.available ? r : null;
    if (found && (manual || !playing())) ask();
    else if (manual) toast("You're up to date.");
  } catch (e) {
    if (manual) toast("Couldn't check for updates: " + e, true);
  }
}

// A few seconds after Scrappy opens.
setTimeout(() => checkNow(false), 3500);
