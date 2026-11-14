package app.scrappy.player.tv

import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.text.Layout
import android.text.StaticLayout
import android.text.TextUtils
import android.view.KeyEvent
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

/** A film's or a show's page, drawn natively. Same buttons, pickers, seasons, episodes, cast and
 *  "More like this" as renderItem() / renderSeasonBrowser() in views.js on the TV (approved mock). */
class Detail(tv: TvView, val itemId: String) : Screen(tv) {
  override val railKey = ""

  private val FIELDS = "PrimaryImageAspectRatio,ProductionYear,EndDate,BasicSyncInfo"
  private val IMG_OPTS = "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Thumb"
  private val EP_FIELDS = "Fields=Overview,PrimaryImageAspectRatio"

  private var it: JSONObject? = null
  private var shownKey = ""
  private var wantSeason = ""
  private var loaded = false
  private var gen = 0
  private val isSeries get() = it?.optString("Type") == "Series"

  // ---------- what the page holds ----------
  private class Btn(val kind: String, var label: String, var icon: String? = null) { var x = 0f; var w = 0f; var on = false }
  private var buttons = ArrayList<Btn>()
  private class Pick(val kind: String, val label: String) { var options: List<String> = emptyList(); var cur = 0; var x = 0f; var w = 0f; var selX = 0f }
  private var picks = ArrayList<Pick>()
  private var media: JSONObject? = null // the item (film) or the episode Play starts (show) — tracks and quality come from it
  private var tracks = JSONObject()

  // Show: what Play starts.
  private var target: JSONObject? = null
  private var first: JSONObject? = null
  private var started = false
  private var resume = false
  private var playSub = ""

  // Seasons and episodes.
  private var seasons: List<JSONObject> = emptyList()
  private var selected = ""
  private var epView = "row"
  private var epViewSet = false
  private var eps: List<Card> = emptyList()
  private var epData: List<JSONObject> = emptyList()
  private var upNext = -1
  private var block = 0
  private var blocks = 1
  private val GRID_BLOCK = 50
  private val tabsX = Glide()
  private val epsX = Glide()
  private var tabW = FloatArray(0)

  private class Person(val id: String, val name: String, val role: String, val img: String?, val pc: Int, val ini: String) { var f = 0f }
  private var people: List<Person> = emptyList()
  private val castX = Glide()
  private var similar: List<Card> = emptyList()
  private val simX = Glide()

  // ---------- layout (1080p units, page coordinates) ----------
  private var titleL: StaticLayout? = null
  private var overL: StaticLayout? = null
  private var titleTop = 0f; private var metaTop = 0f; private var overTop = 0f; private var barTop = 0f; private var btnTop = 0f
  private var pickTop = 0f; private var resumeTop = -1f; private var subTop = 0f
  private var epTop = 0f; private var epBottom = 0f
  private var castT = 0f; private var simT = 0f
  private var mainBottom = 0f
  private var gridLines: List<Pair<Float, List<Int>>> = emptyList() // grid: line top, indexes into eps
  private var gridHeads: List<Pair<Float, String>> = emptyList()
  private var blocksTop = -1f

  // ---------- focus ----------
  // Rows: B = buttons, P = pickers, T = season bar, K = grid blocks, E = episodes, C = cast, S = similar.
  private var rowsOrder: List<Char> = emptyList()
  private var row = 'B'
  private var col = 0
  private val visited = HashSet<Char>()
  private val sy = Glide()
  private var stripAt = 0L; private var stripOn = false

  // ---------------- data ----------------

  override fun show(fresh: Boolean) {
    val parts = tv.routeHash.substringBefore('?').split('/')
    val s = if (parts.size > 3) java.net.URLDecoder.decode(parts[3], "UTF-8") else ""
    if (s.isNotEmpty() && s != selected && loaded && isSeries) { wantSeason = s; pickSeason(s) }
    if (loaded) return
    loaded = true
    wantSeason = s
    load()
  }

  override fun stale() { if (loaded) load(quiet = true) }

  private fun load(quiet: Boolean = false) {
    val my = ++gen
    Net.load("/Users/{userId}/Items/$itemId") { v, _ ->
      if (my != gen) return@load
      val o = v as? JSONObject ?: return@load
      val type = o.optString("Type")
      TvView.kinds[itemId] = type
      if (type == "Season" && o.optString("SeriesId").isNotEmpty()) {
        tv.host.replace("#/item/" + Card.enc(o.optString("SeriesId")) + "/" + Card.enc(itemId), true); return@load
      }
      if (type != "Movie" && type != "Series") { tv.host.reroute(); return@load }
      val key = key(o)
      if (key == shownKey) return@load
      val firstTime = it == null
      shownKey = key
      it = o
      build(firstTime)
      if (firstTime || quiet) more()
      tv.invalidate()
    }
  }

  /** Only what the page shows (fresh data that differs in small details doesn't redraw). */
  private fun key(o: JSONObject): String {
    val ud = o.optJSONObject("UserData") ?: JSONObject()
    return listOf(o.optString("Name"), o.optString("Overview"), ud.optBoolean("Played"), ud.optBoolean("IsFavorite"), ud.optLong("PlaybackPositionTicks"),
      o.optJSONObject("ImageTags")?.toString(), o.optJSONArray("BackdropImageTags")?.toString(), o.optJSONArray("People")?.length(), o.optInt("ChildCount")).joinToString("|")
  }

  private fun more() {
    val o = it ?: return
    val my = gen
    Net.load("/Items/$itemId/Similar?UserId={userId}&Limit=20&Fields=$FIELDS&$IMG_OPTS") { v, _ ->
      if (my != gen && similar.isNotEmpty()) return@load
      val old = similar.associateBy { c -> c.id }
      similar = Net.items(v).map { j -> Card(j, Shape.PORTRAIT).also { c -> c.f = old[c.id]?.f ?: 0f } }
      layout(); tv.invalidate()
    }
    tv.host.local("tracks:$itemId") { s -> tracks = try { JSONObject(s ?: "{}") } catch (_: Throwable) { JSONObject() }; buildPicks(); tv.invalidate() }
    if (o.optString("Type") == "Series") {
      tv.host.local("epView:$itemId") { s -> if (s == "grid" || s == "row" || s == "list") { epView = if (s == "list") "row" else s; epViewSet = true }; loadSeasons() }
      loadTarget()
    }
  }

  private fun loadSeasons() {
    Net.load("/Shows/$itemId/Seasons?UserId={userId}&Fields=$FIELDS,ChildCount") { v, _ ->
      val all = Net.items(v)
      seasons = all.filter { s -> s.optInt("IndexNumber", -1) != 0 } + all.filter { s -> s.optInt("IndexNumber", -1) == 0 }
      measureTabs()
      if (seasons.isEmpty()) { layout(); tv.invalidate(); return@load }
      val pick = seasons.firstOrNull { s -> s.optString("Id") == selected.ifEmpty { wantSeason } }
        ?: seasons.firstOrNull { s -> s.optInt("IndexNumber", -1) != 0 && (s.optJSONObject("UserData")?.optInt("UnplayedItemCount") ?: 0) > 0 }
        ?: seasons[0]
      if (!epViewSet) epView = if (pick.optInt("ChildCount") > 30) "grid" else "row"
      if (selected != "all") selected = pick.optString("Id")
      buildButtons(); loadEpisodes(false)
    }
  }

  private fun pickSeason(id: String) {
    if (id == selected) return
    selected = id
    if (id != "all") tv.host.replace("#/item/" + Card.enc(itemId) + "/" + Card.enc(id), false)
    loadEpisodes(true)
  }

  private var epGen = 0
  private fun loadEpisodes(live: Boolean) {
    val my = ++epGen
    val all = selected == "all"
    Net.load("/Shows/$itemId/Episodes?" + (if (all) "" else "SeasonId=$selected&") + "UserId={userId}&Fields=Overview,PrimaryImageAspectRatio") { v, _ ->
      if (my != epGen) return@load
      var list = Net.items(v)
      if (all) list = list.filter { e -> e.optInt("ParentIndexNumber", -1) != 0 } + list.filter { e -> e.optInt("ParentIndexNumber", -1) == 0 }
      val keepF = eps.associate { c -> c.id to c.f }
      epData = list
      eps = list.map { e -> Card(e, Shape.WIDE).also { c -> c.f = keepF[c.id] ?: 0f } }
      upNext = list.indexOfFirst { e -> (e.optJSONObject("UserData")?.optLong("PlaybackPositionTicks") ?: 0L) > 0 && !(e.optJSONObject("UserData")?.optBoolean("Played") ?: false) }
      if (upNext < 0) upNext = list.indexOfFirst { e -> !(e.optJSONObject("UserData")?.optBoolean("Played") ?: false) }
      blocks = if (epView == "grid" && !all) maxOf(1, (list.size + GRID_BLOCK - 1) / GRID_BLOCK) else 1
      if (live || block >= blocks) block = if (epView == "grid" && !all) maxOf(0, maxOf(0, upNext) / GRID_BLOCK) else 0
      if (!visited.contains('E') || live) {
        val here = maxOf(0, upNext)
        if (epView == "row") epsX.set(maxOf(0f, minOf(here * EP_PITCH + 4f, epMaxScroll())), true)
      }
      if (row == 'E') col = col.coerceIn(0, maxOf(0, epIndexes().size - 1))
      layout(); tv.invalidate()
    }
  }

