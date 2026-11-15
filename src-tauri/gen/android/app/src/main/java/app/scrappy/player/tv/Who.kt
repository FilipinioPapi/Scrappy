package app.scrappy.player.tv

import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.os.SystemClock
import android.view.KeyEvent
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/**
 * "Who's watching?" drawn natively (approved mock "Who's watching", same screens as before):
 *  - full: the faces screen when Scrappy opens, whoever watched last highlighted;
 *  - side: the list that slides out from your picture in the side bar (with Add person and Manage people);
 *  - pin:  the number pad for a profile PIN (checked on this TV only).
 * The web side keeps the people list and does the switching (profiles in the app's core); this draws and asks.
 */
class Who(private val tv: TvView) {
  private class P(val id: String, val name: String, val hasPin: Boolean, val pic: String?, val active: Boolean, val c: Int)

  private var mode = ""            // "", "full", "side", "pin"
  val open get() = mode.isNotEmpty()
  private var must = false
  private var ask = true
  private var people: List<P> = emptyList()
  private var idx = 0
  private var openedAt = 0L
  private var okArmed = false
  private var busy = false

  // The number pad.
  private var pinFor: P? = null
  private var pinTitle = ""
  private var pinNote = ""
  private var pinErr = false
  private var pinText = ""
  private var pk = 4
  private var pinBack = ""
  private var pinThen: ((String?) -> Unit)? = null
  private var pinAt = 0L
  private val main = android.os.Handler(android.os.Looper.getMainLooper())

  /** From the web side: who is on this TV, and which screen to show. */
  fun show(o: JSONObject) {
    val wasOpen = open
    load(o)
    mode = if (o.optBoolean("side")) "side" else "full"
    must = o.optBoolean("must")
    idx = if (mode == "side") max(0, people.indexOfFirst { it.active }) else max(0, people.indexOfFirst { it.active })
    if (!wasOpen) openedAt = SystemClock.uptimeMillis()
    okArmed = false; busy = false
    tv.invalidate()
  }

  private fun load(o: JSONObject) {
    ask = o.optBoolean("ask", true)
    val a = o.optJSONArray("people")
    val active = o.optString("active")
    people = if (a == null) emptyList() else List(a.length()) { k ->
      val p = a.getJSONObject(k)
      P(p.optString("id"), p.optString("name").ifEmpty { "?" }, p.optBoolean("hasPin"), p.optString("pic").ifEmpty { null }, p.optString("id") == active, k % 6)
    }
  }

  private fun close() {
    if (!open) return
    mode = ""; pinThen = null
    tv.host.whoClosed()
    tv.invalidate()
  }

  // ---------------- what OK does ----------------

  private fun choose() {
    if (busy) return
    val n = people.size
    when {
      idx < n -> pickPerson(people[idx])
      idx == n -> { busy = true; tv.host.whoAct("add", JSONObject()) { _ -> busy = false; close() } }
      else -> manage(-1)
    }
  }

  private fun pickPerson(p: P, tries: Int = 0) {
    if (p.active) { close(); return }
    if (p.hasPin) askPin("Enter your PIN", p, if (tries > 0) "That PIN was not right. Try again." else "", tries > 0) { pin -> if (pin != null) switchTo(p, pin, tries) }
    else switchTo(p, "", tries)
  }

  private fun switchTo(p: P, pin: String, tries: Int) {
    busy = true; tv.invalidate()
    tv.host.whoAct("switch", JSONObject().put("id", p.id).put("pin", pin)) { r ->
      busy = false
      if (r?.optBoolean("ok") == true) { close(); return@whoAct }
      if (p.hasPin && tries < 2) { pickPerson(p, tries + 1); return@whoAct }
      tv.menu.pick(r?.optString("err")?.ifEmpty { null } ?: "Couldn't switch. Try again.", listOf("OK"), -1) { _ -> }
      tv.invalidate()
    }
  }

