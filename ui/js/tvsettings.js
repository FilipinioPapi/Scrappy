// Scrappy Native: the Settings screen is drawn natively (approved mock "Settings"); this side
// describes the rows (same settings as settings.js shows on the TV) and does what they ask.
import { api } from './api.js';
import { toast } from './components.js';
import { pref, setPref, on } from './prefs.js';
import { updInfo, refreshAdmin } from './updates.js';
import { book } from './bplayer.js';

const { invoke } = window.__TAURI__.core;
const QUALITIES = [['', 'Original'], ['40000000', '40 Mbps · 4K'], ['20000000', '20 Mbps · 1080p'], ['10000000', '10 Mbps · 1080p'], ['6000000', '6 Mbps · 720p'], ['3000000', '3 Mbps · 720p'], ['1500000', '1.5 Mbps · 480p']];
const LANGS = [['eng', 'English'], ['spa', 'Spanish'], ['fre', 'French'], ['ger', 'German'], ['ita', 'Italian'], ['por', 'Portuguese'], ['dut', 'Dutch'], ['swe', 'Swedish'], ['nor', 'Norwegian'], ['dan', 'Danish'], ['fin', 'Finnish'], ['pol', 'Polish'], ['rus', 'Russian'], ['tur', 'Turkish'], ['ara', 'Arabic'], ['hin', 'Hindi'], ['jpn', 'Japanese'], ['kor', 'Korean'], ['chi', 'Chinese']];
const SRV = [['emby', 'Emby', 'Movies & TV', 'E'], ['navidrome', 'Navidrome', 'Music', 'N'], ['audiobookshelf', 'Audiobookshelf', 'Audiobooks', 'A']];
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const ls = (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const fmtMB = (b) => (b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(1) + ' GB' : Math.max(0, Math.round(b / 1024 ** 2)) + ' MB');

const G = (label) => ({ t: 'grp', label });
const SW = (key, label, desc, val = on(key)) => ({ t: 'sw', key, label, desc, on: !!val });
const CH = (key, label, desc, opts, cur = pref(key)) => ({ t: 'ch', key, label, desc, vals: opts.map((o) => String(o[0])), opts: opts.map((o) => o[1]), cur: Math.max(0, opts.findIndex((o) => String(o[0]) === String(cur))) });
const BT = (act, label, desc, btn, extra = {}) => ({ t: 'bt', act, label, desc, btn, ...extra });

/** Everything the Settings screen shows. */
export async function model() {
  let session = {}; try { session = await api.session(); } catch {}
  let admin = updInfo().admin; refreshAdmin().catch(() => {});
  let cache = ''; try { cache = fmtMB((await invoke('cache_size')).bytes); } catch {}
  const sv = session.servers || {};
  const seek = pref('skipBack') === pref('skipFwd') ? pref('skipBack') : '10';
  const u = updInfo();
  const ver = u.current || '';
  const sections = [
    { h: 'YOU' },
    { id: 'account', name: 'Account & servers', kicker: 'SETTINGS', rows: [
      G('SIGNED IN'),
      ...SRV.map(([k, name, what, letter]) => {
        const s = sv[k] || {};
        return s.signedIn
          ? BT('server', `${name} · ${what}`, `${s.user || ''}${s.name ? ' on ' + s.name : ''} · ● Connected`, 'Switch account', { arg: k, letter })
          : BT('switch', `${name} · ${what}`, 'Not signed in', 'Sign in', { arg: k, letter, red: true });
      }),
      G('THIS TV'),
      CH('startTab', 'Start on', 'Which tab opens when Scrappy starts.', [['last', 'Last used'], ['#/home', 'Movies & TV'], ['#/music', 'Music'], ['#/audiobooks', 'Audiobooks']]),
      BT('signoutAll', 'Sign out of everything', 'Removes all three accounts from this TV.', 'Sign out of all'),
    ] },
    { h: 'PLAYBACK' },
    { id: 'tv', name: 'Movies & TV', kicker: 'PLAYBACK', rows: [
      G('PLAYING'),
      SW('autoplay', 'Auto-play next episode', 'Starts the next episode when one ends.'),
      CH('upNextSecs', 'Countdown before the next episode', 'How long the “Up next” card waits.', [['5', '5s'], ['10', '10s'], ['20', '20s']]),
      SW('skipIntro', 'Skip intros automatically', 'Uses the intro markers on Emby. Off: shows a Skip Intro button.'),
      SW('skipCredits', 'Skip credits to the next episode', 'Only when Emby marks where the credits start. Otherwise Up next shows near the end, as now.'),
      SW('tvSoundThrough', 'Send Dolby and DTS untouched to a soundbar', 'Off: Scrappy decodes the sound itself, which is the safe choice. On this TV, sending it untouched can freeze the film after skipping.'),
      CH('seek', 'Seek step', 'How far the skip buttons jump.', [['5', '5s'], ['10', '10s'], ['30', '30s']], seek),
      G('QUALITY'),
      CH('quality', 'Streaming quality', 'Original plays the file as it is. Lower saves data and avoids buffering on a slow connection.', QUALITIES),
      G('HOME SCREEN'),
      CH('heroMode', 'Home banner', 'What the big banner at the top shows.', [['picks', 'Picks for you'], ['recent', 'Recently added'], ['off', 'Off']]),
    ] },
    { id: 'subs', name: 'Subtitles & audio', kicker: 'PLAYBACK', rows: [
      G('SUBTITLES'),
      CH('subStart', 'Which subtitles start', 'A pick you make for a show always wins.', [['default', 'Show’s own default'], ['mine', 'Always my language'], ['off', 'Off unless I turn them on']]),
      CH('subLang', 'Subtitle language', 'Used by “Always my language” and subtitle downloads.', LANGS),
      CH('subScale', 'Subtitle size', '', [['0.8', 'Small'], ['1', 'Medium'], ['1.25', 'Large'], ['1.5', 'Extra large']]),
      CH('subStyle', 'Subtitle style', 'Outline, shadow or a dark box behind the text.', [['outline', 'Outline'], ['shadow', 'Shadow'], ['box', 'Box']]),
      BT('resetSubs', 'Forget my per-show picks', 'Go back to every show’s own default.', 'Reset'),
      G('AUDIO'),
      CH('audioLang', 'Preferred audio language', 'Picked when a film or show has more than one.', [['', 'Original language'], ...LANGS]),
      SW('nightMode', 'Night mode', 'Evens out loud explosions and quiet voices.'),
      SW('volBoost', 'Volume boost', 'Lets the volume go up to 150% for quiet files.'),
    ] },
    { id: 'music', name: 'Music', kicker: 'PLAYBACK', rows: [
      G('PLAYING'),
      SW('gapless', 'Gapless playback', 'No silence between songs on an album.'),
      SW('rgain', 'Volume levelling', 'Keeps loud and quiet songs at a similar volume (uses the songs’ ReplayGain tags).'),
      G('NOW PLAYING'),
      SW('mnowviz', 'Visualizer', 'The moving bars in Now playing.'),
      SW('lyricsAuto', 'Fetch lyrics automatically', 'Looks online (LRCLIB) when Navidrome has none, without pressing the button.'),
    ] },
    { id: 'books', name: 'Audiobooks', kicker: 'PLAYBACK', rows: [
      G('LISTENING'),
      CH('bspeed', 'Speed', 'Same as the speed button in the player.', SPEEDS.map((v) => [String(v), v + '×']), String(book.speed || 1)),
      CH('bSkip', 'Skip back / forward', 'What the skip buttons jump, in seconds.', [['10/10', '10 / 10'], ['10/30', '10 / 30'], ['15/30', '15 / 30'], ['30/30', '30 / 30']]),
      SW('bRewind', 'Rewind a little after a pause', 'Goes back 5 seconds when you carry on after a minute or more (15 after half an hour).'),
    ] },
    { h: 'APP' },
    { id: 'look', name: 'Look & feel', kicker: 'APP', rows: [
      G('DISPLAY'),
      SW('reduceMotion', 'Reduce motion', 'Fewer animations, and the home banner doesn’t slide by itself.'),
      SW('introSplash', 'Opening screen', 'The SCRAPPY MEDIA CENTER screen when Scrappy opens.'),
      G('STORAGE'),
      BT('clearCache', 'Picture cache', `Posters and covers kept on this TV so pages load fast.${cache ? ' Using ' + cache + '.' : ''}`, 'Clear'),
      CH('cacheMax', 'Cache size limit', 'The oldest pictures are removed when it gets bigger.', [['0', 'No limit'], ['500', '500 MB'], ['1024', '1 GB'], ['2048', '2 GB'], ['5120', '5 GB']]),
    ] },
    { id: 'updates', name: 'Updates', kicker: 'APP', rows: [
      BT('check', `Version ${ver}`, u.found ? `Version ${u.found} is ready` : 'Looks for a newer Scrappy Media Center.', 'Check now'),
      ...(admin ? [CH('updChannel', 'Update channel', 'Only admins see this. Everyone else gets Stable.', [['preview', 'Preview'], ['stable', 'Stable']], ls('updChannel') === 'stable' ? 'stable' : 'preview')] : []),
      SW('updAuto', 'Install updates when Scrappy starts', 'A downloaded update installs the next time Scrappy opens.', ls('updAuto') !== 'off'),
    ] },
    { id: 'about', name: 'About & help', kicker: 'APP', rows: [
      BT('goUpdates', `Version ${ver}`, 'Scrappy Media Center for Emby, Navidrome and Audiobookshelf.', 'Updates'),
      BT('news', 'What’s new', 'What changed in the latest update.', 'Read'),
      BT('tips', 'Remote tips', 'The handy things the remote can do in Scrappy.', 'Show'),
      BT('restart', 'Restart Scrappy', 'Closes Scrappy completely and opens it again. Use this if something is stuck. Nobody is signed out.', 'Restart'),
    ] },
  ];
  return { sections };
}

/** Do what a row asks. Answers { ok, toast, err, info: {title, lines}, model }. */
export async function act(a, args = {}) {
  try {
    switch (a) {
      case 'model': return { ok: true, model: await model() };
      case 'set': {
        const { key, value } = args;
        if (key === 'seek') { setPref('skipBack', value); setPref('skipFwd', value); }
        else if (key === 'bspeed') { const { setSpeed } = await import('./bplayer.js'); setSpeed(Number(value)); }
        else if (key === 'updChannel' || key === 'updAuto') { try { localStorage.setItem(key, value); } catch {} }
        else setPref(key, value);
        if (key === 'cacheMax' && Number(value)) await invoke('cache_trim', { maxMb: Number(value) }).catch(() => {});
        return { ok: true };
      }
      case 'switch': location.hash = `#/servers/${args.k}`; return { ok: true };
      case 'signout': {
        const name = SRV.find((x) => x[0] === args.k)?.[1] || '';
        await api.serverLogout(args.k);
        await window.__refreshSession?.().catch(() => {});
        return { ok: true, toast: `Signed out of ${name}.`, model: await model() };
      }
      case 'signoutAll': await api.logout().catch(() => {}); await window.__refreshSession?.().catch(() => {}); location.hash = '#/login'; return { ok: true };
      case 'resetSubs': {
        let n = 0;
        try {
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith('tracks:')) continue;
            const v = JSON.parse(localStorage.getItem(k) || '{}');
            if (v?.sub) { delete v.sub; localStorage.setItem(k, JSON.stringify(v)); n++; }
          }
        } catch {}
        return { ok: true, toast: n ? `Forgot your subtitle picks for ${n} ${n === 1 ? 'show' : 'shows'}.` : 'There were no picks to forget.' };
      }
      case 'clearCache': await api.clearCache().catch(() => {}); return { ok: true, toast: 'Picture cache cleared.', model: await model() };
      case 'check': { const m = await import('./tvupdate.js'); m.checkNow(true); return { ok: true }; }
      case 'news': {
        let r = null;
        try { r = await invoke('tv_update', { what: 'check' }); } catch {}
        const lines = (Array.isArray(r?.notes) ? r.notes : String(r?.notes || '').split('\n')).map((l) => String(l).replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
        if (!lines.length) return { ok: false, err: "Couldn't fetch the list of changes just now." };
        return { ok: true, info: { title: r.available ? `New in ${r.version} (not installed yet)` : `New in ${r.version || r.current}`, lines } };
      }
      case 'tips': return { ok: true, info: { title: 'Remote tips', lines: [
        'Hold OK on any poster for a quick menu.',
        'Press Left at the edge of a screen to open the side bar.',
        'On Movies and TV Shows, press Up from the top row for Sort, Show and Genre. Press Right at the edge for A to Z.',
        'While something plays, Left and Right skip and OK pauses. Back closes what is open, then leaves.',
        'Switch person from your picture at the top of the side bar.',
      ] } };
      case 'restart':
        toast('Restarting Scrappy…');
        try { await invoke('tv_update', { what: 'restart' }); } catch { location.hash = '#/home'; location.reload(); }
        return { ok: true };
      default: return { ok: false, err: 'Unknown setting' };
    }
  } catch (e) { return { ok: false, err: String(e?.message || e).replace(/^Error:\s*/, '') }; }
}
