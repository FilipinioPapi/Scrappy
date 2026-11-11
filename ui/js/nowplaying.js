// Now playing: big cover with the record sliding out, controls, and on the right
// Up next, Lyrics or the Visualizer (Bars, Wave, Circle, Particles).
import { listen, api } from './api.js';
import { esc, toast } from './components.js';
import { on, onPref } from './prefs.js';
import { music, onMusic, current, togglePlay, next, prev, seek, toggleShuffle, cycleRepeat, setVolume, toggleMute, setFavorite, playAt, removeAt, moveInQueue, clearUpNext, cover, fmt, IC } from './mplayer.js';
import { nd, coverHtml, songMenu, MI, hue, href, refreshPlaylists } from './music.js';

const { invoke } = window.__TAURI__.core;
const line = (d, n = 20) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const NI = {
  down: line('<path d="M6 9l6 6 6-6"/>'),
  lyrics: line('<path d="M4 6h10M4 11h10M4 16h6"/><rect x="15.5" y="10" width="4" height="7" rx="2"/><path d="M17.5 17v3"/>'),
  viz: line('<path d="M5 18v-4M9 18V9M13 18V5M17 18v-7M21 18v-2"/>'),
  expand: line('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  split: line('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 11h18"/>'),
  full: line('<rect x="4" y="4" width="16" height="16" rx="2.5"/>'),
  gear: line('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
};

// ---------- Visualizer settings (saved; each style keeps its own) ----------
const VDEF = { colors: 'red', detail: 'medium', sens: 'normal', move: 'smooth', mirror: false, glow: true, dim: false };
let vz = { style: 'bars', per: {} };
try { Object.assign(vz, JSON.parse(localStorage.getItem('mviz') || '{}')); } catch {}
const vset = () => ({ ...VDEF, ...(vz.per[vz.style] || {}) });
const saveVz = () => { try { localStorage.setItem('mviz', JSON.stringify(vz)); } catch {} };

// ---------- The screen ----------
const el = document.createElement('div');
el.id = 'mnow'; el.hidden = true;
document.body.appendChild(el);
let mode = localStorage.getItem('mnowmode') || 'queue'; // queue | lyrics | viz (full-screen visualizer)
// What sits under the visualizer (or alone when it's off): Up next or Lyrics.
let under = localStorage.getItem('mnowunder') || (mode === 'lyrics' ? 'lyrics' : 'queue');
const setMode = (m) => { mode = m; if (m !== 'viz') under = m; try { localStorage.setItem('mnowmode', mode); localStorage.setItem('mnowunder', under); } catch {} };
// The visualizer can be switched off entirely, like lyrics.
let vizShow = localStorage.getItem('mnowviz') !== 'off';
const setVizShow = (v) => { vizShow = v; try { localStorage.setItem('mnowviz', v ? 'on' : 'off'); } catch {} };
// The Settings page turns it on or off too.
onPref('mnowviz', (v) => { vizShow = v !== 'off'; if (!el.hidden) drawRight(); });
let open = false;
let settingsOpen = false;

export function openNow(m) {
  if (!current()) return;
  if (m) { if (m === 'viz') setVizShow(true); setMode(m); }
  open = true; el.hidden = false; document.body.classList.add('mnow-open');
  el.classList.remove('closing'); build();
}
export function closeNow() {
  if (!open) return;
  open = false; el.classList.add('closing');
  setTimeout(() => { if (!open) { el.hidden = true; el.classList.remove('closing'); document.body.classList.remove('mnow-open'); stopViz(); } }, 280);
}
window.addEventListener('music:now', (e) => (open && (!e.detail || e.detail === mode) ? closeNow() : openNow(e.detail)));
window.addEventListener('hashchange', closeNow);
window.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') { e.preventDefault(); closeNow(); } });

let builtFor = null;
function build() {
  const s = current(); if (!s) return closeNow();
  builtFor = s.id;
  const fromLbl = music.from ? `PLAYING FROM ${({ album: 'ALBUM', artist: 'ARTIST', playlist: 'PLAYLIST', genre: 'GENRE', mix: 'MIX', songs: 'YOUR LIBRARY', genremix: 'MIX', artistfav: 'FAVORITES' })[music.from.type] || ''}` : 'NOW PLAYING';
  el.style.setProperty('--h', hue(s.album || s.title));
  el.innerHTML = `
    <div class="mn-bg"><img src="${cover(s.coverArt, 600)}" alt="" onload="this.classList.add('in')" onerror="this.remove()"></div>
    <div class="mn-top"><button type="button" class="gb sq" id="mnClose" title="Close" aria-label="Close">${NI.down}</button>
      <div class="mn-from"><div class="kicker">${esc(fromLbl)}</div><div class="t1">${esc(music.from?.name || s.album || '')}</div></div>
      <button type="button" class="gb sq" id="mnMore" aria-label="More">${IC.more}</button></div>
    <div class="mn-body">
      <div class="mn-left">
        <div class="mn-art${music.playing ? ' on' : ''}" id="mnArt"><div class="vin"><div class="vdisc"><div class="shine"></div><div class="dlabel" style="--h:${hue(s.album || s.title)}">${s.coverArt ? `<img src="${cover(s.coverArt, 300)}" alt="" onload="this.classList.add('in')" onerror="this.remove()">` : ''}<i class="gloss"></i><i class="hole"></i></div></div></div>${coverHtml(s.coverArt, s.album || s.title, 600, 'mn-cover')}</div>
        <div class="mn-title"><div class="disp" id="mnT">${esc(s.title)}</div><button type="button" class="gb lg${s.starred ? ' on' : ''}" id="mnFav" title="${s.starred ? 'Remove from Favorites' : 'Add to Favorites'}">${s.starred ? IC.heartOn : IC.heart}</button></div>
        <div class="meta mn-meta">${s.artistId ? `<a href="${href('artist', s.artistId)}">${esc(s.artist)}</a>` : esc(s.artist || '')}${s.album ? ` · <a class="plain" href="${href('album', s.albumId)}?song=${encodeURIComponent(s.id)}">${esc(s.album)}</a>` : ''}${s.year ? ' · ' + s.year : ''}</div>
        <div class="mb-seek mn-seek"><span id="mnPos">0:00</span><div class="mseek" id="mnSeek"><div class="track"><i></i></div><b></b></div><span id="mnDur">0:00</span></div>
        <div class="mn-ctl"><button type="button" class="gb lg" id="mnShuf" aria-label="Shuffle">${IC.shuffle}</button><button type="button" class="gb sq xl" id="mnPrev" aria-label="Previous">${IC.prev}</button>
          <button type="button" class="mb-play xl" id="mnPlay" aria-label="Play">${IC.play}</button><button type="button" class="gb sq xl" id="mnNext" aria-label="Next">${IC.next}</button><button type="button" class="gb lg" id="mnRep" aria-label="Repeat">${IC.repeat}<i class="one">1</i></button></div>
        <div class="mn-bot"><button type="button" class="gb" id="mnMute" aria-label="Mute">${IC.vol}</button><div class="mseek vol" id="mnVol"><div class="track"><i></i></div><b></b></div>
          <span class="sp"></span>
          <button type="button" class="gb mode" data-mode="lyrics" title="Lyrics" aria-label="Lyrics">${NI.lyrics}</button>
          <button type="button" class="gb mode" data-mode="queue" title="Up next" aria-label="Up next">${IC.queue}</button>
          <button type="button" class="gb mode" data-mode="viz" title="Visualizer" aria-label="Visualizer">${NI.viz}</button></div>
      </div>
      <div class="mn-right" id="mnRight"></div>
    </div>`;
  const $ = (q) => el.querySelector(q);
  $('#mnClose').onclick = closeNow;
  $('#mnMore').onclick = (e) => songMenu(current(), e.currentTarget);
  $('#mnFav').onclick = () => { const c = current(); setFavorite(c, !c.starred); };
  $('#mnPlay').onclick = () => { togglePlay(); };
  $('#mnPrev').onclick = prev; $('#mnNext').onclick = next;
  $('#mnShuf').onclick = toggleShuffle; $('#mnRep').onclick = cycleRepeat; $('#mnMute').onclick = toggleMute;
  el.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => {
    const m = b.dataset.mode;
    // Visualizer button turns it on or off; lyrics and Up next swap what sits under it.
    if (m === 'viz') { setVizShow(!vizShow); if (!vizShow && mode === 'viz') setMode(under); }
    else if (m === 'lyrics') setMode(mode === 'lyrics' ? 'queue' : 'lyrics');
    else setMode('queue');
    settingsOpen = false; drawRight();
  }));
  el.querySelector('.mn-top').addEventListener('click', (e) => { if (e.target.closest('a')) closeNow(); });
  el.querySelector('.mn-meta').addEventListener('click', (e) => { if (e.target.closest('a')) closeNow(); });
  slider($('#mnSeek'), (f) => { dragging = true; setFill($('#mnSeek'), f); $('#mnPos').textContent = fmt(f * dur()); }, (f) => { dragging = false; seek(f * dur()); });
  slider($('#mnVol'), (f) => setVolume(f * 100));
  el.addEventListener('pointerdown', (e) => { const b = e.target.closest('button'); if (!b || !el.contains(b)) return; b.classList.remove('tap'); void b.offsetWidth; b.classList.add('tap'); });
  sync(); drawRight();
}
const dur = () => music.dur || current()?.duration || 0;
let dragging = false;
function setFill(s, f) { if (!s) return; f = Math.max(0, Math.min(1, f || 0)); s.querySelector('i').style.width = f * 100 + '%'; s.querySelector('b').style.left = f * 100 + '%'; }
function slider(s, onMove, onDone) {
  s.addEventListener('pointerdown', (e) => {
    const r = s.getBoundingClientRect(); const at = (ev) => Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    s.setPointerCapture(e.pointerId); s.classList.add('drag'); onMove(at(e));
    const mv = (ev) => onMove(at(ev)); const up = (ev) => { s.removeEventListener('pointermove', mv); s.removeEventListener('pointerup', up); s.classList.remove('drag'); onDone?.(at(ev)); };
    s.addEventListener('pointermove', mv); s.addEventListener('pointerup', up);
  });
}
function sync() {
  if (!open) return;
  const s = current(); if (!s) return closeNow();
  if (s.id !== builtFor) return build();
  const $ = (q) => el.querySelector(q);
  const p = $('#mnPlay'); const showPause = music.playing && music.started;
  if (p.dataset.st !== String(showPause)) { p.dataset.st = String(showPause); p.innerHTML = showPause ? IC.pause : IC.play; }
  $('#mnArt').classList.toggle('on', showPause);
  const f = $('#mnFav'); f.classList.toggle('on', !!s.starred); f.innerHTML = s.starred ? IC.heartOn : IC.heart;
  $('#mnShuf').classList.toggle('on', music.shuffle);
  const r = $('#mnRep'); r.classList.toggle('on', music.repeat !== 'off'); r.classList.toggle('is-one', music.repeat === 'one');
  $('#mnMute').innerHTML = music.muted || music.volume === 0 ? IC.muted : IC.vol;
  setFill($('#mnVol'), music.muted ? 0 : music.volume / 100);
  progress();
  if (mode === 'queue') drawQueue();
}
function progress() {
  if (!open || dragging) return;
  const d = dur();
  const pos = el.querySelector('#mnPos'); if (!pos) return;
  pos.textContent = fmt(music.pos); el.querySelector('#mnDur').textContent = fmt(d);
  setFill(el.querySelector('#mnSeek'), d ? music.pos / d : 0);
  el.classList.toggle('playing', music.playing && music.started);
  if (mode === 'lyrics') lyricTick();
  const np = el.querySelector('#qNowT'); if (np) np.textContent = `${fmt(music.pos)} / ${fmt(d)}`;
}
onMusic(sync);
listen('music-prop', ({ payload }) => { if (payload.name === 'time-pos') progress(); });

