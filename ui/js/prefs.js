// App settings kept on this PC. Every setting is one localStorage key; most keys were
// already used by the player before the Settings page existed, so old choices carry over.
// Changing a setting fires "scrappy:pref" so open players can apply it straight away.

export const DEFAULTS = {
  // Account & servers
  startTab: 'last', lastTab: '#/home', closeTray: 'on',
  // Movies & TV
  autoplay: 'on', upNextSecs: '10', skipIntro: 'off', skipCredits: 'off', playerMode: 'embedded',
  quality: '', hwdec: 'auto-safe', heroMode: 'picks', epGridNames: 'off',
  skipBack: '10', skipFwd: '10',
  // Subtitles & audio
  subStart: 'default', subLang: 'eng', subScale: '1', subStyle: 'outline', audioLang: '', nightMode: 'off', volBoost: 'off',
  // Music
  gapless: 'on', rgain: 'off', mnowviz: 'on', lyricsAuto: 'off',
  // Audiobooks
  bSkip: '10/10', bRewind: 'on',
  // Look & feel
  reduceMotion: 'off', introSplash: 'on', yirEarly: 'off', cacheMax: '0',
  // Updates
  updAuto: 'on',
};

export function pref(key) {
  try { const v = localStorage.getItem(key); if (v !== null) return v; } catch {}
  return DEFAULTS[key] ?? '';
}
export const on = (key) => pref(key) === 'on';

export function setPref(key, value) {
  try { localStorage.setItem(key, String(value)); } catch {}
  window.dispatchEvent(new CustomEvent('scrappy:pref', { detail: { key, value: String(value) } }));
}

/** Run f(value) whenever one of these settings changes. */
export function onPref(keys, f) {
  const list = Array.isArray(keys) ? keys : [keys];
  window.addEventListener('scrappy:pref', (e) => { if (list.includes(e.detail.key)) f(e.detail.value, e.detail.key); });
}

// Subtitle style picks, as mpv settings.
export const SUB_STYLES = {
  outline: { 'sub-border-style': 'outline-and-shadow', 'sub-outline-size': '3', 'sub-shadow-offset': '0', 'sub-back-color': '#00000000' },
  shadow: { 'sub-border-style': 'outline-and-shadow', 'sub-outline-size': '0.8', 'sub-shadow-offset': '2.5', 'sub-back-color': '#C0000000' },
  // The box's margin comes from the shadow offset in this style.
  box: { 'sub-border-style': 'background-box', 'sub-outline-size': '0', 'sub-shadow-offset': '8', 'sub-back-color': '#B0000000' },
};
// Night mode: evens out loud and quiet parts.
export const NIGHT_FILTER = 'lavfi=[dynaudnorm=f=250:g=15:p=0.6:m=8]';
