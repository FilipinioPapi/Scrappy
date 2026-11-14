// The top bar fits any window size, Ctrl +/- zoom level or Windows display scaling (approved board C).
// It checks how much room the bar really has, then changes one thing at a time, smallest change first:
//   1 the words beside the logo hide        4 the player keeps cover, song name and play
//   2 the small player drops its right side 5 the player is just its cover (click it for the controls)
//   3 search folds into a round button      6 the tabs show icons only
// Search never squashes into something you can't click.
const STEPS = 6;
const top = document.getElementById('topbar');

const TAB_ICONS = {
  home: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  audiobooks: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="5" height="7" rx="2"/><rect x="16" y="14" width="5" height="7" rx="2"/>',
};

function addTabIcons() {
  top.querySelectorAll('.tabs a[data-tab]').forEach((a) => {
    if (a.querySelector('.tab-ic')) return;
    const tx = document.createElement('span'); tx.className = 'tx';
    while (a.firstChild) tx.appendChild(a.firstChild);
    a.innerHTML = `<svg class="tab-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAB_ICONS[a.dataset.tab] || ''}</svg>`;
    a.appendChild(tx);
    if (!a.title) a.title = tx.textContent.trim();
  });
}

const setStep = (el, n) => { for (let i = 1; i <= STEPS; i++) el.classList.toggle('f' + i, i <= n); };

// Does everything fit, with the buttons on the right fully inside the bar?
function fits(el) {
  const act = el.querySelector('.actions'); if (!act) return true;
  const pr = parseFloat(getComputedStyle(el).paddingRight) || 0;
  return act.getBoundingClientRect().right <= el.getBoundingClientRect().right - pr + 0.5;
}

let step = 0;
function fit() {
  if (!top || top.hidden) return;
  const w = top.getBoundingClientRect().width; if (!w) return;
  // Try each step on an invisible copy of the bar, so the real one only ever glides once.
  const c = top.cloneNode(true);
  // (The copy keeps id="topbar" so it picks up the same styles; it only exists for this moment.)
  c.classList.add('fit-measure'); c.classList.remove('sx-open');
  c.querySelectorAll('.menu, .tdrop').forEach((m) => m.remove());
  c.querySelectorAll('.sx, .pop').forEach((m) => m.classList.remove('sx', 'pop'));
  Object.assign(c.style, { position: 'fixed', left: '0', top: '-400px', width: w + 'px', visibility: 'hidden', pointerEvents: 'none' });
  c.setAttribute('aria-hidden', 'true');
  document.body.appendChild(c);
  let best = STEPS;
  for (let n = 0; n <= STEPS; n++) { setStep(c, n); if (fits(c)) { best = n; break; } }
  c.remove();
  if (best === step) return;
  step = best;
  if (step < 3) closeSearch();
  if (step < 5) closePop();
  setStep(top, step);
  // The tab pill follows the tabs as they change size.
  setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
  setTimeout(() => window.dispatchEvent(new Event('resize')), 500);
}

let queued = false;
const schedule = () => { if (queued || document.documentElement.classList.contains('tv')) return; queued = true; requestAnimationFrame(() => { queued = false; fit(); }); };

// ---------- Search as a round button: opens out over the tabs ----------
const box = top?.querySelector('.tsearch');
const input = box?.querySelector('input');
function openSearch() {
  if (!top.classList.contains('f3') || box.classList.contains('sx')) return;
  const tabs = top.querySelector('.tabs');
  const wide = box.getBoundingClientRect().right - tabs.getBoundingClientRect().left;
  box.style.setProperty('--sxw', Math.round(wide) + 'px');
  box.classList.add('sx'); top.classList.add('sx-open');
}
function closeSearch() { box?.classList.remove('sx'); top?.classList.remove('sx-open'); }

// ---------- Player as just its cover: click opens the full player ----------
function closePop() { top?.querySelectorAll('.tp.pop').forEach((t) => t.classList.remove('pop')); }

if (top && box && input) {
  addTabIcons();
  input.addEventListener('focus', openSearch); // Ctrl+F lands here too
  box.addEventListener('pointerdown', (e) => {
    if (top.classList.contains('f3') && !box.classList.contains('sx')) { e.preventDefault(); input.focus(); }
  });
  box.addEventListener('focusout', (e) => {
    if (box.contains(e.relatedTarget)) return;
    setTimeout(() => { if (!box.contains(document.activeElement)) closeSearch(); }, 0);
  });
  // First click on the cover opens the player; a second click goes back to that tab as usual.
  top.addEventListener('click', (e) => {
    const cv = e.target.closest('.tp-cv'); if (!cv || !top.classList.contains('f5')) return;
    const tp = cv.closest('.tp'); if (!tp || tp.classList.contains('pop')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    closePop(); tp.classList.add('pop');
  }, true);
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('.tp.pop')) closePop(); });
  window.addEventListener('hashchange', closePop);

  new ResizeObserver(schedule).observe(top);
  // Re-check when a small player arrives or leaves, the tab changes, or the bar appears after sign-in.
  new MutationObserver((list) => {
    if (list.length) schedule();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver((list) => {
    if (list.some((m) => (m.type === 'childList' && m.target === top) || m.attributeName === 'hidden' || m.target.classList?.contains('tp'))) schedule();
  }).observe(top, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  document.fonts?.ready.then(schedule);
  schedule();
}
