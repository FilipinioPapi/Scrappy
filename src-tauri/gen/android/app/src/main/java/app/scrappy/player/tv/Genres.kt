package app.scrappy.player.tv

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.text.Layout
import android.text.StaticLayout
import android.view.KeyEvent
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.abs

/** The Genres screen: a colour tile per genre with two posters fanned out of it (genresView in
 *  views.js, approved Look 2). A tile opens that library filtered by the genre. */
class Genres(tv: TvView) : Screen(tv) {
  override val railKey = "genres"

  private class Tile(val id: String, val name: String, val count: Int, val c: IntArray, val sym: String) {
    var fans: List<String>? = null
    var nameL: StaticLayout? = null
  }

  private var libs: List<JSONObject> = emptyList()
  private var cur = ""
  private var tiles: List<Tile> = emptyList()
  private var loadedLib = ""
  private var learned = JSONObject()
  private var loaded = false
  private var gen = 0
  private var empty = ""

  // focus: row -1 = library tabs, otherwise tile index
  private var focus = -1
  private var tab = 0
  private val sy = Glide()
  private var fanFile: File? = null
  private var fanArt = JSONObject()

  private val GRID_TOP = 180f
  private val TW = 393.33f
  private val TH = 224f
  private val PX = TW + 26.67f
  private val PY = TH + 26.67f

  override fun show(fresh: Boolean) {
    if (loaded) return
    loaded = true
    fanFile = File(tv.context.cacheDir, "native-meta/fans-" + Net.session.key.hashCode() + ".json")
    try { fanFile?.takeIf { it.exists() }?.let { fanArt = JSONObject(it.readText()) } } catch (_: Throwable) {}
    tv.host.local("gtColors") { s -> learned = try { JSONObject(s ?: "{}") } catch (_: Throwable) { JSONObject() } }
    tv.host.local("tvGenLib") { s ->
      Net.load("/Users/{userId}/Views") { v, _ ->
        val ok = setOf("movies", "tvshows", "mixed", "")
        libs = Net.items(v).filter { j -> j.optString("CollectionType") in ok }
        if (libs.isEmpty()) { empty = "No movie or TV libraries found."; tv.invalidate(); return@load }
        if (cur.isEmpty() || libs.none { j -> j.optString("Id") == cur }) cur = libs.firstOrNull { j -> j.optString("Id") == s }?.optString("Id") ?: libs[0].optString("Id")
        tab = libs.indexOfFirst { j -> j.optString("Id") == cur }.coerceAtLeast(0)
        if (loadedLib != cur) draw()
        tv.invalidate()
      }
    }
  }

  override fun stale() {}

  private fun types(v: JSONObject) = when (v.optString("CollectionType")) { "movies" -> "Movie"; "tvshows" -> "Series"; else -> "Movie,Series" }

  private fun draw() {
    val lib = libs.firstOrNull { j -> j.optString("Id") == cur } ?: return
    val my = ++gen
    loadedLib = cur
    Net.load("/Genres?ParentId=$cur&UserId={userId}&SortBy=SortName&Recursive=true&IncludeItemTypes=${types(lib)}&Fields=ItemCounts") { v, _ ->
      if (my != gen) return@load
      val gs = Net.items(v).filter { g -> val n = cnt(g); n == 0 || n >= 5 }
      val old = tiles.associateBy { t -> t.id }
      tiles = gs.map { g ->
        val look = look(g.optString("Name"))
        Tile(g.optString("Id"), g.optString("Name"), cnt(g), look.first, look.second).also { t -> t.fans = old[t.id]?.fans ?: fanArt.optJSONArray("$cur/${t.id}")?.let { a -> List(a.length()) { k -> a.optString(k) } } }
      }
      empty = if (tiles.isEmpty()) "No genres in this library yet." else ""
      if (focus >= tiles.size) focus = tiles.size - 1
      fans()
      tv.invalidate()
    }
  }

  private fun cnt(g: JSONObject) = g.optInt("MovieCount").takeIf { it > 0 } ?: g.optInt("SeriesCount").takeIf { it > 0 } ?: g.optInt("ChildCount")

