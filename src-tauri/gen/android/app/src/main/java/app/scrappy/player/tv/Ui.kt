package app.scrappy.player.tv

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.text.TextPaint
import android.text.TextUtils

/** Colours, fonts and small drawing helpers shared by the native TV screens.
 *  Everything is drawn in "1080p units": the canvas is scaled once so 1920 units span the screen. */
object Ui {
  const val W = 1920f
  const val H = 1080f
  const val RED = 0xFFEC282E.toInt()
  const val RED_HI = 0xFFF0453F.toInt()
  const val BG = 0xFF120C0C.toInt()
  const val RAIL_BG = 0xFF0C0808.toInt()
  const val PANEL = 0xFF1E1415.toInt()
  const val BUTTON = 0xFF2C1C1D.toInt()
  const val LINE = 0xFF3A2526.toInt()
  const val TEXT = 0xFFF6E9E9.toInt()
  const val MUTED = 0xFFBFA7A8.toInt()
  const val WHITE = 0xFFFFFFFF.toInt()

  var f400: Typeface = Typeface.DEFAULT; private set
  var f500: Typeface = Typeface.DEFAULT; private set
  var f600: Typeface = Typeface.DEFAULT_BOLD; private set
  var f700: Typeface = Typeface.DEFAULT_BOLD; private set
  var f800: Typeface = Typeface.DEFAULT_BOLD; private set
  var display: Typeface = Typeface.DEFAULT_BOLD; private set
  private var ready = false

  fun init(ctx: Context) {
    if (ready) return
    ready = true
    fun font(name: String, fallback: Typeface): Typeface = try {
      val id = ctx.resources.getIdentifier(name, "font", ctx.packageName)
      if (id != 0) ctx.resources.getFont(id) else fallback
    } catch (e: Throwable) { fallback }
    f400 = font("inter_400", Typeface.DEFAULT)
    f500 = font("inter_500", Typeface.DEFAULT)
    f600 = font("inter_600", Typeface.DEFAULT_BOLD)
    f700 = font("inter_700", Typeface.DEFAULT_BOLD)
    f800 = font("inter_800", Typeface.DEFAULT_BOLD)
    display = font("luckiest_guy", Typeface.DEFAULT_BOLD)
  }

  fun text(face: Typeface, size: Float, color: Int, spacing: Float = 0f): TextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
    typeface = face; textSize = size; this.color = color; if (spacing != 0f) letterSpacing = spacing / size
  }
  fun fill(color: Int): Paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color; style = Paint.Style.FILL }
  fun stroke(color: Int, width: Float): Paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    this.color = color; style = Paint.Style.STROKE; strokeWidth = width; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
  }

  /** One line of text cut with "…" to fit. */
  fun fit(s: String, p: TextPaint, width: Float): String =
    if (p.measureText(s) <= width) s else TextUtils.ellipsize(s, p, width, TextUtils.TruncateAt.END).toString()

  /** Draw text whose top edge of the line box sits at `top` (line box `lineH` tall), like CSS. */
  fun line(c: Canvas, s: String, x: Float, top: Float, lineH: Float, p: Paint) {
    val fm = p.fontMetrics
    c.drawText(s, x, top + (lineH - (fm.descent - fm.ascent)) / 2f - fm.ascent, p)
  }

  /** A block of text cut to maxLines, ending on a whole word with "…" (like the web pages' clamp). */
  fun clamp(text: String, p: android.text.TextPaint, width: Int, maxLines: Int, lineH: Float): android.text.StaticLayout {
    val mult = lineH / (p.fontMetrics.descent - p.fontMetrics.ascent)
    fun build(t: CharSequence, lines: Int) = android.text.StaticLayout.Builder.obtain(t, 0, t.length, p, width).setMaxLines(lines)
      .setEllipsize(android.text.TextUtils.TruncateAt.END).setLineSpacing(0f, mult).setIncludePad(false).build()
    val full = build(text, Int.MAX_VALUE)
    if (full.lineCount <= maxLines) return build(text, maxLines)
    var end = full.getLineEnd(maxLines - 1)
    var cut = text.substring(0, end).trimEnd()
    while (true) {
      val sp = cut.lastIndexOf(' ')
      val t = (if (sp > 0) cut.substring(0, sp) else cut).trimEnd(',', ';', ':', ' ', '-') + "…"
      val l = build(t, Int.MAX_VALUE)
      if (l.lineCount <= maxLines || sp <= 0) return build(t, maxLines)
      cut = cut.substring(0, sp)
    }
  }

  /** 0..1 eased (ease-out cubic). */
  fun ease(t: Float): Float { val u = 1f - t.coerceIn(0f, 1f); return 1f - u * u * u }
  fun mix(a: Float, b: Float, t: Float) = a + (b - a) * t
  fun mixColor(a: Int, b: Int, t: Float): Int {
    val u = t.coerceIn(0f, 1f)
    fun ch(s: Int) = ((a ushr s and 255) + ((b ushr s and 255) - (a ushr s and 255)) * u).toInt() and 255
    return (ch(24) shl 24) or (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
  }
  fun alpha(color: Int, a: Float): Int = (color and 0x00FFFFFF) or (((color ushr 24) * a.coerceIn(0f, 1f)).toInt() shl 24)
}

