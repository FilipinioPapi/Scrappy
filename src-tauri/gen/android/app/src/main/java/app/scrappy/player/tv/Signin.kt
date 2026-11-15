package app.scrappy.player.tv

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.KeyEvent
import org.json.JSONArray
import org.json.JSONObject

/**
 * Sign-in and servers, drawn natively (approved mock "Sign-in"): the three servers across the top,
 * one question at a time below (address, then username, then password), and a code on the right to
 * type on a phone instead. After each sign-in it says so for a moment and moves on to the next server;
 * Back (or the ‹ button) returns to the one just signed in. The checks and sign-ins themselves are
 * done by the web side (tvsignact.js), which never keeps a password beyond this screen.
 */
class Signin(tv: TvView) : Screen(tv) {
  override val bare = true

  private class Srv(val kind: String, val name: String, val what: String, val eg: String) {
    var signedIn = false; var user = ""; var address = ""; var skipped = false
    var step = "addr"            // addr, who, user, pass (done = signedIn)
    var field = ""                // what is in the box for the current step
    var typedUser = ""
  }
  private class Btn(val id: String, val label: String, val red: Boolean = false, val right: Boolean = false, val tall: Boolean = false, val pic: Boolean = false)

  private var srv: List<Srv> = emptyList()
  private var sel = 0
  private var zone = 'B'          // T = server tiles, B = the question
  private var r = 0; private var col = 0
  private var busy = ""           // "Checking…", "Signing in…", or "ok" while it says Signed in
  private var note = ""; private var bad = false
  private var sharedFrom = ""; private var sharedUser = ""; private var sharedPic = ""
  private var qr: List<String> = emptyList()
  private var typing = false
  private var started = false
  private var pick = ""
  private val main = android.os.Handler(android.os.Looper.getMainLooper())
  private val moveOn = Runnable { busy = ""; note = ""; if (nextOf() != null) advance(); tv.invalidate() }

  private val rr = RectF()
  private val fill = Ui.fill(Ui.PANEL)
  private val ring = Ui.stroke(Ui.RED, 2f)
  private val pLogo = Ui.text(Ui.display, 30f, Ui.WHITE).apply { textAlign = Paint.Align.CENTER }
  private val pBrand = Ui.text(Ui.display, 34f, Ui.TEXT, 1f)
  private val pBrandSub = Ui.text(Ui.f800, 14f, Ui.MUTED, 5f)
  private val pWhat = Ui.text(Ui.f800, 13f, Ui.TEXT, 2f)
  private val pName = Ui.text(Ui.f800, 26f, Ui.TEXT)
  private val pStatus = Ui.text(Ui.f600, 17f, Ui.MUTED)
  private val pH1 = Ui.text(Ui.f800, 44f, Ui.TEXT)
  private val pSub = Ui.text(Ui.f400, 20f, Ui.MUTED)
  private val pField = Ui.text(Ui.f600, 29f, Ui.TEXT)
  private val pTip = Ui.text(Ui.f700, 16f, Ui.TEXT)
  private val pBtn = Ui.text(Ui.f700, 22f, Ui.TEXT)
  private val pBtnBig = Ui.text(Ui.f700, 24f, Ui.TEXT)
  private val pNote = Ui.text(Ui.f400, 20f, Ui.MUTED)
  private val pQrT = Ui.text(Ui.f800, 23f, Ui.TEXT).apply { textAlign = Paint.Align.CENTER }
  private val pQrS = Ui.text(Ui.f400, 17f, Ui.MUTED).apply { textAlign = Paint.Align.CENTER }
  private val pInit = Ui.text(Ui.f800, 24f, Ui.WHITE).apply { textAlign = Paint.Align.CENTER }
  private val spin = Ui.stroke(Ui.RED, 3f)

  private companion object {
    const val INK = 0xFF1A0F10.toInt()
    const val OK_GREEN = 0xFF7FD69B.toInt()
    const val ERR = 0xFFFF8F93.toInt()
    const val X = 96f
  }