  /** Manage people: PINs, removing someone, and whether Scrappy asks when it opens. */
  private fun manage(startAt: Int) {
    val opts = people.map { p -> p.name + if (p.hasPin) "  (PIN on)" else "" } + "Ask who's watching at start: ${if (ask) "On" else "Off"}"
    tv.menu.pick("People on this TV", opts, startAt) { i ->
      if (i < 0) return@pick
      if (i == people.size) {
        tv.host.whoAct("ask", JSONObject().put("on", !ask)) { r -> r?.optJSONObject("data")?.let { d -> load(d) }; manage(i) }
        return@pick
      }
      person(people[i], i)
    }
  }

  private fun person(p: P, at: Int) {
    val acts = if (p.hasPin) listOf("Change PIN", "Turn PIN off", "Remove ${p.name} from this TV") else listOf("Set a PIN", "Remove ${p.name} from this TV")
    tv.menu.pick(p.name + if (p.hasPin) "  ·  PIN on" else "  ·  No PIN", acts, -1) { a ->
      if (a < 0) { manage(at); return@pick }
      val act = acts[a]
      when {
        act == "Set a PIN" || act == "Change PIN" -> {
          val choose = { cur: String ->
            askPin("Choose a 4 digit PIN", p, "Only checked on this TV. It is not your server password.") { one ->
              if (one == null) return@askPin
              askPin("Enter it once more", p, "") { two ->
                if (two == null) return@askPin
                if (one != two) { tv.menu.pick("Those two did not match. Nothing was changed.", listOf("OK"), -1) { _ -> }; return@askPin }
                send("pin", JSONObject().put("id", p.id).put("current", cur).put("pin", one), "PIN set for ${p.name}")
              }
            }
          }
          if (p.hasPin) askPin("Enter the current PIN", p, "") { cur -> if (cur != null) choose(cur) } else choose("")
        }
        act == "Turn PIN off" -> askPin("Enter the current PIN", p, "") { cur -> if (cur != null) send("pin", JSONObject().put("id", p.id).put("current", cur).put("pin", ""), "PIN turned off for ${p.name}") }
        else -> tv.menu.pick("Remove ${p.name} from this TV?", listOf("Remove", "Cancel"), -1) { s ->
          if (s != 0) return@pick
          val go = { pin: String -> send("remove", JSONObject().put("id", p.id).put("pin", pin).put("active", p.active), "Removed ${p.name} from this TV") }
          if (p.hasPin) askPin("Enter their PIN", p, "") { pin -> if (pin != null) go(pin) } else go("")
        }
      }
    }
  }

  private fun send(act: String, args: JSONObject, done: String) {
    busy = true
    tv.host.whoAct(act, args) { r ->
      busy = false
      if (r?.optBoolean("ok") != true) { tv.menu.pick(r?.optString("err")?.ifEmpty { null } ?: "Couldn't do that. Try again.", listOf("OK"), -1) { _ -> }; return@whoAct }
      if (r.optBoolean("reload")) { close(); return@whoAct }
      r.optJSONObject("data")?.let { d -> load(d) }
      idx = idx.coerceIn(0, people.size + 1)
      tv.host.toast(done, false)
      tv.invalidate()
    }
  }

  private fun askPin(title: String, p: P, note: String, err: Boolean = false, then: (String?) -> Unit) {
    if (mode != "pin") pinBack = mode
    mode = "pin"; pinFor = p; pinTitle = title; pinNote = note; pinErr = err || note.startsWith("That"); pinText = ""; pk = 4; pinThen = then
    pinAt = SystemClock.uptimeMillis(); okArmed = false
    tv.invalidate()
  }

  private fun pinDone(pin: String?) {
    mode = pinBack.ifEmpty { "side" }
    val t = pinThen; pinThen = null
    t?.invoke(pin)
    tv.invalidate()
  }

