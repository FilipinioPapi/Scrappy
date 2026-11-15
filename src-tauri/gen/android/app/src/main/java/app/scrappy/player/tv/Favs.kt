package app.scrappy.player.tv

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.KeyEvent
import kotlin.math.abs

/** Favorites: one grid, with buttons on top to switch between Movies, Shows, Episodes and Collections
 *  (favoritesView in views.js, approved option A). */
class Favs(tv: TvView) : Screen(tv) {
  override val railKey = "favorites"
  private val FIELDS = "PrimaryImageAspectRatio,ProductionYear,EndDate,BasicSyncInfo"
  private val IMG_OPTS = "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Thumb"

  private var groups: List<Pair<String, List<Card>>> = emptyList()
  private var cur = 0
  private var loaded = false
  private var done = false
  private var focus = 0 // -1 = the buttons
  private var chip = 0
  private val sy = Glide()

  override fun show(fresh: Boolean) { if (!loaded) { loaded = true; load() } }
  override fun stale() { if (loaded) load() }

  private fun load() {
    Net.load("/Users/{userId}/Items?Filters=IsFavorite&Recursive=true&IncludeItemTypes=Movie,Series,Episode,BoxSet&SortBy=SortName&Fields=$FIELDS&$IMG_OPTS&Limit=1000") { v, _ ->
      val items = Net.items(v)
      val name = groups.getOrNull(cur)?.first
      val old = groups.flatMap { g -> g.second }.associate { c -> c.id to c.f }
      groups = listOf("Movie" to "Movies", "Series" to "Shows", "Episode" to "Episodes", "BoxSet" to "Collections").map { (t, n) ->
        n to items.filter { j -> j.optString("Type") == t }.map { j -> Card(j, if (t == "Episode") Shape.WIDE else Shape.PORTRAIT).also { c -> c.f = old[c.id] ?: 0f } }
      }.filter { g -> g.second.isNotEmpty() }
      cur = groups.indexOfFirst { g -> g.first == name }.coerceAtLeast(0)
      done = true
      clamp(); tv.invalidate()
    }
  }

  private val list get() = groups.getOrNull(cur)?.second ?: emptyList()
  private val wide get() = groups.getOrNull(cur)?.first == "Episodes"
  private val cols get() = if (wide) 4 else 7
  private val cw get() = (1685f + 21.33f) / cols - 21.33f
  private val ch get() = if (wide) cw * 225f / 400f else cw * 1.5f
  private val px get() = cw + 21.33f
  private val py get() = ch + 12f + 29f + 25f + 31f
  private val TOP = 124f

  private fun clamp() { if (focus >= list.size) focus = maxOf(0, list.size - 1); if (list.isEmpty()) focus = -1 }

  private fun aim() {
    val max = maxOf(0f, TOP + ((list.size + cols - 1) / cols) * py + 80f - 1080f)
    sy.set(if (focus < 0) 0f else (TOP + (focus / cols) * py + 200f - 540f).coerceIn(0f, max))
  }

  override fun behind() = abs(sy.to - sy.pos)

  override fun key(k: Int): Boolean {
    if (focus < 0) {
      when (k) {
        KeyEvent.KEYCODE_DPAD_LEFT -> { if (chip == 0) return false; chip-- }
        KeyEvent.KEYCODE_DPAD_RIGHT -> if (chip < groups.size - 1) chip++
        KeyEvent.KEYCODE_DPAD_DOWN -> if (list.isNotEmpty()) { focus = 0; aim() }
      }
      return true
    }
    val n = list.size
    when (k) {
      KeyEvent.KEYCODE_DPAD_LEFT -> { if (focus % cols == 0) return false; focus-- }
      KeyEvent.KEYCODE_DPAD_RIGHT -> if (focus % cols < cols - 1 && focus + 1 < n) focus++
      KeyEvent.KEYCODE_DPAD_DOWN -> if (focus + cols < n) focus += cols else if (focus / cols < (n - 1) / cols) focus = n - 1
      KeyEvent.KEYCODE_DPAD_UP -> if (focus >= cols) focus -= cols else { focus = -1; chip = cur }
    }
    aim()
    return true
  }

