// End-to-end test of the service with every outside server faked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { install, env, flags } from './fake.js';

env();
process.env.PORT = '0';

before(async () => {
  install();
  const { openDb } = await import('../src/db.js');
  openDb(':memory:');
});

const call = async (method, path, body, user = 'u1') => {
  const { route } = await import('../src/api.js');
  const u = new URL('http://x' + path);
  return route(method, u.pathname, Object.fromEntries(u.searchParams), body, { headers: { 'x-emby-token': 'tok', 'x-emby-userid': user } });
};

test('who am I', async () => {
  assert.deepEqual((await call('GET', '/api/me')).admin, true);
  assert.equal((await call('GET', '/api/me', null, 'u2')).admin, false);
});
test('movie search: on the server, not out yet, collection', async () => {
  const r = await call('GET', '/api/search?type=movie&q=dune');
  assert.equal(r.items[0].onServer, 'e1');
  assert.equal(r.items[1].onServer, null);
  assert.match(r.items[1].release.label, /^In cinemas /);
  assert.equal(r.collection.total, 2); assert.equal(r.collection.onServer, 1); assert.equal(r.collection.notOut, 1);
});
test('requests merge and stay private', async () => {
  const a = await call('POST', '/api/requests', { items: [{ type: 'movie', extId: '999' }] }, 'u2');
  assert.equal(a.results[0].joined, false);
  const b = await call('POST', '/api/requests', { items: [{ type: 'movie', extId: '999' }, { type: 'movie', extId: '438631' }] }, 'u1');
  assert.equal(b.results[0].joined, true);
  assert.equal(b.results[1].skipped, 'on the server');
  const mine = await call('GET', '/api/requests', null, 'u2');
  assert.deepEqual(mine.requests[0].users, ['Sarah']); assert.equal(mine.requests[0].others, 1);
  const all = await call('GET', '/api/requests?scope=all');
  assert.deepEqual(all.requests[0].users, ['Sarah', 'Jayden']);
  await assert.rejects(call('GET', '/api/requests?scope=all', null, 'u2'), /admins/);
});
test('tv seasons compared with Emby, parts merge', async () => {
  const v = await call('GET', '/api/tv/95396');
  assert.deepEqual(v.seasons.map((s) => s.status), ['complete', 'partial', 'soon']);
  await call('POST', '/api/requests', { items: [{ type: 'tv', extId: '95396', parts: { episodes: { 2: [3] } }, follow: true }] }, 'u2');
  await call('POST', '/api/requests', { items: [{ type: 'tv', extId: '95396', parts: { seasons: [3] } }] }, 'u1');
  const all = await call('GET', '/api/requests?scope=all&type=tv');
  assert.deepEqual(all.requests[0].parts, { seasons: [3], episodes: { 2: [3] } });
  const v2 = await call('GET', '/api/tv/95396');
  assert.equal(v2.seasons[1].episodes[2].requested, true); assert.equal(v2.following, false);
  assert.equal((await call('GET', '/api/tv/95396', null, 'u2')).following, true);
});
test('admin status + notices, cancel', async () => {
  const all = await call('GET', '/api/requests?scope=all&type=movie');
  const id = all.requests[0].id;
  await assert.rejects(call('PATCH', `/api/requests/${id}`, { status: 'cantfind' }, 'u2'), /admins/);
  await call('PATCH', `/api/requests/${id}`, { status: 'cantfind', note: 'Not out digitally yet' });
  const n = await call('GET', '/api/notices', null, 'u2');
  assert.equal(n.notices[0].request.adminNote, 'Not out digitally yet');
  await call('POST', '/api/notices/seen', {}, 'u2');
  assert.equal((await call('GET', '/api/notices', null, 'u2')).notices.length, 0);
  const del = await call('DELETE', `/api/requests/${id}`, null, 'u2');
  assert.equal(del.left, 1);
});
test('music: albums only by default, on-server check, auto available', async () => {
  const r = await call('GET', '/api/search?type=music&q=radiohead');
  assert.deepEqual(r.albums.map((a) => a.title), ['OK Computer', 'In Rainbows']);
  assert.equal(r.albums[0].onServer, 'nd1');
  assert.equal(r.artists[0].onServerCount, 1);
  await call('POST', '/api/requests', { items: [{ type: 'album', extId: 'rg2' }] }, 'u2');
  flags.nd2 = true;
  const { checkArrivals } = await import('../src/jobs.js');
  await checkArrivals();
  const mine = await call('GET', '/api/requests?type=album', null, 'u2');
  assert.equal(mine.requests[0].status, 'available'); assert.equal(mine.requests[0].libRef, 'nd2');
  const n = await call('GET', '/api/notices', null, 'u2');
  assert.equal(n.notices[0].request.title, 'In Rainbows');
});
