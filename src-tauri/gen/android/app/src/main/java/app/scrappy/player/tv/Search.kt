package app.scrappy.player.tv

import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.os.SystemClock
import android.view.KeyEvent
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs

/** Search: a big box (OK brings up the TV keyboard, with voice), recent searches, then results as
 *  posters (tvSearchPage in search.js, approved mock). The searching itself is the web side's, so
 *  typed filters, typo help and music and audiobook results all work the same. */
class Search(tv: TvView) : Screen(tv) {
  override val railKey = "search"
  private val RECENT = "tvSearchRecent"

  private class Sec(val title: String, val kind: String, val noCount: Boolean, val cards: List<Card>, val people: List<Who>, val rows: List<Row>)
  private class Who(val id: String, val name: String, val img: String?, val pc: Int, val ini: String) { var f = 0f }
  private class Row(val href: String, val title: String, val sub: String, val right: String, val cover: String?, val round: Boolean, val wide: Boolean, val hue: Int)
  /** One thing the highlight can sit on, in page coordinates. */
  private class Spot(val x: Float, val y: Float, val w: Float, val h: Float, val sec: Int, val k: Int)

  private var text = ""
  private var typing = false
  private var lastRun: String? = null
  private var seq = 0
  private var searching = false
  private var secs: List<Sec> = emptyList()
  private var failed: List<String> = emptyList()
  private var recents: List<String> = emptyList()
  private var focus = -1 // -1 = the box, -2 = its clear button
  private var spots: List<Spot> = emptyList()
  private var contentBottom = 0f
  private var focusAfter = false
  private val sy = Glide()
  private var loaded = false
  private val runLater = Runnable { run(text.trim()) }

  override fun show(fresh: Boolean) {
    tv.host.local(RECENT) { s -> recents = parseList(s); if (secs.isEmpty() && !searching) layout(); tv.invalidate() }
    if (!loaded) {
      loaded = true
      val q = tv.routeHash.substringAfter('?', "").split('&').firstOrNull { p -> p.startsWith("q=") }?.substring(2)
      text = try { java.net.URLDecoder.decode(q ?: "", "UTF-8") } catch (_: Throwable) { "" }
      if (text.isNotBlank()) run(text.trim())
      layout()
    }
  }

  override fun hide() { Net.main.removeCallbacks(runLater) }

  private fun parseList(s: String?): List<String> = try { val a = JSONArray(s ?: "[]"); List(a.length()) { k -> a.optString(k) }.filter { x -> x.isNotEmpty() } } catch (_: Throwable) { emptyList() }

  private fun run(q: String) {
    Net.main.removeCallbacks(runLater)
    lastRun = q
    val my = ++seq
    tv.host.replace(if (q.isEmpty()) "#/search" else "#/search?q=" + java.net.URLEncoder.encode(q, "UTF-8").replace("+", "%20"), false)
    if (q.isEmpty()) { secs = emptyList(); failed = emptyList(); searching = false; focusAfter = false; tv.host.local(RECENT) { s -> recents = parseList(s); layout(); tv.invalidate() }; layout(); tv.invalidate(); return }
    searching = true
    layout(); tv.invalidate()
    tv.host.search(q) { o ->
      if (my != seq) return@search
      searching = false
      failed = o?.optJSONArray("failed")?.let { a -> List(a.length()) { k -> a.optString(k) } } ?: emptyList()
      secs = parse(o?.optJSONArray("sections"))
      if (focus >= 0) focus = 0
      layout()
      if (focusAfter && focus < 0 && spots.isNotEmpty()) { focus = 0 }
      focusAfter = false
      aim()
      tv.invalidate()
    }
  }

