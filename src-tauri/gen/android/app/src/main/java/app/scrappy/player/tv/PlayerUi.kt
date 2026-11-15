package app.scrappy.player.tv

import android.content.Context
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/** What the player controls need from the rest of the app. The page does the work; `act` names it. */
interface PlayerHost {
  fun act(action: String, value: String = "")
  /** Where the video is: position and length in seconds, paused, waiting for data. Null when there is no player. */
  fun clock(): DoubleArray?
  fun log(msg: String) {}
}

/**
 * Scrappy Native's player controls (approved mock "Native TV player v2"), drawn over the video.
 * Nothing shows while you watch. OK pauses, Left/Right skip, Up/Down bring the bar up.
 * The bar: time bar, -10 / play / +10, Ends at, then Next episode, CC (Subtitles menu), Audio menu,
 * Speed menu and the cog (Settings menu). Down from the bar pops the season's episodes up under it.
 * Paused for 5 seconds: the big "You're watching" screen.
 */
class PlayerUi(ctx: Context, private val host: PlayerHost) : View(ctx) {
  init { Ui.init(ctx); isFocusable = false }
  private val h = android.os.Handler(android.os.Looper.getMainLooper())

  // ---------- what the page tells us ----------
  private var snap = JSONObject()
  var open = false; private set
  /** Something from the page is on top (Up next, Still watching, Download subtitles): it takes the remote. */
  var card = false; private set

  fun state(j: JSONObject) {
    val wasOpen = open
    val oldId = snap.optString("id")
    snap = j
    open = j.optBoolean("open")
    card = j.optBoolean("card")
    if (open && !wasOpen) start()
    if (!open && wasOpen) stop()
    if (open && oldId != j.optString("id") && oldId.isNotEmpty()) { closeMenus(); epsOpen = false; seasons = emptyList(); episodes = emptyList(); epsFor = "" }
    if (mode == Mode.POP && pop == "dl") dlState()
    else if (mode == Mode.POP && pop.isNotEmpty()) { rows = rowsFor(); popIdx = popIdx.coerceIn(0, max(0, rows.size - 1)) }
    visibility = if (open) VISIBLE else GONE
    invalidate()
  }

  // ---------- what is showing ----------
  private enum class Mode { IDLE, BAR, EPS, POP }
  private var mode = Mode.BAR
  private var focus = "play"
  private var lastKey = 0L
  private var pop = ""
  private var subLevel = 0
  private var popIdx = 0
  private var opener = "cc"
  private var rows: List<Row> = emptyList()
  private var epsOpen = false
  private var pausedSince = 0L
  private var pinfo = false

  private val vis = Anim(1f)      // controls shown 0..1
  private val epsA = Anim(0f)     // episodes popped up 0..1
  private val popA = Anim(0f)     // a menu open 0..1
  private val pinfoA = Anim(0f)   // paused screen 0..1
  private val focusA = HashMap<String, Anim>()

  private class Anim(var v: Float) {
    var to = v; private var from = v; private var at = 0L; var len = 220f
    fun set(t: Float, now: Long, ms: Float = 220f) { if (t == to) return; from = v; to = t; at = now; len = ms }
    fun step(now: Long): Boolean { if (v == to) return false; val k = ((now - at) / len).coerceIn(0f, 1f); v = from + (to - from) * Ui.ease(k); if (k >= 1f) v = to; return v != to }
  }

  private fun start() {
    mode = Mode.IDLE; focus = "play"; pop = ""; epsOpen = false; pinfo = false; pausedSince = 0L
    val now = SystemClock.uptimeMillis()
    vis.set(0f, now, 1f); vis.v = 0f; epsA.v = 0f; epsA.to = 0f; popA.v = 0f; popA.to = 0f; pinfoA.v = 0f; pinfoA.to = 0f
    seekTo = -1.0; liftedTo = -1
  }
  private fun stop() { h.removeCallbacks(seekRun); h.removeCallbacks(releaseRun); seekTo = -1.0 }

  // ---------- the clock ----------
  private var pos = 0.0
  private var dur = 0.0
  private var paused = false
  private var waiting = false
  private fun readClock() {
    val c = host.clock()
    if (c != null) { pos = c[0]; dur = if (c[1] > 1) c[1] else snap.optDouble("dur", 0.0); paused = c[2] > 0.5; waiting = c[3] > 0.5 }
    else dur = snap.optDouble("dur", 0.0)
    if (dur.isNaN()) dur = 0.0
  }

  // ---------- skipping: presses add up and the video makes ONE jump when you stop ----------
  private var seekTo = -1.0
  private var holdAt = 0L
  private var lastSkip = 0L
  private val seekRun = Runnable {
    val t = seekTo
    if (t >= 0) host.act("seek", "%.2f".format(java.util.Locale.US, t))
    h.postDelayed(releaseRun, 700)
  }
  private val releaseRun = Runnable { seekTo = -1.0; invalidate() }
  private fun skip(dir: Int, held: Boolean) {
    val now = SystemClock.uptimeMillis()
    val base = (if (dir < 0) snap.optInt("back", 10) else snap.optInt("fwd", 10)).toDouble()
    var step = base
    if (held && now - lastSkip < 600) {
      // Holding speeds up smoothly: about 15 s of video per second at first (precise), doubling every 1.5 s held,
      // up to a top speed that crosses the whole video in about 10 s (2-hour film: ~20 s from start to end).
      val heldFor = (now - holdAt) / 1000.0
      val top = max(300.0, dur / 10.0)
      val pace = min(top, 15.0 * Math.pow(2.0, heldFor / 1.5))
      step = pace * ((now - lastSkip) / 1000.0)
    } else holdAt = now
    lastSkip = now
    val from = if (seekTo >= 0) seekTo else pos
    val end = if (dur > 20) dur - 5 else Double.MAX_VALUE
    seekTo = (from + dir * step).coerceIn(0.0, end)
    h.removeCallbacks(seekRun); h.removeCallbacks(releaseRun)
    h.postDelayed(seekRun, 350)
    invalidate()
  }
  private fun shownPos() = if (seekTo >= 0) seekTo else pos

  // ---------- keys ----------
  /** The remote, while the controls own it. Returns true when used. */
  fun onKey(e: KeyEvent): Boolean {
    val k = when (e.keyCode) {
      KeyEvent.KEYCODE_DPAD_UP -> "up"; KeyEvent.KEYCODE_DPAD_DOWN -> "down"
      KeyEvent.KEYCODE_DPAD_LEFT -> "left"; KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
      KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "ok"
      KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> "back"
      KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> "pp"
      KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "ff"; KeyEvent.KEYCODE_MEDIA_REWIND -> "rw"
      KeyEvent.KEYCODE_MEDIA_NEXT -> "next"
      else -> return false
    }
    if (e.action != KeyEvent.ACTION_DOWN) return true
    if (k == "back" && e.repeatCount > 0) return true
    press(k, e.repeatCount > 0)
    return true
  }

  private val ROW = listOf("rew", "play", "fwd", "next", "cc", "audio", "speed", "cog")
  private fun rowShown(id: String) = when (id) { "next" -> snap.optString("next").isNotEmpty(); else -> true }
  private fun rowIds() = ROW.filter { rowShown(it) }

  private fun showBar(f: String = focus) { mode = Mode.BAR; focus = f }

