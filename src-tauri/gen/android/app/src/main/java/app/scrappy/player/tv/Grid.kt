package app.scrappy.player.tv

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.KeyEvent
import org.json.JSONObject
import kotlin.math.abs

/** A library's poster grid (Movies, TV Shows...), drawn natively. Same chips, A to Z strip, paging and
 *  remote rules as libraryView() in views.js on the TV. */
class Grid(tv: TvView, val libId: String, val genreId: String) : Screen(tv) {
  override val railKey = libId

  private val SORTS = listOf(
    Triple("SortName", "Ascending", "Name"), Triple("DateCreated", "Descending", "Date added"),
    Triple("PremiereDate,ProductionYear", "Descending", "Release date"), Triple("CommunityRating", "Descending", "Rating"),
    Triple("DatePlayed", "Descending", "Last played"), Triple("Random", "Ascending", "Random"))
  private val SHOWS = listOf("Everything" to "", "Unwatched" to "&IsPlayed=false", "Favorites" to "&IsFavorite=true")
  private val FIELDS = "PrimaryImageAspectRatio,ProductionYear,EndDate,BasicSyncInfo"
  private val IMG_OPTS = "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Thumb"
  private val PAGE = 60
  private val COLS = 7
  private val CW = (1685f + 21.33f) / 7f - 21.33f
  private val CH = CW * 1.5f
  private val PX = CW + 21.33f
  private val PY = 429f
  private val TOP = 126f

  private var view: JSONObject? = null
  private var genre: JSONObject? = null
  private var sortIdx = 0
  private var showIdx = 0
  private var tvGenre: JSONObject? = null
  private var genres: List<JSONObject>? = null
  private val sortKey = "sort:$libId" + if (genreId.isNotEmpty()) ":g" else ""

  /** The stretch of the library on screen: items[k] is title number first + k. */
  private var items = ArrayList<Card>()
  private var first = 0
  private var total = -1
  private var busy = false; private var busyUp = false
  private var gen = 0
  private var loaded = false

  // Focus: -1 = chips row, -2 = A to Z strip, otherwise index into items.
  private var focus = 0
  private var chip = 0
  private var az = 0
  private var letter = ""
  private var lit = "#"
  private val sy = Glide()
  private var touched = false

  private val r = RectF()
  private val h2 = Ui.text(Ui.f800, 45.33f, Ui.TEXT, -0.27f)
  private val h2dim = Ui.text(Ui.f800, 45.33f, Ui.MUTED, -0.27f)
  private val countP = Ui.text(Ui.f400, 18.67f, Ui.MUTED)
  private val chipBg = Ui.fill(0x17FFFFFF)
  private val chipFoc = Ui.fill(Ui.TEXT)
  private val chipL = Ui.text(Ui.f600, 24f, 0xFFE9DADB.toInt())
  private val chipV = Ui.text(Ui.f500, 24f, 0xFFA8979A.toInt())
  private val azP = Ui.text(Ui.f800, 18.67f, 0xFF8F7778.toInt()).apply { textAlign = Paint.Align.CENTER }
  private val azOn = Ui.fill(Ui.RED)
  private val azFoc = Ui.fill(Ui.WHITE)
  private val emptyP = Ui.text(Ui.f400, 20f, Ui.MUTED).apply { textAlign = Paint.Align.CENTER }
  private val LETTERS = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ"

  private fun libraryQuery(v: JSONObject?): String = when (v?.optString("CollectionType")) {
    "movies" -> "IncludeItemTypes=Movie&Recursive=true"
    "tvshows" -> "IncludeItemTypes=Series&Recursive=true"
    "boxsets" -> "IncludeItemTypes=BoxSet&Recursive=true"
    "musicvideos" -> "IncludeItemTypes=MusicVideo&Recursive=true"
    else -> "Recursive=false"
  }

  private fun base(): String {
    val (by, order, _) = SORTS[sortIdx]
    val gid = genreId.ifEmpty { tvGenre?.optString("Id").orEmpty() }
    return "/Users/{userId}/Items?ParentId=$libId&${libraryQuery(view)}" + (if (gid.isNotEmpty()) "&GenreIds=$gid" else "") + SHOWS[showIdx].second +
      "&SortBy=$by" + (if (by == "Random") "" else ",SortName") + "&SortOrder=$order&Fields=$FIELDS&$IMG_OPTS&Limit=$PAGE"
  }

