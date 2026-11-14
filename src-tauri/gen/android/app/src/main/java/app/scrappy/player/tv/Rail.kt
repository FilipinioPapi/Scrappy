package app.scrappy.player.tv

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.view.KeyEvent
import org.json.JSONObject

/** The side rail, drawn natively (same look as tvrail.js): icons only, opening with names when the remote is on it. */
class Rail(private val tv: TvView) {
  class Entry(val key: String, val name: String, val icon: String, val href: String)

  private var libs: List<JSONObject> = emptyList()
  private var entries: List<Entry> = emptyList()
  private var tops = FloatArray(0)
  private var itemH = 63f
  private var sepY = 0f
  var open = false
    set(v) { if (field != v) { field = v; if (v) focus = entries.indexOfFirst { it.key == cur }.coerceAtLeast(0) } }
  private var openT = 0f // 0..1 width animation
  private var labelT = 0f
  var focus = 0; private set
  private var cur = "home"
  private var loaded = false
  private var logo: Bitmap? = null

  private val bg = Ui.fill(Ui.RAIL_BG)
  private val edge = Ui.fill(0xFF1F1516.toInt())
  private val curBg = Ui.fill(0x14FFFFFF)
  private val focBg = Ui.fill(Ui.WHITE)
  private val sep = Ui.fill(0xFF2A1C1D.toInt())
  private val icon = Ui.stroke(0xFFB9A9A7.toInt(), 1.75f * 1.5f)
  private val label = Ui.text(Ui.f600, 26.7f, 0xFFB9A9A7.toInt())
  private val brand = Ui.text(Ui.display, 36f, Ui.RED, 0.72f)
  private val faceBg = Paint(Paint.ANTI_ALIAS_FLAG)
  private val faceTxt = Ui.text(Ui.f800, 20f, Ui.WHITE).apply { textAlign = Paint.Align.CENTER }
  private val shadow = Paint()
  private val bmpPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private val r = RectF()

  init { build() }

  fun reset() { loaded = false; libs = emptyList(); build() }

  private fun load() {
    if (loaded) return
    loaded = true
    Net.load("/Users/{userId}/Views") { v, _ ->
      val skip = setOf("music", "livetv", "channels", "books", "audiobooks", "playlists")
      val l = Net.items(v).filter { it.optString("CollectionType") !in skip }
      if (l.map { it.optString("Id") + it.optString("Name") } != libs.map { it.optString("Id") + it.optString("Name") }) { libs = l; build(); tv.invalidate() }
    }
  }

  private fun build() {
    val k = if (open) entries.getOrNull(focus)?.key else null
    val l = ArrayList<Entry>()
    l.add(Entry("me", Net.session.userName.ifEmpty { "Who's watching" }, "", ""))
    l.add(Entry("search", "Search", "search", "#/search"))
    l.add(Entry("home", "Home", "home", "#/home"))
    for (v in libs) l.add(Entry(v.optString("Id"), v.optString("Name"), v.optString("CollectionType"), "#/library/" + java.net.URLEncoder.encode(v.optString("Id"), "UTF-8")))
    l.add(Entry("genres", "Genres", "genres", "#/genres"))
    l.add(Entry("favorites", "Favorites", "favorites", "#/favorites"))
    l.add(Entry("music", "Music", "music", "#/music"))
    l.add(Entry("audiobooks", "Audiobooks", "audiobooks", "#/audiobooks"))
    l.add(Entry("settings", "Settings", "settings", "#/settings"))
    entries = l
    // With many libraries the entries get shorter so Settings always fits (same rule as the web rail).
    itemH = 1.3333f * (640f / l.size - 6f).coerceIn(34f, 52f)
    tops = FloatArray(l.size)
    var y = 133f
    for (i in l.indices) {
      val e = l[i]
      if (e.key == "settings") { tops[i] = Ui.H - 52f - itemH; continue }
      if (e.key == "music") { sepY = y + 10.67f; y += 10.67f + 1.33f + 10.67f + 8f }
      tops[i] = y
      y += itemH + 8f
      if (e.key == "me") y += 10.67f
    }
    if (k != null) focus = entries.indexOfFirst { it.key == k }.coerceAtLeast(0)
  }

  fun mark(key: String) { cur = key; load() }

  /** Left from the start of the screen: open on the entry for the screen you're on. */
  fun openFrom() { open = true; focus = entries.indexOfFirst { it.key == cur }.coerceAtLeast(0) }

