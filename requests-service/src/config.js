// All settings come from environment variables (see README.md).
const env = (k, d = '') => (process.env[k] ?? d).trim();
const url = (k) => env(k).replace(/\/+$/, '');

export const config = {
  port: Number(env('PORT', '8095')),
  basePath: '/' + env('BASE_PATH', '/requests').replace(/^\/+|\/+$/g, ''),
  dataDir: env('DATA_DIR', './data'),
  region: env('REGION', 'US').toUpperCase(),
  admins: env('ADMINS').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  tmdbKey: env('TMDB_API_KEY'),
  emby: { url: url('EMBY_URL'), apiKey: env('EMBY_API_KEY') },
  navidrome: { url: url('NAVIDROME_URL'), user: env('NAVIDROME_USER'), pass: env('NAVIDROME_PASSWORD') },
  abs: { url: url('ABS_URL'), token: env('ABS_TOKEN') },
  // How often the libraries are re-read and open requests checked (minutes).
  checkEvery: Number(env('CHECK_EVERY_MINUTES', '10')),
  // Optional: where to send new-request / status events (Discord bot later). Empty = off.
  handoffUrl: env('HANDOFF_URL'),
  handoffSecret: env('HANDOFF_SECRET'),
};
if (config.basePath === '/') config.basePath = '';
