// Google TV: opening a title carries its poster across.
//
// The poster you pressed lifts off the grid and glides to where the title page keeps its poster,
// and Back sends it home again. The glide is a transform-only animation, so the TV's compositor
// keeps it moving even while the page behind it is still being built: the screen reacts on the
// very next frame instead of sitting still until the page is ready.
const root = document.documentElement;
const view = document.getElementById('view');
const KEY = 'tvPosterAt';
const EASE = 'cubic-bezier(.2,.8,.2,1)';
let fly = null;     // the flying poster
let home = null;    // { id, src, card rect } for the way back
let landed = null;  // where the page's poster really is

// Sizes come back scaled on the TV (the whole page is drawn zoomed); fixed boxes use page units.
const unit = (el) => { const r = el.getBoundingClientRect(); const k = r.width > 0 ? el.offsetWidth / r.width : 1; return { l: r.left * k, t: r.top * k, w: r.width * k, h: r.height * k }; };
const guess = () => { try { const g = JSON.parse(localStorage.getItem(KEY) || 'null'); if (g && g.w > 20) return g; } catch {} return { l: 144, t: 327, w: 252, h: 381 }; };
let veil = null;    // covers the screen you are leaving, from the first frame of the glide
const unveil = (fade) => { const v = veil; veil = null; if (!v) return; v.style.transition = `opacity ${fade}ms linear`; v.style.opacity = '0'; setTimeout(() => v.remove(), fade + 30); };
const drop = (fade = 140) => { const wait = veil ? 130 : 0; unveil(130); const f = fly; fly = null; if (!f) return; f.style.transition = `opacity ${fade}ms linear ${wait}ms`; f.style.opacity = '0'; setTimeout(() => f.remove(), fade + wait + 30); };
function make(src, r) {
  drop(0);
  const d = document.createElement('div');
  d.className = 'tv-fly';
  d.style.cssText = `left:${r.l}px;top:${r.t}px;width:${r.w}px;height:${r.h}px;background-image:url("${src.replace(/"/g, '%22')}")`;
  document.body.appendChild(d);
  return (fly = d);
}
const glide = (el, from, to, ms) => el.animate(
  [{ transform: 'none' }, { transform: `translate(${to.l - from.l}px, ${to.t - from.t}px) scale(${to.w / from.w}, ${to.h / from.h})` }],
  { duration: ms, easing: EASE, fill: 'forwards' });

view.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button || root.classList.contains('tv-fast')) return;
  const a = e.target.closest?.('a.card.portrait[href^="#/item/"]');
  if (!a || a.classList.contains('click-play') || !view.contains(a)) return;
  const im = a.querySelector('.art img'); const art = a.querySelector('.art');
  if (!im || !im.complete || !im.naturalWidth || !art) return;
  const from = unit(art); if (from.w < 20) return;
  const href = a.getAttribute('href'); const src = im.currentSrc || im.src;
  e.preventDefault();
  home = { id: a.dataset.id, src, r: from }; landed = null;
  const d = make(src, from); const to = guess();
  // The old screen fades out under the poster straight away (opacity only, so it keeps moving
  // while the title page is still being built) and the title page appears when the poster lands.
  veil = document.createElement('div'); veil.className = 'tv-veil'; document.body.insertBefore(veil, d);
  veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 170, easing: 'ease-out', fill: 'forwards' });
  const anim = glide(d, from, to, 380);
  // One drawn frame first, so the glide is already running when the page starts to build.
  requestAnimationFrame(() => setTimeout(() => { location.hash = href; }, 0));
  // Settle on the page's real poster once both the glide and the page are there.
  const t0 = performance.now();
  const settle = () => {
    if (fly !== d) return;
    const p = view.querySelector('.detail-poster .art');
    if (!p || !p.offsetWidth || document.querySelector('.view-ghost')) { if (performance.now() - t0 > 2600) drop(); else setTimeout(settle, 60); return; }
    const real = unit(p); landed = real;
    try { localStorage.setItem(KEY, JSON.stringify(real)); } catch {}
    const pim = p.querySelector('img');
    const done = () => { if (fly === d) drop(); };
    if (Math.abs(real.l - to.l) + Math.abs(real.t - to.t) + Math.abs(real.w - to.w) > 3) {
      // The page put its poster somewhere else than expected: ease across to it.
      anim.cancel(); d.style.cssText += `;left:${to.l}px;top:${to.t}px;width:${to.w}px;height:${to.h}px`;
      glide(d, to, real, 160).finished.then(() => (pim && !pim.complete ? setTimeout(done, 400) : done()), done);
    } else if (pim && !pim.complete) { pim.addEventListener('load', done, { once: true }); setTimeout(done, 900); } else done();
  };
  anim.finished.then(settle, () => {});
});

// Back from a title page to the screen it was opened from: the poster glides home.
addEventListener('hashchange', (e) => {
  const h = home; if (!h || !landed) return;
  const was = (e.oldURL || '').split('#')[1] || '';
  if (!was.startsWith('/item/' + encodeURIComponent(h.id))) return;
  home = null; const fromR = landed; landed = null;
  if (location.hash.startsWith('#/item/')) return;
  requestAnimationFrame(() => {
    const a = document.activeElement;
    if (!a || !a.matches?.('a.card.portrait') || a.dataset.id !== h.id || !view.contains(a)) return;
    const art = a.querySelector('.art'); if (!art) return;
    const to = unit(art); if (to.w < 20) return;
    const d = make(h.src, fromR);
    glide(d, fromR, to, 300).finished.then(() => { if (fly === d) drop(90); }, () => {});
  });
});
