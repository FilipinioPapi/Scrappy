package app.scrappy.player.tv

import android.content.Context
import android.graphics.Canvas
import android.os.SystemClock
import android.view.KeyEvent
import org.json.JSONObject
import android.view.View
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.sign

/** What the native screens ask of the rest of the app (the web side keeps history, the player, menus). */
interface Host {
  fun go(hash: String)
  fun back()
  fun play(id: String)
  fun playSeries(id: String)
  fun hold(id: String, inResume: Boolean)
  fun editHome(rowsJson: String)
  /** Keep Home's row order and hidden rows ("" = back to default). */
  fun saveHomeRows(json: String) {}
  /** A button on the update card: go, again, install, cancel, later (tvupdate.js does the work). */
  fun updAct(act: String) {}
  fun who()
  fun log(msg: String) {}
  fun pick(title: String, options: List<String>, cur: Int, done: (Int) -> Unit)
  fun saveSort(key: String, i: Int)
  fun playFrom(id: String, fromStart: Boolean)
  fun playSeriesFrom(id: String, fromStart: Boolean)
  fun toast(msg: String, error: Boolean)
  /** Watched / favourites changed: everything that shows them fetches again. */
  fun changed()
  /** A value the web side keeps (localStorage). */
  fun local(key: String, done: (String?) -> Unit)
  fun setLocal(key: String, value: String)
  /** Swap the address without a new history step (go = true: open it too). */
  fun replace(hash: String, go: Boolean)
  /** This address turned out not to be a native screen: let the web side draw it. */
  fun reroute()
  /** Find more subtitles for this video (the web side's dialog). */
  fun subtitles(id: String)
  /** Search every signed-in server (the web side's search), answered as sections to draw. */
  fun search(text: String, done: (JSONObject?) -> Unit)
  /** The TV keyboard (with voice) for a text box: change = each edit, done = Search/Done (null = closed with Back). */
  fun keyboard(text: String, change: (String) -> Unit, done: (String?) -> Unit)
  /** Favourite / watched / leave Continue Watching for an item (the web side does it and tells every screen). */
  fun holdAct(id: String, act: String) {}
  /** Play these films one after another (a collection's Play all / Shuffle). */
  fun playQueue(ids: List<String>) {}
  /** Who's watching: ask the web side to switch / add / change a PIN / remove / set "ask when it opens" (answer: {ok, err, data, reload}). */
  fun whoAct(act: String, args: JSONObject, done: (JSONObject?) -> Unit) {}
  /** Who's watching closed. */
  fun whoClosed() {}
  /** Settings: read the rows / change a setting / run a button (tvsettings.js act()). */
  fun setAct(act: String, args: JSONObject, done: (JSONObject?) -> Unit) {}
  /** Sign-in: check an address, sign in, skip, open (tvsignact.js). */
  fun signAct(act: String, args: JSONObject, done: (JSONObject?) -> Unit) {}
  /** The Movies & TV stats, all time (stats.js tvNativeStats). */
  fun stats(done: (JSONObject?) -> Unit) {}
  /** The TV keyboard for a sign-in box: mode = url, user or password. */
  fun field(text: String, mode: String, change: (String) -> Unit, done: (String?) -> Unit) = keyboard(text, change, done)
}

/** One glide per scroller, the same feel as the web screens (tv.js glideTo), in 1080p units. */
class Glide(var pos: Float = 0f) {
  var to = pos; private var v = 0f; var moving = false; private set
  fun set(target: Float, instant: Boolean = false) {
    to = target
    if (instant) { pos = target; moving = false; v = 0f; return }
    if (!moving && abs(pos - to) >= 1f) { moving = true; v = 0f }
  }
  fun shift(d: Float) { pos += d; to += d }
  /** Advance by dt ms. Returns true while still moving. */
  fun step(dt: Float): Boolean {
    if (!moving) return false
    val far = abs(to - pos)
    var d = (to - pos) * (1f - exp(-dt / (if (far > 427f) 130f else 85f)))
    val cap = v + 0.733f * dt
    if (abs(d) > cap) d = sign(d) * cap
    v = abs(d)
    pos += d
    if (abs(to - pos) < 0.8f) { pos = to; moving = false; v = 0f }
    return moving
  }
}

