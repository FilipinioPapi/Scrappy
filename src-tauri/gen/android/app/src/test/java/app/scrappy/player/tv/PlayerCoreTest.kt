package app.scrappy.player.tv

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** The player's own logic, run against a pretend Emby and a pretend video player with a clock moved by hand. */
@RunWith(RobolectricTestRunner::class)
class PlayerCoreTest {
  private class World {
    var time = 0L
    val timers = ArrayList<Triple<Long, Int, () -> Unit>>()
    var tn = 0
    val prefs = HashMap<String, String>()
    val store = HashMap<String, String>()
    val posts = ArrayList<Pair<String, JSONObject?>>()
    var onPost: (String) -> Unit = {}
    val gets = ArrayList<String>()
    val toasts = ArrayList<String>()
    var closed = 0
    var snap = JSONObject()
    // The pretend player.
    val controls = ArrayList<Pair<String, JSONObject>>()
    var opened = ArrayList<Triple<String, Double, JSONArray>>()
    var st = JSONObject().put("seq", 0).put("ready", 0).put("ended", false)
    // The pretend server.
    val items = HashMap<String, JSONObject>()
    var info: (String) -> JSONObject = { JSONObject() }
    var answers = HashMap<String, Any>()

    val eng = object : PlayerCore.Engine {
      override fun open(url: String, start: Double, subs: JSONArray): Int {
        opened.add(Triple(url, start, JSONArray(subs.toString())))
        val n = st.getInt("seq") + 1
        st = JSONObject().put("seq", n).put("ready", 0).put("ended", false).put("pos", start).put("dur", 0.0).put("paused", false).put("buffering", true).put("speed", 1.0).put("tracks", JSONArray())
        return n
      }
      override fun control(what: String, a: JSONObject) {
        controls.add(what to JSONObject(a.toString()))
        when (what) {
          "toggle" -> st.put("paused", !st.optBoolean("paused"))
          "pause" -> st.put("paused", a.optBoolean("on", true))
          "seek" -> st.put("pos", a.getDouble("value"))
          "speed" -> st.put("speed", a.getDouble("value"))
          "track" -> { val tr = st.optJSONArray("tracks") ?: return; for (i in 0 until tr.length()) { val t = tr.getJSONObject(i); if (t.getString("type") == a.getString("type")) t.put("selected", t.getInt("id").toString() == a.getString("id")) } }
        }
      }
      override fun state() = JSONObject(st.toString())
      override fun caps() = JSONObject().put("video", JSONArray().put("h264").put("hevc")).put("audio", JSONArray().put("aac").put("ac3").put("eac3"))
    }
    val io = object : PlayerCore.Io {
      override val server = "http://emby"; override val userId = "u1"; override val token = "tok"; override val deviceId = "dev"
      override fun get(path: String): Any {
        gets.add(path)
        answers[path]?.let { return it }
        Regex("^/Users/\\{userId\\}/Items/([^?/]+)").find(path)?.let { m -> items[m.groupValues[1]]?.let { return JSONObject(it.toString()) } }
        throw IllegalStateException("HTTP 404 $path")
      }
      override fun post(path: String, body: JSONObject?): Any? {
        posts.add(path to body?.let { JSONObject(it.toString()) })
        onPost(path)
        Regex("^/Items/([^/]+)/PlaybackInfo").find(path)?.let { return info(it.groupValues[1]) }
        return null
      }
      override fun pref(key: String) = prefs[key] ?: mapOf("autoplay" to "on", "upNextSecs" to "10", "skipIntro" to "off", "skipCredits" to "off", "quality" to "", "skipBack" to "10", "skipFwd" to "10",
        "tvSoundThrough" to "off", "subStart" to "default", "subLang" to "eng", "subScale" to "1", "audioLang" to "")[key] ?: ""
      override fun load(key: String) = store[key]
      override fun save(key: String, value: String) { store[key] = value; if (key == "quality" || key == "subScale") prefs[key] = value }
      override fun bg(work: () -> Unit) = work()
      override fun ui(work: () -> Unit) = work()
      override fun later(ms: Long, work: () -> Unit): () -> Unit { val id = ++tn; timers.add(Triple(time + ms, id, work)); return { timers.removeAll { it.second == id } } }
      override fun sleep(ms: Long) {}
      override fun now() = time
      override fun push(snap: JSONObject) { this@World.snap = snap }
      override fun toast(msg: String, error: Boolean) { toasts.add(msg) }
      override fun closed() { closed++ }
    }
    val core = PlayerCore(io, eng)

