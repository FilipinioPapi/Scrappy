package app.scrappy.player.tv

import android.graphics.Canvas
import android.graphics.RectF
import android.os.SystemClock
import android.view.KeyEvent
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs

/** Home, drawn natively. Same rows, order, queries and remote rules as homeView() in views.js. */
class Home(tv: TvView) : Screen(tv) {
  enum class Kind { HERO, CARDS, LIB, GHEAD, GROW, EDIT }

  class Row(val id: String, val kind: Kind) {
    var title = ""; var sub = ""
    var cards: List<Card> = emptyList()
    var shape = Shape.PORTRAIT
    var focus = 0
    val sx = Glide()
    var top = 0f
    var shown = false
    // Genre rows
    var genreId = ""; var count = 0; var filled = false; var loading = false; var nearAt = 0L
    var seeAll = ""
    val pitch get() = shape.w + 21.33f
    fun maxScroll(): Float = maxOf(0f, cards.size * pitch - 21.33f + 21.33f - 1760f)
    fun scrollFor(i: Int): Float = (i * pitch + 149f + shape.w / 2f - 1019f).coerceIn(0f, maxScroll())
  }

  override val railKey = "home"
  private val hero = Hero(this)
  private var views: List<JSONObject> = emptyList()
  private val rows = LinkedHashMap<String, Row>()
  private var order: List<Row> = emptyList()
  private var nav: List<Row> = emptyList()
  private var cur: Row? = null
  private var col = 0
  private var onSeeAll = false
  private val sy = Glide()
  private var contentH = 1080f
  private var editTop = 0f
  private var loadedFor = ""
  private var waitRow: Row? = null; private var waitAt = 0L
  // Browse by genre
  private var genreLibs: List<JSONObject> = emptyList()
  private var genreLib = ""
  private var genreRows: List<Row> = emptyList()
  private var genreFade = 1f; private var genreSwapAt = 0L; private var genrePending: String? = null
  private var lastRowFill = 0L
  private var gen = 0
  var prefs = JSONObject(); private set

  private val r = RectF()
  private val h2 = Ui.text(Ui.f800, 26.67f, Ui.TEXT, -0.27f)
  private val smartSub = Ui.text(Ui.f500, 18f, Ui.MUTED, -0.27f)
  private val countP = Ui.text(Ui.f400, 18.67f, Ui.MUTED)
  private val seeAllP = Ui.text(Ui.f700, 17.33f, Ui.MUTED)
  private val tabP = Ui.text(Ui.f700, 22.67f, Ui.WHITE)
  private val tabBg = Ui.fill(0x14FFFFFF)
  private val focBg = Ui.fill(Ui.WHITE)
  private val activeRing = Ui.stroke(Ui.RED, 2.67f)
  private val outline = Ui.stroke(Ui.WHITE, 4f)
  private val editP = Ui.text(Ui.f700, 18.67f, Ui.TEXT)
  private val editIcon = Ui.stroke(Ui.TEXT, 2.33f)

  // ---------------- data ----------------

  override fun show(fresh: Boolean) {
    val key = Net.session.key
    if (loadedFor != key) { loadedFor = key; load() }
    hero.resume()
  }
  override fun hide() { hero.pause() }
  /** At app start, while the web page is still loading: fetch Home's rows (and their pictures) early. */
  fun preload() { val key = Net.session.key; if (Net.session.ok && loadedFor != key) { loadedFor = key; load() } }

  fun setPrefs(p: JSONObject) {
    val rowsChanged = p.optString("homeRows") != prefs.optString("homeRows")
    val heroChanged = p.optString("heroMode") != prefs.optString("heroMode")
    prefs = p
    if (views.isEmpty()) return
    if (rowsChanged) applyOrder()
    if (heroChanged) hero.modeChanged()
  }

  override fun stale() { if (loadedFor.isNotEmpty()) { loadRows(true) } }

  private fun load() {
    gen++
    Net.load("/Users/{userId}/Views") { v, _ ->
      val list = Net.items(v).filter { it.optString("CollectionType") != "music" }
      val same = list.map { it.optString("Id") + it.optString("Name") } == views.map { it.optString("Id") + it.optString("Name") }
      views = list
      if (!same || rows.isEmpty()) { buildRows(); loadRows(false) }
    }
  }