  /** Two posters per tile, fetched once and remembered (the web keeps the same list). */
  private fun fans() {
    val lib = libs.firstOrNull { j -> j.optString("Id") == cur } ?: return
    val my = gen
    val want = tiles.filter { t -> t.fans == null }
    if (want.isEmpty()) return
    Net.bg {
      for (t in want) {
        if (my != gen) return@bg
        val d = try { Net.getNow("/Users/{userId}/Items?ParentId=$cur&GenreIds=${t.id}&Recursive=true&IncludeItemTypes=${types(lib)}&SortBy=Random&Limit=2&ImageTypes=Primary") } catch (_: Throwable) { continue }
        val urls = Net.items(d).mapNotNull { i -> i.optJSONObject("ImageTags")?.optString("Primary")?.takeIf { s -> s.isNotEmpty() }?.let { tag -> Net.image(i.optString("Id"), "Primary", tag, 200) } }
        Net.main.post { t.fans = urls; fanArt.put("$cur/${t.id}", JSONArray(urls)); tv.invalidate() }
      }
      Net.main.post { try { fanFile?.writeText(fanArt.toString()) } catch (_: Throwable) {} }
    }
  }

  // ---------- colours (same table as gtiles.js) ----------

  private fun look(name: String): Pair<IntArray, String> {
    val k = name.lowercase().trim()
    for ((kws, c, sym) in MOODS) if (kws.any { w -> matches(k, w) }) return c.map { s -> Color.parseColor(s) }.toIntArray() to sym
    learned.optJSONArray(k)?.let { a -> if (a.length() >= 3) try { return IntArray(3) { i -> css(a.optString(i)) } to "❧" } catch (_: Throwable) {} }
    var h = 0L; for (ch in k) h = (h * 31 + ch.code) and 0xFFFFFFFFL
    val hue = (h % 360).toFloat()
    return intArrayOf(hsl(hue, 62f, 48f), hsl(hue + 18, 58f, 18f), hsl(hue + 30, 50f, 6f)) to "❧"
  }
  private fun matches(name: String, kw: String) = if (kw.length <= 3) Regex("(^|[^a-z])$kw([^a-z]|$)").containsMatchIn(name) else name.contains(kw)
  private fun hsl(h0: Float, s0: Float, l0: Float): Int {
    val h = (h0 % 360f) / 360f; val s = s0 / 100f; val l = l0 / 100f
    val q = if (l < 0.5f) l * (1 + s) else l + s - l * s; val p = 2 * l - q
    fun ch(t0: Float): Int { var t = t0; if (t < 0) t += 1f; if (t > 1) t -= 1f
      val v = if (t < 1f / 6) p + (q - p) * 6 * t else if (t < 0.5f) q else if (t < 2f / 3) p + (q - p) * (2f / 3 - t) * 6 else p
      return (v * 255 + 0.5f).toInt().coerceIn(0, 255) }
    return Color.rgb(ch(h + 1f / 3), ch(h), ch(h - 1f / 3))
  }
  private fun css(s: String): Int {
    val m = Regex("hsl\\((\\d+)\\s+(\\d+)%\\s+(\\d+)%\\)").find(s)
    if (m != null) return hsl(m.groupValues[1].toFloat(), m.groupValues[2].toFloat(), m.groupValues[3].toFloat())
    val r = Regex("rgb\\((\\d+),\\s*(\\d+),\\s*(\\d+)\\)").find(s)
    if (r != null) return Color.rgb(r.groupValues[1].toInt(), r.groupValues[2].toInt(), r.groupValues[3].toInt())
    return Color.parseColor(s)
  }

  // ---------- remote ----------

  private fun rowTop(i: Int) = GRID_TOP + (i / 4) * PY

  private fun aim() {
    val max = maxOf(0f, GRID_TOP + ((tiles.size + 3) / 4) * PY - 26.67f + 120f - 1080f)
    sy.set(if (focus < 0) 0f else (rowTop(focus) + TH / 2f - 597f).coerceIn(0f, max))
  }

  override fun behind() = abs(sy.to - sy.pos)

