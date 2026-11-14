package app.scrappy.player.tv

import android.graphics.Canvas
import android.graphics.Path
import android.graphics.RectF
import android.text.StaticLayout
import android.text.TextUtils
import android.view.KeyEvent
import org.json.JSONObject
import kotlin.math.abs

/** A cast member's page: photo, name, short bio, then a row of their movies and a row of their shows
 *  (personView in views.js, approved option B). */
class Person(tv: TvView, val personId: String) : Screen(tv) {
  override val railKey = ""
  private val FIELDS = "PrimaryImageAspectRatio,ProductionYear,EndDate,BasicSyncInfo"
  private val IMG_OPTS = "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Thumb"

  private var p: JSONObject? = null
  private var rows: List<Pair<String, List<Card>>> = emptyList()
  private var done = false
  private var loaded = false
  private val sx = ArrayList<Glide>()
  private val cols = ArrayList<Int>()
  private var row = 0
  private val sy = Glide()
  private var bioL: StaticLayout? = null

  override fun show(fresh: Boolean) { if (!loaded) { loaded = true; load() } }

  private fun load() {
    Net.load("/Users/{userId}/Items/$personId") { v, _ -> p = v as? JSONObject; bioL = null; tv.invalidate() }
    Net.bg {
      val views = try { Net.items(Net.cachedNow("/Users/{userId}/Views") ?: Net.getNow("/Users/{userId}/Views")) } catch (_: Throwable) { emptyList() }
        .filter { j -> j.optString("CollectionType") in setOf("movies", "tvshows", "mixed", "") }
      val q = "PersonIds=$personId&Recursive=true&IncludeItemTypes=Movie,Series&SortBy=PremiereDate,ProductionYear,SortName&SortOrder=Descending&Fields=$FIELDS,People&$IMG_OPTS&Limit=300"
      fun gather(get: (String) -> Any?): List<JSONObject> = views.flatMap { vw -> Net.items(get("/Users/{userId}/Items?ParentId=${vw.optString("Id")}&$q")) }
      val saved = gather { path -> Net.cachedNow(path) }
      if (saved.isNotEmpty()) Net.main.post { use(saved) }
      val fresh = gather { path -> try { Net.getNow(path) } catch (_: Throwable) { Net.cachedNow(path) } }
      Net.main.post { if (fresh.isNotEmpty() || saved.isEmpty()) use(fresh); done = true; tv.invalidate() }
    }
  }

  private fun use(all: List<JSONObject>) {
    val seen = HashSet<String>()
    val uniq = all.filter { j -> seen.add(j.optString("Id")) }
    fun cards(t: String) = uniq.filter { j -> j.optString("Type") == t }.map { j -> Card(j, Shape.PORTRAIT).also { c -> c.sub = roleOf(j) } }
    rows = listOf("Movies" to cards("Movie"), "Shows" to cards("Series")).filter { r -> r.second.isNotEmpty() }
    while (sx.size < rows.size) { sx.add(Glide()); cols.add(0) }
    if (row >= rows.size) row = 0
    tv.invalidate()
  }

  private fun roleOf(it: JSONObject): String {
    val a = it.optJSONArray("People")
    var me: JSONObject? = null
    if (a != null) for (k in 0 until a.length()) { val x = a.optJSONObject(k); if (x?.optString("Id") == personId) { me = x; break } }
    return me?.optString("Role")?.takeIf { s -> s.isNotEmpty() } ?: me?.optString("Type")?.takeIf { s -> s.isNotEmpty() && s != "Actor" }
      ?: (if (it.optInt("ProductionYear") > 0) it.optInt("ProductionYear").toString() else "")
  }

  // ---------- layout ----------
  private val HEAD_C = 331f
  private val ROW_H = 483f
  private fun headC(r: Int) = HEAD_C + r * ROW_H
  private fun scrollFor(i: Int, n: Int): Float = (i * 248.33f + 149f + 113.5f - 1019f).coerceIn(0f, maxOf(0f, n * 248.33f - 21.33f - 1749f))

  override fun behind() = abs(sy.to - sy.pos)

  override fun key(k: Int): Boolean {
    if (rows.isEmpty()) return k != KeyEvent.KEYCODE_DPAD_LEFT
    val n = rows[row].second.size
    when (k) {
      KeyEvent.KEYCODE_DPAD_LEFT -> { if (cols[row] == 0) return false; cols[row]-- }
      KeyEvent.KEYCODE_DPAD_RIGHT -> if (cols[row] < n - 1) cols[row]++
      KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_UP -> {
        val j = if (k == KeyEvent.KEYCODE_DPAD_DOWN) row + 1 else row - 1
        if (j !in rows.indices) return true
        val x = 149f + cols[row] * 248.33f - sx[row].pos
        row = j
        cols[row] = (0 until rows[row].second.size).minByOrNull { i -> abs(149f + i * 248.33f - sx[row].pos - x) } ?: 0
      }
    }
    sx[row].set(scrollFor(cols[row], rows[row].second.size))
    sy.set(if (row == 0) 0f else headC(row) - 226f)
    return true
  }