  override fun ok() {
    if (focus < 0) {
      if (chip != cur && chip in groups.indices) { cur = chip; focus = -1; sy.set(0f, true); tv.invalidate() }
      return
    }
    val c = list.getOrNull(focus) ?: return
    if (c.type == "Episode") { tv.pageFirst(c.it); tv.host.play(c.id) } else tv.open(c)
  }

  override fun hold() { list.getOrNull(focus)?.let { c -> tv.host.hold(c.id, false) } }

  private val r = RectF()
  private val h2 = Ui.text(Ui.f800, 45.33f, Ui.TEXT, -0.27f)
  private val countP = Ui.text(Ui.f400, 18.67f, Ui.MUTED)
  private val chipBg = Ui.fill(0x17FFFFFF)
  private val chipSel = Ui.fill(Ui.RED)
  private val chipFoc = Ui.fill(Ui.TEXT)
  private val chipP = Ui.text(Ui.f600, 24f, 0xFFE9DADB.toInt())
  private val emptyP = Ui.text(Ui.f400, 21.33f, Ui.MUTED)
  private val h2s = Ui.text(Ui.f800, 34.67f, Ui.TEXT, -0.27f)

  override fun draw(c: Canvas, now: Long, dt: Float): Boolean {
    var anim = sy.step(dt)
    c.drawColor(Ui.BG)
    if (done && groups.isEmpty()) {
      Ui.line(c, "Favorites", 149f, 35f, 46f, h2s)
      Ui.line(c, "Nothing here yet. Press the heart on any movie or show to add it.", 149f, 110f, 30f, emptyP)
      return anim
    }
    c.save(); c.translate(0f, -sy.pos)
    Ui.line(c, "Favorites", 149f, 35f, 65.7f, h2)
    groups.getOrNull(cur)?.let { (n, l) -> Ui.line(c, "${l.size} ${n.lowercase()}", 149f + h2.measureText("Favorites") + 18.67f, 54f, 27f, countP) }
    val widths = groups.map { g -> 29.33f * 2 + chipP.measureText(g.first) }
    var x = 1834f - widths.sum() - 16f * (groups.size - 1)
    for ((k, g) in groups.withIndex()) {
      r.set(x, 37f, x + widths[k], 98f)
      val foc = focus < 0 && chip == k
      c.drawRoundRect(r, 30.5f, 30.5f, if (foc) chipFoc else if (k == cur) chipSel else chipBg)
      chipP.color = if (foc) Ui.BG else if (k == cur) Ui.WHITE else 0xFFE9DADB.toInt()
      Ui.line(c, g.first, x + 29.33f, 37f, 61f, chipP)
      x += widths[k] + 16f
    }
    val l = list
    var focAt: Pair<Float, Float>? = null
    for ((i, card) in l.withIndex()) {
      val cx = 149f + (i % cols) * px; val cy = TOP + (i / cols) * py
      val f = i == focus
      anim = CardArt.stepFocus(card, f, dt, tv.fast) || anim
      if (cy - sy.pos > 1080f || cy + py - sy.pos < 0f) continue
      if (f) { focAt = cx to cy; continue }
      anim = drawCard(c, card, cx, cy, now) || anim
    }
    focAt?.let { (cx, cy) -> anim = drawCard(c, l[focus], cx, cy, now) || anim }
    c.restore()
    return anim
  }

  private fun drawCard(c: Canvas, card: Card, x: Float, y: Float, now: Long): Boolean {
    c.save()
    val s = cw / card.shape.w
    c.translate(x, y); c.scale(s, s)
    val a = CardArt.draw(c, card, 0f, 0f, now, tv.fast, text = false)
    c.restore()
    CardArt.title.color = Ui.mixColor(Ui.TEXT, Ui.WHITE, Ui.ease(card.f))
    Ui.line(c, Ui.fit(card.title, CardArt.title, cw), x, y + ch + 12f, 29f, CardArt.title)
    if (card.sub.isNotEmpty()) Ui.line(c, Ui.fit(card.sub, CardArt.sub, cw), x, y + ch + 41f, 25f, CardArt.sub)
    return a
  }
}
