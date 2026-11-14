package app.scrappy.player.tv

import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.os.SystemClock
import android.text.Layout
import android.text.StaticLayout
import android.text.TextUtils
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** The home banner (same picks, reasons and rules as fillHero / renderHero in views.js). */
class Hero(private val home: Home) {
  class Pick(val it: JSONObject, val kicker: String, val why: String, val url: String) {
    var series: JSONObject? = null
    var label: String? = null
    var layout: Layouts? = null
  }
  class Layouts(val title: StaticLayout, val overview: StaticLayout?, val meta: String, val playLabel: String)

  private val tv get() = home.tv
  private var picks: List<Pick> = emptyList()
  private var i = 0
  private var slideAt = 0L
  private var prevUrl: String? = null
  private var waiting = true
  private var gen = 0
  private var nextAt = 0L
  private var running = false

  private val FIELDS = "PrimaryImageAspectRatio,ProductionYear,EndDate,BasicSyncInfo"
  private val IMG_OPTS = "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Thumb"
  private val DAY = 86400000L

  private fun mode(): String = when (home.prefs.optString("heroMode", "picks")) { "recent" -> "recent"; "off" -> "off"; else -> "picks" }
  private fun setFile() = File(tv.context.cacheDir, "native-meta/hero-" + (Net.session.key + mode()).hashCode() + ".json")

  fun height(): Float = if (mode() == "off" || (!waiting && picks.isEmpty())) 0f else 799f

  fun modeChanged() { load(true) }
  fun resume() { running = true; nextAt = SystemClock.uptimeMillis() + 8000 }
  fun pause() { running = false }

  // ---------------- choosing the picks ----------------

  fun load(refresh: Boolean) {
    val my = ++gen
    if (mode() == "off") { picks = emptyList(); waiting = false; home.heroChanged(); return }
    // Last time's set straight away (kept for six hours, so the banner doesn't reshuffle on every visit).
    var kept: JSONObject? = null
    try { val f = setFile(); if (f.exists()) kept = JSONObject(f.readText()) } catch (_: Throwable) {}
    if (picks.isEmpty() && kept != null) {
      val l = fromSaved(kept)
      if (l.isNotEmpty()) { picks = l; i = 0; slideAt = SystemClock.uptimeMillis(); waiting = false; home.heroChanged() }
    }
    Net.bg {
      var fresh: List<Pick>? = null
      try {
        if (kept != null && System.currentTimeMillis() - kept.optLong("at") < 6 * 3600_000L) fresh = recheck(kept)
      } catch (_: Throwable) {}
      var isNew = false
      if (fresh == null) { fresh = try { choose() } catch (_: Throwable) { emptyList() }; isNew = true }
      val got = fresh ?: emptyList()
      for (p in got) if (p.it.optString("Type") == "Episode" && p.it.optString("SeriesId").isNotEmpty()) {
        val path = "/Users/{userId}/Items/" + p.it.optString("SeriesId")
        p.series = (Net.cachedNow(path) ?: try { Net.getNow(path) } catch (_: Throwable) { null }) as? JSONObject
      }
      if (got.isNotEmpty() && (isNew || refresh)) save(got)
      Net.main.post {
        if (my != gen) return@post
        waiting = false
        if (got.isEmpty()) { if (picks.isEmpty()) home.heroChanged(); return@post }
        // A banner already showing keeps its current slide; the fresh ones slot in after it.
        if (picks.isNotEmpty()) {
          val curPick = picks[i]
          val key = { p: Pick -> p.it.optString("SeriesId").ifEmpty { p.it.optString("Id") } }
          val same = got.firstOrNull { key(it) == key(curPick) }
          picks = (listOf(same ?: curPick) + got.filter { key(it) != key(curPick) }).take(6)
          i = 0
        } else { picks = got; i = 0; slideAt = SystemClock.uptimeMillis() }
        home.heroChanged()
      }
    }
  }

  private fun save(l: List<Pick>) {
    try {
      val a = JSONArray()
      for (p in l) a.put(JSONObject().put("it", p.it).put("kicker", p.kicker).put("why", p.why).put("url", p.url).put("series", p.series ?: JSONObject.NULL))
      setFile().writeText(JSONObject().put("at", System.currentTimeMillis()).put("list", a).toString())
    } catch (_: Throwable) {}
  }