  private val NO_LATEST = setOf("boxsets", "playlists", "livetv", "channels", "music")
  private fun latest() = views.filter { it.optString("CollectionType") !in NO_LATEST }

  private fun buildRows() {
    val old = HashMap(rows)
    rows.clear()
    fun add(id: String, k: Kind) = rows.put(id, old[id]?.takeIf { it.kind == k } ?: Row(id, k))
    add("hero", Kind.HERO); add("resume", Kind.CARDS); add("nextup", Kind.CARDS); add("because", Kind.CARDS); add("library", Kind.LIB)
    for (v in latest()) add("latest-" + v.optString("Id"), Kind.CARDS)
    add("unseen", Kind.CARDS); add("again", Kind.CARDS); add("genres", Kind.GHEAD); add("edit", Kind.EDIT)
    val lib = rows["library"]!!
    lib.title = "Library"; lib.shape = Shape.LIB
    lib.cards = views.map { Card(it, Shape.LIB, lib = true) }
    lib.shown = lib.cards.isNotEmpty()
    rows["edit"]!!.shown = true
    applyOrder()
  }

  /** Default row list, for the Edit home card (same ids and names as the web). */
  fun rowList(): JSONArray {
    val a = JSONArray()
    fun add(id: String, label: String, smart: Boolean = false) = a.put(JSONObject().put("id", id).put("label", label).put("smart", smart))
    add("hero", "Banner"); add("resume", "Continue Watching"); add("nextup", "Next Up", true); add("because", "Because you watched…", true); add("library", "Library")
    for (v in latest()) add("latest-" + v.optString("Id"), "Latest " + v.optString("Name"))
    add("unseen", "Your top genre you haven't seen", true); add("again", "Watch again", true); add("genres", "Browse by genre")
    return a
  }

  private fun saved(): JSONObject = try { JSONObject(prefs.optString("homeRows", "{}").ifEmpty { "{}" }) } catch (_: Throwable) { JSONObject() }
  private fun off(id: String): Boolean { val o = saved().optJSONArray("off") ?: return false; for (i in 0 until o.length()) if (o.optString(i) == id) return true; return false }

  /** Saved order first; rows it doesn't know yet slot in after the row they follow by default (homeedit.js). */
  private fun applyOrder() {
    val ids = rows.keys.filter { it != "edit" }
    val s = saved().optJSONArray("order")
    val out = ArrayList<String>()
    if (s != null) for (i in 0 until s.length()) { val id = s.optString(i); if (id in ids && id !in out) out.add(id) }
    ids.forEachIndexed { i, id ->
      if (id in out) return@forEachIndexed
      var at = 0
      for (j in i - 1 downTo 0) { val k = out.indexOf(ids[j]); if (k >= 0) { at = k + 1; break } }
      out.add(at, id)
    }
    order = out.mapNotNull { rows[it] }.filter { !off(it.id) } + rows["edit"]!!
    relayout()
  }

  private val FIELDS = "PrimaryImageAspectRatio,ProductionYear,EndDate,BasicSyncInfo"
  private val IMG_OPTS = "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Thumb"
  private val q get() = "Fields=$FIELDS&$IMG_OPTS"

