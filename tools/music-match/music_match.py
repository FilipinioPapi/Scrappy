#!/usr/bin/env python3
"""
Scrappy music matcher: compare Spotify (Exportify) CSVs with the Navidrome library.

Read-only against Navidrome: it only calls Subsonic "get"/"search" endpoints.
Python 3.8+ standard library only, nothing to install.

Commands
  fetch                 Download the Navidrome album + song list into a cache folder.
  missing CSV [CSV...]  Find albums from the CSV(s) that aren't in Navidrome.

Sign-in
  By default it reuses the Navidrome sign-in saved by the Scrappy desktop app
  (%APPDATA%\\app.scrappy.player\\config.json). Or set ND_URL, ND_USER, ND_PASS.

Examples
  python music_match.py fetch
  python music_match.py missing Liked_Songs.csv --out results
  python music_match.py missing playlists\\*.csv --out results
  python music_match.py missing Liked_Songs.csv --refresh   (re-read Navidrome first)

The cache (navidrome_albums.json, navidrome_songs.json) is also the base for
building M3U playlists later: every song keeps its Navidrome id and path.
"""

import argparse
import csv
import difflib
import glob
import hashlib
import json
import os
import re
import secrets
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

CLIENT = "ScrappyMatch"
API_VERSION = "1.16.1"
PAGE = 500

# ---------------------------------------------------------------- Navidrome


def scrappy_config_path():
    base = os.environ.get("APPDATA") or os.path.expanduser("~/.config")
    return os.path.join(base, "app.scrappy.player", "config.json")


class Navidrome:
    """Tiny read-only Subsonic client."""

    def __init__(self, config_path=None):
        url, user, pw = os.environ.get("ND_URL"), os.environ.get("ND_USER"), os.environ.get("ND_PASS")
        if url and user and pw:
            salt = secrets.token_hex(6)
            self.base = url.rstrip("/")
            self.auth = {"u": user, "s": salt, "t": hashlib.md5((pw + salt).encode()).hexdigest()}
            return
        path = config_path or scrappy_config_path()
        if not os.path.exists(path):
            sys.exit(f"No Scrappy sign-in found at {path}. Sign in to Navidrome in Scrappy, "
                     "or set ND_URL, ND_USER and ND_PASS.")
        with open(path, encoding="utf-8") as f:
            c = json.load(f)
        g = lambda k: c.get(k) or c.get(re.sub(r"_(\w)", lambda m: m.group(1).upper(), k)) or ""
        self.base = g("nd_server").rstrip("/")
        self.auth = {"u": g("nd_user"), "s": g("nd_salt"), "t": g("nd_token")}
        if not (self.base and self.auth["t"]):
            sys.exit("Scrappy isn't signed in to Navidrome. Sign in there first.")

    def get(self, endpoint, **params):
        q = dict(self.auth, v=API_VERSION, c=CLIENT, f="json", **params)
        url = f"{self.base}/rest/{endpoint}?{urllib.parse.urlencode(q)}"
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": CLIENT})
                with urllib.request.urlopen(req, timeout=60) as r:
                    body = json.load(r)["subsonic-response"]
                break
            except Exception as e:  # network hiccup: retry a few times
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)
        if body.get("status") != "ok":
            sys.exit(f"Navidrome said: {body.get('error', {}).get('message', body)}")
        return body

    def all_albums(self):
        out, offset = [], 0
        while True:
            page = self.get("getAlbumList2", type="alphabeticalByName", size=PAGE, offset=offset)
            items = page.get("albumList2", {}).get("album", [])
            out += items
            print(f"  albums: {len(out)}", end="\r")
            if len(items) < PAGE:
                break
            offset += PAGE
        print()
        return out

    def all_songs(self):
        # An empty search3 query lists every song in Navidrome.
        out, offset = [], 0
        while True:
            page = self.get("search3", query="", songCount=PAGE, songOffset=offset, albumCount=0, artistCount=0)
            items = page.get("searchResult3", {}).get("song", [])
            out += items
            print(f"  songs: {len(out)}", end="\r")
            if len(items) < PAGE:
                break
            offset += PAGE
        print()
        return out