/** A native screen drawn inside TvView (Home, a library grid). Coordinates are 1080p units. */
abstract class Screen(val tv: TvView) {
  /** Draw; return true while something is still animating. */
  abstract fun draw(c: Canvas, now: Long, dt: Float): Boolean
  /** Arrow / OK presses. Returns true if handled. Left at the start opens the rail (return false). */
  abstract fun key(k: Int): Boolean
  open fun ok() {}
  open fun hold() {}
  open fun show(fresh: Boolean) {}
  open fun hide() {}
  /** The vertical glide still to go, for pacing held presses. */
  open fun behind(): Float = 0f
  /** Data changed elsewhere (watched, favourite, after playing): fetch again. */
  open fun stale() {}
  open val railKey: String = "home"
  /** A screen of its own with no side rail (sign-in). */
  open val bare: Boolean = false
  /** Back: return true if the screen handled it (e.g. stepping out of a list), else the page goes back. */
  open fun back(): Boolean = false
}

/** The single native view: draws the current native screen and the side rail, takes the remote's keys. */
class TvView(ctx: Context, val host: Host) : View(ctx) {
  var screen: Screen? = null; private set
  // Fonts first: the side rail's paints are made right below and keep whatever font exists then.
  init { Ui.init(ctx) }
  val rail = Rail(this)
  /** The hold-OK quick menu and the pick lists, drawn over the screen. */
  val menu = Menu(this)
  val who = Who(this)
  /** Edit home, drawn over Home. */
  val edit = EditHome(this)
  /** The update prompt, drawn over everything. */
  val upd = UpdateCard(this)
  private var last = 0L
  /** Holding a direction or tapping fast: pictures appear at once, no fades (tv-fast on the web). */
  var fast = false; private set
  private var lastArrow = 0L
  private var lastMove = 0L
  private var moveCost = 0f
  var routeHash = ""

  init {
    Ui.init(ctx)
    Net.init(ctx)
    Img.init(ctx)
    Img.onLoaded = { invalidate() }
    setBackgroundColor(Ui.BG)
    // Holds the remote's focus while a native screen has it (keys reach onKey from the activity).
    isFocusable = true
    isFocusableInTouchMode = true
    if (android.os.Build.VERSION.SDK_INT >= 26) defaultFocusHighlightEnabled = false
  }

  companion object {
    /** Item id -> Emby type, as far as the native screens know (decides which pages are native). */
    val kinds = HashMap<String, String>()
    private val NATIVE_TYPES = setOf("Movie", "Series", "Season", "Episode", "BoxSet")
  }

  private val screens = LinkedHashMap<String, Screen>(16, 0.75f, true)
  fun home(): Home = screens.getOrPut("home") { Home(this) } as Home
  fun grid(id: String, genre: String): Grid = screens.getOrPut("lib/$id/$genre") { Grid(this, id, genre) } as Grid
  fun genres(): Genres = screens.getOrPut("genres") { Genres(this) } as Genres
  fun search(): Search = screens.getOrPut("search") { Search(this) } as Search
  fun signin(): Signin = screens.getOrPut("signin") { Signin(this) } as Signin
  fun favs(): Favs = screens.getOrPut("favorites") { Favs(this) } as Favs
  fun person(id: String): Person {
    val d = screens.getOrPut("person/$id") { Person(this, id) } as Person
    val ps = screens.keys.filter { it.startsWith("person/") }
    if (ps.size > 3) for (k in ps.take(ps.size - 3)) if (screens[k] !== screen && screens[k] !== d) screens.remove(k)
    return d
  }
  fun detail(id: String): Detail {
    val d = screens.getOrPut("item/$id") { Detail(this, id) } as Detail
    // Keep the last few title pages for Back; older ones are let go (memory is short on a TV).
    val items = screens.keys.filter { it.startsWith("item/") }
    if (items.size > 6) for (k in items.take(items.size - 6)) if (screens[k] !== screen && screens[k] !== d) screens.remove(k)
    return d
  }

  /** Before playing straight from a menu (banner, Continue watching, hold-OK...): go to the item's own page
   *  (the show's page for an episode), so Back from the player lands there instead of on Home. */
  fun pageFirst(it: JSONObject) {
    val type = it.optString("Type"); val series = it.optString("SeriesId")
    val id = if ((type == "Episode" || type == "Season") && series.isNotEmpty()) series else it.optString("Id")
    if (id.isEmpty()) return
    kinds[id] = if (id == series) "Series" else type
    val h = "#/item/" + Card.enc(id)
    if (routeHash.substringBefore('?') != h) host.go(h)
  }

  /** Open a poster: its page (native when it is a film or show), noting what kind of item it is. */
  fun open(c: Card) { if (c.type.isNotEmpty()) kinds[c.id] = c.type; host.go(c.href) }

