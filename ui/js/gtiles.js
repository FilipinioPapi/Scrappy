// Genre tiles and the genre banner, design A "Fan" (approved): big covers fanned
// on the right and bleeding off the edge, the genre's colour sweeping in from the
// left, and a faint symbol behind.
//
// Colours come from keywords in the genre's name, so any genre added later still
// gets a fitting look. If no keyword matches, we take the colour from the genre's
// covers. If even that fails, a steady colour is picked from the name.
import { esc } from './components.js';

// [keywords, [bright, mid, dark], symbol]. The first match wins, so the more specific entries come first.
const MOODS = [
  [['horror', 'scary', 'ghost', 'zombie', 'vampire', 'paranormal', 'supernatural'], ['#B3121B', '#2A0405', '#0A0000'], '☠'],
  [['thriller', 'suspense', 'spy', 'espionage', 'psychological'], ['#5E6B7A', '#1A1E26', '#07080B'], '◉'],
  [['true crime', 'crime', 'mystery', 'detective', 'noir', 'cozy'], ['#2E6F73', '#0E2A2E', '#030C0E'], '⚲'],
  [['science fiction', 'sci-fi', 'scifi', 'sf', 'space', 'cyberpunk', 'dystopia', 'post-apocalyptic', 'litrpg', 'gamelit'], ['#1F8FE0', '#0B2550', '#030915'], '✦'],
  [['fantasy', 'magic', 'dragon', 'epic', 'sword', 'myth', 'fairy', 'progression'], ['#8E44D9', '#2A1150', '#0F0620'], '⚔'],
  [['romance', 'love', 'romantic'], ['#E8507A', '#5A1230', '#1C0610'], '♥'],
  [['erotica', 'erotic'], ['#C2185B', '#4A0A24', '#160309'], '♥'],
  [['young adult', 'teen', 'ya'], ['#FF7A59', '#5B1E6E', '#1A0822'], '★'],
  [['children', 'kids', 'juvenile', 'middle grade', 'picture'], ['#FFC23D', '#D8582B', '#3A1206'], '✿'],
  [['history', 'historical', 'war', 'military', 'ancient', 'medieval'], ['#C9893A', '#4A2C10', '#160C04'], '⌛'],
  [['biography', 'memoir', 'autobiography', 'biographies'], ['#D9A066', '#4D3016', '#140C05'], '❝'],
  [['comedy', 'humor', 'humour', 'funny', 'satire'], ['#FFB020', '#B4441A', '#2E0E04'], '☺'],
  [['self-help', 'self help', 'personal development', 'motivation', 'productivity', 'success'], ['#2FB57A', '#0E4A33', '#04140E'], '↑'],
  [['business', 'finance', 'money', 'economics', 'investing', 'career', 'entrepreneur'], ['#2A9D8F', '#0E3A35', '#04100E'], '$'],
  [['science', 'physics', 'biology', 'chemistry', 'astronomy', 'nature', 'math'], ['#3AB0C8', '#0E3F55', '#041219'], '⚛'],
  [['technology', 'computer', 'programming', 'tech'], ['#4F7BFF', '#162A66', '#060C1E'], '⌘'],
  [['health', 'fitness', 'nutrition', 'diet', 'wellness', 'medical'], ['#6CC24A', '#225017', '#0A1806'], '✚'],
  [['psychology', 'mind', 'mental', 'philosophy'], ['#7E6BD6', '#2A2160', '#0B0920'], '◎'],
  [['religion', 'spiritual', 'christian', 'faith', 'bible'], ['#E8C872', '#6B4E16', '#1C1405'], '✧'],
  [['politics', 'social', 'society', 'current affairs', 'law'], ['#3D5A80', '#14223A', '#060A12'], '⚖'],
  [['travel', 'adventure', 'outdoors', 'exploration'], ['#E07A3A', '#5A2A10', '#180A03'], '➶'],
  [['western', 'cowboy'], ['#C8743A', '#5A2E12', '#1A0C04'], '☼'],
  [['poetry', 'drama', 'plays', 'classic', 'literature', 'literary'], ['#B04A5A', '#4A1520', '#14050A'], '✎'],
  [['music', 'art', 'arts', 'photography', 'design'], ['#E0559B', '#5A1640', '#1A0612'], '♪'],
  [['cooking', 'food', 'cookbook'], ['#E8803A', '#6B2E0E', '#1C0A03'], '♨'],
  [['sports', 'sport'], ['#2C9C5A', '#0F3E22', '#04120A'], '⚑'],
  [['education', 'language', 'reference', 'study'], ['#4C8BC9', '#173250', '#060E18'], '✐'],
  [['short stories', 'anthology', 'collection'], ['#9A6FB0', '#3A2246', '#100916'], '❖'],
  [['fiction', 'general', 'contemporary', 'novel'], ['#3E7CB1', '#16304A', '#070F18'], '✎'],
  [['nonfiction', 'non-fiction'], ['#8C7A6B', '#33291F', '#0E0B08'], '❝'],
];
const BOOK_SYM = '❧';