def fetch(cache, config_path=None):
    nd = Navidrome(config_path)
    os.makedirs(cache, exist_ok=True)
    print(f"Reading Navidrome at {nd.base} (read-only)")
    albums = nd.all_albums()
    songs = nd.all_songs()
    keep_a = ("id", "name", "artist", "artistId", "year", "songCount", "artists", "displayArtist", "isCompilation")
    keep_s = ("id", "title", "album", "albumId", "artist", "artists", "displayArtist", "track", "discNumber",
              "year", "duration", "path", "isrc")
    with open(os.path.join(cache, "navidrome_albums.json"), "w", encoding="utf-8") as f:
        json.dump([{k: a[k] for k in keep_a if k in a} for a in albums], f, ensure_ascii=False)
    with open(os.path.join(cache, "navidrome_songs.json"), "w", encoding="utf-8") as f:
        json.dump([{k: s[k] for k in keep_s if k in s} for s in songs], f, ensure_ascii=False)
    print(f"Saved {len(albums)} albums and {len(songs)} songs to {cache}")


def load_cache(cache):
    with open(os.path.join(cache, "navidrome_albums.json"), encoding="utf-8") as f:
        albums = json.load(f)
    p = os.path.join(cache, "navidrome_songs.json")
    songs = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else []
    return albums, songs

# ---------------------------------------------------------------- normalising

EDITION_WORDS = (r"deluxe|remaster(ed)?|edition|expanded|anniversary|bonus|version|standard|special|"
                 r"collector'?s?|super|explicit|clean|mono|stereo|reissue|single|ep|extended|edit|"
                 r"complete|legacy|original motion picture soundtrack|feat\.?|ft\.?|featuring|with|"
                 r"\d{4} mix|mix|\w*luxe|re-?issue|vinyl|hi-?res|24[- ]?bit|\d+th|\d+st|\d+nd|\d+rd")
BRACKET = re.compile(r"\s*[\(\[\{]([^\)\]\}]*)[\)\]\}]")
DASH_SUFFIX = re.compile(r"\s+[-–—]\s+(.*)$")
EDITION_RE = re.compile(rf"\b({EDITION_WORDS})\b", re.I)
FEAT_RE = re.compile(r"\s+(feat\.?|ft\.?|featuring)\s.*$", re.I)


