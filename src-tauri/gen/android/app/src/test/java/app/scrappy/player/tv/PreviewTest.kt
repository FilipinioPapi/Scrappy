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
      p.contains("/Shows/NextUp") -> list(12, "Episode").toString()
      p.contains("/Similar") -> list(24).toString()
      p.contains("/Items/Latest") -> JSONArray().apply { for (i in 0 until 20) put(item(i + 3, if (p.contains("v2")) "Series" else "Movie")) }.toString()
      p.contains("/Genres?") -> JSONObject().put("Items", JSONArray().apply { listOf("Action", "Adventure", "Comedy", "Drama", "Western").forEachIndexed { i, g -> put(JSONObject().put("Id", "g$i").put("Name", g)) } }).toString()
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
    override fun hold(id: String, inResume: Boolean) { calls.add("hold $id") }
    override fun editHome(rowsJson: String) { calls.add("editHome") }
    override fun who() { calls.add("who") }
    override fun pick(title: String, options: List<String>, cur: Int, done: (Int) -> Unit) { calls.add("pick $title") }
    override fun saveSort(key: String, i: Int) {}
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

  @Test fun grid() {
    start()
    tv.route("#/library/v1")
    pump(3000)
    shot("grid")
    press(KeyEvent.KEYCODE_DPAD_DOWN, 3); shot("grid-d3")
    press(KeyEvent.KEYCODE_DPAD_UP, 4); shot("grid-chip")
    press(KeyEvent.KEYCODE_DPAD_DOWN); press(KeyEvent.KEYCODE_DPAD_RIGHT, 7); shot("grid-az")
  }
}