  // ---------- with the web side ----------

  override fun show(fresh: Boolean) {
    pick = tv.routeHash.substringBefore('?').split('/').let { p -> if (p.getOrNull(1) == "servers") p.getOrNull(2).orEmpty() else "" }
    if (!started || fresh) { started = true; srv = emptyList() }
    tv.host.signAct("start", JSONObject()) { m -> if (m != null) load(m, first = true) }
  }

  override fun hide() {
    main.removeCallbacks(moveOn)
    started = false; busy = ""; note = ""; typing = false
    tv.host.signAct("stop", JSONObject()) { _ -> }
  }

  /** The servers as the web side sees them now (and anything the phone did). */
  private fun load(m: JSONObject, first: Boolean = false) {
    val a = m.optJSONArray("servers") ?: return
    val old = srv.associateBy { it.kind }
    srv = List(a.length()) { k ->
      val o = a.getJSONObject(k)
      val s = old[o.optString("kind")] ?: Srv(o.optString("kind"), o.optString("name"), o.optString("what"), o.optString("eg")).also { n ->
        // A server address typed earlier (and checked) is kept if Scrappy closed part-way.
        val sv = o.optJSONObject("saved")
        if (sv != null) { n.field = sv.optString("address"); n.address = n.field; if (sv.optBoolean("ok")) n.step = "user".also { n.field = "" } }
        else n.field = o.optString("address")
      }
      s.signedIn = o.optBoolean("signedIn"); s.user = o.optString("user"); s.skipped = o.optBoolean("skipped")
      if (s.signedIn && s.address.isEmpty()) s.address = o.optString("address")
      s
    }
    m.optJSONObject("shared").let { sh ->
      sharedFrom = sh?.optString("from").orEmpty(); sharedUser = sh?.optString("user").orEmpty(); sharedPic = sh?.optString("pic").orEmpty()
    }
    m.optJSONArray("qr")?.let { q -> qr = List(q.length()) { q.optString(it) } }
    if (first) {
      val want = srv.indexOfFirst { it.kind == pick }
      sel = if (want >= 0) want else srv.indexOfFirst { !it.signedIn }.let { if (it < 0) 0 else it }
      zone = 'B'; r = 0; col = 0; note = ""; bad = false
    }
    tv.invalidate()
  }

  /** From the web side: the phone signed in, checked an address, or skipped a server. */
  fun push(m: JSONObject) {
    load(m)
    val ev = m.optJSONObject("ev") ?: return
    val i = srv.indexOfFirst { it.kind == ev.optString("kind") }
    val s = srv.getOrNull(i) ?: return
    when (ev.optString("what")) {
      "login" -> if (ev.optBoolean("ok") && i == sel) signedIn() else if (!ev.optBoolean("ok") && i == sel) { note = ev.optString("err"); bad = true }
      "check" -> if (ev.optBoolean("ok")) {
        s.address = ev.optString("address"); s.field = ""
        if (s.step == "addr") s.step = if (sharedFrom.isNotEmpty()) "who" else "user"
        if (i == sel) { r = 0; col = 0; note = ""; bad = false }
      }
      "skip" -> if (i == sel && s.skipped) advance()
    }
    tv.invalidate()
  }

  private fun run(label: String, act: String, args: JSONObject, then: (JSONObject) -> Unit) {
    if (busy.isNotEmpty()) return
    busy = label; note = label; bad = false; tv.invalidate()
    tv.host.signAct(act, args) { res ->
      busy = ""; note = ""
      if (res == null || !res.optBoolean("ok", true) || res.has("err")) { note = res?.optString("err")?.ifEmpty { null } ?: "Something went wrong. Try again."; bad = true }
      else then(res)
      tv.invalidate()
    }
  }

  // ---------- the flow ----------

  private fun cur() = srv.getOrNull(sel)
  private fun nextOf(): Int? = srv.indices.map { (sel + 1 + it) % srv.size }.firstOrNull { it != sel && !srv[it].signedIn && !srv[it].skipped }
  private fun prevOf(): Int { for (i in sel - 1 downTo 0) if (srv[i].signedIn) return i; return -1 }