  private fun fromSaved(j: JSONObject): List<Pick> {
    val a = j.optJSONArray("list") ?: return emptyList()
    return List(a.length()) { a.getJSONObject(it) }.mapNotNull { o ->
      val it = o.optJSONObject("it") ?: return@mapNotNull null
      Pick(it, o.optString("kicker"), o.optString("why"), o.optString("url")).apply { series = o.optJSONObject("series") }
    }
  }

  /** The saved set, with fresh item data; drop what is gone or since finished. */
  private fun recheck(j: JSONObject): List<Pick>? {
    val saved = fromSaved(j)
    if (saved.isEmpty()) return null
    val ids = saved.joinToString(",") { it.it.optString("Id") }
    val d = Net.getNow("/Users/{userId}/Items?Ids=$ids&Fields=$FIELDS,Overview,DateCreated,Genres&$IMG_OPTS&EnableUserData=true")
    val byId = Net.items(d).associateBy { it.optString("Id") }
    val out = ArrayList<Pick>()
    for (p in saved) {
      val it = byId[p.it.optString("Id")] ?: continue
      if (it.optString("Type") != "Series" && (it.optJSONObject("UserData")?.optBoolean("Played") ?: false)) continue
      val b = bd(it) ?: continue
      out.add(Pick(it, p.kicker, p.why, Net.image(b.first, "Backdrop/0", b.second, if (Img.lowMemory) 1280 else 1920, 90)))
    }
    return if (out.size >= minOf(3, saved.size)) out else null
  }

  private fun ago(d: String): String {
    val days = ((System.currentTimeMillis() - Card.time(d)) / DAY).toInt()
    if (days < 1) return "today"
    if (days == 1) return "yesterday"
    if (days < 14) return "$days days ago"
    if (days < 60) return "${Math.round(days / 7f)} weeks ago"
    if (days < 365) return "${Math.round(days / 30f)} months ago"
    val y = Math.round(days / 365f)
    return if (y == 1) "a year ago" else "$y years ago"
  }

  private class Cand(val it: JSONObject, val kicker: String, val why: String, val list: Int)