  override fun key(k: Int): Boolean {
    if (focus < 0) {
      when (k) {
        KeyEvent.KEYCODE_DPAD_LEFT -> { if (tab == 0) return false; tab-- }
        KeyEvent.KEYCODE_DPAD_RIGHT -> if (tab < libs.size - 1) tab++
        KeyEvent.KEYCODE_DPAD_DOWN -> if (tiles.isNotEmpty()) { focus = nearestTile(tabX(tab)); aim() }
      }
      return true
    }
    when (k) {
      KeyEvent.KEYCODE_DPAD_LEFT -> { if (focus % 4 == 0) return false; focus-- }
      KeyEvent.KEYCODE_DPAD_RIGHT -> if (focus % 4 < 3 && focus + 1 < tiles.size) focus++
      KeyEvent.KEYCODE_DPAD_DOWN -> if (focus + 4 < tiles.size) focus += 4 else if (focus / 4 < (tiles.size - 1) / 4) focus = tiles.size - 1
      KeyEvent.KEYCODE_DPAD_UP -> if (focus >= 4) focus -= 4 else if (libs.size > 1) { tab = libs.indexOfFirst { l -> l.optString("Id") == cur }.coerceAtLeast(0); focus = -1 }
    }
    aim()
    return true
  }

  private fun nearestTile(x: Float): Int { var b = 0; var d = Float.MAX_VALUE; for (c in 0 until minOf(4, tiles.size)) { val dd = abs(149f + c * PX + TW / 2f - x); if (dd < d) { d = dd; b = c } }; return b }
  private fun tabW(i: Int) = 26.67f * 2 + tabP.measureText(libs[i].optString("Name"))
  private fun tabLeft(i: Int): Float { var x = 149f; for (j in 0 until i) x += tabW(j) + 16f; return x }
  private fun tabX(i: Int) = tabLeft(i) + tabW(i) / 2f
  private fun nearestTab(x: Float): Int = libs.indices.minByOrNull { abs(tabX(it) - x) } ?: 0

  override fun ok() {
    if (focus < 0) {
      val l = libs.getOrNull(tab) ?: return
      if (l.optString("Id") == cur) return
      cur = l.optString("Id"); tv.host.setLocal("tvGenLib", cur)
      tiles = emptyList(); draw(); tv.invalidate(); return
    }
    val t = tiles.getOrNull(focus) ?: return
    tv.host.go("#/library/" + Card.enc(cur) + "/" + Card.enc(t.id))
  }

  // ---------- drawing ----------