  /** Show a native screen for this address, or return false if it is not one of ours. */
  fun route(hash: String): Boolean {
    val s = screenFor(hash) ?: return false
    routeHash = hash
    if (Net.reload()) { screens.clear(); Img.clearMemory(); rail.reset() }
    val target = screenFor(hash)!!
    val fresh = target !== screen
    screen?.let { if (it !== target) it.hide() }
    screen = target
    rail.open = false
    target.show(fresh)
    if (target.railKey.isNotEmpty()) rail.mark(target.railKey)
    invalidate()
    return true
  }

  private fun screenFor(hash: String): Screen? {
    val h = hash.substringBefore('?')
    if (h == "" || h == "#" || h == "#/" || h == "#/home") return home()
    val p = h.split('/')
    if (p.size >= 3 && p[1] == "library" && p[2].isNotEmpty()) return grid(java.net.URLDecoder.decode(p[2], "UTF-8"), if (p.size > 3) java.net.URLDecoder.decode(p[3], "UTF-8") else "")
    if (isItem(p)) return detail(java.net.URLDecoder.decode(p[2], "UTF-8"))
    if (h == "#/genres") return genres()
    if (h == "#/favorites") return favs()
    if (h == "#/search") return search()
    if (p.size in 2..3 && p[1] == "settings") return screens.getOrPut("settings") { Settings(this) }
    if (h == "#/login" || (p.size == 3 && p[1] == "servers")) return signin()
    if (h == "#/stats") return screens.getOrPut("stats") { Stats(this) }
    if (p.size == 3 && p[1] == "person" && p[2].isNotEmpty()) return person(java.net.URLDecoder.decode(p[2], "UTF-8"))
    return null
  }

  fun isNative(hash: String): Boolean {
    val h = hash.substringBefore('?')
    if (h == "" || h == "#" || h == "#/" || h == "#/home") return true
    val p = h.split('/')
    return (p.size in 3..4 && p[1] == "library" && p[2].isNotEmpty()) || isItem(p) || h == "#/genres" || h == "#/favorites" || h == "#/search" || (p.size in 2..3 && p[1] == "settings") || h == "#/login" || (p.size == 3 && p[1] == "servers") || h == "#/stats" ||
      (p.size == 3 && p[1] == "person" && p[2].isNotEmpty())
  }

  private fun isItem(p: List<String>): Boolean {
    if (p.size !in 3..4 || p[1] != "item" || p[2].isEmpty()) return false
    val k = kinds[java.net.URLDecoder.decode(p[2], "UTF-8")]
    return k == null || k in NATIVE_TYPES
  }

  fun leave() { screen?.hide(); screen = null; rail.open = false }

  fun stale() { for (s in screens.values) s.stale(); invalidate() }

  override fun onDraw(c: Canvas) {
    val now = SystemClock.uptimeMillis()
    val dt = if (last == 0L) 16f else (now - last).coerceIn(1, 64).toFloat()
    last = now
    if (fast && now - lastArrow > 420) fast = false
    c.save()
    c.scale(width / Ui.W, height / Ui.H)
    var anim = screen?.draw(c, now, dt) ?: false.also { c.drawColor(Ui.BG) }
    if (screen != null && screen?.bare != true) anim = rail.draw(c, now, dt) || anim
    anim = who.draw(c, now) || anim
    anim = edit.draw(c, now) || anim
    anim = menu.draw(c, now) || anim
    anim = upd.draw(c, now) || anim
    anim = drawExit(c, now) || anim
    c.restore()
    if (anim || fast) postInvalidateOnAnimation() else last = 0L
  }