  private fun press(k: String, held: Boolean) {
    val now = SystemClock.uptimeMillis()
    lastKey = now
    if (pinfo) { pinfo = false; if (k == "back") { showBar("play"); kick(); return } }
    when (k) {
      "pp" -> { host.act("pause"); if (mode == Mode.IDLE) showBar("play"); kick(); return }
      "ff", "rw" -> { if (mode == Mode.IDLE || mode == Mode.BAR) { showBar("seek"); skip(if (k == "ff") 1 else -1, held) }; kick(); return }
      "next" -> { if (snap.optString("next").isNotEmpty()) host.act("next"); return }
    }
    when (mode) {
      Mode.IDLE -> when (k) {
        "ok" -> { if (snap.optString("skip").isNotEmpty()) host.act("skip") else { host.act("pause"); showBar("play") } }
        "up", "down" -> showBar("play")
        "left", "right" -> { showBar("seek"); skip(if (k == "left") -1 else 1, held) }
        "back" -> host.act("exit")
      }
      Mode.BAR -> {
        if (k == "back") { if (paused) host.act("exit") else mode = Mode.IDLE; kick(); return }
        if (focus == "skipbtn") when (k) {
          "down" -> focus = "seek"
          "ok" -> { host.act("skip"); mode = Mode.IDLE; focus = "play" }
        } else if (focus == "seek") when (k) {
          "left", "right" -> skip(if (k == "left") -1 else 1, held)
          "up" -> if (snap.optString("skip").isNotEmpty()) focus = "skipbtn"
          "down" -> focus = "play"
          "ok" -> host.act("pause")
        } else {
          val ids = rowIds(); val i = ids.indexOf(focus).coerceAtLeast(0)
          when (k) {
            "left" -> focus = ids[max(0, i - 1)]
            "right" -> focus = ids[min(ids.size - 1, i + 1)]
            "up" -> focus = "seek"
            "down" -> if (snap.optBoolean("isEp") && snap.optString("series").isNotEmpty()) openEps()
            "ok" -> activate(focus)
          }
        }
      }
      Mode.EPS -> {
        if (k == "back") { mode = Mode.BAR; kick(); return }
        if (epsArea == 0) when (k) {
          "left" -> epIdx = max(0, epIdx - 1)
          "right" -> epIdx = min(episodes.size - 1, epIdx + 1)
          "up" -> if (seasons.size > 1) epsArea = 1 else mode = Mode.BAR
          "ok" -> episodes.getOrNull(epIdx)?.let { ep -> if (ep.id == snap.optString("id")) mode = Mode.BAR else { host.act("ep", ep.id); mode = Mode.IDLE } }
        } else when (k) {
          "left" -> if (seasonIdx > 0) loadEpisodes(seasonIdx - 1, true)
          "right" -> if (seasonIdx < seasons.size - 1) loadEpisodes(seasonIdx + 1, true)
          "down", "ok" -> epsArea = 0
          "up" -> mode = Mode.BAR
        }
      }
      Mode.POP -> {
        if (pop == "dl") { dlPress(k); kick(); return }
        if (k == "back" || (k == "left" && pop == "sub" && subLevel == 1)) {
          if (pop == "sub" && subLevel == 1) { subLevel = 0; rows = rowsFor(); popIdx = rows.indexOfFirst { it.kind == "other" }.coerceAtLeast(0) }
          else if (k == "back") closeMenus()
          kick(); return
        }
        when (k) {
          "up" -> popIdx = max(0, popIdx - 1)
          "down" -> popIdx = min(rows.size - 1, popIdx + 1)
          "ok" -> choose(popIdx)
          "right" -> if (rows.getOrNull(popIdx)?.kind == "other") choose(popIdx) else if (rows.getOrNull(popIdx)?.kind == "delay") nudge(0.25)
          "left" -> if (rows.getOrNull(popIdx)?.kind == "delay") nudge(-0.25)
        }
      }
    }
    kick()
  }

  private fun closeMenus() { if (mode == Mode.POP) { mode = Mode.BAR; focus = opener }; pop = ""; subLevel = 0 }

  private fun activate(id: String) {
    when (id) {
      "rew" -> skip(-1, false)
      "fwd" -> skip(1, false)
      "play" -> host.act("pause")
      "next" -> host.act("next")
      "cc" -> openPop("sub", id)
      "audio" -> openPop("audio", id)
      "speed" -> openPop("speed", id)
      "cog" -> openPop("set", id)
    }
  }

  // ---------- menus ----------
  private class Row(val label: String, val note: String = "", val value: String = "", val kind: String, val arg: String = "", val on: Boolean = false, val add: Boolean = false)
  private val SPEEDS = listOf(0.75, 1.0, 1.25, 1.5, 1.75, 2.0)
  private fun speedLabel(v: Double) = (if (v == Math.floor(v)) v.toInt().toString() else v.toString().trimEnd('0')) + "×"

  /** Subtitle timing (approved mock "Subtitle timing"): + = later, quarter-second steps, -10..10 s. */
  private fun delayLabel(d: Double): String {
    if (Math.abs(d) < 0.01) return "On time"
    val v = String.format(java.util.Locale.US, "%.2f", Math.abs(d)).trimEnd('0').trimEnd('.')
    return "$v s " + if (d > 0) "later" else "earlier"
  }
  private fun nudge(step: Double) {
    val cur = snap.optDouble("subDelay", 0.0)
    val d = if (step == 0.0) 0.0 else (cur + step).coerceIn(-10.0, 10.0)
    snap.put("subDelay", d) // shows straight away; the page confirms on its next report
    host.act("subdelay", String.format(java.util.Locale.US, "%.2f", d))
    rows = rowsFor()
  }

  private fun rowsFor(): List<Row> {
    val out = ArrayList<Row>()
    when (pop) {
      "sub" -> {
        val subs = snap.optJSONArray("subs")
        val n = subs?.length() ?: 0
        val other = (0 until n).count { subs!!.getJSONObject(it).optInt("g") == 1 }
        if (subLevel == 1) {
          for (i in 0 until n) { val s = subs!!.getJSONObject(i); if (s.optInt("g") == 1) out.add(Row(s.optString("label"), s.optString("note"), kind = "sub", arg = s.optString("id"), on = s.optBoolean("on"))) }
        } else {
          out.add(Row("Off", kind = "sub", arg = "no", on = !snap.optBoolean("subOn")))
          for (i in 0 until n) { val s = subs!!.getJSONObject(i); if (s.optInt("g") == 0) out.add(Row(s.optString("label"), s.optString("note"), kind = "sub", arg = s.optString("id"), on = s.optBoolean("on"))) }
          if (other > 0) {
            val onOther = (0 until n).any { val s = subs!!.getJSONObject(it); s.optInt("g") == 1 && s.optBoolean("on") }
            out.add(Row("Other languages", value = "$other  ›", kind = "other", on = onOther))
          }
          if (snap.optBoolean("canDl")) out.add(Row("Download subtitles", kind = "dl", add = true))
          out.add(Row("Timing", value = "‹  " + delayLabel(snap.optDouble("subDelay", 0.0)) + "  ›", kind = "delay"))
        }
      }
      "audio" -> {
        val a = snap.optJSONArray("audio")
        for (i in 0 until (a?.length() ?: 0)) { val s = a!!.getJSONObject(i); out.add(Row(s.optString("label"), s.optString("note"), kind = "audio", arg = s.optString("id"), on = s.optBoolean("on"))) }
        if (out.isEmpty()) out.add(Row("No other sound tracks", kind = "none"))
      }
      "speed" -> { val cur = snap.optDouble("speed", 1.0); SPEEDS.forEach { out.add(Row(if (it == 1.0) "1× (normal)" else speedLabel(it), kind = "speed", arg = it.toString(), on = Math.abs(it - cur) < 0.01)) } }
      "set" -> {
        out.add(Row("Subtitle size", value = snap.optString("size"), kind = "size"))
        out.add(Row("Picture shape", value = snap.optString("shape"), kind = "shape"))
        out.add(Row("Quality", value = snap.optString("quality"), kind = "quality"))
        out.add(Row("Reload video", "if the picture is stuck", kind = "reload"))
        out.add(Row(if (snap.optBoolean("details")) "Hide player details" else "Player details", kind = "details"))
      }
    }
    return out
  }

  private fun openPop(p: String, from: String) {
    pop = p; opener = from; subLevel = 0
    rows = rowsFor()
    // A pick that sits under "Other languages" opens that list.
    if (p == "sub" && rows.any { it.kind == "other" && it.on }) { subLevel = 1; rows = rowsFor() }
    popIdx = rows.indexOfFirst { it.on }.coerceAtLeast(0)
    mode = Mode.POP
  }

  private fun choose(i: Int) {
    val r = rows.getOrNull(i) ?: return
    when (r.kind) {
      "sub" -> host.act("sub", r.arg)
      "other" -> { subLevel = 1; rows = rowsFor(); popIdx = rows.indexOfFirst { it.on }.coerceAtLeast(0); return }
      "dl" -> { openDl(); return }
      "delay" -> { nudge(0.0); return }
      "audio" -> host.act("audio", r.arg)
      "speed" -> host.act("speed", r.arg)
      "size", "shape", "quality" -> host.act(r.kind)
      "reload" -> { host.act("reload"); pop = ""; mode = Mode.IDLE; return }
      "details" -> host.act("details")
    }
  }

