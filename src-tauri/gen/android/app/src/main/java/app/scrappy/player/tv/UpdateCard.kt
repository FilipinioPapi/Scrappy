package app.scrappy.player.tv

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.SystemClock
import android.text.TextPaint
import android.view.KeyEvent
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/**
 * The update prompt, drawn natively (approved mock "Update prompt"): the same four cards and words as tvupdate.js,
 * which keeps the logic and sends each card here. Left/Right pick a button, OK presses it, Back = the second button.
 */
class UpdateCard(private val tv: TvView) {
  private class B(val label: String, val act: String, val red: Boolean)

  var open = false; private set
  private var step = ""
  private var title = ""
  private var sub = ""
  private var note = ""
  private var notes: List<String> = emptyList()
  private var got = 0L
  private var total = 0L
  private var gotText = ""
  private var left = ""
  private var btns: List<B> = emptyList()
  private var b = 0
  private var openedAt = 0L
  private var closing = 0L
  private var okArmed = false
  private var shownPct = 0f
  private var last = 0L
  /** Called when the card goes away (the bridge hands the remote back). */
  var onClosed: (() -> Unit)? = null

  /** A card from tvupdate.js: {step: ask|get|ready|fail|"" (close), version, current, notes, got, total, gotText, left, err}. */
  fun show(o: JSONObject) {
    val s = o.optString("step")
    if (s.isEmpty()) { close(); return }
    val v = o.optString("version")
    val was = step
    step = s
    when (s) {
      "ask" -> {
        title = "A new Scrappy is ready"; sub = "Version $v · you have ${o.optString("current")}"
        note = "Takes under a minute. You stay signed in and keep your spot in every show."
        notes = o.optJSONArray("notes")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
        btns = listOf(B("Update now", "go", true), B("Later", "later", false))
      }
      "get" -> {
        title = "Getting the update…"; sub = "Version $v"
        note = "When it's done, the TV asks you to confirm. Press OK on Update, then Open."
        got = o.optLong("got"); total = o.optLong("total"); gotText = o.optString("gotText"); left = o.optString("left")
        btns = listOf(B("Cancel", "cancel", false))
      }
      "ready" -> {
        title = "Ready to install"; sub = "Version $v"
        note = "The TV's own screen comes up next. Press OK on Update, then Open. The very first time it also asks you to allow Scrappy to install updates: switch that on once and press Back."
        btns = listOf(B("Install", "install", true), B("Later", "later", false))
      }
      else -> {
        title = "The update didn't work"; sub = o.optString("err")
        note = "Nothing was changed. You can try again now or later from Settings."
        btns = listOf(B("Try again", "again", true), B("Later", "later", false))
      }
    }
    if (was != s) { b = 0; if (s == "get") shownPct = 0f }
    if (!open || closing != 0L) { open = true; closing = 0L; openedAt = SystemClock.uptimeMillis(); okArmed = false }
    tv.invalidate()
  }

  private fun close() {
    if (!open || closing != 0L) return
    closing = SystemClock.uptimeMillis(); tv.invalidate()
  }

  private fun press(act: String) {
    if (act == "later" || act == "cancel") close()
    tv.host.updAct(act)
  }

  fun key(e: KeyEvent): Boolean {
    if (!open) return false
    if (closing != 0L) return true
    val down = e.action == KeyEvent.ACTION_DOWN
    when (e.keyCode) {
      KeyEvent.KEYCODE_DPAD_LEFT -> if (down) b = max(0, b - 1)
      KeyEvent.KEYCODE_DPAD_RIGHT -> if (down) b = min(btns.size - 1, b + 1)
      KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> {
        if (down && e.repeatCount == 0) okArmed = true
        else if (!down && okArmed) { okArmed = false; btns.getOrNull(b)?.let { press(it.act) } }
      }
      KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> if (!down) (btns.getOrNull(1) ?: btns.firstOrNull())?.let { press(it.act) }
      else -> return true
    }
    tv.invalidate()
    return true
  }

  // ---------------- drawing ----------------

  private val r = RectF()
  private val fill = Ui.fill(0)
  private val line = Ui.stroke(Ui.LINE, 1.5f)
  private val pTitle = Ui.text(Ui.f800, 34f, Ui.TEXT)
  private val pSub = Ui.text(Ui.f500, 20f, Ui.MUTED)
  private val pKick = Ui.text(Ui.f800, 15f, Ui.RED, 2f)
  private val pNote = Ui.text(Ui.f400, 22f, Ui.TEXT)
  private val pDot = Ui.text(Ui.f700, 22f, Ui.RED)
  private val pSmall = TextPaint(Ui.text(Ui.f400, 20f, Ui.MUTED))
  private val pCount = Ui.text(Ui.f500, 19f, Ui.MUTED)
  private val pCountR = Ui.text(Ui.f500, 19f, Ui.MUTED).apply { textAlign = Paint.Align.RIGHT }
  private val pBtn = Ui.text(Ui.f800, 22f, Ui.WHITE)
  private val bmpPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
  private var logo: Bitmap? = null
  private val DARK = 0xFF1A0F10.toInt()
  private val W = 820f
  private val PAD = 48f