  /** Show: Play says which episode it starts (seriesTarget in components.js). */
  private fun loadTarget() {
    val my = gen
    Net.bg {
      fun one(path: String) = try { Net.items(Net.getNow(path)).firstOrNull() } catch (_: Throwable) { null }
      val res = one("/Users/{userId}/Items/Resume?ParentId=$itemId&Recursive=true&MediaTypes=Video&Limit=1&$EP_FIELDS")
      val next = one("/Shows/NextUp?SeriesId=$itemId&UserId={userId}&Limit=1&$EP_FIELDS")
      val firsts = try { Net.items(Net.getNow("/Shows/$itemId/Episodes?UserId={userId}&Limit=40&$EP_FIELDS")) } catch (_: Throwable) { emptyList() }
      val f = firsts.firstOrNull { e -> e.optInt("ParentIndexNumber", -1) != 0 } ?: firsts.firstOrNull()
      val t: JSONObject?; val st: Boolean; val rs: Boolean
      if (res != null) { t = res; st = true; rs = true }
      else if (next != null && (f == null || next.optString("Id") != f.optString("Id"))) { t = next; st = true; rs = false }
      else { t = f; st = false; rs = false }
      var full: JSONObject? = null
      if (t != null) { val p = "/Users/{userId}/Items/" + t.optString("Id"); full = (Net.cachedNow(p) ?: try { Net.getNow(p) } catch (_: Throwable) { null }) as? JSONObject }
      Net.main.post {
        if (my != gen) return@post
        target = t; first = f; started = st; resume = rs
        if (t != null) {
          val ud = t.optJSONObject("UserData") ?: JSONObject()
          val left = if (rs && t.optLong("RunTimeTicks") > 0 && ud.optLong("PlaybackPositionTicks") > 0) Card.runtime(t.optLong("RunTimeTicks") - ud.optLong("PlaybackPositionTicks")) + " left" else ""
          val code = listOf(Card.epCode(t), t.optString("Name"))
          playSub = if (st) (code + left).filter { s -> s.isNotEmpty() }.joinToString(" · ") else "Starts " + code.filter { s -> s.isNotEmpty() }.joinToString(" · ")
        }
        media = full
        buildButtons(); buildPicks(); layout(); tv.invalidate()
      }
    }
  }

  // ---------------- building the pieces ----------------

  private fun build(firstTime: Boolean) {
    val o = it ?: return
    if (!isSeries) media = o
    people = buildPeople(o)
    buildButtons(); buildPicks()
    titleL = null; overL = null
    layout()
    if (firstTime) { row = 'B'; col = 0; visited.add('B') }
  }

  private fun buildPeople(o: JSONObject): List<Person> {
    val a = o.optJSONArray("People") ?: return emptyList()
    val list = List(a.length()) { k -> a.getJSONObject(k) }.filter { p -> p.optString("Id").isNotEmpty() }
    fun rank(p: JSONObject) = when (p.optString("Type")) { "Actor", "GuestStar" -> 0; "Director" -> 1; "Writer" -> 2; else -> 3 }
    return list.withIndex().sortedWith(compareBy({ rank(it.value) }, { it.index })).map { it.value }.take(40).map { p ->
      val name = p.optString("Name").ifEmpty { "?" }
      val role = p.optString("Role").ifEmpty { p.optString("Type").takeIf { t -> t.isNotEmpty() && t != "Actor" }?.replace(Regex("([a-z])([A-Z])"), "$1 $2") ?: "" }
      val tag = p.optString("PrimaryImageTag")
      var n = 7; for (ch in name) n = (n * 31 + ch.code) % 997
      val w = name.trim().split(Regex("\\s+")).filter { s -> s.isNotEmpty() }
      val ini = ((w.firstOrNull()?.take(1) ?: "?") + (if (w.size > 1) w.last().take(1) else "")).uppercase()
      Person(p.optString("Id"), name, role, if (tag.isNotEmpty()) Net.image(p.optString("Id"), "Primary", tag, 300) else null, n % 6, ini)
    }
  }

  private fun playable(o: JSONObject) = o.optString("Type") in Card.PLAYABLE

  private fun buildButtons() {
    val o = it ?: return
    val ud = o.optJSONObject("UserData") ?: JSONObject()
    val out = ArrayList<Btn>()
    if (playable(o)) {
      if (ud.optLong("PlaybackPositionTicks") > 0) { out.add(Btn("resume", "Resume", "play")); out.add(Btn("start", "Play from start")) }
      else out.add(Btn("play", if (ud.optBoolean("Played")) "Play again" else "Play", "play"))
    } else if (isSeries) {
      out.add(Btn("series", if (started && target != null) ("Play " + Card.epCode(target!!)).trim() else "Play", "play"))
      if (started) out.add(Btn("seriesStart", "Play from start"))
    }
    out.add(Btn("played", "", "check").also { b -> b.on = ud.optBoolean("Played") })
    out.add(Btn("fav", "", "heart").also { b -> b.on = ud.optBoolean("IsFavorite") })
    if (isSeries) {
      if (streams("Audio").isNotEmpty() || streams("Subtitle").isNotEmpty()) out.add(Btn("av", "Audio & subtitles"))
      if (seasons.isNotEmpty()) out.add(Btn("view", "Episodes: " + if (epView == "grid") "Grid" else "Row"))
    }
    val focusKind = buttons.getOrNull(col)?.kind
    buttons = out
    var x = if (isSeries) 445f else 589f
    for (b in out) {
      b.x = x
      b.w = if (b.label.isEmpty()) 69f else 34.67f * 2 + btnP.measureText(b.label) + (if (b.icon == "play") 24f + 10.67f else 0f)
      x += b.w + 16f
    }
    if (row == 'B') col = out.indexOfFirst { b -> b.kind == focusKind }.takeIf { i -> i >= 0 } ?: col.coerceIn(0, out.size - 1)
  }

  private fun streams(type: String): List<JSONObject> {
    val m = media ?: return emptyList()
    val a = m.optJSONArray("MediaSources")?.optJSONObject(0)?.optJSONArray("MediaStreams") ?: m.optJSONArray("MediaStreams") ?: return emptyList()
    return List(a.length()) { k -> a.getJSONObject(k) }.filter { s -> s.optString("Type") == type }
  }

  private fun streamLabel(s: JSONObject): String {
    val d = s.optString("DisplayTitle"); if (d.isNotEmpty()) return d
    return listOf(s.optString("Language"), s.optString("Codec").uppercase(), s.optString("Title")).filter { x -> x.isNotEmpty() }.joinToString(" · ").ifEmpty { "Track ${s.optInt("Index")}" }
  }

  private fun sameRef(s: JSONObject, r: JSONObject?): Boolean = r != null && langOf(s.optString("Language")) == langOf(r.optString("lang")) &&
    s.optBoolean("IsForced") == r.optBoolean("forced") && (r.optString("title").isEmpty() || s.optString("Title") == r.optString("title"))

  private fun buildPicks() {
    val audio = streams("Audio"); val subs = streams("Subtitle")
    val out = ArrayList<Pick>()
    if (audio.isNotEmpty() || subs.isNotEmpty()) {
      if (audio.isNotEmpty()) out.add(Pick("audio", "Audio").also { p ->
        p.options = audio.map { s -> streamLabel(s) }
        val i = audio.indexOfFirst { s -> sameRef(s, tracks.optJSONObject("audio")) }
        p.cur = if (i >= 0) i else maxOf(0, audio.indexOfFirst { s -> s.optBoolean("IsDefault") })
      })
      out.add(Pick("sub", "Subtitles").also { p ->
        p.options = listOf("Off") + subs.map { s -> streamLabel(s) } + "Search for more…"
        val off = tracks.optString("sub") == "off"
        var i = if (off) -1 else subs.indexOfFirst { s -> sameRef(s, tracks.optJSONObject("sub")) }
        if (i < 0 && !off) i = subs.indexOfFirst { s -> s.optBoolean("IsDefault") || s.optBoolean("IsForced") }
        p.cur = i + 1
      })
    }
    picks = out
    var x = 589f
    for (p in out) {
      p.x = x
      p.selX = x + pickL.measureText(p.label) + 13.33f
      p.w = (24f + 53.33f + p.options.maxOf { o -> pickV.measureText(o) }).coerceAtMost(560f)
      x = p.selX + p.w + 29.33f
    }
    if (!isSeries) layout()
  }

  private fun writeTrack(kind: String, i: Int) {
    if (kind == "audio") { val s = streams("Audio").getOrNull(i) ?: return; tracks.put("audio", ref(s)) }
    else if (i == streams("Subtitle").size + 1) { media?.optString("Id")?.takeIf { s -> s.isNotEmpty() }?.let { id -> tv.host.subtitles(id) }; return }
    else tracks.put("sub", if (i <= 0) "off" else (streams("Subtitle").getOrNull(i - 1)?.let { s -> ref(s) } ?: return))
    tv.host.setLocal("tracks:$itemId", tracks.toString())
    buildPicks(); tv.invalidate()
  }