  private fun advance() {
    val n = nextOf() ?: return
    sel = n; zone = 'B'; r = 0; col = 0; note = ""; bad = false
  }

  private fun signedIn() {
    val s = cur() ?: return
    s.signedIn = true; s.field = ""
    busy = "ok"; note = "✓ Signed in to ${s.name}"; bad = false; r = 0; col = 0
    main.removeCallbacks(moveOn); main.postDelayed(moveOn, 1100)
  }

  private fun grid(): List<List<Btn>> {
    val s = cur() ?: return emptyList()
    if (s.signedIn) {
      val n = nextOf()
      return listOf(listOfNotNull(n?.let { Btn("next", "Continue to ${srv[it].name}", red = true) }, Btn("open", "Open Scrappy", red = n == null), Btn("out", "Sign out")))
    }
    val pv = prevOf()
    val skip = Btn("skip", "Skip ${s.name}")
    if (s.step == "who") return listOfNotNull(listOf(Btn("same", "Same username and password as $sharedFrom ($sharedUser)", red = true, tall = true, pic = true)),
      listOf(Btn("other", "Type a different username")), listOf(skip), if (pv >= 0) listOf(Btn("prev", "‹  Back to ${srv[pv].name}")) else null)
    val row2 = if (s.step == "addr") listOfNotNull(Btn("go", "Next", red = true), skip, if (pv >= 0) Btn("prev", "‹  ${srv[pv].name}", right = true) else null)
      else listOf(Btn("go", if (s.step == "pass") "Sign in" else "Next", red = true), Btn("back", "Back"), skip)
    return listOf(listOf(Btn("field", "")), row2)
  }

  private fun press(id: String) {
    val s = cur() ?: return
    when (id) {
      "field" -> type()
      "skip" -> { tv.host.signAct("skip", JSONObject().put("kind", s.kind).put("on", true)) { _ -> }; s.skipped = true; if (nextOf() != null) advance() else tv.host.signAct("open", JSONObject()) { _ -> } }
      "next" -> advance()
      "prev" -> { val p = prevOf(); if (p >= 0) { sel = p; r = 0; col = 0; note = ""; bad = false } }
      "open" -> tv.host.signAct("open", JSONObject()) { _ -> }
      "out" -> run("Signing out…", "logout", JSONObject().put("kind", s.kind)) { res ->
        res.optJSONObject("model")?.let { load(it) }
        s.signedIn = false; s.step = "addr"; s.field = s.address; r = 0; col = 0
      }
      "back" -> { s.step = if (s.step == "pass") "user" else if (s.step == "user" && sharedFrom.isNotEmpty()) "who" else "addr"; s.field = if (s.step == "user") s.typedUser else if (s.step == "addr") s.address else ""; r = 0; col = 0; note = ""; bad = false }
      "other" -> { s.step = "user"; s.field = ""; r = 0; col = 0; note = ""; bad = false }
      "same" -> run("Signing in…", "same", JSONObject().put("kind", s.kind).put("address", s.address)) { res ->
        res.optJSONObject("model")?.let { load(it) }; signedIn()
      }
      "go" -> go(s)
    }
  }

  private fun go(s: Srv) {
    val v = s.field.trim()
    when (s.step) {
      "addr" -> {
        if (v.isEmpty()) { note = "Type the address first: OK on the box brings up the keyboard."; bad = true; return }
        run("Checking…", "check", JSONObject().put("kind", s.kind).put("address", v)) { res ->
          s.address = res.optString("address", v); s.field = ""
          s.step = if (sharedFrom.isNotEmpty()) "who" else "user"; r = 0; col = 0
        }
      }
      "user" -> {
        if (v.isEmpty()) { note = "Type your username first."; bad = true; return }
        s.typedUser = v; s.step = "pass"; s.field = ""; r = 0; col = 0; note = ""; bad = false
      }
      "pass" -> {
        val pass = s.field
        s.field = ""
        run("Signing in…", "login", JSONObject().put("kind", s.kind).put("address", s.address).put("user", s.typedUser).put("pass", pass)) { res ->
          res.optJSONObject("model")?.let { load(it) }; signedIn()
        }
      }
    }
  }