    /** Let `ms` of time pass, running what falls due. */
    fun run(ms: Long) {
      val end = time + ms
      while (true) {
        val next = timers.minByOrNull { it.first }?.takeIf { it.first <= end } ?: break
        timers.remove(next); time = maxOf(time, next.first); next.third()
      }
      time = end
    }
    fun reports(path: String) = posts.filter { it.first == path }.map { it.second!! }
    fun source(id: String, extra: JSONObject.() -> Unit = {}) = JSONObject().put("PlaySessionId", "ps-$id").put("MediaSources", JSONArray().put(
      JSONObject().put("Id", "ms-$id").put("Container", "mkv,webm").put("SupportsDirectPlay", true).put("MediaStreams", JSONArray()).apply(extra)))
    fun ready(dur: Double) { st.put("ready", st.getInt("seq")).put("dur", dur).put("buffering", false) }
  }

  private fun episode(id: String, n: Int, ticks: Long = 0) = JSONObject().put("Id", id).put("Type", "Episode").put("Name", "Episode $n").put("SeriesId", "show").put("SeriesName", "The Show").put("SeasonId", "s1")
    .put("ParentIndexNumber", 1).put("IndexNumber", n).put("RunTimeTicks", 1500L * 10_000_000L).put("UserData", JSONObject().put("PlaybackPositionTicks", ticks))

