package app.scrappy.player.tv

import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.text.Layout
import android.text.StaticLayout
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** Card shapes, sizes in 1080p units (measured from the web TV screens). */
enum class Shape(val w: Float, val h: Float) { WIDE(400f, 224.7f), PORTRAIT(227f, 340f), LIB(400f, 225f) }

/** One poster / tile, worked out once from Emby's item (same rules as card() and pickImage() in components.js). */
class Card(val it: JSONObject, val shape: Shape, val clickPlay: Boolean = false, showArt: Boolean = false, val lib: Boolean = false) {
  val id: String = it.optString("Id")
  val type: String = it.optString("Type")
  var title: String = it.optString("Name"); private set
  var sub: String = ""
  var img: String? = null; private set
  var logo: String? = null; private set
  var over: String? = null; private set
  val playable = type in PLAYABLE || (it.optString("MediaType") == "Video" && !it.optBoolean("IsFolder"))
  var pct = 0f; var badge = ""
  val href: String get() = if (lib) "#/library/" + enc(id) else "#/item/" + enc(id)
  /** Focus animation 0..1. */
  var f = 0f
  /** Placeholder text block (the item's name, like the web's grey label). */
  fun swap(u: String) { img = u }
  var phLayout: StaticLayout? = null
  var overLayout: StaticLayout? = null

  init {
    if (lib) {
      val tag = it.optJSONObject("ImageTags")?.optString("Primary").orEmpty()
      img = if (tag.isNotEmpty()) Net.image(id, "Primary", tag, 460) else Net.image(id, "Primary", null, 460)
    } else {
      img = pick(it, shape)
      if (showArt && type == "Episode") {
        val pb = it.optJSONArray("ParentBackdropImageTags")?.optString(0)
        val back = if (it.has("ParentBackdropItemId") && !pb.isNullOrEmpty()) Net.image(it.optString("ParentBackdropItemId"), "Backdrop/0", pb, W_WIDE) else null
        val lg = if (it.has("ParentLogoItemId") && it.optString("ParentLogoImageTag").isNotEmpty()) Net.image(it.optString("ParentLogoItemId"), "Logo", it.optString("ParentLogoImageTag"), 300) else null
        val th = if (it.has("ParentThumbItemId") && it.optString("ParentThumbImageTag").isNotEmpty()) Net.image(it.optString("ParentThumbItemId"), "Thumb", it.optString("ParentThumbImageTag"), W_WIDE) else null
        if (back != null && lg != null) { img = back; logo = lg; over = it.optString("SeriesName") }
        else if (th != null) img = th
        else if (back != null) { img = back; over = it.optString("SeriesName") }
      }
      if (type == "Episode") {
        title = it.optString("SeriesName").ifEmpty { it.optString("Name") }
        sub = listOf(epCode(it), it.optString("Name")).filter { it.isNotEmpty() }.joinToString(" · ")
      } else if (it.optInt("ProductionYear") > 0) {
        val y = it.optInt("ProductionYear")
        val endY = if (type == "Series" && it.optString("Status") == "Ended") year(it.optString("EndDate")) else 0
        sub = if (endY > 0 && endY != y) "$y–$endY" else y.toString()
      }
      val ud = it.optJSONObject("UserData")
      if (ud != null) {
        val played = ud.optBoolean("Played")
        pct = if (!played) ud.optDouble("PlayedPercentage", 0.0).toFloat() else 0f
        badge = if (played) "✓" else ud.optInt("UnplayedItemCount").let { if (it > 0) it.toString() else "" }
      }
    }
  }

