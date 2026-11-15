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
  /** Scrappy Native's own player controls, over the video and under the page. */
  val player = PlayerUi(act, object : PlayerHost {
    override fun act(action: String, value: String) = eval("window.__tvNative && window.__tvNative.pl(${js(action)}, ${js(value)})")
    override fun clock(): DoubleArray? {
      val p = app.scrappy.player.ExoPlugin.current ?: return null
      val d = p.duration
      return doubleArrayOf(p.currentPosition / 1000.0, if (d == androidx.media3.common.C.TIME_UNSET || d < 0) 0.0 else d / 1000.0,
        if (p.playWhenReady) 0.0 else 1.0, if (p.playbackState == androidx.media3.common.Player.STATE_BUFFERING) 1.0 else 0.0)
    }
    override fun log(msg: String) { Log.i("ScrappyNative", msg) }
  })
  /** A native screen is the current page. */
  var active = false; private set
  /** Something from the web is showing on top (keys go to the web while `webKeys`). */
  private var webVis = true
  private var webKeys = true
  private var playing = false

  init {
    view.visibility = View.GONE
    player.visibility = View.GONE
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
    for (v in listOf(view, player)) {
      if (v.parent === parent) continue
      (v.parent as? ViewGroup)?.removeView(v)
      parent.addView(v, parent.indexOfChild(web).coerceAtLeast(0), FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }
  }

  private fun eval(s: String) = act.runOnUiThread { web.evaluateJavascript(s, null) }

  /** Keys while a video plays and the native controls own the remote (not while Up next, Still watching or Download subtitles is up). */
  fun playerKeys() = playing && player.open && !player.card

  /** Keys while a native screen is up and nothing from the web is on top. */
  fun takesKeys() = ((active && !webKeys && !playing) || modal || updModal) && box?.hasFocus() != true

  /** Who's watching is up (drawn natively over everything, even before the first native screen). */
  private var modal = false
  /** The update card is up (drawn natively over the screen). */
  private var updModal = false

  private var hadNativeKeys = false
  private var webHidden = false

  private fun apply() {
    val nativeKeys = (active && !webKeys && !playing) || modal || updModal
    view.visibility = if ((active && !playing) || modal || updModal) View.VISIBLE else View.GONE
    // The remote's focus moves for real between the two views. Native first, so the web view never
    // hides while holding the focus.
    if (nativeKeys && !view.isFocused) view.requestFocus()
    // With nothing on top, the web view is put away entirely, so it costs nothing while you browse.
    val webShown = (!active || webVis || playing) && !modal && !updModal
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

  /** The player's state from the page (title, tracks, menus), whenever it changes. */
  @JavascriptInterface fun pstate(json: String) {
    val o = try { JSONObject(json) } catch (_: Throwable) { return }
    act.runOnUiThread { attach(); player.state(o) }
  }

  /** The update prompt: tvupdate.js sends each card ({step:""} closes it). */
  @JavascriptInterface fun upd(json: String) {
    val o = try { JSONObject(json) } catch (_: Throwable) { return }
    act.runOnUiThread {
      attach()
      view.upd.onClosed = { updModal = false; apply() }
      if (o.optString("step").isNotEmpty()) { updModal = true; view.upd.show(o); apply() } else view.upd.show(o)
    }
  }
  override fun updAct(act: String) = eval("window.__tvNative && window.__tvNative.updAct(${js(act)})")

  @JavascriptInterface fun stale() { act.runOnUiThread { view.stale() } }

  /** Who's watching, drawn natively: the page sends the people on this TV and which screen to show. */
  @JavascriptInterface fun who(json: String) {
    val o = try { JSONObject(json) } catch (_: Throwable) { return }
    act.runOnUiThread { attach(); modal = true; view.who.show(o); apply() }
  }
  private val whoCalls = HashMap<Int, (JSONObject?) -> Unit>()
  private var whoN = 0
  @JavascriptInterface fun whoReply(seq: Int, json: String) {
    val o = try { JSONObject(json) } catch (_: Throwable) { null }
    act.runOnUiThread { whoCalls.remove(seq)?.invoke(o) }
  }
  override fun whoAct(act: String, args: JSONObject, done: (JSONObject?) -> Unit) {
    val n = ++whoN; whoCalls[n] = done
    eval("window.__tvNative && window.__tvNative.whoAct($n, ${js(act)}, $args)")
  }
  private val setCalls = HashMap<Int, (JSONObject?) -> Unit>()
  private var setN = 0
  @JavascriptInterface fun setReply(seq: Int, json: String) {
    val o = try { JSONObject(json) } catch (_: Throwable) { null }
    act.runOnUiThread { setCalls.remove(seq)?.invoke(o) }
  }
  override fun setAct(act: String, args: JSONObject, done: (JSONObject?) -> Unit) {
    val n = ++setN; setCalls[n] = done
    eval("window.__tvNative && window.__tvNative.setAct($n, ${js(act)}, $args)")
  }
  private val signCalls = HashMap<Int, (JSONObject?) -> Unit>()
  private var signN = 0
  @JavascriptInterface fun signReply(seq: Int, json: String) {
    val o = try { JSONObject(json) } catch (_: Throwable) { null }
    act.runOnUiThread { signCalls.remove(seq)?.invoke(o) }
  }
  /** The phone signed in, checked an address or skipped a server: the sign-in screen catches up. */
  @JavascriptInterface fun signPush(json: String) {
    val o = try { JSONObject(json) } catch (_: Throwable) { return }
    act.runOnUiThread { (view.screen as? Signin)?.push(o) }
  }
  private val statsCalls = HashMap<Int, (JSONObject?) -> Unit>()
  private var statsN = 0
  @JavascriptInterface fun statsReply(seq: Int, json: String) {
    val o = try { JSONObject(json) } catch (_: Throwable) { null }
    act.runOnUiThread { statsCalls.remove(seq)?.invoke(o) }
  }
  override fun stats(done: (JSONObject?) -> Unit) {
    val n = ++statsN; statsCalls[n] = done
    eval("window.__tvNative && window.__tvNative.stats($n)")
  }
  override fun signAct(act: String, args: JSONObject, done: (JSONObject?) -> Unit) {
    val n = ++signN; signCalls[n] = done
    eval("window.__tvNative && window.__tvNative.signAct($n, ${js(act)}, $args)")
  }
  override fun whoClosed() {
    modal = false; apply()
    eval("window.__tvNative && window.__tvNative.whoClosed()")
  }


  // ---------- from the native screens ----------

  override fun go(hash: String) = eval("location.hash = ${js(hash)}")
  override fun back() {
    act.runOnUiThread {
      web.evaluateJavascript("(window.__tvBack ? window.__tvBack() : false)") { handled -> if (handled != "true") act.moveTaskToBack(true) }
    }
  }
  override fun play(id: String) = eval("window.__tvNative && window.__tvNative.play(${js(id)})")
  override fun playSeries(id: String) = eval("window.__tvNative && window.__tvNative.playSeries(${js(id)})")
  override fun hold(id: String, inResume: Boolean) = view.menu.hold(id, inResume)
  override fun holdAct(id: String, act: String) = eval("window.__tvNative && window.__tvNative.holdAct(${js(id)}, ${js(act)})")
  override fun playQueue(ids: List<String>) = eval("window.__tvNative && window.__tvNative.playQueue(${org.json.JSONArray(ids)})")
  override fun editHome(rowsJson: String) = eval("window.__tvNative && window.__tvNative.editHome($rowsJson)")
  override fun saveHomeRows(json: String) = eval("window.__tvNative && window.__tvNative.homeRows(${js(json)})")
  override fun who() = eval("window.__tvNative && window.__tvNative.who()")
  override fun log(msg: String) { Log.i("ScrappyNative", msg) }
  override fun pick(title: String, options: List<String>, cur: Int, done: (Int) -> Unit) {
    view.menu.pick(title, options, cur, done)
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
  override fun keyboard(text: String, change: (String) -> Unit, done: (String?) -> Unit) = openBox(text, "search", change, done)
  override fun field(text: String, mode: String, change: (String) -> Unit, done: (String?) -> Unit) = openBox(text, mode, change, done)

  private fun openBox(text: String, mode: String, change: (String) -> Unit, done: (String?) -> Unit) {
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
      b.inputType = when (mode) {
        "url" -> android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI or android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        "user" -> android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
        "password" -> android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        else -> android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
      }
      b.imeOptions = when (mode) { "search" -> android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH; "password" -> android.view.inputmethod.EditorInfo.IME_ACTION_DONE; else -> android.view.inputmethod.EditorInfo.IME_ACTION_NEXT } or (if (mode == "search") 0 else android.view.inputmethod.EditorInfo.IME_FLAG_NO_EXTRACT_UI)
      // Where the box is drawn (search box, or the sign-in box), so the keyboard sits the same way.
      (b.layoutParams as? FrameLayout.LayoutParams)?.let { lp ->
        val sc = (if (view.width > 0) view.width else parent.width) / 1920f
        val field = mode != "search"
        lp.width = ((if (field) 1080 else 1739) * sc).toInt(); lp.height = ((if (field) 80 else 101) * sc).toInt()
        lp.leftMargin = ((if (field) 96 else 149) * sc).toInt(); lp.topMargin = ((if (field) 206 else 64) * sc).toInt()
        b.layoutParams = lp
      }
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