  private fun choose(): List<Pick> {
    val f = "Fields=$FIELDS,Overview,DateCreated,Genres&$IMG_OPTS&EnableUserData=true"
    fun get(p: String) = try { Net.items(Net.getNow(p)) } catch (_: Throwable) { emptyList() }
    val now = System.currentTimeMillis()
    val recentMode = mode() == "recent"
    val latest = get("/Users/{userId}/Items?SortBy=DateCreated&SortOrder=Descending&IncludeItemTypes=Movie,Series&Recursive=true&Filters=IsUnplayed&Limit=30&$f")
    val added = latest.map { Cand(it, "JUST ADDED", "Added " + ago(it.optString("DateCreated")), 3) }
    val pools: List<MutableList<Cand>>
    if (recentMode) pools = listOf(added.toMutableList())
    else {
      val resume = get("/Users/{userId}/Items/Resume?Limit=40&Recursive=true&MediaTypes=Video&$f")
      val nextUp = get("/Shows/NextUp?UserId={userId}&Limit=30&$f")
      val recent = get("/Users/{userId}/Items?SortBy=DatePlayed&SortOrder=Descending&Filters=IsPlayed&IncludeItemTypes=Movie,Episode&Recursive=true&Limit=6&$f")
      val gems = get("/Users/{userId}/Items?SortBy=Random&IncludeItemTypes=Movie,Series&Recursive=true&Filters=IsUnplayed&MinCommunityRating=7.2&Limit=40&$f")
      val favs = get("/Users/{userId}/Items?SortBy=Random&IncludeItemTypes=Movie,Series&Recursive=true&Filters=IsFavorite&Limit=40&$f")
      val lastPlayed = { it: JSONObject -> Card.time(it.optJSONObject("UserData")?.optString("LastPlayedDate")) }
      val pickBack = resume.filter { lastPlayed(it) > 0 && now - lastPlayed(it) > 3 * DAY }.sortedBy { lastPlayed(it) }
        .map { Cand(it, "PICK BACK UP", "You stopped here " + ago(it.optJSONObject("UserData")!!.optString("LastPlayedDate")), 0) }
      val newEps = nextUp.filter { val c = Card.time(it.optString("DateCreated")); c > 0 && now - c < 14 * DAY }
        .map { Cand(it, "NEW EPISODE", "A show you watch · added " + ago(it.optString("DateCreated")), 1) }
      val never = gems.filter { val c = Card.time(it.optString("DateCreated")); c > 0 && now - c > 180 * DAY && it.optDouble("CommunityRating", 0.0) >= 7.2 }
        .map { Cand(it, "IN YOUR LIBRARY, NEVER WATCHED", "Added in ${java.util.Calendar.getInstance().apply { timeInMillis = Card.time(it.optString("DateCreated")) }.get(java.util.Calendar.YEAR)} · rated ${"%.1f".format(it.optDouble("CommunityRating"))}", 4) }
      val oldFavs = favs.filter { lastPlayed(it) == 0L || now - lastPlayed(it) > 365 * DAY }
        .map { Cand(it, "FROM YOUR FAVORITES", if (lastPlayed(it) > 0) "Last watched " + ago(it.optJSONObject("UserData")!!.optString("LastPlayedDate")) else "One of your favorites", 5) }
      var because = emptyList<Cand>()
      recent.firstOrNull()?.let { last ->
        val ep = last.optString("Type") == "Episode"
        val baseId = if (ep) last.optString("SeriesId") else last.optString("Id")
        val baseName = if (ep) last.optString("SeriesName") else last.optString("Name")
        because = get("/Items/$baseId/Similar?UserId={userId}&Limit=12&$f").filter { !(it.optJSONObject("UserData")?.optBoolean("Played") ?: false) }
          .map { val g = it.optJSONArray("Genres"); Cand(it, "BECAUSE YOU WATCHED " + baseName.uppercase(), if (g != null && g.length() > 0) List(minOf(2, g.length())) { k -> g.getString(k) }.joinToString(" · ") else "Similar to what you watched", 2) }
      }
      pools = listOf(pickBack.toMutableList(), newEps.toMutableList(), because.toMutableList(), added.toMutableList(), never.toMutableList(), oldFavs.toMutableList())
    }
    // Take turns from each reason so the banner is a mix; at most 2 "pick back up".
    val caps = if (recentMode) intArrayOf(99) else intArrayOf(2, 3, 3, 3, 3, 3)
    val taken = IntArray(pools.size)
    val seen = HashSet<String>()
    val queue = ArrayList<Cand>()
    for (round in 0 until 8) for ((k, list) in pools.withIndex()) {
      if (taken[k] >= caps[k]) continue
      while (list.isNotEmpty()) {
        val c = list.removeAt(0)
        val key = c.it.optString("SeriesId").ifEmpty { c.it.optString("Id") }
        if (key in seen || bd(c.it) == null) continue
        seen.add(key); queue.add(c); taken[k]++; break
      }
    }
    // Only pictures that are really wide and sharp get in (checked a few at a time, keeping the mix).
    val out = ArrayList<Pick>()
    var n = 0
    while (n < queue.size && out.size < 6) {
      val batch = queue.subList(n, minOf(queue.size, n + 4)).toList()
      n += 4
      val ok = batch.map { c ->
        val b = bd(c.it)!!
        val url = Net.image(b.first, "Backdrop/0", b.second, if (Img.lowMemory) 1280 else 1920, 90)
        val sz = Img.sizeNow(url)
        val good = sz != null && sz.first >= 1280 && sz.first.toFloat() / sz.second in 1.55f..2.1f
        if (good) Pick(c.it, c.kicker, c.why, url) else null
      }
      for (p in ok) if (p != null && out.size < 6) out.add(p)
    }
    return out
  }

  private fun bd(it: JSONObject): Pair<String, String>? {
    val t = it.optJSONArray("BackdropImageTags")?.optString(0)
    if (!t.isNullOrEmpty()) return it.optString("Id") to t
    val pb = it.optJSONArray("ParentBackdropImageTags")?.optString(0)
    if (!pb.isNullOrEmpty() && it.optString("ParentBackdropItemId").isNotEmpty()) return it.optString("ParentBackdropItemId") to pb
    return null
  }

  // ---------------- pressing ----------------

  fun moreX(): Float = 213f + (picks.getOrNull(i)?.layout?.let { playW(it.playLabel) } ?: 189f) + 8f