  companion object {
    val PLAYABLE = setOf("Movie", "Episode", "Video", "MusicVideo", "Trailer")
    const val W_POSTER = 240
    const val W_WIDE = 400
    fun enc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")
    fun epCode(it: JSONObject): String = if (it.has("ParentIndexNumber") && it.has("IndexNumber")) "S${it.optInt("ParentIndexNumber")}:E${it.optInt("IndexNumber")}" else ""
    fun year(d: String): Int = if (d.length >= 4) d.substring(0, 4).toIntOrNull() ?: 0 else 0
    fun shapeFor(it: JSONObject): Shape {
      val t = it.optString("Type")
      if (t == "Episode" || t == "Video") return Shape.WIDE
      if (it.optDouble("PrimaryImageAspectRatio", 0.0) > 1.3) return Shape.WIDE
      return Shape.PORTRAIT
    }
    fun pick(it: JSONObject, shape: Shape): String? {
      val t = it.optJSONObject("ImageTags") ?: JSONObject()
      val id = it.optString("Id")
      fun tag(k: String) = t.optString(k).takeIf { s -> s.isNotEmpty() }
      if (shape == Shape.WIDE) {
        val w = W_WIDE
        if (it.optString("Type") == "Episode" && tag("Primary") != null) return Net.image(id, "Primary", tag("Primary"), w)
        tag("Thumb")?.let { return Net.image(id, "Thumb", it, w) }
        it.optJSONArray("BackdropImageTags")?.optString(0)?.takeIf { s -> s.isNotEmpty() }?.let { return Net.image(id, "Backdrop/0", it, w) }
        tag("Primary")?.let { return Net.image(id, "Primary", it, w) }
        if (it.optString("ParentThumbItemId").isNotEmpty()) return Net.image(it.optString("ParentThumbItemId"), "Thumb", it.optString("ParentThumbImageTag"), w)
        if (it.optString("ParentBackdropItemId").isNotEmpty()) return Net.image(it.optString("ParentBackdropItemId"), "Backdrop/0", it.optJSONArray("ParentBackdropImageTags")?.optString(0), w)
        if (it.optString("Type") == "Episode" && it.optString("SeriesPrimaryImageTag").isNotEmpty() && it.optString("SeriesId").isNotEmpty()) return Net.image(it.optString("SeriesId"), "Primary", it.optString("SeriesPrimaryImageTag"), w)
        return null
      }
      tag("Primary")?.let { return Net.image(id, "Primary", it, W_POSTER) }
      if (it.optString("SeriesPrimaryImageTag").isNotEmpty()) return Net.image(it.optString("SeriesId"), "Primary", it.optString("SeriesPrimaryImageTag"), W_POSTER)
      return null
    }
    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
    fun time(d: String?): Long = try { if (d.isNullOrEmpty()) 0L else iso.parse(d.substring(0, minOf(19, d.length)))?.time ?: 0L } catch (_: Throwable) { 0L }
    fun runtime(ticks: Long): String {
      if (ticks <= 0) return ""
      val min = Math.round(ticks / 600000000.0).toInt()
      val h = min / 60
      return if (h > 0) "${h}h ${min % 60}m" else "${min}m"
    }
  }
}

/** Drawing a card the way the web TV screens do (focus: lift + 1.04 + red ring, title turns white). */
object CardArt {
  const val RADIUS = 13.33f
  private val panel = Ui.fill(Ui.PANEL)
  private val border = Ui.stroke(Ui.LINE, 2f)
  private val ring = Ui.stroke(Ui.RED, 4f)
  private val redBorder = Ui.stroke(Ui.RED, 2f)
  private val progBg = Ui.fill(0x99000000.toInt())
  private val progFg = Ui.fill(Ui.RED)
  private val badgeBg = Ui.fill(Ui.RED)
  private val badgeTx = Ui.text(Ui.f700, 16f, Ui.WHITE).apply { textAlign = Paint.Align.CENTER }
  val title = Ui.text(Ui.f700, 20f, Ui.TEXT)
  val sub = Ui.text(Ui.f400, 17.33f, Ui.MUTED)
  private val ph = Ui.text(Ui.f600, 20f, Ui.MUTED)
  private val libPh = Ui.text(Ui.f600, 26.67f, Ui.TEXT)
  private val overName = Ui.text(Ui.display, 36f, Ui.WHITE, 0.53f).apply { setShadowLayer(8f, 0f, 2.7f, 0xD9000000.toInt()) }
  private val overGrad = Paint()
  private val libGrad = Paint()
  private val r = RectF()

  /** Step the focus animation (120 ms ease-out). Returns true while moving. */
  fun stepFocus(card: Card, focused: Boolean, dt: Float, fast: Boolean): Boolean {
    val t = if (focused) 1f else 0f
    if (card.f == t) return false
    if (fast) { card.f = t; return false }
    card.f = if (focused) minOf(1f, card.f + dt / 120f) else maxOf(0f, card.f - dt / 120f)
    return card.f != t
  }