  // ---------- download subtitles (approved mock "Download subtitles") ----------
  // English / Spanish / Other languages along the top; picking one searches straight away.
  // The page does the searching and downloading; we draw what it reports in snap.dl.
  private val OTHER = listOf("Arabic" to "ara", "Dutch" to "dut", "French" to "fre", "German" to "ger", "Italian" to "ita", "Japanese" to "jpn",
    "Korean" to "kor", "Polish" to "pol", "Portuguese" to "por", "Russian" to "rus", "Swedish" to "swe", "Turkish" to "tur")
  private var dlArea = 0      // 0 languages, 1 other-language grid, 2 results
  private var dlLang = 0      // 0 English, 1 Spanish, 2 another language
  private var dlOther = 3
  private var dlOIdx = 3
  private var dlIdx = 0
  private var dlGotSeen = -1
  private val dlBack = Runnable { if (mode == Mode.POP && pop == "dl") backToSubs() }
  private fun dl(): JSONObject = snap.optJSONObject("dl") ?: JSONObject()
  private fun dlRows() = dl().optJSONArray("rows")
  private fun dlCode() = when (dlLang) { 0 -> "eng"; 1 -> "spa"; else -> OTHER[dlOther].second }
  private fun dlName() = when (dlLang) { 0 -> "English"; 1 -> "Spanish"; else -> OTHER[dlOther].first }

  private fun openDl() {
    pop = "dl"; opener = "cc"; mode = Mode.POP
    val d = dl()
    val code = d.optString("lang", "eng")
    when (code) { "eng" -> dlLang = 0; "spa" -> dlLang = 1; else -> { val i = OTHER.indexOfFirst { it.second == code }; if (i >= 0) { dlLang = 2; dlOther = i } else dlLang = 0 } }
    dlGotSeen = d.optInt("got", -1)
    val have = d.optString("state") != "idle" && d.optString("lang") == dlCode()
    if (!have) host.act("dlsearch", dlCode())
    dlArea = if (have && (dlRows()?.length() ?: 0) > 0) 2 else 0; dlIdx = 0
  }
  private fun dlSearch(lang: Int, other: Int = dlOther) {
    dlLang = lang; dlOther = other; dlIdx = 0; dlGotSeen = -1
    host.act("dlsearch", dlCode())
  }
  private fun dlState() {
    val n = dlRows()?.length() ?: 0
    dlIdx = dlIdx.coerceIn(0, max(0, n - 1))
    if (dlArea == 2 && n == 0 && dl().optString("state") != "searching") dlArea = 0
    // Downloaded and switched on: show the tick a moment, then back to the Subtitles menu.
    val got = dl().optInt("got", -1)
    if (got >= 0 && got != dlGotSeen) { dlGotSeen = got; h.removeCallbacks(dlBack); h.postDelayed(dlBack, 1300) }
  }
  private fun backToSubs() {
    h.removeCallbacks(dlBack)
    pop = "sub"; subLevel = 0; rows = rowsFor()
    popIdx = rows.indexOfFirst { it.kind == "dl" }.coerceAtLeast(0)
  }
  private fun dlPress(k: String) {
    val n = dlRows()?.length() ?: 0
    val searching = dl().optString("state") == "searching"
    h.removeCallbacks(dlBack) // moving on your own cancels the trip back to Subtitles
    if (k == "back") { if (dlArea == 1) dlArea = 0 else backToSubs(); return }
    when (dlArea) {
      2 -> when (k) {
        "up" -> if (dlIdx > 0) dlIdx-- else dlArea = 0
        "down" -> dlIdx = min(max(0, n - 1), dlIdx + 1)
        "ok" -> if (!searching && n > 0 && dl().optInt("busy", -1) < 0 && dl().optInt("got", -1) != dlIdx) host.act("dlget", dlIdx.toString())
      }
      0 -> when (k) {
        "left" -> if (dlLang > 0) dlSearch(dlLang - 1)
        "right" -> if (dlLang < 1) dlSearch(dlLang + 1) else if (dlLang == 1) { dlArea = 1; dlOIdx = dlOther }
        "down" -> if (dlLang == 2) { dlArea = 1; dlOIdx = dlOther } else if (n > 0 && !searching) { dlArea = 2; dlIdx = 0 }
        "ok" -> if (dlLang == 2) { dlArea = 1; dlOIdx = dlOther }
      }
      1 -> when (k) {
        "left" -> dlOIdx = max(0, dlOIdx - 1)
        "right" -> dlOIdx = min(OTHER.size - 1, dlOIdx + 1)
        "up" -> if (dlOIdx >= 4) dlOIdx -= 4 else dlArea = 0
        "down" -> if (dlOIdx + 4 < OTHER.size) dlOIdx += 4 else if (n > 0 && !searching && dlLang == 2) { dlArea = 2; dlIdx = 0 }
        "ok" -> { dlSearch(2, dlOIdx); dlArea = 2 }
      }
    }
  }

  // ---------- episodes ----------
  private class Ep(val id: String, val name: String, val sub: String, val img: String?, val pct: Float)
  private var seasons: List<Pair<String, String>> = emptyList()
  private var seasonIdx = 0
  private var episodes: List<Ep> = emptyList()
  private var epIdx = 0
  private var epsArea = 0
  private var epsFor = ""
  private val epScroll = Glide()

  private fun openEps() {
    mode = Mode.EPS; epsArea = 0
    val series = snap.optString("series")
    if (epsFor != series || seasons.isEmpty()) {
      epsFor = series
      Net.get("/Shows/$series/Seasons?UserId={userId}") { v ->
        val all = Net.items(v)
        val list = all.filter { it.optInt("IndexNumber", 1) != 0 } + all.filter { it.optInt("IndexNumber", 1) == 0 }
        seasons = list.map { it.optString("Id") to it.optString("Name") }
        val cur = seasons.indexOfFirst { it.first == snap.optString("season") }.coerceAtLeast(0)
        loadEpisodes(cur, false)
      }
    } else {
      val cur = seasons.indexOfFirst { it.first == snap.optString("season") }
      if (cur >= 0 && cur != seasonIdx) loadEpisodes(cur, false) else { epIdx = episodes.indexOfFirst { it.id == snap.optString("id") }.coerceAtLeast(0); epScroll.set(scrollFor(epIdx), true) }
    }
  }

  private fun loadEpisodes(si: Int, keepFocusOnSeasons: Boolean) {
    seasonIdx = si
    val sid = seasons.getOrNull(si)?.first ?: snap.optString("season")
    val series = snap.optString("series")
    Net.get("/Shows/$series/Episodes?SeasonId=$sid&UserId={userId}&Fields=PrimaryImageAspectRatio") { v ->
      if (seasons.getOrNull(seasonIdx)?.first != sid && seasons.isNotEmpty()) return@get
      val curId = snap.optString("id")
      episodes = Net.items(v).map { e ->
        val ud = e.optJSONObject("UserData")
        val isCur = e.optString("Id") == curId
        val played = ud?.optBoolean("Played") == true
        val mins = (e.optLong("RunTimeTicks") / 600_000_000L).toInt()
        val tag = e.optJSONObject("ImageTags")?.optString("Primary")?.takeIf { it.isNotEmpty() }
        Ep(e.optString("Id"), (if (e.has("IndexNumber")) "${e.optInt("IndexNumber")}. " else "") + e.optString("Name"),
          if (isCur) "Playing now" else if (played) "Watched" else if (mins > 0) "$mins min" else "",
          tag?.let { Net.image(e.optString("Id"), "Primary", it, 400) },
          if (isCur) -1f else if (played) 1f else (ud?.optDouble("PlayedPercentage", 0.0) ?: 0.0).toFloat() / 100f)
      }
      epIdx = if (keepFocusOnSeasons) 0 else episodes.indexOfFirst { it.id == curId }.coerceAtLeast(0)
      epScroll.set(scrollFor(epIdx), true)
      invalidate()
    }
  }