/** Whole-word-ish match so "ya" doesn't catch "Maya" and "sf" doesn't catch "self". */
function matches(name, kw) {
  if (kw.length <= 3) return new RegExp(`(^|[^a-z])${kw}([^a-z]|$)`).test(name);
  return name.includes(kw);
}
const hsl = (h, s, l) => `hsl(${Math.round(h)} ${s}% ${l}%)`;
function nameHue(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }

// Colours learned from covers, saved so tiles look right straight away next time.
const CK = 'gtColors';
let learned = {};
try { learned = JSON.parse(localStorage.getItem(CK) || '{}') || {}; } catch {}

/** The look for a genre: { c: [bright, mid, dark], sym, fromCovers } */
export function genreLook(g) {
  const k = String(g || '').toLowerCase().trim();
  for (const [kws, c, sym] of MOODS) if (kws.some((w) => matches(k, w))) return { c, sym };
  if (learned[k]) return { c: learned[k], sym: BOOK_SYM };
  const h = nameHue(k);
  return { c: [hsl(h, 62, 48), hsl(h + 18, 58, 18), hsl(h + 30, 50, 6)], sym: BOOK_SYM, fromCovers: true };
}
const vars = (c) => `--c1:${c[0]};--c2:${c[1]};--c3:${c[2]}`;

/** A tile. `cover(item, w)` returns an image URL; `title(item)` the book's title. */
export function fanTile(g, list, href, cover, title) {
  const look = genreLook(g);
  const pics = list.slice(0, 3);
  return `<a class="gfan" href="${href}" style="${vars(look.c)}" data-genre="${esc(g)}"${look.fromCovers ? ' data-learn="1"' : ''}>
    <span class="gf-sym" aria-hidden="true">${look.sym}</span>
    ${pics.map((it, i) => `<span class="gf-cv" style="--i:${i};--n:${pics.length}"><b>${esc(title(it) || '')}</b><img src="${cover(it, 240)}" alt="" crossorigin="anonymous" onload="this.classList.add('in')" onerror="this.remove()"></span>`).join('')}
    <span class="gf-nm">${esc(g)}</span><span class="gf-ct">${list.length} ${list.length === 1 ? 'book' : 'books'}</span></a>`;
}

/** The big banner at the top of a genre page. `inner` is the title, line and buttons. */
export function fanBanner(g, list, cover, title, inner) {
  const look = genreLook(g);
  const pics = list.slice(0, 6);
  return `<div class="gfan big" style="${vars(look.c)}" data-genre="${esc(g)}"${look.fromCovers ? ' data-learn="1"' : ''}>
    <span class="gf-sym" aria-hidden="true">${look.sym}</span>
    ${pics.map((it, i) => `<span class="gf-cv" style="--i:${i};--n:${pics.length}"><b>${esc(title(it) || '')}</b><img src="${cover(it, 400)}" alt="" crossorigin="anonymous" onload="this.classList.add('in')" onerror="this.remove()"></span>`).join('')}
    ${inner}</div>`;
}

/** For genres with no keyword match: once the covers load, colour the tile from them. */
export function learnColors(root) {
  root.querySelectorAll('.gfan[data-learn]').forEach((el) => {
    const imgs = [...el.querySelectorAll('.gf-cv img')];
    if (!imgs.length) return;
    let done = 0;
    const finish = () => {
      if (++done < imgs.length) return;
      const c = averageColor(imgs.filter((i) => i.complete && i.naturalWidth));
      if (!c) return;
      const pal = paletteFrom(c);
      el.style.setProperty('--c1', pal[0]); el.style.setProperty('--c2', pal[1]); el.style.setProperty('--c3', pal[2]);
      learned[String(el.dataset.genre).toLowerCase().trim()] = pal;
      try { localStorage.setItem(CK, JSON.stringify(learned)); } catch {}
    };
    imgs.forEach((i) => { if (i.complete) finish(); else { i.addEventListener('load', finish, { once: true }); i.addEventListener('error', finish, { once: true }); } });
  });
}
function averageColor(imgs) {
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = 16;
    const x = cv.getContext('2d', { willReadFrequently: true });
    let r = 0, g = 0, b = 0, n = 0;
    for (const im of imgs) {
      x.drawImage(im, 0, 0, 16, 16);
      const d = x.getImageData(0, 0, 16, 16).data;
      for (let i = 0; i < d.length; i += 4) {
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        const w = (mx - mn) / 255 + 0.05; // lean towards colourful pixels over greys
        r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w;
      }
    }
    return n ? [r / n, g / n, b / n] : null;
  } catch { return null; } // a picture the browser won't let us read
}
function paletteFrom([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const s = Math.max(35, Math.min(75, (d / (1 - Math.abs(mx + mn - 1) || 1)) * 100));
  return [hsl(h, s, 46), hsl(h + 12, s - 5, 18), hsl(h + 24, s - 15, 6)];
}