  override fun ok() { rows.getOrNull(row)?.second?.getOrNull(cols[row])?.let { c -> tv.open(c) } }
  override fun hold() { rows.getOrNull(row)?.second?.getOrNull(cols[row])?.let { c -> tv.host.hold(c.id, false) } }

  // ---------- drawing ----------
  private val r = RectF()
  private val nameP = Ui.text(Ui.f800, 66.67f, Ui.TEXT, -0.89f)
  private val metaP = Ui.text(Ui.f400, 24f, 0xFFE9DADB.toInt())
  private val bioP = Ui.text(Ui.f400, 22.67f, Ui.MUTED)
  private val h2 = Ui.text(Ui.f800, 34.67f, Ui.TEXT, -0.27f)
  private val countP = Ui.text(Ui.f400, 18.67f, Ui.MUTED)
  private val phBg = Ui.fill(0xFF2A2122.toInt())
  private val phIcon = Ui.stroke(0xFF8D7778.toInt(), 1.6f * 2.44f)
  private val border = Ui.stroke(Ui.LINE, 2f)
  private val emptyP = Ui.text(Ui.f400, 21.33f, Ui.MUTED)
  private val face = Path().apply { addCircle(12f, 8f, 4f, Path.Direction.CW); moveTo(4f, 21f); cubicTo(5.5f, 17f, 8.5f, 15f, 12f, 15f); cubicTo(15.5f, 15f, 18.5f, 17f, 20f, 21f) }

  override fun draw(c: Canvas, now: Long, dt: Float): Boolean {
    var anim = sy.step(dt)
    for (g in sx) anim = g.step(dt) || anim
    c.drawColor(Ui.BG)
    val o = p ?: return anim
    c.save(); c.translate(0f, -sy.pos)
    // Photo (round) and the text beside it, centred on each other.
    r.set(191f, 59f, 391f, 259f)
    c.drawOval(r, phBg)
    val tag = o.optJSONObject("ImageTags")?.optString("Primary").orEmpty()
    val pic = if (tag.isNotEmpty()) Img.get(Net.image(personId, "Primary", tag, 500)) else null
    if (pic != null) { val a = Img.fade(pic, now, tv.fast); Img.draw(c, pic, RectF(r), 100f, a, 0.3f); if (a < 1f) anim = true }
    else Icons.drawPath(c, face, 291f - 29.33f, 159f - 29.33f, 58.67f, phIcon)
    r.inset(1f, 1f); c.drawOval(r, border)
    val born = o.optString("PremiereDate").takeIf { s -> s.length >= 4 }?.let { s -> "Born " + s.substring(0, 4) } ?: ""
    val loc = o.optJSONArray("ProductionLocations")?.optString(0).orEmpty()
    val facts = listOf(born, loc).filter { s -> s.isNotEmpty() }.joinToString(" · ")
    val bio = o.optString("Overview")
    val bl = if (bio.isEmpty()) null else bioL ?: Ui.clamp(bio, bioP, 1147, 3, 32.9f).also { bioL = it }
    val h = 80f + (if (facts.isNotEmpty()) 32f else 0f) + (if (bl != null) 13.33f + bl.height else 0f)
    var y = 159f - h / 2f
    Ui.line(c, Ui.fit(o.optString("Name"), nameP, 1400f), 427f, y, 80f, nameP); y += 80f
    if (facts.isNotEmpty()) { Ui.line(c, facts, 427f, y, 32f, metaP); y += 32f }
    bl?.let { y += 13.33f; c.save(); c.translate(427f, y); it.draw(c); c.restore() }
    if (done && rows.isEmpty()) Ui.line(c, "Nothing on your server with them in it yet.", 149f, 310f, 30f, emptyP)
    for ((ri, rw) in rows.withIndex()) {
      val hc = headC(ri)
      if (hc - sy.pos > 1120f || hc + 460f - sy.pos < 0f) continue
      Ui.line(c, rw.first, 149f, hc - 23f, 46f, h2)
      Ui.line(c, "${rw.second.size} · Newest first", 149f + h2.measureText(rw.first) + 18.67f, hc - 12f, 27f, countP)
      val top = hc + 42f
      c.save(); c.clipRect(138f, top - 30f, 1898f, top + 440f)
      var focAt = -1
      for ((k, card) in rw.second.withIndex()) {
        val f = ri == row && k == cols[ri]
        anim = CardArt.stepFocus(card, f, dt, tv.fast) || anim
        val x = 149f + k * 248.33f - sx[ri].pos
        if (x + 227f < 117f || x > Ui.W) continue
        if (f) { focAt = k; continue }
        anim = CardArt.draw(c, card, x, top, now, tv.fast) || anim
      }
      if (focAt >= 0) anim = CardArt.draw(c, rw.second[focAt], 149f + focAt * 248.33f - sx[ri].pos, top, now, tv.fast) || anim
      c.restore()
    }
    c.restore()
    return anim
  }
}
