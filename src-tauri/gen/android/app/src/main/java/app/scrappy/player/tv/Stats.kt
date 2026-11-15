package app.scrappy.player.tv

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.view.KeyEvent
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/**
 * Stats, drawn natively (approved mock "Stats"): Movies & TV, all time. The four big numbers, your
 * shows (filter Watching / Up to date / Finished / Stopped), top movies, genres and decades, episodes
 * you rewatch, the actors you see most and fun facts. The numbers come from the web side (stats.js),
 * the same as the PC's Stats page.
 */
class Stats(tv: TvView) : Screen(tv) {
  override val railKey = "stats"

  private class Item(val a: String, val b: String, val v: String, val href: String, val pic: JSONObject?, val st: String, val f: Float, val ini: String)
  private class Row(val id: String, val title: String, val sub: String, val shape: Char, val all: List<Item>) {
    var top = 0f; var cur = 0; val sx = Glide()
    val w get() = when (shape) { 'W' -> 400f; 'P' -> 220f; else -> 190f }
    val h get() = when (shape) { 'W' -> 225f; 'P' -> 330f; else -> 190f }
  }

  private var m: JSONObject? = null
  private var err = ""
  private var rows: List<Row> = emptyList()
  private var chips: List<Pair<String, String>> = emptyList()
  private var chip = 0
  private var chipFoc = false
  private var ri = 0
  private val sy = Glide()
  private var chartsTop = 0f; private var factsTop = 0f; private var bottom = 0f

  private val r = RectF()
  private val fill = Ui.fill(Ui.PANEL)
  private val ringP = Ui.stroke(Color.WHITE, 5f)
  private val pTitle = Ui.text(Ui.display, 66f, Ui.TEXT)
  private val pSub = Ui.text(Ui.f400, 20f, Ui.MUTED)
  private val pCardK = Ui.text(Ui.f800, 15f, Ui.MUTED, 2f)
  private val pCardV = Ui.text(Ui.f800, 52f, Ui.TEXT)
  private val pCardU = Ui.text(Ui.f700, 22f, 0xCCF6E9E9.toInt())
  private val pCardD = Ui.text(Ui.f400, 17f, 0xFFD9C6C7.toInt())
  private val pHead = Ui.text(Ui.f800, 30f, Ui.TEXT)
  private val pHeadSub = Ui.text(Ui.f400, 18f, Ui.MUTED)
  private val pChip = Ui.text(Ui.f700, 18f, Ui.TEXT)
  private val pA = Ui.text(Ui.f700, 19f, Ui.TEXT)
  private val pB = Ui.text(Ui.f400, 16f, Ui.MUTED)
  private val pAc = Ui.text(Ui.f700, 19f, Ui.TEXT).apply { textAlign = Paint.Align.CENTER }
  private val pBc = Ui.text(Ui.f400, 16f, Ui.MUTED).apply { textAlign = Paint.Align.CENTER }
  private val pBadge = Ui.text(Ui.f800, 16f, Ui.WHITE)
  private val pTag = Ui.text(Ui.f800, 13f, Ui.WHITE, 1f)
  private val pIni = Ui.text(Ui.f800, 40f, 0xD9FFFFFF.toInt()).apply { textAlign = Paint.Align.CENTER }
  private val pBarN = Ui.text(Ui.f600, 18f, Ui.TEXT)
  private val pBarV = Ui.text(Ui.f700, 18f, Ui.TEXT).apply { textAlign = Paint.Align.RIGHT }
  private val pAxis = Ui.text(Ui.f700, 16f, Ui.MUTED).apply { textAlign = Paint.Align.CENTER }
  private val pFactK = Ui.text(Ui.f800, 14f, 0xB3F6E9E9.toInt(), 2f)
  private val pFactV = Ui.text(Ui.f800, 22f, Ui.TEXT)
  private val pFactS = Ui.text(Ui.f400, 16f, 0xBFF6E9E9.toInt())
  private val pNote = Ui.text(Ui.f400, 24f, Ui.MUTED)
  private val hot = Paint(Paint.ANTI_ALIAS_FLAG)

