package app.scrappy.player.tv

import android.app.Activity
import android.content.Context
import android.os.SystemClock
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

  // ---------- "Who's watching?" before the page is up ----------
  // The page takes a few seconds to start. The people on this TV are in the app's own saved settings,
  // so the faces go up straight away from there, over the page while it starts. Whatever is chosen
  // waits for the page (it does the switching); when the page reaches its own "who's watching"
  // question it finds this screen already up and carries on from it.
  /** The faces are up from the saved settings and the page has not asked yet. */
  private var early = false
  /** What the faces asked for before the page could answer (sent, in order, once it can). */
  private val waiting = ArrayList<String>()
  /** The person was chosen before the page was ready: the faces stay until Home is up underneath. */
  private var closeWhenHome = false
  private var closeBy = 0L
  private val prefs get() = act.getSharedPreferences(PREFS, 0)

  /** Who the faces screen would show at start, by the page's own rules (whoAtStart in tvwho.js), or null for no question. */
  private fun savedPeople(): JSONObject? {
    val f = java.io.File(act.dataDir, "config.json")
    if (!f.exists()) return null
    val j = JSONObject(f.readText())
    val arr = j.optJSONArray("profiles") ?: return null
    val people = JSONArray()
    for (i in 0 until arr.length()) {
      val p = arr.optJSONObject(i) ?: continue
      val emby = p.optString("token").isNotEmpty() && p.optString("userId").isNotEmpty()
      if (!emby && p.optString("ndToken").isEmpty() && p.optString("absToken").isEmpty()) continue
      val name = listOf(p.optString("userName"), p.optString("ndUser"), p.optString("absUser")).firstOrNull { it.isNotEmpty() } ?: "?"
      val pic = if (emby && p.optString("server").isNotEmpty()) p.optString("server") + "/Users/" + android.net.Uri.encode(p.optString("userId")) + "/Images/Primary?maxWidth=240&quality=90" else ""
      people.put(JSONObject().put("id", p.optString("id")).put("name", name).put("hasPin", p.optString("pinHash").isNotEmpty()).put("pic", pic))
    }
    if (people.length() == 0) return null
    val signed = j.optString("token").isNotEmpty() && j.optString("userId").isNotEmpty()
    val ask = prefs.getBoolean("who_ask", true)
    // Signed in: asked only when more than one person is on this TV and asking is on. Nobody active: always.
    if (signed && (people.length() < 2 || !ask)) return null
    return JSONObject().put("side", false).put("must", false).put("ask", ask).put("active", j.optString("activeProfile")).put("people", people)
  }

  /** The saved PIN sum is read fresh each time: the page's side rewrites the file when a PIN changes. */
  override fun pinCheck(id: String, pin: String): Boolean? = try {
    val arr = JSONObject(java.io.File(act.dataDir, "config.json").readText()).optJSONArray("profiles")
    var r: Boolean? = null
    for (i in 0 until (arr?.length() ?: 0)) {
      val p = arr!!.optJSONObject(i) ?: continue
      if (p.optString("id") != id) continue
      val sum = p.optString("pinHash")
      r = if (sum.isEmpty()) null else Pins.matches(p.optString("pinSalt"), pin, sum)
      break
    }
    r
  } catch (e: Exception) { null }

  private fun startEarlyWho() {
    val o = savedPeople() ?: return
    early = true; modal = true
    view.who.show(o)
    apply()
    // The page never came up (or never asked): don't sit on the faces for ever.
    Net.main.postDelayed({ if (early) { Log.i("ScrappyNative", "early who: page did not ask in time"); pageAsked(); if (waiting.isEmpty()) view.who.finishClose() } }, 15000)
    Log.i("ScrappyNative", "early who: up")
  }

  /** The page has reached its own start-up question: the faces go back under it, and what was asked meanwhile is sent. */
  private fun pageAsked() {
    if (!early) return
    early = false
    // Back to the usual order: native screen, player controls, page on top.
    player.bringToFront(); web.bringToFront()
    send()
  }

  private var sending = false
  /** Send what waited, in order; each one is tried again until the page's side of the bridge exists. */
  private fun send(tries: Int = 0) {
    if (sending && tries == 0) return
    val js = waiting.firstOrNull() ?: run { sending = false; return }
    sending = true
    web.evaluateJavascript("(function(){ if (!window.__tvNative) return false; $js; return true })()") { r ->
      if (r == "true") { waiting.removeAt(0); send(1) }
      else if (tries < 100) Net.main.postDelayed({ send(tries + 1) }, 120)
      else { waiting.clear(); sending = false }
    }
  }

  /** While true, a chosen person is held on the faces screen instead of closing it (see Who.close). */
  override fun whoHold(): Boolean = early

  /** Home is up underneath and nothing from the page is on top: the held faces can go. */
  private fun closeHeld() {
    if (!closeWhenHome) return
    if ((active && !webVis) || SystemClock.uptimeMillis() >= closeBy) { closeWhenHome = false; view.who.finishClose() }
    else Net.main.postDelayed({ closeHeld() }, 100)
  }

  /** Put the native view directly under the web view, in the same parent. */
  private fun attach() {
    val parent = web.parent as? ViewGroup ?: return
    for (v in listOf(view, player)) {
      if (v.parent === parent) continue
      (v.parent as? ViewGroup)?.removeView(v)
      parent.addView(v, parent.indexOfChild(web).coerceAtLeast(0), FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }
    // The early faces sit over the page while it starts (it stays shown underneath, so it starts at full speed).
    if (early && parent.getChildAt(parent.childCount - 1) !== view) view.bringToFront()
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
    val webShown = early || ((!active || webVis || playing) && !modal && !updModal)
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
      if (!wasPlaying && play) Img.trimForPlayback()
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
    if (!o.optBoolean("side")) prefs.edit().putBoolean("who_ask", o.optBoolean("ask", true)).apply()
    act.runOnUiThread {
      val wasEarly = early
      pageAsked()
      attach(); modal = true; view.who.show(o); apply()
      // Chosen before the page was ready: the faces stay until Home is drawn underneath (2.5 s at most).
      if (wasEarly && view.who.held) { closeWhenHome = true; closeBy = SystemClock.uptimeMillis() + 2500; closeHeld() }
    }
  }
  /** The page decided not to ask who is watching (tvwho.js whoAtStart). */
  @JavascriptInterface fun whoNone() {
    act.runOnUiThread {
      if (!early) return@runOnUiThread
      val asked = waiting.isNotEmpty()
      pageAsked()
      // Nothing was chosen that the page must do: the faces go once Home is up underneath.
      if (!asked || view.who.held) { closeWhenHome = true; closeBy = SystemClock.uptimeMillis() + 2500; closeHeld() }
    }
  }
  private val whoCalls = HashMap<Int, (JSONObject?) -> Unit>()
  private var whoN = 0
  @JavascriptInterface fun whoReply(seq: Int, json: String) {
    val o = try { JSONObject(json) } catch (_: Throwable) { null }
    act.runOnUiThread { whoCalls.remove(seq)?.invoke(o) }
  }
  override fun whoAct(act: String, args: JSONObject, done: (JSONObject?) -> Unit) {
    val n = ++whoN; whoCalls[n] = done
    if (act == "ask") prefs.edit().putBoolean("who_ask", args.optBoolean("on", true)).apply()
    val call = "window.__tvNative.whoAct($n, ${js(act)}, $args)"
    if (early) { waiting.add(call); return }
    eval("window.__tvNative && $call")
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
  /** Sign-in runs in the app's own code (SignLogic). Only leaving the screen still goes through the page, which owns the way around. */
  override fun signAct(act: String, args: JSONObject, done: (JSONObject?) -> Unit) {
    if (act == "open") { pageSign(act, args, done); return }
    sign.act(act, args) { r -> done(r) }
  }
  private fun pageSign(act: String, args: JSONObject, done: (JSONObject?) -> Unit) {
    val n = ++signN; signCalls[n] = done
    eval("window.__tvNative && window.__tvNative.signAct($n, ${js(act)}, $args)")
  }
  private val cfgCalls = HashMap<Int, () -> Unit>()
  private var cfgN = 0
  @JavascriptInterface fun cfgDone(seq: Int) { act.runOnUiThread { cfgCalls.remove(seq)?.invoke() } }
  private val sign = SignLogic(object : SignLogic.Io {
    override val file = java.io.File(act.dataDir, "config.json")
    // The same device name the Rust side gives Emby, so the TV stays one entry in Emby's device list.
    override val device = System.getenv("COMPUTERNAME") ?: System.getenv("HOSTNAME") ?: "Windows PC"
    override val version: String = try { act.packageManager.getPackageInfo(act.packageName, 0).versionName ?: "1.0" } catch (e: Exception) { "1.0" }
    override fun savedAddrs(): JSONObject = try { JSONObject(prefs.getString("sign_addrs", "{}") ?: "{}") } catch (e: Exception) { JSONObject() }
    override fun saveAddrs(o: JSONObject) { prefs.edit().putString("sign_addrs", o.toString()).apply() }
    override fun phonePage(): String = try { act.assets.open("pair.html").bufferedReader().use { it.readText() } } catch (e: Exception) { "" }
    override fun ui(work: () -> Unit) { act.runOnUiThread(work) }
    override fun changed(then: () -> Unit) {
      Net.reload()
      val n = ++cfgN; cfgCalls[n] = then
      eval("(window.__tvNative && window.__tvNative.cfgChanged) ? window.__tvNative.cfgChanged($n) : window.ScrappyNative.cfgDone($n)")
    }
    override fun push(model: JSONObject) { (view.screen as? Signin)?.push(model) }
    override fun open() { pageSign("open", JSONObject()) { _ -> } }
  })
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
  /** The quick menu's favourite / watched / leave Continue Watching, done by the app itself; every screen then hears about it. */
  override fun holdAct(id: String, act: String) = Net.bg {
    val said = try {
      val at = "/Users/{userId}/Items/" + Card.enc(id)
      val it = Net.getNow(at) as JSONObject
      val name = it.optString("Name"); val ud = it.optJSONObject("UserData") ?: JSONObject()
      when (act) {
        "fav" -> {
          val on = !ud.optBoolean("IsFavorite")
          Net.send(if (on) "POST" else "DELETE", "/Users/{userId}/FavoriteItems/" + Card.enc(id), null)
          if (on) "Added $name to Favorites" else "Removed $name from Favorites"
        }
        "played" -> {
          val on = !ud.optBoolean("Played")
          Net.send(if (on) "POST" else "DELETE", "/Users/{userId}/PlayedItems/" + Card.enc(id), null)
          // Marking watched also clears the saved spot (some servers keep it).
          if (on && ud.optLong("PlaybackPositionTicks") > 0 && it.optString("Type") in Card.PLAYABLE) try {
            val u = (Net.getNow(at) as? JSONObject)?.optJSONObject("UserData")
            if (u != null && u.optLong("PlaybackPositionTicks") > 0) Net.send("POST", "$at/UserData", JSONObject().put("PlaybackPositionTicks", 0).put("Played", true).put("IsFavorite", u.optBoolean("IsFavorite")).toString())
          } catch (_: Throwable) {}
          if (on) "Marked $name as watched" else "Marked $name as unwatched"
        }
        "unresume" -> {
          try { Net.send("POST", "$at/HideFromResume?Hide=true", null) }
          // Older servers: clear the saved position instead.
          catch (_: Throwable) { Net.send("POST", "$at/UserData", JSONObject().put("PlaybackPositionTicks", 0).toString()) }
          "Removed $name from Continue Watching"
        }
        else -> null
      }
    } catch (e: Throwable) { Net.main.post { toast("Couldn't reach the server. Try again.", true) }; null }
    if (said != null) Net.main.post { toast(said, false); changed() }
  }
  override fun playQueue(ids: List<String>) = eval("window.__tvNative && window.__tvNative.playQueue(${org.json.JSONArray(ids)})")
  override fun editHome(rowsJson: String) = eval("window.__tvNative && window.__tvNative.editHome($rowsJson)")
  override fun saveHomeRows(json: String) = eval("window.__tvNative && window.__tvNative.homeRows(${js(json)})")
  override fun who() = eval("window.__tvNative && window.__tvNative.who()")
  /** The native view covers the window from now on: the opening picture behind it (a full-screen
   *  picture kept in memory and painted under everything) is swapped for the plain page colour. */
  override fun firstFrame() { try { act.window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Ui.BG)) } catch (_: Throwable) {} }
  override fun whoFull() = eval("window.__tvNative && window.__tvNative.whoFull && window.__tvNative.whoFull()")
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
  private val finder = Finder { path -> Net.getNow(path, false) as? JSONObject }
  /** Movies & TV search is the app's own. With Music or Audiobooks signed in the page still searches, so their results keep showing. */
  override fun search(text: String, done: (JSONObject?) -> Unit) {
    val others = try { Store.load(java.io.File(act.dataDir, "config.json")).let { c -> c.musicIn || c.booksIn } } catch (e: Exception) { true }
    if (!others) {
      Net.bg {
        val r = if (!Net.session.ok) JSONObject().put("failed", JSONArray()).put("sections", JSONArray())
          else try { finder.search(text) } catch (e: Throwable) { JSONObject().put("failed", JSONArray().put("Emby")).put("sections", JSONArray()) }
        Net.main.post { done(r) }
      }
      return
    }
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

  // Last, once everything above exists: the faces from the saved settings, before the page is up.
  init {
    try { startEarlyWho() } catch (e: Throwable) { Log.e("ScrappyNative", "early who", e); early = false; modal = false; waiting.clear() }
  }
}