  private val CARD_W = 340f; private val CARD_GAP = 26f
  private fun scrollFor(i: Int): Float {
    val x = i * (CARD_W + CARD_GAP)
    val view = Ui.W - 64f - 64f
    return (x - (view - CARD_W) / 2f).coerceIn(0f, max(0f, episodes.size * (CARD_W + CARD_GAP) - CARD_GAP - view))
  }

  // ---------- drawing ----------
  private val pT1 = Ui.text(Ui.f800, 40f, Ui.TEXT)
  private val pT2 = Ui.text(Ui.f500, 22f, Ui.MUTED)
  private val pTime = Ui.text(Ui.f600, 22f, Ui.TEXT).apply { fontFeatureSettings = "tnum" }
  private val pBtn = Ui.text(Ui.f600, 21f, Ui.TEXT)
  private val pCC = Ui.text(Ui.f800, 21f, Ui.TEXT, 0.4f)
  private val pEnds = Ui.text(Ui.f700, 20f, Ui.TEXT)
  private val pLeft = Ui.text(Ui.f500, 17f, Ui.MUTED)
  private val pHint = Ui.text(Ui.f600, 18f, Ui.MUTED)
  private val pChip = Ui.text(Ui.f600, 21f, Ui.TEXT)
  private val pEpName = Ui.text(Ui.f700, 20f, Ui.TEXT)
  private val pEpSub = Ui.text(Ui.f500, 17f, Ui.MUTED)
  private val pBadge = Ui.text(Ui.f800, 15f, Ui.WHITE)
  private val pPopT = Ui.text(Ui.f800, 24f, Ui.TEXT)
  private val pPopS = Ui.text(Ui.f500, 16f, Ui.MUTED)
  private val pRow = Ui.text(Ui.f600, 21f, Ui.TEXT)
  private val pRowNote = Ui.text(Ui.f500, 16f, Ui.TEXT)
  private val pRowVal = Ui.text(Ui.f500, 19f, Ui.TEXT)
  private val pFoot = Ui.text(Ui.f500, 16f, Ui.MUTED)
  private val pKick = Ui.text(Ui.f800, 22f, Ui.MUTED, 4f)
  private val pBig = Ui.text(Ui.f800, 84f, Ui.TEXT, -1f)
  private val pEpLine = Ui.text(Ui.f700, 32f, Ui.TEXT)
  private val pOver = Ui.text(Ui.f400, 26f, 0xFFEADADA.toInt())
  private val pMeta = Ui.text(Ui.f500, 22f, Ui.MUTED)
  private val pChipPaused = Ui.text(Ui.f700, 19f, Ui.TEXT)
  private val fill = Ui.fill(0)
  private val ring = Ui.stroke(Ui.WHITE, 4f)
  private val iconFill = Ui.fill(Ui.TEXT)
  private val iconLine = Ui.stroke(Ui.TEXT, 1.9f)
  private val shadeB = Paint().apply { shader = LinearGradient(0f, Ui.H - 560f, 0f, Ui.H, intArrayOf(0x00080505, 0x8C080505.toInt(), 0xF0080505.toInt()), floatArrayOf(0f, 0.55f, 1f), Shader.TileMode.CLAMP) }
  private val shadeT = Paint().apply { shader = LinearGradient(0f, 0f, 0f, 240f, 0xCC080505.toInt(), 0x00080505, Shader.TileMode.CLAMP) }
  private val shadeL = Paint().apply { shader = LinearGradient(0f, 0f, Ui.W, 0f, intArrayOf(0xE0000000.toInt(), 0x99000000.toInt(), 0x26000000), floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP) }
  private val r = RectF()

  private val PATH_PLAY = Path().apply { moveTo(8f, 5f); lineTo(8f, 19f); lineTo(19f, 12f); close() }
  private val PATH_PAUSE = Path().apply { addRect(7f, 5f, 10.5f, 19f, Path.Direction.CW); addRect(13.5f, 5f, 17f, 19f, Path.Direction.CW) }
  private val PATH_NEXT = Path().apply { addRect(16f, 5f, 18f, 19f, Path.Direction.CW); moveTo(5f, 5.5f); lineTo(5f, 18.5f); lineTo(15f, 12f); close() }
  private val PATH_VOL = Path().apply { moveTo(4f, 9f); lineTo(4f, 15f); lineTo(8f, 15f); lineTo(13f, 19f); lineTo(13f, 5f); lineTo(8f, 9f); close()
    moveTo(16.5f, 8.5f); cubicTo(18.5f, 10.5f, 18.5f, 13.5f, 16.5f, 15.5f); moveTo(19f, 6f); cubicTo(22.3f, 9.3f, 22.3f, 14.7f, 19f, 18f) }
  private val PATH_DOWN = Path().apply { moveTo(6f, 9f); lineTo(12f, 15f); lineTo(18f, 9f) }
  private val PATH_UP = Path().apply { moveTo(6f, 15f); lineTo(12f, 9f); lineTo(18f, 15f) }
  private val PATH_PLUS = Path().apply { moveTo(12f, 5f); lineTo(12f, 19f); moveTo(5f, 12f); lineTo(19f, 12f) }

  private fun fa(id: String) = focusA.getOrPut(id) { Anim(0f) }