  private fun parse(a: JSONArray?): List<Sec> {
    if (a == null) return emptyList()
    val out = ArrayList<Sec>()
    for (i in 0 until a.length()) {
      val s = a.optJSONObject(i) ?: continue
      val kind = s.optString("kind")
      val items = s.optJSONArray("items")
      val objs = if (items == null) emptyList() else List(items.length()) { k -> items.optJSONObject(k) }.filterNotNull()
      val cards = if (kind == "cards" || kind == "wide") objs.map { j -> Card(j, if (kind == "wide") Shape.WIDE else Shape.PORTRAIT) } else emptyList()
      val people = if (kind == "people") objs.map { j ->
        val name = j.optString("Name")
        val tag = j.optJSONObject("ImageTags")?.optString("Primary").orEmpty()
        Who(j.optString("Id"), name, if (tag.isNotEmpty()) Net.image(j.optString("Id"), "Primary", tag, 300) else null,
          name.ifEmpty { "?" }.fold(7) { n, ch -> (n * 31 + ch.code) % 997 } % 6,
          name.split(Regex("\\s+")).filter { w -> w.isNotEmpty() }.take(2).joinToString("") { w -> w.take(1) }.uppercase())
      } else emptyList()
      val rj = s.optJSONArray("rows")
      val rows = if (rj == null) emptyList() else List(rj.length()) { k -> rj.optJSONObject(k) }.filterNotNull().map { r ->
        Row(r.optString("href"), r.optString("title"), r.optString("sub"), r.optString("right"), r.optString("cover").takeIf { u -> u.startsWith("http") && !u.startsWith("http://img.localhost") },
          r.optBoolean("round"), r.optBoolean("wide"), r.optInt("h"))
      }
      if (cards.isEmpty() && people.isEmpty() && rows.isEmpty()) continue
      out.add(Sec(s.optString("title"), kind, s.optBoolean("noCount"), cards, people, rows))
    }
    return out
  }

  // ---------- layout (1080p units, from the web page at 1.333 x its CSS) ----------
  private val LEFT = 149f
  private val WIDTH = 1739f
  private val BOX_T = 64f; private val BOX_H = 101f
  private val TOP = 205f
  private val CW = 272f; private val CP = 293.33f
  private val RW = (1739f - 3 * 21.33f) / 4f; private val RH = 77.33f
  private val secTop = ArrayList<Float>()
  private val chipW = ArrayList<Float>()
  private var failH = 0f

  private fun cardH(s: Sec, line: List<Int>): Float = when (s.kind) {
    "people" -> 313f
    "wide" -> 219f
    else -> if (line.any { k -> s.cards[k].sub.isNotEmpty() }) 474f else 449f
  }

  private fun layout() {
    val out = ArrayList<Spot>()
    secTop.clear(); chipW.clear()
    var y = TOP
    if (secs.isEmpty()) {
      if (lastRun.isNullOrEmpty() && !searching && recents.isNotEmpty()) {
        secTop.add(y)
        var x = LEFT; var cy = y + 55f
        for ((k, r) in recents.withIndex()) {
          val w = 29.33f * 2 + chipP.measureText(r) + 2.67f
          if (x + w > LEFT + WIDTH && x > LEFT) { x = LEFT; cy += 64f + 16f }
          out.add(Spot(x, cy, w, 64f, -1, k)); chipW.add(w)
          x += w + 16f
        }
        // Clear (approved mock "Clear recent searches"): last in the list, k = -1.
        val cw = 29.33f * 2 + 34f + chipP.measureText("Clear")
        if (x + cw > LEFT + WIDTH && x > LEFT) { x = LEFT; cy += 64f + 16f }
        out.add(Spot(x, cy, cw, 64f, -1, -1)); chipW.add(cw)
        y = cy + 64f
      }
      spots = out; contentBottom = y
      if (focus >= spots.size) focus = spots.size - 1
      return
    }
    failH = if (failed.isNotEmpty()) 52f else 0f
    if (failed.isNotEmpty()) y += failH + 24f
    for ((si, s) in secs.withIndex()) {
      secTop.add(y)
      var cy = y + 55f
      if (s.kind == "rows") {
        for (k in s.rows.indices) {
          if (k > 0 && k % 4 == 0) cy += RH + 5.33f
          out.add(Spot(LEFT + (k % 4) * (RW + 21.33f), cy, RW, RH, si, k))
        }
        cy += RH
      } else {
        val n = if (s.kind == "people") s.people.size else s.cards.size
        var k = 0
        while (k < n) {
          val line = (k until minOf(n, k + 6)).toList()
          val h = if (s.kind == "people") 313f else cardH(s, line)
          for (j in line) out.add(Spot(LEFT + (j % 6) * CP, cy, CW, h, si, j))
          k += 6
          cy += h + (if (k < n) 29.33f else 0f)
        }
      }
      y = cy + 37.33f
    }
    spots = out; contentBottom = y - 37.33f
    if (focus >= spots.size) focus = spots.size - 1
  }

