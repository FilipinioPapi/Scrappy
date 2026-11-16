# Scrappy changelog

Newest first. Each app has its own section. Every test build gets an entry before it goes out.
"Preview" = test build. "Stable" = the main download, updated only when a Preview is approved.

---

## 🖥️ PC app

### Stable · Nov 16, 2026 (everything from Preview 22 to 50)
**If the update gets stuck**
- If Scrappy shows "Updating" and doesn't come back, download the installer from the Latest release and run it once. From this version on, a failed update tells you and offers to try again or download it

**New**
- Smart home rows (Next Up, Because you watched, On repeat and more) and Edit home to reorder or hide rows
- A side menu for Movies & TV like Music's, with Genres, Favorites and your recently watched, plus a Bookmarks page in Audiobooks
- Collection pages with Play all and Shuffle, and posters for collections without one
- Sign in to your next server with one click using your Emby username and password
- Taskbar Previous, Play/Pause and Next buttons, and a new dachshund app icon

**Better**
- Much faster and lighter: pages open from saved copies, Songs and Albums open almost instantly, and Scrappy uses far less CPU when idle or minimised
- Marking something watched resets its progress and offers Play again, and Continue Watching shows the show's own picture
- Show pages: an All episodes view, and Grid shows every episode tagged by season
- Server addresses use https unless they're on your home network
- Lots of fixes from the PC review: sorting, menus, search, Stats wording, trackpad scrolling and laptop window size

<sub>Built from the same code as Preview 50 · Preview-by-Preview details below</sub>

### Preview 50 · Nov 15, 6:33 PM
**Movies & TV**
- Changed: on show pages, the Grid layout always shows every episode, season by season, and hides the season buttons. Episode tiles now say which season they're from, e.g. S7, E3

<sub>Built from 45cb1e9 · includes: Movies & TV</sub>

### Preview 49 · Nov 15, 12:58 PM
**Updates**
- Fixed: if an update can't install, Scrappy no longer closes every time it starts. It tells you, and offers to try again or download the update yourself

<sub>Built from 9ec1ada · includes: Updates</sub>

### Preview 48 · Nov 15, 12:05 PM
**Speed**
- Optimization pass for weaker PCs: big blurred backgrounds (album, playlist and book pages, Now playing, follow-along) are drawn once instead of on every frame
- Glass blur is gone where nothing showed through it
- Home rows off screen aren't drawn until you scroll near them, and genre rows no longer make the page jump when they load
- Follow-along updates at most 60 times a second
- While Scrappy is minimised, the visualiser and animations pause

<sub>Built from 99d888e · includes: Speed</sub>

### Preview 47 · Nov 15, 11:12 AM
**Speed**
- Lighter and smoother: Scrappy no longer burns CPU while sitting idle. Loading placeholders stop animating after a few seconds (about 20% of a core less on a 120 Hz laptop)
- Scrolling past posters no longer sets off their hover effects
- The playing bar glow and equaliser bars are cheaper, and the visualiser draws at most 60 times a second
- The Home banner pauses while you're in another window

<sub>Built from 34e494a · includes: Speed</sub>

### Preview 46 · Nov 15, 10:41 AM
**General**
- New: hover Scrappy's icon on the taskbar to get Previous, Play/Pause and Next under the preview. They work for music, and for audiobooks they jump by chapter. They're greyed out when nothing is playing

<sub>Built from 49efb8f · includes: Taskbar buttons</sub>

### Preview 45 · Nov 15, 10:27 AM
**General**
- Fixed: maximizing the window on a laptop no longer lets the bottom of the app slip behind the taskbar. This works on any screen shape or scaling

<sub>Built from f1e6ceb · includes: General</sub>

### Preview 44 · Nov 15, 10:09 AM
**General**
- Fixed: scrolling past the top with a trackpad no longer pulls the top bar down, and the side menu, panels and pop-ups don't stretch either
- Changed: the logo inside the app (top left and the opening screen) now matches the new dog app icon

<sub>Built from 641af53 + 3b36dc0 · includes: General</sub>

### Preview 43 · Nov 14, 8:38 PM
**Stats**
- Changed: Movies & TV stats no longer offer a Year in Review, because it needed an Emby plugin that's been removed. Music and Audiobooks still have theirs

<sub>Built from 4686b6c · includes: Stats</sub>