// ---------- Right side ----------
// Switching between lyrics, up next and the visualizer cross-fades instead of popping.
let rightKey = null; let rightBusy = null;
function drawRight() {
  const box = el.querySelector('#mnRight'); if (!box) return;
  if (mode === 'viz' && !vizShow) setMode(under);
  el.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === 'viz' ? vizShow : b.dataset.mode === (mode === 'viz' ? '' : mode)));
  const key = (vizShow ? (mode === 'viz' ? 'F' : 'V') : 'N') + mode;
  if (rightKey === null || key === rightKey || !box.firstElementChild || matchMedia('(prefers-reduced-motion: reduce)').matches) { rightKey = key; renderRight(box); return; }
  rightKey = key;
  rightBusy?.cancel();
  const out = box.animate([{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'translateY(-10px) scale(.985)', filter: 'blur(3px)' }], { duration: 160, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
  rightBusy = out;
  out.onfinish = () => {
    if (rightBusy !== out) return;
    renderRight(box);
    out.cancel();
    rightBusy = box.animate([{ opacity: 0, transform: 'translateY(14px) scale(.985)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
    // Rows and lines settle in one after another.
    box.querySelectorAll('.qnow, .qi, .lyr > *').forEach((r, i) => { if (i < 14) r.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 280, delay: 60 + i * 22, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }); });
  };
}
function renderRight(box) {
  el.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === 'viz' ? vizShow : b.dataset.mode === (mode === 'viz' ? '' : mode)));
  el.classList.toggle('dim', mode === 'viz' && vset().dim);
  const full = mode === 'viz';
  const lower = mode === 'lyrics' ? '<div class="lyr" id="lyr"><div class="t2">Looking for lyrics…</div></div>' : `<div id="mnQueue"${vizShow ? '' : ' class="noviz"'}></div>`;
  if (!vizShow) { stopViz(); box.innerHTML = lower; if (mode === 'lyrics') loadLyrics(); else drawQueue(); return; }
  box.innerHTML = `<div class="vizcard${full ? ' full' : ''}"><canvas id="viz"></canvas>
      <div class="viz-btns"><button type="button" class="gb vb${full ? '' : ' on'}" data-vmode="queue" title="Visualizer with Up next or lyrics">${NI.split}</button><button type="button" class="gb vb${full ? ' on' : ''}" data-vmode="viz" title="Visualizer only">${NI.full}</button><button type="button" class="gb vb${settingsOpen ? ' on' : ''}" id="vGear" title="Visualizer settings">${NI.gear}</button><button type="button" class="gb vb" id="vOff" title="Turn off the visualizer" aria-label="Turn off the visualizer">${MI.close}</button></div>
      <div class="vset" id="vSet" ${settingsOpen ? '' : 'hidden'}></div></div>
    ${full ? '' : lower}`;
  box.querySelectorAll('[data-vmode]').forEach((b) => (b.onclick = () => { setMode(b.dataset.vmode === 'viz' ? 'viz' : under); drawRight(); }));
  box.querySelector('#vGear').onclick = () => { settingsOpen = !settingsOpen; drawRight(); };
  box.querySelector('#vOff').onclick = () => { setVizShow(false); if (mode === 'viz') setMode(under); settingsOpen = false; drawRight(); };
  if (settingsOpen) drawSettings(box.querySelector('#vSet'));
  startViz(box.querySelector('#viz'));
  if (!full) { if (mode === 'lyrics') loadLyrics(); else drawQueue(); }
}
function drawQueue() {
  const q = el.querySelector('#mnQueue'); if (!q) return;
  const cur = current(); const up = music.queue.slice(music.idx + 1, music.idx + 61);
  const left = music.queue.length - music.idx - 1;
  q.innerHTML = `<div class="qhead"><h2 class="disp">Up next</h2><span class="t2">${left ? `${left} song${left === 1 ? '' : 's'} left` : 'End of the queue'}</span><span class="sp"></span>
      ${left ? '<button type="button" class="btn secondary sm" id="qSave">Save as playlist</button><button type="button" class="link" id="qClear">Clear</button>' : ''}</div>
    <div class="qnow">${coverHtml(cur.coverArt, '', 120)}<div><div class="kicker">NOW PLAYING</div><div class="t1">${esc(cur.title)}</div><div class="t2">${esc(cur.artist || '')} · ${esc(cur.album || '')}</div></div><span class="qnow-r">${music.playing ? MI.eq : ''}<span class="t2" id="qNowT">${fmt(music.pos)} / ${fmt(dur())}</span></span></div>
    ${up.length ? `<div class="kicker qsub">NEXT${music.from?.name ? ' FROM ' + esc(music.from.name.toUpperCase()) : ''} · DRAG TO REORDER</div>` : ''}
    <div class="qlist">${up.map((s, k) => { const i = music.idx + 1 + k; return `<div class="qi big" draggable="true" data-qi="${i}"><span class="qgrip">${MI.grip}</span><span class="qn t2">${i + 1}</span>${coverHtml(s.coverArt, '', 100, 'sm')}<div class="qt"><div class="t1">${esc(s.title)}</div><div class="t2">${esc(s.artist || '')}</div></div><span class="t2 qd">${fmt(s.duration)}</span><button type="button" class="gb qrm" data-rm="${i}" aria-label="Remove">${MI.close}</button></div>`; }).join('')}</div>`;
  const list = q.querySelector('.qlist');
  q.querySelector('#qClear')?.addEventListener('click', clearUpNext);
  q.querySelector('#qSave')?.addEventListener('click', async () => {
    const name = prompt('Name the new playlist', `Up next ${new Date().toLocaleDateString()}`); if (!name) return;
    try { await nd('createPlaylist', `name=${encodeURIComponent(name)}${music.queue.slice(music.idx).map((s) => '&songId=' + encodeURIComponent(s.id)).join('')}`); toast(`Saved "${name}".`); refreshPlaylists(); } catch (e) { toast(String(e), true); }
  });
  list.onclick = (e) => { const rm = e.target.closest('[data-rm]'); if (rm) return removeAt(+rm.dataset.rm); const it = e.target.closest('[data-qi]'); if (it && !e.target.closest('.qgrip')) playAt(+it.dataset.qi); };
  let from = null;
  list.ondragstart = (e) => { const it = e.target.closest('[data-qi]'); if (!it) return; from = +it.dataset.qi; it.classList.add('dragging'); };
  list.ondragover = (e) => { const it = e.target.closest('[data-qi]'); if (from == null || !it) return; e.preventDefault(); list.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); it.classList.add('over'); };
  list.ondragend = () => { from = null; list.querySelectorAll('.dragging,.over').forEach((x) => x.classList.remove('dragging', 'over')); };
  list.ondrop = (e) => { const it = e.target.closest('[data-qi]'); if (from == null || !it) return; e.preventDefault(); moveInQueue(from, +it.dataset.qi); };
}

