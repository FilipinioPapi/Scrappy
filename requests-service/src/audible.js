// Audiobooks from the Audible catalogue (the same one Audiobookshelf uses to match books).
// Open Library is the fallback when Audible has nothing.
import { cache, getJson, norm } from './util.js';

const API = 'https://api.audible.com/1.0/catalog/products';
const RG = 'contributors,media,product_attrs,product_desc,series';
const c = cache(12 * 3600 * 1000, 2000);
const get = (u) => c.wrap(u, () => getJson(u, { headers: { accept: 'application/json' } }));

const hm = (min) => (min ? `${Math.floor(min / 60)}h ${min % 60}m` : '');
export function bookShape(p) {
  const ser = (p.series || [])[0];
  return {
    id: p.asin, source: 'audible', title: p.title, subtitle: p.subtitle || '',
    author: (p.authors || []).map((a) => a.name).join(', '), authorId: p.authors?.[0]?.asin || '',
    narrator: (p.narrators || []).map((a) => a.name).join(', '),
    series: ser ? { id: ser.asin, title: ser.title, sequence: ser.sequence || '' } : null,
    year: (p.release_date || '').slice(0, 4), released: !p.release_date || p.release_date <= new Date().toISOString().slice(0, 10), releaseDate: p.release_date || '',
    length: hm(p.runtime_length_min), cover: p.product_images?.['500'] || Object.values(p.product_images || {})[0] || '',
  };
}
// Several editions of one book (unabridged / dramatised / other narrator): keep the first.
const dedupe = (books) => { const seen = new Set(); return books.filter((b) => { const k = norm(b.title) + '|' + norm(b.author.split(',')[0]); return !seen.has(k) && seen.add(k); }); };
const isBook = (p) => !p.content_delivery_type || ['SinglePartBook', 'MultiPartBook', 'BookSeries'].includes(p.content_delivery_type) || p.content_type === 'Product';

async function products(params) {
  const u = new URL(API);
  for (const [k, v] of Object.entries({ num_results: 40, products_sort_by: 'Relevance', response_groups: RG, image_sizes: '500', ...params })) u.searchParams.set(k, v);
  const r = await get(u.toString());
  return (r?.products || []).filter(isBook).filter((p) => p.title).map(bookShape);
}

async function openLibrary(q) {
  const r = await get(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=15&fields=key,title,author_name,first_publish_year,cover_i`);
  return (r?.docs || []).map((d) => ({
    id: d.key.replace('/works/', ''), source: 'openlibrary', title: d.title, subtitle: '', author: (d.author_name || []).join(', '), authorId: '', narrator: '',
    series: null, year: String(d.first_publish_year || ''), released: true, releaseDate: '', length: '', cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
  }));
}

/** One search, grouped: books, series and authors. */
export async function searchBooks(q) {
  let books = [];
  try { books = dedupe(await products({ keywords: q })); } catch (e) { console.warn('Audible:', e.message); }
  if (!books.length) {
    books = await openLibrary(q).catch(() => []);
    return { books, series: [], authors: [], source: 'openlibrary' };
  }
  const qn = norm(q);
  const series = new Map(), authors = new Map();
  for (const b of books) {
    if (b.series && norm(b.series.title).includes(qn) && !series.has(b.series.id)) series.set(b.series.id, { id: b.series.id, title: b.series.title, author: b.author, cover: b.cover });
    for (const name of b.author.split(',').map((s) => s.trim())) if (name && norm(name).includes(qn) && !authors.has(norm(name))) authors.set(norm(name), { id: name, name, cover: '' });
  }
  return { books: books.slice(0, 24), series: [...series.values()].slice(0, 6), authors: [...authors.values()].slice(0, 6), source: 'audible' };
}

/** A series' books in order. */
export async function seriesBooks(seriesAsin) {
  const r = await get(`${API}/${seriesAsin}?response_groups=relationships,product_desc,media&image_sizes=500`);
  const p = r?.product || {};
  const kids = (p.relationships || []).filter((x) => x.relationship_to_product === 'child' && x.relationship_type === 'series')
    .sort((a, b) => (Number(a.sort) || parseFloat(a.sequence) || 0) - (Number(b.sort) || parseFloat(b.sequence) || 0));
  const books = [];
  for (let i = 0; i < kids.length; i += 50) {
    const chunk = kids.slice(i, i + 50);
    const got = await products({ asins: chunk.map((k) => k.asin).join(','), num_results: 50, products_sort_by: '' });
    const by = new Map(got.map((b) => [b.id, b]));
    for (const k of chunk) { const b = by.get(k.asin); if (b) books.push({ ...b, series: { id: seriesAsin, title: p.title, sequence: k.sequence || b.series?.sequence || '' } }); }
  }
  return { id: seriesAsin, title: p.title || books[0]?.series?.title || 'Series', cover: books[0]?.cover || p.product_images?.['500'] || '', author: books[0]?.author || '', books: dedupe(books) };
}

/** An author's books, newest first. */
export async function authorBooks(name) {
  const books = dedupe(await products({ author: name, num_results: 50, products_sort_by: '-ReleaseDate' }))
    .filter((b) => b.author.split(',').some((a) => norm(a) === norm(name)));
  return { id: name, name, books };
}

export async function bookById(id, source) {
  if (source === 'openlibrary') {
    const w = await get(`https://openlibrary.org/works/${id}.json`);
    return { id, source, title: w.title, author: '', cover: w.covers?.[0] ? `https://covers.openlibrary.org/b/id/${w.covers[0]}-M.jpg` : '', year: '', series: null, released: true };
  }
  const r = await get(`${API}/${id}?response_groups=${RG}&image_sizes=500`);
  return bookShape(r.product);
}
