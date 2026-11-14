// The Follow along pop-out window (approved mock "Pop-out window"). It shows the book's
// text big, with a small player at the bottom. The main Scrappy window keeps playing the
// book: it sends this window where it is ("fa-state"), and this window sends button
// presses back ("fa-cmd"). The top-right button sends the text back into Scrappy.
import { listen } from './api.js';
import { followHTML, followBind, followActive, followRemote, openSettings, BACK_ICON } from './follow.js';

const { invoke } = window.__TAURI__.core;
const { emit } = window.__TAURI__.event;
const line = (d, n = 20) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  play: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
  back10: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4a8 8 0 1 1-8 8"/><path d="M14.4 1.7 12 4l2.4 2.3"/><text x="12.4" y="15.3" text-anchor="middle" font-size="7.6" font-weight="700" font-family="Inter,sans-serif" fill="currentColor" stroke="none">10</text></svg>',
  fwd10: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4a8 8 0 1 0 8 8"/><path d="M9.6 1.7 12 4 9.6 6.3"/><text x="11.6" y="15.3" text-anchor="middle" font-size="7.6" font-weight="700" font-family="Inter,sans-serif" fill="currentColor" stroke="none">10</text></svg>',
  aa: line('<path d="M3 18l5-12 5 12M5 14h6"/><path d="M21 18v-4.5a3 3 0 0 0-6 0"/><path d="M15 15.5c0 1.4 1.3 2.5 3 2.5s3-1.1 3-2.5"/>'),
};
const clock = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(x).padStart(2, '0'); };

// What the main window last told us. Same shape follow.js reads from the real player.
const B = { item: null, pos: 0, playing: false, started: false, speed: 1 };
const S = { title: '', author: '', chapter: '', cover: '', start: 0, end: 0 };
followRemote(B);

const root = document.getElementById('fpop');
root.innerHTML = `
  <div class="fp-bg"><img id="fpBg" alt=""></div>
  <div class="fp-top">
    <div class="fp-cv"><img id="fpCv" alt=""></div>
    <div class="fp-ti"><b id="fpTitle"></b><span id="fpCh"></span></div>
    <span class="sp"></span>
    <button type="button" class="gb sq" id="fpAa" title="Text options" aria-label="Text options">${I.aa}</button>
    <button type="button" class="gb sq" id="fpBack" title="Send back to Scrappy" aria-label="Send back to Scrappy">${BACK_ICON}</button>
  </div>
  <div class="fp-main">${followHTML('pop')}</div>
  <div class="fp-mini">
    <div class="fp-cv sm"><img id="fpCv2" alt=""></div>
    <div class="fp-info"><b id="fpTitle2"></b><span id="fpCh2"></span></div>
    <button type="button" class="gb" id="fpB10" title="Back 10 seconds" aria-label="Back 10 seconds">${I.back10}</button>
    <button type="button" class="mb-play" id="fpPlay" aria-label="Play">${I.play}</button>
    <button type="button" class="gb" id="fpF10" title="Forward 10 seconds" aria-label="Forward 10 seconds">${I.fwd10}</button>
    <div class="mb-seek fp-seek"><span id="fpPos">0:00</span><div class="mseek" id="fpSeek"><div class="track"><i></i></div><b></b></div><span id="fpRem">0:00</span></div>
    <button type="button" class="bb-spd" id="fpSpd" title="Speed" aria-label="Speed">1.00×</button>
  </div>`;
const $ = (id) => document.getElementById(id);
const cmd = (c, extra = {}) => emit('fa-cmd', { cmd: c, ...extra }).catch(() => {});
followBind(root.querySelector('.fa-host-pop'), B);

$('fpBack').onclick = () => invoke('fa_popin').catch(() => window.close());
$('fpAa').onclick = () => { const on = !$('fpAa').classList.contains('on'); $('fpAa').classList.toggle('on', on); openSettings(on); wake(); };
$('fpPlay').onclick = () => cmd('toggle');
$('fpB10').onclick = () => cmd('skip', { n: -10 });
$('fpF10').onclick = () => cmd('skip', { n: 10 });
$('fpSpd').onclick = () => cmd('speed');

// Seek bar: click or drag.
let drag = null;
const seekEl = $('fpSeek');
const frac = (e) => { const r = seekEl.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
const fill = (f) => { seekEl.querySelector('i').style.width = f * 100 + '%'; seekEl.querySelector('b').style.left = f * 100 + '%'; };
seekEl.addEventListener('pointerdown', (e) => {
  seekEl.setPointerCapture(e.pointerId); seekEl.classList.add('drag'); drag = frac(e); fill(drag);
  const mv = (ev) => { drag = frac(ev); fill(drag); };
  const up = () => { seekEl.removeEventListener('pointermove', mv); seekEl.classList.remove('drag'); cmd('seek', { pos: S.start + drag * (S.end - S.start) }); setTimeout(() => (drag = null), 400); };
  seekEl.addEventListener('pointermove', mv); seekEl.addEventListener('pointerup', up, { once: true });
});

let lastCover = '', lastBook = null;
listen('fa-state', ({ payload: p }) => {
  if (!p) return;
  B.item = p.item; B.pos = p.pos || 0; B.playing = !!p.playing; B.started = !!p.started; B.speed = p.speed || 1;
  Object.assign(S, { title: p.title, author: p.author, chapter: p.chapter, cover: p.cover, start: p.start || 0, end: p.end || 0 });
  draw();
  const id = p.item?.id || null;
  if (id !== lastBook) { lastBook = id; followActive(false); if (id) followActive(true); }
});

function draw() {
  $('fpTitle').textContent = $('fpTitle2').textContent = S.title || 'Nothing playing';
  $('fpCh').textContent = $('fpCh2').textContent = S.chapter || S.author || '';
  if (S.cover !== lastCover) {
    lastCover = S.cover;
    ['fpCv', 'fpCv2', 'fpBg'].forEach((id) => { const im = $(id); im.classList.remove('in'); im.onload = () => im.classList.add('in'); im.src = S.cover || ''; });
  }
  const pb = $('fpPlay');
  if (pb.dataset.st !== String(B.playing)) { pb.dataset.st = String(B.playing); pb.innerHTML = B.playing ? I.pause : I.play; pb.setAttribute('aria-label', B.playing ? 'Pause' : 'Play'); }
  $('fpSpd').textContent = B.speed.toFixed(2) + '×'; $('fpSpd').classList.toggle('on', B.speed !== 1);
  if (drag === null) {
    const len = Math.max(1, S.end - S.start);
    $('fpPos').textContent = clock(B.pos - S.start); $('fpRem').textContent = '-' + clock(S.end - B.pos);
    fill((B.pos - S.start) / len);
  }
}

// Controls fade back after 3 seconds without the mouse moving, so the words have the stage.
let idleT = 0;
function wake() {
  document.body.classList.remove('idle'); clearTimeout(idleT);
  idleT = setTimeout(() => { if (!$('fpAa').classList.contains('on') && !document.querySelector('.fp-mini:hover, .fp-top:hover')) document.body.classList.add('idle'); else wake(); }, 3000);
}
['mousemove', 'mousedown', 'keydown', 'wheel'].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));
window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.target.closest('input')) { e.preventDefault(); cmd('toggle'); } });
wake();
cmd('hello');
document.title = 'Scrappy · Follow along';