  override fun show(fresh: Boolean) {
    if (loaded) return
    loaded = true
    sortIdx = tv.home().prefs.optJSONObject("sorts")?.optString(sortKey)?.toIntOrNull()?.takeIf { it in SORTS.indices && it < 5 } ?: 0
    val one = { id: String, done: (JSONObject?) -> Unit ->
      val p = "/Users/{userId}/Items/$id"
      Net.bg { val v = (Net.cachedNow(p) ?: try { Net.getNow(p) } catch (_: Throwable) { null }) as? JSONObject; Net.main.post { done(v) } }
    }
    one(libId) { v ->
      view = v
      if (genreId.isNotEmpty()) one(genreId) { g -> genre = g; reload() } else reload()
    }
  }

  override fun stale() { if (loaded && view != null) refreshQuiet() }

  private fun reload() {
    gen++; first = 0; items = ArrayList(); total = -1; busy = false; busyUp = false
    more()
  }

  /** After watching or a menu change: fetch the first page again, keeping the highlight where it is. */
  private fun refreshQuiet() {
    if (first != 0) return
    val my = gen
    Net.get(base() + "&StartIndex=0") { v ->
      if (v == null || my != gen) return@get
      val list = Net.items(v)
      for ((k, it) in list.withIndex()) if (k < items.size && items[k].id == it.optString("Id")) { val f = items[k].f; items[k] = Card(it, Shape.PORTRAIT).also { c -> c.f = f; boxPoster(c) } }
      tv.invalidate()
    }
  }

  private fun more() {
    if (busy || (total >= 0 && first + items.size >= total) || view == null) return
    busy = true
    val my = gen
    val start = first + items.size
    val path = base() + "&StartIndex=$start"
    val apply = { v: Any, freshCopy: Boolean ->
      if (my == gen) {
        val o = v as? JSONObject
        total = o?.optInt("TotalRecordCount") ?: 0
        val list = Net.items(v).map { Card(it, Shape.PORTRAIT).also { c -> boxPoster(c) } }
        if (start == 0 && first == 0) {
          // A fresh copy replaces the saved one; the highlight stays on the poster it was on.
          val keepF = items.map { it.f }
          items = ArrayList(list); keepF.forEachIndexed { k, f -> if (k < items.size) items[k].f = f }
          if (focus >= items.size) focus = maxOf(0, items.size - 1)
        } else if (!freshCopy || items.size == start - first) items.addAll(list)
        tv.invalidate()
      }
    }
    if (start == 0 && first == 0) {
      Net.load(path) { v, fresh -> apply(v, fresh); if (fresh) busy = false }
      Net.main.postDelayed({ if (my == gen) busy = false }, 2500)
    } else Net.get(path) { v -> if (v != null) apply(v, false); if (my == gen) busy = false }
  }

  private fun prev() {
    if (busyUp || first <= 0) return
    busyUp = true
    val my = gen
    val s = maxOf(0, first - PAGE)
    Net.get(base().replace("&Limit=$PAGE", "&Limit=${first - s}") + "&StartIndex=$s") { v ->
      if (my != gen) return@get
      busyUp = false
      if (v == null) return@get
      val list = Net.items(v).take(first - s).map { Card(it, Shape.PORTRAIT).also { c -> boxPoster(c) } }
      // Added above: shift the page by exactly that much so nothing appears to move.
      val rowsAdded = first / COLS - s / COLS
      items.addAll(0, list); first = s
      if (focus >= 0) focus += list.size
      sy.shift(rowsAdded * PY)
      tv.invalidate()
    }
  }