/** The app's line icons, drawn on a 24 x 24 grid (same shapes as the web side rail). */
object Icons {
  private val DATA = mapOf(
    "search" to "M17 10.5C17 11.64 16.7 12.76 16.13 13.75C15.56 14.74 14.74 15.56 13.75 16.13C12.76 16.7 11.64 17 10.5 17C9.36 17 8.24 16.7 7.25 16.13C6.26 15.56 5.44 14.74 4.87 13.75C4.3 12.76 4 11.64 4 10.5C4 9.36 4.3 8.24 4.87 7.25C5.44 6.26 6.26 5.44 7.25 4.87C8.24 4.3 9.36 4 10.5 4C11.64 4 12.76 4.3 13.75 4.87C14.74 5.44 15.56 6.26 16.13 7.25C16.7 8.24 17 9.36 17 10.5ZM15.5 15.5L21 21",
    "home" to "M3 11L12 4L21 11L21 20C21 20.18 20.95 20.35 20.87 20.5C20.78 20.65 20.65 20.78 20.5 20.87C20.35 20.95 20.18 21 20 21L15 21L15 15L9 15L9 21L4 21C3.82 21 3.65 20.95 3.5 20.87C3.35 20.78 3.22 20.65 3.13 20.5C3.05 20.35 3 20.18 3 20Z",
    "movies" to "M5 4L19 4C19.35 4 19.7 4.09 20 4.27C20.3 4.44 20.56 4.7 20.73 5C20.91 5.3 21 5.65 21 6L21 18C21 18.35 20.91 18.7 20.73 19C20.56 19.3 20.3 19.56 20 19.73C19.7 19.91 19.35 20 19 20L5 20C4.65 20 4.3 19.91 4 19.73C3.7 19.56 3.44 19.3 3.27 19C3.09 18.7 3 18.35 3 18L3 6C3 5.65 3.09 5.3 3.27 5C3.44 4.7 3.7 4.44 4 4.27C4.3 4.09 4.65 4 5 4ZM7 4L7 20M17 4L17 20M3 9L7 9M3 15L7 15M17 9L21 9M17 15L21 15",
    "tvshows" to "M5 6L19 6C19.35 6 19.7 6.09 20 6.27C20.3 6.44 20.56 6.7 20.73 7C20.91 7.3 21 7.65 21 8L21 16C21 16.35 20.91 16.7 20.73 17C20.56 17.3 20.3 17.56 20 17.73C19.7 17.91 19.35 18 19 18L5 18C4.65 18 4.3 17.91 4 17.73C3.7 17.56 3.44 17.3 3.27 17C3.09 16.7 3 16.35 3 16L3 8C3 7.65 3.09 7.3 3.27 7C3.44 6.7 3.7 6.44 4 6.27C4.3 6.09 4.65 6 5 6ZM8 21L16 21M9 2L12 6L15 2",
    "boxsets" to "M4.5 8L14.5 8C14.76 8 15.02 8.07 15.25 8.2C15.48 8.33 15.67 8.52 15.8 8.75C15.93 8.98 16 9.24 16 9.5L16 19.5C16 19.76 15.93 20.02 15.8 20.25C15.67 20.48 15.48 20.67 15.25 20.8C15.02 20.93 14.76 21 14.5 21L4.5 21C4.24 21 3.98 20.93 3.75 20.8C3.52 20.67 3.33 20.48 3.2 20.25C3.07 20.02 3 19.76 3 19.5L3 9.5C3 9.24 3.07 8.98 3.2 8.75C3.33 8.52 3.52 8.33 3.75 8.2C3.98 8.07 4.24 8 4.5 8ZM7 4L18.5 4C18.94 4 19.37 4.12 19.75 4.33C20.13 4.55 20.45 4.87 20.67 5.25C20.88 5.63 21 6.06 21 6.5L21 17",
    "folder" to "M3 6.5C3 6.24 3.07 5.98 3.2 5.75C3.33 5.52 3.52 5.33 3.75 5.2C3.98 5.07 4.24 5 4.5 5L9 5L11 7L19.5 7C19.76 7 20.02 7.07 20.25 7.2C20.48 7.33 20.67 7.52 20.8 7.75C20.93 7.98 21 8.24 21 8.5L21 17.5C21 17.76 20.93 18.02 20.8 18.25C20.67 18.48 20.48 18.67 20.25 18.8C20.02 18.93 19.76 19 19.5 19L4.5 19C4.24 19 3.98 18.93 3.75 18.8C3.52 18.67 3.33 18.48 3.2 18.25C3.07 18.02 3 17.76 3 17.5Z",
    "genres" to "M4.5 3L8.5 3C8.76 3 9.02 3.07 9.25 3.2C9.48 3.33 9.67 3.52 9.8 3.75C9.93 3.98 10 4.24 10 4.5L10 8.5C10 8.76 9.93 9.02 9.8 9.25C9.67 9.48 9.48 9.67 9.25 9.8C9.02 9.93 8.76 10 8.5 10L4.5 10C4.24 10 3.98 9.93 3.75 9.8C3.52 9.67 3.33 9.48 3.2 9.25C3.07 9.02 3 8.76 3 8.5L3 4.5C3 4.24 3.07 3.98 3.2 3.75C3.33 3.52 3.52 3.33 3.75 3.2C3.98 3.07 4.24 3 4.5 3ZM15.5 3L19.5 3C19.76 3 20.02 3.07 20.25 3.2C20.48 3.33 20.67 3.52 20.8 3.75C20.93 3.98 21 4.24 21 4.5L21 8.5C21 8.76 20.93 9.02 20.8 9.25C20.67 9.48 20.48 9.67 20.25 9.8C20.02 9.93 19.76 10 19.5 10L15.5 10C15.24 10 14.98 9.93 14.75 9.8C14.52 9.67 14.33 9.48 14.2 9.25C14.07 9.02 14 8.76 14 8.5L14 4.5C14 4.24 14.07 3.98 14.2 3.75C14.33 3.52 14.52 3.33 14.75 3.2C14.98 3.07 15.24 3 15.5 3ZM4.5 14L8.5 14C8.76 14 9.02 14.07 9.25 14.2C9.48 14.33 9.67 14.52 9.8 14.75C9.93 14.98 10 15.24 10 15.5L10 19.5C10 19.76 9.93 20.02 9.8 20.25C9.67 20.48 9.48 20.67 9.25 20.8C9.02 20.93 8.76 21 8.5 21L4.5 21C4.24 21 3.98 20.93 3.75 20.8C3.52 20.67 3.33 20.48 3.2 20.25C3.07 20.02 3 19.76 3 19.5L3 15.5C3 15.24 3.07 14.98 3.2 14.75C3.33 14.52 3.52 14.33 3.75 14.2C3.98 14.07 4.24 14 4.5 14ZM15.5 14L19.5 14C19.76 14 20.02 14.07 20.25 14.2C20.48 14.33 20.67 14.52 20.8 14.75C20.93 14.98 21 15.24 21 15.5L21 19.5C21 19.76 20.93 20.02 20.8 20.25C20.67 20.48 20.48 20.67 20.25 20.8C20.02 20.93 19.76 21 19.5 21L15.5 21C15.24 21 14.98 20.93 14.75 20.8C14.52 20.67 14.33 20.48 14.2 20.25C14.07 20.02 14 19.76 14 19.5L14 15.5C14 15.24 14.07 14.98 14.2 14.75C14.33 14.52 14.52 14.33 14.75 14.2C14.98 14.07 15.24 14 15.5 14Z",
    "favorites" to "M12 20C12 20 5 15.5 5 10C5.01 9.35 5.17 8.72 5.48 8.15C5.78 7.58 6.22 7.1 6.75 6.74C7.29 6.37 7.9 6.15 8.54 6.07C9.18 6 9.83 6.08 10.43 6.31C11.04 6.54 11.57 6.92 12 7.4C12.43 6.92 12.96 6.54 13.57 6.31C14.17 6.08 14.82 6 15.46 6.07C16.1 6.15 16.71 6.37 17.25 6.74C17.78 7.1 18.22 7.58 18.52 8.15C18.83 8.72 18.99 9.35 19 10C19 15.5 12 20 12 20Z",
    "music" to "M9 18L9 5.5L20 3.5L20 16M9 18C9 18.44 8.88 18.87 8.67 19.25C8.45 19.63 8.13 19.95 7.75 20.17C7.37 20.38 6.94 20.5 6.5 20.5C6.06 20.5 5.63 20.38 5.25 20.17C4.87 19.95 4.55 19.63 4.33 19.25C4.12 18.87 4 18.44 4 18C4 17.56 4.12 17.13 4.33 16.75C4.55 16.37 4.87 16.05 5.25 15.83C5.63 15.62 6.06 15.5 6.5 15.5C6.94 15.5 7.37 15.62 7.75 15.83C8.13 16.05 8.45 16.37 8.67 16.75C8.88 17.13 9 17.56 9 18ZM20 16C20 16.44 19.88 16.87 19.67 17.25C19.45 17.63 19.13 17.95 18.75 18.17C18.37 18.38 17.94 18.5 17.5 18.5C17.06 18.5 16.63 18.38 16.25 18.17C15.87 17.95 15.55 17.63 15.33 17.25C15.12 16.87 15 16.44 15 16C15 15.56 15.12 15.13 15.33 14.75C15.55 14.37 15.87 14.05 16.25 13.83C16.63 13.62 17.06 13.5 17.5 13.5C17.94 13.5 18.37 13.62 18.75 13.83C19.13 14.05 19.45 14.37 19.67 14.75C19.88 15.13 20 15.56 20 16Z",
    "audiobooks" to "M4 13C4 11.6 4.37 10.22 5.07 9C5.77 7.78 6.78 6.77 8 6.07C9.22 5.37 10.6 5 12 5C13.4 5 14.78 5.37 16 6.07C17.22 6.77 18.23 7.78 18.93 9C19.63 10.22 20 11.6 20 13M5 13L6 13C6.26 13 6.52 13.07 6.75 13.2C6.98 13.33 7.17 13.52 7.3 13.75C7.43 13.98 7.5 14.24 7.5 14.5L7.5 18.5C7.5 18.76 7.43 19.02 7.3 19.25C7.17 19.48 6.98 19.67 6.75 19.8C6.52 19.93 6.26 20 6 20L5 20C4.74 20 4.48 19.93 4.25 19.8C4.02 19.67 3.83 19.48 3.7 19.25C3.57 19.02 3.5 18.76 3.5 18.5L3.5 14.5C3.5 14.24 3.57 13.98 3.7 13.75C3.83 13.52 4.02 13.33 4.25 13.2C4.48 13.07 4.74 13 5 13ZM18 13L19 13C19.26 13 19.52 13.07 19.75 13.2C19.98 13.33 20.17 13.52 20.3 13.75C20.43 13.98 20.5 14.24 20.5 14.5L20.5 18.5C20.5 18.76 20.43 19.02 20.3 19.25C20.17 19.48 19.98 19.67 19.75 19.8C19.52 19.93 19.26 20 19 20L18 20C17.74 20 17.48 19.93 17.25 19.8C17.02 19.67 16.83 19.48 16.7 19.25C16.57 19.02 16.5 18.76 16.5 18.5L16.5 14.5C16.5 14.24 16.57 13.98 16.7 13.75C16.83 13.52 17.02 13.33 17.25 13.2C17.48 13.07 17.74 13 18 13Z",
    "settings" to "M15 12C15 12.53 14.86 13.04 14.6 13.5C14.33 13.96 13.96 14.33 13.5 14.6C13.04 14.86 12.53 15 12 15C11.47 15 10.96 14.86 10.5 14.6C10.04 14.33 9.67 13.96 9.4 13.5C9.14 13.04 9 12.53 9 12C9 11.47 9.14 10.96 9.4 10.5C9.67 10.04 10.04 9.67 10.5 9.4C10.96 9.14 11.47 9 12 9C12.53 9 13.04 9.14 13.5 9.4C13.96 9.67 14.33 10.04 14.6 10.5C14.86 10.96 15 11.47 15 12ZM19.4 15C19.32 15.2 19.27 15.41 19.27 15.62C19.26 15.84 19.3 16.05 19.37 16.25C19.44 16.45 19.56 16.64 19.7 16.8L19.8 16.9C20.06 17.1 20.27 17.35 20.41 17.65C20.55 17.95 20.61 18.28 20.6 18.6C20.58 18.93 20.48 19.25 20.31 19.53C20.15 19.81 19.91 20.05 19.63 20.21C19.35 20.38 19.03 20.48 18.7 20.5C18.38 20.51 18.05 20.45 17.75 20.31C17.45 20.17 17.2 19.96 17 19.7L16.9 19.6C16.74 19.46 16.55 19.34 16.35 19.27C16.15 19.2 15.94 19.16 15.72 19.17C15.51 19.17 15.3 19.22 15.1 19.3C14.91 19.39 14.73 19.51 14.58 19.66C14.44 19.81 14.32 19.99 14.23 20.18C14.15 20.38 14.11 20.59 14.1 20.8L14.1 21C14.1 21.35 14.01 21.7 13.83 22C13.66 22.3 13.4 22.56 13.1 22.73C12.8 22.91 12.45 23 12.1 23C11.75 23 11.4 22.91 11.1 22.73C10.8 22.56 10.54 22.3 10.37 22C10.19 21.7 10.1 21.35 10.1 21L10.1 20.9C10.09 20.68 10.03 20.47 9.94 20.27C9.85 20.07 9.72 19.89 9.56 19.74C9.39 19.59 9.21 19.48 9 19.4C8.8 19.32 8.59 19.27 8.38 19.27C8.16 19.26 7.95 19.3 7.75 19.37C7.55 19.44 7.36 19.56 7.2 19.7L7.1 19.8C6.9 20.06 6.65 20.27 6.35 20.41C6.05 20.55 5.72 20.61 5.4 20.6C5.07 20.58 4.75 20.48 4.47 20.31C4.19 20.15 3.95 19.91 3.79 19.63C3.62 19.35 3.52 19.03 3.5 18.7C3.49 18.38 3.55 18.05 3.69 17.75C3.83 17.45 4.04 17.2 4.3 17L4.4 16.9C4.54 16.74 4.66 16.55 4.73 16.35C4.8 16.15 4.84 15.94 4.83 15.72C4.83 15.51 4.78 15.3 4.7 15.1C4.61 14.91 4.49 14.73 4.34 14.58C4.19 14.44 4.01 14.32 3.82 14.23C3.62 14.15 3.41 14.11 3.2 14.1L3 14.1C2.65 14.1 2.3 14.01 2 13.83C1.7 13.66 1.44 13.4 1.27 13.1C1.09 12.8 1 12.45 1 12.1C1 11.75 1.09 11.4 1.27 11.1C1.44 10.8 1.7 10.54 2 10.37C2.3 10.19 2.65 10.1 3 10.1L3.1 10.1C3.32 10.09 3.53 10.03 3.73 9.94C3.93 9.85 4.11 9.72 4.26 9.56C4.41 9.39 4.52 9.21 4.6 9C4.68 8.8 4.73 8.59 4.73 8.38C4.74 8.16 4.7 7.95 4.63 7.75C4.56 7.55 4.44 7.36 4.3 7.2L4.2 7.1C3.94 6.9 3.73 6.65 3.59 6.35C3.45 6.05 3.39 5.72 3.4 5.4C3.42 5.07 3.52 4.75 3.69 4.47C3.85 4.19 4.09 3.95 4.37 3.79C4.65 3.62 4.97 3.52 5.3 3.5C5.62 3.49 5.95 3.55 6.25 3.69C6.55 3.83 6.8 4.04 7 4.3L7.1 4.4C7.26 4.54 7.45 4.66 7.65 4.73C7.85 4.8 8.06 4.84 8.28 4.83C8.49 4.83 8.7 4.78 8.9 4.7L9 4.7C9.19 4.61 9.37 4.49 9.52 4.34C9.66 4.19 9.78 4.01 9.87 3.82C9.95 3.62 9.99 3.41 10 3.2L10 3C10 2.65 10.09 2.3 10.27 2C10.44 1.7 10.7 1.44 11 1.27C11.3 1.09 11.65 1 12 1C12.35 1 12.7 1.09 13 1.27C13.3 1.44 13.56 1.7 13.73 2C13.91 2.3 14 2.65 14 3L14 3.1C14.01 3.31 14.05 3.52 14.13 3.72C14.22 3.91 14.34 4.09 14.48 4.24C14.63 4.39 14.81 4.51 15 4.6C15.2 4.68 15.41 4.73 15.62 4.73C15.84 4.74 16.05 4.7 16.25 4.63C16.45 4.56 16.64 4.44 16.8 4.3L16.9 4.2C17.1 3.94 17.35 3.73 17.65 3.59C17.95 3.45 18.28 3.39 18.6 3.4C18.93 3.42 19.25 3.52 19.53 3.69C19.81 3.85 20.05 4.09 20.21 4.37C20.38 4.65 20.48 4.97 20.5 5.3C20.51 5.62 20.45 5.95 20.31 6.25C20.17 6.55 19.96 6.8 19.7 7L19.6 7.1C19.46 7.26 19.34 7.45 19.27 7.65C19.2 7.85 19.16 8.06 19.17 8.28C19.17 8.49 19.22 8.7 19.3 8.9L19.3 9C19.39 9.19 19.51 9.37 19.66 9.52C19.81 9.66 19.99 9.78 20.18 9.87C20.38 9.95 20.59 9.99 20.8 10L21 10C21.35 10 21.7 10.09 22 10.27C22.3 10.44 22.56 10.7 22.73 11C22.91 11.3 23 11.65 23 12C23 12.35 22.91 12.7 22.73 13C22.56 13.3 22.3 13.56 22 13.73C21.7 13.91 21.35 14 21 14L20.9 14C20.69 14.01 20.48 14.05 20.28 14.13C20.09 14.22 19.91 14.34 19.76 14.48C19.61 14.63 19.49 14.81 19.4 15Z",
    "play" to "M8 5L8 19L19 12Z",
    "updown" to "M7 9L12 4L17 9M7 15L12 20L17 15",
    "stats" to "M4 20L20 20M6.5 16.5L6.5 11M11 16.5L11 6M15.5 16.5L15.5 9M20 16.5L20 13",
    "check" to "M5 12.5L9.5 17L19 7.5",
    "edit" to "M4 7L14 7M4 12L20 12M4 17L11 17M19 7C19 7.35 18.91 7.7 18.73 8C18.56 8.3 18.3 8.56 18 8.73C17.7 8.91 17.35 9 17 9C16.65 9 16.3 8.91 16 8.73C15.7 8.56 15.44 8.3 15.27 8C15.09 7.7 15 7.35 15 7C15 6.65 15.09 6.3 15.27 6C15.44 5.7 15.7 5.44 16 5.27C16.3 5.09 16.65 5 17 5C17.35 5 17.7 5.09 18 5.27C18.3 5.44 18.56 5.7 18.73 6C18.91 6.3 19 6.65 19 7ZM16 17C16 17.35 15.91 17.7 15.73 18C15.56 18.3 15.3 18.56 15 18.73C14.7 18.91 14.35 19 14 19C13.65 19 13.3 18.91 13 18.73C12.7 18.56 12.44 18.3 12.27 18C12.09 17.7 12 17.35 12 17C12 16.65 12.09 16.3 12.27 16C12.44 15.7 12.7 15.44 13 15.27C13.3 15.09 13.65 15 14 15C14.35 15 14.7 15.09 15 15.27C15.3 15.44 15.56 15.7 15.73 16C15.91 16.3 16 16.65 16 17Z",
  )
  private val cache = HashMap<String, Path>()
  fun path(name: String): Path = cache.getOrPut(name) { parse(DATA[name] ?: DATA.getValue("folder")) }