  private fun digit(d: String) {
    if (d == "del") { pinText = pinText.dropLast(1); return }
    if (pinText.length >= 4) return
    pinText += d
    if (pinText.length == 4) { val pin = pinText; main.postDelayed({ if (mode == "pin" && pinText == pin) pinDone(pin) }, 140) }
  }

  // ---------------- keys ----------------

  private val PAD = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del")

  fun key(e: KeyEvent): Boolean {
    if (!open) return false
    val down = e.action == KeyEvent.ACTION_DOWN
    val code = e.keyCode
    if (code in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9) { if (down && mode == "pin") digit((code - KeyEvent.KEYCODE_0).toString()); tv.invalidate(); return true }
    when (code) {
      KeyEvent.KEYCODE_DEL -> if (down && mode == "pin") digit("del")
      KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> if (down) move(code)
      KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> {
        if (down && e.repeatCount == 0) okArmed = true
        else if (!down && okArmed) {
          okArmed = false
          if (mode == "pin") PAD[pk].takeIf { it.isNotEmpty() }?.let { digit(it) } else choose()
        }
      }
      KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> if (!down) {
        when { mode == "pin" -> pinDone(null); must -> {}; else -> close() }
      }
      else -> return true // nothing else reaches the page underneath while this is up
    }
    tv.invalidate()
    return true
  }

  private fun move(code: Int) {
    when (mode) {
      "full" -> when (code) {
        KeyEvent.KEYCODE_DPAD_LEFT -> idx = max(0, idx - 1)
        KeyEvent.KEYCODE_DPAD_RIGHT -> idx = min(people.size, idx + 1)
      }
      "side" -> when (code) {
        KeyEvent.KEYCODE_DPAD_UP -> idx = max(0, idx - 1)
        KeyEvent.KEYCODE_DPAD_DOWN -> idx = min(people.size + 1, idx + 1)
        KeyEvent.KEYCODE_DPAD_RIGHT -> close()
      }
      "pin" -> {
        var k = pk
        when (code) {
          KeyEvent.KEYCODE_DPAD_UP -> if (k >= 3) k -= 3
          KeyEvent.KEYCODE_DPAD_DOWN -> if (k <= 8) k += 3
          KeyEvent.KEYCODE_DPAD_LEFT -> if (k % 3 > 0) k -= 1
          KeyEvent.KEYCODE_DPAD_RIGHT -> if (k % 3 < 2) k += 1
        }
        if (k == 9) k = if (code == KeyEvent.KEYCODE_DPAD_UP) 6 else 10
        pk = k
      }
    }
  }

  // ---------------- drawing ----------------