  private fun jump(l: String) {
    val my = ++gen
    touched = true
    Net.bg {
      var idx = 0
      if (l.isNotEmpty()) try { idx = (Net.getNow(base().replace(Regex("&Limit=\\d+"), "&Limit=0") + "&NameLessThan=$l") as? JSONObject)?.optInt("TotalRecordCount") ?: 0 } catch (_: Throwable) {}
      Net.main.post {
        if (my != gen) return@post
        if (total > 0) idx = minOf(idx, total - 1)
        first = (idx / PAGE) * PAGE
        // Keep the column grid aligned: a stretch always starts at the start of a line.
        first -= first % COLS
        items = ArrayList(); busy = false; busyUp = false
        val want = idx - first
        Net.get(base() + "&StartIndex=$first") { v ->
          if (my != gen || v == null) return@get
          total = (v as? JSONObject)?.optInt("TotalRecordCount") ?: total
          items.addAll(Net.items(v).map { Card(it, Shape.PORTRAIT).also { c -> boxPoster(c) } })
          focus = want.coerceIn(0, maxOf(0, items.size - 1))
          aim(true)
          tv.invalidate()
        }
      }
    }
  }

  // TV: a collection with no picture borrows its first film's poster (remembered on disk).
  private fun boxPoster(c: Card) {
    if (c.type != "BoxSet" || c.img != null) return
    val f = java.io.File(tv.context.cacheDir, "native-meta/box-" + c.id.hashCode() + ".txt")
    if (f.exists()) { val u = f.readText(); if (u.isNotEmpty()) c.swap(u); return }
    Net.bg {
      val d = try { Net.getNow("/Users/{userId}/Items?ParentId=${c.id}&Limit=1&SortBy=ProductionYear,SortName&SortOrder=Ascending&Fields=PrimaryImageAspectRatio&ImageTypeLimit=1&EnableImageTypes=Primary") } catch (_: Throwable) { return@bg }
      val it = Net.items(d).firstOrNull()
      val tag = it?.optJSONObject("ImageTags")?.optString("Primary").orEmpty()
      val u = if (it != null && tag.isNotEmpty()) Net.image(it.optString("Id"), "Primary", tag, Card.W_POSTER) else ""
      try { f.writeText(u) } catch (_: Throwable) {}
      if (u.isNotEmpty()) Net.main.post { c.swap(u); tv.invalidate() }
    }
  }

  // ---------------- remote ----------------

  private fun azShown() = SORTS[sortIdx].first == "SortName"
  private fun chipCount() = if (genreId.isEmpty()) 3 else 2
  private fun rowY(i: Int) = TOP + ((first + i) / COLS - first / COLS) * PY

  private fun aim(instant: Boolean = false) {
    val y = when {
      focus >= 0 -> rowY(focus) + 200f - 540f
      else -> 0f
    }
    val maxY = maxOf(0f, contentH() - 1080f)
    sy.set(y.coerceIn(0f, maxY), instant)
    if (focus >= 0) items.getOrNull(focus)?.let { c ->
      val name = c.title.replace(Regex("^(?i)(the|a|an)\\s+"), "")
      val ch = name.firstOrNull()?.uppercaseChar() ?: '#'
      lit = if (ch in 'A'..'Z') ch.toString() else "#"
    }
  }

  private fun contentH(): Float {
    val rows = (items.size + COLS - 1) / COLS
    return TOP + rows * PY + 80f
  }

  override fun behind() = abs(sy.to - sy.pos)