  private fun fmt(t: Double): String {
    val s = max(0, t.toInt()); val h = s / 3600; val m = (s % 3600) / 60; val x = s % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, x) else "%d:%02d".format(m, x)
  }
  private fun endsAt(): Pair<String, String> {
    val speed = snap.optDouble("speed", 1.0).let { if (it <= 0) 1.0 else it }
    val left = max(0.0, dur - shownPos()) / speed
    val end = java.util.Date(System.currentTimeMillis() + (left * 1000).toLong())
    val clock = java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(end)
    val mins = Math.ceil(left / 60).toInt(); val h = mins / 60; val m = mins % 60
    return "Ends at $clock" to (if (h > 0) "$h h $m min left" else "$mins min left")
  }

  private var lastDraw = 0L
  private var liftedTo = -1

  override fun onDraw(c: Canvas) {
    if (!open) return
    val now = SystemClock.uptimeMillis()
    readClock()
    // Paused a while with nothing open: the big paused screen.
    if (paused) { if (pausedSince == 0L) pausedSince = now } else { pausedSince = 0L; pinfo = false }
    if (paused && !pinfo && (mode == Mode.BAR || mode == Mode.IDLE) && seekTo < 0 && now - max(pausedSince, lastKey) > 5000) { pinfo = true; mode = Mode.IDLE }
    // Controls hide by themselves after a few seconds of nothing (not while paused or a menu is open).
    if (mode == Mode.BAR && !paused && seekTo < 0 && now - lastKey > 5000) mode = Mode.IDLE
    if (card && mode == Mode.POP) closeMenus()
    if (focus == "skipbtn" && snap.optString("skip").isEmpty()) focus = "seek"

    vis.set(if (mode == Mode.IDLE || card) 0f else 1f, now, 260f)
    epsA.set(if (mode == Mode.EPS) 1f else 0f, now, 320f)
    popA.set(if (mode == Mode.POP) 1f else 0f, now, 180f)
    pinfoA.set(if (pinfo) 1f else 0f, now, 600f)
    var moving = vis.step(now) or epsA.step(now) or popA.step(now) or pinfoA.step(now)
    for ((id, a) in focusA) { a.set(if (mode == Mode.BAR && focus == id) 1f else 0f, now, 180f); moving = a.step(now) or moving }
    moving = epScroll.step(if (lastDraw == 0L) 16f else (now - lastDraw).toFloat().coerceIn(1f, 50f)) or moving
    if (mode == Mode.EPS) epScroll.set(scrollFor(epIdx))
    lastDraw = now

    val sc = width / Ui.W
    c.save(); c.scale(sc, sc)

    if (pinfoA.v > 0.01f) drawPaused(c, pinfoA.v)
    val a = vis.v
    if (a > 0.01f) {
      shadeB.alpha = (255 * a).toInt(); c.drawRect(0f, Ui.H - 560f, Ui.W, Ui.H, shadeB)
      shadeT.alpha = (255 * a).toInt(); c.drawRect(0f, 0f, Ui.W, 240f, shadeT)
      pT1.alpha = (255 * a).toInt(); pT2.alpha = (255 * a).toInt()
      Ui.line(c, Ui.fit(snap.optString("t1"), pT1, 1300f), 64f, 48f, 48f, pT1)
      Ui.line(c, Ui.fit(snap.optString("t2"), pT2, 1300f), 64f, 100f, 28f, pT2)
      if (paused) drawPausedChip(c, a)
      drawBar(c, a)
      if (epsA.v > 0.01f) drawEps(c, a * epsA.v)
      if (popA.v > 0.01f && pop == "dl") drawDl(c, a * popA.v)
      else if (popA.v > 0.01f && pop.isNotEmpty()) drawPop(c, a * popA.v)
    }
    if (!card && !pinfo && mode != Mode.EPS && mode != Mode.POP && snap.optString("skip").isNotEmpty()) drawSkip(c)
    c.restore()

    // Subtitles sit above the bar while it shows.
    // (Worked out from where the bar is headed, so the player is told once per change, not every frame.)
    val target = if (mode == Mode.IDLE || card) Ui.H else Ui.H - (if (mode == Mode.EPS) 390f else 48f + hintFull()) - 64f - 30f - 27f - 20f
    val lift = (100 - ((Ui.H - target) / Ui.H) * 100).toInt().coerceIn(50, 100)
    if (lift != liftedTo) { liftedTo = lift; host.act("subpos", lift.toString()) }

    if (mode == Mode.POP && pop == "dl" && (dl().optString("state") == "searching" || dl().optInt("busy", -1) >= 0)) moving = true
    if (moving) postInvalidateOnAnimation()
    else if (a > 0.01f || seekTo >= 0) postInvalidateDelayed(250)
    else postInvalidateDelayed(if (paused) 500 else 1000)
  }

  /** Where the bar's block starts (top of the time bar row), moving up when the episodes pop up. */
  private fun bottomOff() = Ui.mix(48f, 390f, epsA.v)
  private fun hintFull() = if (snap.optBoolean("isEp") && snap.optString("series").isNotEmpty()) 46f else 0f
  private fun hintH() = if (snap.optBoolean("isEp") && snap.optString("series").isNotEmpty()) 46f * (1f - epsA.v) else 0f
  private fun rowTop() = Ui.H - bottomOff() - hintH() - 64f
  private fun barTop() = rowTop() - 30f - 27f

  private fun drawPausedChip(c: Canvas, a: Float) {
    val w = 44f + pChipPaused.measureText("Paused") + 18f
    r.set(Ui.W - 64f - w, 56f, Ui.W - 64f, 100f)
    fill.color = Ui.alpha(0x80000000.toInt(), a); c.drawRoundRect(r, 22f, 22f, fill)
    iconFill.color = Ui.alpha(Ui.TEXT, a); Icons.drawPath(c, PATH_PAUSE, r.left + 16f, 68f, 20f, iconFill)
    pChipPaused.alpha = (255 * a).toInt(); Ui.line(c, "Paused", r.left + 44f, 56f, 44f, pChipPaused)
  }

  // Skip Intro / Skip Credits: OK presses it while you just watch; with the bar up it sits above the time bar (Up reaches it).
  private val pSkip = Ui.text(Ui.f700, 24f, Ui.WHITE)
  private val skipTri = Path().apply { moveTo(5f, 5.5f); lineTo(5f, 18.5f); lineTo(15f, 12f); close(); addRect(16f, 5f, 18f, 19f, Path.Direction.CW) }
  private fun drawSkip(c: Canvas) {
    val label = if (snap.optString("skip") == "credits") "Skip Credits" else "Skip Intro"
    val w = 28f + 26f + 12f + pSkip.measureText(label) + 30f
    val idle = mode == Mode.IDLE
    val foc = mode == Mode.BAR && focus == "skipbtn"
    val v = vis.v
    val bottom = Ui.mix(Ui.H - 72f, barTop() - 30f, v)
    r.set(Ui.W - 64f - w, bottom - 64f, Ui.W - 64f, bottom)
    fill.color = if (foc) Ui.WHITE else if (idle) Ui.RED else 0xD91E1415.toInt()
    c.drawRoundRect(r, 32f, 32f, fill)
    val col = if (foc) 0xFF1A0F10.toInt() else Ui.WHITE
    fill.color = col
    c.save(); c.translate(r.left + 28f, r.top + 19f); c.scale(26f / 24f, 26f / 24f); c.drawPath(skipTri, fill); c.restore()
    pSkip.color = col
    Ui.line(c, label, r.left + 28f + 26f + 12f, r.top, 64f, pSkip)
  }

  private fun drawBar(c: Canvas, a: Float) {
    val al = (255 * a).toInt()
    val seekY = barTop()
    val p = shownPos()
    val cur = fmt(p); val total = fmt(dur)
    pTime.alpha = al
    val cw = pTime.measureText(if (dur >= 3600) "0:00:00" else "00:00"); val dw = pTime.measureText(total)
    Ui.line(c, cur, 64f, seekY, 27f, pTime)
    c.drawText(total, Ui.W - 64f - dw, seekY + 27f / 2f - (pTime.fontMetrics.ascent + pTime.fontMetrics.descent) / 2f, pTime)
    val x0 = 64f + cw + 24f; val x1 = Ui.W - 64f - dw - 24f
    val cy = seekY + 13.5f
    val pct = if (dur > 0) (p / dur).toFloat().coerceIn(0f, 1f) else 0f
    r.set(x0, cy - 5f, x1, cy + 5f); fill.color = Ui.alpha(0x40FFFFFF, a); c.drawRoundRect(r, 5f, 5f, fill)
    val fx = x0 + (x1 - x0) * pct
    r.set(x0 - 3f, cy - 8f, fx + 3f, cy + 8f); fill.color = Ui.alpha(0x30EC282E, a); c.drawRoundRect(r, 8f, 8f, fill)
    r.set(x0, cy - 5f, fx, cy + 5f); fill.color = Ui.alpha(Ui.RED, a); c.drawRoundRect(r, 5f, 5f, fill)
    fill.color = Ui.alpha(Ui.WHITE, a); c.drawCircle(fx, cy, 13f, fill)
    val fs = fa("seek"); fs.set(if (mode == Mode.BAR && focus == "seek") 1f else 0f, SystemClock.uptimeMillis(), 180f)
    if (fs.v > 0.01f) { ring.color = Ui.alpha(Ui.WHITE, a * fs.v); r.set(x0 - 12f, cy - 17f, x1 + 12f, cy + 17f); c.drawRoundRect(r, 17f, 17f, ring) }

    // Buttons
    val y = rowTop()
    var x = 64f
    x = button(c, "rew", x, y, "−" + snap.optInt("back", 10), null, false, a) + 16f
    x = button(c, "play", x, y, null, if (paused) PATH_PLAY else PATH_PAUSE, true, a, square = true, filled = true) + 16f
    x = button(c, "fwd", x, y, "+" + snap.optInt("fwd", 10), null, false, a) + 30f
    val (e1, e2) = endsAt()
    pEnds.alpha = al; pLeft.alpha = al
    Ui.line(c, e1, x, y + 6f, 26f, pEnds); Ui.line(c, e2, x, y + 34f, 22f, pLeft)
    // Right group, laid out from the right edge.
    var rx = Ui.W - 64f
    rx = buttonR(c, "cog", rx, y, null, null, false, a, cog = true) - 16f
    rx = buttonR(c, "speed", rx, y, speedLabel(snap.optDouble("speed", 1.0)), null, false, a, minW = 76f) - 16f
    rx = buttonR(c, "audio", rx, y, null, PATH_VOL, false, a, square = true, line = true) - 16f
    rx = buttonR(c, "cc", rx, y, "CC", null, snap.optBoolean("subOn"), a, minW = 64f, cc = true) - 16f
    if (rowShown("next")) buttonR(c, "next", rx, y, if (snap.optBoolean("isEp")) "Next episode" else "Next film", PATH_NEXT, false, a, filled = true)
    if (hintH() > 1f) {
      val k = 1f - epsA.v
      pHint.alpha = (al * k).toInt()
      val tw = pHint.measureText("Episodes"); val total2 = 22f + 10f + tw; val hx = (Ui.W - total2) / 2f; val hy = y + 64f + 22f
      iconLine.color = Ui.alpha(Ui.MUTED, a * k); iconLine.strokeWidth = 2f
      Icons.drawPath(c, PATH_DOWN, hx, hy, 22f, iconLine)
      Ui.line(c, "Episodes", hx + 32f, hy - 1f, 24f, pHint)
    }
  }

  private fun btnWidth(text: String?, icon: Path?, square: Boolean, minW: Float, cog: Boolean, filled: Boolean): Float =
    if (square || cog) 64f else max(minW, (if (icon != null) 26f + 10f else 0f) + (text?.let { (if (it == "CC") pCC else pBtn).measureText(it) } ?: 0f) + 40f)

  private fun button(c: Canvas, id: String, x: Float, y: Float, text: String?, icon: Path?, red: Boolean, a: Float, square: Boolean = false, filled: Boolean = false, minW: Float = 64f): Float {
    val w = btnWidth(text, icon, square, minW, false, filled)
    drawBtn(c, id, x, y, w, text, icon, red, a, filled, false, false, false); return x + w
  }
  private fun buttonR(c: Canvas, id: String, right: Float, y: Float, text: String?, icon: Path?, red: Boolean, a: Float, square: Boolean = false, filled: Boolean = false, minW: Float = 64f, cog: Boolean = false, line: Boolean = false, cc: Boolean = false): Float {
    val w = btnWidth(text, icon, square, minW, cog, filled)
    drawBtn(c, id, right - w, y, w, text, icon, red, a, filled, cog, line, cc); return right - w
  }
  private val btnRight = HashMap<String, Float>()

  private fun drawBtn(c: Canvas, id: String, x: Float, y: Float, w: Float, text: String?, icon: Path?, red: Boolean, a: Float, filled: Boolean, cog: Boolean, line: Boolean, cc: Boolean) {
    btnRight[id] = x + w
    val f = fa(id).v
    val opened = mode == Mode.POP && opener == id
    val s = 1f + 0.06f * f
    c.save(); c.scale(s, s, x + w / 2f, y + 32f)
    r.set(x, y, x + w, y + 64f)
    fill.color = Ui.alpha(if (red) Ui.RED else 0x1FFFFFFF, a); c.drawRoundRect(r, 14f, 14f, fill)
    if (f > 0.01f || opened) { ring.color = Ui.alpha(Ui.WHITE, a * max(f, if (opened) 0.45f else 0f)); r.set(x - 5f, y - 5f, x + w + 5f, y + 69f); c.drawRoundRect(r, 18f, 18f, ring) }
    val col = Ui.alpha(if (red) Ui.WHITE else Ui.TEXT, a)
    var tx = x + 20f
    if (icon != null || cog) {
      val ix = if (text == null) x + (w - 26f) / 2f else tx
      if (cog) { iconLine.color = col; iconLine.strokeWidth = 1.9f; Icons.draw(c, "settings", ix, y + 19f, 26f, iconLine) }
      else if (line) { iconLine.color = col; iconLine.strokeWidth = 1.9f; Icons.drawPath(c, icon!!, ix, y + 19f, 26f, iconLine) }
      else { iconFill.color = col; Icons.drawPath(c, icon!!, ix, y + 19f, 26f, iconFill) }
      tx = ix + 26f + 10f
    }
    if (text != null) {
      val p = if (cc) pCC else pBtn
      p.color = col
      val tw = p.measureText(text)
      val px = if (icon == null) x + (w - tw) / 2f else tx
      Ui.line(c, text, px, y, 64f, p)
    }
    c.restore()
  }

  private fun drawEps(c: Canvas, a: Float) {
    val al = (255 * a).toInt()
    val cardsTop = Ui.H - 48f - (191f + 12f + 26f + 2f + 22f) + (1f - epsA.v) * 60f
    val chipsY = cardsTop - 22f - 62f
    val now = SystemClock.uptimeMillis()
    // Season chips
    var x = 64f
    if (seasons.size > 1) seasons.forEachIndexed { i, s ->
      pChip.alpha = al
      val w = pChip.measureText(s.second) + 52f
      r.set(x, chipsY, x + w, chipsY + 62f)
      fill.color = Ui.alpha(if (i == seasonIdx) Ui.RED else 0x1AFFFFFF, a); c.drawRoundRect(r, 31f, 31f, fill)
      if (epsArea == 1 && i == seasonIdx) { ring.color = Ui.alpha(Ui.WHITE, a); r.set(x - 5f, chipsY - 5f, x + w + 5f, chipsY + 67f); c.drawRoundRect(r, 36f, 36f, ring) }
      pChip.color = Ui.alpha(if (i == seasonIdx) Ui.WHITE else Ui.TEXT, a)
      Ui.line(c, s.second, x + 26f, chipsY, 62f, pChip)
      x += w + 14f
    } else { pChip.color = Ui.alpha(Ui.TEXT, a); Ui.line(c, snap.optString("t1"), 64f, chipsY, 62f, pChip) }
    // Episode cards
    c.save(); c.clipRect(0f, chipsY + 66f, Ui.W, Ui.H)
    val off = epScroll.pos
    episodes.forEachIndexed { i, e ->
      val cx = 64f + i * (CARD_W + CARD_GAP) - off
      if (cx > Ui.W || cx + CARD_W < 0) return@forEachIndexed
      val foc = epsArea == 0 && i == epIdx
      val s = if (foc) 1.06f else 1f
      c.save(); c.scale(s, s, cx + CARD_W / 2f, cardsTop + 95f)
      r.set(cx, cardsTop, cx + CARD_W, cardsTop + 191f)
      val pic = Img.get(e.img)
      if (pic != null) Img.draw(c, pic, r, 12f, a * Img.fade(pic, now, false)) else { fill.color = Ui.alpha(Ui.BUTTON, a); c.drawRoundRect(r, 12f, 12f, fill) }
      if (pic != null && Img.fade(pic, now, false) < 1f) postInvalidateOnAnimation()
      val prog = if (e.pct < 0) (if (dur > 0) (pos / dur).toFloat() else 0f) else e.pct
      if (prog > 0.005f) { c.save(); c.clipRect(r.left, r.bottom - 6f, r.left + CARD_W * prog.coerceIn(0f, 1f), r.bottom); fill.color = Ui.alpha(Ui.RED, a); c.drawRoundRect(r, 12f, 12f, fill); c.restore() }
      if (e.pct < 0) {
        val bw = pBadge.measureText("PLAYING NOW") + 24f
        r.set(cx + 12f, cardsTop + 12f, cx + 12f + bw, cardsTop + 42f); fill.color = Ui.alpha(Ui.RED, a); c.drawRoundRect(r, 15f, 15f, fill)
        pBadge.alpha = al; Ui.line(c, "PLAYING NOW", cx + 24f, cardsTop + 12f, 30f, pBadge)
      }
      if (foc) { ring.color = Ui.alpha(Ui.WHITE, a); r.set(cx - 5f, cardsTop - 5f, cx + CARD_W + 5f, cardsTop + 196f); c.drawRoundRect(r, 16f, 16f, ring) }
      c.restore()
      pEpName.alpha = al; pEpSub.alpha = al
      Ui.line(c, Ui.fit(e.name, pEpName, CARD_W), cx, cardsTop + 191f + 12f, 26f, pEpName)
      pEpSub.color = Ui.alpha(if (e.pct < 0) Ui.RED else Ui.MUTED, a)
      Ui.line(c, e.sub, cx, cardsTop + 191f + 40f, 22f, pEpSub)
    }
    if (episodes.isEmpty()) { pEpSub.color = Ui.alpha(Ui.MUTED, a); Ui.line(c, "Loading episodes…", 64f, cardsTop, 30f, pEpSub) }
    c.restore()
  }

  private fun drawPop(c: Canvas, a: Float) {
    val al = (255 * a).toInt()
    val title = when (pop) { "sub" -> if (subLevel == 1) "Other languages" else "Subtitles"; "audio" -> "Audio"; "speed" -> "Speed"; else -> "Settings" }
    val sub = when (pop) { "sub" -> if (subLevel == 1) "Back returns" else if (snap.optBoolean("isEp")) "for this show" else "for this film"; "audio" -> if (snap.optBoolean("isEp")) "for this show" else "for this film"; else -> "" }
    val win = 8
    val start = max(0, min(rows.size - win, popIdx - 3))
    val shown = rows.subList(start, min(rows.size, start + win))
    val foot = if (pop == "sub" && subLevel == 0 && rows.getOrNull(popIdx)?.kind == "delay") "Left shows subtitles earlier, Right later. OK puts them back on time. Kept for this video only."
    else if (pop == "sub" && subLevel == 0) {
      val other = rows.firstOrNull { it.kind == "other" }
      if (other != null) "English and Spanish first. Other languages has the rest." else if (rows.count { it.kind == "sub" } <= 1) "This video has no subtitles of its own. Download subtitles finds some." else ""
    } else ""
    val footL = if (foot.isNotEmpty()) Ui.clamp(foot, pFoot, 440, 3, 22f) else null
    val w = 480f
    val h = 16f + 44f + (if (start > 0) 22f else 0f) + shown.size * 66f - 4f + (if (start + win < rows.size) 22f else 0f) + (footL?.let { 12f + it.height + 2f } ?: 0f) + 16f
    val right = (btnRight[opener] ?: (Ui.W - 64f)).coerceIn(w + 64f, Ui.W - 64f)
    val bottom = rowTop() - 26f + (1f - popA.v) * 16f
    val left = right - w; val top = bottom - h
    r.set(left, top, right, bottom)
    fill.color = Ui.alpha(0xF71E1415.toInt(), a); c.drawRoundRect(r, 20f, 20f, fill)
    ring.color = Ui.alpha(Ui.LINE, a); ring.strokeWidth = 1.5f; c.drawRoundRect(r, 20f, 20f, ring); ring.strokeWidth = 4f
    var y = top + 16f
    pPopT.alpha = al; pPopS.alpha = al
    val tw = pPopT.measureText(title)
    if (pop == "sub" && subLevel == 1) { iconLine.color = Ui.alpha(Ui.TEXT, a); iconLine.strokeWidth = 2.2f; Icons.drawPath(c, Path().apply { moveTo(15f, 5f); lineTo(8f, 12f); lineTo(15f, 19f) }, left + 10f, y + 10f, 24f, iconLine) }
    val tx = left + if (pop == "sub" && subLevel == 1) 38f else 28f
    Ui.line(c, title, tx, y, 44f, pPopT)
    if (sub.isNotEmpty()) Ui.line(c, sub, tx + tw + 12f, y + 4f, 44f, pPopS)
    y += 44f
    if (start > 0) { iconLine.color = Ui.alpha(Ui.MUTED, a); iconLine.strokeWidth = 2f; Icons.drawPath(c, PATH_UP, left + w / 2f - 11f, y, 22f, iconLine); y += 22f }
    shown.forEachIndexed { j, row ->
      val i = start + j
      val foc = i == popIdx
      r.set(left + 12f, y, right - 12f, y + 62f)
      if (foc) { fill.color = Ui.alpha(Ui.WHITE, a); c.drawRoundRect(r, 12f, 12f, fill) }
      val col = if (foc) 0xFF1A0F10.toInt() else Ui.TEXT
      var x = left + 30f
      if (row.on) { iconLine.color = Ui.alpha(Ui.RED, a); iconLine.strokeWidth = 2.6f; Icons.draw(c, "check", x, y + 19f, 24f, iconLine) }
      if (row.kind == "delay") {
        iconLine.color = Ui.alpha(if (foc) col else Ui.RED, a); iconLine.strokeWidth = 2f
        val cx = x + 12f; val cy = y + 32f
        c.drawCircle(cx, cy, 8f, iconLine); c.drawLine(cx, cy - 4f, cx, cy, iconLine); c.drawLine(cx, cy, cx + 2.5f, cy + 2f, iconLine); c.drawLine(cx - 2.5f, cy - 10.5f, cx + 2.5f, cy - 10.5f, iconLine)
      }
      if (row.add) { iconLine.color = Ui.alpha(if (foc) col else Ui.RED, a); iconLine.strokeWidth = 2.2f; Icons.drawPath(c, PATH_PLUS, x, y + 19f, 24f, iconLine) }
      x += 36f
      pRow.color = Ui.alpha(col, a)
      val valW = if (row.value.isNotEmpty()) pRowVal.measureText(row.value) + 14f else 0f
      val avail = right - 30f - valW - x
      val label = Ui.fit(row.label, pRow, avail)
      Ui.line(c, label, x, y, 62f, pRow)
      val lw = pRow.measureText(label)
      if (row.note.isNotEmpty() && avail - lw > 40f) { pRowNote.color = Ui.alpha(col, a * 0.7f); Ui.line(c, Ui.fit(row.note, pRowNote, avail - lw - 12f), x + lw + 12f, y + 2f, 62f, pRowNote) }
      if (row.value.isNotEmpty()) { pRowVal.color = Ui.alpha(col, a * 0.75f); c.drawText(row.value, right - 30f - pRowVal.measureText(row.value), y + 31f - (pRowVal.fontMetrics.ascent + pRowVal.fontMetrics.descent) / 2f, pRowVal) }
      y += 66f
    }
    y -= 4f
    if (start + win < rows.size) { iconLine.color = Ui.alpha(Ui.MUTED, a); iconLine.strokeWidth = 2f; Icons.drawPath(c, PATH_DOWN, left + w / 2f - 11f, y, 22f, iconLine); y += 22f }
    if (footL != null) { pFoot.alpha = al; c.save(); c.translate(left + 28f, y + 12f); footL.draw(c); c.restore() }
  }

  private val pDlName = Ui.text(Ui.f600, 20f, Ui.TEXT)
  private val pDlNote = Ui.text(Ui.f500, 16f, Ui.TEXT)
  private val pDlMatch = Ui.text(Ui.f800, 13f, 0xFF5FD18F.toInt(), 0.8f)
  private val pDlState = Ui.text(Ui.f700, 17f, Ui.TEXT)
  private val pDlChip = Ui.text(Ui.f600, 19f, Ui.TEXT)
  private val pDlOther = Ui.text(Ui.f600, 17f, Ui.TEXT)
  private val spin = Ui.stroke(Ui.RED, 4f)

  private fun drawDl(c: Canvas, a: Float) {
    val al = (255 * a).toInt()
    val d = dl(); val rowsJ = dlRows(); val n = rowsJ?.length() ?: 0
    val state = d.optString("state"); val busy = d.optInt("busy", -1); val got = d.optInt("got", -1); val msg = d.optString("msg")
    val win = 5; val rowH = 78f
    val w = 660f
    val gridH = if (dlArea == 1) 3 * 52f + 12f else 0f
    val listH = win * rowH - 4f
    val footH = if (msg.isNotEmpty() && state != "err") 40f else 0f
    val h = 16f + 44f + 22f + 12f + 54f + 14f + gridH + listH + footH + 16f
    val right = (btnRight[opener] ?: (Ui.W - 64f)).coerceIn(w + 64f, Ui.W - 64f)
    val bottom = rowTop() - 26f + (1f - popA.v) * 16f
    val left = right - w; val top = bottom - h
    r.set(left, top, right, bottom)
    fill.color = Ui.alpha(0xF71E1415.toInt(), a); c.drawRoundRect(r, 20f, 20f, fill)
    ring.color = Ui.alpha(Ui.LINE, a); ring.strokeWidth = 1.5f; c.drawRoundRect(r, 20f, 20f, ring); ring.strokeWidth = 4f
    var y = top + 16f
    // Title with a back arrow, and where the subtitles come from.
    iconLine.color = Ui.alpha(Ui.TEXT, a); iconLine.strokeWidth = 2.2f
    Icons.drawPath(c, Path().apply { moveTo(15f, 5f); lineTo(8f, 12f); lineTo(15f, 19f) }, left + 10f, y + 10f, 24f, iconLine)
    pPopT.alpha = al; pPopS.alpha = al
    Ui.line(c, "Download subtitles", left + 38f, y, 44f, pPopT); y += 44f
    Ui.line(c, "From the subtitle sites your Emby server uses (like OpenSubtitles)", left + 38f, y - 4f, 22f, pPopS); y += 22f + 12f
    // Language chips
    var x = left + 24f
    val labels = listOf("English", "Spanish", if (dlLang == 2) OTHER[dlOther].first + "  ▾" else "Other languages")
    labels.forEachIndexed { i, lab ->
      val cw = pDlChip.measureText(lab) + 44f
      r.set(x, y, x + cw, y + 54f)
      fill.color = Ui.alpha(if (i == dlLang) Ui.RED else 0x1AFFFFFF, a); c.drawRoundRect(r, 27f, 27f, fill)
      if (dlArea == 0 && i == dlLang) { ring.color = Ui.alpha(Ui.WHITE, a); r.set(x - 5f, y - 5f, x + cw + 5f, y + 59f); c.drawRoundRect(r, 32f, 32f, ring) }
      pDlChip.color = Ui.alpha(if (i == dlLang) Ui.WHITE else Ui.TEXT, a)
      Ui.line(c, lab, x + 22f, y, 54f, pDlChip)
      x += cw + 12f
    }
    y += 54f + 14f
    // Other languages grid (4 across)
    if (gridH > 0f) {
      val gw = (w - 48f - 3 * 10f) / 4f
      OTHER.forEachIndexed { i, (lab, _) ->
        val gx = left + 24f + (i % 4) * (gw + 10f); val gy = y + (i / 4) * 52f
        r.set(gx, gy, gx + gw, gy + 42f)
        val on = dlLang == 2 && i == dlOther
        fill.color = Ui.alpha(if (on) Ui.RED else 0x14FFFFFF, a); c.drawRoundRect(r, 21f, 21f, fill)
        if (i == dlOIdx) { ring.color = Ui.alpha(Ui.WHITE, a); r.set(gx - 4f, gy - 4f, gx + gw + 4f, gy + 46f); c.drawRoundRect(r, 25f, 25f, ring) }
        pDlOther.color = Ui.alpha(if (on) Ui.WHITE else Ui.TEXT, a)
        Ui.line(c, lab, gx + (gw - pDlOther.measureText(lab)) / 2f, gy, 42f, pDlOther)
      }
      y += gridH
    }
    // Results
    val listTop = y
    if (state == "searching" || state == "idle") {
      val cx = left + w / 2f; val cy = listTop + listH / 2f - 20f
      val ang = ((SystemClock.uptimeMillis() % 900L) / 900f) * 360f
      spin.color = Ui.alpha(Ui.RED, a); r.set(cx - 18f, cy - 18f, cx + 18f, cy + 18f); c.drawArc(r, ang, 270f, false, spin)
      pRowNote.color = Ui.alpha(Ui.MUTED, a); val t = "Searching ${dlName()}…"
      Ui.line(c, t, cx - pRowNote.measureText(t) / 2f, cy + 30f, 30f, pRowNote)
    } else if (state == "err" || n == 0) {
      pRow.color = Ui.alpha(Ui.MUTED, a)
      Ui.line(c, Ui.fit(if (state == "err") "Couldn't search" else "Nothing found in ${dlName()}", pRow, w - 56f), left + 28f, listTop + 10f, 40f, pRow)
      pRowNote.color = Ui.alpha(Ui.MUTED, a * 0.8f)
      Ui.line(c, Ui.fit(if (state == "err") msg else "Try another language", pRowNote, w - 56f), left + 28f, listTop + 50f, 26f, pRowNote)
    } else {
      val start = max(0, min(n - win, dlIdx - 2))
      for (i in start until min(n, start + win)) {
        val row = rowsJ!!.getJSONObject(i)
        val foc = dlArea == 2 && i == dlIdx
        val ry = listTop + (i - start) * rowH
        r.set(left + 12f, ry, right - 12f, ry + rowH - 4f)
        if (foc) { fill.color = Ui.alpha(Ui.WHITE, a); c.drawRoundRect(r, 12f, 12f, fill) }
        val col = if (foc) 0xFF1A0F10.toInt() else Ui.TEXT
        val st = when { got == i -> "✓ Added, now on"; busy == i -> "Downloading…"; foc -> "OK to download"; else -> "" }
        pDlState.color = Ui.alpha(when { got == i -> if (foc) 0xFF1F7A45.toInt() else 0xFF5FD18F.toInt(); foc -> col; else -> Ui.MUTED }, a)
        val stW = if (st.isNotEmpty()) pDlState.measureText(st) + 20f else 0f
        val tx = left + 30f; val avail = right - 30f - stW - tx
        pDlName.color = Ui.alpha(col, a)
        Ui.line(c, Ui.fit(row.optString("name"), pDlName, avail), tx, ry + 8f, 32f, pDlName)
        var nx = tx
        if (row.optBoolean("match")) {
          pDlMatch.color = if (foc) Ui.alpha(0xFF1F7A45.toInt(), a) else Ui.alpha(0xFF5FD18F.toInt(), a)
          Ui.line(c, "MATCHES YOUR FILE", nx, ry + 42f, 24f, pDlMatch); nx += pDlMatch.measureText("MATCHES YOUR FILE") + 12f
        }
        pDlNote.color = Ui.alpha(col, a * 0.7f)
        Ui.line(c, Ui.fit(row.optString("note"), pDlNote, tx + avail - nx), nx, ry + 42f, 24f, pDlNote)
        if (st.isNotEmpty()) c.drawText(st, right - 30f - pDlState.measureText(st), ry + (rowH - 4f) / 2f - (pDlState.fontMetrics.ascent + pDlState.fontMetrics.descent) / 2f, pDlState)
      }
      if (start > 0) { iconLine.color = Ui.alpha(Ui.MUTED, a); iconLine.strokeWidth = 2f; Icons.drawPath(c, PATH_UP, right - 44f, listTop - 24f, 22f, iconLine) }
      if (start + win < n) { iconLine.color = Ui.alpha(Ui.MUTED, a); iconLine.strokeWidth = 2f; Icons.drawPath(c, PATH_DOWN, right - 44f, listTop + listH - 2f, 22f, iconLine) }
    }
    if (footH > 0f) { pFoot.color = 0xFFF08A8C.toInt(); pFoot.alpha = al; Ui.line(c, Ui.fit(msg, pFoot, w - 56f), left + 28f, listTop + listH + 8f, 28f, pFoot); pFoot.color = Ui.MUTED }
  }

  private fun drawPaused(c: Canvas, a: Float) {
    shadeL.alpha = (255 * a).toInt(); c.drawRect(0f, 0f, Ui.W, Ui.H, shadeL)
    val al = (255 * a).toInt()
    pKick.alpha = al; pBig.alpha = al; pEpLine.alpha = al; pOver.alpha = al; pMeta.alpha = al
    val title = Ui.clamp(snap.optString("t1"), pBig, 960, 2, 86f)
    val ov = snap.optString("ov")
    val over = if (ov.isNotEmpty()) Ui.clamp(ov, pOver, 960, 5, 40f) else null
    val ep = snap.optString("t2")
    val (e1, _) = endsAt()
    val meta = "Paused · ${fmt(pos)} of ${fmt(dur)} · ${e1.replaceFirstChar { it.lowercase() }}"
    val h = 30f + 12f + title.height + (if (ep.isNotEmpty()) 14f + 42f else 0f) + (over?.let { 22f + it.height } ?: 0f) + 28f + 30f
    val rise = (1f - a) * 24f
    var y = (Ui.H - h) / 2f + rise
    Ui.line(c, "YOU'RE WATCHING", 120f, y, 30f, pKick); y += 30f + 12f
    c.save(); c.translate(120f, y); title.draw(c); c.restore(); y += title.height
    if (ep.isNotEmpty()) { y += 14f; Ui.line(c, Ui.fit(ep, pEpLine, 960f), 120f, y, 42f, pEpLine); y += 42f }
    if (over != null) { y += 22f; c.save(); c.translate(120f, y); over.draw(c); c.restore(); y += over.height }
    y += 28f
    Ui.line(c, meta, 120f, y, 30f, pMeta)
  }

  /** Something changed: redraw now (and keep the controls up). */
  private fun kick() { invalidate() }
}