### Preview 42 · Nov 14, 4:07 PM
**Movies & TV**
- Changed: page titles (Movies, Shows, Anime, Collections, Genres, Favorites) use the big Scrappy font with a count beside them, matching Music and Audiobooks
- New: collection pages show how many movies there are, the years they cover, the total time and how many you've watched. A new Play all button starts at the first one you haven't watched and plays them in release order, and Shuffle mixes them. Movies are listed in release order, and the trail links back to Collections

**Music**
- Changed: on the Albums page the extra Artists button is gone (it's in the side menu), and the search box is wider

**Audiobooks**
- Changed: Bookmarks shows how many bookmarks you have. Every bookmark has a play button you can always see, plus its time, rename and delete
- New: Authors has a Sort by switch with Name A–Z (by first name, as written), Most books and Recently listened. It remembers your pick

<sub>Built from 8fd800c · includes: PC review mock-ups</sub>

### Preview 41 · Nov 14, 3:56 PM
**Home**
- Fixed: rows like Watch again, Because you played and Albums you haven't played hide when they'd show fewer than 4 things, and don't repeat titles from rows above
- Fixed: "Your top genre you haven't seen" skips things you've started
- Fixed: "New from artists you love" no longer repeats albums already in Recently added

**Movies & TV**
- Fixed: the show page no longer shows an extra episode count next to "Episodes" when the season tabs already show counts
- Fixed: a genre page lights Genres in the side menu and shows a Genres › name trail
- Changed: a collection page's heading says "Movies" instead of "Items", and menus say "Mark watched / Mark unwatched"
- New: collections without a picture show their first movie's poster in the side menu too

**Music & Audiobooks**
- Fixed: an artist no longer shows up in their own "Fans also like"
- Fixed: on genre tiles, the count no longer runs into the covers or a two-line name
- Fixed: on the Albums page, songs go in one column when the window is narrower, so titles aren't cut off

**Stats**
- Fixed: the empty "Episodes you rewatch" box is hidden, the heading says "What you watched", "Favorites" uses the US spelling, and "Never played" links straight to a search for unplayed songs

**General**
- Fixed: Advanced search looks right. The Words, Genre and Year boxes are proper boxes and the check boxes sit on one line
- Fixed: names with numbers sort in number order (Book 2 comes before Book 10)
- Fixed: right-click menus close when you go back or change page
- Fixed: if a page fails to load, the side menu stays
- Fixed: the top search box clears when you leave search

<sub>Built from 9c6da2b · includes: PC review fixes</sub>

### Preview 40 · Nov 14, 2:50 PM
**Movies & TV**
- Changed: genres with fewer than 5 titles no longer show on the Genres page (Home's Browse by genre uses the same cut-off)
- New: collections without a picture now show their first movie's poster

<sub>Built from 4e4c973 · includes: Movies & TV</sub>

### Preview 39 · Nov 14, 2:37 PM
**Movies & TV**
- Changed: Continue Watching shows each show's own picture for episodes, instead of a still from the episode

<sub>Built from 205dcae · includes: Movies & TV</sub>

### Preview 38 · Nov 14, 2:10 PM
**General**
- New app icon: the updated Scrappy dachshund, with a see-through background on the taskbar and desktop. Windows may show the old icon for a while until it refreshes its icon cache

<sub>Built from 3f5d11f · includes: General</sub>

### Preview 37 · Nov 14, 12:09 PM
**Movies & TV**
- Changed: marking a movie or episode watched now resets its progress, and its button says Play again instead of Resume and Play from start

<sub>Built from 6f5288c · includes: Movies & TV</sub>

### Preview 36 · Nov 14, 8:05 AM
**Movies & TV**
- Fixed: editing an episode's info or picture keeps you on the season you were looking at, instead of jumping to another one

<sub>Built from af14826 · includes: Movies & TV</sub>

### Preview 35 · Nov 12, 8:52 AM
**Security**
- Typing a server name without http:// or https:// (like movies.jjsnas.xyz) now uses https, so your password is never sent unencrypted. Home-network addresses (an IP like 192.168.x.x, or a name like tower.local) still use plain http
- Servers saved by older builds as http:// with an internet name switch to https automatically when Scrappy starts, if the server answers on https

<sub>Built from 2196733 · includes: Security</sub>

### Preview 34 · Nov 12, 8:09 AM
**Sign-in**
- New: after you sign in to your first server, the next one offers "Same username and password as Emby?" with your Emby profile picture. One click signs you in. If you add a server on a later day, it fills in your username and you type the password once, because Scrappy never saves passwords

<sub>Built from d9c7963 · includes: Sign-in</sub>

### Preview 33 · Nov 11, 7:40 PM
**Music**
- New: the made-for-you playlists (Favorite songs, Most played, Recently added) each have their own poster art
- Changed: "Your 2026" is now called "Your top 50 of 2026". It moved out of your own playlists into Made automatically, and it shows under its own "Made for you" heading in the side menu's Playlists list. The playlist in Navidrome gets renamed the next time you open your Music Year in Review

<sub>Built from 0608401 · includes: Music</sub>

### Preview 32 · Nov 11, 6:10 PM
**Music**
- Fixed: Music side menu Recents were saved only on the PC you played on. Albums you play on any device now show up too, in time order
- Fixed: the Playlists chip in the Music side menu now lists all your playlists, not only ones played on this PC

**Requests**
- Fixed: the Requests button looked like it did nothing the first time you clicked it. It now shows the page loading straight away

<sub>Built from c77dfa4 · includes: Music, Requests</sub>

### Preview 31 · Nov 11, 4:15 PM
**Movies & TV**
- Fixed: after editing a movie's or show's details, the page kept showing the old ones until you left it

<sub>Built from c5d2e03 · includes: Movies & TV</sub>

### Preview 30 · Nov 11, 1:00 PM
**Speed**
- Tiles and their artwork now appear together on every page. Pictures you have already seen show instantly when you come back
- Music, Songs tab: opens in about a tenth of a second instead of about three, scrolls smoothly, and searching and sorting no longer stutter
- Music, Albums tab: opens right away and scrolls much more smoothly. Long playlists no longer freeze when opened
- Music artist and genre pages, every Audiobooks page and the Movies & TV person page open from the saved copy instead of waiting on the server
- Artist pictures no longer wait on the server when already saved
- Home rows that popped in a second late now show with the page

**Fixes**
- Fixed: the play button on album and book cards could fire several times after browsing a while
- Fixed: the A to Z strip on the Songs tab did nothing when clicked

<sub>Built from 6fb3756 · includes: speed pass</sub>

### Preview 29 · Nov 11, 8:30 AM
**Movies & TV**
- Grid layout: episode names always show under each picture (the setting is gone)

<sub>Built from 5baf82c · includes: Movies & TV</sub>

### Preview 28 · Nov 11, 3:25 AM
**Movies & TV**
- New side menu like Music's: Home, your libraries, Genres, Favorites, and Your Library with your pinned and recently watched shows and movies (with time left)
- New Genres and Favorites pages

**Audiobooks**
- The side menu now matches Music: collapse button, resizable, Your Library with recently listened books and authors, and a new Bookmarks page with every bookmark in one place

**App-wide**
- Collapsing or resizing the side menu applies to all three tabs, and it stays put when you switch tabs

<sub>Built from 208c6e8 · includes: side menus</sub>

### Preview 27 · Nov 11, 3:10 AM
**Movies & TV**
- Shows with more than one season have an All tab at the end that lists every episode, with a heading where each season starts
- The Grid layout opens on All, and its pictures show just the episode number and watched tick
- New setting: Episode names on grid pictures (Settings, Movies & TV), off by default
- Home banner and show and movie backdrops now load in 4K when Emby has the art in 4K

<sub>Built from c9913fc · includes: Movies & TV</sub>

### Preview 26 · Nov 11, 2:55 AM
**Home**
- Edit home: dragging rows to reorder now works

**App-wide**
- Switching to Music or Audiobooks: the side menu no longer shows up low and slides into place late
- Dropdown lists (subtitles, audio, player settings and others) are now dark and easy to read

<sub>Built from 2012fb1 · includes: Home, app-wide</sub>

### Preview 25 · Nov 11, 2:20 AM
**App-wide**
- Moving between pages (episodes, shows, menus) no longer flashes a blank page or a spinner: the old page stays until the new one is ready
- Back returns you to the same spot on the page instead of the top

**Home**
- Smart home rows show up instantly when you switch tabs, with no flicker or reshuffling. They refresh every 30 minutes
- Because you played shows real artist pictures and album counts, and leaves out artists with no albums in your library
- On repeat shows an album once instead of repeating its cover for each song
- Smart rows load in the background, so covers and the page you open come first

**Music**
- Because you played no longer shows empty duplicate artists
- Back on an artist or genre page returns to where you came from

<sub>Built from cb15c91 · includes: page changes, Home, Music</sub>

### Preview 24 · Nov 11, 1:10 AM
**Home**
- Smart home rows. Movies & TV: Next Up, Because you watched…, your top genre you haven't seen, and Watch again. Music: On repeat, Because you played…, New from artists you love, Forgotten favorites, and Albums you haven't played. Audiobooks: Because you finished… and Short listens
- Edit home: a button at the bottom of each home page. Drag rows into any order, switch rows off, or reset. Each tab keeps its own layout

<sub>Built from dc02b47 · includes: Home</sub>

### Preview 23 · Nov 11, 12:49 AM
**Music**
- Recommended songs on playlists got a cleanup: labelled columns, and the artist, album and genre now open their pages. The year sits under the album, and Your plays shows "New to you" for songs you've never played
- New filters: Best match, Same artists, Same genres, New to you, Your favorites. There's also an Add all button
- Click a cover to hear a 30-second preview. Your music pauses and picks back up afterwards

<sub>Built from 2a30fab · includes: Music</sub>

### Preview 22 · Nov 11, 12:36 AM
**Music**
- Skipping tracks on the Now playing screen no longer flashes placeholder art: the old cover stays until the new one is ready, then fades in
- Album pages show the full release date (for example "Released August 25, 2017") when the music file has it, otherwise the year as before
- Recommended songs on playlists show up much faster, with a placeholder while they load

<sub>Built from 0c150d0 · includes: Music</sub>

### Stable · Nov 11, 2026 (everything from Preview 1 to 21)
**⚠️ Install this one by hand**
- The previous Stable build can't update itself. Install this one once, and future updates arrive in the app

**New**
- Audiobooks: home, library, authors, series, book pages, player, bookmarks and Follow-along text
- Stats for Movies & TV, Music and Audiobooks, and Your Year in Review with song snippets
- Requests: ask for missing films, shows, music and audiobooks, with an admin page
- Full Settings page, auto-updates, and opening Scrappy again brings the open window to the front

**Better**
- Video player rebuilt: smoother seeking, faster starts, subtitles in the right language, Up next, ends-at time
- Search covers people, audiobooks and typos, with results grouped by category
- Smoother scrolling and faster pages throughout, and lyrics that follow the song

<sub>Built from the same code as Preview 21 · Preview-by-Preview details below</sub>

### Preview 21 · Nov 10, 10:45 PM
**Movies & TV**
- Mark watched updates the episode list straight away, with no reload or blink
- Click an episode's picture to play it, or its name to open the episode page

**Stats**
- Me / Everyone switch moved to the category row
- Switching is instant: pages, Everyone data and Year in Review banners are kept ready
- Shimmering placeholders while a page loads

**Year in Review**
- Song snippets load ahead and fade smoothly into each other
- Opening your Music review makes a "Your <year>" playlist of your top 50 songs in Navidrome

**App-wide**
- Opening Scrappy again brings the open window to the front instead of starting a second copy
- The Songs tab loads faster

**Auto-updates**
- The first build that Preview 20 can install by itself from the Update ready button

<sub>Built from 3d93302 · includes: Movies & TV, Stats, Year in Review, Music, single window</sub>

### Preview 20 · Nov 10, 9:28 PM
**Fixes**
- Fixed: Preview 19 opened to a blank window. Install Preview 20 by hand once, since Preview 19 can't show the update button

**Year in Review**
- Music slides play short snippets of your songs

**Speed**
- Smoother scrolling, lighter player bars, and faster Stats pages

<sub>Built from 6d685c1 · includes: blank-window fix, Year in Review, speed pass</sub>

### Preview 19 · Nov 10, 8:47 PM
**⚠️ Install this one by hand**
- Download and install Preview 19 yourself once. The update key changed, so Preview 18 can't update to it by itself. Auto-updates work from Preview 20 on

**Settings (new)**
- The cog now opens a full Settings page
- Keep Scrappy in the tray when you close it, and open it when Windows starts
- Limit how much space saved pictures use
- Lots of player, music and audiobook options
- For admins: Server health, and Requests settings

**Music**
- Artists with one album show that album's cover
- Lyrics: the "follow the song" hint slides in under the lyrics

**Year in Review**
- Never shows the same cover twice
- The banner no longer jumps or stutters the first time it opens

<sub>Built from 6a02dba · includes: Settings, Music, Year in Review, new update key</sub>

### Preview 18 · Nov 10, 8:10 PM
**Stats**
- Movies & TV stats are now all time and work on every account (no Playback Reporting needed)
- Time watched, Your shows (Finished / Up to date / Watching / Stopped), top movies, episodes you rewatch, favorite episode, genres, decades and top actors

**Auto-updates**
- Update notes now come from this changelog, and an update is always checked again before it installs

<sub>Built from 89b8d00 · includes: Stats, Auto-updates</sub>

### Preview 17 · Nov 10, 7:58 PM
**Auto-updates (new)**
- Scrappy downloads new versions by itself and shows a green "Update ready" button. Restart now installs it, or it installs the next time Scrappy starts
- Admins can pick the Preview or Stable channel in Settings
- Install this version by hand once to get it. Updates switch on once the signing key is added to GitHub

<sub>Built from a331620 · includes: Auto-updates</sub>

### Preview 16 · Nov 10, 7:47 PM
**Stats**
- Your Year in Review banner no longer disappears when you switch between Stats categories

<sub>Built from 668facd · includes: Stats</sub>

### Preview 15 · Nov 10, 7:41 PM
**Movies & TV**
- Subtitles now start in the right language on shows like Dark (it was mixing up "English" and "English (US)")

<sub>Built from 6cf8ecc · includes: Video player</sub>

### Preview 14 · Nov 10, 7:35 PM
**Audiobooks**
- Bookmarks: save your spot with the bookmark button or the B key, name it, and jump back later
- Book page has a Chapters / Bookmarks switch
- Synced with Audiobookshelf, so bookmarks also show in its app and website

<sub>Built from 49e441d · includes: Audiobook bookmarks</sub>

### Preview 13 · Nov 10, 7:24 PM
**Music**
- Synced lyrics no longer slide behind the visualizer
- Scroll the lyrics freely while a song plays; right-click them to follow the song again

<sub>Built from bfca050 · includes: Music lyrics</sub>

### Preview 12 · Nov 10, 7:18 PM
**Requests**
- Bigger "Open Requests" button with a count, and one Open Requests list (yours, or everyone's with who asked, for admins)
- Green "Requested" button (click it to cancel), "+ Add request" when someone else already asked, and a "Requested ×2" badge
- Fixed: category buttons jumped to Your requests

**Home**
- Fixed: thin lines on the banner, including while it slides

**Behind the scenes**
- Makes sure each Preview actually gets published (the last one got stuck as a draft)

<sub>Built from efd5953 · includes: Requests, Home banner, build fix</sub>

### Preview 11 · Nov 10, 6:07 PM
**Requests (new)**
- Request button next to the cog, with a red count
- Search films, TV, music and audiobooks and ask for what's missing. Whole collections, discographies, series and missing TV episodes in one go
- "My requests" page with each request's status, and a "Now available" card with Watch or Listen when it arrives
- Admin tab for Jayden to mark requests In progress, Available or Can't find
- Needs the new request service running on the server (setup guide in requests-service/README.md)

**Search**
- Fixed: "See all results" opened Home instead of the results page

<sub>Built from a2c5c01 · includes: Requests, request service</sub>

### Preview 10 · Nov 10, 5:34 PM
**Audiobooks**
- Picks up where you left off on another device: pressing play on the PC no longer jumps back to the PC's old spot

<sub>Built from 3d67dab · includes: Audiobooks</sub>

### Preview 9 · Nov 10, 12:26 PM
**Search**
- Finds audiobooks by author, series or narrator, and shows authors
- Finds actors and directors and what they're in
- Forgives typos in Movies & TV
- Genre-only or year-only music searches work
- Shows are listed before episodes
- New playlists show up without restarting
- Play button on audiobook results
- A note when a server doesn't answer, and a thin line between categories

<sub>Built from 73b2045 · includes: Search</sub>

### Preview 8 · Nov 10, 9:05 AM
**Music**
- Artists with no picture show the cover of their most played album

<sub>Built from 56a27a5 · includes: Music</sub>

### Preview 7 · Nov 10, 8:52 AM
**Audiobooks**
- Follow along button in the book bar opens a side panel
- Pop the text out into its own window, and send it back with one click
- Highlight styles (Sweep is the default), colours, fonts, text size and timing options
- "Now listening" is now called "Now playing"

<sub>Built from 579c0e1 · includes: Audiobooks</sub>

### Preview 6 · Nov 10, 8:10 AM
**Video player**
- **+** button next to Subtitles: download subtitles without leaving the video

<sub>Built from 68b5462 · includes: Video player</sub>

### Preview 5 · Nov 10, 7:56 AM
**Video player**
- Subtitles stay above the player bar after it hides and comes back

<sub>Built from 897c95b · includes: Video player</sub>

### Preview 4 · Nov 10, 7:26 AM
**Stats**
- Opens on This year, and keeps the period you picked when you switch category
- Switching category fades smoothly instead of popping
- Watch-time charts fix for Playback Reporting; the setup prompt only shows to admins
- "Hip-Hop" and "Hip Hop" count as one genre (Stats and Year in Review)

**App-wide**
- Refresh, Stats and Settings buttons stay on the far right
- Refresh: only the arrows spin, not the whole button

<sub>Built from d9ca930 · includes: Stats, Music</sub>

### Preview 3 · Nov 10, 7:09 AM
**Video player**
- Dark (and shows like it) no longer jump to German "Forced" subtitles

<sub>Built from 4d7364d · includes: Video player</sub>

### Preview 2 · Nov 9, 11:46 PM
**Video player**
- "Ends at" time, rounded-square play button, slightly smaller buttons

**Behind the scenes**
- Build gatekeeper: Previews can no longer drop earlier work

<sub>Built from 733f0dd · includes: Video player, gatekeeper</sub>

### Preview 1 · Nov 9 (everything up to 11:30 PM)
**Video player**
- Smoother seek bar, picture follows while you drag; exact 10-second skips
- Faster starts and smooth motion
- New buttons with a press ring and play/pause morph; bars and pop-ups slide away
- Subtitles sit above the player bar; Up next 40 seconds before the end
- Subtitles start on each show's own default

**Audiobooks**
- Home, Library bookshelf, Authors, Series, Genres, book page and player
- Now listening page, book player in the Movies & TV top bar, Fan genre tiles
- Follow-along text

**Stats and Year in Review**
- Stats pages for all three tabs, Me / Everyone switch, Stats button in the top bar
- Stats as its own section; "Every day this year" grid for audiobooks
- Your Year in Review for Audiobooks, Music and Movies & TV

**App-wide**
- Top bar fits small windows and Ctrl +/- zoom
- Settings cog and Refresh button (Quick Scan / Deep Scan)

<sub>Built from 4940270 · includes: Video player, Audiobooks, Stats, Year in Review, Top bar</sub>

---

## 🗄️ Request service (server)

### Nov 11, 12:00 AM
- Server health explains why Audiobookshelf isn't answering: the key, or a login page in front of it

<sub>Built from f7fbfae</sub>

### Nov 10, 10:33 PM
- Server health explains the Audiobookshelf sign-in error and how to fix it (needs an Audiobookshelf API key in the Unraid settings)

<sub>Built from 3d93302</sub>

### Nov 10, 8:42 PM · version 1.1.0
- Settings for the admin Settings page (Server health and Requests sections)
- Update it in Unraid's Docker tab to get these

<sub>Built from 6a02dba</sub>

### Nov 10, 7:06 PM
- Much faster music searches, with no error the first time
- Requests show how many people asked and whether one of them is you (names stay private)

<sub>Built from 8f8bec7</sub>

### Nov 10, 6:35 PM
- Sets up its own data folder permissions (fixes "unable to open database file" on Unraid)
- Unraid template, so it installs from the Docker tab like other apps

<sub>Built from 808d0fd</sub>

---

## 📺 Google TV app

### TV test 1 · Nov 9, 7:03 PM
- First Android TV app: works with the TV remote
- Plays videos with the TV's own player
- Only converts the formats your TV can't play (for example DTS sound)

<sub>Built from 6b6c86c</sub>

---

## 📱 iPhone app

Nothing built yet. Planned: a free test build installed from the MacBook.