  private fun ref(s: JSONObject) = JSONObject().put("lang", s.optString("Language")).put("title", s.optString("Title")).put("forced", s.optBoolean("IsForced"))
    .put("index", s.optInt("Index")).put("external", s.optBoolean("IsExternal")).put("displayTitle", s.optString("DisplayTitle"))

  // ---------------- layout ----------------

  private val EP_PITCH = 400f + 21.33f
  private val GRID_W = (1898f - 85f - 149f - 6 * 16f) / 7f
  private val GRID_H = GRID_W * 225f / 400f
  private val GRID_PITCH = GRID_H + 9f + 24f + 21.33f

  private fun layout() {
    val o = it ?: return
    val name = o.optString("Name")
    if (!isSeries) {
      val tl = titleL ?: StaticLayout.Builder.obtain(name, 0, name.length, titleBig, 1200).setMaxLines(2).setEllipsize(TextUtils.TruncateAt.END)
        .setLineSpacing(0f, 96f / (titleBig.fontMetrics.descent - titleBig.fontMetrics.ascent)).setIncludePad(false).build().also { titleL = it }
      val ov = o.optString("Overview")
      overL = overL ?: if (ov.isEmpty()) null else Ui.clamp(ov, overBig, 853, 3, 33.3f)
      // Laid out from the bottom up (the column sits on the page's bottom edge, like the web page).
      val logoH = if (logoUrl() != null) 200f else tl.height.toFloat()
      var y = 0f
      titleTop = y; y += logoH + 12f
      metaTop = y; y += 32f
      if (overL != null) { y += 22f; overTop = y; y += overL!!.height }
      val ud = o.optJSONObject("UserData") ?: JSONObject()
      if (ud.optLong("PlaybackPositionTicks") > 0 && o.optLong("RunTimeTicks") > 0) { y += 27f; resumeTop = y; y += 5.33f } else resumeTop = -1f
      y += if (resumeTop >= 0) 28f else 29f
      btnTop = y; y += 69f
      if (picks.isNotEmpty()) { y += 19f; pickTop = y; y += 59f }
      val shift = 923f - y
      titleTop += shift; metaTop += shift; overTop += shift; btnTop += shift; pickTop += shift; if (resumeTop >= 0) resumeTop += shift
      mainBottom = 1080f
      castT = 1130f
    } else {
      val tl = titleL ?: StaticLayout.Builder.obtain(name, 0, name.length, titleShow, 1300).setMaxLines(2).setEllipsize(TextUtils.TruncateAt.END)
        .setLineSpacing(0f, 73f / (titleShow.fontMetrics.descent - titleShow.fontMetrics.ascent)).setIncludePad(false).build().also { titleL = it }
      val ov = o.optString("Overview")
      overL = overL ?: if (ov.isEmpty()) null else Ui.clamp(ov, overShow, 960, 2, 29.3f)
      var y = 113f
      titleTop = y; y += (if (logoUrl() != null) 128f else tl.height.toFloat()) + 9f
      metaTop = y; y += 32f
      if (overL != null) { y += 10f; overTop = y; y += overL!!.height }
      y += 22f
      btnTop = y; y += 69f
      if (playSub.isNotEmpty()) { subTop = y + 15f; y = subTop + 27f }
      mainBottom = maxOf(417f, y)
      barTop = mainBottom + 62f
      epTop = barTop + 89f
      // Episodes.
      gridLines = emptyList(); gridHeads = emptyList(); blocksTop = -1f
      if (seasons.isEmpty()) { epBottom = barTop - 89f + 30f }
      else if (epView == "row") epBottom = epTop + 291f
      else {
        var gy = epTop
        if (blocks > 1) { blocksTop = gy; gy += 53f + 21.33f }
        val lines = ArrayList<Pair<Float, List<Int>>>(); val heads = ArrayList<Pair<Float, String>>()
        val idx = epIndexes()
        var k = 0
        var lastSeason: String? = null
        while (k < idx.size) {
          if (selected == "all") {
            val e = epData[idx[k]]
            val sk = e.optString("SeasonId").ifEmpty { e.optInt("ParentIndexNumber").toString() }
            if (sk != lastSeason) {
              lastSeason = sk
              heads.add(gy to e.optString("SeasonName").ifEmpty { if (e.optInt("ParentIndexNumber") > 0) "Season ${e.optInt("ParentIndexNumber")}" else "Specials" })
              gy += 48f
            }
            val line = ArrayList<Int>()
            while (k < idx.size && line.size < 7) {
              val e2 = epData[idx[k]]
              if (e2.optString("SeasonId").ifEmpty { e2.optInt("ParentIndexNumber").toString() } != sk) break
              line.add(k); k++
            }
            lines.add(gy to line); gy += GRID_PITCH
          } else {
            val line = (k until minOf(idx.size, k + 7)).toList(); k += line.size
            lines.add(gy to line); gy += GRID_PITCH
          }
        }
        gridLines = lines; gridHeads = heads
        epBottom = gy - 21.33f
      }
      castT = epBottom + 87f
    }
    simT = if (people.isNotEmpty()) castT + 382f else castT
    val order = ArrayList<Char>()
    order.add('B')
    if (!isSeries && picks.isNotEmpty()) order.add('P')
    if (isSeries && seasons.isNotEmpty()) {
      if (seasons.size > 1 || seasons.size >= 8) order.add('T')
      if (blocks > 1 && epView == "grid") order.add('K')
      if (eps.isNotEmpty()) order.add('E')
    }
    if (people.isNotEmpty()) order.add('C')
    if (similar.isNotEmpty()) order.add('S')
    rowsOrder = order
    if (row !in order) { row = 'B'; col = col.coerceIn(0, maxOf(0, buttons.size - 1)) }
    measureTabs()
  }

  private fun logoUrl(): String? {
    val o = it ?: return null
    val t = o.optJSONObject("ImageTags")?.optString("Logo").orEmpty()
    return if (t.isNotEmpty() && Img.failed(Net.image(itemId, "Logo", t, 800)).not()) Net.image(itemId, "Logo", t, 800) else null
  }

  /** The episodes on screen (Grid: the current block of 50). */
  private fun epIndexes(): List<Int> {
    if (epView == "grid" && selected != "all" && blocks > 1) { val a = block * GRID_BLOCK; return (a until minOf(eps.size, a + GRID_BLOCK)).toList() }
    return eps.indices.toList()
  }

  // Season bar: [Seasons ▾] tabs... (the tabs scroll sideways).
  private fun tabs(): List<Pair<String, String>> {
    if (seasons.size <= 1) return emptyList()
    val total = seasons.sumOf { s -> s.optInt("ChildCount") }
    return seasons.map { s -> s.optString("Id") to s.optString("Name") } + ("all" to "All")
  }
  private fun tabCount(id: String): Int = if (id == "all") seasons.sumOf { s -> s.optInt("ChildCount") } else seasons.firstOrNull { s -> s.optString("Id") == id }?.optInt("ChildCount") ?: 0
  private val hasPick get() = seasons.size >= 8
  private val TABS_X get() = if (hasPick) 346f else 150f
  private fun measureTabs() {
    val t = tabs()
    tabW = FloatArray(t.size) { k ->
      val n = tabCount(t[k].first)
      26.67f * 2 + tabP.measureText(t[k].second) + if (n > 0) 8f + tabN.measureText(n.toString()) else 0f
    }
  }
  private fun tabLeft(k: Int): Float { var x = 0f; for (j in 0 until k) x += tabW.getOrElse(j) { 0f } + 16f; return x }

  // ---------------- remote ----------------

  private fun rowLen(r: Char): Int = when (r) {
    'B' -> buttons.size; 'P' -> picks.size; 'T' -> tabs().size + (if (hasPick) 1 else 0); 'K' -> blocks
    'E' -> epIndexes().size; 'C' -> people.size; 'S' -> similar.size; else -> 0
  }

  /** Where the highlight sits on screen (x centre), for going up and down to the nearest thing. */
  private fun focusX(r: Char, c: Int): Float = when (r) {
    'B' -> buttons.getOrNull(c)?.let { b -> b.x + b.w / 2f } ?: 0f
    'P' -> picks.getOrNull(c)?.let { p -> p.selX + p.w / 2f } ?: 0f
    'T' -> if (hasPick && c == 0) 235f else { val k = c - (if (hasPick) 1 else 0); TABS_X + tabLeft(k) - tabsX.pos + (tabW.getOrNull(k) ?: 0f) / 2f }
    'K' -> 149f + c * 150f + 60f
    'E' -> if (epView == "row") 149f + c * EP_PITCH - epsX.pos + 200f else { val line = gridLines.firstOrNull { l -> c in l.second }; val p = line?.second?.indexOf(c) ?: 0; 149f + p * (GRID_W + 16f) + GRID_W / 2f }
    'C' -> 149f + c * 221.33f - castX.pos + 100f
    'S' -> 149f + c * 248.33f - simX.pos + 113.5f
    else -> 0f
  }

  private fun nearest(r: Char, x: Float): Int {
    var best = 0; var bd = Float.MAX_VALUE
    val n = rowLen(r)
    if (r == 'E' && epView == "grid") { // the top line of the grid when coming from above, the bottom line from below
      return 0
    }
    for (k in 0 until n) { val d = abs(focusX(r, k) - x); if (d < bd) { bd = d; best = k } }
    return best
  }