// ---------- Lyrics ----------
let lyr = { id: null, lines: [], synced: false };
// Scrolling the lyrics yourself stops them following the song; right-click (or the hint) follows again.
let freeScroll = false;
const autoLooked = new Set();
async function loadLyrics() {
  const s = current(); const box = el.querySelector('#lyr'); if (!s || !box) return;
  if (lyr.id !== s.id) {
    lyr = { id: s.id, lines: [], synced: false }; freeScroll = false;
    try {
      const r = await nd('getLyricsBySongId', { id: s.id });
      const list = r.lyricsList?.structuredLyrics || [];
      const best = list.find((x) => x.synced) || list[0];
      if (best) lyr = { id: s.id, synced: !!best.synced, lines: (best.line || []).map((l) => ({ t: (l.start || 0) / 1000 + (best.offset || 0) / 1000, v: l.value || '' })) };
    } catch {}
    if (!lyr.lines.length) { const saved = savedLyrics(s.id); if (saved) lyr = { id: s.id, ...saved }; }
    if (!lyr.lines.length) {
      try { const r = await nd('getLyrics', { artist: s.artist, title: s.title }); const txt = r.lyrics?.value || ''; if (txt.trim()) lyr.lines = txt.split(/\r?\n/).map((v) => ({ t: null, v })); } catch {}
    }
    if (current()?.id !== s.id) return;
  }
  const b2 = el.querySelector('#lyr'); if (!b2) return;
  b2.classList.toggle('synced', lyr.synced);
  b2.innerHTML = lyr.lines.length ? `<div class="lyr-in">${lyr.lines.map((l, i) => `<p data-li="${i}" class="${l.v.trim() ? '' : 'gap'}">${esc(l.v) || '♪'}</p>`).join('')}</div>`
    : `<div class="lyr-none"><div class="disp">No lyrics for this one</div><div class="t2">Navidrome doesn't have lyrics for “${esc(s.title)}”. Scrappy can look them up online.</div><button type="button" class="btn" id="lyrFetch">${MI.search}<span>Find lyrics online</span></button><div class="t2" id="lyrMsg"></div></div>`;
  b2.querySelector('#lyrFetch')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; b.querySelector('span').textContent = 'Looking…';
    try {
      const r = await api.lyricsFind(s.artist || '', s.title || '', s.album || '', Math.round(s.duration || 0));
      const got = parseFound(r);
      if (!got.lines.length) throw new Error('No lyrics found online for this song.');
      try { localStorage.setItem('lyrx:' + s.id, JSON.stringify(got)); } catch {}
      if (current()?.id === s.id) { lyr = { id: s.id, ...got }; loadLyrics(); }
    } catch (err) { b.disabled = false; b.querySelector('span').textContent = 'Try again'; const m = b2.querySelector('#lyrMsg'); if (m) m.textContent = String(err?.message || err); }
  });
  // Settings: look online by itself (once per song).
  if (!lyr.lines.length && on('lyricsAuto') && !autoLooked.has(s.id)) { autoLooked.add(s.id); b2.querySelector('#lyrFetch')?.click(); }
  b2.onclick = (e) => {
    const p = e.target.closest('[data-li]'); if (p && lyr.synced) { seek(lyr.lines[+p.dataset.li].t); follow(b2); }
  };
  if (lyr.synced && lyr.lines.length) {
    b2.parentElement.querySelector('.lyr-hint')?.remove();
    b2.insertAdjacentHTML('afterend', '<button type="button" class="lyr-hint" hidden>Right-click to follow the song again</button>');
    const hint = b2.nextElementSibling;
    hint.onclick = () => follow(b2);
    const loose = () => { if (!freeScroll) { freeScroll = true; hint.hidden = false; } };
    b2.addEventListener('wheel', loose, { passive: true });
    b2.addEventListener('touchmove', loose, { passive: true });
    b2.addEventListener('keydown', (e) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) loose(); });
    // Dragging the scrollbar (a press to the right of the text area).
    b2.addEventListener('mousedown', (e) => { if (e.offsetX > b2.clientWidth) loose(); });
    b2.oncontextmenu = (e) => { e.preventDefault(); follow(b2); };
  }
  if (freeScroll) b2.parentElement.querySelector('.lyr-hint')?.removeAttribute('hidden');
  lastLi = -1; lyricTick();
}
// Lyrics found online are kept on this PC, per song.
function savedLyrics(id) { try { const v = JSON.parse(localStorage.getItem('lyrx:' + id) || 'null'); return v && v.lines?.length ? v : null; } catch { return null; } }
function parseFound(r) {
  const lrc = r?.syncedLyrics || '';
  if (lrc.trim()) {
    const lines = [];
    for (const raw of lrc.split(/\r?\n/)) {
      const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]; if (!tags.length) continue;
      const v = raw.replace(/\[[^\]]*\]/g, '').trim();
      tags.forEach((m) => lines.push({ t: +m[1] * 60 + +m[2], v }));
    }
    lines.sort((a, b) => a.t - b.t);
    if (lines.length) return { synced: true, lines };
  }
  const txt = r?.plainLyrics || '';
  return { synced: false, lines: txt.trim() ? txt.split(/\r?\n/).map((v) => ({ t: null, v })) : [] };
}
function follow(box) {
  freeScroll = false;
  const h = box.parentElement?.querySelector('.lyr-hint'); if (h) h.hidden = true;
  lastLi = -1; lyricTick();
}
let lastLi = -1;
function lyricTick() {
  if (!lyr.synced || current()?.id !== lyr.id) return;
  let i = -1; for (let k = 0; k < lyr.lines.length; k++) { if (lyr.lines[k].t <= music.pos + 0.25) i = k; else break; }
  if (i === lastLi) return; lastLi = i;
  const box = el.querySelector('#lyr'); if (!box) return;
  box.querySelectorAll('p.on').forEach((p) => p.classList.remove('on'));
  const p = box.querySelector(`[data-li="${i}"]`); if (!p) return;
  p.classList.add('on');
  // Measure the line inside the lyrics box itself. offsetTop counts from the whole right-hand panel,
  // so with the visualizer above it the current line was scrolled up out of sight.
  if (freeScroll) return;
  const y = p.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  box.scrollTo({ top: y - box.clientHeight / 2 + p.offsetHeight / 2, behavior: 'smooth' });
}