  @Test fun startsWhereYouLeftOffAndTellsEmby() {
    val w = World()
    w.items["m1"] = JSONObject().put("Id", "m1").put("Type", "Movie").put("Name", "Heat").put("ProductionYear", 1995).put("OfficialRating", "R").put("RunTimeTicks", 6000L * 10_000_000L)
      .put("UserData", JSONObject().put("PlaybackPositionTicks", 1234L * 10_000_000L))
    w.info = { w.source(it) { put("DefaultAudioStreamIndex", 1).put("MediaStreams", JSONArray()
      .put(JSONObject().put("Type", "Audio").put("Index", 1).put("Language", "eng"))
      .put(JSONObject().put("Type", "Subtitle").put("Index", 3).put("IsExternal", true).put("DeliveryUrl", "/Videos/m1/ms-m1/Subtitles/3/Stream.srt").put("DisplayTitle", "English (SRT)").put("Language", "eng"))) } }
    w.core.start("m1")
    assertEquals(1, w.opened.size)
    val (url, start, subs) = w.opened[0]
    assertEquals("http://emby/Videos/m1/stream.mkv?Static=true&MediaSourceId=ms-m1&DeviceId=dev&PlaySessionId=ps-m1&api_key=tok", url)
    assertEquals(1234.0, start, 0.001)
    assertEquals("http://emby/Videos/m1/ms-m1/Subtitles/3/Stream.srt?api_key=tok", subs.getJSONObject(0).getString("url"))
    assertEquals("English (SRT)", subs.getJSONObject(0).getString("title"))
    val asked = w.posts[0]
    assertTrue(asked.first.startsWith("/Items/m1/PlaybackInfo?UserId=u1&StartTimeTicks=0&IsPlayback=true&AutoOpenLiveStream=true&MaxStreamingBitrate=200000000"))
    assertEquals("h264,hevc", asked.second!!.getJSONObject("DeviceProfile").getJSONArray("DirectPlayProfiles").getJSONObject(0).getString("VideoCodec"))
    assertEquals("aac,ac3,eac3", asked.second!!.getJSONObject("DeviceProfile").getJSONArray("TranscodingProfiles").getJSONObject(0).getString("AudioCodec"))
    assertTrue(w.snap.getBoolean("open")); assertEquals("Heat", w.snap.getString("t1")); assertEquals("1995 · R", w.snap.getString("t2"))
    // Nothing is reported until the video is really playing.
    w.run(1000); assertEquals(0, w.reports("/Sessions/Playing").size)
    w.ready(6000.0); w.st.put("pos", 1234.5); w.run(300)
    val began = w.reports("/Sessions/Playing").single()
    assertEquals("m1", began.getString("ItemId")); assertEquals("ms-m1", began.getString("MediaSourceId")); assertEquals("ps-m1", began.getString("PlaySessionId")); assertEquals("DirectStream", began.getString("PlayMethod"))
    // Every 10 seconds while playing; a pause and a resume are told at once; nothing while paused.
    w.st.put("pos", 1240.0); w.run(10_000)
    val upd = w.reports("/Sessions/Playing/Progress")
    assertEquals(1, upd.size); assertEquals("TimeUpdate", upd[0].getString("EventName")); assertEquals(12_400_000_000L, upd[0].getLong("PositionTicks"))
    w.core.act("pause"); w.run(300)
    assertEquals("Pause", w.reports("/Sessions/Playing/Progress").last().getString("EventName")); assertTrue(w.reports("/Sessions/Playing/Progress").last().getBoolean("IsPaused"))
    val n = w.reports("/Sessions/Playing/Progress").size
    w.run(30_000); assertEquals(n, w.reports("/Sessions/Playing/Progress").size)
    w.core.act("pause"); w.run(300)
    assertEquals("Unpause", w.reports("/Sessions/Playing/Progress").last().getString("EventName"))
    // Leaving saves the spot.
    w.st.put("pos", 1300.0); w.run(300)
    w.core.act("exit")
    assertEquals(13_000_000_000L, w.reports("/Sessions/Playing/Stopped").single().getLong("PositionTicks"))
    assertEquals("stop", w.controls.last { it.first != "subPos" }.first)
    assertFalse(w.snap.getBoolean("open")); assertEquals(1, w.closed)
    w.run(60_000); assertEquals(1, w.reports("/Sessions/Playing/Stopped").size)
  }

  @Test fun fromStartAndConvertedStreams() {
    val w = World()
    w.items["m1"] = JSONObject().put("Id", "m1").put("Type", "Movie").put("Name", "Heat").put("UserData", JSONObject().put("PlaybackPositionTicks", 99L * 10_000_000L))
    w.info = { JSONObject().put("PlaySessionId", "ps").put("MediaSources", JSONArray().put(JSONObject().put("Id", "ms").put("SupportsDirectPlay", false).put("TranscodingUrl", "/videos/m1/master.m3u8?x=1"))) }
    w.core.start("m1", fromStart = true)
    assertEquals("http://emby/videos/m1/master.m3u8?x=1&api_key=tok", w.opened[0].first); assertEquals(0.0, w.opened[0].second, 0.0)
    // A lower quality: Emby is told to convert, and the video starts again at the same spot.
    w.ready(100.0); w.st.put("pos", 40.0); w.run(300)
    w.core.act("quality"); assertEquals("40 Mbps · 4K", w.snap.getString("quality"))
    w.core.act("quality"); assertEquals("20 Mbps · 1080p", w.snap.getString("quality"))
    assertEquals(1, w.opened.size)
    w.st.put("pos", 41.0); w.run(1600)
    assertEquals(2, w.opened.size); assertEquals(41.0, w.opened[1].second, 1.1)
    assertTrue(w.posts.last { it.first.contains("PlaybackInfo") }.first.endsWith("&MaxStreamingBitrate=20000000&EnableDirectPlay=false&EnableDirectStream=false"))
    assertEquals(1, w.reports("/Sessions/Playing/Stopped").size)
    // A server that can't play it: said plainly, and the player closes.
    val w2 = World()
    w2.items["m1"] = w.items["m1"]!!
    w2.info = { JSONObject().put("ErrorCode", "NoCompatibleStream") }
    w2.core.start("m1")
    assertEquals(listOf("Emby can't play this item (NoCompatibleStream)."), w2.toasts); assertFalse(w2.snap.getBoolean("open")); assertEquals(0, w2.opened.size)
  }

