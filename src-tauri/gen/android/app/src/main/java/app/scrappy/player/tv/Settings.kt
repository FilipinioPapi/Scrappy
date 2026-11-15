package app.scrappy.player.tv

import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.text.StaticLayout
import android.view.KeyEvent
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/**
 * Settings, drawn natively (approved mock "Settings"): sections on the left, their settings on the right.
 * OK flips a switch or opens a list; a choice of two to four (countdown, seek step, subtitle size...) also
 * changes with Left / Right right on the row. Subtitle size and style show a sample line while picked.
 * The rows and what they do come from the web side (tvsettings.js), so the player and this page agree.
 */
class Settings(tv: TvView) : Screen(tv) {
  override val railKey = "settings"

  private class Row(val o: JSONObject) {
    val t = o.optString("t"); val key = o.optString("key"); val label = o.optString("label"); val desc = o.optString("desc")
    val act = o.optString("act"); val arg = o.optString("arg"); val btn = o.optString("btn"); val letter = o.optString("letter"); val red = o.optBoolean("red")
    var on = o.optBoolean("on")
    val opts: List<String> = o.optJSONArray("opts")?.let { a -> List(a.length()) { a.optString(it) } } ?: emptyList()
    val vals: List<String> = o.optJSONArray("vals")?.let { a -> List(a.length()) { a.optString(it) } } ?: emptyList()
    var cur = o.optInt("cur")
    val short get() = t == "ch" && opts.size in 2..4
    var descL: StaticLayout? = null
    var top = 0f; var h = 0f
  }
  private class Sec(val id: String, val name: String, val kicker: String, val head: Boolean, val rows: List<Row>)

  private var secs: List<Sec> = emptyList()
  private val items get() = secs.filter { !it.head }
  private var ni = 0
  private var side = 'N'          // N = sections, R = rows
  private var ri = 0
  private var loaded = false
  private var wantSec = ""
  private val sy = Glide()
  private var busy = false

  override fun show(fresh: Boolean) {
    val parts = tv.routeHash.substringBefore('?').split('/')
    wantSec = parts.getOrNull(2).orEmpty()
    if (!fresh && loaded) { pickWanted(); return }
    reload()
  }

  override fun stale() { if (loaded) reload(keep = true) }

  private fun reload(keep: Boolean = false) {
    tv.host.setAct("model", JSONObject()) { r -> r?.optJSONObject("model")?.let { m -> load(m, keep) } }
  }

  private fun load(m: JSONObject, keep: Boolean) {
    val a = m.optJSONArray("sections") ?: return
    val curId = items.getOrNull(ni)?.id
    secs = List(a.length()) { k ->
      val s = a.getJSONObject(k)
      val h = s.optString("h")
      if (h.isNotEmpty()) Sec("", h, "", true, emptyList())
      else Sec(s.optString("id"), s.optString("name"), s.optString("kicker"), false,
        s.optJSONArray("rows")?.let { rs -> List(rs.length()) { Row(rs.getJSONObject(it)) } } ?: emptyList())
    }
    if (!loaded || !keep) { loaded = true; pickWanted() }
    else ni = max(0, items.indexOfFirst { it.id == curId })
    ri = ri.coerceIn(0, max(0, rows().size - 1))
    layout(); tv.invalidate()
  }

  private fun pickWanted() {
    val i = items.indexOfFirst { it.id == wantSec }
    if (i >= 0) { ni = i; side = 'R'; ri = 0 } else if (!loaded || side == 'N') { side = 'N' }
    layout(); tv.invalidate()
  }

  private fun sec() = items.getOrNull(ni)
  private fun rows(): List<Row> = sec()?.rows?.filter { it.t != "grp" } ?: emptyList()

  // ---------------- layout ----------------
  private val PX = 600f; private val PR = 1830f
  private fun preview(r: Row) = side == 'R' && rows().getOrNull(ri) === r && (r.key == "subScale" || r.key == "subStyle")

  private fun layout() {
    val s = sec() ?: return
    var y = 252f
    val ctrlW = 300f
    for (r in s.rows) {
      if (r.t == "grp") { r.top = y; r.h = 50f; y += 50f; continue }
      val textW = (PR - PX - 52f - ctrlW - (if (r.letter.isNotEmpty()) 76f else 0f)).toInt()
      if (r.descL == null && r.desc.isNotEmpty()) r.descL = Ui.clamp(r.desc, pDesc, textW, 3, 24f)
      val inner = 30f + (r.descL?.let { 6f + it.height } ?: 0f)
      r.top = y; r.h = max(92f, inner + 34f) + if (preview(r)) 262f else 0f
      y += r.h + 8f
    }
  }