// ---------- Visualizer ----------
const OPTS = {
  style: [['bars', 'Bars'], ['wave', 'Wave'], ['circle', 'Circle'], ['particles', 'Particles']],
  colors: [['red', 'Scrappy red'], ['album', 'Album colours'], ['rainbow', 'Rainbow'], ['white', 'White']],
  detail: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']],
  sens: [['soft', 'Soft'], ['normal', 'Normal'], ['punchy', 'Punchy']],
  move: [['snappy', 'Snappy'], ['smooth', 'Smooth']],
  mirror: [[false, 'Off'], [true, 'On']], glow: [[false, 'Off'], [true, 'On']], dim: [[false, 'Off'], [true, 'On']],
};
const LBL = { style: 'STYLE', colors: 'COLOURS', detail: 'DETAIL', sens: 'SENSITIVITY', move: 'MOVEMENT', mirror: 'MIRROR', glow: 'GLOW', dim: 'DIM THE BACKGROUND' };
function drawSettings(box) {
  const cur = vset();
  box.innerHTML = Object.keys(OPTS).map((k) => `<div class="kicker">${LBL[k]}</div><div class="chips">${OPTS[k].map(([v, l]) => `<button type="button" class="mchip${(k === 'style' ? vz.style : cur[k]) === v ? ' on' : ''}" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div>`).join('') + '<div class="t2 vnote">Saved for next time. Each style keeps its own settings.</div>';
  box.onclick = (e) => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    const k = b.dataset.k; let v = b.dataset.v; if (v === 'true') v = true; if (v === 'false') v = false;
    if (k === 'style') vz.style = v; else vz.per[vz.style] = { ...vset(), [k]: v };
    saveVz(); drawRight();
  };
}
let raf = 0, cvs = null, levelAt = 0, target = 0, peakT = 0, bars = [], parts = [], vizOn = false, albumCols = null, albumFor = null;
listen('music-level', ({ payload }) => {
  const sens = { soft: 0.8, normal: 1, punchy: 1.35 }[vset().sens];
  target = Math.max(0, Math.min(1, ((payload.rms + 55) / 50) * sens));
  peakT = Math.max(0, Math.min(1, ((payload.peak + 40) / 40) * sens));
  levelAt = performance.now();
});
listen('music-loaded', () => { if (vizOn) invoke('music_viz', { on: true }).catch(() => {}); });
function startViz(canvas) {
  cvs = canvas; cancelAnimationFrame(raf);
  if (!vizOn) { vizOn = true; invoke('music_viz', { on: true }).catch(() => {}); }
  loadAlbumColours();
  const loop = () => { raf = requestAnimationFrame(loop); frame(); };
  loop();
}
function stopViz() {
  cancelAnimationFrame(raf); cvs = null;
  if (vizOn) { vizOn = false; invoke('music_viz', { on: false }).catch(() => {}); }
}
function loadAlbumColours() {
  const s = current(); if (!s || albumFor === s.coverArt) return;
  albumFor = s.coverArt; albumCols = null;
  const im = new Image(); im.crossOrigin = 'anonymous';
  im.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 24; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 24, 24);
      const d = x.getImageData(0, 0, 24, 24).data; const px = [];
      for (let i = 0; i < d.length; i += 4) { const [r, g, b] = [d[i], d[i + 1], d[i + 2]]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx - mn > 40 && mx > 70) px.push([r, g, b, mx - mn]); }
      px.sort((a, b) => b[3] - a[3]);
      const pick = (arr) => { const n = Math.max(1, arr.length); const t = arr.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]); return `rgb(${t.map((v) => Math.round(v / n)).join(',')})`; };
      if (px.length > 6) albumCols = [pick(px.slice(0, Math.ceil(px.length / 3))), pick(px.slice(Math.ceil(px.length / 3)))];
    } catch { albumCols = null; }
  };
  im.src = cover(s.coverArt, 100);
}
function colourAt(set, i, n, ctx, h) {
  if (set.colors === 'white') return 'rgba(255,255,255,.92)';
  if (set.colors === 'rainbow') return `hsl(${(i / n) * 300 + performance.now() / 40},85%,60%)`;
  const [a, b] = set.colors === 'album' && albumCols ? albumCols : ['#CC1921', '#FF5A5F'];
  const g = ctx.createLinearGradient(0, h, 0, 0); g.addColorStop(0, a); g.addColorStop(1, b); return g;
}
function frame() {
  if (!cvs || !cvs.isConnected) return stopViz();
  const set = vset();
  const dpr = devicePixelRatio || 1; const W = cvs.clientWidth, H = cvs.clientHeight;
  if (cvs.width !== Math.round(W * dpr)) { cvs.width = Math.round(W * dpr); cvs.height = Math.round(H * dpr); }
  const ctx = cvs.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const now = performance.now(), t = now / 1000;
  const live = now - levelAt < 600;
  // Without live levels (meter unavailable), breathe gently while playing.
  const goal = !music.playing ? 0 : live ? target : 0.45 + 0.25 * Math.sin(t * 2.1) * Math.sin(t * 0.7);
  const n = { low: 32, medium: 56, high: 96 }[set.detail];
  if (bars.length !== n) bars = new Array(n).fill(0);
  const k = set.move === 'snappy' ? 0.45 : 0.16;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const shape = 0.35 + 0.65 * Math.exp(-((x - 0.18) ** 2) / 0.08) + 0.25 * Math.sin(x * 9 + t * 0.6);
    const wob = 0.6 + 0.4 * Math.sin(t * (3 + (i % 7)) + i * 1.7) * Math.sin(t * 1.3 + i);
    const v = Math.max(0.03, Math.min(1, goal * shape * wob * (live ? 0.75 + peakT * 0.5 : 1)));
    bars[i] += (v - bars[i]) * k;
  }
  ctx.shadowBlur = set.glow ? 18 : 0; ctx.shadowColor = set.colors === 'white' ? 'rgba(255,255,255,.6)' : set.colors === 'album' && albumCols ? albumCols[1] : 'rgba(236,40,46,.8)';
  const st = vz.style;
  if (st === 'bars') {
    const gap = 4, bw = (W - 40 - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const bh = Math.max(4, bars[i] * (H - 50) * (set.mirror ? 0.5 : 1));
      const x = 20 + i * (bw + gap); const y = set.mirror ? H / 2 - bh : H - 20 - bh;
      ctx.fillStyle = colourAt(set, i, n, ctx, H);
      roundRect(ctx, x, y, bw, set.mirror ? bh * 2 : bh, Math.min(4, bw / 2));
    }
  } else if (st === 'wave') {
    const mid = set.mirror ? H / 2 : H - 20;
    ctx.beginPath(); ctx.moveTo(0, mid);
    for (let i = 0; i <= n; i++) { const v = bars[Math.min(n - 1, i)]; const x = (i / n) * W; const y = mid - v * (H - 60) * (set.mirror ? 0.5 : 0.9) * (0.7 + 0.3 * Math.sin(t * 2 + i / 3)); const px = ((i - 0.5) / n) * W; ctx.quadraticCurveTo(px, y, x, y); }
    if (set.mirror) { for (let i = n; i >= 0; i--) { const v = bars[Math.min(n - 1, i)]; ctx.lineTo((i / n) * W, mid + v * (H - 60) * 0.5 * (0.7 + 0.3 * Math.sin(t * 2 + i / 3))); } }
    else { ctx.lineTo(W, mid); }
    ctx.closePath();
    ctx.fillStyle = colourAt(set, n / 2, n, ctx, H); ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
  } else if (st === 'circle') {
    const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.24;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2; const v = set.mirror ? bars[i < n / 2 ? i : n - 1 - i] : bars[i];
      const len = 6 + v * Math.min(W, H) * 0.22;
      ctx.strokeStyle = typeof colourAt(set, i, n, ctx, H) === 'string' ? colourAt(set, i, n, ctx, H) : (set.colors === 'album' && albumCols ? albumCols[i % 2] : i % 2 ? '#FF5A5F' : '#EC282E');
      ctx.lineWidth = Math.max(2, (Math.PI * 2 * r) / n * 0.55); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (r + 6), cy + Math.sin(a) * (r + 6)); ctx.lineTo(cx + Math.cos(a) * (r + 6 + len), cy + Math.sin(a) * (r + 6 + len)); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(music.playing ? t * 0.8 : 0);
    ctx.fillStyle = '#0d0909'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1; for (let g = r * 0.45; g < r; g += 5) { ctx.beginPath(); ctx.arc(0, 0, g, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = set.colors === 'album' && albumCols ? albumCols[0] : '#B0182A'; ctx.beginPath(); ctx.arc(0, 0, r * 0.36, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0d0909'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  } else {
    const cx = W / 2, cy = H / 2; const level = bars.reduce((a, b) => a + b, 0) / n;
    const want = { low: 60, medium: 120, high: 220 }[set.detail];
    while (parts.length < want) parts.push(spawn(cx, cy));
    if (parts.length > want) parts.length = want;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]; const sp = 0.4 + level * (set.sens === 'punchy' ? 7 : 5);
      p.x += p.vx * sp; p.y += p.vy * sp; p.life -= 0.006 + level * 0.01;
      if (p.life <= 0 || p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > H + 10) { parts[i] = spawn(cx, cy); continue; }
      ctx.globalAlpha = Math.min(1, p.life * 1.4); ctx.fillStyle = set.colors === 'rainbow' ? `hsl(${p.h},85%,62%)` : set.colors === 'white' ? '#fff' : set.colors === 'album' && albumCols ? albumCols[i % 2] : i % 3 ? '#EC282E' : '#FF8A8E';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 + level), 0, Math.PI * 2); ctx.fill();
      if (set.mirror) { ctx.beginPath(); ctx.arc(W - p.x, p.y, p.s * (1 + level), 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }
  ctx.shadowBlur = 0;
}
function spawn(cx, cy) { const a = Math.random() * Math.PI * 2; const s = 0.4 + Math.random() * 1.4; return { x: cx + Math.cos(a) * 20, y: cy + Math.sin(a) * 20, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6 + Math.random() * 0.6, s: 1 + Math.random() * 2.4, h: Math.random() * 360 }; }
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill(); }
