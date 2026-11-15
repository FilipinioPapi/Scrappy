package app.scrappy.player.tv

import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Path
import android.graphics.RectF
import android.os.SystemClock
import android.view.KeyEvent
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/**
 * The native pop-ups drawn over a screen (approved mock "Hold-OK menu and Sort / Show / Genre lists"):
 *  - the quick menu you get by holding OK on a poster, beside the poster you held;
 *  - pick lists (Sort, Show, Genre, Seasons, audio/subtitle pickers) in the middle of the screen, a tick on the one in use.
 * While one is open it takes the remote.
 */
class Menu(private val tv: TvView) {
  private class Row(val label: String, val act: String, val icon: String, val on: Boolean = false)

  private var kind = ""        // "", "hold", "pick"
  val open get() = kind.isNotEmpty()
  private var title = ""
  private var meta = ""
  private var rows: List<Row> = emptyList()
  private var idx = 0
  private var cur = -1
  private var done: ((Int) -> Unit)? = null
  private var item: JSONObject? = null
  private var inResume = false
  private var heldCard: Card? = null
  private val heldAt = RectF()
  private var hasRect = false
  private var openedAt = 0L
  private var closing = 0L
  private var okArmed = false

  // ---------- where the held poster is (CardArt reports the focused card as it draws) ----------
  companion object {
    var focusCard: Card? = null; private set
    val focusRect = RectF()
    private var focusAt = 0L
    private val m = Matrix()
    private val tmp = RectF()
    /** Called by CardArt while drawing a focused card at (x, y) in the canvas's current units. */
    fun noteFocus(c: Canvas, card: Card, x: Float, y: Float) {
      @Suppress("DEPRECATION") c.getMatrix(m)
      tmp.set(x, y, x + card.shape.w, y + card.shape.h)
      m.mapRect(tmp)
      val k = Ui.W / max(1, c.width).toFloat()
      focusRect.set(tmp.left * k, tmp.top * k, tmp.right * k, tmp.bottom * k)
      focusCard = card; focusAt = SystemClock.uptimeMillis()
    }
  }

  // ---------- opening ----------
  fun pick(t: String, options: List<String>, current: Int, then: (Int) -> Unit) {
    done?.invoke(-1)
    kind = "pick"; title = t; cur = current; done = then; item = null
    rows = options.mapIndexed { i, o -> Row(o, i.toString(), "", i == current) }
    idx = current.coerceIn(0, max(0, rows.size - 1))
    start()
  }

  fun hold(id: String, resume: Boolean) {
    val fc = focusCard
    hasRect = fc != null && fc.id == id && SystemClock.uptimeMillis() - focusAt < 1500
    heldCard = if (hasRect) fc else null
    if (hasRect) heldAt.set(focusRect)
    inResume = resume
    Net.get("/Users/{userId}/Items/${Card.enc(id)}?Fields=UserData") { v ->
      val it = v as? JSONObject
      if (it == null) { tv.host.toast("Couldn't load that. Try again in a moment.", true); return@get }
      showHold(it)
    }
  }

  internal fun showHold(it: JSONObject) {
    done?.invoke(-1); done = null
    item = it; kind = "hold"
    build(it)
    idx = 0
    start()
  }

  private fun build(it: JSONObject) {
    val type = it.optString("Type")
    val ud = it.optJSONObject("UserData") ?: JSONObject()
    val playable = type in Card.PLAYABLE || type in setOf("Series", "Season", "BoxSet")
    val video = type in Card.PLAYABLE
    val resumable = video && ud.optLong("PlaybackPositionTicks") > 0
    val played = ud.optBoolean("Played"); val fav = ud.optBoolean("IsFavorite")
    title = if (type == "Episode") it.optString("SeriesName").ifEmpty { it.optString("Name") } else it.optString("Name")
    val bits = ArrayList<String>()
    if (type == "Episode") { bits.add(listOf(Card.epCode(it), it.optString("Name")).filter { s -> s.isNotEmpty() }.joinToString(" · ")) }
    else if (it.optInt("ProductionYear") > 0) bits.add(it.optInt("ProductionYear").toString())
    if (type != "Episode" && video) Card.runtime(it.optLong("RunTimeTicks")).takeIf { s -> s.isNotEmpty() }?.let { s -> bits.add(s) }
    if (played) bits.add("Watched") else if (resumable) bits.add("${ud.optDouble("PlayedPercentage", 0.0).toInt().coerceAtLeast(1)}% watched")
    else if (ud.optInt("UnplayedItemCount") > 0) bits.add("${ud.optInt("UnplayedItemCount")} to watch")
    meta = bits.joinToString(" · ")
    val out = ArrayList<Row>()
    if (type == "Person") out.add(Row("See everything they're in", "details", "grid"))
    else {
      if (playable) out.add(Row(if (resumable) "Resume" else if (played) "Play again" else "Play", "play", "play"))
      if (resumable) out.add(Row("Play from start", "restart", "restart"))
      out.add(Row(if (fav) "Remove from Favorites" else "Add to Favorites", "fav", "heart", fav))
      out.add(Row(if (played) "Mark unwatched" else "Mark watched", "played", "check", played))
      if (inResume) out.add(Row("Remove from Continue Watching", "unresume", "remove"))
      out.add(Row("Open details", "details", "info"))
    }
    rows = out
  }