  private fun loadRows(refresh: Boolean) {
    val my = gen
    val alive = { my == gen }
    if (!refresh) genreSection()
    hero.load(refresh)
    Net.load("/Users/{userId}/Items/Resume?Limit=24&Recursive=true&MediaTypes=Video&$q,Logo") { v, _ ->
      if (alive()) fill("resume", "Continue Watching", "", Net.items(v).map { Card(it, Shape.WIDE, clickPlay = true, showArt = true) }, Shape.WIDE)
    }
    if (!off("nextup")) Net.load("/Shows/NextUp?UserId={userId}&Limit=20&$q") { v, _ ->
      if (alive()) fill("nextup", "Next Up", "The next episode of every show you're watching", Net.items(v).map { Card(it, Shape.WIDE, clickPlay = true) }, Shape.WIDE)
    }
    if (!off("because")) smart("because", refresh) {
      val d = Net.getNow("/Users/{userId}/Items?Recursive=true&IncludeItemTypes=Movie,Episode&Filters=IsPlayed&SortBy=DatePlayed&SortOrder=Descending&Limit=1&Fields=SeriesId")
      val last = Net.items(d).firstOrNull() ?: return@smart null
      val ep = last.optString("Type") == "Episode"
      val id = if (ep) last.optString("SeriesId") else last.optString("Id")
      val name = if (ep) last.optString("SeriesName") else last.optString("Name")
      if (id.isEmpty()) return@smart null
      val sim = Net.getNow("/Items/$id/Similar?UserId={userId}&Limit=20&$q")
      JSONObject().put("name", name).put("items", JSONArray(Net.items(sim).filter { !(it.optJSONObject("UserData")?.optBoolean("Played") ?: false) }))
    }
    if (!off("unseen")) smart("unseen", refresh) {
      val types = "IncludeItemTypes=Movie,Series&Recursive=true"
      val d = Net.getNow("/Users/{userId}/Items?$types&Filters=IsPlayed&Fields=Genres&Limit=300")
      val n = HashMap<String, Int>()
      for (i in Net.items(d)) { val g = i.optJSONArray("Genres") ?: continue; for (k in 0 until g.length()) n[g.getString(k)] = (n[g.getString(k)] ?: 0) + 1 }
      val top = n.entries.maxByOrNull { it.value }?.key ?: return@smart null
      val r = Net.getNow("/Users/{userId}/Items?$types&Genres=${Card.enc(top)}&Filters=IsUnplayed&SortBy=Random&Limit=20&$q")
      JSONObject().put("top", top).put("items", JSONArray(Net.items(r)))
    }
    if (!off("again")) Net.load("/Users/{userId}/Items?IncludeItemTypes=Movie,Series&Recursive=true&Filters=IsFavorite,IsPlayed&SortBy=DatePlayed&SortOrder=Ascending&Limit=20&$q") { v, _ ->
      if (alive()) fill("again", "Watch again", "Favorites you haven't seen in a while", Net.items(v).map { Card(it, Card.shapeFor(it)) }, Shape.PORTRAIT)
    }
    // Libraries you've hidden from "Latest" in Emby stay hidden here too.
    Net.load("/Users/{userId}") { u, _ ->
      val ex = (u as? JSONObject)?.optJSONObject("Configuration")?.optJSONArray("LatestItemsExcludes")
      val excluded = HashSet<String>(); if (ex != null) for (i in 0 until ex.length()) excluded.add(ex.getString(i))
      for (v in latest()) {
        val vid = v.optString("Id")
        if (vid in excluded) { rows["latest-$vid"]?.let { it.shown = false; it.cards = emptyList() }; continue }
        Net.load("/Users/{userId}/Items/Latest?ParentId=$vid&Limit=20&$q") { d, _ ->
          if (!alive()) return@load
          val items = Net.items(d)
          fill("latest-$vid", "Latest " + v.optString("Name"), "", items.map { Card(it, Card.shapeFor(it)) }, Shape.PORTRAIT)
          tileFallback(vid, items)
        }
      }
    }
  }

  /** Smart rows: saved copy drawn at once, fetched again quietly after the page has settled. */
  private fun smart(id: String, refresh: Boolean, fetch: () -> JSONObject?) {
    val f = java.io.File(tv.context.cacheDir, "native-meta/smart-$id-" + Net.session.key.hashCode() + ".json")
    val my = gen
    val render = { d: JSONObject ->
      val items = d.optJSONArray("items") ?: JSONArray()
      val list = List(items.length()) { items.getJSONObject(it) }
      val title = if (id == "because") "Because you watched " + d.optString("name") else d.optString("top") + " you haven't seen"
      fill(id, title, if (id == "unseen") "Your most watched genre" else "", list.map { Card(it, Card.shapeFor(it)) }, Shape.PORTRAIT)
    }
    var had: JSONObject? = null
    try { if (f.exists()) { had = JSONObject(f.readText()); render(had.optJSONObject("d") ?: JSONObject()) } } catch (_: Throwable) {}
    val fresh = had != null && System.currentTimeMillis() - had.optLong("t") < 6 * 3600_000L && !refresh
    if (fresh) return
    Net.main.postDelayed({
      Net.bg {
        val d = try { fetch() } catch (_: Throwable) { null } ?: return@bg
        try { f.writeText(JSONObject().put("t", System.currentTimeMillis()).put("d", d).toString()) } catch (_: Throwable) {}
        Net.main.post {
          if (my != gen) return@post
          // An out-of-date copy is only replaced where it can't be seen move (the row is below the screen).
          val row = rows[id]
          if (had == null || row == null || !row.shown || row.top > sy.pos + 1080f || cur !== row) render(d)
        }
      }
    }, 900)
  }

