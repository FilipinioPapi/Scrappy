// Scrappy request service. Plain Node, no extra packages.
import http from 'node:http';
import { config } from './config.js';
import { openDb } from './db.js';
import { route, HttpError } from './api.js';
import { startJobs } from './jobs.js';

openDb();

const server = http.createServer(async (req, res) => {
  const send = (status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-emby-token,x-emby-userid', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE' });
      return res.end();
    }
    const u = new URL(req.url, 'http://x');
    // Works whether or not the reverse proxy strips the /requests prefix.
    let path = u.pathname;
    if (config.basePath && path.startsWith(config.basePath)) path = path.slice(config.basePath.length) || '/';
    if (path === '/' ) return send(200, { name: 'Scrappy requests', ok: true });
    let body = null;
    if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 1e6) throw new HttpError(413, 'Too big.'); }
      try { body = raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, 'Bad JSON.'); }
    }
    const out = await route(req.method, path, Object.fromEntries(u.searchParams), body, req);
    send(200, out);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 502;
    if (!(e instanceof HttpError)) console.error(req.method, req.url, e);
    send(status, { error: e instanceof HttpError ? e.message : `Something went wrong: ${e.message}` });
  }
});

server.listen(config.port, () => {
  console.log(`Scrappy requests listening on :${config.port}${config.basePath}`);
  console.log(`Admins: ${config.admins.join(', ') || '(none set)'} · Region: ${config.region}`);
  for (const [k, ok] of Object.entries({ Emby: config.emby.url && config.emby.apiKey, TMDB: config.tmdbKey, Navidrome: config.navidrome.url, Audiobookshelf: config.abs.url })) if (!ok) console.warn(`${k} is not set up yet (see README).`);
  startJobs();
});