  @Test fun introCreditsUpNextAndStillWatching() {
    val w = World()
    for (i in 1..6) w.items["e$i"] = episode("e$i", i)
    w.items["e1"]!!.put("Chapters", JSONArray()
      .put(JSONObject().put("MarkerType", "IntroStart").put("StartPositionTicks", 60L * 10_000_000L)).put(JSONObject().put("MarkerType", "IntroEnd").put("StartPositionTicks", 150L * 10_000_000L))
      .put(JSONObject().put("MarkerType", "CreditsStart").put("StartPositionTicks", 1400L * 10_000_000L)))
    w.info = { w.source(it) }
    for (i in 1..5) w.answers["/Shows/show/Episodes?UserId={userId}&StartItemId=e$i&Limit=2&Fields=PrimaryImageAspectRatio"] = JSONObject().put("Items", JSONArray().put(w.items["e$i"]).put(w.items["e${i + 1}"]))
    w.prefs["stillWatching"] = "2"
    w.core.start("e1"); w.ready(1500.0); w.run(300)
    assertEquals("The Show", w.snap.getString("t1")); assertEquals("S1:E1 · Episode 1", w.snap.getString("t2")); assertEquals("2. Episode 2", w.snap.getString("next"))
    // In the intro: the Skip button; pressing it jumps to the end of the intro.
    w.st.put("pos", 70.0); w.run(300); assertEquals("intro", w.snap.getString("skip"))
    w.core.act("skip"); assertEquals(150.0, w.st.getDouble("pos"), 0.01); w.run(300); assertEquals("", w.snap.getString("skip"))
    // Credits: Up next counts down and plays the next episode by itself.
    w.st.put("pos", 1401.0); w.run(300)
    val up = w.snap.getJSONObject("up")
    assertEquals("credits", up.getString("mode")); assertEquals(10, up.getInt("count")); assertEquals("S1:E2 · Episode 2", up.getString("title")); assertEquals("25m", up.getString("meta")); assertEquals("Watch credits", up.getString("cancel"))
    w.run(5000); assertEquals(5, w.snap.getJSONObject("up").getInt("count"))
    w.run(5200)
    assertEquals(2, w.opened.size); assertTrue(w.opened[1].first.contains("/Videos/e2/")); assertEquals(0.0, w.opened[1].second, 0.0)
    assertEquals("e1", w.reports("/Sessions/Playing/Stopped").single().getString("ItemId"))
    assertFalse(w.snap.has("up"))
    // No credits marker: Up next shows for the last 40 seconds. "Watch credits" keeps playing; the end then offers it again.
    w.ready(1500.0); w.st.put("pos", 100.0); w.run(300)
    w.st.put("pos", 1461.0); w.run(300); assertEquals("credits", w.snap.getJSONObject("up").getString("mode"))
    w.core.act("up-cancel"); assertFalse(w.snap.has("up")); assertEquals(2, w.opened.size)
    w.st.put("ended", true); w.run(300)
    assertEquals("end", w.snap.getJSONObject("up").getString("mode")); assertEquals("Cancel", w.snap.getJSONObject("up").getString("cancel"))
    assertEquals(2, w.reports("/Sessions/Playing/Stopped").size)
    w.run(10_200)
    assertEquals(3, w.opened.size)
    // Two in a row by themselves is the limit here: the third asks "Are you still watching?" and pauses.
    w.ready(1500.0); w.st.put("pos", 1470.0); w.run(300); w.run(10_200)
    assertEquals(3, w.opened.size); assertEquals("The Show · S1:E4 · Episode 4", w.snap.getString("still")); assertTrue(w.st.getBoolean("paused"))
    w.core.act("still-yes"); assertEquals(4, w.opened.size); assertTrue(w.opened[3].first.contains("/Videos/e4/")); assertFalse(w.snap.has("still"))
    // Skip credits by itself (Settings), only on Emby's own marker; skip intro by itself.
    w.prefs["skipIntro"] = "on"; w.prefs["skipCredits"] = "on"
    val w2 = World(); w2.prefs.putAll(w.prefs); w2.items.putAll(w.items); w2.answers.putAll(w.answers); w2.info = { w2.source(it) }
    w2.core.start("e1"); w2.ready(1500.0); w2.run(300)
    w2.st.put("pos", 61.0); w2.run(300); assertEquals(150.0, w2.st.getDouble("pos"), 0.01); assertEquals(listOf("Skipped the intro"), w2.toasts)
    w2.st.put("pos", 1400.5); w2.run(300); assertEquals(2, w2.opened.size)
  }