  private companion object {
    const val X = 150f
    const val W = 1680f
    const val INK = 0xFF1A0F10.toInt()
    val TAGS = mapOf("on" to ("WATCHING" to 0xFF3F6FB5.toInt()), "up" to ("UP TO DATE" to 0xFF4E7F73.toInt()), "fin" to ("FINISHED" to 0xFF2F7A4A.toInt()), "off" to ("STOPPED" to 0xFF6B5556.toInt()))
    val CHIP_KEYS = listOf("all" to "All", "on" to "Watching", "up" to "Up to date", "fin" to "Finished", "off" to "Stopped")
  }

  override fun show(fresh: Boolean) { if (m == null || fresh) load() }
  override fun stale() { load() }

  private fun load() {
    tv.host.stats { o ->
      if (o == null || o.has("err")) { if (m == null) err = o?.optString("err").orEmpty().ifEmpty { "Couldn't add up your stats." }; tv.invalidate(); return@stats }
      err = ""; m = o; build(o); tv.invalidate()
    }
  }

  private fun items(a: JSONArray?, f: (JSONObject) -> Item) = a?.let { List(it.length()) { i -> f(it.getJSONObject(i)) } } ?: emptyList()

  private fun build(o: JSONObject) {
    val sh = o.optJSONObject("shows")
    val counts = sh?.optJSONObject("counts")
    chips = CHIP_KEYS.map { (k, l) -> k to "$l ${counts?.optInt(k) ?: 0}" }.filter { it.first == "all" || (counts?.optInt(it.first) ?: 0) > 0 }
    chip = chip.coerceIn(0, max(0, chips.size - 1))
    val shows = items(sh?.optJSONArray("items")) { Item(it.optString("name"), it.optString("m"), "", it.optString("href"), it.optJSONObject("pic"), it.optString("st"), it.optDouble("f", 0.0).toFloat(), "") }
    fun simple(key: String) = o.optJSONObject(key)?.optJSONArray("items")
    val movies = items(simple("top2")) { Item(it.optString("a"), it.optString("b"), it.optString("v"), it.optString("href"), it.optJSONObject("pic"), "", 0f, "") }
    val eps = items(simple("eps")) { Item(it.optString("a"), it.optString("b"), it.optString("v"), it.optString("href"), it.optJSONObject("pic"), "", 0f, "") }
    val faces = items(simple("faces")) { Item(it.optString("a"), it.optString("b"), "", it.optString("href"), it.optJSONObject("pic"), "", 0f, it.optString("ini")) }
    val old = rows.associateBy { it.id }
    rows = listOfNotNull(
      Row("shows", "Your shows", "by time watched", 'W', shows),
      if (movies.isNotEmpty()) Row("movies", "Top movies", "by rewatches", 'P', movies) else null,
      if (eps.isNotEmpty()) Row("eps", "Episodes you rewatch", o.optJSONObject("eps")?.optString("sub").orEmpty(), 'W', eps) else null,
      if (faces.isNotEmpty()) Row("faces", "Faces you see most", "top actors", 'F', faces) else null,
    )
    for (row in rows) old[row.id]?.let { row.cur = it.cur.coerceAtMost(max(0, list(row).size - 1)) }
    ri = ri.coerceIn(0, max(0, rows.size - 1))
    layout()
  }

  private fun list(row: Row): List<Item> {
    if (row.id != "shows") return row.all
    val k = chips.getOrNull(chip)?.first ?: "all"
    return if (k == "all") row.all else row.all.filter { it.st == k }
  }

  private fun layout() {
    var y = 388f
    for (row in rows) {
      row.top = y
      y += 58f + (if (row.id == "shows") 62f else 0f) + row.h + 74f
      if (row.id == "movies" || (row.id == "shows" && rows.none { it.id == "movies" })) { chartsTop = y + 10f; y += 10f + 370f + 46f }
    }
    factsTop = y
    bottom = y + 58f + 170f + 120f
  }

  // ---------- keys ----------

  override fun key(k: Int): Boolean {
    if (rows.isEmpty()) return false
    val row = rows[ri]
    when (k) {
      KeyEvent.KEYCODE_DPAD_UP -> when {
        ri == 0 && !chipFoc && chips.size > 1 -> chipFoc = true
        ri > 0 -> { ri--; chipFoc = false }
        else -> return true
      }
      KeyEvent.KEYCODE_DPAD_DOWN -> when {
        chipFoc -> chipFoc = false
        ri < rows.size - 1 -> ri++
        else -> return true
      }
      KeyEvent.KEYCODE_DPAD_LEFT -> {
        if (chipFoc) { if (chip == 0) return false; chip--; rows[0].cur = 0; rows[0].sx.set(0f) }
        else { if (row.cur == 0) return false; row.cur-- }
      }
      KeyEvent.KEYCODE_DPAD_RIGHT -> {
        if (chipFoc) { if (chip < chips.size - 1) { chip++; rows[0].cur = 0; rows[0].sx.set(0f) } }
        else if (row.cur < list(row).size - 1) row.cur++
      }
      else -> return false
    }
    aim(); tv.invalidate(); return true
  }

