package app.scrappy.player.tv

import android.app.Activity
import android.content.Context
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject

/** Joins the native screens to the web side. On in Scrappy Native, off in the regular app unless switched on (adb: am start ... --ez native true). */
class Bridge(private val act: Activity, private val web: WebView) : Host {
  companion object {
    private const val PREFS = "scrappy_native"
    fun isOn(ctx: Context) = ctx.getSharedPreferences(PREFS, 0).getBoolean("on", app.scrappy.player.BuildConfig.NATIVE_APP)
    fun set(ctx: Context, on: Boolean) = ctx.getSharedPreferences(PREFS, 0).edit().putBoolean("on", on).apply()
    private fun js(s: String) = JSONObject.quote(s)
  }

  val view = TvView(act, this)
  /** A native screen is the current page. */
  var active = false; private set
  /** Something from the web is showing on top (keys go to the web while `webKeys`). */
  private var webVis = true
  private var webKeys = true
  private var playing = false

  init {
    view.visibility = View.GONE
    val parent = (web.parent as? ViewGroup) ?: act.findViewById(android.R.id.content)
    parent.addView(view, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    web.setBackgroundColor(android.graphics.Color.TRANSPARENT)
    web.addJavascriptInterface(this, "ScrappyNative")
    view.home().onGenreLib = { id -> eval("window.__tvNative && window.__tvNative.genreLib(${js(id)})") }
  }

  private fun eval(s: String) = act.runOnUiThread { web.evaluateJavascript(s, null) }

  /** Keys while a native screen is up and nothing from the web is on top. */
  fun takesKeys() = active && !webKeys && !playing

  private fun apply() {
    view.visibility = if (active && !playing) View.VISIBLE else View.GONE
    // With nothing on top, the web view is put away entirely, so it costs nothing while you browse.
    val webShown = !active || webVis || playing
    web.visibility = if (webShown) View.VISIBLE else View.INVISIBLE
    if (webKeys || !active) web.requestFocus()
    view.invalidate()
  }

  // ---------- from the web page (JavaScript thread) ----------

  @JavascriptInterface fun isOn(): Boolean = isOn(act)

  @JavascriptInterface fun route(hash: String): Boolean {
    if (!view.isNative(hash)) return false
    act.runOnUiThread { if (view.route(hash)) { active = true; apply() } }
    return true
  }

  @JavascriptInterface fun leave() { act.runOnUiThread { if (active) { active = false; view.leave(); apply() } } }

  @JavascriptInterface fun layer(vis: Boolean, keys: Boolean, play: Boolean) {
    act.runOnUiThread {
      val wasPlaying = playing
      webVis = vis; webKeys = keys; playing = play
      if (wasPlaying && !play) view.stale()
      apply()
    }
  }

  @JavascriptInterface fun prefs(json: String) {
    act.runOnUiThread { try { view.home().setPrefs(JSONObject(json)); view.invalidate() } catch (_: Throwable) {} }
  }

  @JavascriptInterface fun stale() { act.runOnUiThread { view.stale() } }

  private val picks = HashMap<Int, (Int) -> Unit>()
  private var pickN = 0
  @JavascriptInterface fun picked(req: Int, i: Int) { act.runOnUiThread { picks.remove(req)?.invoke(i) } }

  // ---------- from the native screens ----------

  override fun go(hash: String) = eval("location.hash = ${js(hash)}")
  override fun back() {
    act.runOnUiThread {
      web.evaluateJavascript("(window.__tvBack ? window.__tvBack() : false)") { handled -> if (handled != "true") act.moveTaskToBack(true) }
    }
  }
  override fun play(id: String) = eval("window.__tvNative && window.__tvNative.play(${js(id)})")
  override fun playSeries(id: String) = eval("window.__tvNative && window.__tvNative.playSeries(${js(id)})")
  override fun hold(id: String, inResume: Boolean) = eval("window.__tvNative && window.__tvNative.hold(${js(id)}, $inResume)")
  override fun editHome(rowsJson: String) = eval("window.__tvNative && window.__tvNative.editHome($rowsJson)")
  override fun who() = eval("window.__tvNative && window.__tvNative.who()")
  override fun log(msg: String) { Log.i("ScrappyNative", msg) }
  override fun pick(title: String, options: List<String>, cur: Int, done: (Int) -> Unit) {
    val n = ++pickN; picks[n] = done
    eval("window.__tvNative && window.__tvNative.pick($n, ${js(title)}, ${JSONArray(options)}, $cur)")
  }
  override fun saveSort(key: String, i: Int) = eval("window.__tvNative && window.__tvNative.sort(${js(key)}, $i)")
}