  private fun fill(id: String, title: String, sub: String, cards: List<Card>, shape: Shape) {
    val row = rows[id] ?: return
    val keepId = if (cur === row) row.cards.getOrNull(col)?.id else null
    val oldF = HashMap<String, Float>(); row.cards.forEach { oldF[it.id] = it.f }
    row.title = title; row.sub = sub; row.cards = cards; row.shape = if (cards.isNotEmpty()) cards[0].shape else shape
    cards.forEach { c -> oldF[c.id]?.let { c.f = it } }
    row.shown = cards.isNotEmpty()
    if (keepId != null) { val i = cards.indexOfFirst { it.id == keepId }; if (i >= 0) col = i else col = col.coerceAtMost(cards.size - 1).coerceAtLeast(0) }
    row.focus = row.focus.coerceIn(0, maxOf(0, cards.size - 1))
    relayout()
    tv.invalidate()
  }

  /** A library with no picture borrows the backdrop of its newest item. */
  private fun tileFallback(vid: String, items: List<JSONObject>) {
    val lib = rows["library"] ?: return
    val c = lib.cards.firstOrNull { it.id == vid } ?: return
    val it = items.firstOrNull { (it.optJSONArray("BackdropImageTags")?.length() ?: 0) > 0 || (it.optJSONArray("ParentBackdropImageTags")?.length() ?: 0) > 0 } ?: return
    val src = if ((it.optJSONArray("BackdropImageTags")?.length() ?: 0) > 0) Net.image(it.optString("Id"), "Backdrop/0", it.getJSONArray("BackdropImageTags").getString(0), 460)
      else Net.image(it.optString("ParentBackdropItemId"), "Backdrop/0", it.getJSONArray("ParentBackdropImageTags").getString(0), 460)
    fallbacks[vid] = src
  }
  val fallbacks = HashMap<String, String>()

  // ---------------- Browse by genre ----------------

  private val GENRE_LIBS = setOf("movies", "tvshows", "mixed", "")
  private fun genreTypes(v: JSONObject) = when (v.optString("CollectionType")) { "movies" -> "Movie"; "tvshows" -> "Series"; else -> "Movie,Series" }

  private fun genreSection() {
    genreLibs = views.filter { it.optString("CollectionType") in GENRE_LIBS && it.optString("CollectionType") != "boxsets" }
    val head = rows["genres"] ?: return
    head.title = "Browse by genre"
    head.shown = genreLibs.isNotEmpty() && !off("genres")
    if (genreLibs.isEmpty()) return
    var current = prefs.optString("genreLib")
    if (genreLibs.none { it.optString("Id") == current }) current = genreLibs[0].optString("Id")
    showGenreLib(current, false)
  }