  private fun aim() {
    if (focus < 0) { sy.set(0f); return }
    val s = spots.getOrNull(focus) ?: return
    val max = maxOf(0f, contentBottom + 64f - 1080f)
    sy.set((s.y + s.h / 2f - 540f).coerceIn(0f, max))
  }

  override fun behind() = abs(sy.to - sy.pos)

  // ---------- remote ----------
  override fun key(k: Int): Boolean {
    if (focus < 0) {
      when (k) {
        KeyEvent.KEYCODE_DPAD_LEFT -> { if (focus == -2) focus = -1 else return false }
        KeyEvent.KEYCODE_DPAD_RIGHT -> if (text.isNotEmpty()) focus = -2
        KeyEvent.KEYCODE_DPAD_DOWN -> if (spots.isNotEmpty()) { focus = 0; aim() }
      }
      return true
    }
    val cur = spots[focus]
    when (k) {
      KeyEvent.KEYCODE_DPAD_LEFT -> {
        val prev = spots.getOrNull(focus - 1)
        if (prev == null || abs(prev.y - cur.y) > 1f) return false
        focus--
      }
      KeyEvent.KEYCODE_DPAD_RIGHT -> { val next = spots.getOrNull(focus + 1); if (next != null && abs(next.y - cur.y) <= 1f) focus++ }
      KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_UP -> {
        val down = k == KeyEvent.KEYCODE_DPAD_DOWN
        val cx = cur.x + cur.w / 2f
        val cands = spots.indices.filter { i -> if (down) spots[i].y > cur.y + 1f else spots[i].y < cur.y - 1f }
        if (cands.isEmpty()) { if (!down) { focus = -1; aim() } }
        else {
          val lineY = if (down) cands.minOf { i -> spots[i].y } else cands.maxOf { i -> spots[i].y }
          focus = cands.filter { i -> abs(spots[i].y - lineY) <= 1f }.minByOrNull { i -> abs(spots[i].x + spots[i].w / 2f - cx) } ?: focus
        }
      }
    }
    aim()
    return true
  }

  override fun ok() {
    if (focus == -2) { text = ""; focus = -1; run(""); return }
    if (focus < 0) { openKeyboard(); return }
    val s = spots.getOrNull(focus) ?: return
    if (s.sec < 0 && s.k < 0) { recents = emptyList(); tv.host.setLocal(RECENT, "[]"); focus = -1; layout(); aim(); tv.invalidate(); return }
    if (s.sec < 0) { val q = recents.getOrNull(s.k) ?: return; text = q; run(q); return }
    val sec = secs.getOrNull(s.sec) ?: return
    remember(lastRun ?: text)
    when (sec.kind) {
      "people" -> sec.people.getOrNull(s.k)?.let { p -> tv.host.go("#/person/" + Card.enc(p.id)) }
      "rows" -> sec.rows.getOrNull(s.k)?.let { r -> if (r.href.isNotEmpty()) tv.host.go(r.href) }
      else -> sec.cards.getOrNull(s.k)?.let { c -> tv.open(c) }
    }
  }