  private val COLORS = arrayOf(intArrayOf(0xFFF08A3C.toInt(), 0xFFB13A1E.toInt()), intArrayOf(0xFF4D9DE0.toInt(), 0xFF2B4A8A.toInt()), intArrayOf(0xFF59C27A.toInt(), 0xFF1F6B4A.toInt()),
    intArrayOf(0xFFB06FD8.toInt(), 0xFF5A2B86.toInt()), intArrayOf(0xFFE0607E.toInt(), 0xFF8A2B48.toInt()), intArrayOf(0xFFD8B84A.toInt(), 0xFF86601F.toInt()))
  private val r = RectF()
  private val fill = Ui.fill(0)
  private val grad = Paint(Paint.ANTI_ALIAS_FLAG)
  private val bgGlow = Paint()
  private val ring = Ui.stroke(Ui.WHITE, 4f)
  private val dash = Ui.stroke(Ui.LINE, 2f).apply { pathEffect = android.graphics.DashPathEffect(floatArrayOf(8f, 6f), 0f) }
  private val line = Ui.stroke(Ui.LINE, 1.5f)
  private val boxLine = Ui.stroke(Ui.LINE, 2f)
  private val pTitle = Ui.text(Ui.display, 58f, Ui.TEXT).apply { textAlign = Paint.Align.CENTER }
  private val pPinTitle = Ui.text(Ui.display, 38f, Ui.TEXT).apply { textAlign = Paint.Align.CENTER }
  private val pName = Ui.text(Ui.f700, 23f, Ui.MUTED).apply { textAlign = Paint.Align.CENTER }
  private val pSmall = Ui.text(Ui.f600, 15f, Ui.MUTED).apply { textAlign = Paint.Align.CENTER }
  private val pNote = Ui.text(Ui.f400, 18f, Ui.MUTED).apply { textAlign = Paint.Align.CENTER }
  private val pIni = Ui.text(Ui.display, 70f, Ui.WHITE).apply { textAlign = Paint.Align.CENTER }
  private val pPlus = Ui.text(Ui.f400, 70f, Ui.MUTED).apply { textAlign = Paint.Align.CENTER }
  private val pPinTag = Ui.text(Ui.f800, 12f, Ui.TEXT, 0.5f).apply { textAlign = Paint.Align.CENTER }
  private val pSideH = Ui.text(Ui.f800, 26f, Ui.TEXT)
  private val pRow = Ui.text(Ui.f700, 20f, Ui.TEXT)
  private val pRowSmall = Ui.text(Ui.f700, 14f, Ui.MUTED)
  private val pDot = Ui.text(Ui.f700, 38f, Ui.TEXT).apply { textAlign = Paint.Align.CENTER }
  private val pKey = Ui.text(Ui.f700, 23f, Ui.TEXT).apply { textAlign = Paint.Align.CENTER }

  fun draw(c: Canvas, now: Long): Boolean {
    if (!open) return false
    val a = Ui.ease(((now - openedAt) / 220f).coerceIn(0f, 1f))
    var anim = a < 1f
    when (mode) {
      "full" -> anim = drawFull(c, now, a) || anim
      "side" -> anim = drawSide(c, now, a) || anim
      "pin" -> anim = drawPin(c, now) || anim
    }
    return anim
  }

  private fun page(c: Canvas, a: Float) {
    fill.color = Ui.alpha(Ui.BG, a); c.drawRect(0f, 0f, Ui.W, Ui.H, fill)
    if (bgGlow.shader == null) bgGlow.shader = RadialGradient(Ui.W / 2f, 0f, 1150f, intArrayOf(0xFF2A1214.toInt(), Ui.BG), floatArrayOf(0f, 1f), Shader.TileMode.CLAMP)
    bgGlow.alpha = (255 * a).toInt(); c.drawRect(0f, 0f, Ui.W, Ui.H, bgGlow)
  }

  /** One face: the person's Emby picture, or their initial on a colour. */
  private fun face(c: Canvas, p: P?, cx: Float, cy: Float, d: Float, now: Long, a: Float, plus: String = "+"): Boolean {
    r.set(cx - d / 2f, cy - d / 2f, cx + d / 2f, cy + d / 2f)
    if (p == null) {
      fill.color = Ui.alpha(0xFF2C1C1D.toInt(), a); c.drawOval(r, fill)
      dash.color = Ui.alpha(Ui.LINE, a); c.drawOval(r, dash)
      val tp = if (plus == "+") pPlus else pPlus
      tp.textSize = d * 0.44f; tp.alpha = (255 * a).toInt()
      Ui.line(c, plus, cx, cy - d / 2f, d, tp)
      return false
    }
    // A face with a picture waits for it (up to 0.7 s) instead of showing a letter first and swapping.
    val pic0 = Img.get(p.pic)
    if (pic0 == null && p.pic != null && now - openedAt < 700) return true
    val g = COLORS[p.c]
    grad.shader = LinearGradient(r.left, r.top, r.right, r.bottom, g[0], g[1], Shader.TileMode.CLAMP); grad.alpha = (255 * a).toInt()
    c.drawOval(r, grad)
    val pic = pic0
    val pa = if (pic != null) Img.fade(pic, now, false) else 0f
    if (pic == null) { pIni.textSize = d * 0.44f; pIni.alpha = (255 * a * (1f - pa)).toInt(); Ui.line(c, p.name.trim().take(1).uppercase(), cx, cy - d / 2f + d * 0.04f, d, pIni) }
    if (pic != null) Img.draw(c, pic, RectF(r), d / 2f, pa * a)
    return pic != null && pa < 1f
  }