  private val builtGenres = HashMap<String, List<Row>>()
  private fun showGenreLib(id: String, live: Boolean) {
    val lib = genreLibs.firstOrNull { it.optString("Id") == id } ?: return
    genreLib = id
    builtGenres[id]?.let { genreRows = it; relayout(); return }
    if (!live) genreRows = emptyList()
    val types = genreTypes(lib)
    Net.bg {
      val path = "/Genres?ParentId=$id&UserId={userId}&IncludeItemTypes=$types&Recursive=true&SortBy=SortName"
      val genres = Net.items(Net.cachedNow(path) ?: try { Net.getNow(path) } catch (_: Throwable) { null })
      Net.bg { try { Net.getNow(path) } catch (_: Throwable) {} }
      val counted = genres.map { g ->
        val p = "/Users/{userId}/Items?ParentId=$id&GenreIds=${g.optString("Id")}&IncludeItemTypes=$types&Recursive=true&Limit=0"
        val r = Net.cachedNow(p) ?: try { Net.getNow(p) } catch (_: Throwable) { null }
        g to ((r as? JSONObject)?.optInt("TotalRecordCount") ?: 0)
      }
      val tp = "/Users/{userId}/Items?ParentId=$id&IncludeItemTypes=$types&Recursive=true&Limit=0"
      val total = ((Net.cachedNow(tp) ?: try { Net.getNow(tp) } catch (_: Throwable) { null }) as? JSONObject)?.optInt("TotalRecordCount") ?: 0
      val list = counted.filter { it.second >= 6 && !(total >= 10 && it.second >= total * 0.8) }.sortedByDescending { it.second }
      val made = list.map { (g, n) ->
        Row("g:" + g.optString("Id"), Kind.GROW).apply {
          title = g.optString("Name"); count = n; genreId = g.optString("Id"); shape = Shape.PORTRAIT; shown = true
          seeAll = "#/library/" + Card.enc(id) + "/" + Card.enc(g.optString("Id"))
        }
      }
      Net.main.post {
        builtGenres[id] = made
        if (genreLib == id) { genreRows = made; relayout(); tv.invalidate() }
        // Refresh the counts quietly for next time.
        Net.bg { for ((g, _) in counted) try { Net.getNow("/Users/{userId}/Items?ParentId=$id&GenreIds=${g.optString("Id")}&IncludeItemTypes=$types&Recursive=true&Limit=0") } catch (_: Throwable) {}; try { Net.getNow(tp) } catch (_: Throwable) {} }
      }
    }
  }

  private val genreCache = HashMap<String, Pair<Long, List<JSONObject>>>()
  private fun fillGenre(row: Row) {
    val lib = genreLibs.firstOrNull { it.optString("Id") == genreLib } ?: return
    val types = genreTypes(lib)
    val key = "$genreLib/${row.genreId}/$types"
    val had = genreCache[key]
    val apply = { items: List<JSONObject> -> row.cards = items.map { Card(it, Shape.PORTRAIT) }; row.filled = true; row.loading = false; tv.invalidate() }
    if (had != null && System.currentTimeMillis() - had.first < 600_000) { apply(had.second); return }
    row.loading = true
    Net.get("/Users/{userId}/Items?ParentId=$genreLib&GenreIds=${row.genreId}&IncludeItemTypes=$types&Recursive=true&SortBy=Random&Limit=20&Fields=$FIELDS&$IMG_OPTS") { v ->
      if (v == null) { row.loading = false; return@get }
      val items = Net.items(v); genreCache[key] = System.currentTimeMillis() to items; apply(items)
    }
  }

  // ---------------- layout ----------------

  private fun relayout() {
    val before = cur?.let { it.top - sy.pos }
    var t = 35f
    val list = ArrayList<Row>()
    for (row in order) {
      when (row.kind) {
        Kind.HERO -> { if (hero.height() > 0f) { row.shown = true; row.top = 0f; t = 837f; list.add(row) } else row.shown = false }
        Kind.CARDS -> if (row.shown) { row.top = t; t += if (row.shape == Shape.WIDE) 425.33f else 541f; list.add(row) }
        Kind.LIB -> if (row.shown) { row.top = t; t += 400f; list.add(row) }
        Kind.GHEAD -> if (row.shown) {
          row.top = t + 29.33f; list.add(row)
          var g = row.top + 88f
          for (gr in genreRows) { gr.top = g; g += 514f; list.add(gr) }
          t = if (genreRows.isEmpty()) row.top + 88f + 24f else g + 24f
        }
        Kind.EDIT -> list.add(row)
        Kind.GROW -> {}
      }
    }
    // (Edit home sits 16 below where the next row would start.)
    rows["edit"]?.let { it.top = t - 24f + 16f; editTop = it.top }
    contentH = editTop + 261f
    nav = list.filter { it.kind != Kind.LIB || it.cards.isNotEmpty() }
    if (cur == null || cur !in nav) { cur = nav.firstOrNull { it.kind == Kind.HERO } ?: nav.firstOrNull { it.kind == Kind.CARDS || it.kind == Kind.LIB }; col = 0 }
    // Rows that fill in above the highlight must not move it on the screen.
    if (before != null && cur != null) { val d = (cur!!.top - sy.pos) - before; if (abs(d) > 0.5f) sy.shift(d) }
    sy.set(clampY(sy.to)); if (!sy.moving) sy.set(clampY(sy.pos), true)
  }

