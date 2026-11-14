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
    // The web view is put on screen (setContentView) only after this runs, which would throw away
    // anything added now: the native view joins it once it is attached, underneath it.
    web.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
      override fun onViewAttachedToWindow(v: View) { attach() }
      override fun onViewDetachedFromWindow(v: View) {}
    })
    if (web.isAttachedToWindow) attach()
    if (android.os.Build.VERSION.SDK_INT >= 26) { view.defaultFocusHighlightEnabled = false; web.defaultFocusHighlightEnabled = false }
    web.setBackgroundColor(android.graphics.Color.TRANSPARENT)
    web.addJavascriptInterface(this, "ScrappyNative")
    act.registerComponentCallbacks(object : android.content.ComponentCallbacks2 {
      override fun onTrimMemory(level: Int) { Img.trim(level) }
      override fun onConfigurationChanged(c: android.content.res.Configuration) {}
      @Deprecated("") override fun onLowMemory() { Img.clearMemory() }
    })
    try { view.home().preload() } catch (e: Throwable) { Log.e("ScrappyNative", "preload", e) }
    view.home().onGenreLib = { id -> eval("window.__tvNative && window.__tvNative.genreLib(${js(id)})") }
  }

  /** Put the native view directly under the web view, in the same parent. */
  private fun attach() {
    val parent = web.parent as? ViewGroup ?: return
    if (view.parent === parent) return
    (view.parent as? ViewGroup)?.removeView(view)
    parent.addView(view, parent.indexOfChild(web).coerceAtLeast(0), FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  private fun eval(s: String) = act.runOnUiThread { web.evaluateJavascript(s, null) }

  /** Keys while a native screen is up and nothing from the web is on top. */
  fun takesKeys() = active && !webKeys && !playing && box?.hasFocus() != true

  private var hadNativeKeys = false
  private var webHidden = false

  private fun apply() {
    val nativeKeys = active && !webKeys && !playing
    view.visibility = if (active && !playing) View.VISIBLE else View.GONE
    // The remote's focus moves for real between the two views. Native first, so the web view never
    // hides while holding the focus.
    if (nativeKeys && !view.isFocused) view.requestFocus()
    // With nothing on top, the web view is put away entirely, so it costs nothing while you browse.
    val webShown = !active || webVis || playing
    val wasHidden = webHidden
    webHidden = !webShown
    web.visibility = if (webShown) View.VISIBLE else View.INVISIBLE
    // Keys go back to the web page: hiding the web view leaves its page unfocused even while Android
    // still counts the view as focused (the remote then did nothing on the next web screen). Take the
    // focus away and give it back, so the page itself is focused again.
    if (!nativeKeys && (hadNativeKeys || wasHidden || !web.hasFocus())) {
      if (web.hasFocus()) web.clearFocus()
      web.requestFocus()
      // Taking the focus moves the page's highlight to its first element; put it back.
      eval("window.__tvNative && window.__tvNative.refocus()")
    }
    hadNativeKeys = nativeKeys
    view.post { Log.i("ScrappyNative", "focus native=$nativeKeys tv=${view.isFocused} web=${web.hasFocus()} webShown=$webShown") }
    view.invalidate()
  }

  // ---------- from the web page (JavaScript thread) ----------

  @JavascriptInterface fun isOn(): Boolean = isOn(act)

  /** Notes from the page for testing (adb logcat -s ScrappyNative). */
  @JavascriptInterface fun note(msg: String) { Log.i("ScrappyNative", "page: $msg") }

  @JavascriptInterface fun route(hash: String): Boolean {
    if (!view.isNative(hash)) return false
    act.runOnUiThread { attach(); if (view.route(hash)) { active = true; apply() } }
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
  override fun playFrom(id: String, fromStart: Boolean) = eval("window.__tvNative && window.__tvNative.play(${js(id)}, $fromStart)")
  override fun playSeriesFrom(id: String, fromStart: Boolean) = eval("window.__tvNative && window.__tvNative.playSeries(${js(id)}, $fromStart)")
  override fun toast(msg: String, error: Boolean) = eval("window.__tvNative && window.__tvNative.toast(${js(msg)}, $error)")
  override fun changed() = eval("window.dispatchEvent(new Event('scrappy:stale'))")
  override fun local(key: String, done: (String?) -> Unit) {
    act.runOnUiThread {
      web.evaluateJavascript("(function(){try{return localStorage.getItem(${js(key)})}catch(e){return null}})()") { v ->
        val s = try { if (v == null || v == "null") null else org.json.JSONTokener(v).nextValue() as? String } catch (_: Throwable) { null }
        done(s)
      }
    }
  }
  override fun setLocal(key: String, value: String) = eval("try{localStorage.setItem(${js(key)}, ${js(value)})}catch(e){}")
  override fun replace(hash: String, go: Boolean) = eval(
    if (go) "location.replace(${js(hash)})" else "history.replaceState(history.state, '', ${js(hash)}); window.__curHash = location.hash")
  override fun subtitles(id: String) = eval("window.__tvNative && window.__tvNative.subtitles(${js(id)})")
  private val searches = HashMap<Int, (JSONObject?) -> Unit>()
  private var searchN = 0
  @JavascriptInterface fun searchDone(seq: Int, json: String) {
    val o = try { JSONObject(json) } catch (_: Throwable) { null }
    act.runOnUiThread { searches.remove(seq)?.invoke(o) }
  }
  override fun search(text: String, done: (JSONObject?) -> Unit) {
    val n = ++searchN; searches[n] = done
    eval("window.__tvNative && window.__tvNative.search($n, ${js(text)})")
  }

  /** An invisible text box under the native view takes the TV keyboard's typing and voice. */
  private var box: KeyBox? = null
  private class KeyBox(ctx: Context) : android.widget.EditText(ctx) {
    var onBack: (() -> Unit)? = null
    override fun onKeyPreIme(keyCode: Int, event: android.view.KeyEvent): Boolean {
      if (keyCode == android.view.KeyEvent.KEYCODE_BACK && event.action == android.view.KeyEvent.ACTION_UP) { onBack?.invoke(); return true }
      return keyCode == android.view.KeyEvent.KEYCODE_BACK || super.onKeyPreIme(keyCode, event)
    }
  }
  private var watcher: android.text.TextWatcher? = null
  override fun keyboard(text: String, change: (String) -> Unit, done: (String?) -> Unit) {
    act.runOnUiThread {
      val parent = web.parent as? ViewGroup ?: return@runOnUiThread
      val b = box ?: KeyBox(act).also { k ->
        k.alpha = 0f; k.isSingleLine = true; k.isFocusableInTouchMode = true
        k.imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH
        k.inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
        // Where the search box is drawn, so the TV keyboard sits the same way it does for the web box.
        val sc = (if (view.width > 0) view.width else parent.width) / 1920f
        parent.addView(k, 0, FrameLayout.LayoutParams((1739 * sc).toInt(), (101 * sc).toInt()).apply { leftMargin = (149 * sc).toInt(); topMargin = (64 * sc).toInt() })
        box = k
      }
      watcher?.let { b.removeTextChangedListener(it) }
      b.setText(text); b.setSelection(text.length)
      val imm = act.getSystemService(Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
      var closed = false
      fun close(result: String?) {
        if (closed) return; closed = true
        watcher?.let { b.removeTextChangedListener(it) }; watcher = null
        imm.hideSoftInputFromWindow(b.windowToken, 0)
        b.clearFocus(); view.requestFocus()
        done(result)
      }
      watcher = object : android.text.TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, a: Int, c: Int, d: Int) {}
        override fun onTextChanged(s: CharSequence?, a: Int, c: Int, d: Int) {}
        override fun afterTextChanged(s: android.text.Editable?) { change(s?.toString() ?: "") }
      }.also { b.addTextChangedListener(it) }
      b.setOnEditorActionListener { v, _, _ -> close(v.text.toString()); true }
      b.onBack = { close(null) }
      b.requestFocus()
      b.post { imm.showSoftInput(b, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT) }
    }
  }

  override fun reroute() = eval("window.dispatchEvent(new HashChangeEvent('hashchange'))")
}