  private fun drawFull(c: Canvas, now: Long, a: Float): Boolean {
    page(c, 1f) // the backdrop is solid at once: nothing behind may show while the faces fade in
    var anim = false
    val n = people.size + 1
    val cw = 180f; val gap = 46f
    val total = n * cw + (n - 1) * gap
    var x = (Ui.W - total) / 2f
    val top = 430f
    pTitle.alpha = (255 * a).toInt()
    Ui.line(c, "Who's watching?", Ui.W / 2f, 300f, 70f, pTitle)
    for (i in 0 until n) {
      val p = people.getOrNull(i)
      val foc = i == idx
      val cx = x + cw / 2f; val cy = top + 80f
      c.save()
      if (foc) c.scale(1.06f, 1.06f, cx, cy)
      anim = face(c, p, cx, cy, 160f, now, a) || anim
      if (foc) { ring.color = Ui.alpha(Ui.WHITE, a); r.set(cx - 86f, cy - 86f, cx + 86f, cy + 86f); c.drawOval(r, ring) }
      if (p?.hasPin == true) {
        r.set(cx + 80f - 4f - 44f, cy + 80f - 4f - 22f, cx + 80f - 4f, cy + 80f - 4f)
        fill.color = Ui.alpha(0xFF0C0808.toInt(), a); c.drawRoundRect(r, 7f, 7f, fill)
        line.color = Ui.alpha(Ui.LINE, a); c.drawRoundRect(r, 7f, 7f, line)
        pPinTag.alpha = (255 * a).toInt(); Ui.line(c, "PIN", r.centerX(), r.top, r.height(), pPinTag)
      }
      c.restore()
      pName.color = Ui.alpha(if (foc) Ui.WHITE else Ui.MUTED, a)
      Ui.line(c, Ui.fit(p?.name ?: "Add person", pName, cw + 30f), cx, cy + 80f + 14f, 30f, pName)
      if (p?.active == true) { pSmall.alpha = (255 * a).toInt(); Ui.line(c, "Watched last", cx, cy + 80f + 44f, 20f, pSmall) }
      x += cw + gap
    }
    pNote.alpha = (255 * a).toInt()
    Ui.line(c, "Switch any time from your picture in the side bar", Ui.W / 2f, 760f, 26f, pNote)
    return anim
  }

  private fun drawSide(c: Canvas, now: Long, a: Float): Boolean {
    var anim = false
    fill.color = Ui.alpha(0x8C000000.toInt(), a); c.drawRect(0f, 0f, Ui.W, Ui.H, fill)
    val dx = -14f * (1f - a)
    c.save(); c.translate(dx, 0f)
    r.set(0f, 0f, 430f, Ui.H)
    fill.color = Ui.alpha(0xFF170F10.toInt(), a); c.drawRect(r, fill)
    line.color = Ui.alpha(Ui.LINE, a); c.drawLine(430f, 0f, 430f, Ui.H, line)
    pSideH.alpha = (255 * a).toInt()
    Ui.line(c, "Who's watching?", 36f, 44f, 40f, pSideH)
    var y = 98f
    val labels = people.map { it.name } + "Add person" + "Manage people"
    for ((i, label) in labels.withIndex()) {
      val p = people.getOrNull(i)
      val foc = i == idx
      r.set(26f, y, 404f, y + 76f)
      if (foc) { fill.color = Ui.alpha(0xFF2C1C1D.toInt(), a); c.drawRoundRect(r, 12f, 12f, fill); ring.strokeWidth = 3f; ring.color = Ui.alpha(Ui.WHITE, a); c.drawRoundRect(r, 12f, 12f, ring); ring.strokeWidth = 4f }
      anim = face(c, p, 26f + 14f + 28f, y + 38f, 56f, now, a, if (i == people.size + 1) "⚙" else "+") || anim
      pRow.color = Ui.alpha(if (foc) Ui.WHITE else 0xFFE9DADB.toInt(), a)
      val small = if (p?.active == true) "Watching now" else if (p?.hasPin == true) "PIN" else ""
      val sw = if (small.isNotEmpty()) pRowSmall.measureText(small) + 16f else 0f
      Ui.line(c, Ui.fit(label, pRow, 404f - 14f - sw - 112f), 112f, y, 76f, pRow)
      if (small.isNotEmpty()) { pRowSmall.alpha = (255 * a).toInt(); Ui.line(c, small, 404f - 14f - pRowSmall.measureText(small), y, 76f, pRowSmall) }
      y += 84f
    }
    c.restore()
    return anim
  }