  private fun aim() {
    if (side != 'R') { sy.set(0f); return }
    val r = rows().getOrNull(ri) ?: return
    val bottom = r.top + r.h
    var t = sy.to
    if (bottom - t > 1030f) t = bottom - 1030f
    if (r.top - t < 250f) t = r.top - 250f
    sy.set(max(0f, t))
  }

  // ---------------- remote ----------------
  override fun behind() = kotlin.math.abs(sy.to - sy.pos)

  override fun key(k: Int): Boolean {
    if (side == 'N') {
      when (k) {
        KeyEvent.KEYCODE_DPAD_UP -> if (ni > 0) { ni--; ri = 0; layout() }
        KeyEvent.KEYCODE_DPAD_DOWN -> if (ni < items.size - 1) { ni++; ri = 0; layout() }
        KeyEvent.KEYCODE_DPAD_RIGHT -> enterRows()
        KeyEvent.KEYCODE_DPAD_LEFT -> return false
      }
      return true
    }
    val rs = rows()
    val r = rs.getOrNull(ri)
    when (k) {
      KeyEvent.KEYCODE_DPAD_UP -> if (ri > 0) { ri--; layout(); aim() }
      KeyEvent.KEYCODE_DPAD_DOWN -> if (ri < rs.size - 1) { ri++; layout(); aim() }
      KeyEvent.KEYCODE_DPAD_LEFT -> if (r != null && r.short) step(r, -1) else { side = 'N'; layout(); aim() }
      KeyEvent.KEYCODE_DPAD_RIGHT -> if (r != null && r.short) step(r, 1)
    }
    return true
  }

  override fun back(): Boolean {
    if (side == 'R') { side = 'N'; layout(); aim(); tv.invalidate(); return true }
    return false
  }

  private fun enterRows() { if (rows().isNotEmpty()) { side = 'R'; ri = 0; layout(); aim() } }

  private fun step(r: Row, d: Int) {
    val n = (r.cur + d).coerceIn(0, r.opts.size - 1)
    if (n != r.cur) set(r, n)
  }

  private fun set(r: Row, i: Int) {
    r.cur = i
    tv.host.setAct("set", JSONObject().put("key", r.key).put("value", r.vals.getOrElse(i) { "" })) { _ -> }
    tv.invalidate()
  }

  override fun ok() {
    if (side == 'N') { enterRows(); return }
    val r = rows().getOrNull(ri) ?: return
    when (r.t) {
      "sw" -> {
        r.on = !r.on
        tv.host.setAct("set", JSONObject().put("key", r.key).put("value", if (r.on) "on" else "off")) { _ -> }
      }
      "ch" -> tv.menu.pick(r.label, r.opts, r.cur) { i -> if (i >= 0 && i != r.cur) set(r, i) }
      "bt" -> button(r)
    }
    tv.invalidate()
  }

  private fun button(r: Row) {
    when (r.act) {
      "server" -> tv.menu.pick(r.label, listOf("Switch account", "Sign out", "Cancel"), -1) { i ->
        if (i == 0) run("switch", JSONObject().put("k", r.arg)) else if (i == 1) run("signout", JSONObject().put("k", r.arg))
      }
      "switch" -> run("switch", JSONObject().put("k", r.arg))
      "signoutAll" -> tv.menu.pick("Sign out of Emby, Navidrome and Audiobookshelf on this TV?", listOf("Sign out of all", "Cancel"), -1) { i -> if (i == 0) run("signoutAll", JSONObject()) }
      "goUpdates" -> { ni = max(0, items.indexOfFirst { it.id == "updates" }); side = 'R'; ri = 0; layout(); aim() }
      else -> run(r.act, JSONObject())
    }
  }

  private fun run(act: String, args: JSONObject) {
    if (busy) return
    busy = true
    tv.host.setAct(act, args) { r ->
      busy = false
      if (r == null) return@setAct
      if (!r.optBoolean("ok")) { r.optString("err").takeIf { it.isNotEmpty() }?.let { tv.host.toast(it, true) }; return@setAct }
      r.optString("toast").takeIf { it.isNotEmpty() }?.let { tv.host.toast(it, false) }
      r.optJSONObject("info")?.let { inf -> tv.menu.info(inf.optString("title"), inf.optJSONArray("lines")?.let { a -> List(a.length()) { a.optString(it) } } ?: emptyList()) }
      r.optJSONObject("model")?.let { m -> load(m, true) }
      tv.invalidate()
    }
  }