  fun key(code: Int) {
    when (code) {
      KeyEvent.KEYCODE_DPAD_UP -> if (focus > 0) focus--
      KeyEvent.KEYCODE_DPAD_DOWN -> if (focus < entries.size - 1) focus++
      KeyEvent.KEYCODE_DPAD_RIGHT -> open = false
    }
  }

  fun ok() {
    val e = entries.getOrNull(focus) ?: return
    if (e.key == "me") { tv.host.who(); return }
    open = false
    // Picking the screen you're on just closes the rail.
    if (e.key == cur && (e.key == "home" || tv.routeHash == e.href)) return
    tv.host.go(e.href)
  }

  fun draw(c: Canvas, now: Long, dt: Float): Boolean {
    val target = if (open) 1f else 0f
    var anim = false
    if (openT != target) { openT = if (open) minOf(1f, openT + dt / 160f) else maxOf(0f, openT - dt / 160f); anim = true }
    if (labelT != target) { labelT = if (open) minOf(1f, labelT + dt / 120f) else maxOf(0f, labelT - dt / 120f); anim = true }
    val w = Ui.mix(117f, 427f, Ui.ease(openT))
    if (openT > 0f) {
      shadow.shader = LinearGradient(w, 0f, w + 80f, 0f, Ui.alpha(0xFF000000.toInt(), 0.6f * openT), 0, Shader.TileMode.CLAMP)
      c.drawRect(w, 0f, w + 80f, Ui.H, shadow)
    }
    c.drawRect(0f, 0f, w, Ui.H, bg)
    c.drawRect(w - 1.33f, 0f, w, Ui.H, edge)
    c.save(); c.clipRect(0f, 0f, w - 1.33f, Ui.H)
    // Logo and name.
    val lg = logo ?: try { BitmapFactory.decodeResource(tv.resources, tv.resources.getIdentifier("tv_logo", "drawable", tv.context.packageName)) } catch (_: Throwable) { null }
    logo = lg
    if (lg != null) { r.set(24.3f, 34.7f, 24.3f + 69.3f, 34.7f + 69.3f); c.drawBitmap(lg, null, r, bmpPaint) }
    if (labelT > 0f) { brand.alpha = (255 * labelT).toInt(); Ui.line(c, "SCRAPPY", 109f, 51f, 36f, brand) }
    val lab = labelT > 0f
    for (i in entries.indices) {
      val e = entries[i]; val y = tops[i]
      val focused = open && i == focus
      val isCur = e.key == cur
      r.set(19f, y, w - 19f - 1.33f, y + itemH)
      if (focused) c.drawRoundRect(r, 18.7f, 18.7f, focBg) else if (isCur) c.drawRoundRect(r, 18.7f, 18.7f, curBg)
      val col = if (focused) 0xFF140D0E.toInt() else if (isCur) Ui.WHITE else 0xFFB9A9A7.toInt()
      val ic = if (focused) 0xFF140D0E.toInt() else if (isCur) Ui.RED_HI else 0xFFB9A9A7.toInt()
      val cy = y + itemH / 2f
      if (e.key == "me") drawFace(c, 38f, cy - 20f, e.name)
      else { icon.color = ic; icon.strokeWidth = 2.625f; Icons.draw(c, e.icon, 40.3f, cy - 18f, 36f, icon) }
      if (lab) {
        label.color = col; label.alpha = (255 * labelT).toInt()
        Ui.line(c, Ui.fit(e.name, label, w - 19f - 100f - 21f), 100f, cy - 19.5f, 39f, label)
      }
    }
    c.drawRect(27f, sepY, w - 27f - 1.33f, sepY + 1.33f, sep)
    c.restore()
    return anim
  }

  private fun drawFace(c: Canvas, x: Float, y: Float, name: String) {
    r.set(x, y, x + 40f, y + 40f)
    val pic = Img.get(if (Net.session.ok) "${Net.session.server}/Users/${Net.session.userId}/Images/Primary?maxWidth=120&quality=90" else null)
    if (pic != null) { Img.draw(c, pic, r, 20f); return }
    faceBg.shader = LinearGradient(x, y, x + 40f, y + 40f, 0xFFF08A3C.toInt(), 0xFFB13A1E.toInt(), Shader.TileMode.CLAMP)
    c.drawOval(r, faceBg)
    Ui.line(c, (name.firstOrNull() ?: '?').uppercaseChar().toString(), x + 20f, y, 40f, faceTxt)
  }
}