  /** A search goes on the recent list only once you open something it found. */
  private fun remember(q0: String) {
    val q = q0.trim(); if (q.isEmpty()) return
    recents = (listOf(q) + recents.filter { r -> !r.equals(q, ignoreCase = true) }).take(8)
    tv.host.setLocal(RECENT, JSONArray(recents).toString())
  }

  override fun hold() {
    val s = spots.getOrNull(focus) ?: return
    val sec = secs.getOrNull(s.sec) ?: return
    if (sec.kind == "cards" || sec.kind == "wide") sec.cards.getOrNull(s.k)?.let { c -> tv.host.hold(c.id, false) }
  }

  private fun openKeyboard() {
    typing = true; tv.invalidate()
    tv.host.keyboard(text, { t ->
      text = t
      Net.main.removeCallbacks(runLater)
      Net.main.postDelayed(runLater, 450)
      tv.invalidate()
    }) { result ->
      typing = false
      if (result != null) {
        text = result
        val q = result.trim()
        if (q == lastRun && !searching) { if (spots.isNotEmpty() && secs.isNotEmpty()) { focus = 0; aim() } }
        else { focusAfter = q.isNotEmpty(); run(q) }
      }
      tv.invalidate()
    }
  }

  // ---------- drawing ----------
  private val r = RectF()
  private val boxBg = Ui.fill(0xFF1E1415.toInt())
  private val boxBgOn = Ui.fill(0xFF2A1C1D.toInt())
  private val boxLine = Ui.stroke(0xFF33221F.toInt(), 2.67f)
  private val boxLineOn = Ui.stroke(Ui.WHITE, 2.67f)
  private val iconP = Ui.stroke(0xFFB9A9A7.toInt(), 1.75f * 40f / 24f)
  private val inputP = Ui.text(Ui.f400, 37.33f, Ui.WHITE)
  private val holdP = Ui.text(Ui.f400, 37.33f, 0xFF8E7F7E.toInt())
  private val caretP = Ui.fill(Ui.WHITE)
  private val clearOn = Ui.fill(Ui.WHITE)
  private val clearX = Ui.stroke(0xFFB9A9A7.toInt(), 3.33f)
  private val h2 = Ui.text(Ui.f800, 26.67f, Ui.TEXT, -0.2f)
  private val countP = Ui.text(Ui.f400, 18.67f, Ui.MUTED)
  private val chipBg = Ui.fill(0xFF1E1415.toInt())
  private val chipLine = Ui.stroke(0xFF33221F.toInt(), 1.33f)
  private val chipP = Ui.text(Ui.f600, 25.33f, Ui.WHITE)
  private val outline = Ui.stroke(Ui.WHITE, 4f)
  private val clearBg = Ui.fill(Ui.RED)
  private val clearLine = Ui.stroke(0xFF5A3537.toInt(), 1.33f)
  private val clearP = Ui.text(Ui.f600, 25.33f, Ui.WHITE)
  private val emptyP = Ui.text(Ui.f400, 20f, Ui.MUTED).apply { textAlign = Paint.Align.CENTER }
  private val failBg = Ui.fill(0x14FFB547)
  private val failLine = Ui.stroke(0x59FFB547, 1.33f)
  private val failP = Ui.text(Ui.f400, 17.33f, 0xFFF5D9A8.toInt())
  private val phGrad = Paint(Paint.ANTI_ALIAS_FLAG)
  private val initP = Ui.text(Ui.display, 58.67f, Ui.WHITE).apply { textAlign = Paint.Align.CENTER }
  private val ring = Ui.stroke(Ui.RED, 4f)
  private val border = Ui.stroke(Ui.LINE, 2f)
  private val t1 = Ui.text(Ui.f700, 18.67f, Ui.TEXT)
  private val t2 = Ui.text(Ui.f400, 17.33f, Ui.MUTED)
  private val t2r = Ui.text(Ui.f400, 17.33f, Ui.MUTED).apply { textAlign = Paint.Align.RIGHT }
  private val thumbP = Paint(Paint.ANTI_ALIAS_FLAG)
  private val PC = arrayOf(intArrayOf(0xFFF08A3C.toInt(), 0xFFB13A1E.toInt()), intArrayOf(0xFF4D9DE0.toInt(), 0xFF2B4A8A.toInt()), intArrayOf(0xFF59C27A.toInt(), 0xFF1F6B4A.toInt()),
    intArrayOf(0xFFB06FD8.toInt(), 0xFF5A2B86.toInt()), intArrayOf(0xFFE0607E.toInt(), 0xFF8A2B48.toInt()), intArrayOf(0xFFD8B84A.toInt(), 0xFF86601F.toInt()))