def fold(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    s = s.replace("&", " and ").replace("+", " and ").replace("$", "s")
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def clean_album(name):
    """Album name without edition tags, still readable: 'Lungs (Deluxe Edition)' -> 'Lungs'."""
    s = name or ""
    # drop "(Deluxe Edition)", "[Remastered 2011]", "(feat. X)" etc.
    s = BRACKET.sub(lambda m: "" if EDITION_RE.search(m.group(1)) else m.group(0), s)
    # drop " - Single", " - EP", " - 2011 Remaster"
    s = DASH_SUFFIX.sub(lambda m: "" if EDITION_RE.search(m.group(1)) else m.group(0), s)
    return FEAT_RE.sub("", s).strip() or (name or "")


def norm_album(name):
    return fold(clean_album(name)) or fold(name)


def norm_artist(name):
    s = fold(FEAT_RE.sub("", name or ""))
    return re.sub(r"^the ", "", s)


def norm_title(name):
    return norm_album(name)


def ratio(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio()


def nd_artist_names(item):
    names = [item.get("artist", ""), item.get("displayArtist", "")]
    names += [a.get("name", "") for a in item.get("artists") or [] if isinstance(a, dict)]
    out = set()
    for n in names:
        for part in re.split(r"\s*(?:;|/| & | and |, | feat\.? | ft\.? | x )\s*", n or "", flags=re.I):
            if part:
                out.add(norm_artist(part))
        if n:
            out.add(norm_artist(n))
    out.discard("")
    return out


def artist_score(sp_artists, nd_names):
    """Best similarity between any Spotify artist and any Navidrome artist (0..1)."""
    best = 0.0
    for a in sp_artists:
        for b in nd_names:
            if a == b:
                return 1.0
            if len(a) > 3 and len(b) > 3 and (a in b or b in a):
                best = max(best, 0.95)
            best = max(best, ratio(a, b))
    return best

# ---------------------------------------------------------------- Exportify


def read_exportify(paths):
    rows = []
    for pattern in paths:
        for p in sorted(glob.glob(pattern)) or [pattern]:
            with open(p, encoding="utf-8-sig", newline="") as f:
                for r in csv.DictReader(f):
                    r["_source"] = os.path.basename(p)
                    rows.append(r)
    return rows


def split_artists(s):
    return [a.strip() for a in (s or "").split(";") if a.strip()]


def group_albums(rows):
    """One group per Spotify album (name + release date + label), with its main artist."""
    groups = defaultdict(list)
    seen = set()
    for r in rows:
        tid = r.get("Track URI") or (r.get("Track Name"), r.get("Album Name"))
        if tid in seen:  # same song in two playlists counts once
            continue
        seen.add(tid)
        key = (fold(r.get("Album Name")), r.get("Release Date", "")[:10], fold(r.get("Record Label", "")))
        groups[key].append(r)
    albums = []
    for tracks in groups.values():
        count = Counter(a for t in tracks for a in set(split_artists(t["Artist Name(s)"])))
        firsts = Counter(split_artists(t["Artist Name(s)"])[0] for t in tracks if split_artists(t["Artist Name(s)"]))
        top, n = count.most_common(1)[0] if count else ("Unknown", 0)
        if n < len(tracks):  # nobody is on every song: compilation / soundtrack
            primary = firsts.most_common(1)[0][0] if len(firsts) == 1 else "Various Artists"
        else:
            primary = firsts.most_common(1)[0][0] if firsts[firsts.most_common(1)[0][0]] == len(tracks) else top
        albums.append({
            "artist": primary,
            "album": tracks[0]["Album Name"],
            "year": (tracks[0].get("Release Date") or "")[:4],
            "liked": len(tracks),
            "all_artists": sorted(count),
            "tracks": tracks,
        })
    # Spotify often has several copies of one album (explicit/clean, deluxe, regional).
    # Merge them so each album appears once.
    merged = {}
    for al in sorted(albums, key=lambda x: -x["liked"]):
        k = (norm_album(al["album"]), norm_artist(al["artist"]))
        if k not in merged:
            merged[k] = al
            continue
        m = merged[k]
        names = {norm_title(t["Track Name"]) for t in m["tracks"]}
        extra = [t for t in al["tracks"] if norm_title(t["Track Name"]) not in names]
        m["tracks"] += extra
        m["liked"] = len(m["tracks"])
        m["all_artists"] = sorted(set(m["all_artists"]) | set(al["all_artists"]))
        m["year"] = min(filter(None, [m["year"], al["year"]]), default="")
    return list(merged.values())

# ---------------------------------------------------------------- matching

SURE_ALBUM, REVIEW_ALBUM = 0.93, 0.80
SURE_ARTIST, REVIEW_ARTIST = 0.85, 0.60


class Library:
    def __init__(self, albums, songs):
        self.albums = albums
        self.by_name = defaultdict(list)
        for a in albums:
            a["_n"] = norm_album(a.get("name"))
            a["_artists"] = nd_artist_names(a)
            self.by_name[a["_n"]].append(a)
        self.songs = defaultdict(list)
        for s in songs:
            s["_artists"] = nd_artist_names(s)
            self.songs[norm_title(s.get("title"))].append(s)

    def match_album(self, sp):
        name = norm_album(sp["album"])
        artists = [norm_artist(a) for a in ([sp["artist"]] + sp["all_artists"]) if a != "Various Artists"]
        various = sp["artist"] == "Various Artists"
        best = None  # (album score, artist score, nd album)
        for a in self.by_name.get(name, []):
            s = 1.0 if various and (a.get("isCompilation") or "various" in a["_artists"]) else artist_score(artists, a["_artists"])
            if not best or (1.0, s) > best[:2]:
                best = (1.0, s, a)
        if not best or best[1] < SURE_ARTIST:
            for a in self.albums:
                if abs(len(a["_n"]) - len(name)) > max(6, len(name) // 2):
                    continue
                r = ratio(name, a["_n"])
                if r < REVIEW_ALBUM:
                    continue
                s = artist_score(artists, a["_artists"])
                if s < REVIEW_ARTIST:
                    continue
                if not best or (r + s) > (best[0] + best[1]):
                    best = (r, s, a)
        if not best:
            return "missing", None, 0, 0
        r, s, a = best
        if r >= SURE_ALBUM and s >= SURE_ARTIST:
            return "owned", a, r, s
        if r >= REVIEW_ALBUM and s >= REVIEW_ARTIST:
            return "review", a, r, s
        return "missing", None, 0, 0

    def find_song(self, track):
        title = norm_title(track["Track Name"])
        artists = [norm_artist(a) for a in split_artists(track["Artist Name(s)"])]
        isrc = (track.get("ISRC") or "").upper()
        best = None
        for s in self.songs.get(title, []):
            if isrc and isrc in isrcs(s):
                return s
            sc = artist_score(artists, s["_artists"])
            if sc >= SURE_ARTIST and (not best or sc > best[0]):
                best = (sc, s)
        return best[1] if best else None


def isrcs(song):
    """Navidrome sends ISRC as a list (OpenSubsonic); older servers as a string."""
    v = song.get("isrc") or []
    return {str(x).upper() for x in ([v] if isinstance(v, str) else v)}


def search_links(artist, album):
    q = f"{'' if artist == 'Various Artists' else artist} {clean_album(album)}".strip()
    enc = urllib.parse.quote_plus(q)
    return (f"https://bandcamp.com/search?q={enc}&item_type=a",
            f"https://www.qobuz.com/us-en/search?q={enc}")


def run_missing(csvs, cache, out, refresh, config_path):
    if refresh or not os.path.exists(os.path.join(cache, "navidrome_albums.json")):
        fetch(cache, config_path)
    nd_albums, nd_songs = load_cache(cache)
    lib = Library(nd_albums, nd_songs)
    rows = read_exportify(csvs)
    sp_albums = group_albums(rows)

    owned, missing, review = [], [], []
    for sp in sp_albums:
        status, a, r, s = lib.match_album(sp)
        sp["bandcamp"], sp["qobuz"] = search_links(sp["artist"], sp["album"])
        if status == "owned":
            owned.append((sp, a, "album", r, s))
            continue
        # Not found as an album: are all the liked songs already on other albums?
        hits = [lib.find_song(t) for t in sp["tracks"]] if lib.songs else []
        found = [h for h in hits if h]
        sp["songs_elsewhere"] = len(found)
        if status == "missing" and hits and len(found) == len(hits):
            where = Counter(f"{h.get('album')} ({h.get('artist')})" for h in found)
            # Could be a single from an album you own, or a different full album. Let a human decide.
            review.append((sp, {"name": "; ".join(where), "artist": ""}, 0, 0,
                           "Liked songs already in your library on another album"))
        elif status == "review":
            review.append((sp, a, r, s, "Similar album name"))
        else:
            missing.append(sp)

    os.makedirs(out, exist_ok=True)
    key = lambda sp: (-sp["liked"], sp["artist"].lower(), sp["album"].lower())
    missing.sort(key=key)
    review.sort(key=lambda x: key(x[0]))
    owned.sort(key=lambda x: key(x[0]))

    cols = ["Artist", "Album", "Year", "Liked songs", "Bandcamp", "Qobuz"]
    line = lambda sp: [sp["artist"], sp["album"], sp["year"], sp["liked"], sp["bandcamp"], sp["qobuz"]]
    write_csv(os.path.join(out, "missing_albums.csv"), cols, [line(sp) for sp in missing])
    write_csv(os.path.join(out, "needs_review.csv"),
              cols + ["Why", "Closest Navidrome album", "Navidrome artist", "Album similarity", "Artist similarity",
                      "Liked songs already in library"],
              [line(sp) + [why, a.get("name"), a.get("artist"), f"{r:.2f}" if r else "", f"{s:.2f}" if s else "",
                           sp.get("songs_elsewhere", 0)] for sp, a, r, s, why in review])
    write_csv(os.path.join(out, "owned_matches.csv"),
              ["Spotify artist", "Spotify album", "Year", "Liked songs", "Navidrome album", "Navidrome artist",
               "Matched by", "Album similarity", "Artist similarity", "Navidrome album id"],
              [[sp["artist"], sp["album"], sp["year"], sp["liked"], a.get("name"), a.get("artist"), how,
                f"{r:.2f}" if r else "", f"{s:.2f}" if s else "", a.get("id")] for sp, a, how, r, s in owned])

    stats = {
        "Songs in the CSV(s)": len({r.get("Track URI") or (r.get("Track Name"), r.get("Album Name")) for r in rows}),
        "Spotify albums": len(sp_albums),
        "Owned": len(owned),
        "Missing": len(missing),
        "Needs review": len(review),
        "  similar album name": sum(1 for x in review if x[4] == "Similar album name"),
        "  liked songs already on another album": sum(1 for x in review if x[4] != "Similar album name"),
        "Navidrome albums": len(nd_albums),
    }
    write_md(os.path.join(out, "missing_albums.md"), stats, missing, review, csvs)
    print()
    for k, v in stats.items():
        print(f"{k}: {v}")
    print(f"\nWrote results to {os.path.abspath(out)}")


def write_csv(path, header, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def md_cell(s):
    return str(s).replace("|", "\\|")


def write_md(path, stats, missing, review, csvs):
    L = [f"# Albums missing from Navidrome", "",
         f"From: {', '.join(os.path.basename(c) for c in csvs)}  ·  {time.strftime('%Y-%m-%d')}", ""]
    L += [f"- **{k.strip()}**: {v}" if not k.startswith("  ") else f"  - {k.strip()}: {v}" for k, v in stats.items()]
    L += ["", f"## Missing ({len(missing)})", "",
          "| Artist | Album | Year | Liked songs | Bandcamp | Qobuz |", "|---|---|---|---:|---|---|"]
    L += [f"| {md_cell(sp['artist'])} | {md_cell(sp['album'])} | {sp['year']} | {sp['liked']} | "
          f"[search]({sp['bandcamp']}) | [search]({sp['qobuz']}) |" for sp in missing]
    L += ["", f"## Needs review ({len(review)})", "",
          "Close but not sure. Check these by hand.", "",
          "| Artist | Album | Year | Liked songs | Why | In Navidrome | Bandcamp | Qobuz |",
          "|---|---|---|---:|---|---|---|---|"]
    L += [f"| {md_cell(sp['artist'])} | {md_cell(sp['album'])} | {sp['year']} | {sp['liked']} | {why} | "
          f"{md_cell(a.get('name'))}{' — ' + md_cell(a.get('artist')) if a.get('artist') else ''} | [search]({sp['bandcamp']}) | [search]({sp['qobuz']}) |"
          for sp, a, r, s, why in review]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")

# ---------------------------------------------------------------- main


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--cache", default="navidrome_cache", help="folder for the Navidrome lists (default: navidrome_cache)")
    p.add_argument("--config", help="path to Scrappy's config.json (default: %%APPDATA%%\\app.scrappy.player\\config.json)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("fetch", help="download the Navidrome album and song list")
    m = sub.add_parser("missing", help="find albums from Exportify CSVs that aren't in Navidrome")
    m.add_argument("csv", nargs="+", help="Exportify CSV file(s); wildcards OK")
    m.add_argument("--out", default="results", help="output folder (default: results)")
    m.add_argument("--refresh", action="store_true", help="re-download the Navidrome lists first")
    a = p.parse_args()
    if a.cmd == "fetch":
        fetch(a.cache, a.config)
    else:
        run_missing(a.csv, a.cache, a.out, a.refresh, a.config)


if __name__ == "__main__":
    main()