  // ---------------- drawing ----------------
  private val r = RectF()
  private val fill = Ui.fill(0)
  private val pTitle = Ui.text(Ui.display, 52f, Ui.TEXT)
  private val pHead = Ui.text(Ui.f800, 15f, 0xFF8C7778.toInt(), 2f)
  private val pNav = Ui.text(Ui.f700, 21f, Ui.MUTED)
  private val pKick = Ui.text(Ui.f800, 18f, Ui.MUTED, 2.5f)
  private val pSec = Ui.text(Ui.f800, 44f, Ui.TEXT)
  private val pLabel = Ui.text(Ui.f700, 22f, Ui.TEXT)
  private val pDesc = Ui.text(Ui.f400, 17f, Ui.TEXT)
  private val pVal = Ui.text(Ui.f700, 20f, Ui.TEXT)
  private val pBtn = Ui.text(Ui.f700, 19f, Ui.TEXT).apply { textAlign = Paint.Align.CENTER }
  private val pLetter = Ui.text(Ui.f800, 22f, Ui.TEXT).apply { textAlign = Paint.Align.CENTER }
  private val pArrow = Ui.stroke(Ui.TEXT, 2.6f)
  private val pSub = Ui.text(Ui.f600, 46f, Ui.WHITE).apply { textAlign = Paint.Align.CENTER }
  private val pSubStroke = Ui.text(Ui.f600, 46f, 0xFF000000.toInt()).apply { textAlign = Paint.Align.CENTER; style = Paint.Style.STROKE; strokeJoin = Paint.Join.ROUND }
  private val pPrevNote = Ui.text(Ui.f600, 15f, 0xCCFFFFFF.toInt(), 1.5f)
  private val still = Paint()

  override fun draw(c: Canvas, now: Long, dt: Float): Boolean {
    val anim = sy.step(dt)
    c.drawColor(Ui.BG)
    Ui.line(c, "Settings", 150f, 66f, 66f, pTitle)
    drawNav(c)
    val s = sec() ?: return anim
    c.save(); c.clipRect(PX - 10f, 0f, Ui.W, Ui.H); c.translate(0f, -sy.pos)
    Ui.line(c, s.kicker, PX, 150f, 24f, pKick)
    Ui.line(c, s.name, PX, 176f, 56f, pSec)
    val rs = rows()
    for (row in s.rows) {
      if (row.top + row.h - sy.pos < 0f || row.top - sy.pos > Ui.H) continue
      if (row.t == "grp") { Ui.line(c, row.label, PX + 4f, row.top + 16f, 30f, pHead); continue }
      drawRow(c, row, side == 'R' && rs.getOrNull(ri) === row)
    }
    c.restore()
    return anim
  }

  private fun drawNav(c: Canvas) {
    var y = 160f
    var k = 0
    for (s in secs) {
      if (s.head) { y += 14f; Ui.line(c, s.name, 168f, y, 26f, pHead); y += 30f; continue }
      val cur = k == ni; val foc = cur && side == 'N'
      r.set(150f, y, 550f, y + 60f)
      if (foc || cur) { fill.color = if (foc) Ui.TEXT else 0xFF2C1C1D.toInt(); c.drawRoundRect(r, 12f, 12f, fill) }
      if (cur) { fill.color = Ui.RED; r.set(168f, y + 17f, 174f, y + 43f); c.drawRoundRect(r, 3f, 3f, fill) }
      pNav.color = if (foc) 0xFF1A0F10.toInt() else if (cur) Ui.WHITE else Ui.MUTED
      Ui.line(c, s.name, 188f, y, 60f, pNav)
      y += 66f; k++
    }
  }