  fun press(col: Int) {
    val p = picks.getOrNull(i) ?: return
    val it = p.it
    if (col == 1) {
      val id = if (it.optString("Type") == "Episode" && it.optString("SeriesId").isNotEmpty()) it.optString("SeriesId") else it.optString("Id")
      TvView.kinds[id] = if (id == it.optString("Id")) it.optString("Type") else "Series"
      tv.host.go("#/item/" + Card.enc(id)); return
    }
    if (it.optString("Type") == "Series") tv.host.playSeries(it.optString("Id")) else tv.host.play(it.optString("Id"))
  }

  // ---------------- drawing ----------------

  private val waitP = Ui.fill(0xFF1A1213.toInt())
  private val shimmer = Paint()
  private val sideFade = Paint().apply {
    shader = LinearGradient(117f, 0f, 1920f, 0f, intArrayOf(Ui.BG, Ui.alpha(Ui.BG, 0.8f), Ui.alpha(Ui.BG, 0.15f), Ui.alpha(Ui.BG, 0f)), floatArrayOf(0f, 0.32f, 0.65f, 1f), Shader.TileMode.CLAMP)
  }
  private val bottomFade = Paint().apply {
    shader = LinearGradient(0f, 0f, 0f, 799f, intArrayOf(Ui.alpha(Ui.BG, 0f), Ui.alpha(Ui.BG, 0f), Ui.BG, Ui.BG), floatArrayOf(0f, 0.5f, 0.94f, 1f), Shader.TileMode.CLAMP)
  }
  private val bgP = Ui.fill(Ui.BG)
  private val kicker = Ui.text(Ui.f800, 16f, 0xFFEDA7AA.toInt(), 2.67f)
  private val dot = Ui.fill(Ui.RED)
  private val titleP = Ui.text(Ui.f800, 72f, Ui.TEXT, -1.33f).apply { setShadowLayer(24f, 0f, 2.67f, 0x80000000.toInt()) }
  private val metaP = Ui.text(Ui.f400, 18.67f, Ui.MUTED)
  private val whyP = Ui.text(Ui.f600, 16.67f, 0xFFE9DADB.toInt())
  private val whyBg = Ui.fill(0xCC1E1415.toInt())
  private val whyBd = Ui.stroke(Ui.LINE, 2f)
  private val overP = Ui.text(Ui.f400, 20f, 0xFFEADADA.toInt())
  private val btnP = Ui.text(Ui.f800, 21.33f, Ui.WHITE)
  private val btnRed = Ui.fill(Ui.RED)
  private val btn2 = Ui.fill(0x14FFFFFF)
  private val outline = Ui.stroke(Ui.WHITE, 4f)
  private val dotOff = Ui.fill(Ui.LINE)
  private val playTri = Path().apply { moveTo(8f, 5f); lineTo(8f, 19f); lineTo(19f, 12f); close() }
  private val white = Ui.fill(Ui.WHITE)
  private val r = RectF()

  private fun playW(label: String) = 34.67f * 2 + 29.33f + 6f + btnP.measureText(label)

  private fun layouts(p: Pick): Layouts {
    p.layout?.let { if (it.playLabel == playLabel(p)) return it }
    val it = p.it
    val ser = if (it.optString("Type") == "Episode") p.series else null
    val ud = it.optJSONObject("UserData") ?: JSONObject()
    val pos = ud.optLong("PlaybackPositionTicks"); val rt = it.optLong("RunTimeTicks")
    val resumable = pos > 0 && rt > 0
    val title = ser?.optString("Name")?.ifEmpty { null } ?: it.optString("SeriesName").ifEmpty { it.optString("Name") }
    val meta = if (it.optString("Type") == "Episode") listOf(Card.epCode(it), it.optString("Name"), if (resumable) Card.runtime(rt - pos) + " left" else "").filter { s -> s.isNotEmpty() }.joinToString(" · ")
      else listOf(if (it.optInt("ProductionYear") > 0) it.optInt("ProductionYear").toString() else "",
        if (it.optString("Type") == "Series") (it.optInt("ChildCount").let { n -> if (n > 0) "$n season${if (n == 1) "" else "s"}" else "" }) else if (rt > 0) Card.runtime(rt) else "",
        it.optString("OfficialRating"), if (resumable) Card.runtime(rt - pos) + " left" else "").filter { s -> s.isNotEmpty() }.joinToString(" · ")
    val overview = (ser?.optString("Overview")?.ifEmpty { null } ?: it.optString("Overview"))
    val tl = StaticLayout.Builder.obtain(title, 0, title.length, titleP, 780).setLineSpacing(0f, 73.4f / (titleP.fontMetrics.descent - titleP.fontMetrics.ascent)).setIncludePad(false).build()
    val ol = if (overview.isEmpty()) null else StaticLayout.Builder.obtain(overview, 0, overview.length, overP, 780).setMaxLines(3).setEllipsize(TextUtils.TruncateAt.END)
      .setLineSpacing(0f, 31f / (overP.fontMetrics.descent - overP.fontMetrics.ascent)).setIncludePad(false).setAlignment(Layout.Alignment.ALIGN_NORMAL).build()
    return Layouts(tl, ol, meta, playLabel(p)).also { p.layout = it }
  }