  override fun key(k: Int): Boolean {
    touched = true
    if (focus == -2) { // A to Z
      when (k) {
        KeyEvent.KEYCODE_DPAD_UP -> if (az > 0) az--
        KeyEvent.KEYCODE_DPAD_DOWN -> if (az < LETTERS.length - 1) az++
        KeyEvent.KEYCODE_DPAD_LEFT -> { focus = lastCard.coerceIn(0, maxOf(0, items.size - 1)); aim() }
      }
      return true
    }
    if (focus == -1) { // chips
      when (k) {
        KeyEvent.KEYCODE_DPAD_LEFT -> { if (chip == 0) return false; chip-- }
        KeyEvent.KEYCODE_DPAD_RIGHT -> if (chip < chipCount() - 1) chip++
        KeyEvent.KEYCODE_DPAD_DOWN -> if (items.isNotEmpty()) { focus = 0.coerceAtMost(items.size - 1); aim() }
      }
      return true
    }
    val n = items.size
    if (n == 0) { if (k == KeyEvent.KEYCODE_DPAD_UP) { focus = -1; aim() }; return k != KeyEvent.KEYCODE_DPAD_LEFT }
    val i = focus
    val absI = first + i
    var j = -1
    when (k) {
      KeyEvent.KEYCODE_DPAD_RIGHT -> if ((absI + 1) % COLS != 0 && i + 1 < n) j = i + 1 else if ((absI + 1) % COLS == 0 && azShown()) { lastCard = i; focus = -2; az = LETTERS.indexOf(lit).coerceAtLeast(0); return true }
      KeyEvent.KEYCODE_DPAD_LEFT -> if (absI % COLS != 0) j = i - 1 else return false
      KeyEvent.KEYCODE_DPAD_DOWN -> {
        if (i + COLS < n) j = i + COLS
        else if (total >= 0 && first + n < total) { more(); return true } // the bottom of a grid still loading: wait there
        else if ((i / COLS) < ((n - 1) / COLS)) j = n - 1
      }
      KeyEvent.KEYCODE_DPAD_UP -> {
        if (i - COLS >= 0) j = i - COLS
        else if (first > 0) { prev(); return true }
        else { focus = -1; chip = 0; aim(); return true }
      }
    }
    if (j >= 0) { focus = j; aim() }
    // Near the end of what is loaded: fetch the next stretch.
    if (focus >= 0 && n - focus < COLS * 4) more()
    if (focus >= 0 && focus < COLS * 3 && first > 0) prev()
    return true
  }
  private var lastCard = 0

  override fun ok() {
    when {
      focus == -2 -> { val l = LETTERS[az].toString(); letter = if (l == "#") "" else l; lit = l; jump(letter) }
      focus == -1 -> openChip(chip)
      else -> items.getOrNull(focus)?.let { c -> if (c.playable && c.type == "Episode") tv.host.play(c.id) else tv.host.go(c.href) }
    }
  }

  override fun hold() { if (focus >= 0) items.getOrNull(focus)?.let { tv.host.hold(it.id, false) } }

  private fun openChip(k: Int) {
    when (k) {
      0 -> tv.host.pick("Sort by", SORTS.map { it.third }, sortIdx) { i ->
        if (i < 0 || i == sortIdx) return@pick
        sortIdx = i; letter = ""; if (i < 5) tv.host.saveSort(sortKey, i)
        tv.home().prefs.optJSONObject("sorts")?.put(sortKey, i.toString())
        focus = -1; reload()
      }
      1 -> tv.host.pick("Show", SHOWS.map { it.first }, showIdx) { i -> if (i >= 0 && i != showIdx) { showIdx = i; focus = -1; reload() } }
      2 -> {
        val go = { list: List<JSONObject> ->
          val cur = tvGenre?.let { g -> list.indexOfFirst { it.optString("Id") == g.optString("Id") } + 1 } ?: 0
          tv.host.pick("Genre", listOf("Any") + list.map { it.optString("Name") }, cur) { i -> if (i >= 0 && i != cur) { tvGenre = if (i == 0) null else list[i - 1]; focus = -1; reload() } }
        }
        genres?.let(go) ?: Net.get("/Genres?ParentId=$libId&UserId={userId}&${libraryQuery(view)}&SortBy=SortName") { v -> val l = Net.items(v); genres = l; go(l) }
      }
    }
  }

  // ---------------- drawing ----------------