  override fun draw(c: Canvas, now: Long, dt: Float): Boolean {
    var anim = sy.step(dt)
    c.drawColor(Ui.BG)
    c.save(); c.translate(0f, -sy.pos)
    // The box.
    val on = focus == -1
    r.set(LEFT, BOX_T, LEFT + WIDTH, BOX_T + BOX_H)
    c.drawRoundRect(r, 26.67f, 26.67f, if (on) boxBgOn else boxBg)
    r.inset(1.33f, 1.33f); c.drawRoundRect(r, 25.33f, 25.33f, if (on) boxLineOn else boxLine)
    Icons.draw(c, "search", 186f, BOX_T + 30.5f, 40f, iconP)
    if (text.isEmpty()) Ui.line(c, "Search movies, shows, people", 247f, BOX_T, BOX_H, holdP)
    else {
      Ui.line(c, Ui.fit(text, inputP, 1540f), 247f, BOX_T, BOX_H, inputP)
      // Clear button (the web box's ×).
      val cx = LEFT + WIDTH - 52f; val cy = BOX_T + BOX_H / 2f
      if (focus == -2) c.drawCircle(cx, cy, 24f, clearOn)
      clearX.color = if (focus == -2) Ui.BG else 0xFFB9A9A7.toInt()
      c.drawLine(cx - 9f, cy - 9f, cx + 9f, cy + 9f, clearX); c.drawLine(cx + 9f, cy - 9f, cx - 9f, cy + 9f, clearX)
    }
    if (typing) {
      val blink = (SystemClock.uptimeMillis() / 530) % 2 == 0L
      if (blink) { val x = 247f + minOf(1540f, inputP.measureText(text)) + 3f; c.drawRect(x, BOX_T + 30f, x + 2.67f, BOX_T + BOX_H - 30f, caretP) }
      // Drawn again only when the caret next blinks.
      tv.wakeAt((SystemClock.uptimeMillis() / 530 + 1) * 530)
    }
    when {
      secs.isNotEmpty() -> anim = drawResults(c, now, dt) || anim
      searching -> Ui.line(c, "Searching…", 1018.5f, 296f, 60f, emptyP)
      !lastRun.isNullOrEmpty() -> Ui.line(c, "Nothing found for “$lastRun”.", 1018.5f, 296f, 60f, emptyP)
      recents.isNotEmpty() && secTop.isNotEmpty() -> {
        Ui.line(c, "Recent searches", LEFT, TOP, 39f, h2)
        for ((i, s) in spots.withIndex()) {
          if (s.k < 0) {
            val f = i == focus
            r.set(s.x, s.y, s.x + s.w, s.y + s.h)
            if (f) c.drawRoundRect(r, 32f, 32f, clearBg)
            r.inset(0.67f, 0.67f); clearLine.color = if (f) Ui.RED else 0xFF5A3537.toInt(); c.drawRoundRect(r, 31.33f, 31.33f, clearLine)
            val col = if (f) Ui.WHITE else 0xFFE7A6A8.toInt()
            clearX.color = col; clearP.color = col
            val ix = s.x + 29.33f + 12f; val iy = s.y + 32f
            c.drawLine(ix - 9f, iy - 9f, ix + 9f, iy + 9f, clearX); c.drawLine(ix + 9f, iy - 9f, ix - 9f, iy + 9f, clearX)
            Ui.line(c, "Clear", s.x + 29.33f + 34f, s.y, s.h, clearP)
            if (f) { r.set(s.x - 5.33f, s.y - 5.33f, s.x + s.w + 5.33f, s.y + s.h + 5.33f); c.drawRoundRect(r, 37.33f, 37.33f, outline) }
            continue
          }
          val q = recents.getOrNull(s.k) ?: continue
          r.set(s.x, s.y, s.x + s.w, s.y + s.h)
          c.drawRoundRect(r, 32f, 32f, chipBg)
          r.inset(0.67f, 0.67f); c.drawRoundRect(r, 31.33f, 31.33f, chipLine)
          Ui.line(c, q, s.x + 30.67f, s.y, s.h, chipP)
          if (i == focus) { r.set(s.x - 5.33f, s.y - 5.33f, s.x + s.w + 5.33f, s.y + s.h + 5.33f); c.drawRoundRect(r, 37.33f, 37.33f, outline) }
        }
      }
      else -> Ui.line(c, "Press OK on the search box to type or talk.", 1018.5f, 296f, 60f, emptyP)
    }
    c.restore()
    return anim
  }

