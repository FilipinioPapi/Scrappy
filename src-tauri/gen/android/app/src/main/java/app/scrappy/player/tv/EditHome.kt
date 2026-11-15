package app.scrappy.player.tv

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.SystemClock
import android.view.KeyEvent
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/**
 * Edit home, drawn natively (approved mock "Edit home"): the same drawer and rows as the web card, made for the remote.
 * OK flips a row's switch (On / Hidden). Right reaches the row's Move button; OK there picks the row up, up and down
 * move it, OK or Back puts it down. Reset to default and Done at the bottom; Back closes. Every change saves at once
 * and Home behind follows straight away.
 */
class EditHome(private val tv: TvView) {
  private class R(val id: String, val label: String, val smart: Boolean)

  var open = false; private set
  private var rows = ArrayList<R>()
  private var defaults: List<R> = emptyList()
  private val off = HashSet<String>()
  private var f = 0            // 0..n-1 rows, n = Reset to default, n+1 = Done
  private var col = 0          // 0 = the row (its switch), 1 = its Move button
  private var moving = false
  private var openedAt = 0L
  private var closing = 0L
  private var okArmed = false
  private var save: ((String) -> Unit)? = null
  private val scroll = Glide()
  private var last = 0L

  /** rowList: the default rows [{id,label,smart}]; saved: {order, off}; save gets the new JSON ("" = back to default). */
  fun show(rowList: JSONArray, saved: JSONObject, onSave: (String) -> Unit) {
    defaults = (0 until rowList.length()).map { val o = rowList.getJSONObject(it); R(o.optString("id"), o.optString("label"), o.optBoolean("smart")) }
    save = onSave
    off.clear()
    saved.optJSONArray("off")?.let { a -> for (i in 0 until a.length()) off.add(a.optString(i)) }
    rows = ArrayList(ordered(saved.optJSONArray("order")))
    f = 0; col = 0; moving = false; okArmed = false
    open = true; closing = 0L; openedAt = SystemClock.uptimeMillis()
    scroll.set(0f, true)
    tv.invalidate()
  }

  /** Saved order first; rows it doesn't know yet slot in after the row they follow by default (homeedit.js). */
  private fun ordered(saved: JSONArray?): List<R> {
    val ids = defaults.map { it.id }
    val out = ArrayList<String>()
    if (saved != null) for (i in 0 until saved.length()) { val id = saved.optString(i); if (id in ids && id !in out) out.add(id) }
    ids.forEachIndexed { i, id ->
      if (id in out) return@forEachIndexed
      var at = 0
      for (j in i - 1 downTo 0) { val k = out.indexOf(ids[j]); if (k >= 0) { at = k + 1; break } }
      out.add(at, id)
    }
    val by = defaults.associateBy { it.id }
    return out.mapNotNull { by[it] }
  }

  private fun commit() {
    save?.invoke(JSONObject().put("order", JSONArray(rows.map { it.id })).put("off", JSONArray(off.toList())).toString())
  }

  private fun reset() {
    rows = ArrayList(defaults); off.clear(); f = 0; col = 0
    save?.invoke("")
  }

  private fun close() {
    if (!open || closing != 0L) return
    moving = false; closing = SystemClock.uptimeMillis()
    tv.invalidate()
  }

  // ---------------- keys ----------------

  fun key(e: KeyEvent): Boolean {
    if (!open) return false
    if (closing != 0L) return true
    val down = e.action == KeyEvent.ACTION_DOWN
    when (e.keyCode) {
      KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> if (down) move(e.keyCode)
      KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> {
        if (down && e.repeatCount == 0) okArmed = true
        else if (!down && okArmed) { okArmed = false; ok() }
      }
      KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> if (!down) { if (moving) { moving = false; commit() } else close() }
      else -> return true
    }
    tv.invalidate()
    return true
  }

  private fun move(code: Int) {
    val n = rows.size
    if (moving) {
      val to = f + when (code) { KeyEvent.KEYCODE_DPAD_UP -> -1; KeyEvent.KEYCODE_DPAD_DOWN -> 1; else -> 0 }
      if (to == f || to < 0 || to >= n) return
      val r = rows.removeAt(f); rows.add(to, r); f = to
      commit()
      return
    }
    when (code) {
      KeyEvent.KEYCODE_DPAD_UP -> when { f == n + 1 -> { f = n - 1; col = 1 }; f == n -> { f = n - 1; col = 0 }; f > 0 -> f-- }
      KeyEvent.KEYCODE_DPAD_DOWN -> when { f < n - 1 -> f++; f == n - 1 -> f = if (col == 1) n + 1 else n }
      KeyEvent.KEYCODE_DPAD_RIGHT -> when { f < n -> col = 1; f == n -> f = n + 1 }
      KeyEvent.KEYCODE_DPAD_LEFT -> when { f < n -> col = 0; f == n + 1 -> f = n }
    }
  }