  private fun start() { openedAt = SystemClock.uptimeMillis(); closing = 0L; okArmed = false; tv.invalidate() }

  private fun close() { kind = ""; closing = SystemClock.uptimeMillis(); val d = done; done = null; d?.invoke(-1); tv.invalidate() }

  private fun choose() {
    val r = rows.getOrNull(idx) ?: return
    if (kind == "pick") { val d = done; done = null; kind = ""; closing = SystemClock.uptimeMillis(); d?.invoke(idx); tv.invalidate(); return }
    val it = item ?: return
    val id = it.optString("Id"); val type = it.optString("Type")
    kind = ""; closing = SystemClock.uptimeMillis(); tv.invalidate()
    when (r.act) {
      "play" -> when (type) {
        "Series" -> tv.host.playSeries(id)
        "Season" -> tv.host.playSeries(it.optString("SeriesId").ifEmpty { id })
        else -> tv.host.playFrom(id, false)
      }
      "restart" -> tv.host.playFrom(id, true)
      "fav", "played", "unresume" -> tv.host.holdAct(id, r.act)
      "details" -> { if (type.isNotEmpty()) TvView.kinds[id] = type; tv.host.go(if (type == "Person") "#/person/${Card.enc(id)}" else "#/item/${Card.enc(id)}") }
    }
  }

  // ---------- keys ----------
  /** All keys while open. OK acts on release (the press that opened a hold menu is still down). */
  fun key(e: KeyEvent): Boolean {
    if (!open) return false
    val down = e.action == KeyEvent.ACTION_DOWN
    when (e.keyCode) {
      KeyEvent.KEYCODE_DPAD_UP -> if (down) idx = max(0, idx - 1)
      KeyEvent.KEYCODE_DPAD_DOWN -> if (down) idx = min(rows.size - 1, idx + 1)
      KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT -> {}
      KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> {
        if (down && e.repeatCount == 0) okArmed = true
        else if (!down && okArmed) { okArmed = false; choose() }
      }
      KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> if (!down) close()
      else -> return false
    }
    tv.invalidate()
    return true
  }

  // ---------- drawing ----------
  private val pTitle = Ui.text(Ui.f800, 26f, Ui.TEXT)
  private val pMeta = Ui.text(Ui.f500, 18f, Ui.MUTED)
  private val pRow = Ui.text(Ui.f600, 22f, Ui.TEXT)
  private val fill = Ui.fill(0)
  private val line = Ui.stroke(Ui.LINE, 1.5f)
  private val icon = Ui.stroke(Ui.TEXT, 2.2f)
  private val iconFill = Ui.fill(Ui.TEXT)
  private val r = RectF()
  private val P_RESTART = Path().apply { addArc(RectF(5f, 5f, 19f, 19f), -150f, 290f); moveTo(4.5f, 4.5f); lineTo(5.6f, 8.9f); lineTo(10f, 8f) }
  private val P_INFO = Path().apply { addCircle(12f, 12f, 8.5f, Path.Direction.CW); moveTo(12f, 11f); lineTo(12f, 16.5f); moveTo(12f, 7.6f); lineTo(12f, 7.7f) }
  private val P_REMOVE = Path().apply { addCircle(12f, 12f, 8.5f, Path.Direction.CW); moveTo(8f, 12f); lineTo(16f, 12f) }
  private val P_UP = Path().apply { moveTo(6f, 15f); lineTo(12f, 9f); lineTo(18f, 15f) }
  private val P_DOWN = Path().apply { moveTo(6f, 9f); lineTo(12f, 15f); lineTo(18f, 9f) }

  /** Returns true while animating. */
  fun draw(c: Canvas, now: Long): Boolean {
    if (!open) return false
    val k = Ui.ease(((now - openedAt) / 160f).coerceIn(0f, 1f))
    // Dim what's behind.
    fill.color = Ui.alpha(0x8C080505.toInt(), k); c.drawRect(0f, 0f, Ui.W, Ui.H, fill)
    if (kind == "hold") drawHold(c, now, k) else drawPick(c, k)
    return k < 1f
  }

  private fun panel(c: Canvas, a: Float) {
    fill.color = Ui.alpha(0xFA1E1415.toInt(), a); c.drawRoundRect(r, 22f, 22f, fill)
    line.color = Ui.alpha(Ui.LINE, a); c.drawRoundRect(r, 22f, 22f, line)
  }