  /** Draw an icon `size` units wide with its top-left corner at x, y. */
  fun draw(c: Canvas, name: String, x: Float, y: Float, size: Float, p: Paint) {
    val k = size / 24f
    val sw = p.strokeWidth
    c.save(); c.translate(x, y); c.scale(k, k)
    if (p.style != Paint.Style.FILL) p.strokeWidth = sw / k
    c.drawPath(path(name), p)
    p.strokeWidth = sw
    c.restore()
  }

  /** Draw any 24 x 24 path `size` units wide with its top-left corner at x, y. */
  fun drawPath(c: Canvas, path: Path, x: Float, y: Float, size: Float, p: Paint) {
    val k = size / 24f
    val sw = p.strokeWidth
    c.save(); c.translate(x, y); c.scale(k, k)
    if (p.style != Paint.Style.FILL) p.strokeWidth = sw / k
    c.drawPath(path, p)
    p.strokeWidth = sw
    c.restore()
  }

  // Only M, L, C and Z with absolute numbers (the icons are converted to that when they are added).
  private fun parse(d: String): Path {
    val p = Path()
    var i = 0
    val n = d.length
    val num = FloatArray(6)
    fun read(count: Int) {
      for (k in 0 until count) {
        while (i < n && (d[i] == ' ' || d[i] == ',')) i++
        val s = i
        if (i < n && (d[i] == '-' || d[i] == '+')) i++
        while (i < n && (d[i].isDigit() || d[i] == '.')) i++
        num[k] = d.substring(s, i).toFloat()
      }
    }
    while (i < n) {
      when (d[i++]) {
        'M' -> { read(2); p.moveTo(num[0], num[1]) }
        'L' -> { read(2); p.lineTo(num[0], num[1]) }
        'C' -> { read(6); p.cubicTo(num[0], num[1], num[2], num[3], num[4], num[5]) }
        'Z' -> p.close()
        else -> {}
      }
    }
    return p
  }
}
