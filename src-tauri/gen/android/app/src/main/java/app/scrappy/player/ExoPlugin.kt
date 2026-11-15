package app.scrappy.player

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * The web side's way to the TV's video player (Exo.kt). Rust drives it with a few simple commands
 * and asks for its state about four times a second, so the rest of Scrappy works the same as with
 * mpv on the PC. Everything is done by Exo; this only passes the calls on, on the main thread.
 */
@TauriPlugin
class ExoPlugin(private val activity: Activity) : Plugin(activity) {
  private val main = Handler(Looper.getMainLooper())
  private val exo get() = Exo.of(activity)

  override fun load(webView: WebView) {
    main.post { exo.webView = webView }
  }

  private fun ui(invoke: Invoke, block: () -> JSObject?) {
    main.post {
      try {
        val r = block()
        if (r != null) invoke.resolve(r) else invoke.resolve()
      } catch (e: Exception) {
        invoke.reject(e.message ?: e.toString())
      }
    }
  }

  @Command
  fun open(invoke: Invoke) {
    val a = invoke.getArgs()
    val url = a.getString("url")
    val start = a.optDouble("start", 0.0)
    val subs = a.optJSONArray("subs")
    ui(invoke) { JSObject().put("seq", exo.open(url, start, subs)) }
  }

  @Command
  fun control(invoke: Invoke) {
    val a = invoke.getArgs()
    val what = a.getString("what")
    ui(invoke) { exo.control(what, a); null }
  }

  @Command
  fun state(invoke: Invoke) {
    ui(invoke) { JSObject(exo.state().toString()) }
  }

  /** What this TV can play by itself, so Emby only converts what it must. */
  @Command
  fun caps(invoke: Invoke) {
    ui(invoke) { JSObject(exo.caps().toString()) }
  }

  override fun onDestroy() {
    main.post { exo.release() }
  }
}
