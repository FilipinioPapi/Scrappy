# Scrappy Media Center

A lean, fast, watch-only Windows client for Emby, with playback through mpv.

## For the user

- **Download:** open the repository's **Releases** page and grab `Scrappy-setup.exe` from **Latest build** (what's on `main`). **Preview build** is the work-in-progress branch, for testing before it's merged.
- Windows may warn that the app is from an unknown publisher (it isn't code-signed). Click **More info → Run anyway**.
- On first launch, enter your Emby server address, username and password. Nothing about your server is stored in the code; it's saved only on your PC (`%APPDATA%\app.scrappy.player\config.json`, token only, never your password).

## How it's built

- **Tauri 2**: Rust backend + plain HTML/CSS/JS screens in `ui/` (no web framework, no build step).
- **libmpv** is loaded at runtime from `libmpv-2.dll`, shipped next to the app (`src-tauri/src/mpv.rs`). By default mpv draws into Scrappy's own window (`wid`) behind a transparent web page, and `ui/js/player.js` draws the controls on top. A menu switch falls back to mpv's own window.
- **Progress sync**: Rust reports start, pause/unpause, every 10 seconds, and stop to Emby (`/Sessions/Playing*`).
- **Emby API** calls all happen in Rust (`src-tauri/src/emby.rs`). Library responses are cached on disk and shown instantly on the next visit, then refreshed.
- **Posters** are served through an `img://` protocol that downloads each image once and keeps it on disk.
- **Builds** run on GitHub Actions (`.github/workflows/build.yml`), which downloads libmpv from shinchiro/mpv-winbuild-cmake.

## Building locally (developers)

Needs Node 22, Rust, and on Windows the WebView2 runtime (built into Windows 10/11).
Put `libmpv-2.dll` in `src-tauri/libmpv/`, then:

```
npm ci
npx tauri dev     # run
npx tauri build   # installer in src-tauri/target/release/bundle/nsis
```

## Roadmap

1. ✅ Log in, browse libraries, play with mpv
2. 🔧 Progress sync, Continue Watching, Latest rows, next episode, built-in player
3. 🔧 Subtitles, audio tracks, speed, aspect ratio, quality, adjustable skip lengths
4. 🔧 Skip intro and credits (uses Emby's intro/credits markers)
5. Window modes, keyboard shortcuts, settings
6. App icon