  private fun drawResults(c: Canvas, now: Long, dt: Float): Boolean {
    var anim = false
    if (failed.isNotEmpty()) {
      val msg = "Couldn't reach ${failed.joinToString(" or ")}, so ${if (failed.size > 1) "their" else "its"} results aren't included."
      val w = minOf(853.33f, failP.measureText(msg) + 26.67f + 32f)
      r.set(LEFT, TOP, LEFT + w, TOP + failH); c.drawRoundRect(r, 13.33f, 13.33f, failBg); r.inset(0.67f, 0.67f); c.drawRoundRect(r, 12.67f, 12.67f, failLine)
      Ui.line(c, Ui.fit(msg, failP, w - 40f), LEFT + 20f, TOP, failH, failP)
    }
    for ((si, s) in secs.withIndex()) {
      val top = secTop.getOrNull(si) ?: continue
      Ui.line(c, s.title, LEFT, top, 39f, h2)
      if (!s.noCount) {
        val n = if (s.kind == "rows") s.rows.size else if (s.kind == "people") s.people.size else s.cards.size
        Ui.line(c, n.toString(), LEFT + h2.measureText(s.title) + 18.67f, top + 8f, 27f, countP)
      }
    }
    var focAt: Spot? = null
    for ((i, sp) in spots.withIndex()) {
      val sec = secs.getOrNull(sp.sec) ?: continue
      val f = i == focus
      if (sec.kind == "cards" || sec.kind == "wide") { val card = sec.cards[sp.k]; anim = CardArt.stepFocus(card, f, dt, tv.fast) || anim }
      if (sec.kind == "people") { val p = sec.people[sp.k]; val t = if (f) 1f else 0f; if (p.f != t) { p.f = if (tv.fast) t else if (f) minOf(1f, p.f + dt / 120f) else maxOf(0f, p.f - dt / 120f); if (p.f != t) anim = true } }
      if (sp.y - sy.pos > 1100f || sp.y + sp.h - sy.pos < -20f) continue
      if (f) { focAt = sp; continue }
      anim = drawSpot(c, sec, sp, false, now) || anim
    }
    focAt?.let { sp -> anim = drawSpot(c, secs[sp.sec], sp, true, now) || anim }
    return anim
  }

  private fun drawSpot(c: Canvas, sec: Sec, sp: Spot, f: Boolean, now: Long): Boolean = when (sec.kind) {
    "people" -> drawWho(c, sec.people[sp.k], sp.x, sp.y, now)
    "rows" -> drawRow(c, sec.rows[sp.k], sp, f)
    else -> drawCard(c, sec.cards[sp.k], sp.x, sp.y, now)
  }