  private fun aim() {
    val row = rows.getOrNull(ri) ?: return
    sy.set(if (ri == 0) 0f else max(0f, min(row.top - 180f, bottom - Ui.H)))
    row.sx.set(max(0f, (row.cur - 2) * (row.w + 22f)))
  }

  override fun ok() {
    if (chipFoc) { chipFoc = false; tv.invalidate(); return }
    val row = rows.getOrNull(ri) ?: return
    val it = list(row).getOrNull(row.cur) ?: return
    if (it.href.isNotEmpty()) tv.host.go(it.href)
  }

  override fun back(): Boolean {
    if (chipFoc || ri > 0) { chipFoc = false; ri = 0; aim(); tv.invalidate(); return true }
    return false
  }

  override fun behind() = kotlin.math.abs(sy.to - sy.pos)

  // ---------- drawing ----------

  override fun draw(c: Canvas, now: Long, dt: Float): Boolean {
    var anim = sy.step(dt)
    for (row in rows) anim = row.sx.step(dt) || anim
    c.drawColor(Ui.BG)
    val o = m
    c.save(); c.translate(0f, -sy.pos)
    Ui.line(c, "Stats", X, 60f, 80f, pTitle)
    val tw = pTitle.measureText("Stats")
    Ui.line(c, o?.optString("sub")?.ifEmpty { null } ?: "All time · everything you've watched on Emby", X + tw + 24f, 86f, 40f, pSub)
    if (o == null) {
      Ui.line(c, err.ifEmpty { "Adding up everything you've watched…" }, X, 200f, 40f, pNote)
      c.restore(); return anim
    }
    drawCards(c, o.optJSONArray("cards"))
    for ((i, row) in rows.withIndex()) {
      if (row.top - sy.pos > Ui.H || row.top + row.h + 200f - sy.pos < 0f) continue
      anim = drawRow(c, row, i == ri && !chipFoc, now) || anim
    }
    if (chartsTop - sy.pos < Ui.H && chartsTop + 370f - sy.pos > 0f) drawCharts(c, o)
    if (factsTop - sy.pos < Ui.H) drawFacts(c, o.optJSONArray("facts"))
    c.restore()
    return anim
  }

  private fun drawCards(c: Canvas, a: JSONArray?) {
    a ?: return
    val n = a.length(); if (n == 0) return
    val gap = 20f; val w = (W - gap * (n - 1)) / n
    for (i in 0 until n) {
      val o = a.getJSONObject(i)
      val x = X + i * (w + gap)
      r.set(x, 170f, x + w, 338f)
      if (o.optBoolean("hot")) {
        if (hot.shader == null) hot.shader = LinearGradient(0f, 0f, w, 168f, 0xFF5A1518.toInt(), 0xFF2A0F11.toInt(), Shader.TileMode.CLAMP)
        c.save(); c.translate(x, 170f); c.drawRoundRect(RectF(0f, 0f, w, 168f), 20f, 20f, hot); c.restore()
        pCardK.color = 0xFFFF9DA0.toInt()
      } else { fill.color = Ui.PANEL; c.drawRoundRect(r, 20f, 20f, fill); pCardK.color = Ui.MUTED }
      Ui.line(c, o.optString("k"), x + 28f, 192f, 22f, pCardK)
      val v = o.optString("v")
      Ui.line(c, v, x + 28f, 222f, 60f, pCardV)
      val u = o.optString("u")
      if (u.isNotEmpty()) Ui.line(c, u, x + 28f + pCardV.measureText(v) + 8f, 236f, 40f, pCardU)
      Ui.line(c, Ui.fit(o.optJSONObject("d")?.optString("t").orEmpty(), pCardD, w - 56f), x + 28f, 290f, 26f, pCardD)
    }
  }