  /** OK on the box: the TV's own keyboard. Done goes straight on to the next question. */
  private fun type() {
    val s = cur() ?: return
    val mode = when (s.step) { "addr" -> "url"; "pass" -> "password"; else -> "user" }
    typing = true; tv.invalidate()
    tv.host.field(s.field, mode, { t -> if (cur() === s) { s.field = t; if (s.step == "addr") tv.host.signAct("addr", JSONObject().put("kind", s.kind).put("address", t)) { _ -> }; tv.invalidate() } }) { done ->
      typing = false
      if (done != null && cur() === s) { s.field = done; if (done.isNotBlank() || s.step == "pass") go(s) }
      tv.invalidate()
    }
  }

  // ---------- keys ----------

  override fun key(k: Int): Boolean {
    if (busy.isNotEmpty() || srv.isEmpty()) return true
    if (zone == 'T') {
      when (k) {
        KeyEvent.KEYCODE_DPAD_LEFT -> if (sel > 0) { sel--; note = ""; bad = false }
        KeyEvent.KEYCODE_DPAD_RIGHT -> if (sel < srv.size - 1) { sel++; note = ""; bad = false }
        KeyEvent.KEYCODE_DPAD_DOWN -> { zone = 'B'; r = 0; col = 0 }
      }
      tv.invalidate(); return true
    }
    val g = grid()
    when (k) {
      KeyEvent.KEYCODE_DPAD_UP -> if (r == 0) zone = 'T' else { r--; col = 0 }
      KeyEvent.KEYCODE_DPAD_DOWN -> if (r < g.size - 1) { r++; col = 0 }
      KeyEvent.KEYCODE_DPAD_LEFT -> if (col > 0) col--
      KeyEvent.KEYCODE_DPAD_RIGHT -> if (col < (g.getOrNull(r)?.size ?: 1) - 1) col++
    }
    tv.invalidate(); return true
  }

  override fun ok() {
    if (busy.isNotEmpty() || srv.isEmpty()) return
    if (zone == 'T') { zone = 'B'; r = 0; col = 0; tv.invalidate(); return }
    val b = grid().getOrNull(r)?.getOrNull(col) ?: return
    press(b.id); tv.invalidate()
  }

  override fun back(): Boolean {
    if (busy.isNotEmpty()) return true
    val s = cur() ?: return false
    if (zone == 'B' && !s.signedIn && (s.step == "user" || s.step == "pass")) { press("back"); tv.invalidate(); return true }
    if (zone == 'B' && !s.signedIn && prevOf() >= 0) { press("prev"); tv.invalidate(); return true }
    if (zone == 'B') { zone = 'T'; tv.invalidate(); return true }
    return false
  }

  // ---------- drawing ----------

  override fun draw(c: Canvas, now: Long, dt: Float): Boolean {
    c.drawColor(Ui.BG)
    if (srv.isEmpty()) return false
    val top = !typing
    if (top) { drawBrand(c); drawTiles(c) }
    val qy = if (typing) 90f else 390f
    drawQuestion(c, qy)
    if (top && qr.isNotEmpty() && cur()?.signedIn != true) drawQr(c)
    if (busy.isNotEmpty() && busy != "ok") return true
    return false
  }

  private fun drawBrand(c: Canvas) {
    fill.color = Ui.RED; c.drawCircle(X + 30f, 86f, 30f, fill)
    Ui.line(c, "S", X + 30f, 66f, 44f, pLogo)
    Ui.line(c, "SCRAPPY", X + 76f, 58f, 38f, pBrand)
    Ui.line(c, "MEDIA CENTER", X + 78f, 98f, 20f, pBrandSub)
  }