  // ---------- "Press Back again to leave Scrappy" ----------
  private var exitAt = 0L
  private val EXIT_MS = 2500L
  private val exitBg = Ui.fill(0xF51E1415.toInt())
  private val exitLine = Ui.stroke(Ui.LINE, 1.5f)
  private val exitDot = Ui.fill(0xFF2C1C1D.toInt())
  private val exitIcon = Ui.stroke(Ui.TEXT, 2.2f)
  private val exitP = Ui.text(Ui.f600, 26f, Ui.TEXT)
  private val exitB = Ui.text(Ui.f800, 26f, Ui.TEXT)
  private val exitR = android.graphics.RectF()
  private val exitPath = android.graphics.Path().apply { moveTo(9f, 14f); lineTo(4f, 9f); lineTo(9f, 4f); moveTo(4f, 9f); lineTo(14.5f, 9f); cubicTo(17.5f, 9f, 20f, 11.5f, 20f, 14.5f); cubicTo(20f, 17.5f, 17.5f, 20f, 14.5f, 20f); lineTo(11f, 20f) }
  private fun drawExit(c: Canvas, now: Long): Boolean {
    if (exitAt == 0L) return false
    val t = now - exitAt
    if (t >= EXIT_MS + 200) { exitAt = 0L; return false }
    val a = Ui.ease(if (t < 200) t / 200f else if (t > EXIT_MS) 1f - (t - EXIT_MS) / 200f else 1f)
    val p1 = "Press "; val p2 = "Back"; val p3 = " again to leave Scrappy"
    val tw = exitP.measureText(p1) + exitB.measureText(p2) + exitP.measureText(p3)
    val w = 18f + 44f + 16f + tw + 34f
    val x = (Ui.W - w) / 2f; val y = Ui.H - 64f - 72f + (1f - a) * 16f
    c.saveLayerAlpha(x - 40f, y - 40f, x + w + 40f, y + 112f, (255 * a).toInt())
    exitR.set(x, y, x + w, y + 72f); c.drawRoundRect(exitR, 36f, 36f, exitBg); c.drawRoundRect(exitR, 36f, 36f, exitLine)
    c.drawCircle(x + 18f + 22f, y + 36f, 22f, exitDot)
    c.save(); c.translate(x + 18f + 10f, y + 24f); c.drawPath(exitPath, exitIcon); c.restore()
    var tx = x + 18f + 44f + 16f
    Ui.line(c, p1, tx, y, 72f, exitP); tx += exitP.measureText(p1)
    Ui.line(c, p2, tx, y, 72f, exitB); tx += exitB.measureText(p2)
    Ui.line(c, p3, tx, y, 72f, exitP)
    c.restore()
    return true
  }

  private var okDown = 0L
  private var holdFired = false
  private val holdRun = Runnable { if (okDown != 0L && !holdFired) { holdFired = true; if (!rail.open) screen?.hold() } }

  /** Keys from the activity while a native screen is showing and nothing from the web is on top. */
  fun onKey(e: KeyEvent): Boolean {
    if (upd.open) return upd.key(e)
    if (menu.open) return menu.key(e)
    if (who.open) return who.key(e)
    if (edit.open) return edit.key(e)
    val s = screen ?: return false
    val code = e.keyCode
    if (exitAt != 0L && code != KeyEvent.KEYCODE_BACK && e.action == KeyEvent.ACTION_DOWN) { exitAt = 0L; invalidate() }
    when (code) {
      KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> {
        if (e.action == KeyEvent.ACTION_DOWN && e.repeatCount == 0) {
          okDown = e.downTime; holdFired = false
          removeCallbacks(holdRun); postDelayed(holdRun, 600)
        } else if (e.action == KeyEvent.ACTION_DOWN && !holdFired && (e.isLongPress || e.eventTime - e.downTime >= 550)) {
          removeCallbacks(holdRun); holdRun.run()
        } else if (e.action == KeyEvent.ACTION_UP) {
          removeCallbacks(holdRun)
          if (okDown != 0L && !holdFired) { if (rail.open) rail.ok() else s.ok() }
          okDown = 0L
        }
        invalidate()
        return true
      }
      KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT -> {
        if (e.action != KeyEvent.ACTION_DOWN) return true
        val now = SystemClock.uptimeMillis()
        val repeat = e.repeatCount > 0
        if (repeat || now - lastArrow < 220) fast = true
        lastArrow = now
        // Presses that are already old when they arrive are let go, so the screen never trails your finger.
        if (repeat && now - e.eventTime > 260) return true
        val vert = code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_DPAD_DOWN
        // A held button is paced; a press of its own always counts.
        val gap = maxOf(if (vert) 125f else 85f, minOf(moveCost * 1.1f, 300f))
        if (repeat && now - lastMove < gap) return true
        if (vert && repeat && !rail.open && s.behind() > 540f) return true
        lastMove = now
        val t0 = now
        post { moveCost = (SystemClock.uptimeMillis() - t0).toFloat().let { if (moveCost == 0f) it else moveCost * 0.6f + it * 0.4f } }
        if (rail.open) rail.key(code)
        else if (!s.key(code) && code == KeyEvent.KEYCODE_DPAD_LEFT) rail.openFrom()
        invalidate()
        return true
      }
      KeyEvent.KEYCODE_BACK -> {
        if (e.action == KeyEvent.ACTION_UP) {
          if (rail.open) { rail.open = false; invalidate() }
          else if (s.back()) invalidate()
          else if (s is Home) {
            // Back to exit (approved mock): the first Back on Home only says so; a second within 2.5 s leaves.
            val now = SystemClock.uptimeMillis()
            if (exitAt != 0L && now - exitAt < EXIT_MS) { exitAt = 0L; host.back() } else { exitAt = now; invalidate() }
          } else host.back()
        }
        return true
      }
    }
    return false
  }
}
