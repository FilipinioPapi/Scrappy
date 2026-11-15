package app.scrappy.player.tv

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Everything the player does besides drawing, in the app's own code: a port of the page's player
 * (player.js) and of the Rust side behind it (lib.rs play / reports, emby.rs playback_target).
 *
 * Starting a video (resume point, Emby's stream details, subtitle files), choosing sound and
 * subtitles (TrackPicks), Skip intro / credits, Up next and "Still watching?", a collection played
 * in a row, speed per show, subtitle timing per video, quality, Reload, downloading subtitles, and
 * telling Emby where you are (start, every 10 s, pause, stop) so resume works everywhere.
 *
 * The video itself is played by `Engine` (Exo). Everything here runs on the main thread; talking
 * to Emby happens through Io.bg and comes back through Io.ui.
 */
class PlayerCore(private val io: Io, private val eng: Engine) {
  interface Engine {
    /** Start a video; returns its number (state().seq). */
    fun open(url: String, start: Double, subs: JSONArray): Int
    fun control(what: String, a: JSONObject = JSONObject())
    fun state(): JSONObject
    fun caps(): JSONObject
  }
  interface Io {
    val server: String; val userId: String; val token: String; val deviceId: String
    /** Blocking GET of an Emby path ({userId} filled in). Throws when it fails. */
    fun get(path: String): Any
    /** Blocking POST; the answer as JSON, or null when there is none. Throws when it fails. */
    fun post(path: String, body: JSONObject?): Any?
    /** A setting from the Settings page (with its default). */
    fun pref(key: String): String
    fun load(key: String): String?
    fun save(key: String, value: String)
    fun bg(work: () -> Unit)
    fun ui(work: () -> Unit)
    /** Run on the main thread after `ms`; the returned call cancels it. */
    fun later(ms: Long, work: () -> Unit): () -> Unit
    fun sleep(ms: Long) { Thread.sleep(ms) }
    fun now(): Long
    /** The state for the controls (the same fields the page's player sent). */
    fun push(snap: JSONObject)
    fun toast(msg: String, error: Boolean = false)
    /** The player closed: screens showing watched marks and resume bars are out of date. */
    fun closed()
    fun soundThrough(on: Boolean) {}
    fun details(): String = ""
    fun log(msg: String) {}
  }

  private class Now(val itemId: String, val sourceId: String, val sessionId: String, val method: String, var ticks: Long) {
    var paused = false; var started = false
    val subs = JSONArray()
  }

  // ---------- state ----------
  var open = false; private set
  var item: JSONObject? = null; private set
  private var next: JSONObject? = null
  private var pos = 0.0; private var posAt = 0L
  private var duration = 0.0
  private var paused = false; private var buffering = true
  private var speed = 1.0
  private var starting = false
  private var seq = -1; private var loadedSeq = -1; private var endedSeq = -1
  private var frameSeen = false
  private var subScale = "1"; private var aspect = "auto"; private var quality = ""
  private var intro: DoubleArray? = null; private var credits: Double? = null
  private var creditsHandled = false; private var introDismissed = false
  private var skipMode = ""
  private var upMode = ""; private var upCount = 0; private var upCancel: (() -> Unit)? = null
  private var stillNext: JSONObject? = null
  private var autoChain = 0
  private var queue: List<String> = emptyList()
  private var now: Now? = null
  private var gen = 0
  private var pickCancel: (() -> Unit)? = null; private var qualityCancel: (() -> Unit)? = null
  private var tickCancel: (() -> Unit)? = null
  private var lastReport = 0L
  private var detailsOn = false
  private var canDl: Boolean? = null
  private var lastTracks = ""
  private var playMethod = ""

  private val picks = TrackPicks(object : TrackPicks.Io {
    override fun pref(key: String) = io.pref(key)
    override fun load(key: String) = io.load(key)
    override fun save(key: String, value: String) = io.save(key, value)
    override fun set(name: String, value: String) = eng.control("track", JSONObject().put("type", if (name == "aid") "audio" else "sub").put("id", value))
    override fun toast(msg: String) = io.toast(msg)
    override fun note(msg: String) = io.log(msg)
  })

  private fun str(o: JSONObject?, k: String): String = if (o == null || o.isNull(k)) "" else o.optString(k)
  private fun dur() = if (duration > 0) duration else (item?.optDouble("RunTimeTicks", 0.0)?.takeIf { !it.isNaN() } ?: 0.0) / 1e7
  private fun mark() { posAt = io.now() }
  private fun livePos(): Double {
    if (paused || buffering || !frameSeen || starting) return pos
    val p = pos + minOf(1.0, (io.now() - posAt) / 1000.0) * speed
    val d = dur()
    return if (d > 0) minOf(p, d) else p
  }
  private fun skipBack() = io.pref("skipBack").toIntOrNull() ?: 10
  private fun skipFwd() = io.pref("skipFwd").toIntOrNull() ?: 10

  // ---------- starting ----------

  /** A collection's films played in a row (Play all / Shuffle): Next and auto-play walk this list. */
  fun playQueue(ids: List<String>) {
    val list = ids.filter { it.isNotEmpty() }
    if (list.isEmpty()) return
    queue = list
    autoChain = 0
    start(list[0], fromStart = true, queued = true)
  }

  fun start(id: String, fromStart: Boolean = false, startSecs: Double? = null, keepItem: Boolean = false, queued: Boolean = false) {
    if (starting) return
    // Starting something that isn't in the running queue ends the queue.
    if (!queued && id !in queue) queue = emptyList()
    starting = true
    val my = ++gen
    io.soundThrough(io.pref("tvSoundThrough") == "on")
    hideUpNext(); skipMode = ""
    if (!keepItem) { item = null; next = null; intro = null; credits = null; aspect = "auto" }
    pos = startSecs ?: 0.0; mark(); duration = 0.0; buffering = true; frameSeen = false
    subScale = io.pref("subScale").ifEmpty { "1" }; quality = io.pref("quality")
    picks.reset(null); lastTracks = ""
    pickCancel?.invoke(); pickCancel = null
    creditsHandled = false; introDismissed = false
    stillNext = null
    open = true
    if (!ticking) { ticking = true; tickCancel = io.later(250) { tick() } }
    push()
    val maxBitrate = quality.toLongOrNull()
    io.bg {
      try {
        val it = io.get("/Users/{userId}/Items/$id?Fields=Chapters") as JSONObject
        // The player seeks to the start point itself, so the stream always starts at 0 and
        // positions stay true to the file even when Emby converts it.
        val target = playbackTarget(id, maxBitrate)
        val ticks = if (startSecs != null) (startSecs * 1e7).toLong() else if (fromStart) 0L else it.optJSONObject("UserData")?.optLong("PlaybackPositionTicks") ?: 0L
        io.ui {
          if (my != gen) return@ui
          // Save the resume point of whatever was playing before.
          finishCurrent()
          val np = Now(id, target.getString("sourceId"), target.getString("sessionId"), target.getString("method"), ticks)
          val subs = target.getJSONArray("subs")
          for (i in 0 until subs.length()) np.subs.put(subs.getJSONObject(i))
          now = np
          seq = eng.open(target.getString("url"), if (ticks > 10_000_000L) ticks / 1e7 else 0.0, np.subs)
          item = it
          playMethod = np.method
          picks.key = str(it, "SeriesId").ifEmpty { str(it, "Id") }
          picks.setDefaults(target.optJSONObject("defaults"), np.method)
          readMarkers(it)
          if (!keepItem) findNext(it)
          starting = false
          push()
        }
      } catch (e: Throwable) {
        io.ui {
          if (my != gen) return@ui
          io.toast(e.message ?: e.toString(), true)
          starting = false
          if (item == null) exit() else push()
        }
      }
    }
  }

  /** "mpv can play basically anything" on the PC; on the TV, only what the TV's own player handles. */
  private fun deviceProfile(maxBitrate: Long): JSONObject {
    val subs = JSONArray()
    for (f in listOf("srt", "subrip", "ass", "ssa", "vtt", "webvtt", "sub", "smi", "ttml")) subs.put(JSONObject().put("Format", f).put("Method", "External"))
    for (f in listOf("srt", "subrip", "ass", "ssa", "vtt", "webvtt", "pgs", "pgssub", "dvdsub", "dvbsub", "vobsub", "mov_text")) subs.put(JSONObject().put("Format", f).put("Method", "Embed"))
    val caps = try { eng.caps() } catch (_: Throwable) { JSONObject() }
    fun join(k: String, fallback: String): String { val a = caps.optJSONArray(k) ?: return fallback; return List(a.length()) { a.optString(it) }.filter { it.isNotEmpty() }.joinToString(",").ifEmpty { fallback } }
    val video = join("video", "h264,hevc")
    val audio = join("audio", "aac,mp3,flac,opus,ac3,eac3")
    return JSONObject()
      .put("Name", "Scrappy (Google TV)")
      .put("MaxStreamingBitrate", maxBitrate).put("MaxStaticBitrate", maxBitrate)
      .put("MusicStreamingTranscodingBitrate", 320000)
      .put("DirectPlayProfiles", JSONArray()
        .put(JSONObject().put("Type", "Video").put("Container", "mp4,m4v,mkv,webm,mov,ts,mpegts").put("VideoCodec", video).put("AudioCodec", audio))
        .put(JSONObject().put("Type", "Audio").put("Container", "flac,mp3,aac,m4a,ogg,opus,wav,alac").put("AudioCodec", audio)))
      .put("TranscodingProfiles", JSONArray().put(JSONObject().put("Container", "ts").put("Type", "Video").put("VideoCodec", "h264,hevc")
        .put("AudioCodec", if (audio.contains("eac3")) "aac,ac3,eac3" else if (audio.contains("ac3")) "aac,ac3" else "aac")
        .put("Context", "Streaming").put("Protocol", "hls").put("MaxAudioChannels", "8").put("BreakOnNonKeyFrames", true)))
      .put("ContainerProfiles", JSONArray()).put("CodecProfiles", JSONArray())
      .put("SubtitleProfiles", subs).put("ResponseProfiles", JSONArray())
  }

  /** Ask Emby how to play an item: {url, subs, method, sourceId, sessionId, defaults}. Blocking. */
  private fun playbackTarget(id: String, maxBitrate: Long?): JSONObject {
    // No limit = "Original": direct play whenever possible. A limit = a lower quality was picked, so Emby converts.
    val capped = maxBitrate != null
    val max = maxBitrate ?: 200_000_000L
    var path = "/Items/$id/PlaybackInfo?UserId=${io.userId}&StartTimeTicks=0&IsPlayback=true&AutoOpenLiveStream=true&MaxStreamingBitrate=$max"
    if (capped) path += "&EnableDirectPlay=false&EnableDirectStream=false"
    val info = io.post(path, JSONObject().put("DeviceProfile", deviceProfile(max))) as? JSONObject ?: throw IllegalStateException("Emby returned no playable version of this item.")
    str(info, "ErrorCode").takeIf { it.isNotEmpty() }?.let { throw IllegalStateException("Emby can't play this item ($it).") }
    val sessionId = str(info, "PlaySessionId")
    val source = info.optJSONArray("MediaSources")?.optJSONObject(0) ?: throw IllegalStateException("Emby returned no playable version of this item.")
    val sourceId = str(source, "Id")
    val streams = source.optJSONArray("MediaStreams")?.let { a -> List(a.length()) { a.optJSONObject(it) }.filterNotNull() } ?: emptyList()
    // Subtitle files that sit next to the video on the server.
    val subs = JSONArray()
    for (st in streams) {
      if (str(st, "Type") != "Subtitle" || !st.optBoolean("IsExternal")) continue
      val rel = str(st, "DeliveryUrl").takeIf { it.isNotEmpty() } ?: continue
      var url = if (rel.startsWith("http")) rel else io.server + rel
      if (!url.contains("api_key=")) url += (if (url.contains('?')) "&" else "?") + "api_key=" + io.token
      subs.put(JSONObject().put("url", url).put("title", str(st, "DisplayTitle").ifEmpty { str(st, "Title").ifEmpty { "External" } }).put("lang", str(st, "Language")))
    }
    // What Emby itself would pick for this user.
    fun describe(key: String, kind: String): Any {
      if (!source.has(key) || source.isNull(key)) return JSONObject.NULL
      val i = source.optInt(key, -1)
      if (i < 0) return JSONObject.NULL
      val st = streams.firstOrNull { it.optInt("Index", -1) == i && str(it, "Type") == kind } ?: return JSONObject.NULL
      return JSONObject().put("index", i).put("lang", str(st, "Language")).put("title", str(st, "Title")).put("displayTitle", str(st, "DisplayTitle"))
        .put("forced", st.optBoolean("IsForced")).put("external", st.optBoolean("IsExternal"))
    }
    val defaults = JSONObject().put("audio", describe("DefaultAudioStreamIndex", "Audio")).put("sub", describe("DefaultSubtitleStreamIndex", "Subtitle"))
      .put("subKnown", source.has("DefaultSubtitleStreamIndex"))
    val out = JSONObject().put("subs", subs).put("sourceId", sourceId).put("sessionId", sessionId).put("defaults", defaults)
    val direct = !capped && (source.optBoolean("SupportsDirectPlay") || source.optBoolean("SupportsDirectStream"))
    // Remote items (e.g. .strm files pointing to a URL) are played straight from their URL.
    if (direct && source.optBoolean("IsRemote") && str(source, "Protocol") == "Http" && str(source, "Path").isNotEmpty())
      return out.put("url", str(source, "Path")).put("method", "DirectPlay")
    if (direct) {
      val container = str(source, "Container").split(',')[0].ifEmpty { "mkv" }
      return out.put("url", "${io.server}/Videos/$id/stream.$container?Static=true&MediaSourceId=$sourceId&DeviceId=${io.deviceId}&PlaySessionId=$sessionId&api_key=${io.token}").put("method", "DirectStream")
    }
    val t = str(source, "TranscodingUrl")
    if (t.isNotEmpty()) {
      var url = io.server + t
      if (!url.contains("api_key=")) url += "&api_key=" + io.token
      return out.put("url", url).put("method", "Transcode")
    }
    throw IllegalStateException("Emby didn't offer a way to play this item.")
  }

  // ---------- telling Emby ----------

  private fun reportBody(np: Now, event: String?): JSONObject {
    val v = JSONObject().put("ItemId", np.itemId).put("MediaSourceId", np.sourceId).put("PlaySessionId", np.sessionId).put("PlayMethod", np.method)
      .put("PositionTicks", np.ticks).put("IsPaused", np.paused).put("CanSeek", true).put("QueueableMediaTypes", JSONArray().put("Video"))
    if (event != null) v.put("EventName", event)
    return v
  }
  private fun report(path: String, body: JSONObject) = io.bg { try { io.post(path, body) } catch (_: Throwable) {} }

  /** Tell Emby the current item stopped (saves the resume point) and forget it. */
  private fun finishCurrent(): Boolean {
    val np = now ?: return false
    now = null
    if (np.started) report("/Sessions/Playing/Stopped", reportBody(np, null))
    return true
  }

  // ---------- the player's state, four times a second ----------

  private var ticking = false
  private fun tick() {
    tickCancel = null
    if (!open) { ticking = false; return }
    try { poll() } catch (e: Throwable) { io.log("player tick: $e") }
    if (open && ticking && tickCancel == null) tickCancel = io.later(250) { tick() } else if (!open) ticking = false
  }

  private fun poll() {
    val s = eng.state()
    val sq = s.optInt("seq")
    val np = now
    if (np != null && sq == seq) {
      val err = str(s, "error")
      if (err.isNotEmpty()) {
        if (endedSeq != sq) { endedSeq = sq; now = null; io.toast(err, true); exit() }
        return
      }
      if (sq > 0 && s.optInt("ready") == sq && loadedSeq != sq) { loadedSeq = sq; loaded(np) }
      if (s.has("pos")) {
        val p = s.optDouble("pos", 0.0)
        if (p != pos || !frameSeen) { pos = p; mark(); np.ticks = (p * 1e7).toLong(); if (loadedSeq == sq) frameSeen = true; checkMarkers() }
      }
      if (s.has("dur")) duration = s.optDouble("dur", 0.0)
      if (s.has("paused")) {
        val pz = s.optBoolean("paused")
        if (pz != paused || pz != np.paused) {
          pos = livePos(); mark(); paused = pz
          if (pz != np.paused) { np.paused = pz; if (np.started) { lastReport = io.now(); report("/Sessions/Playing/Progress", reportBody(np, if (pz) "Pause" else "Unpause")) } }
        }
      }
      if (s.has("buffering")) { val b = s.optBoolean("buffering"); if (b != buffering) { pos = livePos(); mark(); buffering = b } }
      if (s.has("speed")) { val v = Math.round(s.optDouble("speed", 1.0) * 100) / 100.0; if (v != speed) { pos = livePos(); mark(); speed = v } }
      val tr = s.optJSONArray("tracks")
      if (tr != null) { val txt = tr.toString(); if (txt != lastTracks) { lastTracks = txt; picks.onTracks(List(tr.length()) { tr.getJSONObject(it) }) } }
      // Every 10 seconds, tell Emby where we are (so resume works elsewhere).
      if (np.started && !np.paused && io.now() - lastReport >= 10_000) { lastReport = io.now(); report("/Sessions/Playing/Progress", reportBody(np, "TimeUpdate")) }
      if (s.optBoolean("ended") && endedSeq != sq && loadedSeq == sq) { endedSeq = sq; ended() }
    }
    push()
  }

  private fun loaded(np: Now) {
    np.started = true
    lastReport = io.now()
    report("/Sessions/Playing", reportBody(np, null))
    frameSeen = false
    buffering = false
    eng.control("subScale", JSONObject().put("value", subScale.toDoubleOrNull() ?: 1.0))
    eng.control("subDelay", JSONObject().put("value", subDelayOf(np.itemId)))
    applyAspect()
    showSpeed()?.let { eng.control("speed", JSONObject().put("value", it)) }
    picks.pickTracks(); picks.holdSubs()
    // Keep a lookout for late subtitle tracks, then stop looking (the choice stays held).
    pickCancel?.invoke()
    pickCancel = io.later(10_000) { pickCancel = null; picks.finish() }
    if (canDl == null) checkSubRights()
  }

  private fun ended() {
    // Played to the end.
    if (!finishCurrent()) return
    if (starting) return
    val autoplay = io.pref("autoplay") != "off"
    if (next != null && (autoplay || upMode == "credits")) { if (upMode != "credits") showUpNext("end"); return }
    exit()
  }

  fun exit() {
    hideUpNext()
    gen++
    starting = false
    finishCurrent()
    eng.control("stop")
    val was = open
    open = false; frameSeen = false
    skipMode = ""; stillNext = null; detailsOn = false
    pickCancel?.invoke(); pickCancel = null
    qualityCancel?.invoke(); qualityCancel = null
    tickCancel?.invoke(); tickCancel = null; ticking = false
    eng.control("subPos", JSONObject().put("value", 100))
    push()
    if (was) io.closed()
  }

  // ---------- next episode ----------

  /** Find the episode after this one (or the next film of the queue), for Next / auto-play. */
  private fun findNext(it: JSONObject) {
    val id = str(it, "Id")
    val qi = queue.indexOf(id)
    val series = str(it, "SeriesId")
    if (qi < 0 && (str(it, "Type") != "Episode" || series.isEmpty())) return
    val nid = if (qi >= 0) queue.getOrNull(qi + 1) ?: return else null
    io.bg {
      val n: JSONObject? = try {
        if (nid != null) io.get("/Users/{userId}/Items/$nid") as? JSONObject
        else {
          val items = Net.items(io.get("/Shows/$series/Episodes?UserId={userId}&StartItemId=$id&Limit=2&Fields=PrimaryImageAspectRatio"))
          if (items.isNotEmpty() && str(items[0], "Id") == id) items.getOrNull(1)
          else {
            // Older servers ignore StartItemId: fall back to the full list.
            val all = Net.items(io.get("/Shows/$series/Episodes?UserId={userId}"))
            val i = all.indexOfFirst { e -> str(e, "Id") == id }
            if (i >= 0) all.getOrNull(i + 1) else null
          }
        }
      } catch (_: Throwable) { null }
      io.ui { if (str(item, "Id") == id) { next = n; push() } }
    }
  }

  private fun epCode(it: JSONObject) = if (it.isNull("ParentIndexNumber") || it.isNull("IndexNumber") || !it.has("ParentIndexNumber") || !it.has("IndexNumber")) "" else "S${it.optInt("ParentIndexNumber")}:E${it.optInt("IndexNumber")}"
  private fun runtime(ticks: Double): String {
    if (ticks.isNaN() || ticks <= 0) return ""
    val min = Math.round(ticks / 600000000.0)
    val h = min / 60
    return if (h > 0) "${h}h ${min % 60}m" else "${min}m"
  }

  /** mode "credits": the credits started (second button = Watch credits). "end": the episode finished (Cancel). */
  private fun showUpNext(mode: String): Boolean {
    if (next == null) return false
    hideUpNext()
    upMode = mode
    upCount = io.pref("upNextSecs").toIntOrNull()?.takeIf { it > 0 } ?: 10
    fun step() { upCancel = io.later(1000) { upCount--; if (upCount <= 0) playNext(true) else { push(); step() } } }
    step()
    push()
    return true
  }
  private fun hideUpNext() { upCancel?.invoke(); upCancel = null; upMode = "" }

  /** auto: started by the countdown rather than by you. */
  private fun playNext(auto: Boolean = false) {
    val n = next
    hideUpNext()
    if (n == null) return
    if (auto) {
      autoChain++
      if (autoChain > (io.pref("stillWatching").toIntOrNull() ?: 3)) { showStill(n); return }
    } else autoChain = 0
    start(str(n, "Id"), fromStart = true)
  }

  private fun showStill(n: JSONObject) { stillNext = n; eng.control("pause", JSONObject().put("on", true)); push() }

  /** Any press of the remote in the player means someone is there. */
  fun someoneThere() { if (open && stillNext == null) autoChain = 0 }

  // ---------- Skip intro / credits ----------

  private fun readMarkers(it: JSONObject) {
    val ch = it.optJSONArray("Chapters")
    fun at(type: String): Double? { if (ch == null) return null; for (i in 0 until ch.length()) { val c = ch.optJSONObject(i) ?: continue; if (str(c, "MarkerType") == type && c.has("StartPositionTicks") && !c.isNull("StartPositionTicks")) return c.optDouble("StartPositionTicks") }; return null }
    val s = at("IntroStart"); val e = at("IntroEnd"); val cs = at("CreditsStart")
    intro = if (s != null && e != null && e > s) doubleArrayOf(s / 1e7, e / 1e7) else null
    credits = cs?.let { it / 1e7 }
  }

  private fun checkMarkers() {
    if (!open || starting) return
    val p = pos
    val i = intro
    if (i != null && p >= i[0] && p < i[1] - 1 && !introDismissed && io.pref("skipIntro") == "on") {
      // Settings: skip intros by themselves (once; seeking back into it lets it play).
      introDismissed = true
      seekTo(i[1])
      io.toast("Skipped the intro")
    } else if (i != null && p >= i[0] && p < i[1] - 1 && !introDismissed) skipMode = "intro"
    else if (skipMode == "intro") skipMode = ""
    if (i != null && p < i[0]) introDismissed = false
    // Credits. Many episodes have no credits marker from Emby, so then Up next shows for the last
    // 40 seconds of an episode instead.
    val d = dur()
    val guess = if (credits == null && next != null && str(item, "Type") == "Episode" && d > 300) d - 40 else null
    val cs = credits ?: guess ?: return
    if (p < cs - 2 && creditsHandled) {
      // Jumped back before the credits: reset.
      creditsHandled = false
      if (upMode == "credits") hideUpNext()
      if (skipMode == "credits") skipMode = ""
    }
    if (p >= cs && !creditsHandled) {
      creditsHandled = true
      val autoplay = io.pref("autoplay") != "off"
      // Settings: skip credits straight to the next episode, only on Emby's own credits marker.
      if (next != null && credits != null && io.pref("skipCredits") == "on") playNext(true)
      else if (next != null && autoplay) showUpNext("credits")
      else skipMode = "credits"
    }
  }

  private fun doSkip() {
    val i = intro
    if (skipMode == "intro" && i != null) { seekTo(i[1]); introDismissed = true; skipMode = "" }
    else if (skipMode == "credits") { skipMode = ""; if (next != null) playNext() else exit() }
  }

  private fun seekTo(t: Double) { eng.control("seek", JSONObject().put("value", Math.round(t * 100) / 100.0).put("relative", false)); pos = t; mark() }

  // ---------- remembered per show / per video ----------

  private fun showKey() = item?.let { "show:" + str(it, "SeriesId").ifEmpty { str(it, "Id") } }
  private fun showSpeed(): Double? = showKey()?.let { io.load(it) }?.let { try { JSONObject(it).optDouble("speed", 0.0).takeIf { v -> !v.isNaN() && v > 0 } } catch (_: Throwable) { null } }
  private fun setSpeed(v: Double) {
    speed = v
    eng.control("speed", JSONObject().put("value", v))
    val k = showKey() ?: return
    val o = io.load(k)?.let { try { JSONObject(it) } catch (_: Throwable) { null } } ?: JSONObject()
    io.save(k, o.put("speed", v).toString())
  }

  /** Subtitle timing (approved mock "Subtitle timing"): seconds, + = later. Kept per video, last 60 videos. */
  private fun subDelays(): JSONObject = try { JSONObject(io.load("subDelays") ?: "{}") } catch (_: Throwable) { JSONObject() }
  private fun subDelayOf(id: String?): Double = if (id.isNullOrEmpty()) 0.0 else subDelays().optDouble(id, 0.0).let { if (it.isNaN()) 0.0 else it }
  private fun setSubDelay(id: String?, d0: Double) {
    val d = (Math.round(d0 * 4) / 4.0).coerceIn(-10.0, 10.0)
    eng.control("subDelay", JSONObject().put("value", d))
    if (id.isNullOrEmpty()) return
    // Kept in the order they were set (the list keeps its order), so the oldest fall off first.
    val m = subDelays()
    m.remove(id)
    if (d != 0.0) m.put(id, d)
    val keys = m.keys().asSequence().toList()
    for (k in keys.take(maxOf(0, keys.size - 60))) m.remove(k)
    io.save("subDelays", m.toString())
  }

  private fun applyAspect() = eng.control("aspect", JSONObject().put("value", when (aspect) { "stretch" -> "stretch"; "fill" -> "fill"; else -> "fit" }))

  // ---------- downloading subtitles ----------

  private class Dl { var item = ""; var lang = ""; var state = "idle"; var msg = ""; var list: List<JSONObject> = emptyList(); var busy = -1; var got = -1; var run = 0 }
  private val dl = Dl()

  /** Only accounts allowed to manage or download subtitles get the Download row. */
  private fun checkSubRights() {
    io.bg {
      val ok = try { (io.get("/Users/{userId}") as JSONObject).optJSONObject("Policy")?.let { p -> p.optBoolean("IsAdministrator") || p.optBoolean("EnableSubtitleManagement") || p.optBoolean("EnableSubtitleDownloading") } ?: false } catch (_: Throwable) { false }
      io.ui { canDl = ok; push() }
    }
  }
  /** Someone else signed in: their rights are asked again. */
  fun signedInChanged() { canDl = null }

  private fun dlSnap(): JSONObject {
    val id = str(item, "Id")
    if (dl.item != id) { dl.item = id; dl.state = "idle"; dl.msg = ""; dl.list = emptyList(); dl.busy = -1; dl.got = -1 }
    val rows = JSONArray()
    for (r in dl.list) rows.put(JSONObject().put("name", str(r, "Name").ifEmpty { str(r, "Id") })
      .put("note", listOf(str(r, "ProviderName"), str(r, "Format").uppercase(), r.optInt("DownloadCount").takeIf { it > 0 }?.let { "%,d downloads".format(Locale.US, it) } ?: "").filter { it.isNotEmpty() }.joinToString(" · "))
      .put("match", r.optBoolean("IsHashMatch")))
    return JSONObject().put("lang", dl.lang.ifEmpty { io.load("subSearchLang") ?: "eng" }).put("state", dl.state).put("msg", dl.msg).put("busy", dl.busy).put("got", dl.got).put("rows", rows)
  }

  private fun dlSearch(code: String) {
    val it = item ?: return
    if (code.isEmpty()) return
    val id = str(it, "Id")
    io.save("subSearchLang", code)
    val run = ++dl.run
    dl.item = id; dl.lang = code; dl.state = "searching"; dl.msg = ""; dl.list = emptyList(); dl.busy = -1; dl.got = -1
    push()
    io.bg {
      val res = try { io.get("/Items/$id/RemoteSearch/Subtitles/$code?IsPerfectMatch=false") } catch (e: Throwable) { e }
      io.ui {
        if (run != dl.run) return@ui
        if (res is Throwable) { dl.state = "err"; dl.msg = res.message ?: res.toString() }
        else {
          // Subtitles made for this exact file (hash match) go first.
          val a = res as? JSONArray
          val all = if (a == null) emptyList() else List(a.length()) { a.optJSONObject(it) }.filterNotNull()
          dl.list = (all.filter { r -> r.optBoolean("IsHashMatch") } + all.filter { r -> !r.optBoolean("IsHashMatch") }).take(30)
          dl.state = "ok"
        }
        push()
      }
    }
  }

  private fun subStreams(o: JSONObject?): List<JSONObject> {
    val a = o?.optJSONArray("MediaSources")?.optJSONObject(0)?.optJSONArray("MediaStreams") ?: o?.optJSONArray("MediaStreams") ?: return emptyList()
    return List(a.length()) { a.optJSONObject(it) }.filterNotNull().filter { str(it, "Type") == "Subtitle" }
  }

  private fun dlGet(i: Int) {
    val it = item ?: return
    val r = dl.list.getOrNull(i) ?: return
    if (dl.busy >= 0 || dl.got == i) return
    val run = dl.run
    val id = str(it, "Id"); val code = dl.lang
    dl.busy = i; dl.msg = ""; push()
    io.bg {
      var fail: String? = null
      var added: JSONObject? = null
      try {
        // What subtitles the server knows about before, so the new one can be spotted after.
        val before = subStreams(io.get("/Users/{userId}/Items/$id") as? JSONObject).map { s -> s.optInt("Index") }.toSet()
        io.post("/Items/$id/RemoteSearch/Subtitles/" + java.net.URLEncoder.encode(str(r, "Id"), "UTF-8").replace("+", "%20"), null)
        // The server can take a moment to list the new file.
        var n = 0
        while (n < 8 && added == null) {
          io.sleep(if (n > 0) 1500 else 600)
          val fresh = try { io.get("/Users/{userId}/Items/$id") as? JSONObject } catch (_: Throwable) { null }
          added = subStreams(fresh).firstOrNull { s -> s.optBoolean("IsExternal") && s.optInt("Index") !in before }
          n++
        }
        if (added == null) fail = "Downloaded, but the server hasn't listed the new subtitles yet. Try reopening the video in a moment."
      } catch (e: Throwable) { fail = e.message ?: e.toString() }
      io.ui {
        val np = now
        if (str(item, "Id") != id || np == null) return@ui // moved on to another video meanwhile
        val a = added
        if (a != null) {
          val title = str(a, "DisplayTitle").ifEmpty { str(a, "Title").ifEmpty { "Downloaded" } }
          val lang = str(a, "Language").ifEmpty { code }
          val fmt = when (val c = str(a, "Codec").ifEmpty { str(r, "Format").ifEmpty { "srt" } }.lowercase()) { "ass", "ssa" -> c; "vtt", "webvtt" -> "vtt"; else -> "srt" }
          val url = "${io.server}/Videos/${np.itemId}/${np.sourceId}/Subtitles/${a.optInt("Index")}/Stream.$fmt?api_key=${io.token}"
          // Also add it again if the same video gets reloaded.
          np.subs.put(JSONObject().put("url", url).put("title", title).put("lang", lang))
          picks.downloaded(lang, title)
          eng.control("addSub", JSONObject().put("url", url).put("title", title).put("lang", lang))
        }
        if (run != dl.run) return@ui
        dl.busy = -1
        if (a != null) dl.got = i else dl.msg = fail ?: ""
        push()
      }
    }
  }

  // ---------- what the controls ask for ----------

  fun act(a: String, v: String = "") {
    when (a) {
      "pause" -> { eng.control("toggle"); if (open && !starting) { pos = livePos(); mark(); paused = !paused } }
      "seek" -> seekTo(maxOf(0.0, v.toDoubleOrNull() ?: 0.0))
      "next" -> if (next != null) playNext()
      "sub" -> picks.chooseSub(v)
      "audio" -> picks.chooseAudio(v)
      "cc" -> picks.toggleSubs()
      "speed" -> setSpeed(v.toDoubleOrNull()?.takeIf { it > 0 } ?: 1.0)
      "size" -> { val i = SUB_SIZES.indexOfFirst { it.first == subScale }; subScale = SUB_SIZES[(i + 1) % SUB_SIZES.size].first; io.save("subScale", subScale); eng.control("subScale", JSONObject().put("value", subScale.toDouble())) }
      "shape" -> { val i = ASPECTS.indexOfFirst { it.first == aspect }; aspect = ASPECTS[(i + 1) % ASPECTS.size].first; applyAspect() }
      "quality" -> {
        val i = QUALITIES.indexOfFirst { it.first == quality }; quality = QUALITIES[(i + 1) % QUALITIES.size].first; io.save("quality", quality)
        // Reload the same video at the current spot with the new quality (once you stop pressing).
        qualityCancel?.invoke()
        qualityCancel = io.later(1500) { qualityCancel = null; item?.let { start(str(it, "Id"), startSecs = livePos(), keepItem = true) } }
      }
      "reload" -> item?.let {
        // Start the same video again where it is, on a brand new player.
        val at = maxOf(0.0, livePos() - 2)
        io.toast("Reloading the video…")
        eng.control("reset")
        starting = false
        start(str(it, "Id"), startSecs = at, keepItem = true)
      }
      "details" -> detailsOn = !detailsOn
      "dlsearch" -> dlSearch(v)
      "dlget" -> dlGet(v.toIntOrNull() ?: -1)
      "skip" -> doSkip()
      "exit" -> exit()
      "subdelay" -> setSubDelay(str(item, "Id"), v.toDoubleOrNull() ?: 0.0)
      "subpos" -> eng.control("subPos", JSONObject().put("value", Math.round(v.toDoubleOrNull() ?: 100.0)))
      "ep" -> if (v.isNotEmpty() && v != str(item, "Id")) { autoChain = 0; start(v) }
      // The Up next card.
      "up-now" -> playNext()
      "up-cancel" -> if (upMode == "credits") hideUpNext() else { hideUpNext(); exit() }
      // "Are you still watching?"
      "still-yes" -> { val n = stillNext; autoChain = 0; stillNext = null; if (n != null) start(str(n, "Id"), fromStart = true) }
      "still-no" -> { stillNext = null; exit() }
    }
    push()
  }

  // ---------- the state for the controls ----------

  private var lastSnap = ""
  private fun push() {
    val s = snap()
    val txt = s.toString()
    if (txt == lastSnap) return
    lastSnap = txt
    io.push(s)
  }

  fun snap(): JSONObject {
    val it = item
    val isEp = str(it, "Type") == "Episode"
    fun lab(list: List<Pair<String, String>>, v: String) = list.firstOrNull { it.first == v }?.second ?: ""
    val n = next
    val o = JSONObject()
      .put("open", open).put("id", str(it, "Id")).put("series", str(it, "SeriesId")).put("season", str(it, "SeasonId")).put("isEp", isEp)
      .put("t1", if (it == null) "Loading…" else if (isEp) str(it, "SeriesName").ifEmpty { str(it, "Name") } else str(it, "Name"))
      .put("t2", if (it == null) "" else if (isEp) listOf(epCode(it), str(it, "Name")).filter { x -> x.isNotEmpty() }.joinToString(" · ")
        else listOf(it.optInt("ProductionYear").takeIf { y -> y > 0 }?.toString() ?: "", str(it, "OfficialRating")).filter { x -> x.isNotEmpty() }.joinToString(" · "))
      .put("ov", str(it, "Overview")).put("dur", dur())
      .put("next", if (n == null) "" else listOf(if (n.has("IndexNumber") && !n.isNull("IndexNumber")) "${n.optInt("IndexNumber")}." else "", str(n, "Name")).filter { x -> x.isNotEmpty() }.joinToString(" "))
      .put("subs", picks.subsList()).put("subOn", picks.sid != null).put("audio", picks.audioList()).put("speed", speed).put("subDelay", subDelayOf(str(it, "Id")))
      .put("size", lab(SUB_SIZES, subScale)).put("shape", lab(ASPECTS, aspect)).put("quality", lab(QUALITIES, quality))
      .put("skip", skipMode).put("back", skipBack()).put("fwd", skipFwd()).put("canDl", canDl != false && it != null).put("dl", dlSnap())
      .put("card", false).put("details", detailsOn)
    if (detailsOn) o.put("detailsText", "Player details (open the cog and press Player details again to close)\n$playMethod  ${str(it, "Name")}\n\n${io.details()}")
    if (upMode.isNotEmpty() && n != null) o.put("up", JSONObject().put("mode", upMode).put("count", upCount)
      .put("title", listOf(epCode(n), str(n, "Name")).filter { x -> x.isNotEmpty() }.joinToString(" · ")).put("meta", runtime(n.optDouble("RunTimeTicks", 0.0)))
      .put("thumb", n.optJSONObject("ImageTags")?.optString("Primary")?.takeIf { t -> t.isNotEmpty() }?.let { t -> "${io.server}/Items/${str(n, "Id")}/Images/Primary?maxWidth=320&quality=90&tag=$t" } ?: "")
      .put("now", if (str(n, "Type") == "Episode") "Next episode" else "Next film").put("cancel", if (upMode == "credits") "Watch credits" else "Cancel"))
    stillNext?.let { sn -> o.put("still", listOf(str(sn, "SeriesName"), epCode(sn), str(sn, "Name")).filter { x -> x.isNotEmpty() }.joinToString(" · ")) }
    return o
  }

  companion object {
    val SUB_SIZES = listOf("0.8" to "Small", "1" to "Medium", "1.25" to "Large", "1.5" to "Extra large")
    val ASPECTS = listOf("auto" to "Auto", "16:9" to "16:9", "4:3" to "4:3", "2.35:1" to "2.35:1", "fill" to "Fill screen", "stretch" to "Stretch")
    val QUALITIES = listOf("" to "Original (direct play)", "40000000" to "40 Mbps · 4K", "20000000" to "20 Mbps · 1080p", "10000000" to "10 Mbps · 1080p",
      "6000000" to "6 Mbps · 720p", "3000000" to "3 Mbps · 720p", "1500000" to "1.5 Mbps · 480p")
  }
}