  private fun ok() {
    val n = rows.size
    when {
      moving -> { moving = false; commit() }
      f == n -> reset()
      f == n + 1 -> close()
      col == 1 -> moving = true
      else -> { val id = rows[f].id; if (!off.remove(id)) off.add(id); commit() }
    }
  }

  // ---------------- drawing ----------------

  private val r = RectF()
  private val fill = Ui.fill(0)
  private val moveRing = Ui.stroke(Ui.RED, 3f)
  private val pTitle = Ui.text(Ui.f800, 34f, Ui.TEXT)
  private val pSub = Ui.text(Ui.f500, 18f, Ui.MUTED)
  private val pHintB = Ui.text(Ui.f700, 16f, Ui.TEXT)
  private val pHint = Ui.text(Ui.f500, 16f, Ui.MUTED)
  private val pRow = Ui.text(Ui.f600, 22f, Ui.TEXT)
  private val pState = Ui.text(Ui.f700, 16f, Ui.MUTED).apply { textAlign = Paint.Align.RIGHT }
  private val pSmart = Ui.text(Ui.f800, 13f, Ui.MUTED, 1f)
  private val pMove = Ui.text(Ui.f800, 18f, Ui.TEXT)
  private val pBtn = Ui.text(Ui.f700, 20f, Ui.TEXT).apply { textAlign = Paint.Align.CENTER }
  private val pDone = Ui.text(Ui.f800, 20f, Ui.WHITE).apply { textAlign = Paint.Align.CENTER }
  private val arrows = Ui.stroke(Ui.TEXT, 2.4f)
  private val DARK = 0xFF1A0F10.toInt()
  private val DRAWER = 0xFF1A1112.toInt()

  private val W = 640f
  private val PAD = 40f
  private val LIST_TOP = 180f
  private val LIST_BOTTOM = 900f
  private val PITCH = 72f