  @Test fun picksSpeedTimingAndTheQueue() {
    val w = World()
    w.items["e1"] = episode("e1", 1); w.items["e2"] = episode("e2", 2)
    w.info = { w.source(it) }
    w.store["show:show"] = "{\"speed\":1.25}"
    w.store["subDelays"] = "{\"e1\":0.5}"
    w.core.start("e1"); w.ready(1500.0)
    w.st.put("tracks", JSONArray()
      .put(JSONObject().put("id", 1).put("type", "audio").put("selected", true).put("lang", "eng").put("codec", "eac3").put("demux-channel-count", 6))
      .put(JSONObject().put("id", 1).put("type", "sub").put("selected", false).put("lang", "eng").put("default", true))
      .put(JSONObject().put("id", 2).put("type", "sub").put("selected", false).put("lang", "spa")))
    w.run(600)
    // The show's remembered speed and this video's subtitle timing are put back; the video's default subtitles turn on.
    assertEquals(1.25, w.snap.getDouble("speed"), 0.0); assertEquals(0.5, w.snap.getDouble("subDelay"), 0.0)
    assertEquals(0.5, w.controls.last { it.first == "subDelay" }.second.getDouble("value"), 0.0)
    assertTrue(w.snap.getBoolean("subOn")); assertEquals("English", w.snap.getJSONArray("subs").getJSONObject(0).getString("label"))
    assertEquals("Dolby 5.1", w.snap.getJSONArray("audio").getJSONObject(0).getString("note"))
    // Your own choices are remembered for the show.
    w.core.act("sub", "2"); w.run(300)
    assertEquals("{\"lang\":\"spa\",\"title\":\"\",\"forced\":false}", JSONObject(w.store["tracks:show"]!!).getJSONObject("sub").toString())
    w.core.act("speed", "1.5"); assertEquals(1.5, JSONObject(w.store["show:show"]!!).getDouble("speed"), 0.0)
    w.core.act("subdelay", "-0.74"); assertEquals(-0.75, JSONObject(w.store["subDelays"]!!).getDouble("e1"), 0.0)
    w.core.act("subdelay", "0"); assertFalse(JSONObject(w.store["subDelays"]!!).has("e1"))
    w.core.act("size"); assertEquals("Large", w.snap.getString("size")); assertEquals("1.25", w.store["subScale"])
    w.core.act("shape"); assertEquals("16:9", w.snap.getString("shape"))
    w.core.act("exit")
    // A collection played in a row: Next walks the list, and it ends when something else is started.
    val q = World()
    for (i in 1..3) q.items["f$i"] = JSONObject().put("Id", "f$i").put("Type", "Movie").put("Name", "Film $i").put("UserData", JSONObject().put("PlaybackPositionTicks", 500L * 10_000_000L))
    q.info = { q.source(it) }
    q.core.playQueue(listOf("f1", "f2", "f3"))
    assertEquals(0.0, q.opened[0].second, 0.0); assertEquals("Film 2", q.snap.getString("next"))
    q.ready(100.0); q.run(300); q.core.act("next")
    assertTrue(q.opened[1].first.contains("/Videos/f2/")); assertEquals("Film 3", q.snap.getString("next"))
    q.ready(100.0); q.run(300); q.st.put("ended", true); q.run(300)
    assertEquals("Next film", q.snap.getJSONObject("up").getString("now"))
    q.core.act("up-cancel"); assertFalse(q.snap.getBoolean("open"))
  }