  private fun playLabel(p: Pick): String {
    val it = p.it
    if (it.optString("Type") == "Series") { if (p.label == null) seriesLabel(p); return p.label ?: "Play" }
    val ud = it.optJSONObject("UserData") ?: JSONObject()
    return if (ud.optLong("PlaybackPositionTicks") > 0 && it.optLong("RunTimeTicks") > 0) "Resume" else if (ud.optBoolean("Played")) "Play again" else "Play"
  }

  /** Shows: the Play button says which episode it will start (seriesTarget in components.js). */
  private fun seriesLabel(p: Pick) {
    p.label = "Play"
    val sid = p.it.optString("Id")
    Net.bg {
      val ef = "Fields=Overview,PrimaryImageAspectRatio"
      fun one(path: String) = try { Net.items(Net.getNow(path)).firstOrNull() } catch (_: Throwable) { null }
      val resume = one("/Users/{userId}/Items/Resume?ParentId=$sid&Recursive=true&MediaTypes=Video&Limit=1&$ef")
      val next = one("/Shows/NextUp?SeriesId=$sid&UserId={userId}&Limit=1&$ef")
      val firsts = try { Net.items(Net.getNow("/Shows/$sid/Episodes?UserId={userId}&Limit=40&$ef")) } catch (_: Throwable) { emptyList() }
      val first = firsts.firstOrNull { it.optInt("ParentIndexNumber", -1) != 0 } ?: firsts.firstOrNull()
      val ep = resume ?: next?.takeIf { first == null || it.optString("Id") != first.optString("Id") }
      val label = if (ep != null) ("Play " + Card.epCode(ep)).trim() else "Play"
      Net.main.post { p.label = label; p.layout = null; tv.invalidate() }
    }
  }