  override fun draw(c: Canvas, now: Long, dt: Float): Boolean {
    var anim = sy.step(dt)
    c.drawColor(Ui.BG)
    val y0 = sy.pos
    c.save(); c.translate(0f, -y0)
    // Heading, count and chips.
    val v = view
    if (v != null) {
      var x = 149f
      if (genre != null) {
        val g = genre!!.optString("Name"); Ui.line(c, g, x, 35f, 65.7f, h2); x += h2.measureText("$g ")
        val d = "· " + v.optString("Name"); Ui.line(c, d, x, 35f, 65.7f, h2dim); x += h2dim.measureText(d)
      } else { val t = v.optString("Name"); Ui.line(c, t, x, 35f, 65.7f, h2); x += h2.measureText(t) }
      if (total > 0) Ui.line(c, "%,d items".format(total), x + 18.67f, 54f, 27f, countP)
      drawChips(c)
    }
    if (total == 0) Ui.line(c, "This library is empty.", (117f + 1920f) / 2f, 240f, 29f, emptyP)
    // Posters (only the lines near the screen).
    val firstRow = maxOf(0, ((y0 - TOP - PY) / PY).toInt())
    val lastRow = ((y0 + 1080f - TOP) / PY).toInt() + 1
    val rowOffset = first / COLS
    var focusedAt: Pair<Float, Float>? = null
    for (row in firstRow..lastRow) {
      for (col in 0 until COLS) {
        val i = row * COLS + col - (first % COLS)
        if (i < 0 || i >= items.size) continue
        val card = items[i]
        val x = 149f + col * PX; val y = TOP + row * PY
        val foc = i == focus
        anim = CardArt.stepFocus(card, foc, dt, tv.fast) || anim
        if (foc) { focusedAt = x to y; continue }
        anim = drawCard(c, card, x, y, now) || anim
      }
    }
    @Suppress("UNUSED_VARIABLE") val unused = rowOffset
    focusedAt?.let { (x, y) -> items.getOrNull(focus)?.let { anim = drawCard(c, it, x, y, now) || anim } }
    c.restore()
    if (azShown() && v != null) drawAz(c)
    return anim
  }

  private fun drawCard(c: Canvas, card: Card, x: Float, y: Float, now: Long): Boolean {
    // Grid posters are a little narrower than row posters: draw them at the grid's own size.
    c.save()
    val s = CW / card.shape.w
    c.translate(x, y); c.scale(s, s)
    val a = CardArt.draw(c, card, 0f, 0f, now, tv.fast, text = false)
    c.restore()
    CardArt.title.color = Ui.mixColor(Ui.TEXT, Ui.WHITE, Ui.ease(card.f))
    Ui.line(c, Ui.fit(card.title, CardArt.title, CW), x, y + CH + 12f, 29f, CardArt.title)
    if (card.sub.isNotEmpty()) Ui.line(c, Ui.fit(card.sub, CardArt.sub, CW), x, y + CH + 41f, 25f, CardArt.sub)
    return a
  }

  private fun drawChips(c: Canvas) {
    val labels = listOf("Sort" to SORTS[sortIdx].third, "Show" to SHOWS[showIdx].first) + if (genreId.isEmpty()) listOf("Genre" to (tvGenre?.optString("Name") ?: "Any")) else emptyList()
    val widths = labels.map { (l, v) -> 29.33f * 2 + chipL.measureText(l) + 8f + chipV.measureText(v) }
    var x = 1834f - widths.sum() - 16f * (labels.size - 1)
    labels.forEachIndexed { k, (l, v) ->
      val w = widths[k]
      r.set(x, 37f, x + w, 98f)
      val foc = focus == -1 && chip == k
      c.drawRoundRect(r, 30.5f, 30.5f, if (foc) chipFoc else chipBg)
      chipL.color = if (foc) 0xFF120C0C.toInt() else 0xFFE9DADB.toInt()
      chipV.color = if (foc) 0xFF6B5556.toInt() else 0xFFA8979A.toInt()
      Ui.line(c, l, x + 29.33f, 37f, 61f, chipL)
      Ui.line(c, v, x + 29.33f + chipL.measureText(l) + 8f, 37f, 61f, chipV)
      x += w + 16f
    }
  }

  private fun drawAz(c: Canvas) {
    val h = 925f / LETTERS.length
    for (k in LETTERS.indices) {
      val l = LETTERS[k].toString()
      val y = 128f + k * h
      r.set(1852f, y, 1897f, y + h)
      val foc = focus == -2 && az == k
      val on = l == lit
      if (foc) c.drawRoundRect(r, 10.67f, 10.67f, azFoc) else if (on) c.drawRoundRect(r, 10.67f, 10.67f, azOn)
      azP.color = if (foc) 0xFF120C0C.toInt() else if (on) Ui.WHITE else 0xFF8F7778.toInt()
      Ui.line(c, l, r.centerX(), y, h, azP)
    }
  }
}