  private val r = RectF()
  private val h2 = Ui.text(Ui.f800, 26.67f, Ui.TEXT, -0.2f)
  private val countP = Ui.text(Ui.f400, 18.67f, Ui.MUTED)
  private val tabP = Ui.text(Ui.f700, 22.67f, Ui.TEXT)
  private val tabBg = Ui.fill(0x17FFFFFF)
  private val tabFoc = Ui.fill(Ui.WHITE)
  private val tabActive = Ui.stroke(Ui.RED, 2.67f)
  private val nameP = Ui.text(Ui.display, 45.33f, Ui.WHITE, 0.67f).apply { setShadowLayer(10.67f, 0f, 2.67f, 0x66000000) }
  private val subP = Ui.text(Ui.f600, 21.33f, 0xCCFFFFFF.toInt())
  private val symP = Ui.text(android.graphics.Typeface.DEFAULT, 160f, 0x29FFFFFF)
  private val tileP = Paint(Paint.ANTI_ALIAS_FLAG)
  private val outline = Ui.stroke(Ui.WHITE, 4f)
  private val fanBd = Ui.stroke(0x38FFFFFF, 1.33f)
  private val fanPh = Paint(Paint.ANTI_ALIAS_FLAG)
  private val fanShadow = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF000000.toInt(); setShadowLayer(29f, 0f, 13f, 0x8C000000.toInt()) }
  private val emptyP = Ui.text(Ui.f400, 20f, Ui.MUTED).apply { textAlign = Paint.Align.CENTER }

  override fun draw(c: Canvas, now: Long, dt: Float): Boolean {
    var anim = sy.step(dt)
    c.drawColor(Ui.BG)
    c.save(); c.translate(0f, -sy.pos)
    Ui.line(c, "Genres", 149f, 35f, 39f, h2)
    if (tiles.isNotEmpty()) Ui.line(c, "${tiles.size} genre" + (if (tiles.size == 1) "" else "s"), 149f + h2.measureText("Genres") + 18.67f, 43f, 27f, countP)
    if (libs.size > 1) for (i in libs.indices) {
      val x = tabLeft(i); val w = tabW(i)
      r.set(x, 95f, x + w, 156f)
      val foc = focus < 0 && tab == i
      val active = libs[i].optString("Id") == cur
      if (foc) c.drawRoundRect(r, 10.67f, 10.67f, tabFoc)
      else if (active) { r.inset(1.33f, 1.33f); c.drawRoundRect(r, 9.33f, 9.33f, tabActive) }
      else c.drawRoundRect(r, 10.67f, 10.67f, tabBg)
      tabP.color = if (foc) Ui.BG else if (active) Ui.WHITE else Ui.TEXT
      Ui.line(c, libs[i].optString("Name"), x + 26.67f, 95f, 61f, tabP)
    }
    if (empty.isNotEmpty()) Ui.line(c, empty, (117f + 1920f) / 2f, 260f, 29f, emptyP)
    for ((i, t) in tiles.withIndex()) {
      val x = 149f + (i % 4) * PX; val y = rowTop(i)
      if (y - sy.pos > 1080f || y + TH - sy.pos < 0f) continue
      anim = drawTile(c, t, x, y, now) || anim
      if (i == focus) { r.set(x - 5.33f, y - 5.33f, x + TW + 5.33f, y + TH + 5.33f); c.drawRoundRect(r, 32f, 32f, outline) }
    }
    c.restore()
    return anim
  }

  private fun drawTile(c: Canvas, t: Tile, x: Float, y: Float, now: Long): Boolean {
    var anim = false
    r.set(x, y, x + TW, y + TH)
    tileP.shader = LinearGradient(x, y, x + TW, y + TH, t.c, floatArrayOf(0f, 0.6f, 1f), Shader.TileMode.CLAMP)
    c.save()
    val clip = android.graphics.Path().apply { addRoundRect(r, 26.67f, 26.67f, android.graphics.Path.Direction.CW) }
    c.clipPath(clip)
    c.drawRect(r, tileP)
    c.drawText(t.sym, x + TW * 0.3f, y + 13.33f - symP.fontMetrics.ascent * 0.82f, symP)
    // Two posters fanned out of the bottom right corner (bleeding off the edge).
    val fans = t.fans
    if (fans != null) {
      val pics = fans.map { u -> Img.get(u) }
      val ready = fans.isNotEmpty() && pics.all { p -> p != null }
      val a = if (fans.isEmpty()) 0f else if (!ready) 0f else Img.fade(pics.maxByOrNull { p -> p!!.at }!!, now, tv.fast)
      if (fans.isNotEmpty() && a < 1f) anim = true
      for (k in 0..1) {
        val right = x + TW - 8f - (if (k == 0) 82.67f else 5.33f)
        val left = right - 106.67f
        val bottom = y + TH + 40f
        val top = bottom - 160f
        c.save(); c.rotate(if (k == 0) -11f else 10f, (left + right) / 2f, (top + bottom) / 2f)
        r.set(left, top, right, bottom)
        val pic = pics.getOrNull(k)
        if (pic != null && a > 0f) {
          fanShadow.alpha = (255 * a).toInt(); c.drawRoundRect(r, 12f, 12f, fanShadow)
          Img.draw(c, pic, RectF(r), 12f, a)
          fanBd.alpha = (0x38 * a).toInt(); c.drawRoundRect(r, 12f, 12f, fanBd)
        }
        c.restore()
      }
    }
    c.restore()
    val lay = t.nameL ?: StaticLayout.Builder.obtain(t.name, 0, t.name.length, nameP, (TW - 64f).toInt()).setMaxLines(2)
      .setLineSpacing(0f, 45.33f / (nameP.fontMetrics.descent - nameP.fontMetrics.ascent)).setIncludePad(false).setAlignment(Layout.Alignment.ALIGN_NORMAL).build().also { t.nameL = it }
    c.save(); c.translate(x + 32f, y + 29.33f); lay.draw(c); c.restore()
    if (t.count > 0) Ui.line(c, "${t.count} title" + (if (t.count == 1) "" else "s"), x + 32f, y + 29.33f + lay.height + 5.33f, 29f, subP)
    return anim
  }

  companion object {
    private val MOODS: List<Triple<List<String>, List<String>, String>> = listOf(
      Triple(listOf("horror", "scary", "ghost", "zombie", "vampire", "paranormal", "supernatural"), listOf("#B3121B", "#2A0405", "#0A0000"), "☠"),
      Triple(listOf("thriller", "suspense", "spy", "espionage", "psychological"), listOf("#5E6B7A", "#1A1E26", "#07080B"), "◉"),
      Triple(listOf("true crime", "crime", "mystery", "detective", "noir", "cozy"), listOf("#2E6F73", "#0E2A2E", "#030C0E"), "⚲"),
      Triple(listOf("science fiction", "sci-fi", "scifi", "sf", "space", "cyberpunk", "dystopia", "post-apocalyptic", "litrpg", "gamelit"), listOf("#1F8FE0", "#0B2550", "#030915"), "✦"),
      Triple(listOf("fantasy", "magic", "dragon", "epic", "sword", "myth", "fairy", "progression"), listOf("#8E44D9", "#2A1150", "#0F0620"), "⚔"),
      Triple(listOf("romance", "love", "romantic"), listOf("#E8507A", "#5A1230", "#1C0610"), "♥"),
      Triple(listOf("erotica", "erotic"), listOf("#C2185B", "#4A0A24", "#160309"), "♥"),
      Triple(listOf("young adult", "teen", "ya"), listOf("#FF7A59", "#5B1E6E", "#1A0822"), "★"),
      Triple(listOf("children", "kids", "juvenile", "middle grade", "picture"), listOf("#FFC23D", "#D8582B", "#3A1206"), "✿"),
      Triple(listOf("history", "historical", "war", "military", "ancient", "medieval"), listOf("#C9893A", "#4A2C10", "#160C04"), "⌛"),
      Triple(listOf("biography", "memoir", "autobiography", "biographies"), listOf("#D9A066", "#4D3016", "#140C05"), "❝"),
      Triple(listOf("comedy", "humor", "humour", "funny", "satire"), listOf("#FFB020", "#B4441A", "#2E0E04"), "☺"),
      Triple(listOf("self-help", "self help", "personal development", "motivation", "productivity", "success"), listOf("#2FB57A", "#0E4A33", "#04140E"), "↑"),
      Triple(listOf("business", "finance", "money", "economics", "investing", "career", "entrepreneur"), listOf("#2A9D8F", "#0E3A35", "#04100E"), "$"),
      Triple(listOf("science", "physics", "biology", "chemistry", "astronomy", "nature", "math"), listOf("#3AB0C8", "#0E3F55", "#041219"), "⚛"),
      Triple(listOf("technology", "computer", "programming", "tech"), listOf("#4F7BFF", "#162A66", "#060C1E"), "⌘"),
      Triple(listOf("health", "fitness", "nutrition", "diet", "wellness", "medical"), listOf("#6CC24A", "#225017", "#0A1806"), "✚"),
      Triple(listOf("psychology", "mind", "mental", "philosophy"), listOf("#7E6BD6", "#2A2160", "#0B0920"), "◎"),
      Triple(listOf("religion", "spiritual", "christian", "faith", "bible"), listOf("#E8C872", "#6B4E16", "#1C1405"), "✧"),
      Triple(listOf("politics", "social", "society", "current affairs", "law"), listOf("#3D5A80", "#14223A", "#060A12"), "⚖"),
      Triple(listOf("travel", "adventure", "outdoors", "exploration"), listOf("#E07A3A", "#5A2A10", "#180A03"), "➶"),
      Triple(listOf("western", "cowboy"), listOf("#C8743A", "#5A2E12", "#1A0C04"), "☼"),
      Triple(listOf("poetry", "drama", "plays", "classic", "literature", "literary"), listOf("#B04A5A", "#4A1520", "#14050A"), "✎"),
      Triple(listOf("music", "art", "arts", "photography", "design"), listOf("#E0559B", "#5A1640", "#1A0612"), "♪"),
      Triple(listOf("cooking", "food", "cookbook"), listOf("#E8803A", "#6B2E0E", "#1C0A03"), "♨"),
      Triple(listOf("sports", "sport"), listOf("#2C9C5A", "#0F3E22", "#04120A"), "⚑"),
      Triple(listOf("education", "language", "reference", "study"), listOf("#4C8BC9", "#173250", "#060E18"), "✐"),
      Triple(listOf("short stories", "anthology", "collection"), listOf("#9A6FB0", "#3A2246", "#100916"), "❖"),
      Triple(listOf("fiction", "general", "contemporary", "novel"), listOf("#3E7CB1", "#16304A", "#070F18"), "✎"),
      Triple(listOf("nonfiction", "non-fiction"), listOf("#8C7A6B", "#33291F", "#0E0B08"), "❝"),
    )
  }
}
