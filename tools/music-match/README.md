# Music matcher

Compares Spotify playlists exported with [Exportify](https://exportify.app) against the Navidrome library.
Read-only: it only reads from Navidrome, never changes files or library data.

Needs Python 3.8+ (nothing else to install). It reuses Scrappy's saved Navidrome sign-in,
or set `ND_URL`, `ND_USER`, `ND_PASS`.

```
python music_match.py missing Liked_Songs.csv            # first run downloads the Navidrome lists
python music_match.py missing playlists\*.csv --refresh   # re-read Navidrome after adding albums
```

Writes to `results\`:

- `missing_albums.csv` / `.md`: albums not in Navidrome, most liked songs first, with Bandcamp and Qobuz search links
- `needs_review.csv`: close matches the script wasn't sure about
- `owned_matches.csv`: which Spotify album matched which Navidrome album, for spot-checks

The cached `navidrome_cache\navidrome_songs.json` keeps every song's id and path, for building M3U playlists later.