  private fun drawCard(c: Canvas, card: Card, x: Float, y: Float, now: Long): Boolean {
    c.save()
    val s = CW / card.shape.w
    c.translate(x, y); c.scale(s, s)
    val a = CardArt.draw(c, card, 0f, 0f, now, tv.fast, text = false)
    c.restore()
    val ch = CW * card.shape.h / card.shape.w
    CardArt.title.color = Ui.mixColor(Ui.TEXT, Ui.WHITE, Ui.ease(card.f))
    Ui.line(c, Ui.fit(card.title, CardArt.title, CW), x, y + ch + 12f, 29f, CardArt.title)
    if (card.sub.isNotEmpty()) Ui.line(c, Ui.fit(card.sub, CardArt.sub, CW), x, y + ch + 41f, 25f, CardArt.sub)
    return a
  }

  private fun drawWho(c: Canvas, p: Who, x: Float, y: Float, now: Long): Boolean {
    var anim = false
    val f = Ui.ease(p.f)
    val d = CW
    c.save()
    if (f > 0f) { val s = 1f + 0.04f * f; c.translate(0f, -5.33f * f); c.scale(s, s, x + d / 2f, y + d / 2f) }
    r.set(x, y, x + d, y + d)
    val pic = Img.get(p.img)
    val a = if (pic != null) Img.fade(pic, now, tv.fast) else 0f
    if (a < 1f) {
      val g = PC[p.pc]
      phGrad.shader = LinearGradient(x, y, x + d, y + d, g[0], g[1], Shader.TileMode.CLAMP)
      c.drawOval(r, phGrad)
      Ui.line(c, p.ini, x + d / 2f, y + d / 2f - 30f, 60f, initP)
    }
    if (pic != null) { Img.draw(c, pic, RectF(r), d / 2f, a); if (a < 1f) anim = true }
    r.inset(1f, 1f); c.drawOval(r, border)
    if (f > 0f) { ring.alpha = (255 * f).toInt(); r.set(x - 2f, y - 2f, x + d + 2f, y + d + 2f); c.drawOval(r, ring) }
    c.restore()
    CardArt.title.color = Ui.mixColor(Ui.TEXT, Ui.WHITE, f)
    Ui.line(c, Ui.fit(p.name, CardArt.title, CW), x, y + d + 12f, 29f, CardArt.title)
    return anim
  }

  private fun drawRow(c: Canvas, row: Row, sp: Spot, f: Boolean): Boolean {
    val tw = if (row.wide) 96f else 58.67f
    val tx = sp.x + 10.67f; val ty = sp.y + 9.33f
    r.set(tx, ty, tx + tw, ty + 58.67f)
    val pic = Img.get(row.cover)
    if (pic != null) Img.draw(c, pic, RectF(r), if (row.round) 29.33f else 10.67f)
    else {
      thumbP.shader = LinearGradient(r.left, r.top, r.right, r.bottom, android.graphics.Color.HSVToColor(floatArrayOf(row.hue.toFloat(), 0.67f, 0.52f)), 0xFF2C1C1D.toInt(), Shader.TileMode.CLAMP)
      if (row.round) c.drawOval(r, thumbP) else c.drawRoundRect(r, 10.67f, 10.67f, thumbP)
    }
    val x = tx + tw + 16f
    val rightW = if (row.right.isNotEmpty()) t2r.measureText(row.right) + 16f else 0f
    val w = sp.x + sp.w - 10.67f - x - rightW
    Ui.line(c, Ui.fit(row.title, t1, w), x, sp.y + 14f, 26f, t1)
    Ui.line(c, Ui.fit(row.sub, t2, w), x, sp.y + 40f, 24f, t2)
    if (row.right.isNotEmpty()) Ui.line(c, row.right, sp.x + sp.w - 10.67f, sp.y, sp.h, t2r)
    if (f) { r.set(sp.x - 4f, sp.y - 4f, sp.x + sp.w + 4f, sp.y + sp.h + 4f); c.drawRoundRect(r, 17.33f, 17.33f, outline) }
    return false
  }
}
