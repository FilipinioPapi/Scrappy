// What's already on Audiobookshelf, matched by Audible number (ASIN), then title + author.
import { config } from './config.js';
import { getJson, norm } from './util.js';

const on = () => !!(config.abs.url && config.abs.token);
const get = (path) => getJson(config.abs.url + path, { headers: { authorization: 'Bearer ' + config.abs.token, accept: 'application/json' }, timeout: 60000 });

let index = { asin: new Map(), title: new Map(), at: 0 };
export async function refreshAbs() {
  if (!on()) return index;
  const asin = new Map(), title = new Map();
  const libs = ((await get('/api/libraries')).libraries || []).filter((l) => l.mediaType === 'book');
  for (const l of libs) {
    for (let page = 0; page < 400; page++) {
      const r = await get(`/api/libraries/${l.id}/items?limit=500&page=${page}&minified=1`);
      for (const it of r.results || []) {
        const m = it.media?.metadata || {};
        const e = { id: it.id, title: m.title, author: m.authorName || '' };
        if (m.asin) asin.set(m.asin.toUpperCase(), e);
        title.set(`${norm(m.title)}|${norm((m.authorName || '').split(',')[0])}`, e);
        title.set(`${norm(m.title)}|`, e);
      }
      if ((r.results || []).length < 500) break;
    }
  }
  index = { asin, title, at: Date.now() };
  return index;
}
async function ix() {
  if (Date.now() - index.at > 5 * 60 * 1000) { try { await refreshAbs(); } catch (e) { console.warn('Audiobookshelf:', e.message); } }
  return index;
}
export const absOn = on;

export async function findBook(asin, title, author) {
  const i = await ix();
  if (asin && i.asin.has(String(asin).toUpperCase())) return i.asin.get(String(asin).toUpperCase());
  const t = norm(title), a = norm(String(author || '').split(',')[0]);
  return i.title.get(`${t}|${a}`) || (a ? null : i.title.get(`${t}|`)) || null;
}