  private fun drawRow(c: Canvas, row: Row, left: Float, right: Float, y: Float, foc: Boolean, a: Float, tickRight: Boolean) {
    r.set(left + 12f, y, right - 12f, y + 62f)
    if (foc) { fill.color = Ui.alpha(Ui.WHITE, a); c.drawRoundRect(r, 12f, 12f, fill) }
    val col = if (foc) 0xFF1A0F10.toInt() else Ui.TEXT
    var x = left + 30f
    if (!tickRight) {
      val ic = Ui.alpha(if (row.on) Ui.RED else col, a)
      icon.color = ic; iconFill.color = ic; icon.strokeWidth = 2.2f
      when (row.icon) {
        "play" -> Icons.drawPath(c, Icons.path("play"), x, y + 18f, 26f, iconFill)
        "heart" -> Icons.drawPath(c, Icons.path("favorites"), x, y + 18f, 26f, if (row.on) iconFill else icon)
        "check" -> { icon.strokeWidth = 2.8f; Icons.drawPath(c, Icons.path("check"), x, y + 18f, 26f, icon) }
        "restart" -> Icons.drawPath(c, P_RESTART, x, y + 18f, 26f, icon)
        "info" -> Icons.drawPath(c, P_INFO, x, y + 18f, 26f, icon)
        "remove" -> Icons.drawPath(c, P_REMOVE, x, y + 18f, 26f, icon)
        "grid" -> Icons.drawPath(c, Icons.path("genres"), x, y + 18f, 26f, icon)
      }
      x += 44f
    }
    pRow.color = Ui.alpha(col, a)
    Ui.line(c, Ui.fit(row.label, pRow, right - 30f - x - (if (tickRight) 40f else 0f)), x, y, 62f, pRow)
    if (tickRight && row.on) { icon.color = Ui.alpha(Ui.RED, a); icon.strokeWidth = 2.8f; Icons.drawPath(c, Icons.path("check"), right - 30f - 26f, y + 18f, 26f, icon) }
  }

  private fun drawHold(c: Canvas, now: Long, a: Float) {
    // The poster you held stays lit above the dimming.
    val card = heldCard
    if (hasRect && card != null) { card.f = 1f; CardArt.draw(c, card, heldAt.left, heldAt.top, now, true, text = false) }
    val w = 480f
    val h = 18f + 36f + (if (meta.isNotEmpty()) 28f else 0f) + 14f + rows.size * 66f - 4f + 12f
    val left: Float; val top: Float
    if (hasRect) {
      left = if (heldAt.right + 30f + w <= Ui.W - 40f) heldAt.right + 30f else max(40f, heldAt.left - 30f - w)
      top = (heldAt.top - 10f).coerceIn(40f, Ui.H - 40f - h)
    } else { left = (Ui.W - w) / 2f; top = (Ui.H - h) / 2f }
    val dx = (1f - a) * (if (hasRect && left < heldAt.left) 14f else -14f)
    r.set(left + dx, top, left + dx + w, top + h); panel(c, a)
    var y = top + 18f
    pTitle.alpha = (255 * a).toInt(); pMeta.alpha = (255 * a).toInt()
    Ui.line(c, Ui.fit(title, pTitle, w - 56f), left + dx + 28f, y, 36f, pTitle); y += 36f
    if (meta.isNotEmpty()) { Ui.line(c, Ui.fit(meta, pMeta, w - 56f), left + dx + 28f, y, 28f, pMeta); y += 28f }
    y += 14f
    rows.forEachIndexed { i, row -> drawRow(c, row, left + dx, left + dx + w, y, i == idx, a, false); y += 66f }
  }

  private fun drawPick(c: Canvas, a: Float) {
    val win = 8
    val start = max(0, min(rows.size - win, idx - 3))
    val shown = min(win, rows.size)
    val up = start > 0; val dn = start + win < rows.size
    val w = 500f
    val h = 22f + 38f + 12f + (if (up) 22f else 0f) + shown * 66f - 4f + (if (dn) 22f else 0f) + 14f
    val left = (Ui.W - w) / 2f
    val top = (Ui.H - h) / 2f + (1f - a) * 16f
    r.set(left, top, left + w, top + h); panel(c, a)
    var y = top + 22f
    pTitle.alpha = (255 * a).toInt()
    Ui.line(c, Ui.fit(title, pTitle, w - 60f), left + 30f, y, 38f, pTitle); y += 38f + 12f
    icon.color = Ui.alpha(Ui.MUTED, a); icon.strokeWidth = 2f
    if (up) { Icons.drawPath(c, P_UP, left + w / 2f - 11f, y, 22f, icon); y += 22f }
    for (i in start until min(rows.size, start + win)) { drawRow(c, rows[i], left, left + w, y, i == idx, a, true); y += 66f }
    y -= 4f
    if (dn) { icon.color = Ui.alpha(Ui.MUTED, a); icon.strokeWidth = 2f; Icons.drawPath(c, P_DOWN, left + w / 2f - 11f, y, 22f, icon) }
  }
}