  private fun drawRow(c: Canvas, row: Row, foc: Boolean) {
    r.set(PX, row.top, PR, row.top + row.h)
    fill.color = if (foc) Ui.TEXT else 0xFF1E1415.toInt(); c.drawRoundRect(r, 14f, 14f, fill)
    val ink = if (foc) 0xFF1A0F10.toInt() else Ui.TEXT
    var x = PX + 26f
    val baseH = row.h - if (preview(row)) 262f else 0f
    if (row.letter.isNotEmpty()) {
      r.set(x, row.top + baseH / 2f - 26f, x + 52f, row.top + baseH / 2f + 26f)
      fill.color = 0xFF2C1C1D.toInt(); c.drawRoundRect(r, 14f, 14f, fill)
      pLetter.color = Ui.TEXT; Ui.line(c, row.letter, r.centerX(), r.top, 52f, pLetter)
      x += 76f
    }
    val textH = 30f + (row.descL?.let { 6f + it.height } ?: 0f)
    var ty = row.top + (baseH - textH) / 2f
    pLabel.color = ink; Ui.line(c, Ui.fit(row.label, pLabel, PR - x - 340f), x, ty, 30f, pLabel); ty += 36f
    row.descL?.let { l -> pDesc.color = Ui.alpha(ink, 0.72f); c.save(); c.translate(x, ty); l.draw(c); c.restore() }
    // The control on the right.
    val cy = row.top + baseH / 2f
    val right = PR - 26f
    when (row.t) {
      "sw" -> {
        r.set(right - 64f, cy - 18f, right, cy + 18f)
        fill.color = if (row.on) Ui.RED else if (foc) 0xFFC9B8B9.toInt() else Ui.LINE; c.drawRoundRect(r, 18f, 18f, fill)
        fill.color = Ui.WHITE; c.drawCircle(if (row.on) right - 18f else right - 46f, cy, 14f, fill)
      }
      "ch" -> {
        val v = row.opts.getOrElse(row.cur) { "" }
        pVal.color = ink
        if (row.short) {
          // ‹ value ›: Left and Right change it here.
          val w = pVal.measureText(v)
          val ax = right - 14f
          pArrow.color = Ui.alpha(ink, if (row.cur < row.opts.size - 1) 1f else 0.25f)
          c.drawLine(ax - 6f, cy - 8f, ax, cy, pArrow); c.drawLine(ax, cy, ax - 6f, cy + 8f, pArrow)
          Ui.line(c, v, ax - 22f - w, cy - 15f, 30f, pVal)
          val lx = ax - 22f - w - 22f
          pArrow.color = Ui.alpha(ink, if (row.cur > 0) 1f else 0.25f)
          c.drawLine(lx + 6f, cy - 8f, lx, cy, pArrow); c.drawLine(lx, cy, lx + 6f, cy + 8f, pArrow)
        } else {
          val t = "$v  ›"
          Ui.line(c, t, right - pVal.measureText(t), cy - 15f, 30f, pVal)
        }
      }
      "bt" -> {
        val w = pBtn.measureText(row.btn) + 44f
        r.set(right - w, cy - 24f, right, cy + 24f)
        fill.color = if (foc || row.red) Ui.RED else 0xFF2C1C1D.toInt(); c.drawRoundRect(r, 10f, 10f, fill)
        pBtn.color = Ui.TEXT; Ui.line(c, row.btn, r.centerX(), r.top, 48f, pBtn)
      }
    }
    if (preview(row)) drawPreview(c, row.top + baseH, row)
  }

  /** A sample subtitle over a dark film still, at the size and style picked. */
  private fun drawPreview(c: Canvas, top: Float, row: Row) {
    r.set(PX + 26f, top, PR - 26f, top + 240f)
    if (still.shader == null) still.shader = LinearGradient(0f, 0f, 1100f, 400f, intArrayOf(0xFF2F4B5E.toInt(), 0xFF6D8B7A.toInt(), 0xFF25333A.toInt()), floatArrayOf(0f, 0.55f, 1f), Shader.TileMode.MIRROR)
    c.save(); c.translate(r.left, r.top); val rr = RectF(0f, 0f, r.width(), r.height()); c.drawRoundRect(rr, 12f, 12f, still); c.restore()
    Ui.line(c, "PREVIEW", r.left + 18f, r.top + 12f, 20f, pPrevNote)
    val subs = secs.flatMap { it.rows }
    val scale = subs.firstOrNull { it.key == "subScale" }?.let { s -> s.vals.getOrNull(s.cur)?.toFloatOrNull() } ?: 1f
    val style = subs.firstOrNull { it.key == "subStyle" }?.let { s -> s.vals.getOrNull(s.cur) } ?: "outline"
    val text = "I never said it would be easy."
    pSub.textSize = 46f * scale; pSubStroke.textSize = pSub.textSize
    val cx = r.centerX(); val base = r.bottom - 34f
    val fm = pSub.fontMetrics
    when (style) {
      "box" -> {
        val w = pSub.measureText(text)
        fill.color = 0xB0000000.toInt(); c.drawRect(cx - w / 2f - 14f, base + fm.ascent - 8f, cx + w / 2f + 14f, base + fm.descent + 8f, fill)
        c.drawText(text, cx, base, pSub)
      }
      "shadow" -> {
        pSubStroke.color = 0xC0000000.toInt(); pSubStroke.style = Paint.Style.FILL
        c.drawText(text, cx + 3f * scale, base + 3f * scale, pSubStroke)
        pSubStroke.style = Paint.Style.STROKE; pSubStroke.strokeWidth = 1.6f * scale; pSubStroke.color = 0xFF000000.toInt()
        c.drawText(text, cx, base, pSubStroke); c.drawText(text, cx, base, pSub)
      }
      else -> {
        pSubStroke.style = Paint.Style.STROKE; pSubStroke.strokeWidth = 6f * scale; pSubStroke.color = 0xFF000000.toInt()
        c.drawText(text, cx, base, pSubStroke); c.drawText(text, cx, base, pSub)
      }
    }
    @Suppress("UNUSED_VARIABLE") val unused = row
  }
}