  private fun here(r: Char): Int? = when (r) {
    'T' -> { val k = tabs().indexOfFirst { t -> t.first == selected }; if (k >= 0) k + (if (hasPick) 1 else 0) else null }
    'E' -> if (upNext >= 0) epIndexes().indexOf(upNext).takeIf { i -> i >= 0 } else null
    'K' -> block
    else -> null
  }

  // Cast and More like this start at their first entry, then come back to where you left them (as on the web page).
  private val lastCol = HashMap<Char, Int>()
  private fun enter(r: Char, fromX: Float, down: Boolean) {
    if (row == 'C' || row == 'S') lastCol[row] = col
    row = r
    val h = here(r)
    col = when {
      r == 'T' && h != null -> h
      h != null && r !in visited -> h
      r == 'C' || r == 'S' -> lastCol[r] ?: 0
      r == 'E' && epView == "grid" -> gridEnter(fromX, down)
      else -> nearest(r, fromX)
    }.coerceIn(0, maxOf(0, rowLen(r) - 1))
    visited.add(r)
    aim()
  }

  private fun gridEnter(x: Float, down: Boolean): Int {
    val line = (if (down) gridLines.firstOrNull() else gridLines.lastOrNull()) ?: return 0
    var best = line.second.firstOrNull() ?: 0; var bd = Float.MAX_VALUE
    for ((p, k) in line.second.withIndex()) { val d = abs(149f + p * (GRID_W + 16f) + GRID_W / 2f - x); if (d < bd) { bd = d; best = k } }
    return best
  }

  override fun behind() = abs(sy.to - sy.pos)

  override fun key(k: Int): Boolean {
    val n = rowLen(row)
    when (k) {
      KeyEvent.KEYCODE_DPAD_LEFT -> {
        if (row == 'E' && epView == "grid") {
          val line = gridLines.firstOrNull { l -> col in l.second } ?: return false
          if (line.second.first() == col) return false
          col--; aim(); return true
        }
        if (col == 0) return false
        col--; aim(); return true
      }
      KeyEvent.KEYCODE_DPAD_RIGHT -> {
        if (row == 'E' && epView == "grid") {
          val line = gridLines.firstOrNull { l -> col in l.second } ?: return true
          if (line.second.last() != col) { col++; aim() }
          return true
        }
        if (col < n - 1) { col++; aim() }
        return true
      }
      KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_UP -> {
        val down = k == KeyEvent.KEYCODE_DPAD_DOWN
        if (row == 'E' && epView == "grid") {
          val li = gridLines.indexOfFirst { l -> col in l.second }
          val ni = if (down) li + 1 else li - 1
          if (li >= 0 && ni in gridLines.indices) {
            val x = focusX('E', col)
            val line = gridLines[ni].second
            var best = line.first(); var bd = Float.MAX_VALUE
            for ((p, j) in line.withIndex()) { val d = abs(149f + p * (GRID_W + 16f) + GRID_W / 2f - x); if (d < bd) { bd = d; best = j } }
            col = best; aim(); return true
          }
        }
        val i = rowsOrder.indexOf(row)
        val j = if (down) i + 1 else i - 1
        if (j !in rowsOrder.indices) return true
        enter(rowsOrder[j], focusX(row, col), down)
        return true
      }
    }
    return true
  }

  private fun aim(instant: Boolean = false) {
    // Sideways rows keep the highlight in view.
    when (row) {
      'E' -> if (epView == "row") epsX.set(scrollFor(col, 400f, EP_PITCH, eps.size), instant)
      'C' -> castX.set(scrollFor(col, 200f, 221.33f, people.size), instant)
      'S' -> simX.set(scrollFor(col, 227f, 248.33f, similar.size), instant)
      'T' -> {
        val k = col - (if (hasPick) 1 else 0)
        if (k >= 0 && k < tabW.size) {
          val vis = 1835f - TABS_X
          val l = tabLeft(k); val r = l + tabW[k]
          var to = tabsX.to
          if (l - to < 75f) to = l - 75f
          if (r - to > vis - 75f) to = r - vis + 75f
          val max = maxOf(0f, tabLeft(tabW.size - 1) + (tabW.lastOrNull() ?: 0f) - vis)
          tabsX.set(to.coerceIn(0f, max), instant)
        }
      }
    }
    // Up and down.
    val y = when (row) {
      'B', 'P', 'T', 'K' -> 0f
      'E' -> if (epView == "row") maxOf(0f, epBottom - 1040f) else {
        val line = gridLines.firstOrNull { l -> col in l.second }
        if (line == null) 0f else {
          var t = sy.to
          val top = line.first; val bot = top + GRID_PITCH
          if (bot - t > 1040f) t = bot - 1040f
          if (top - t < 200f) t = top - 200f
          maxOf(0f, t)
        }
      }
      'C' -> castT - 226f
      'S' -> simT - 226f
      else -> 0f
    }
    sy.set(maxOf(0f, y), instant)
  }

  private fun scrollFor(i: Int, w: Float, pitch: Float, n: Int): Float {
    val max = maxOf(0f, n * pitch - 21.33f - 1749f)
    return (i * pitch + 149f + w / 2f - 1019f).coerceIn(0f, max)
  }
  private fun epMaxScroll() = maxOf(0f, eps.size * EP_PITCH - 21.33f - 1749f)

  override fun ok() {
    val o = it ?: return
    when (row) {
      'B' -> press(buttons.getOrNull(col) ?: return)
      'P' -> {
        val p = picks.getOrNull(col) ?: return
        tv.host.pick(p.label, p.options, p.cur) { i -> if (i >= 0 && i != p.cur) writeTrack(p.kind, i) }
      }
      'T' -> {
        if (hasPick && col == 0) {
          tv.host.pick("Seasons", seasons.map { s -> s.optString("Name") }, seasons.indexOfFirst { s -> s.optString("Id") == selected }) { i ->
            if (i < 0) return@pick
            pickSeason(seasons[i].optString("Id"))
            col = i + 1; aim(); tv.invalidate()
          }
          return
        }
        val t = tabs().getOrNull(col - (if (hasPick) 1 else 0)) ?: return
        pickSeason(t.first)
      }
      'K' -> { if (col != block) { block = col; layout(); tv.invalidate() } }
      'E' -> eps.getOrNull(epIndexes().getOrNull(col) ?: return)?.let { c -> tv.host.play(c.id) }
      'C' -> people.getOrNull(col)?.let { p -> tv.host.go("#/person/" + Card.enc(p.id)) }
      'S' -> similar.getOrNull(col)?.let { c -> tv.open(c) }
    }
    @Suppress("UNUSED_VARIABLE") val unused = o
  }

  override fun hold() {
    when (row) {
      'E' -> eps.getOrNull(epIndexes().getOrNull(col) ?: return)?.let { c -> tv.host.hold(c.id, false) }
      'S' -> similar.getOrNull(col)?.let { c -> tv.host.hold(c.id, false) }
    }
  }

  private fun press(b: Btn) {
    val o = it ?: return
    when (b.kind) {
      "resume", "play" -> tv.host.playFrom(itemId, b.kind == "play" && (o.optJSONObject("UserData")?.optBoolean("Played") ?: false))
      "start" -> tv.host.playFrom(itemId, true)
      "series" -> tv.host.playSeriesFrom(itemId, false)
      "seriesStart" -> tv.host.playSeriesFrom(itemId, true)
      "played", "fav" -> toggle(b)
      "av" -> {
        if (picks.isEmpty()) return
        val go = { p: Pick -> tv.host.pick(p.label, p.options, p.cur) { i -> if (i >= 0 && i != p.cur) writeTrack(p.kind, i) } }
        if (picks.size == 1) go(picks[0])
        else tv.host.pick("Audio & subtitles", picks.map { p -> "${p.label} · ${p.options.getOrNull(p.cur) ?: ""}" }, -1) { i -> picks.getOrNull(i)?.let(go) }
      }
      "view" -> {
        epView = if (epView == "grid") "row" else "grid"; epViewSet = true
        tv.host.setLocal("epView:$itemId", epView)
        b.label = "Episodes: " + if (epView == "grid") "Grid" else "Row"
        buildButtons()
        blocks = if (epView == "grid" && selected != "all") maxOf(1, (eps.size + GRID_BLOCK - 1) / GRID_BLOCK) else 1
        block = if (blocks > 1) maxOf(0, upNext) / GRID_BLOCK else 0
        visited.remove('E')
        if (epView == "row") epsX.set(maxOf(0f, minOf(maxOf(0, upNext) * EP_PITCH + 4f, epMaxScroll())), true)
        layout()
      }
    }
    tv.invalidate()
  }