  @Test fun downloadsSubtitles() {
    val w = World()
    w.items["m1"] = JSONObject().put("Id", "m1").put("Type", "Movie").put("Name", "Heat").put("MediaStreams", JSONArray().put(JSONObject().put("Type", "Subtitle").put("Index", 2)))
    w.info = { w.source(it) }
    w.answers["/Users/{userId}"] = JSONObject().put("Policy", JSONObject().put("EnableSubtitleDownloading", true))
    w.answers["/Items/m1/RemoteSearch/Subtitles/spa?IsPerfectMatch=false"] = JSONArray()
      .put(JSONObject().put("Id", "a/1").put("Name", "Heat.1995.spa").put("ProviderName", "OpenSubtitles").put("Format", "srt").put("DownloadCount", 12345))
      .put(JSONObject().put("Id", "b").put("Name", "Heat.exact").put("IsHashMatch", true).put("Format", "ass"))
    w.core.start("m1"); w.ready(6000.0); w.run(300)
    assertTrue(w.snap.getBoolean("canDl"))
    w.core.act("dlsearch", "spa")
    val dl = w.snap.getJSONObject("dl")
    assertEquals("ok", dl.getString("state")); assertEquals("spa", w.store["subSearchLang"])
    assertEquals("Heat.exact", dl.getJSONArray("rows").getJSONObject(0).getString("name")); assertTrue(dl.getJSONArray("rows").getJSONObject(0).getBoolean("match"))
    assertEquals("OpenSubtitles · SRT · 12,345 downloads", dl.getJSONArray("rows").getJSONObject(1).getString("note"))
    // The server lists the new file after the download: it is added to the video, turned on and remembered.
    w.onPost = { if (it.contains("RemoteSearch/Subtitles/")) w.items["m1"]!!.getJSONArray("MediaStreams").put(JSONObject().put("Type", "Subtitle").put("Index", 5).put("IsExternal", true).put("Codec", "subrip").put("DisplayTitle", "Spanish (SRT External)").put("Language", "spa")) }
    w.core.act("dlget", "1")
    assertEquals("/Items/m1/RemoteSearch/Subtitles/a%2F1", w.posts.last().first)
    val add = w.controls.last { it.first == "addSub" }.second
    assertEquals("http://emby/Videos/m1/ms-m1/Subtitles/5/Stream.srt?api_key=tok", add.getString("url")); assertEquals("spa", add.getString("lang"))
    assertEquals(1, w.snap.getJSONObject("dl").getInt("got")); assertEquals(-1, w.snap.getJSONObject("dl").getInt("busy"))
    assertEquals("spa", JSONObject(w.store["tracks:m1"]!!).getJSONObject("sub").getString("lang"))
    // Reload keeps the downloaded file with the video.
    w.st.put("pos", 50.0); w.run(300); w.core.act("reload")
    assertEquals("reset", w.controls.last { it.first == "reset" }.first)
    assertEquals(2, w.opened.size); assertEquals(48.0, w.opened[1].second, 0.3)
    assertNull(w.opened[1].third.optJSONObject(0)) // a fresh start asks Emby again, which now lists the file itself
  }
}