  private fun drawRow(c: Canvas, row: Row, foc: Boolean, now: Long): Boolean {
    var anim = false
    Ui.line(c, row.title, X, row.top, 40f, pHead)
    if (row.sub.isNotEmpty()) Ui.line(c, row.sub, X + pHead.measureText(row.title) + 18f, row.top + 6f, 34f, pHeadSub)
    var y = row.top + 58f
    if (row.id == "shows") {
      var x = X
      for ((j, ch) in chips.withIndex()) {
        val on = j == chip; val f = on && chipFoc
        val w = pChip.measureText(ch.second) + 40f
        r.set(x, y, x + w, y + 44f)
        fill.color = if (f) Ui.TEXT else if (on) Ui.RED else Ui.BUTTON; c.drawRoundRect(r, 22f, 22f, fill)
        pChip.color = if (f) INK else Ui.TEXT; Ui.line(c, ch.second, x + 20f, y, 44f, pChip)
        x += w + 10f
      }
      y += 62f
    }
    val l = list(row)
    if (l.isEmpty()) { Ui.line(c, "Nothing here yet.", X, y, 40f, pB); return false }
    c.save(); c.clipRect(X - 20f, y - 20f, Ui.W, y + row.h + 90f)
    for ((j, it) in l.withIndex()) {
      val x = X + j * (row.w + 22f) - row.sx.pos
      if (x > Ui.W || x + row.w < 0f) continue
      val f = foc && j == row.cur
      anim = drawItem(c, row, it, x, y, f, now) || anim
    }
    c.restore()
    return anim
  }

  private fun drawItem(c: Canvas, row: Row, it: Item, x: Float, y: Float, f: Boolean, now: Long): Boolean {
    val round = row.shape == 'F'
    val rad = if (round) row.w / 2f else 14f
    r.set(x, y, x + row.w, y + row.h)
    fill.color = Color.HSVToColor(floatArrayOf((it.a.hashCode().ushr(1) % 360).toFloat(), 0.35f, 0.32f))
    c.drawRoundRect(r, rad, rad, fill)
    var anim = false
    val p = it.pic?.let { o -> Img.get(Net.image(o.optString("id"), o.optString("type"), o.optString("tag").ifEmpty { null }, o.optInt("w", 300))) }
    if (p != null) { val a = Img.fade(p, now, tv.fast); if (a < 1f) anim = true; Img.draw(c, p, RectF(r), rad, a) }
    else if (round && it.ini.isNotEmpty()) Ui.line(c, it.ini, r.centerX(), r.centerY() - 26f, 52f, pIni)
    if (it.v.isNotEmpty()) {
      val w = pBadge.measureText(it.v) + 20f
      val br = RectF(r.right - 10f - w, r.top + 10f, r.right - 10f, r.top + 38f)
      fill.color = 0xA6000000.toInt(); c.drawRoundRect(br, 10f, 10f, fill)
      Ui.line(c, it.v, br.left + 10f, br.top, 28f, pBadge)
    }
    TAGS[it.st]?.let { (t, col) ->
      val w = pTag.measureText(t) + 20f
      // Top right: show pictures usually carry their logo on the left (Breaking Bad's was covered).
      val tr = RectF(r.right - 10f - w, r.top + 10f, r.right - 10f, r.top + 36f)
      fill.color = col; c.drawRoundRect(tr, 8f, 8f, fill)
      Ui.line(c, t, tr.left + 10f, tr.top, 26f, pTag)
    }
    if (row.id == "shows") {
      c.save(); c.clipRect(r.left, r.bottom - 6f, r.right, r.bottom)
      fill.color = 0x80000000.toInt(); c.drawRoundRect(r, rad, rad, fill)
      fill.color = Ui.RED; c.drawRect(r.left, r.bottom - 6f, r.left + row.w * it.f.coerceIn(0f, 1f), r.bottom, fill)
      c.restore()
    }
    if (f) { val rr = RectF(r); rr.inset(-6f, -6f); c.drawRoundRect(rr, rad + 6f, rad + 6f, ringP) }
    val ty = r.bottom + 12f
    if (round) {
      Ui.line(c, Ui.fit(it.a, pAc, row.w + 20f), r.centerX(), ty, 26f, pAc)
      Ui.line(c, Ui.fit(it.b, pBc, row.w + 20f), r.centerX(), ty + 27f, 22f, pBc)
    } else {
      Ui.line(c, Ui.fit(it.a, pA, row.w), x, ty, 26f, pA)
      Ui.line(c, Ui.fit(it.b, pB, row.w), x, ty + 27f, 22f, pB)
    }
    return anim
  }