  private fun toggle(b: Btn) {
    val o = it ?: return
    val on = !b.on
    val played = b.kind == "played"
    val path = if (played) "/Users/{userId}/PlayedItems/$itemId" else "/Users/{userId}/FavoriteItems/$itemId"
    val name = o.optString("Name")
    b.on = on
    val ud = o.optJSONObject("UserData") ?: JSONObject().also { j -> o.put("UserData", j) }
    val hadSpot = ud.optLong("PlaybackPositionTicks") > 0
    if (played) ud.put("Played", on) else ud.put("IsFavorite", on)
    if (played && playable(o)) { ud.put("PlaybackPositionTicks", 0); ud.put("PlayedPercentage", 0) }
    shownKey = key(o)
    buildButtons(); layout(); tv.invalidate()
    val my = gen
    Net.bg {
      var ok = true
      try {
        Net.send(if (on) "POST" else "DELETE", path, null)
        // Marking watched also clears the saved spot (some servers keep it).
        if (played && on && hadSpot && playable(o)) try {
          val now = Net.getNow("/Users/{userId}/Items/$itemId") as? JSONObject
          val u = now?.optJSONObject("UserData")
          if (u != null && u.optLong("PlaybackPositionTicks") > 0) Net.send("POST", "/Users/{userId}/Items/$itemId/UserData", JSONObject().put("PlaybackPositionTicks", 0).put("Played", true).put("IsFavorite", u.optBoolean("IsFavorite")).toString())
        } catch (_: Throwable) {}
      } catch (e: Throwable) { ok = false }
      Net.main.post {
        if (ok) {
          tv.host.toast(if (played) (if (on) "Marked $name as watched" else "Marked $name as unwatched") else (if (on) "Added $name to Favorites" else "Removed $name from Favorites"), false)
          tv.host.changed()
          if (played && isSeries && my == gen) { loadEpisodes(false); loadTarget() }
        } else {
          if (played) ud.put("Played", !on) else ud.put("IsFavorite", !on)
          b.on = !on; shownKey = key(o); buildButtons(); layout(); tv.invalidate()
          tv.host.toast("Couldn't reach the server. Try again.", true)
        }
      }
    }
  }

  // ---------------- drawing ----------------