  private fun drawPin(c: Canvas, now: Long): Boolean {
    val a = Ui.ease(((now - pinAt) / 180f).coerceIn(0f, 1f))
    page(c, 1f)
    var anim = a < 1f
    val p = pinFor
    val cx = Ui.W / 2f
    var y = 170f
    anim = face(c, p, cx, y + 52f, 104f, now, 1f) || anim
    y += 104f + 14f
    pName.color = Ui.TEXT; Ui.line(c, p?.name ?: "", cx, y, 30f, pName); y += 30f + 18f
    pPinTitle.alpha = (255 * a).toInt(); Ui.line(c, pinTitle, cx, y, 46f, pPinTitle); y += 46f + 12f
    pNote.color = if (pinErr) 0xFFFF8A8E.toInt() else Ui.MUTED
    if (pinNote.isNotEmpty()) Ui.line(c, Ui.fit(pinNote, pNote, 900f), cx, y, 24f, pNote)
    y += 24f + 20f
    // Four boxes.
    var x = cx - (4 * 60f + 3 * 16f) / 2f
    for (i in 0 until 4) {
      r.set(x, y, x + 60f, y + 72f)
      fill.color = 0xFF1E1415.toInt(); c.drawRoundRect(r, 12f, 12f, fill)
      boxLine.color = if (i == pinText.length) Ui.WHITE else Ui.LINE
      r.inset(1f, 1f); c.drawRoundRect(r, 11f, 11f, boxLine)
      if (i < pinText.length) Ui.line(c, "•", r.centerX(), r.top, r.height(), pDot)
      x += 76f
    }
    y += 72f + 28f
    // The pad.
    val kw = 84f; val kh = 58f; val g = 12f
    val left = cx - (3 * kw + 2 * g) / 2f
    for ((k, lab) in PAD.withIndex()) {
      if (lab.isEmpty()) continue
      val kx = left + (k % 3) * (kw + g); val ky = y + (k / 3) * (kh + g)
      r.set(kx, ky, kx + kw, ky + kh)
      val foc = k == pk
      fill.color = if (foc) Ui.RED else 0xFF2C1C1D.toInt(); c.drawRoundRect(r, 12f, 12f, fill)
      if (foc) { ring.strokeWidth = 3f; ring.color = Ui.WHITE; r.inset(-3f, -3f); c.drawRoundRect(r, 15f, 15f, ring); r.inset(3f, 3f); ring.strokeWidth = 4f }
      Ui.line(c, if (lab == "del") "⌫" else lab, r.centerX(), r.top, kh, pKey)
    }
    y += 4 * kh + 3 * g + 26f
    pNote.color = Ui.MUTED
    Ui.line(c, "A remote with number keys can type it straight in. Back cancels.", cx, y, 22f, pNote.apply { textSize = 15f })
    pNote.textSize = 18f
    return anim
  }
}