  fun draw(c: Canvas, now: Long): Boolean {
    if (!open) return false
    val dt = if (last == 0L) 16f else (now - last).coerceIn(1, 64).toFloat()
    last = now
    val a = if (closing != 0L) 1f - Ui.ease(((now - closing) / 200f).coerceIn(0f, 1f)) else Ui.ease(((now - openedAt) / 280f).coerceIn(0f, 1f))
    if (closing != 0L && a <= 0f) { open = false; closing = 0L; step = ""; last = 0L; onClosed?.invoke(); return false }
    var anim = a < 1f || closing != 0L

    fill.color = Ui.alpha(0xFF0A0606.toInt(), 0.72f * a); c.drawRect(0f, 0f, Ui.W, Ui.H, fill)
    // Lay the card out first to know its height, then centre it.
    val inner = (W - PAD * 2).toInt()
    val noteL = Ui.clamp(note, pSmall, inner, 4, 30f)
    var h = PAD + 76f
    if (step == "ask" && notes.isNotEmpty()) h += 30f + 18f + 12f + notes.size * 33f - 10f
    if (step == "get") h += 34f + 12f + 12f + 24f
    h += 26f + noteL.height + 30f + 64f + PAD
    val x0 = (Ui.W - W) / 2f
    val y0 = (Ui.H - h) / 2f + (1f - a) * 16f
    c.save()
    if (a < 1f) c.saveLayerAlpha(x0 - 2f, y0 - 2f, x0 + W + 2f, y0 + h + 2f, (255 * a).toInt()) else c.save() // a layer only while it fades
    r.set(x0, y0, x0 + W, y0 + h); fill.color = Ui.PANEL; c.drawRoundRect(r, 26f, 26f, fill); c.drawRoundRect(r, 26f, 26f, line)
    val lx = x0 + PAD
    var y = y0 + PAD
    // App icon, title, version.
    val lg = logo ?: try { BitmapFactory.decodeResource(tv.resources, tv.resources.getIdentifier("tv_logo", "drawable", tv.context.packageName)) } catch (_: Throwable) { null }
    logo = lg
    r.set(lx, y, lx + 76f, y + 76f)
    if (lg != null) c.drawBitmap(lg, null, r, bmpPaint) else { fill.color = Ui.RED; c.drawRoundRect(r, 20f, 20f, fill) }
    val tx = lx + 76f + 22f
    Ui.line(c, Ui.fit(title, pTitle, x0 + W - PAD - tx), tx, y + 2f, 42f, pTitle)
    Ui.line(c, Ui.fit(sub, pSub, x0 + W - PAD - tx), tx, y + 46f, 26f, pSub)
    y += 76f
    if (step == "ask" && notes.isNotEmpty()) {
      y += 30f
      Ui.line(c, "WHAT'S NEW", lx, y, 18f, pKick); y += 18f + 12f
      for (n in notes) {
        Ui.line(c, "•", lx, y, 30f, pDot)
        Ui.line(c, Ui.fit(n, pNote, inner - 28f), lx + 28f, y, 30f, pNote)
        y += 33f
      }
      y -= 10f
    }
    if (step == "get") {
      y += 34f
      val pct = if (total > 0) (got.toFloat() / total).coerceIn(0f, 1f) else 0f
      shownPct += (pct - shownPct) * (1f - kotlin.math.exp(-dt / 120f))
      if (kotlin.math.abs(pct - shownPct) > 0.002f) anim = true else shownPct = pct
      r.set(lx, y, lx + inner, y + 12f); fill.color = Ui.BUTTON; c.drawRoundRect(r, 6f, 6f, fill)
      if (shownPct > 0f) { r.right = lx + inner * shownPct; fill.color = Ui.RED; c.drawRoundRect(r, 6f, 6f, fill) }
      y += 12f + 12f
      Ui.line(c, gotText, lx, y, 24f, pCount)
      Ui.line(c, left, lx + inner, y, 24f, pCountR)
      y += 24f
    }
    y += 26f
    c.save(); c.translate(lx, y); noteL.draw(c); c.restore()
    y += noteL.height + 30f
    var bx = lx
    btns.forEachIndexed { i, bt ->
      val w = pBtn.measureText(bt.label) + 72f
      r.set(bx, y, bx + w, y + 64f)
      val f = i == b
      fill.color = if (f) Ui.TEXT else if (bt.red) Ui.RED else Ui.BUTTON
      c.drawRoundRect(r, 16f, 16f, fill)
      pBtn.color = if (f) DARK else Ui.WHITE
      Ui.line(c, bt.label, bx + 36f, y, 64f, pBtn)
      bx += w + 14f
    }
    c.restore(); c.restore()
    if (!anim) last = 0L
    return anim
  }
}