  /** x, y = top-left of the art. Returns true if a picture is still fading in. */
  fun draw(c: Canvas, card: Card, x: Float, y: Float, now: Long, fast: Boolean, text: Boolean = true): Boolean {
    val w = card.shape.w; val h = card.shape.h
    val f = Ui.ease(card.f)
    var anim = false
    if (card.f >= 1f) Menu.noteFocus(c, card, x, y)
    c.save()
    if (f > 0f) {
      val s = 1f + 0.04f * f
      c.translate(0f, -5.33f * f)
      c.scale(s, s, x + w / 2f, y + h / 2f)
    }
    r.set(x, y, x + w, y + h)
    c.drawRoundRect(r, RADIUS, RADIUS, panel)
    val pic = Img.get(card.img)
    var a = 0f
    if (pic != null) { a = Img.fade(pic, now, fast); Img.draw(c, pic, r, RADIUS, a); if (a < 1f) anim = true }
    if (a < 1f) placeholder(c, card, r, 1f - a)
    if (card.over != null && pic != null) {
      if (overGrad.shader == null) overGrad.shader = LinearGradient(0f, Shape.WIDE.h, 0f, 0f, intArrayOf(0xD10A0606.toInt(), 0x590A0606, 0x000A0606, 0x000A0606), floatArrayOf(0f, 0.38f, 0.62f, 1f), Shader.TileMode.CLAMP)
      overGrad.alpha = (255 * a).toInt()
      c.save(); c.translate(0f, y); r.offset(0f, -y)
      c.drawRoundRect(r, RADIUS, RADIUS, overGrad)
      c.restore(); r.offset(0f, y)
      val lg = Img.get(card.logo, alpha = true)
      if (lg != null) {
        val la = Img.fade(lg, now, fast); if (la < 1f) anim = true
        val box = RectF(x + w * 0.06f, y, x + w * 0.06f + w * 0.62f, y + h - h * 0.11f)
        box.top = box.bottom - h * 0.44f
        Img.drawContain(c, lg, box, la * a)
      } else if (card.logo == null) overTitle(c, card, x, y, w, h, a)
    }
    if (card.pct > 0f) {
      val by = y + h - 2f - 5.33f
      c.drawRect(x + 2f, by, x + w - 2f, y + h - 2f, progBg)
      c.drawRect(x + 2f, by, x + 2f + (w - 4f) * (card.pct / 100f), y + h - 2f, progFg)
    }
    if (card.badge.isNotEmpty()) {
      val bw = maxOf(32f, badgeTx.measureText(card.badge) + 16f)
      r.set(x + w - 10.67f - bw, y + 10.67f, x + w - 10.67f, y + 10.67f + 32f)
      c.drawRoundRect(r, 16f, 16f, badgeBg)
      Ui.line(c, card.badge, r.centerX(), r.top, 32f, badgeTx)
    }
    r.set(x + 1f, y + 1f, x + w - 1f, y + h - 1f)
    if (f > 0f) {
      redBorder.alpha = (255 * f).toInt(); c.drawRoundRect(r, RADIUS - 1f, RADIUS - 1f, border); c.drawRoundRect(r, RADIUS - 1f, RADIUS - 1f, redBorder)
      ring.alpha = (255 * f).toInt()
      r.set(x - 2f, y - 2f, x + w + 2f, y + h + 2f)
      c.drawRoundRect(r, RADIUS + 2f, RADIUS + 2f, ring)
    } else c.drawRoundRect(r, RADIUS - 1f, RADIUS - 1f, border)
    c.restore()
    if (text) {
      title.color = Ui.mixColor(Ui.TEXT, Ui.WHITE, f)
      Ui.line(c, Ui.fit(card.title, title, w), x, y + h + 12f, 29f, title)
      if (card.sub.isNotEmpty()) Ui.line(c, Ui.fit(card.sub, sub, w), x, y + h + 12f + 29f, 25f, sub)
    }
    return anim
  }

  private fun placeholder(c: Canvas, card: Card, box: RectF, alpha: Float) {
    if (card.lib) {
      libGrad.shader = LinearGradient(box.left, box.top, box.right, box.bottom, 0xFF360D0F.toInt(), Ui.PANEL, Shader.TileMode.CLAMP)
      libGrad.alpha = (255 * alpha).toInt()
      c.drawRoundRect(box, RADIUS, RADIUS, libGrad)
    }
    val p = if (card.lib) libPh else ph
    val lay = card.phLayout ?: StaticLayout.Builder.obtain(card.it.optString("Name"), 0, card.it.optString("Name").length, p, (box.width() - 32f).toInt().coerceAtLeast(10))
      .setAlignment(Layout.Alignment.ALIGN_CENTER).setMaxLines(4).setEllipsize(android.text.TextUtils.TruncateAt.END).build().also { card.phLayout = it }
    p.alpha = (255 * alpha).toInt()
    c.save(); c.translate(box.left + 16f, box.top + (box.height() - lay.height) / 2f); lay.draw(c); c.restore()
    p.alpha = 255
  }

  private fun overTitle(c: Canvas, card: Card, x: Float, y: Float, w: Float, h: Float, a: Float) {
    val name = card.over ?: return
    val lay = card.overLayout ?: StaticLayout.Builder.obtain(name, 0, name.length, overName, (w * 0.88f).toInt())
      .setMaxLines(2).setEllipsize(android.text.TextUtils.TruncateAt.END)
      .setLineSpacing(0f, 36.7f / (overName.fontMetrics.descent - overName.fontMetrics.ascent)).build().also { card.overLayout = it }
    overName.alpha = (255 * a).toInt()
    c.save(); c.translate(x + w * 0.06f, y + h - h * 0.10f - lay.height); lay.draw(c); c.restore()
  }
}
