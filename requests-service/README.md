# Scrappy requests

The small service behind Scrappy's Request button. It keeps the list of requests, searches TMDB (films and TV), MusicBrainz (music) and Audible (audiobooks, with Open Library as a fallback), and checks Emby, Navidrome and Audiobookshelf to see what's already there. When something requested shows up on a server, it marks the request Available and tells the people who asked.

No accounts of its own: Scrappy sends each person's Emby sign-in, and the service asks Emby who it is. Admins are the Emby usernames listed in `ADMINS`.

## Set up (about 10 minutes)

1. **Get the keys**
   - TMDB: sign in at themoviedb.org, open Settings, then API, and copy the API key (either the short key or the long read access token works).
   - Emby: Dashboard, then Advanced, then API Keys, then New. Name it "Scrappy requests". It's only used on the server for library checks.
   - Navidrome: any normal user's name and password.
   - Audiobookshelf: Settings, then Users, then pick a user, and copy its API token.
2. **Run it** on the NAS: copy `docker-compose.example.yml` to `docker-compose.yml`, fill in the values, and run `docker compose up -d`.
3. **Add one line to Emby's existing reverse proxy entry** so `https://<your Emby address>/requests` reaches the service. No new subdomain or port forward is needed.

   Nginx / Nginx Proxy Manager (in the Emby host's "Advanced" box or its config):
   ```
   location /requests/ { proxy_pass http://<NAS IP>:8095/requests/; proxy_set_header Host $host; }
   ```
   Caddy (inside the Emby site block):
   ```
   handle /requests/* { reverse_proxy <NAS IP>:8095 }
   ```
   Traefik: add a router for `Host(<emby host>) && PathPrefix(/requests)` pointing at port 8095.
4. **Check it**: open `https://<your Emby address>/requests/api/health`. You should see `"ok": true` and `true` next to each server you set up.

Scrappy finds the service on its own at your Emby address plus `/requests`. If you run it somewhere else, open the Request button in Scrappy: when it can't reach the service it shows a box to type the address.

## Settings

| Variable | What it's for |
| --- | --- |
| `ADMINS` | Emby usernames that can see and manage everyone's requests (comma-separated) |
| `REGION` | Country for release dates (default `US`) |
| `TMDB_API_KEY` | Film and TV search |
| `EMBY_URL`, `EMBY_API_KEY` | Checking who's signed in, and what films and shows are on Emby |
| `NAVIDROME_URL`, `NAVIDROME_USER`, `NAVIDROME_PASSWORD` | What albums and songs are on Navidrome |
| `ABS_URL`, `ABS_TOKEN` | What audiobooks are on Audiobookshelf |
| `CHECK_EVERY_MINUTES` | How often to look for requested things arriving (default 10) |
| `HANDOFF_URL`, `HANDOFF_SECRET` | Optional: where to send new requests and status changes (the Discord bot, later) |
| `BASE_PATH` | Path the service lives under (default `/requests`) |

The request list is one file, `data/requests.db`. Back up that folder to keep it.

## Run without Docker

Node 22.13 or newer: `node src/server.js` with the same variables set. Tests: `npm test`.