  fun draw(c: Canvas, now: Long): Boolean {
    if (!open) return false
    val dt = if (last == 0L) 16f else (now - last).coerceIn(1, 64).toFloat()
    last = now
    val a = if (closing != 0L) 1f - Ui.ease(((now - closing) / 200f).coerceIn(0f, 1f)) else Ui.ease(((now - openedAt) / 300f).coerceIn(0f, 1f))
    if (closing != 0L && a <= 0f) { open = false; closing = 0L; last = 0L; tv.invalidate(); return false }
    var anim = a < 1f || closing != 0L

    // Home behind, dimmed.
    fill.color = Ui.alpha(Ui.BG, 0.6f * a); c.drawRect(0f, 0f, Ui.W, Ui.H, fill)
    val x0 = Ui.W - W + (1f - a) * 80f
    c.save()
    c.saveLayerAlpha(x0 - 60f, 0f, Ui.W, Ui.H, (255 * a).toInt())
    // Drawer and its shadow.
    for (i in 0 until 6) { fill.color = Ui.alpha(0xFF000000.toInt(), 0.09f * (6 - i) / 6f); c.drawRect(x0 - 10f * (i + 1), 0f, x0, Ui.H, fill) }
    fill.color = DRAWER; c.drawRect(x0, 0f, Ui.W, Ui.H, fill)
    val lx = x0 + PAD
    val rx = Ui.W - PAD
    Ui.line(c, "Edit home", lx, 52f, 42f, pTitle)
    Ui.line(c, "Movies & TV", lx, 98f, 24f, pSub)
    var hx = lx
    for ((b, t) in listOf("OK" to " show or hide", "▶ Move" to " change the order", "Back" to " done")) {
      Ui.line(c, b, hx, 134f, 22f, pHintB); hx += pHintB.measureText(b)
      Ui.line(c, t, hx, 134f, 22f, pHint); hx += pHint.measureText(t) + 22f
    }

    // Rows, scrolled so the focused one stays in view.
    val n = rows.size
    val viewH = LIST_BOTTOM - LIST_TOP
    val fy = min(f, n - 1) * PITCH
    var target = scroll.to
    if (fy - target > viewH - PITCH - 30f) target = fy - (viewH - PITCH - 30f)
    if (fy - target < 30f) target = fy - 30f
    target = target.coerceIn(0f, max(0f, n * PITCH - 6f - viewH))
    scroll.set(target)
    anim = scroll.step(dt) || anim
    c.save(); c.clipRect(x0 - 20f, LIST_TOP - 6f, Ui.W, LIST_BOTTOM + 6f)
    val mvW = 128f
    for (i in 0 until n) {
      val row = rows[i]
      val top = LIST_TOP + i * PITCH - scroll.pos
      if (top > LIST_BOTTOM || top + 66f < LIST_TOP - 16f) continue
      val here = f == i
      val mv = here && moving
      val foc = here && col == 0 && !mv
      val mf = here && col == 1 && !mv
      val hid = row.id in off
      val dx = if (mv) -14f else 0f
      // The row with its switch.
      r.set(lx + dx, top, rx - mvW - 10f + dx, top + 66f)
      if (mv) { fill.color = Ui.BUTTON; c.drawRoundRect(r, 14f, 14f, fill); c.drawRoundRect(r, 14f, 14f, moveRing) }
      else if (foc) { fill.color = Ui.TEXT; c.drawRoundRect(r, 14f, 14f, fill) }
      val swR = r.right - 20f
      val swL = swR - 58f
      val cy = top + 33f
      val stR = swL - 16f
      pState.color = if (foc) 0xFF6B5455.toInt() else if (hid) 0xFF7A6465.toInt() else Ui.MUTED
      Ui.line(c, if (hid) "Hidden" else "On", stR, top + 21f, 24f, pState)
      var nameR = stR - pState.measureText(if (hid) "Hidden" else "On") - 18f
      if (row.smart) {
        val tw = pSmart.measureText("SMART") + 20f
        r.set(nameR - tw, top + 21f, nameR, top + 45f)
        fill.color = if (foc) 0xFFE7D6D7.toInt() else Ui.BUTTON; c.drawRoundRect(r, 8f, 8f, fill)
        pSmart.color = if (foc) 0xFF6B5455.toInt() else Ui.MUTED
        Ui.line(c, "SMART", r.left + 10f, top + 24f, 18f, pSmart)
        nameR -= tw + 16f
      }
      pRow.color = Ui.alpha(if (foc) DARK else Ui.TEXT, if (hid) 0.45f else 1f)
      Ui.line(c, Ui.fit(row.label, pRow, nameR - (lx + dx + 20f)), lx + dx + 20f, top + 19f, 28f, pRow)
      r.set(swL, cy - 16f, swR, cy + 16f)
      fill.color = if (!hid) Ui.RED else if (foc) 0xFFC9B8B9.toInt() else Ui.LINE; c.drawRoundRect(r, 16f, 16f, fill)
      fill.color = Ui.WHITE; c.drawCircle(if (!hid) swR - 16f else swL + 16f, cy, 12f, fill)
      // Its Move button.
      r.set(rx - mvW + dx, top, rx + dx, top + 66f)
      fill.color = when { mv -> Ui.RED; mf -> Ui.TEXT; here -> Ui.BUTTON; else -> 0x0AFFFFFF }
      c.drawRoundRect(r, 14f, 14f, fill)
      val ink = when { mv -> Ui.WHITE; mf -> DARK; here -> Ui.TEXT; else -> 0xFF7A6465.toInt() }
      val label = if (mv) "Moving" else "Move"
      pMove.color = ink; arrows.color = ink
      val w = 22f + 8f + pMove.measureText(label)
      val ax = r.centerX() - w / 2f
      Icons.draw(c, "updown", ax, cy - 11f, 22f, arrows)
      Ui.line(c, label, ax + 30f, top + 21f, 24f, pMove)
    }
    c.restore()

    // Reset to default / Done.
    val by = 922f
    val rf = f == n
    val df = f == n + 1
    val rw = pBtn.measureText("Reset to default") + 52f
    r.set(lx, by, lx + rw, by + 60f); fill.color = if (rf) Ui.TEXT else Ui.BUTTON; c.drawRoundRect(r, 14f, 14f, fill)
    pBtn.color = if (rf) DARK else Ui.TEXT; Ui.line(c, "Reset to default", r.centerX(), by + 17f, 26f, pBtn)
    val dw = pDone.measureText("Done") + 80f
    r.set(rx - dw, by, rx, by + 60f); fill.color = if (df) Ui.TEXT else Ui.RED; c.drawRoundRect(r, 14f, 14f, fill)
    pDone.color = if (df) DARK else Ui.WHITE; Ui.line(c, "Done", r.centerX(), by + 17f, 26f, pDone)
    c.restore(); c.restore()
    if (!anim) last = 0L
    return anim
  }
}