  private fun drawCharts(c: Canvas, o: JSONObject) {
    val y = chartsTop; val w = (W - 22f) / 2f
    // Genres: share of your time.
    r.set(X, y, X + w, y + 370f); fill.color = Ui.PANEL; c.drawRoundRect(r, 20f, 20f, fill)
    Ui.line(c, "Genres", X + 30f, y + 22f, 36f, pHead2)
    Ui.line(c, "share of your time", X + 30f + pHead2.measureText("Genres") + 14f, y + 28f, 30f, pB)
    val g = o.optJSONObject("genres")?.optJSONArray("items")
    var gy = y + 84f
    if (g != null) for (i in 0 until min(6, g.length())) {
      val it = g.getJSONObject(i)
      Ui.line(c, Ui.fit(it.optString("n"), pBarN, 140f), X + 30f, gy, 30f, pBarN)
      val bx = X + 190f; val bw = w - 190f - 30f - 70f
      r.set(bx, gy + 8f, bx + bw, gy + 22f); fill.color = Ui.BUTTON; c.drawRoundRect(r, 7f, 7f, fill)
      r.set(bx, gy + 8f, bx + bw * it.optDouble("w", 0.0).toFloat().coerceIn(0f, 1f), gy + 22f); fill.color = Ui.RED; c.drawRoundRect(r, 7f, 7f, fill)
      Ui.line(c, it.optString("v"), X + w - 30f, gy, 30f, pBarV)
      gy += 44f
    }
    // Decades: when what you watch came out.
    val dx = X + w + 22f
    r.set(dx, y, dx + w, y + 370f); fill.color = Ui.PANEL; c.drawRoundRect(r, 20f, 20f, fill)
    Ui.line(c, "Decades", dx + 30f, y + 22f, 36f, pHead2)
    Ui.line(c, "when what you watch came out", dx + 30f + pHead2.measureText("Decades") + 14f, y + 28f, 30f, pB)
    val d = o.optJSONArray("decades") ?: return
    val n = d.length(); if (n == 0) return
    val gap = 16f; val bw = (w - 60f - gap * (n - 1)) / n
    val base = y + 370f - 56f; val top = y + 90f
    var best = 0; for (i in 0 until n) if (d.getJSONObject(i).optDouble("h") > d.getJSONObject(best).optDouble("h")) best = i
    for (i in 0 until n) {
      val it = d.getJSONObject(i)
      val bx = dx + 30f + i * (bw + gap)
      val h = (base - top) * (it.optDouble("h", 0.0).toFloat() / 100f)
      r.set(bx, base - max(4f, h), bx + bw, base); fill.color = if (i == best) Ui.RED else 0xFF5A2A2C.toInt(); c.drawRoundRect(r, 8f, 8f, fill)
      Ui.line(c, it.optString("axis"), bx + bw / 2f, base + 10f, 26f, pAxis)
    }
  }
  private val pHead2 = Ui.text(Ui.f800, 26f, Ui.TEXT)

  private fun drawFacts(c: Canvas, a: JSONArray?) {
    a ?: return
    val list = (0 until a.length()).map { a.getJSONObject(it) }.filter { it.optString("v").isNotEmpty() }
    if (list.isEmpty()) return
    Ui.line(c, "Fun facts", X, factsTop, 40f, pHead)
    val gap = 20f; val n = list.size; val w = (W - gap * (n - 1)) / n
    val y = factsTop + 58f
    for ((i, o) in list.withIndex()) {
      val x = X + i * (w + gap)
      r.set(x, y, x + w, y + 170f); fill.color = if (i == 0) Ui.BUTTON else Ui.PANEL; c.drawRoundRect(r, 18f, 18f, fill)
      Ui.line(c, o.optString("k").uppercase(), x + 24f, y + 22f, 20f, pFactK)
      val l = Ui.clamp(o.optString("v"), pFactV, (w - 48f).toInt(), 2, 28f)
      c.save(); c.translate(x + 24f, y + 52f); l.draw(c); c.restore()
      Ui.line(c, Ui.fit(o.optString("s"), pFactS, w - 48f), x + 24f, y + 52f + l.height + 8f, 22f, pFactS)
    }
  }
}