  private fun clampY(y: Float) = y.coerceIn(0f, maxOf(0f, contentH - 1080f))

  private fun sectionH(row: Row) = when (row.kind) {
    Kind.CARDS -> if (row.shape == Shape.WIDE) 362f else 477f
    Kind.LIB -> 337f
    Kind.GROW -> 477f
    else -> 61f
  }

  private fun aim(instant: Boolean = false) {
    val row = cur ?: return
    val y = when (row.kind) {
      Kind.HERO -> 0f
      Kind.GHEAD -> row.top + 30.5f - 540f
      Kind.EDIT -> row.top + 26.5f - 540f
      Kind.GROW -> if (onSeeAll) row.top + 22.5f - 540f else row.top + sectionH(row) / 2f - 540f
      else -> row.top + sectionH(row) / 2f - 540f
    }
    sy.set(clampY(y), instant)
    if (row.kind == Kind.CARDS || row.kind == Kind.LIB || row.kind == Kind.GROW) { row.focus = col; row.sx.set(row.scrollFor(col), instant) }
  }

  override fun behind() = abs(sy.to - sy.pos)

  // ---------------- remote ----------------

  private fun landCol(row: Row, fromX: Float): Int = when (row.kind) {
    Kind.HERO -> if (fromX > hero.moreX()) 1 else 0
    Kind.GHEAD -> genreLibs.indexOfFirst { it.optString("Id") == genreLib }.coerceAtLeast(0)
    Kind.EDIT -> 0
    // A row you had scrolled along is picked up where you left it; one at its start lands on its first poster.
    else -> if (row.sx.pos < 4f) 0 else row.focus.coerceIn(0, maxOf(0, row.cards.size - 1))
  }

  private fun focusX(): Float {
    val row = cur ?: return 0f
    return when (row.kind) {
      Kind.HERO -> if (col == 0) 300f else 500f
      Kind.CARDS, Kind.LIB, Kind.GROW -> 149f + col * row.pitch - row.sx.pos + row.shape.w / 2f
      else -> 600f
    }
  }

  override fun key(k: Int): Boolean {
    val row = cur ?: return false
    when (k) {
      KeyEvent.KEYCODE_DPAD_LEFT -> {
        if (onSeeAll) { onSeeAll = false; aim(); return true }
        when (row.kind) {
          Kind.HERO, Kind.GHEAD, Kind.CARDS, Kind.LIB, Kind.GROW -> { if (col == 0) return false; col--; aim(); return true }
          Kind.EDIT -> return false
        }
      }
      KeyEvent.KEYCODE_DPAD_RIGHT -> {
        if (onSeeAll) return true
        val max = when (row.kind) { Kind.HERO -> 1; Kind.GHEAD -> genreLibs.size - 1; Kind.EDIT -> 0; else -> row.cards.size - 1 }
        if (col < max) { col++; aim() }
        return true
      }
      KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_UP -> {
        val down = k == KeyEvent.KEYCODE_DPAD_DOWN
        if (onSeeAll && down) { onSeeAll = false; col = landCol(row, 0f).let { if (row.sx.pos < 4f) 0 else row.focus }; aim(); return true }
        // Up from a genre row's last posters reaches its "See all".
        if (!down && row.kind == Kind.GROW && !onSeeAll && focusX() > 1500f) { onSeeAll = true; aim(); return true }
        val i = nav.indexOf(row)
        var j = if (down) i + 1 else i - 1
        while (j in nav.indices) {
          val t = nav[j]
          if (t.kind == Kind.GROW && !t.filled) {
            // A row whose posters are still on their way: wait above it for a moment.
            val now = SystemClock.uptimeMillis()
            if (waitRow !== t) { waitRow = t; waitAt = now }
            if (now - waitAt < 3000) { if (!t.loading) fillGenre(t); return true }
            j += if (down) 1 else -1; continue
          }
          if ((t.kind == Kind.CARDS || t.kind == Kind.GROW) && t.cards.isEmpty()) { j += if (down) 1 else -1; continue }
          break
        }
        if (j !in nav.indices) return true
        val fx = focusX()
        if (row.kind == Kind.CARDS || row.kind == Kind.LIB || row.kind == Kind.GROW) row.focus = col
        onSeeAll = false
        cur = nav[j]; col = landCol(nav[j], fx)
        aim(); return true
      }
    }
    return false
  }

