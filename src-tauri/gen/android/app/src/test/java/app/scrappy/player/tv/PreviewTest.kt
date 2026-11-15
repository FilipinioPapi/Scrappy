package app.scrappy.player.tv

import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.LooperMode
import org.robolectric.shadows.ShadowSystemClock
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.time.Duration
import org.robolectric.RuntimeEnvironment

/** Screen previews of the native TV screens against a small fake Emby (same idea as the web tvsim rig).
 *  Run: ./gradlew :app:testUniversalDebugUnitTest --tests '*PreviewTest*'  (pictures land in PREVIEW_OUT). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w1920dp-h1080dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@LooperMode(LooperMode.Mode.PAUSED)
class PreviewTest {
  companion object { var server: ServerSocket? = null; val log = ArrayList<String>() }
  private val out = File(System.getenv("PREVIEW_OUT") ?: "build/previews").apply { mkdirs() }

  private val N = listOf("Lanterns", "Mindhunter", "Stuart Fails", "Gundam I", "Gundam II", "Gundam III", "Shrek", "Perfect Blue", "Dragon Ball Z", "Watchmen", "Blood", "Three's Company", "SpongeBob", "Big Bang Theory", "Family Plan", "Hogan Family", "Stranger Things", "Sure Thing", "Heart of the Beast", "Old School")
  private fun iso(daysAgo: Int) = java.time.Instant.now().minus(Duration.ofDays(daysAgo.toLong())).toString()
  private fun item(i: Int, kind: String = "Movie") = JSONObject().put("Id", "it$i").put("Name", N[i % N.size] + if (i >= N.size) " $i" else "").put("Type", kind)
    .put("ProductionYear", 2000 + i % 26).put("RunTimeTicks", 60000000000L)
    .put("ImageTags", JSONObject().put("Primary", "t$i").put("Thumb", "t$i")).put("BackdropImageTags", JSONArray().put("b$i"))
    .put("UserData", JSONObject().put("PlayedPercentage", (i * 13) % 90).put("Played", i % 9 == 4).put("PlaybackPositionTicks", 10000000000L).put("LastPlayedDate", iso(9)).put("UnplayedItemCount", if (i % 7 == 3) 4 else 0))
    .put("Overview", "A short overview of this title for testing the TV layout. It runs a couple of lines long.")
    .put("CommunityRating", 7.5).put("OfficialRating", "PG-13").put("Genres", JSONArray().put("Drama")).put("DateCreated", iso(3))
    .apply { if (kind == "Episode") { put("SeriesName", N[i % N.size]); put("IndexNumber", 3); put("ParentIndexNumber", 2); put("SeriesId", "Series$i") } }
  private fun list(n: Int, kind: String = "Movie", off: Int = 0) = JSONObject().put("Items", JSONArray().apply { for (i in 0 until n) put(item(i + off, kind)) }).put("TotalRecordCount", n)

  private fun api(path: String): String {
    val p = path
    return when {
      p.contains("/Views") -> JSONObject().put("Items", JSONArray()
        .put(JSONObject().put("Id", "v1").put("Name", "Movies").put("CollectionType", "movies").put("ImageTags", JSONObject().put("Primary", "v")))
        .put(JSONObject().put("Id", "v2").put("Name", "TV Shows").put("CollectionType", "tvshows").put("ImageTags", JSONObject().put("Primary", "v")))
        .put(JSONObject().put("Id", "v3").put("Name", "Animated Movies").put("CollectionType", "movies").put("ImageTags", JSONObject().put("Primary", "v")))
        .put(JSONObject().put("Id", "v4").put("Name", "Collections").put("CollectionType", "boxsets").put("ImageTags", JSONObject().put("Primary", "v")))).toString()
      p.contains("/Items/Resume") -> JSONObject().put("Items", JSONArray().apply {
        listOf("Game of Thrones" to 1, "The Lord of the Rings: The Rings of Power" to 1, "Its Always Sunny in Philadelphia" to 0, "Dark" to 2).forEachIndexed { i, (n, m) ->
          put(item(i, "Episode").put("Id", "Episode9$i").put("SeriesName", n).put("SeriesId", "Series$i").put("ParentBackdropItemId", "Series$i").put("ParentBackdropImageTags", JSONArray().put("pb"))
            .apply { if (m == 1) { put("ParentLogoItemId", "Series$i"); put("ParentLogoImageTag", "lg") } else if (m == 2) { put("ParentThumbItemId", "Series$i"); put("ParentThumbImageTag", "th") } })
        }
      }).toString()
      p.contains("Series50/Seasons") -> JSONObject().put("Items", JSONArray().apply { for (n in 1..36) put(JSONObject().put("Id", "Season$n").put("Name", "$n. Arc name $n").put("Type", "Season").put("IndexNumber", n).put("ChildCount", 6).put("UserData", JSONObject())) }).toString()
      p.contains("/Episodes?") -> JSONObject().put("Items", JSONArray().apply { for (i in 0 until 8) put(item(i + 2, "Episode").put("Id", "Episode${i + 1}").put("IndexNumber", i + 1)
        .put("UserData", JSONObject().put("Played", i < 3).put("PlaybackPositionTicks", if (i == 3) 20000000000L else 0L).put("PlayedPercentage", if (i == 3) 33 else 0))) }).toString()
      p.contains("ParentId=Box") -> JSONObject().put("Items", JSONArray().apply { listOf("The Matrix", "The Matrix Reloaded", "The Matrix Revolutions", "The Matrix Resurrections").forEachIndexed { i, n ->
        put(item(i + 10).put("Name", n).put("ProductionYear", listOf(1999, 2003, 2003, 2021)[i]).put("UserData", JSONObject().put("Played", i < 2).put("PlaybackPositionTicks", if (i == 2) 20000000000L else 0L))) } }).toString()
      Regex("/Users/[^/]+/Items/(it\\d+|Series50|Episode\\d+|Box\\d+)(\\?|$)").containsMatchIn(p) -> {
        val id = Regex("/Items/([^/?]+)").find(p)!!.groupValues[1]
        val n = id.filter { it.isDigit() }.toInt()
        item(n, if (id.startsWith("Series")) "Series" else if (id.startsWith("Episode")) "Episode" else if (id.startsWith("Box")) "BoxSet" else "Movie").put("Id", id).put("ChildCount", 3)
          .apply { if (id.startsWith("Episode")) { put("IndexNumber", n % 90); put("SeasonId", "Season2"); put("SeasonName", "Season 2"); put("Name", "The Long Night"); remove("BackdropImageTags"); put("ParentBackdropItemId", "Series$n"); put("ParentBackdropImageTags", JSONArray().put("pb")) } }
          .apply { if (id.startsWith("Box")) { put("Name", "The Matrix Collection"); remove("BackdropImageTags"); put("Overview", "A hacker learns the world he lives in is a simulation, and joins the fight against the machines that built it.") } }
          .put("People", JSONArray().apply { for (i in 0 until 8) put(JSONObject().put("Id", "p$i").put("Name", "Actor $i").put("Role", "Role $i").put("Type", "Actor").apply { if (i % 3 == 0) put("PrimaryImageTag", "x") }) })
          .put("MediaSources", JSONArray().put(JSONObject().put("Id", "ms").put("MediaStreams", JSONArray()
            .put(JSONObject().put("Type", "Video").put("Width", 3840).put("Height", 2160))
            .put(JSONObject().put("Type", "Audio").put("Language", "eng").put("Codec", "eac3").put("Channels", 6).put("Index", 1).put("DisplayTitle", "eng · EAC3"))
            .put(JSONObject().put("Type", "Audio").put("Language", "spa").put("Codec", "aac").put("Channels", 2).put("Index", 3))
            .put(JSONObject().put("Type", "Subtitle").put("Language", "eng").put("Index", 2))
            .put(JSONObject().put("Type", "Subtitle").put("Language", "eng").put("Title", "SDH").put("Index", 4))
            .put(JSONObject().put("Type", "Subtitle").put("Language", "spa").put("Index", 5))
            .put(JSONObject().put("Type", "Subtitle").put("Language", "fre").put("Index", 6))
            .put(JSONObject().put("Type", "Subtitle").put("Language", "ger").put("IsForced", true).put("Index", 7))))).toString()
      }
      p.contains("/Shows/NextUp") -> list(12, "Episode").toString()
      p.contains("/Similar") -> list(24).toString()
      p.contains("/Items/Latest") -> JSONArray().apply { for (i in 0 until 20) put(item(i + 3, if (p.contains("v2")) "Series" else "Movie")) }.toString()
      p.contains("/Genres?") -> JSONObject().put("Items", JSONArray().apply { listOf("Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy", "History", "Horror", "Mystery", "Romance", "Science Fiction", "Thriller", "Western").forEachIndexed { i, g -> put(JSONObject().put("Id", "g$i").put("Name", g).put("MovieCount", if (i == 9) 3 else 8 + i * 5)) } }).toString()
      p.contains("Filters=IsFavorite") -> JSONObject().put("Items", JSONArray().apply { for (i in 0 until 17) put(item(i, "Movie")); for (i in 0 until 6) put(item(i + 30, "Series")); for (i in 0 until 5) put(item(i + 40, "Episode")); put(item(50, "BoxSet")) }).toString()
      p.contains("PersonIds=") -> JSONObject().put("Items", JSONArray().apply { for (i in 0 until 14) put(item(i, if (i % 3 == 2) "Series" else "Movie").put("People", JSONArray().put(JSONObject().put("Id", "p0").put("Role", "Character $i").put("Type", "Actor")))) }).toString()
      Regex("/Users/[^/]+/Items/p\\d(\\?|$)").containsMatchIn(p) -> JSONObject().put("Id", "p0").put("Name", "Pedro Pascal").put("Type", "Person").put("PremiereDate", "1975-04-02T00:00:00Z")
        .put("ProductionLocations", JSONArray().put("Santiago, Chile")).put("ImageTags", JSONObject().put("Primary", "x"))
        .put("Overview", "José Pedro Balmaceda Pascal is a Chilean and American actor. He is known for his roles in several television series and films, playing a wide range of characters across drama, action and science fiction, and has received many awards and nominations over a long career.").toString()
      p.contains("Limit=0") -> JSONObject().put("Items", JSONArray()).put("TotalRecordCount", if (p.contains("GenreIds")) 12 else 390).toString()
      p.contains("Filters=IsPlayed&SortBy=DatePlayed") && p.contains("Limit=1&") -> JSONObject().put("Items", JSONArray().put(item(4, "Episode"))).toString()
      Regex("/Users/[^/]+/Items/v\\d").containsMatchIn(p) -> JSONObject().put("Id", "v1").put("Name", "Movies").put("CollectionType", "movies").toString()
      Regex("/Users/[^/]+/Items/Series\\d").containsMatchIn(p) -> JSONObject().put("Id", "Series1").put("Name", "Game of Thrones").put("Overview", "Nine noble families fight for control of the lands of Westeros.").toString()
      Regex("/Users/[^/]+$").containsMatchIn(p.substringBefore('?')) -> JSONObject().put("Id", "u1").put("Configuration", JSONObject().put("LatestItemsExcludes", JSONArray())).toString()
      p.contains("StartIndex=") -> { val s = Regex("StartIndex=(\\d+)").find(p)!!.groupValues[1].toInt(); JSONObject().put("Items", JSONArray().apply { for (i in s until minOf(390, s + 60)) put(item(i).put("Name", "A title ${i + 1}")) }).put("TotalRecordCount", 390).toString() }
      p.contains("/Items?") -> list(24).toString()
      else -> "{}"
    }
  }

  private fun png(w: Int, h: Int, c: Int, logo: Boolean = false): ByteArray {
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val g = Canvas(bmp); val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    if (!logo) { g.drawColor(c); p.color = 0xFFCC99AA.toInt(); g.drawCircle(w * 0.7f, h * 0.4f, h * 0.2f, p) }
    else { p.color = -1; p.textSize = h / 2f; p.isFakeBoldText = true; g.drawText("LOGO", w / 10f, h * 0.7f, p) }
    return ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
  }

  private lateinit var pngs: Map<String, ByteArray>

  private fun serve(sock: java.net.Socket) = sock.use { s ->
    val inp = s.getInputStream().bufferedReader()
    val line = inp.readLine() ?: return
    while (true) { val l = inp.readLine() ?: break; if (l.isEmpty()) break }
    val path = line.split(' ').getOrElse(1) { "/" }
    synchronized(log) { log.add(path) }
    val body: ByteArray; val type: String
    if (path.contains("/Images/")) {
      type = "image/png"
      body = pngs[when {
        path.contains("/Logo") -> "logo"
        path.contains("/Backdrop") && path.contains("maxWidth=1920") -> "big"
        path.contains("/Backdrop") || path.contains("/Thumb") || path.contains("Episode") -> "wide"
        path.contains("/Users/") -> "face"
        else -> "poster"
      }]!!
    } else { type = "application/json"; body = api(path).toByteArray() }
    val o = s.getOutputStream()
    o.write("HTTP/1.1 200 OK\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
    o.write(body); o.flush()
  }

  @Before fun setUp() {
    pngs = mapOf("logo" to png(300, 120, 0, true), "big" to png(1920, 1080, 0xFF227744.toInt()), "wide" to png(400, 225, 0xFF227744.toInt()),
      "face" to png(120, 120, 0xFF445566.toInt()), "poster" to png(240, 360, 0xFF445566.toInt()))
    synchronized(log) { log.clear() }
    if (server == null) {
      val sv = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1")); server = sv
      val pool = java.util.concurrent.Executors.newFixedThreadPool(4)
      Thread { try { while (true) { val c = sv.accept(); pool.execute { try { serve(c) } catch (_: Throwable) {} } } } catch (_: Throwable) {} }.apply { isDaemon = true }.start()
    }
    val ctx = RuntimeEnvironment.getApplication()
    File(ctx.dataDir, "config.json").writeText(JSONObject().put("server", "http://127.0.0.1:${server!!.localPort}").put("userId", "u1").put("token", "x").put("userName", "JJ").toString())
  }


  private val host = object : Host {
    val calls = ArrayList<String>()
    override fun go(hash: String) { calls.add("go $hash") }
    override fun back() { calls.add("back") }
    override fun play(id: String) { calls.add("play $id") }
    override fun playSeries(id: String) { calls.add("playSeries $id") }
    override fun hold(id: String, inResume: Boolean) { calls.add("hold $id"); tv.menu.hold(id, inResume) }
    override fun holdAct(id: String, act: String) { calls.add("holdAct $id $act") }
    override fun playQueue(ids: List<String>) { calls.add("playQueue $ids") }
    override fun whoAct(act: String, args: JSONObject, done: (JSONObject?) -> Unit) { calls.add("whoAct $act $args"); done(JSONObject().put("ok", act != "switch" || args.optString("pin") == "1234")) }
    override fun whoClosed() { calls.add("whoClosed") }
    override fun setAct(act: String, args: JSONObject, done: (JSONObject?) -> Unit) {
      calls.add("setAct $act $args")
      if (act != "model" && act != "tips") { done(JSONObject().put("ok", true)); return }
      if (act == "tips") { done(JSONObject().put("ok", true).put("info", JSONObject().put("title", "Remote tips").put("lines", org.json.JSONArray().put("Hold OK on any poster for a quick menu.").put("Press Left at the edge of a screen to open the side bar.").put("While something plays, Left and Right skip and OK pauses. Back closes what is open, then leaves.")))); return }
      fun ch(k: String, l: String, d: String, o: List<String>, cur: Int) = JSONObject().put("t", "ch").put("key", k).put("label", l).put("desc", d).put("opts", org.json.JSONArray(o)).put("vals", org.json.JSONArray(o.map { it.lowercase() }.mapIndexed { i, v -> if (k == "subScale") listOf("0.8", "1", "1.25", "1.5")[i] else v })).put("cur", cur)
      fun sw(k: String, l: String, d: String, on: Boolean) = JSONObject().put("t", "sw").put("key", k).put("label", l).put("desc", d).put("on", on)
      fun bt(a: String, l: String, d: String, b: String, letter: String = "") = JSONObject().put("t", "bt").put("act", a).put("label", l).put("desc", d).put("btn", b).put("letter", letter)
      fun g(l: String) = JSONObject().put("t", "grp").put("label", l)
      fun sec(id: String, n: String, k: String, vararg rows: JSONObject) = JSONObject().put("id", id).put("name", n).put("kicker", k).put("rows", org.json.JSONArray(rows.toList()))
      val m = org.json.JSONArray()
        .put(JSONObject().put("h", "YOU"))
        .put(sec("account", "Account & servers", "SETTINGS", g("SIGNED IN"), bt("server", "Emby · Movies & TV", "Jayden on JJsNAS · ● Connected", "Switch account", "E"), bt("switch", "Audiobookshelf · Audiobooks", "Not signed in", "Sign in", "A"), g("THIS TV"), ch("startTab", "Start on", "Which tab opens when Scrappy starts.", listOf("Last used", "Movies & TV", "Music", "Audiobooks"), 0)))
        .put(JSONObject().put("h", "PLAYBACK"))
        .put(sec("tv", "Movies & TV", "PLAYBACK", g("PLAYING"), sw("autoplay", "Auto-play next episode", "Starts the next episode when one ends.", true), ch("upNextSecs", "Countdown before the next episode", "How long the “Up next” card waits.", listOf("5s", "10s", "20s"), 1),
          sw("tvSoundThrough", "Send Dolby and DTS untouched to a soundbar", "Off: Scrappy decodes the sound itself, which is the safe choice. On this TV, sending it untouched can freeze the film after skipping.", false),
          g("QUALITY"), ch("quality", "Streaming quality", "Original plays the file as it is.", listOf("Original", "40 Mbps · 4K", "20 Mbps · 1080p", "10 Mbps · 1080p", "6 Mbps · 720p"), 0)))
        .put(sec("subs", "Subtitles & audio", "PLAYBACK", g("SUBTITLES"), ch("subStart", "Which subtitles start", "A pick you make for a show always wins.", listOf("Show’s own default", "Always my language", "Off unless I turn them on"), 0),
          ch("subScale", "Subtitle size", "", listOf("Small", "Medium", "Large", "Extra large"), 1), ch("subStyle", "Subtitle style", "Outline, shadow or a dark box behind the text.", listOf("Outline", "Shadow", "Box"), 0), bt("resetSubs", "Forget my per-show picks", "Go back to every show’s own default.", "Reset")))
        .put(JSONObject().put("h", "APP"))
        .put(sec("about", "About & help", "APP", bt("tips", "Remote tips", "The handy things the remote can do in Scrappy.", "Show")))
      done(JSONObject().put("ok", true).put("model", JSONObject().put("sections", m)))
    }
    val signed = mutableSetOf<String>()
    var sharedOn = false
    override fun signAct(act: String, args: JSONObject, done: (JSONObject?) -> Unit) {
      calls.add("signAct $act ${if (args.has("pass")) "(pass hidden)" else args.toString()}")
      fun model(): JSONObject {
        val a = JSONArray()
        for ((k, n, w) in listOf(Triple("emby", "Emby", "Movies & TV"), Triple("navidrome", "Navidrome", "Music"), Triple("audiobookshelf", "Audiobookshelf", "Audiobooks")))
          a.put(JSONObject().put("kind", k).put("name", n).put("what", w).put("eg", "192.168.1.20:8096").put("signedIn", k in signed).put("user", if (k in signed) "jayden" else "").put("address", if (k in signed) "https://movies.myserver.com" else ""))
        val qr = JSONArray(); for (y in 0 until 25) qr.put((0 until 25).joinToString("") { x -> if ((x < 7 && y < 7) || (x > 17 && y < 7) || (x < 7 && y > 17) || (x * 7 + y * 13) % 5 < 2) "1" else "0" })
        val m = JSONObject().put("servers", a).put("qr", qr)
        if (sharedOn) m.put("shared", JSONObject().put("from", "Emby").put("user", "jayden").put("pic", ""))
        return m
      }
      when (act) {
        "start", "model" -> done(model())
        "check" -> done(JSONObject().put("ok", true).put("address", "https://" + args.optString("address")))
        "login", "same" -> { signed.add(args.optString("kind")); sharedOn = true; done(JSONObject().put("ok", true).put("model", model())) }
        else -> done(JSONObject().put("ok", true))
      }
    }
    override fun field(text: String, mode: String, change: (String) -> Unit, done: (String?) -> Unit) {
      calls.add("field $mode")
      val v = when (mode) { "url" -> "movies.myserver.com"; "user" -> "jayden"; else -> "secret" }
      change(v); done(v)
    }
    override fun stats(done: (JSONObject?) -> Unit) {
      calls.add("stats")
      fun arr(vararg o: JSONObject) = JSONArray(o.toList())
      fun it(a: String, b: String, v: String = "", i: Int = 1) = JSONObject().put("a", a).put("b", b).put("v", v).put("href", "#/item/it$i").put("pic", JSONObject().put("id", "it$i").put("type", "Primary").put("tag", "t").put("w", 300))
      val shows = JSONArray(); val sts = listOf("on", "up", "fin", "fin", "on", "off", "on", "up")
      for (i in 0 until 8) shows.put(JSONObject().put("name", "Show number $i").put("m", "${i + 3} of 20 episodes · 8h 40m").put("st", sts[i]).put("f", (i + 3) / 20.0).put("href", "#/item/Series5$i").put("pic", JSONObject().put("id", "it${i + 2}").put("type", "Backdrop").put("tag", "t").put("w", 560)))
      val m = JSONObject().put("sub", "All time · everything you’ve watched on Emby")
        .put("cards", arr(JSONObject().put("hot", true).put("k", "TIME WATCHED").put("v", "19").put("u", " days 6 h").put("d", JSONObject().put("t", "That's 462 hours of Movies & TV")),
          JSONObject().put("k", "EPISODES").put("v", "641").put("d", JSONObject().put("t", "across 41 shows")), JSONObject().put("k", "MOVIES").put("v", "188").put("d", JSONObject().put("t", "23 watched more than once")), JSONObject().put("k", "SHOWS FINISHED").put("v", "22").put("d", JSONObject().put("t", "and 5 you're up to date on"))))
        .put("shows", JSONObject().put("counts", JSONObject().put("all", 41).put("on", 7).put("up", 5).put("fin", 22).put("off", 7)).put("items", shows))
        .put("top2", JSONObject().put("items", arr(it("Dune: Part Two", "Sci-Fi · 2h 46m", "×4", 3), it("Interstellar", "Sci-Fi · 2h 49m", "×3", 4), it("Heat", "Crime · 2h 50m", "×2", 5), it("Arrival", "Sci-Fi", "×1", 6))))
        .put("eps", JSONObject().put("sub", "Emby counts every time you finish an episode").put("items", arr(it("Fishes", "The Bear · S2 E6", "×3", 7), it("Secrets", "Dark · S1 E1", "×2", 8))))
        .put("faces", JSONObject().put("items", arr(JSONObject().put("a", "Adam Scott").put("b", "1 show").put("ini", "AS").put("href", "#/person/p1"), it("Gary Oldman", "1 show, 3 movies", "", 9))))
        .put("genres", JSONObject().put("items", arr(JSONObject().put("n", "Drama").put("w", 1.0).put("v", "31%"), JSONObject().put("n", "Sci-Fi").put("w", 0.7).put("v", "22%"), JSONObject().put("n", "Comedy").put("w", 0.45).put("v", "14%"))))
        .put("decades", arr(JSONObject().put("h", 10).put("axis", "80s"), JSONObject().put("h", 40).put("axis", "90s"), JSONObject().put("h", 70).put("axis", "00s"), JSONObject().put("h", 100).put("axis", "10s"), JSONObject().put("h", 60).put("axis", "20s")))
        .put("facts", arr(JSONObject().put("k", "Favorite episode").put("v", "Fishes").put("s", "The Bear · S2 E6, watched 3 times"), JSONObject().put("k", "Nonstop").put("v", "19 days").put("s", "if you watched it all back to back"), JSONObject().put("k", "Longest movie").put("v", "Heat").put("s", "2h 50m"), JSONObject().put("k", "Oldest watch").put("v", "").put("s", "")))
      android.os.Handler(Looper.getMainLooper()).post { done(m) }
    }
    override fun editHome(rowsJson: String) { calls.add("editHome") }
    override fun who() { calls.add("who") }
    override fun pick(title: String, options: List<String>, cur: Int, done: (Int) -> Unit) { calls.add("pick $title"); tv.menu.pick(title, options, cur) { i -> calls.add("picked $title $i"); done(i) } }
    override fun saveSort(key: String, i: Int) {}
    override fun saveHomeRows(json: String) { calls.add("saveHomeRows $json") }
    override fun updAct(act: String) { calls.add("updAct $act") }
    override fun playFrom(id: String, fromStart: Boolean) {}
    override fun playSeriesFrom(id: String, fromStart: Boolean) {}
    override fun toast(msg: String, error: Boolean) {}
    override fun changed() {}
    override fun local(key: String, done: (String?) -> Unit) { done(null) }
    override fun setLocal(key: String, value: String) {}
    override fun replace(hash: String, go: Boolean) {}
    override fun reroute() {}
    override fun subtitles(id: String) {}
    override fun search(text: String, done: (JSONObject?) -> Unit) {
      calls.add("search $text")
      val secs = JSONArray()
        .put(JSONObject().put("title", "Best match").put("kind", "cards").put("noCount", true).put("items", JSONArray().put(item(4))))
        .put(JSONObject().put("title", "Movies & Shows").put("kind", "cards").put("items", JSONArray().apply { for (i in 0 until 9) put(item(i + 5, if (i % 3 == 2) "Series" else "Movie")) }))
        .put(JSONObject().put("title", "People").put("kind", "people").put("items", JSONArray().put(JSONObject().put("Id", "p1").put("Name", "Gunnar Hansen").put("ImageTags", JSONObject().put("Primary", "x"))).put(JSONObject().put("Id", "p2").put("Name", "Tim Gunn"))))
        .put(JSONObject().put("title", "Episodes").put("kind", "wide").put("items", JSONArray().apply { for (i in 0 until 3) put(item(i + 2, "Episode")) }))
        .put(JSONObject().put("title", "Music").put("kind", "rows").put("rows", JSONArray().apply { for (i in 0 until 6) put(JSONObject().put("href", "#/music/album/a$i").put("title", "Song $i").put("sub", "Song · Artist $i").put("right", "3:2$i").put("h", i * 50)) }))
      android.os.Handler(Looper.getMainLooper()).post { done(JSONObject().put("failed", JSONArray().put("Audiobookshelf")).put("sections", secs)) }
    }
    override fun keyboard(text: String, change: (String) -> Unit, done: (String?) -> Unit) { calls.add("keyboard"); change("gun"); done("gun") }
  }

  private lateinit var tv: TvView

  private fun pump(ms: Long) {
    val end = System.currentTimeMillis() + ms
    while (System.currentTimeMillis() < end) {
      ShadowSystemClock.advanceBy(Duration.ofMillis(16))
      shadowOf(Looper.getMainLooper()).idle()
      Thread.sleep(8)
    }
  }

  /** Let animations run to rest (draw frames with the clock moving), then save a picture. */
  private fun shot(name: String, settle: Long = 600) {
    val bmp = Bitmap.createBitmap(1920, 1080, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val end = System.currentTimeMillis() + settle
    while (System.currentTimeMillis() < end) {
      ShadowSystemClock.advanceBy(Duration.ofMillis(16))
      shadowOf(Looper.getMainLooper()).idle()
      tv.draw(c)
      Thread.sleep(4)
    }
    tv.draw(c)
    File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
  }

  private fun press(code: Int, times: Int = 1, gap: Long = 200) {
    repeat(times) {
      val t = SystemClock.uptimeMillis()
      tv.onKey(KeyEvent(t, t, KeyEvent.ACTION_DOWN, code, 0))
      tv.onKey(KeyEvent(t, t + 30, KeyEvent.ACTION_UP, code, 0))
      val bmp = Bitmap.createBitmap(1920, 1080, Bitmap.Config.ARGB_8888); val c = Canvas(bmp)
      val end = System.currentTimeMillis() + gap
      while (System.currentTimeMillis() < end) { ShadowSystemClock.advanceBy(Duration.ofMillis(16)); shadowOf(Looper.getMainLooper()).idle(); tv.draw(c); Thread.sleep(4) }
    }
  }

  private fun start() {
    val ctx = RuntimeEnvironment.getApplication()
    tv = TvView(ctx, host)
    tv.measure(View.MeasureSpec.makeMeasureSpec(1920, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(1080, View.MeasureSpec.EXACTLY))
    tv.layout(0, 0, 1920, 1080)
  }

  @Test fun home() {
    start()
    tv.route("#/home")
    pump(4000)
    shot("home")
    press(KeyEvent.KEYCODE_DPAD_DOWN); shot("home-d1")
    press(KeyEvent.KEYCODE_DPAD_DOWN); shot("home-d2")
    press(KeyEvent.KEYCODE_DPAD_RIGHT); shot("home-d2r")
    press(KeyEvent.KEYCODE_DPAD_LEFT, 2); shot("home-rail")
    press(KeyEvent.KEYCODE_DPAD_RIGHT)
    press(KeyEvent.KEYCODE_DPAD_DOWN, 4); pump(800); shot("home-lib")
    press(KeyEvent.KEYCODE_DPAD_DOWN, 6); pump(1500); shot("home-genres")
    press(KeyEvent.KEYCODE_DPAD_DOWN, 8); pump(1500); shot("home-end")
    File(out, "home-calls.txt").writeText(host.calls.joinToString("\n") + "\n---\n" + synchronized(log) { log.joinToString("\n") })
  }

  @Test fun detail() {
    start()
    for ((id, n) in listOf("it4" to "movie", "Series50" to "show")) {
      tv.route("#/item/$id")
      pump(3000)
      shot("item-$n")
      for (i in 1..4) { press(KeyEvent.KEYCODE_DPAD_DOWN); pump(500); if (i == 1 || i % 2 == 0) shot("item-$n-d$i", 1600) }
    }
    File(out, "detail-calls.txt").writeText(host.calls.joinToString("\n") + "\n---\n" + synchronized(log) { log.joinToString("\n") })
  }

  @Test fun pages2() {
    start()
    tv.route("#/item/Episode4"); pump(3000); shot("item-ep")
    press(KeyEvent.KEYCODE_DPAD_DOWN); pump(500); shot("item-ep-d1", 1200)
    press(KeyEvent.KEYCODE_DPAD_DOWN); pump(500); shot("item-ep-d2", 1200)
    tv.route("#/item/Box7"); pump(3000); shot("item-box")
    press(KeyEvent.KEYCODE_DPAD_DOWN); pump(500); shot("item-box-d1", 1200)
    tv.route("#/item/it4"); pump(3000)
    press(KeyEvent.KEYCODE_DPAD_RIGHT, 5); press(KeyEvent.KEYCODE_DPAD_CENTER); shot("item-subs")
    press(KeyEvent.KEYCODE_DPAD_DOWN, 4); press(KeyEvent.KEYCODE_DPAD_RIGHT); shot("item-subs-other")
    press(KeyEvent.KEYCODE_DPAD_CENTER); pump(400); shot("item-subs-picked")
    press(KeyEvent.KEYCODE_DPAD_LEFT); press(KeyEvent.KEYCODE_DPAD_CENTER); shot("item-audio")
    press(KeyEvent.KEYCODE_BACK)
    tv.route("#/item/Series50"); pump(3000); shot("item-show2")
    File(out, "pages2-calls.txt").writeText(host.calls.joinToString("\n"))
  }

  @Test fun who() {
    start()
    tv.route("#/home"); pump(2500)
    val ppl = org.json.JSONArray().put(JSONObject().put("id", "a").put("name", "Jayden")).put(JSONObject().put("id", "b").put("name", "Sam").put("hasPin", true)).put(JSONObject().put("id", "c").put("name", "Kids"))
    tv.who.show(JSONObject().put("active", "a").put("people", ppl)); shot("who-full")
    press(KeyEvent.KEYCODE_DPAD_RIGHT); shot("who-full-r")
    press(KeyEvent.KEYCODE_DPAD_CENTER); shot("who-pin")
    press(KeyEvent.KEYCODE_9); press(KeyEvent.KEYCODE_9); shot("who-pin-2")
    press(KeyEvent.KEYCODE_9); press(KeyEvent.KEYCODE_9); pump(400); shot("who-pin-wrong")
    press(KeyEvent.KEYCODE_BACK); press(KeyEvent.KEYCODE_BACK)
    tv.who.show(JSONObject().put("active", "a").put("side", true).put("people", ppl)); shot("who-side")
    press(KeyEvent.KEYCODE_DPAD_DOWN, 4); press(KeyEvent.KEYCODE_DPAD_CENTER); shot("who-manage")
    File(out, "who-calls.txt").writeText(host.calls.joinToString("\n"))
  }

  @Test fun settings() {
    start()
    tv.route("#/settings"); pump(1500); shot("set")
    press(KeyEvent.KEYCODE_DPAD_DOWN); shot("set-tv")
    press(KeyEvent.KEYCODE_DPAD_RIGHT); press(KeyEvent.KEYCODE_DPAD_DOWN); press(KeyEvent.KEYCODE_DPAD_RIGHT); shot("set-tv-row")
    press(KeyEvent.KEYCODE_BACK); press(KeyEvent.KEYCODE_DPAD_DOWN); press(KeyEvent.KEYCODE_DPAD_RIGHT); press(KeyEvent.KEYCODE_DPAD_DOWN); press(KeyEvent.KEYCODE_DPAD_RIGHT); shot("set-subs-preview", 900)
    press(KeyEvent.KEYCODE_DPAD_DOWN); press(KeyEvent.KEYCODE_DPAD_RIGHT, 2); shot("set-subs-box", 900)
    press(KeyEvent.KEYCODE_DPAD_UP, 2); press(KeyEvent.KEYCODE_DPAD_CENTER); shot("set-list")
    press(KeyEvent.KEYCODE_BACK); press(KeyEvent.KEYCODE_BACK); press(KeyEvent.KEYCODE_DPAD_DOWN); press(KeyEvent.KEYCODE_DPAD_RIGHT); press(KeyEvent.KEYCODE_DPAD_CENTER); shot("set-tips")
    File(out, "settings-calls.txt").writeText(host.calls.joinToString("\n"))
  }

  @Test fun signin() {
    start()
    tv.route("#/login"); pump(800); shot("sign-addr")
    press(KeyEvent.KEYCODE_DPAD_CENTER); pump(300); shot("sign-user")
    press(KeyEvent.KEYCODE_DPAD_CENTER); pump(300); shot("sign-pass")
    press(KeyEvent.KEYCODE_DPAD_CENTER); pump(200); shot("sign-flash", 300)
    pump(1300); shot("sign-next")
    press(KeyEvent.KEYCODE_DPAD_CENTER); pump(300); shot("sign-who")
    press(KeyEvent.KEYCODE_BACK); pump(200); shot("sign-back-emby")
    press(KeyEvent.KEYCODE_DPAD_UP); shot("sign-tiles")
    File(out, "signin-calls.txt").writeText(host.calls.joinToString("\n"))
  }

  @Test fun update() {
    start()
    tv.route("#/home"); pump(3000)
    tv.upd.show(JSONObject().put("step", "ask").put("version", "0.4.2").put("current", "0.4.0").put("notes", JSONArray().put("Episode pages match the show pages").put("Edit home works with the remote").put("Stats on the side bar")))
    shot("upd-ask")
    press(KeyEvent.KEYCODE_DPAD_RIGHT); shot("upd-later")
    tv.upd.show(JSONObject().put("step", "get").put("version", "0.4.2").put("got", 15_000_000L).put("total", 38_000_000L).put("gotText", "14 of 36 MB").put("left", "about 12 seconds left")); shot("upd-get", 900)
    tv.upd.show(JSONObject().put("step", "ready").put("version", "0.4.2")); shot("upd-ready")
    tv.upd.show(JSONObject().put("step", "fail").put("err", "Download failed: no connection")); shot("upd-fail")
    press(KeyEvent.KEYCODE_BACK); shot("upd-closed")
    File(out, "upd-calls.txt").writeText(host.calls.joinToString("\n"))
  }

  @Test fun banner() {
    start()
    tv.route("#/home"); pump(4000)
    val h = tv.home()
    h.hero.showForTest((0 until 5).map { n -> Hero.Pick(JSONObject().put("Id", "m$n").put("Name", listOf("The Fix", "Black Bag", "Heart of the Beast", "Tokyo Godfathers", "Donnie Darko")[n]).put("Type", "Movie").put("ProductionYear", 2020 + n).put("Overview", "A short line about this film."), "NEW FOR YOU", "Added this week", "") })
    pump(800)
    press(KeyEvent.KEYCODE_DPAD_UP, 4)
    shot("banner")
    press(KeyEvent.KEYCODE_DPAD_RIGHT, 2); shot("banner-next", 900)
    press(KeyEvent.KEYCODE_DPAD_LEFT); press(KeyEvent.KEYCODE_DPAD_LEFT); shot("banner-prev", 900)
    press(KeyEvent.KEYCODE_DPAD_LEFT); shot("banner-rail")
  }

  @Test fun edithome() {
    start()
    tv.route("#/home"); pump(4000)
    tv.home().openEdit(); shot("edit")
    press(KeyEvent.KEYCODE_DPAD_DOWN, 2); press(KeyEvent.KEYCODE_DPAD_CENTER); shot("edit-off")
    press(KeyEvent.KEYCODE_DPAD_RIGHT); shot("edit-move")
    press(KeyEvent.KEYCODE_DPAD_CENTER); press(KeyEvent.KEYCODE_DPAD_UP); shot("edit-moving")
    press(KeyEvent.KEYCODE_DPAD_CENTER); press(KeyEvent.KEYCODE_DPAD_DOWN, 12); shot("edit-done")
    press(KeyEvent.KEYCODE_BACK); shot("edit-closed", 900)
    File(out, "edit-calls.txt").writeText(host.calls.joinToString("\n"))
  }

  @Test fun stats() {
    start()
    tv.route("#/stats"); pump(2500); shot("stats")
    press(KeyEvent.KEYCODE_DPAD_UP); press(KeyEvent.KEYCODE_DPAD_RIGHT, 3); shot("stats-chip")
    press(KeyEvent.KEYCODE_DPAD_DOWN); press(KeyEvent.KEYCODE_DPAD_DOWN); pump(600); shot("stats-movies", 1200)
    press(KeyEvent.KEYCODE_DPAD_DOWN); pump(600); shot("stats-eps", 1200)
    press(KeyEvent.KEYCODE_DPAD_DOWN); pump(600); shot("stats-faces", 1200)
    File(out, "stats-calls.txt").writeText(host.calls.joinToString("\n"))
  }

  @Test fun pages() {
    start()
    tv.route("#/genres"); pump(3000); shot("genres")
    press(KeyEvent.KEYCODE_DPAD_DOWN, 2); shot("genres-d2")
    tv.route("#/favorites"); pump(3000); shot("favs")
    press(KeyEvent.KEYCODE_DPAD_UP); press(KeyEvent.KEYCODE_DPAD_RIGHT); shot("favs-chip")
    press(KeyEvent.KEYCODE_DPAD_CENTER); pump(800); shot("favs-shows")
    tv.route("#/person/p0"); pump(3000); shot("person")
    press(KeyEvent.KEYCODE_DPAD_DOWN); shot("person-d1", 1200)
    File(out, "pages-calls.txt").writeText(host.calls.joinToString("\n") + "\n---\n" + synchronized(log) { log.joinToString("\n") })
  }

  @Test fun search() {
    start()
    tv.route("#/search"); pump(1500); shot("search")
    press(KeyEvent.KEYCODE_DPAD_CENTER); pump(1500); shot("search-gun")
    press(KeyEvent.KEYCODE_DPAD_DOWN); shot("search-d1", 1000)
    press(KeyEvent.KEYCODE_DPAD_DOWN); press(KeyEvent.KEYCODE_DPAD_DOWN); shot("search-d3", 1000)
    press(KeyEvent.KEYCODE_DPAD_DOWN); shot("search-d4", 1000)
    press(KeyEvent.KEYCODE_DPAD_DOWN); shot("search-d5", 1000)
    File(out, "search-calls.txt").writeText(host.calls.joinToString("\n"))
  }

  @Test fun grid() {
    start()
    tv.route("#/library/v1")
    pump(3000)
    shot("grid")
    press(KeyEvent.KEYCODE_DPAD_DOWN, 3); shot("grid-d3")
    press(KeyEvent.KEYCODE_DPAD_UP, 4); shot("grid-chip")
    press(KeyEvent.KEYCODE_DPAD_DOWN); press(KeyEvent.KEYCODE_DPAD_RIGHT, 7); shot("grid-az")
  }

  @Test fun menus() {
    start()
    tv.route("#/library/v1")
    pump(3000)
    press(KeyEvent.KEYCODE_DPAD_DOWN); press(KeyEvent.KEYCODE_DPAD_RIGHT, 2)
    fun holdOk() {
      val t = SystemClock.uptimeMillis()
      tv.onKey(KeyEvent(t, t, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER, 0))
      ShadowSystemClock.advanceBy(Duration.ofMillis(650))
      tv.onKey(KeyEvent(t, t + 650, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER, 1))
      pump(600)
      tv.onKey(KeyEvent(t, t + 900, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_CENTER, 0))
    }
    holdOk(); shot("menu-hold")
    press(KeyEvent.KEYCODE_DPAD_DOWN, 2); shot("menu-hold-d2")
    press(KeyEvent.KEYCODE_DPAD_CENTER); shot("menu-hold-done")
    press(KeyEvent.KEYCODE_DPAD_RIGHT, 4); holdOk(); shot("menu-hold-right")
    press(KeyEvent.KEYCODE_BACK)
    press(KeyEvent.KEYCODE_DPAD_UP, 4); press(KeyEvent.KEYCODE_DPAD_CENTER); shot("menu-pick-sort")
    press(KeyEvent.KEYCODE_DPAD_DOWN, 2); press(KeyEvent.KEYCODE_DPAD_CENTER); pump(800); shot("menu-picked")
    press(KeyEvent.KEYCODE_DPAD_RIGHT, 2); press(KeyEvent.KEYCODE_DPAD_CENTER); pump(1500); press(KeyEvent.KEYCODE_DPAD_DOWN, 9); shot("menu-pick-genre")
    File(out, "menus-calls.txt").writeText(host.calls.joinToString("\n"))
  }

  @Test fun player() {
    val ctx = RuntimeEnvironment.getApplication()
    Net.init(ctx); Img.init(ctx)
    var paused = false
    val acts = ArrayList<String>()
    val ui = PlayerUi(ctx, object : PlayerHost {
      override fun act(action: String, value: String) { acts.add("$action $value"); if (action == "pause") paused = !paused }
      override fun clock() = doubleArrayOf(1303.0, 3100.0, if (paused) 1.0 else 0.0, 0.0)
    })
    ui.measure(View.MeasureSpec.makeMeasureSpec(1920, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(1080, View.MeasureSpec.EXACTLY))
    ui.layout(0, 0, 1920, 1080)
    fun sub(id: Int, label: String, note: String, g: Int, on: Boolean = false) = JSONObject().put("id", "$id").put("label", label).put("note", note).put("g", g).put("on", on)
    val subs = JSONArray().put(sub(1, "English", "", 0, true)).put(sub(2, "English", "SDH", 0)).put(sub(3, "English", "Signs & Songs", 0)).put(sub(4, "Spanish", "", 0)).put(sub(5, "Spanish", "Latin America", 0))
    listOf("Arabic", "Dutch", "French", "German", "Italian", "Japanese", "Korean", "Polish", "Portuguese", "Russian", "Swedish", "Turkish").forEachIndexed { i, n -> subs.put(sub(10 + i, n, "", 1)) }
    val audio = JSONArray().put(JSONObject().put("id", "1").put("label", "German").put("note", "Dolby 5.1").put("on", true)).put(JSONObject().put("id", "2").put("label", "English").put("note", "Dolby 5.1"))
      .put(JSONObject().put("id", "3").put("label", "Japanese").put("note", "AAC Stereo")).put(JSONObject().put("id", "4").put("label", "English").put("note", "Commentary · AAC Stereo"))
    val base = JSONObject().put("open", true).put("id", "Episode3").put("series", "Series4").put("season", "Season2").put("isEp", true)
      .put("t1", "Gundam II").put("t2", "S2:E3 · The Gundam Rises").put("ov", "The crew lands on the moon base and finds it already taken. Amuro has to decide whether to launch alone before the others are ready, while the captain weighs a retreat.")
      .put("dur", 3100).put("next", "4. Second Front").put("subs", subs).put("subOn", true).put("audio", audio).put("speed", 1.0)
      .put("size", "Medium").put("shape", "Auto").put("quality", "Original (direct play)").put("back", 10).put("fwd", 10).put("canDl", true)
    ui.state(base)
    val bmp = Bitmap.createBitmap(1920, 1080, Bitmap.Config.ARGB_8888); val c = Canvas(bmp)
    val bg = android.graphics.Paint().apply { shader = android.graphics.LinearGradient(0f, 0f, 1920f, 1080f, 0xFF4F6E62.toInt(), 0xFF16222A.toInt(), android.graphics.Shader.TileMode.CLAMP) }
    fun frames(ms: Long) { val end = System.currentTimeMillis() + ms; while (System.currentTimeMillis() < end) { ShadowSystemClock.advanceBy(Duration.ofMillis(16)); shadowOf(Looper.getMainLooper()).idle(); c.drawRect(0f, 0f, 1920f, 1080f, bg); ui.draw(c); Thread.sleep(4) } }
    fun snap(name: String, ms: Long = 500) { frames(ms); c.drawRect(0f, 0f, 1920f, 1080f, bg); ui.draw(c); File(out, "player-$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) } }
    fun key(code: Int, n: Int = 1) { repeat(n) { val t = SystemClock.uptimeMillis(); ui.onKey(KeyEvent(t, t, KeyEvent.ACTION_DOWN, code, 0)); ui.onKey(KeyEvent(t, t + 30, KeyEvent.ACTION_UP, code, 0)); frames(120) } }
    key(KeyEvent.KEYCODE_DPAD_UP); snap("bar")
    key(KeyEvent.KEYCODE_DPAD_RIGHT, 2); snap("next")
    key(KeyEvent.KEYCODE_DPAD_RIGHT); key(KeyEvent.KEYCODE_DPAD_CENTER); snap("subs")
    key(KeyEvent.KEYCODE_DPAD_DOWN, 5); snap("subs-other")
    key(KeyEvent.KEYCODE_DPAD_CENTER); snap("other")
    // Download subtitles
    fun dl(state: String, busy: Int = -1, got: Int = -1, lang: String = "eng") {
      val rows = JSONArray()
      if (state == "ok") listOf("Gundam.II.S02E03.1080p.BluRay.x264-GRP" to true, "Gundam II S02E03 WEB-DL English" to false, "Gundam.II.2x03.HDTV.eng" to false,
        "Gundam II 2x03 (English, hearing impaired)" to false, "Gundam II - 2x03 forced eng" to false, "Gundam.II.S02E03.720p" to false).forEachIndexed { i, (n, m) ->
        rows.put(JSONObject().put("name", n).put("note", "OpenSubtitles · SRT · ${4210 - i * 700} downloads").put("match", m)) }
      ui.state(JSONObject(base.toString()).put("dl", JSONObject().put("lang", lang).put("state", state).put("msg", "").put("busy", busy).put("got", got).put("rows", rows)))
    }
    dl("idle")
    key(KeyEvent.KEYCODE_BACK); key(KeyEvent.KEYCODE_DPAD_DOWN); key(KeyEvent.KEYCODE_DPAD_CENTER)
    dl("searching"); snap("dl-search")
    dl("ok"); snap("dl")
    key(KeyEvent.KEYCODE_DPAD_DOWN, 2); snap("dl-list")
    key(KeyEvent.KEYCODE_DPAD_CENTER); dl("ok", busy = 1); snap("dl-busy")
    dl("ok", got = 1); snap("dl-got", 300); snap("dl-returned", 1400); key(KeyEvent.KEYCODE_DPAD_CENTER)
    key(KeyEvent.KEYCODE_DPAD_UP, 2); key(KeyEvent.KEYCODE_DPAD_RIGHT); key(KeyEvent.KEYCODE_DPAD_RIGHT); snap("dl-other")
    key(KeyEvent.KEYCODE_DPAD_CENTER); dl("ok", lang = "fre"); snap("dl-german")
    key(KeyEvent.KEYCODE_BACK); snap("dl-back")
    key(KeyEvent.KEYCODE_BACK); key(KeyEvent.KEYCODE_DPAD_RIGHT); key(KeyEvent.KEYCODE_DPAD_CENTER); snap("audio")
    key(KeyEvent.KEYCODE_BACK); key(KeyEvent.KEYCODE_DPAD_RIGHT, 2); key(KeyEvent.KEYCODE_DPAD_CENTER); snap("settings")
    key(KeyEvent.KEYCODE_BACK); key(KeyEvent.KEYCODE_DPAD_DOWN); snap("eps", 2500)
    key(KeyEvent.KEYCODE_DPAD_RIGHT); snap("eps-r")
    key(KeyEvent.KEYCODE_BACK); key(KeyEvent.KEYCODE_DPAD_UP); snap("seek")
    key(KeyEvent.KEYCODE_DPAD_RIGHT, 3); snap("seeking", 100)
    frames(1500); paused = true; snap("paused", 1000); snap("pausedinfo", 6500)
    File(out, "player-acts.txt").writeText(acts.joinToString("\n"))
  }
}