  private val r = RectF()
  private val bgP = Ui.fill(Ui.BG)
  private val titleBig = Ui.text(Ui.f800, 80f, Ui.TEXT, -1.07f)
  private val titleShow = Ui.text(Ui.f800, 61.33f, Ui.TEXT, -0.8f)
  private val overBig = Ui.text(Ui.f400, 24f, 0xFFEADADA.toInt())
  private val overShow = Ui.text(Ui.f400, 21.33f, 0xFFEADADA.toInt())
  private val metaP = Ui.text(Ui.f400, 24f, 0xFFE9DADB.toInt())
  private val dimP = Ui.text(Ui.f400, 24f, Ui.MUTED)
  private val tagP = Ui.text(Ui.f700, 16f, 0xFFE9DADB.toInt(), 0.5f)
  private val tagBd = Ui.stroke(Ui.MUTED, 2f)
  private val tagQ = Ui.stroke(Ui.RED, 2f)
  private val tagQbg = Ui.fill(0x29EC282E)
  private val star = Ui.fill(Ui.RED)
  private val btnP = Ui.text(Ui.f700, 24f, Ui.WHITE)
  private val btnRed = Ui.fill(Ui.RED)
  private val btn2 = Ui.fill(0x1AFFFFFF)
  private val outline = Ui.stroke(Ui.WHITE, 4f)
  private val iconP = Ui.stroke(0xFFE9DADB.toInt(), 2.6f)
  private val iconFill = Ui.fill(Ui.WHITE)
  private val white = Ui.fill(Ui.WHITE)
  private val resBg = Ui.fill(Ui.LINE)
  private val resFg = Ui.fill(Ui.RED)
  private val pickL = Ui.text(Ui.f600, 21.33f, Ui.TEXT)
  private val pickV = Ui.text(Ui.f600, 21.33f, Ui.TEXT)
  private val pickBg = Ui.fill(0x1AFFFFFF)
  private val chev = Ui.stroke(Ui.TEXT, 3f)
  private val hintP = Ui.text(Ui.f400, 20f, 0xFFA8979A.toInt())
  private val subP = Ui.text(Ui.f400, 20f, Ui.MUTED)
  private val h2 = Ui.text(Ui.f800, 29.33f, Ui.TEXT, -0.27f)
  private val tabP = Ui.text(Ui.f700, 22.67f, Ui.TEXT)
  private val tabN = Ui.text(Ui.f600, 22.67f, Ui.alpha(Ui.TEXT, 0.65f))
  private val tabBg = Ui.fill(0x17FFFFFF)
  private val tabFoc = Ui.fill(Ui.WHITE)
  private val tabActive = Ui.stroke(Ui.RED, 2.67f)
  private val pickRing = Ui.stroke(0x22FFFFFF, 2.67f)
  private val oneP = Ui.text(Ui.f800, 29.33f, Ui.TEXT)
  private val epTitle = Ui.text(Ui.f700, 20f, Ui.TEXT)
  private val epMeta = Ui.text(Ui.f400, 17.33f, Ui.MUTED)
  private val epWatched = Ui.text(Ui.f400, 17.33f, 0xFFEDA7AA.toInt())
  private val numBg = Ui.fill(0xDB0C0808.toInt())
  private val numRed = Ui.fill(Ui.RED)
  private val numP = Ui.text(Ui.f800, 16f, Ui.WHITE).apply { textAlign = Paint.Align.CENTER }
  private val gridName = Ui.text(Ui.f600, 18.67f, Ui.TEXT)
  private val dimArt = Ui.fill(0x73120C0C)
  private val headP = Ui.text(Ui.f800, 24f, Ui.TEXT)
  private val blockP = Ui.text(Ui.f700, 20f, Ui.MUTED)
  private val blockBd = Ui.stroke(Ui.LINE, 1.5f)
  private val blockOn = Ui.fill(0xFF2A1C1D.toInt())
  private val blockOnBd = Ui.stroke(0xFFB8333A.toInt(), 1.5f)
  private val personName = Ui.text(Ui.f700, 20f, Ui.TEXT).apply { textAlign = Paint.Align.CENTER }
  private val personRole = Ui.text(Ui.f400, 17.33f, Ui.MUTED).apply { textAlign = Paint.Align.CENTER }
  private val initP = Ui.text(Ui.display, 58.67f, Ui.WHITE).apply { textAlign = Paint.Align.CENTER }
  private val ring = Ui.stroke(Ui.RED, 4f)
  private val border = Ui.stroke(Ui.LINE, 2f)
  private val panel = Ui.fill(Ui.PANEL)
  private val phGrad = Paint(Paint.ANTI_ALIAS_FLAG)
  private val PC = arrayOf(intArrayOf(0xFFF08A3C.toInt(), 0xFFB13A1E.toInt()), intArrayOf(0xFF4D9DE0.toInt(), 0xFF2B4A8A.toInt()), intArrayOf(0xFF59C27A.toInt(), 0xFF1F6B4A.toInt()),
    intArrayOf(0xFFB06FD8.toInt(), 0xFF5A2B86.toInt()), intArrayOf(0xFFE0607E.toInt(), 0xFF8A2B48.toInt()), intArrayOf(0xFFD8B84A.toInt(), 0xFF86601F.toInt()))
  private val stripBg = Paint()
  private val stripTitle = Ui.text(Ui.f800, 40f, Ui.TEXT)
  private val stripSub = Ui.text(Ui.f400, 20f, Ui.MUTED)
  private val shadow = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x00000000; setShadowLayer(48f, 0f, 32f, 0x99000000.toInt()) }
  private val sideGrad = Paint()
  private val bottomGrad = Paint()
  private val playTri = Path().apply { moveTo(8f, 5f); lineTo(8f, 19f); lineTo(19f, 12f); close() }
  private val heart = Path().apply {
    moveTo(12f, 20f); cubicTo(12f, 20f, 5f, 15.6f, 5f, 10f); cubicTo(5f, 7.8f, 6.8f, 6f, 9f, 6f); cubicTo(10.2f, 6f, 11.3f, 6.5f, 12f, 7.4f)
    cubicTo(12.7f, 6.5f, 13.8f, 6f, 15f, 6f); cubicTo(17.2f, 6f, 19f, 7.8f, 19f, 10f); cubicTo(19f, 15.6f, 12f, 20f, 12f, 20f); close()
  }
  private val check = Path().apply { moveTo(5f, 12.5f); lineTo(9.5f, 17f); lineTo(19f, 7.5f) }
  private val starPath = Path().apply {
    moveTo(12f, 2.5f); lineTo(14.9f, 8.6f); lineTo(21.5f, 9.4f); lineTo(16.6f, 14f); lineTo(17.9f, 20.6f); lineTo(12f, 17.3f)
    lineTo(6.1f, 20.6f); lineTo(7.4f, 14f); lineTo(2.5f, 9.4f); lineTo(9.1f, 8.6f); close()
  }
  private val timeFmt = SimpleDateFormat("h:mm a", Locale.US)

  override fun draw(c: Canvas, now: Long, dt: Float): Boolean {
    var anim = sy.step(dt)
    anim = tabsX.step(dt) || anim; anim = epsX.step(dt) || anim; anim = castX.step(dt) || anim; anim = simX.step(dt) || anim
    c.drawColor(Ui.BG)
    val o = it ?: return anim
    val y0 = sy.pos
    c.save(); c.translate(0f, -y0)
    anim = drawBackdrop(c, o, now) || anim
    if (isSeries) anim = drawShowHead(c, o, now) || anim else anim = drawMovieHead(c, o, now) || anim
    if (isSeries) anim = drawEpisodes(c, now, dt, y0) || anim
    anim = drawCast(c, now, dt, y0) || anim
    anim = drawSimilar(c, now, dt, y0) || anim
    c.restore()
    anim = drawStrip(c, o, now, y0) || anim
    return anim
  }

  private fun drawBackdrop(c: Canvas, o: JSONObject, now: Long): Boolean {
    val h = if (isSeries) 778f else 1080f
    val tag = o.optJSONArray("BackdropImageTags")?.optString(0)
    val url = if (!tag.isNullOrEmpty()) Net.image(itemId, "Backdrop/0", tag, 1920, 90) else null
    var anim = false
    val pic = Img.get(url)
    r.set(117f, 0f, Ui.W, h)
    if (pic != null) { val a = Img.fade(pic, now, false) * 0.9f; Img.draw(c, pic, r, 0f, a, 0f); if (a < 0.9f) anim = true }
    if (sideGrad.shader == null) {
      sideGrad.shader = LinearGradient(117f, 0f, Ui.W, 0f, intArrayOf(Ui.BG, 0xEB120C0C.toInt(), 0x33120C0C, 0x00120C0C), floatArrayOf(0f, 0.3f, 0.7f, 1f), Shader.TileMode.CLAMP)
    }
    bottomGrad.shader = LinearGradient(0f, h, 0f, 0f, intArrayOf(Ui.BG, 0xD9120C0C.toInt(), 0x00120C0C, 0x00120C0C), floatArrayOf(0f, 0.28f, 0.62f, 1f), Shader.TileMode.CLAMP)
    c.drawRect(r, sideGrad); c.drawRect(r, bottomGrad)
    return anim
  }

  private fun poster(o: JSONObject): String? {
    val t = o.optJSONObject("ImageTags")?.optString("Primary").orEmpty()
    return if (t.isNotEmpty()) Net.image(itemId, "Primary", t, 600) else null
  }

  private fun drawPoster(c: Canvas, o: JSONObject, box: RectF, radius: Float, now: Long): Boolean {
    c.drawRoundRect(box, radius, radius, shadow)
    c.drawRoundRect(box, radius, radius, panel)
    val pic = Img.get(poster(o))
    var anim = false
    if (pic != null) { val a = Img.fade(pic, now, tv.fast); Img.draw(c, pic, box, radius, a); if (a < 1f) anim = true }
    r.set(box); r.inset(1f, 1f); c.drawRoundRect(r, radius - 1f, radius - 1f, border)
    return anim
  }

  private fun drawTitle(c: Canvas, x: Float, top: Float, maxH: Float, maxW: Float, now: Long): Boolean {
    val logo = logoUrl()
    if (logo != null) {
      val pic = Img.get(logo, alpha = true)
      if (pic != null) {
        val a = Img.fade(pic, now, false)
        Img.drawContain(c, pic, RectF(x, top, x + maxW, top + maxH), a)
        return a < 1f
      }
      if (!Img.failed(logo)) return false
      titleL = null; layout()
    }
    titleL?.let { c.save(); c.translate(x, top); it.draw(c); c.restore() }
    return false
  }

  private fun drawMovieHead(c: Canvas, o: JSONObject, now: Long): Boolean {
    var anim = false
    r.set(191f, 435f, 529f, 945f)
    anim = drawPoster(c, o, RectF(r), 21.33f, now) || anim
    anim = drawTitle(c, 589f, titleTop, 200f, 853f, now) || anim
    drawMeta(c, o, 589f, metaTop)
    overL?.let { c.save(); c.translate(589f, overTop); it.draw(c); c.restore() }
    if (resumeTop >= 0) {
      val ud = o.optJSONObject("UserData") ?: JSONObject()
      val p = (ud.optLong("PlaybackPositionTicks").toFloat() / o.optLong("RunTimeTicks").coerceAtLeast(1)).coerceIn(0f, 1f)
      r.set(589f, resumeTop, 589f + 426.67f, resumeTop + 5.33f); c.drawRoundRect(r, 2.67f, 2.67f, resBg)
      r.right = 589f + 426.67f * p; c.drawRoundRect(r, 2.67f, 2.67f, resFg)
    }
    drawButtons(c, btnTop)
    for ((k, p) in picks.withIndex()) {
      Ui.line(c, p.label, p.x, pickTop, 59f, pickL)
      r.set(p.selX, pickTop, p.selX + p.w, pickTop + 59f); c.drawRoundRect(r, 29.5f, 29.5f, pickBg)
      Ui.line(c, Ui.fit(p.options.getOrNull(p.cur) ?: "", pickV, p.w - 77f), p.selX + 24f, pickTop, 59f, pickV)
      val cx = p.selX + p.w - 17.33f - 8f; val cy = pickTop + 29.5f
      c.drawLine(cx - 5.33f, cy - 2.67f, cx, cy + 2.67f, chev); c.drawLine(cx, cy + 2.67f, cx + 5.33f, cy - 2.67f, chev)
      if (row == 'P' && col == k) { r.inset(-5f, -5f); c.drawRoundRect(r, 34.5f, 34.5f, outline) }
    }
    // The hint under the page (Down glides to Cast & crew).
    c.save(); c.translate(190f, 1009f)
    val tri = Path().apply { moveTo(0f, 3f); lineTo(18f, 3f); lineTo(9f, 19f); close() }
    hintP.style = Paint.Style.FILL; c.drawPath(tri, hintP); c.restore()
    Ui.line(c, "Cast & crew · More like this", 216f, 1006f, 29f, hintP)
    return anim
  }

  private fun drawShowHead(c: Canvas, o: JSONObject, now: Long): Boolean {
    var anim = false
    anim = drawPoster(c, o, RectF(191f, 99f, 401f, 417f), 16f, now) || anim
    anim = drawTitle(c, 445f, titleTop, 128f, 960f, now) || anim
    drawMeta(c, o, 445f, metaTop)
    overL?.let { c.save(); c.translate(445f, overTop); it.draw(c); c.restore() }
    drawButtons(c, btnTop)
    if (playSub.isNotEmpty()) Ui.line(c, Ui.fit(playSub, subP, 1300f), 445f, subTop, 27f, subP)
    // Season bar.
    if (seasons.isNotEmpty()) {
      val t = tabs()
      if (tabW.size != t.size) measureTabs()
      if (hasPick) {
        val w = 169f
        r.set(150f, barTop, 150f + w, barTop + 61f)
        val foc = row == 'T' && col == 0
        c.drawRoundRect(r, 10.67f, 10.67f, if (foc) tabFoc else tabBg)
        if (!foc) c.drawRoundRect(RectF(r).apply { inset(1.33f, 1.33f) }, 9.33f, 9.33f, pickRing)
        tabP.color = if (foc) Ui.BG else Ui.TEXT
        Ui.line(c, "Seasons", 176f, barTop, 61f, tabP)
        Ui.line(c, "▾", 176f + tabP.measureText("Seasons") + 10.67f, barTop, 61f, tabP)
      }
      if (t.isEmpty()) Ui.line(c, seasons[0].optString("Name").ifEmpty { "Episodes" }, TABS_X, barTop, 61f, oneP)
      else {
        c.save(); c.clipRect(TABS_X - 8f, barTop - 8f, 1835f, barTop + 69f)
        var x = TABS_X - tabsX.pos
        for ((k, tab) in t.withIndex()) {
          val w = tabW.getOrElse(k) { 0f }
          if (x + w > TABS_X - 20f && x < 1880f) {
            r.set(x, barTop, x + w, barTop + 61f)
            val foc = row == 'T' && col == k + (if (hasPick) 1 else 0)
            val active = tab.first == selected
            if (foc) c.drawRoundRect(r, 10.67f, 10.67f, tabFoc)
            else if (active) { r.inset(1.33f, 1.33f); c.drawRoundRect(r, 9.33f, 9.33f, tabActive); r.inset(-1.33f, -1.33f) }
            else c.drawRoundRect(r, 10.67f, 10.67f, tabBg)
            tabP.color = if (foc) Ui.BG else if (active) Ui.WHITE else Ui.TEXT
            Ui.line(c, tab.second, x + 26.67f, barTop, 61f, tabP)
            val n = tabCount(tab.first)
            if (n > 0) { tabN.color = Ui.alpha(if (foc) Ui.BG else Ui.TEXT, 0.65f); Ui.line(c, n.toString(), x + 26.67f + tabP.measureText(tab.second) + 8f, barTop, 61f, tabN) }
          }
          x += w + 16f
        }
        c.restore()
      }
    }
    return anim
  }

  private fun drawButtons(c: Canvas, top: Float) {
    for ((k, b) in buttons.withIndex()) {
      r.set(b.x, top, b.x + b.w, top + 69f)
      val primary = b.kind in setOf("resume", "play", "series")
      c.drawRoundRect(r, 13.33f, 13.33f, if (primary || b.on) btnRed else btn2)
      if (row == 'B' && col == k) { r.inset(-6f, -6f); c.drawRoundRect(r, 19.33f, 19.33f, outline); r.inset(6f, 6f) }
      when (b.icon) {
        "play" -> {
          c.save(); c.translate(b.x + 34.67f, top + 34.5f - 12f); c.scale(1f, 1f); c.drawPath(playTri, white); c.restore()
          btnP.color = Ui.WHITE
          Ui.line(c, b.label, b.x + 34.67f + 24f + 10.67f, top, 69f, btnP)
        }
        "check" -> { iconP.color = if (b.on) Ui.WHITE else 0xFFE9DADB.toInt(); Icons.drawPath(c, check, b.x + 21.5f, top + 21.5f, 26f, iconP) }
        "heart" -> {
          if (b.on) Icons.drawPath(c, heart, b.x + 21.5f, top + 21.5f, 26f, iconFill)
          iconP.color = if (b.on) Ui.WHITE else 0xFFE9DADB.toInt(); Icons.drawPath(c, heart, b.x + 21.5f, top + 21.5f, 26f, iconP)
        }
        else -> { btnP.color = if (primary) Ui.WHITE else 0xFFE9DADB.toInt(); Ui.line(c, b.label, b.x + 34.67f, top, 69f, btnP) }
      }
    }
  }

  private fun drawMeta(c: Canvas, o: JSONObject, x0: Float, top: Float) {
    var x = x0
    val type = o.optString("Type")
    fun text(s: String, p: Paint = metaP) { Ui.line(c, s, x, top, 32f, p); x += p.measureText(s) + 16f }
    fun tag(s: String, q: Boolean) {
      val w = tagP.measureText(s) + 18.67f
      r.set(x, top + 1.5f, x + w, top + 30.5f)
      if (q) c.drawRoundRect(r, 6.67f, 6.67f, tagQbg)
      c.drawRoundRect(RectF(r).apply { inset(1f, 1f) }, 6f, 6f, if (q) tagQ else tagBd)
      tagP.color = if (q) Ui.WHITE else 0xFFE9DADB.toInt()
      Ui.line(c, s, x + 9.33f, top, 32f, tagP); x += w + 16f
    }
    val rating = o.optDouble("CommunityRating", 0.0)
    if (rating > 0) {
      Icons.drawPath(c, starPath, x, top + 6f, 20f, star); x += 20f + 6.67f
      text("%.1f".format(rating))
    }
    if (type == "Series" && o.optInt("ProductionYear") > 0) {
      val y = o.optInt("ProductionYear")
      val ended = o.optString("Status") == "Ended"
      val end = if (ended) Card.year(o.optString("EndDate")) else 0
      text(if (end > 0 && end != y) "$y–$end" else if (ended) "$y" else "$y–")
    } else if (o.optInt("ProductionYear") > 0) text(o.optInt("ProductionYear").toString())
    if (type == "Series" && o.optInt("ChildCount") > 0) text("${o.optInt("ChildCount")} Season" + if (o.optInt("ChildCount") == 1) "" else "s")
    val rt = o.optLong("RunTimeTicks")
    if (rt > 0 && type != "Series") text(Card.runtime(rt))
    if (o.optString("OfficialRating").isNotEmpty()) tag(o.optString("OfficialRating"), false)
    media?.let { m ->
      val a = m.optJSONArray("MediaSources")?.optJSONObject(0)?.optJSONArray("MediaStreams") ?: m.optJSONArray("MediaStreams")
      if (a != null) {
        val list = List(a.length()) { k -> a.getJSONObject(k) }
        list.firstOrNull { s -> s.optString("Type") == "Video" }?.let { v ->
          val w = v.optInt("Width"); val h = v.optInt("Height")
          val res = if (w >= 3200 || h >= 1800) "4K" else if (w >= 1800 || h >= 1000) "1080p" else if (w >= 1200 || h >= 700) "720p" else if (w > 0) "SD" else ""
          val vr = v.optString("VideoRange")
          val hdr = if (vr.isNotEmpty() && vr != "SDR") (if (Regex("dolby|dovi", RegexOption.IGNORE_CASE).containsMatchIn(v.optString("VideoRangeType"))) "Dolby Vision" else "HDR") else ""
          if (res.isNotEmpty()) tag(res + if (hdr.isNotEmpty()) " $hdr" else "", true)
        }
        (list.firstOrNull { s -> s.optString("Type") == "Audio" && s.optBoolean("IsDefault") } ?: list.firstOrNull { s -> s.optString("Type") == "Audio" })?.let { s ->
          val atmos = Regex("atmos", RegexOption.IGNORE_CASE).containsMatchIn(s.optString("Profile") + " " + s.optString("DisplayTitle"))
          val ch = s.optInt("Channels")
          val sound = if (atmos) "Atmos" else if (ch >= 8) "7.1" else if (ch >= 6) "5.1" else if (ch == 2) "Stereo" else if (ch == 1) "Mono" else ""
          if (sound.isNotEmpty()) tag(sound, false)
        }
      }
    }
    o.optJSONArray("Genres")?.let { g -> if (g.length() > 0) text(List(minOf(3, g.length())) { k -> g.optString(k) }.joinToString(", ")) }
    if (rt > 0 && type != "Series") {
      val pos = o.optJSONObject("UserData")?.optLong("PlaybackPositionTicks") ?: 0L
      text("Ends at " + timeFmt.format(Date(System.currentTimeMillis() + (rt - pos) / 10000)), dimP)
    }
  }

  private fun drawEpisodes(c: Canvas, now: Long, dt: Float, y0: Float): Boolean {
    if (seasons.isEmpty() || epTop - y0 > 1080f) return false
    var anim = false
    val idx = epIndexes()
    if (epView == "row") {
      val y = epTop
      c.save(); c.clipRect(138f, y - 30f, 1898f, y + 300f)
      var foc: Pair<Int, Float>? = null
      for ((k, i) in idx.withIndex()) {
        val x = 149f + k * EP_PITCH - epsX.pos
        val card = eps[i]
        val f = row == 'E' && col == k
        anim = CardArt.stepFocus(card, f, dt, tv.fast) || anim
        if (x + 400f < 117f || x > Ui.W) continue
        if (f) { foc = k to x; continue }
        anim = drawEp(c, card, epData[i], x, y, now) || anim
      }
      foc?.let { (k, x) -> anim = drawEp(c, eps[idx[k]], epData[idx[k]], x, y, now) || anim }
      c.restore()
    } else {
      if (blocksTop >= 0) {
        var x = 149f
        for (b in 0 until blocks) {
          val a = epData.getOrNull(b * GRID_BLOCK); val z = epData.getOrNull(minOf(epData.size, (b + 1) * GRID_BLOCK) - 1)
          val label = "${a?.optInt("IndexNumber", b * GRID_BLOCK + 1) ?: (b * GRID_BLOCK + 1)}–${z?.optInt("IndexNumber", (b + 1) * GRID_BLOCK) ?: ((b + 1) * GRID_BLOCK)}"
          val w = blockP.measureText(label) + 48f
          r.set(x, blocksTop, x + w, blocksTop + 53f)
          val foc = row == 'K' && col == b
          if (b == block) { c.drawRoundRect(r, 26.5f, 26.5f, blockOn); c.drawRoundRect(r, 26.5f, 26.5f, blockOnBd) } else c.drawRoundRect(r, 26.5f, 26.5f, blockBd)
          blockP.color = if (b == block || foc) Ui.WHITE else Ui.MUTED
          Ui.line(c, label, x + 24f, blocksTop, 53f, blockP)
          if (foc) { r.inset(-5f, -5f); c.drawRoundRect(r, 31.5f, 31.5f, outline) }
          x += w + 13.33f
        }
      }
      for ((hy, name) in gridHeads) if (hy - y0 < 1080f && hy + 48f - y0 > 0f) Ui.line(c, name, 149f, hy, 40f, headP)
      var foc: Triple<Int, Float, Float>? = null
      for ((ly, line) in gridLines) {
        if (ly - y0 > 1080f || ly + GRID_PITCH - y0 < 0f) { for (k in line) eps[idx[k]].f = if (row == 'E' && col == k) 1f else 0f; continue }
        for ((p, k) in line.withIndex()) {
          val x = 149f + p * (GRID_W + 16f)
          val card = eps[idx[k]]
          val f = row == 'E' && col == k
          anim = CardArt.stepFocus(card, f, dt, tv.fast) || anim
          if (f) { foc = Triple(k, x, ly); continue }
          anim = drawThumb(c, card, epData[idx[k]], idx[k], x, ly, now) || anim
        }
      }
      foc?.let { (k, x, y) -> anim = drawThumb(c, eps[idx[k]], epData[idx[k]], idx[k], x, y, now) || anim }
    }
    return anim
  }

  private fun num(e: JSONObject) = if (e.has("IndexNumber")) "${e.optInt("IndexNumber")}. " else ""

  private fun drawEp(c: Canvas, card: Card, e: JSONObject, x: Float, y: Float, now: Long): Boolean {
    val a = CardArt.draw(c, card, x, y, now, tv.fast, text = false)
    epTitle.color = Ui.mixColor(Ui.TEXT, Ui.WHITE, Ui.ease(card.f))
    Ui.line(c, Ui.fit(num(e) + e.optString("Name"), epTitle, 400f), x, y + 225f + 12f, 29f, epTitle)
    val ud = e.optJSONObject("UserData") ?: JSONObject()
    val left = if (ud.optLong("PlaybackPositionTicks") > 0 && e.optLong("RunTimeTicks") > 0) Card.runtime(e.optLong("RunTimeTicks") - ud.optLong("PlaybackPositionTicks")) + " left" else ""
    val parts = listOf(Card.runtime(e.optLong("RunTimeTicks")), left).filter { s -> s.isNotEmpty() }
    var mx = x
    val my = y + 225f + 41f
    val base = parts.joinToString(" · ")
    if (base.isNotEmpty()) { Ui.line(c, base, mx, my, 25f, epMeta); mx += epMeta.measureText(base) }
    if (ud.optBoolean("Played")) {
      if (base.isNotEmpty()) { Ui.line(c, " · ", mx, my, 25f, epMeta); mx += epMeta.measureText(" · ") }
      Ui.line(c, "Watched", mx, my, 25f, epWatched)
    }
    return a
  }

  private fun drawThumb(c: Canvas, card: Card, e: JSONObject, i: Int, x: Float, y: Float, now: Long): Boolean {
    c.save()
    val s = GRID_W / 400f
    c.translate(x, y); c.scale(s, s)
    val a = CardArt.draw(c, card, 0f, 0f, now, tv.fast, text = false)
    val watched = e.optJSONObject("UserData")?.optBoolean("Played") ?: false
    if (watched && card.f == 0f) { r.set(2f, 2f, 398f, 222.7f); c.drawRoundRect(r, CardArt.RADIUS, CardArt.RADIUS, dimArt) }
    c.restore()
    val n = if (e.has("IndexNumber")) e.optInt("IndexNumber").toString() else "•"
    val w = maxOf(32f, numP.measureText(n) + 16f)
    r.set(x + 9.33f, y + 9.33f, x + 9.33f + w, y + 9.33f + 28f)
    c.drawRoundRect(r, 8f, 8f, if (i == upNext) numRed else numBg)
    Ui.line(c, n, r.centerX(), r.top, 28f, numP)
    gridName.color = Ui.mixColor(Ui.TEXT, Ui.WHITE, Ui.ease(card.f))
    Ui.line(c, Ui.fit(e.optString("Name"), gridName, GRID_W), x, y + GRID_H + 9f, 24f, gridName)
    return a
  }

  private fun drawCast(c: Canvas, now: Long, dt: Float, y0: Float): Boolean {
    if (people.isEmpty() || castT - y0 > 1100f || castT + 320f - y0 < 0f) return false
    var anim = false
    Ui.line(c, "Cast & Crew", 149f, castT - 20f, 40f, h2)
    val top = castT + 37f
    c.save(); c.clipRect(138f, top - 30f, 1898f, top + 290f)
    var focAt = -1
    for ((k, p) in people.withIndex()) {
      val f = row == 'C' && col == k
      val t = if (f) 1f else 0f
      if (p.f != t) { p.f = if (tv.fast) t else if (f) minOf(1f, p.f + dt / 120f) else maxOf(0f, p.f - dt / 120f); if (p.f != t) anim = true }
      if (f) { focAt = k; continue }
      anim = drawPerson(c, p, 149f + k * 221.33f - castX.pos, top, now) || anim
    }
    if (focAt >= 0) anim = drawPerson(c, people[focAt], 149f + focAt * 221.33f - castX.pos, top, now) || anim
    c.restore()
    return anim
  }

  private fun drawPerson(c: Canvas, p: Person, x: Float, y: Float, now: Long): Boolean {
    if (x + 200f < 117f || x > Ui.W) return false
    var anim = false
    val f = Ui.ease(p.f)
    c.save()
    if (f > 0f) { val s = 1f + 0.04f * f; c.translate(0f, -5.33f * f); c.scale(s, s, x + 100f, y + 100f) }
    r.set(x, y, x + 200f, y + 200f)
    val pic = Img.get(p.img)
    val a = if (pic != null) Img.fade(pic, now, tv.fast) else 0f
    if (a < 1f) {
      val g = PC[p.pc]
      phGrad.shader = LinearGradient(x, y, x + 200f, y + 200f, g[0], g[1], Shader.TileMode.CLAMP)
      c.drawOval(r, phGrad)
      Ui.line(c, p.ini, x + 100f, y + 70f, 60f, initP)
    }
    if (pic != null) { Img.draw(c, pic, r, 100f, a); if (a < 1f) anim = true }
    r.inset(1f, 1f); c.drawOval(r, border)
    if (f > 0f) { ring.alpha = (255 * f).toInt(); r.set(x - 2f, y - 2f, x + 202f, y + 202f); c.drawOval(r, ring) }
    c.restore()
    personName.color = Ui.mixColor(Ui.TEXT, Ui.WHITE, f)
    Ui.line(c, Ui.fit(p.name, personName, 210f), x + 100f, y + 210f, 29f, personName)
    if (p.role.isNotEmpty()) Ui.line(c, Ui.fit(p.role, personRole, 210f), x + 100f, y + 238f, 25f, personRole)
    return anim
  }

  private fun drawSimilar(c: Canvas, now: Long, dt: Float, y0: Float): Boolean {
    if (similar.isEmpty() || simT - y0 > 1100f || simT + 460f - y0 < 0f) return false
    var anim = false
    Ui.line(c, "More Like This", 149f, simT - 20f, 40f, h2)
    val top = simT + 37f
    c.save(); c.clipRect(138f, top - 30f, 1898f, top + 440f)
    var focAt = -1
    for ((k, card) in similar.withIndex()) {
      val f = row == 'S' && col == k
      anim = CardArt.stepFocus(card, f, dt, tv.fast) || anim
      val x = 149f + k * 248.33f - simX.pos
      if (x + 227f < 117f || x > Ui.W) continue
      if (f) { focAt = k; continue }
      anim = CardArt.draw(c, card, x, top, now, tv.fast) || anim
    }
    if (focAt >= 0) anim = CardArt.draw(c, similar[focAt], 149f + focAt * 248.33f - simX.pos, top, now, tv.fast) || anim
    c.restore()
    return anim
  }

  private fun drawStrip(c: Canvas, o: JSONObject, now: Long, y0: Float): Boolean {
    val want = if (isSeries) mainBottom - y0 < 130f else 1080f - y0 < 594f
    if (want != stripOn) { stripOn = want; stripAt = now }
    val t = Ui.ease(((now - stripAt) / 220f).coerceIn(0f, 1f))
    val a = if (stripOn) t else 1f - t
    if (a <= 0f) return false
    val dy = -18.67f * (1f - a)
    if (stripBg.shader == null) stripBg.shader = LinearGradient(0f, 0f, 0f, 183f, intArrayOf(Ui.BG, Ui.BG, 0x00120C0C), floatArrayOf(0f, 0.86f, 1f), Shader.TileMode.CLAMP)
    c.save(); c.translate(0f, dy)
    stripBg.alpha = (255 * a).toInt()
    c.drawRect(117f, 0f, Ui.W, 183f, stripBg)
    r.set(190f, 34f, 262f, 142f)
    val pic = Img.peek(poster(o))
    panel.alpha = (255 * a).toInt(); c.drawRoundRect(r, 10.67f, 10.67f, panel); panel.alpha = 255
    if (pic != null) Img.draw(c, pic, r, 10.67f, a)
    stripTitle.alpha = (255 * a).toInt(); stripSub.alpha = (255 * a).toInt()
    Ui.line(c, Ui.fit(o.optString("Name"), stripTitle, 1500f), 286f, 49f, 48f, stripTitle)
    val ud = o.optJSONObject("UserData") ?: JSONObject()
    val rt = o.optLong("RunTimeTicks"); val pos = ud.optLong("PlaybackPositionTicks")
    val sub = listOf(if (o.optInt("ProductionYear") > 0) o.optInt("ProductionYear").toString() else "", if (isSeries) "" else Card.runtime(rt),
      if (!isSeries && pos > 0 && rt > 0) Card.runtime(rt - pos) + " left" else "").filter { s -> s.isNotEmpty() }.joinToString(" · ")
    Ui.line(c, sub, 286f, 104f, 27f, stripSub)
    c.restore()
    return t < 1f
  }

  companion object {
    private val LANGS = mapOf("eng" to "en", "english" to "en", "ger" to "de", "deu" to "de", "german" to "de", "fre" to "fr", "fra" to "fr", "french" to "fr",
      "spa" to "es", "spanish" to "es", "ita" to "it", "italian" to "it", "jpn" to "ja", "japanese" to "ja", "por" to "pt", "portuguese" to "pt", "dut" to "nl",
      "nld" to "nl", "dutch" to "nl", "swe" to "sv", "swedish" to "sv", "nor" to "no", "nob" to "no", "norwegian" to "no", "dan" to "da", "danish" to "da",
      "fin" to "fi", "finnish" to "fi", "pol" to "pl", "polish" to "pl", "rus" to "ru", "russian" to "ru", "kor" to "ko", "korean" to "ko", "chi" to "zh",
      "zho" to "zh", "chinese" to "zh", "ara" to "ar", "arabic" to "ar", "hin" to "hi", "hindi" to "hi", "tur" to "tr", "turkish" to "tr")
    fun langOf(l: String): String { val k = l.lowercase().trim().split(Regex("[-_]"))[0]; return LANGS[k] ?: k }
  }
}