  override fun ok() {
    val row = cur ?: return
    when (row.kind) {
      Kind.HERO -> hero.press(col)
      Kind.GHEAD -> { val id = genreLibs.getOrNull(col)?.optString("Id") ?: return; if (id != genreLib) switchGenre(id) }
      Kind.EDIT -> openEdit()
      Kind.GROW -> if (onSeeAll) tv.host.go(row.seeAll) else open(row)
      else -> open(row)
    }
  }

  /** Edit home (native drawer): every change saves and Home follows straight away. */
  fun openEdit() = tv.edit.show(rowList(), saved()) { s -> prefs.put("homeRows", s); applyOrder(); tv.host.saveHomeRows(s) }

  private fun open(row: Row) {
    val c = row.cards.getOrNull(col) ?: return
    if (c.lib) { tv.host.go(c.href); return }
    if (c.playable && (c.clickPlay || c.type == "Episode")) tv.host.play(c.id) else tv.open(c)
  }

  override fun hold() {
    val row = cur ?: return
    if (onSeeAll) return
    val c = row.cards.getOrNull(col) ?: return
    if (c.lib) return
    tv.host.hold(c.id, row.id == "resume")
  }

  private fun switchGenre(id: String) {
    genrePending = id; genreSwapAt = SystemClock.uptimeMillis()
    tv.host.log("genreLib=$id")
    prefs.put("genreLib", id)
    onGenreLib?.invoke(id)
  }
  var onGenreLib: ((String) -> Unit)? = null

  // ---------------- drawing ----------------

  override fun draw(c: Canvas, now: Long, dt: Float): Boolean {
    var anim = sy.step(dt)
    // Genre tabs: the old rows fade out (180 ms), the new ones fade in.
    genrePending?.let { id ->
      genreFade = maxOf(0f, 1f - (now - genreSwapAt) / 180f)
      if (genreFade == 0f) { genrePending = null; genreSwapAt = now; showGenreLib(id, true) }
      anim = true
    }
    if (genrePending == null && genreFade < 1f) { genreFade = minOf(1f, (now - genreSwapAt) / 260f); anim = true }
    val y0 = sy.pos
    c.drawColor(Ui.BG)
    c.save(); c.translate(0f, -y0)
    val fast = tv.fast
    for (row in order) {
      if (!row.shown && row.kind != Kind.GHEAD && row.kind != Kind.EDIT) continue
      when (row.kind) {
        Kind.HERO -> if (row.shown && y0 < 820f) anim = hero.draw(c, now, dt, cur === row, col, fast) || anim
        Kind.CARDS, Kind.LIB -> anim = drawRow(c, row, now, dt, y0, fast) || anim
        Kind.GHEAD -> if (row.shown) {
          anim = drawGenreHead(c, row, now, dt) || anim
          val a = genreFade
          for (gr in genreRows) {
            if (gr.top > y0 + 1080f + 1333f || gr.top + 520f < y0 - 1333f) continue
            if (!gr.filled && !gr.loading) {
              // Built once it has stayed near the screen a moment; one at a time while you are moving.
              if (gr.nearAt == 0L) gr.nearAt = now
              if (now - gr.nearAt >= 70 && (!fast || now - lastRowFill >= 240)) { lastRowFill = now; fillGenre(gr) } else anim = true
            }
            if (gr.top > y0 + 1080f || gr.top + 520f < y0) continue
            if (a < 1f) c.saveLayerAlpha(0f, gr.top - 20f, Ui.W, gr.top + 520f, (255 * a).toInt())
            anim = drawRow(c, gr, now, dt, y0, fast) || anim
            if (a < 1f) c.restore()
          }
        }
        Kind.EDIT -> drawEdit(c, row)
        else -> {}
      }
    }
    c.restore()
    return anim
  }