  private fun drawTiles(c: Canvas) {
    val gap = 18f; val w = (Ui.W - 2 * X - gap * (srv.size - 1)) / srv.size
    for ((i, s) in srv.withIndex()) {
      val x = X + i * (w + gap); val selT = i == sel; val foc = selT && zone == 'T'
      rr.set(x, 172f, x + w, 300f)
      fill.color = if (foc) Ui.TEXT else if (selT) 0x29EC282E else 0x0FFFFFFF; c.drawRoundRect(rr, 18f, 18f, fill)
      if (selT && !foc) { rr.inset(1f, 1f); c.drawRoundRect(rr, 17f, 17f, ring) }
      val ink = if (foc) INK else Ui.TEXT
      pWhat.color = Ui.alpha(ink, 0.7f); Ui.line(c, s.what.uppercase(), x + 24f, 192f, 18f, pWhat)
      pName.color = ink; Ui.line(c, s.name, x + 24f, 212f, 36f, pName)
      val n = when (s.step) { "addr" -> 1; "pass" -> 3; else -> 2 }
      val (t, tc) = when {
        s.signedIn -> "✓ Signed in as ${s.user}" to (if (foc) 0xFF1F7A3E.toInt() else OK_GREEN)
        s.skipped -> "Skipped" to (if (foc) INK else 0xFF8C7778.toInt())
        selT -> "Step $n of 3" to (if (foc) INK else 0xFFF2B8BA.toInt())
        else -> "Not set up" to (if (foc) INK else 0xFF8C7778.toInt())
      }
      pStatus.color = tc; Ui.line(c, Ui.fit(t, pStatus, w - 48f), x + 24f, 252f, 24f, pStatus)
    }
  }

  private fun drawQuestion(c: Canvas, y0: Float) {
    val s = cur() ?: return
    val allIn = srv.all { it.signedIn }
    val (h1, sub) = when {
      s.signedIn -> (if (allIn && busy.isEmpty()) "You're all set" else "${s.name} is signed in") to "${s.user} on ${s.address}"
      s.step == "addr" -> "Where is your ${s.name} server?" to "The same address you use for ${s.name} in a browser."
      s.step == "who" -> "Who is signing in to ${s.name}?" to "Found your server at ${s.address}"
      s.step == "user" -> "Your ${s.name} username" to "Found your server at ${s.address}"
      else -> "Password for ${s.typedUser}" to "${s.name} at ${s.address}"
    }
    val maxW = 1180f
    Ui.line(c, Ui.fit(h1, pH1, maxW), X, y0, 54f, pH1)
    Ui.line(c, Ui.fit(sub, pSub, maxW), X, y0 + 62f, 28f, pSub)
    var y = y0 + 116f
    val g = grid()
    for ((ri, row) in g.withIndex()) {
      if (row.size == 1 && row[0].id == "field") { y = drawField(c, s, y, ri == r && zone == 'B') + 26f; continue }
      var x = X
      val rowH = if (row.any { it.tall }) 84f else 66f
      val rights = row.filter { it.right }
      for ((ci, b) in row.withIndex()) {
        val p = if (b.tall) pBtnBig else pBtn
        val w = p.measureText(b.label) + 60f + if (b.pic) 70f else 0f
        val bx = if (b.right) X + maxW - (rights.sumOf { (pBtn.measureText(it.label) + 60f).toDouble() }.toFloat()) else x
        rr.set(bx, y, bx + w, y + rowH)
        val foc = zone == 'B' && ri == r && ci == col && !typing
        fill.color = if (foc) Ui.TEXT else if (b.red) Ui.RED else Ui.BUTTON
        c.drawRoundRect(rr, if (b.tall) 16f else 14f, if (b.tall) 16f else 14f, fill)
        var tx = bx + 30f
        if (b.pic) { drawFace(c, bx + 14f + 28f, y + rowH / 2f); tx = bx + 14f + 56f + 16f }
        p.color = if (foc) INK else Ui.TEXT
        Ui.line(c, b.label, tx, y, rowH, p)
        if (!b.right) x += w + 14f
      }
      y += rowH + (if (s.step == "who") 14f else 26f)
    }
    // The note under the question: checking, signed in, or what went wrong.
    if (note.isNotEmpty()) {
      var nx = X
      if (busy.isNotEmpty() && busy != "ok") {
        val a = ((android.os.SystemClock.uptimeMillis() % 700L) / 700f) * 360f
        rr.set(X, y + 2f, X + 26f, y + 28f); c.drawArc(rr, a, 270f, false, spin); nx += 40f
      }
      pNote.color = if (bad) ERR else if (busy == "ok") OK_GREEN else Ui.MUTED
      Ui.line(c, Ui.fit(note, pNote, maxW - (nx - X)), nx, y, 30f, pNote)
    }
  }