  fun draw(c: Canvas, now: Long, dt: Float, focused: Boolean, col: Int, fast: Boolean): Boolean {
    var anim = false
    c.save(); c.clipRect(117f, 0f, Ui.W, 799f)
    if (picks.isEmpty()) {
      c.drawRect(117f, 0f, Ui.W, 799f, waitP)
      val x = 117f + ((now % 1400) / 1400f) * 1803f * 2f - 1803f
      shimmer.shader = LinearGradient(x, 0f, x + 1803f, 0f, intArrayOf(0xFF1A1213.toInt(), 0xFF241819.toInt(), 0xFF1A1213.toInt()), null, Shader.TileMode.CLAMP)
      c.drawRect(117f, 0f, Ui.W, 799f, shimmer)
      c.restore(); return true
    }
    // Next slide every 8 s.
    if (running && picks.size > 1) {
      if (nextAt == 0L) nextAt = now + 8000
      if (now >= nextAt) { prevUrl = picks[i].url; i = (i + 1) % picks.size; slideAt = now; nextAt = now + 8000 }
      anim = true
    }
    val p = picks[i]
    c.drawRect(117f, 0f, Ui.W, 799f, bgP)
    r.set(117f, 0f, Ui.W, 799f)
    val prev = Img.peek(prevUrl)
    val pic = Img.get(p.url)
    val a = if (pic == null) 0f else ((now - maxOf(pic.at, slideAt)) / 300f).coerceIn(0f, 1f)
    if (prev != null && a < 1f) Img.draw(c, prev, r, 0f, 1f, 0f)
    if (pic != null) Img.draw(c, pic, r, 0f, a, 0f)
    if (a < 1f) anim = true
    c.drawRect(117f, 0f, Ui.W, 799f, sideFade)
    c.drawRect(117f, 0f, Ui.W, 799f, bottomFade)
    c.drawRect(117f, 799f - 8f, Ui.W, 799f, bgP)
    // Text, laid out from the buttons up (the block sits 85 above the banner's bottom edge).
    val L = layouts(p)
    val tIn = Ui.ease(((now - slideAt - 50) / 550f).coerceIn(0f, 1f))
    if (tIn < 1f) anim = true
    val btnTop = 647f + 0f
    var y = btnTop - 29.33f
    val ovH = L.overview?.height?.toFloat() ?: 0f
    val ovTop = y - ovH; y = ovTop - 16f
    val whyTop = y - 41f; y = whyTop - 16f
    val metaH = if (L.meta.isEmpty()) 0f else 27f
    val metaTop = y - metaH; y = metaTop - 13.33f
    val titleTop = y - L.title.height; y = titleTop - 10.67f
    val kTop = y - 23f
    // (The whole block is anchored at the bottom; a two-line title pushes the top up, as on the web.)
    val shift = (1f - tIn) * 40f
    val alpha = (255 * tIn).toInt()
    c.save(); c.translate(shift, 0f)
    dot.alpha = alpha; kicker.alpha = alpha; titleP.alpha = alpha; metaP.alpha = alpha; whyP.alpha = alpha; overP.alpha = alpha; whyBg.alpha = (0xCC * tIn).toInt(); whyBd.alpha = alpha
    r.set(213f, kTop + 7.5f, 221f, kTop + 15.5f); c.drawRoundRect(r, 4f, 4f, dot)
    Ui.line(c, p.kicker, 231.67f, kTop, 23f, kicker)
    c.save(); c.translate(213f, titleTop); L.title.draw(c); c.restore()
    if (L.meta.isNotEmpty()) Ui.line(c, L.meta, 213f, metaTop, 27f, metaP)
    val ww = whyP.measureText(p.why) + 32f + 4f
    r.set(213f, whyTop, 213f + ww, whyTop + 41f); c.drawRoundRect(r, 20.5f, 20.5f, whyBg); r.inset(1f, 1f); c.drawRoundRect(r, 19.5f, 19.5f, whyBd)
    Ui.line(c, p.why, 213f + 18f, whyTop, 41f, whyP)
    L.overview?.let { c.save(); c.translate(213f, ovTop); it.draw(c); c.restore() }
    c.restore()
    // Buttons (not part of the slide-in, so the highlight never moves).
    val pw = playW(L.playLabel)
    r.set(213f, btnTop, 213f + pw, btnTop + 67f); c.drawRoundRect(r, 13.33f, 13.33f, btnRed)
    if (focused && col == 0) { r.inset(-6f, -6f); c.drawRoundRect(r, 19.33f, 19.33f, outline) }
    c.save(); c.translate(213f + 34.67f, btnTop + 33.5f - 14.67f); c.scale(29.33f / 24f, 29.33f / 24f); c.drawPath(playTri, white); c.restore()
    btnP.color = Ui.WHITE
    Ui.line(c, L.playLabel, 213f + 34.67f + 29.33f + 6f, btnTop, 67f, btnP)
    val mx = 213f + pw + 16f
    val mw = 34.67f * 2 + btnP.measureText("More info")
    r.set(mx, btnTop, mx + mw, btnTop + 67f); c.drawRoundRect(r, 13.33f, 13.33f, btn2)
    if (focused && col == 1) { r.inset(-6f, -6f); c.drawRoundRect(r, 19.33f, 19.33f, outline) }
    btnP.color = 0xFFE9DADB.toInt()
    Ui.line(c, "More info", mx + 34.67f, btnTop, 67f, btnP)
    // Dots.
    if (picks.size > 1) {
      var dx = 213f
      for (k in picks.indices) {
        val w = if (k == i) 40f else 13.33f
        r.set(dx, 751f, dx + w, 764.33f); c.drawRoundRect(r, 6.67f, 6.67f, if (k == i) dot.also { it.alpha = 255 } else dotOff)
        dx += w + 10.67f
      }
    }
    c.restore()
    return anim
  }
}