  private fun drawRow(c: Canvas, row: Row, now: Long, dt: Float, y0: Float, fast: Boolean): Boolean {
    if (row.top > y0 + 1080f || row.top + 560f < y0) {
      row.cards.forEach { it.f = if (cur === row && it === row.cards.getOrNull(col)) 1f else 0f }
      return false
    }
    var anim = row.sx.step(dt)
    // Title (and the small grey line after it).
    val tx = 149f
    Ui.line(c, row.title, tx, row.top, 38.7f, h2)
    if (row.kind == Kind.GROW) {
      val w = h2.measureText(row.title)
      Ui.line(c, "${row.count} titles", tx + w + 18.67f, row.top + 8f, 27f, countP)
      seeAllP.color = if (cur === row && onSeeAll) Ui.WHITE else Ui.MUTED
      val sw = seeAllP.measureText("See all ›")
      Ui.line(c, "See all ›", 1888f - sw, row.top + 10f, 25f, seeAllP)
      if (cur === row && onSeeAll) { r.set(1888f - sw - 6f, row.top + 4f, 1894f, row.top + 41f); c.drawRoundRect(r, 13.3f, 13.3f, outline) }
    } else if (row.sub.isNotEmpty()) {
      val w = h2.measureText(row.title)
      Ui.line(c, row.sub, tx + w + 18.67f, row.top + 9f, 26f, smartSub)
    }
    val artTop = row.top + 54f
    val x0 = 149f - row.sx.pos
    val p = row.pitch
    c.save(); c.clipRect(139f, artTop - 30f, 1899f, artTop + row.shape.h + 100f)
    val first = maxOf(0, ((row.sx.pos - 160f) / p).toInt())
    val last = minOf(row.cards.size - 1, ((row.sx.pos + 1800f) / p).toInt() + 1)
    for (i in first..last) {
      val card = row.cards[i]
      val focused = cur === row && i == col && !onSeeAll
      anim = CardArt.stepFocus(card, focused, dt, fast) || anim
      if (card.lib && card.img != null && Img.peek(card.img) == null) fallbacks[card.id]?.let { fb -> if (Img.get(card.img) == null && Img.failed(card.img!!)) card.swap(fb) }
      if (!focused) anim = CardArt.draw(c, card, x0 + i * p, artTop, now, fast) || anim
    }
    // The highlighted one last, so its ring and lift sit over its neighbours.
    if (cur === row && !onSeeAll && col in first..last) anim = CardArt.draw(c, row.cards[col], x0 + col * p, artTop, now, fast) || anim
    c.restore()
    return anim
  }

  private fun drawGenreHead(c: Canvas, row: Row, now: Long, dt: Float): Boolean {
    Ui.line(c, row.title, 149f, row.top + 11f, 38.7f, h2)
    if (genreLibs.size <= 1) return false
    var x = 149f + h2.measureText(row.title) + 26.67f
    genreLibs.forEachIndexed { i, l ->
      val name = l.optString("Name")
      val w = tabP.measureText(name) + 53.33f
      r.set(x, row.top, x + w, row.top + 61f)
      val focused = cur === row && col == i
      val active = l.optString("Id") == (genrePending ?: genreLib)
      if (focused) c.drawRoundRect(r, 13.33f, 13.33f, focBg)
      else if (active) { r.inset(1.33f, 1.33f); c.drawRoundRect(r, 12f, 12f, activeRing); r.inset(-1.33f, -1.33f) }
      else c.drawRoundRect(r, 13.33f, 13.33f, tabBg)
      tabP.color = if (focused) 0xFF120C0C.toInt() else Ui.WHITE
      Ui.line(c, name, x + 26.67f, row.top + 14f, 33f, tabP)
      x += w + 16f
    }
    return false
  }

  private fun drawEdit(c: Canvas, row: Row) {
    val w = 171f; val x = (117f + 1920f) / 2f - w / 2f
    r.set(x, row.top, x + w, row.top + 53f)
    c.drawRoundRect(r, 13.33f, 13.33f, tabBg)
    Icons.draw(c, "edit", x + 24f, row.top + 16f, 21.33f, editIcon)
    Ui.line(c, "Edit home", x + 24f + 21.33f + 10.67f, row.top + 12f, 29f, editP)
    if (cur === row) { r.inset(-6f, -6f); c.drawRoundRect(r, 19.33f, 19.33f, outline) }
  }

  fun heroChanged() { relayout(); tv.invalidate() }
}