  private fun drawField(c: Canvas, s: Srv, y: Float, foc0: Boolean): Float {
    val foc = foc0 || typing
    rr.set(X, y, X + 1080f, y + 80f)
    fill.color = if (foc && !typing) Ui.TEXT else 0x1AFFFFFF; c.drawRoundRect(rr, 16f, 16f, fill)
    if (typing) { ring.strokeWidth = 4f; c.drawRoundRect(rr, 16f, 16f, ring); ring.strokeWidth = 2f }
    val ph = when (s.step) { "addr" -> "e.g. ${s.eg}"; "pass" -> "Password"; else -> "Username" }
    val shown = if (s.step == "pass") "•".repeat(s.field.length) else s.field
    pField.color = if (foc && !typing) INK else if (shown.isEmpty()) 0xFF8C7778.toInt() else Ui.TEXT
    Ui.line(c, Ui.fit(shown.ifEmpty { ph }, pField, 860f), X + 26f, y, 80f, pField)
    if (foc0 && !typing) { pTip.color = Ui.alpha(INK, 0.6f); val t = "OK to type"; Ui.line(c, t, X + 1080f - 26f - pTip.measureText(t), y, 80f, pTip) }
    return y + 80f
  }

  private fun drawFace(c: Canvas, cx: Float, cy: Float) {
    val pic = if (sharedPic.isNotEmpty()) Img.get(sharedPic) else null
    fill.color = 0xFF3B4FA0.toInt(); c.drawCircle(cx, cy, 28f, fill)
    if (pic != null) { rr.set(cx - 28f, cy - 28f, cx + 28f, cy + 28f); Img.draw(c, pic, rr, 28f) }
    else Ui.line(c, sharedUser.take(1).uppercase(), cx, cy - 18f, 36f, pInit)
  }

  private fun drawQr(c: Canvas) {
    val w = 320f; val x = Ui.W - X - w; val y = 400f
    val bx = x + (w - 250f) / 2f
    rr.set(bx, y, bx + 250f, y + 250f); fill.color = Ui.WHITE; c.drawRoundRect(rr, 20f, 20f, fill)
    val n = qr.size
    if (n > 0) {
      val cell = 210f / n
      fill.color = Ui.BG
      for ((yy, row) in qr.withIndex()) for (xx in row.indices) if (row[xx] == '1') c.drawRect(bx + 20f + xx * cell, y + 20f + yy * cell, bx + 20f + (xx + 1) * cell + 0.5f, y + 20f + (yy + 1) * cell + 0.5f, fill)
    }
    Ui.line(c, "Or use your phone", x + w / 2f, y + 268f, 32f, pQrT)
    // Wrapped by hand: the lines are centred under the code.
    var ly = y + 306f; var line = ""
    for (word in "Point its camera here and type your sign-ins there. Same Wi-Fi as the TV.".split(' ')) {
      val t = if (line.isEmpty()) word else "$line $word"
      if (pQrS.measureText(t) > w && line.isNotEmpty()) { Ui.line(c, line, x + w / 2f, ly, 25f, pQrS); ly += 25f; line = word } else line = t
    }
    if (line.isNotEmpty()) Ui.line(c, line, x + w / 2f, ly, 25f, pQrS)
  }
}
