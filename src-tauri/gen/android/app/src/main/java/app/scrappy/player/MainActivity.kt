package app.scrappy.player

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  // We handle the remote's Back button ourselves (below).
  override val handleBackNavigation: Boolean = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    nativeSwitch(intent)
    super.onCreate(savedInstanceState)
    // Don't let the TV dim or start the screensaver while Scrappy is open.
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  private var web: WebView? = null
  private var holdSent = false
  /** Native screens (Home, library grids). Off unless switched on for testing: am start ... --ez native true|false */
  private var native: app.scrappy.player.tv.Bridge? = null

  private fun nativeSwitch(i: Intent?) {
    if (i?.hasExtra("native") == true) app.scrappy.player.tv.Bridge.set(this, i.getBooleanExtra("native", false))
    if (i?.hasExtra("webplayer") == true) app.scrappy.player.tv.Bridge.setWebPlayer(this, i.getBooleanExtra("webplayer", false))
  }
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    nativeSwitch(intent)
  }

  // Holding OK on the remote: tell the page once per press, so the quick menu opens on every remote
  // (some TVs don't pass the "still held" presses on to the page).
  // Back goes back ONE step per press (Jayden): a held Back, or a remote that resends it while held, does nothing more.
  private var backArmed = false
  private var backUpAt = 0L

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.keyCode == KeyEvent.KEYCODE_BACK) {
      if (event.action == KeyEvent.ACTION_DOWN) {
        if (event.repeatCount > 0) return true
        if (event.eventTime - backUpAt < 250) return true // a held key resent as quick separate presses
        backArmed = true
      } else if (event.action == KeyEvent.ACTION_UP) {
        if (!backArmed) return true
        backArmed = false; backUpAt = event.eventTime
      }
    }
    // A video is playing in Scrappy Native: its own controls take the remote.
    native?.let { n ->
      if (n.playerKeys() && n.player.onKey(event)) {
        // The player acts on the press itself; its release must not go back a second step.
        if (event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_DOWN) { backArmed = false; backUpAt = event.eventTime }
        return true
      }
    }
    // A native screen is up with nothing from the web on top: the remote drives it directly.
    native?.let { n -> if (n.takesKeys() && n.view.onKey(event)) return true }
    val ok = event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER || event.keyCode == KeyEvent.KEYCODE_ENTER || event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
    if (ok) {
      if (event.action == KeyEvent.ACTION_DOWN) {
        if (event.repeatCount == 0) holdSent = false
        else if (!holdSent && event.eventTime - event.downTime >= 500) {
          holdSent = true
          web?.evaluateJavascript("window.__tvHold && window.__tvHold()", null)
        }
      }
    }
    return super.dispatchKeyEvent(event)
  }

  override fun onWebViewCreate(webView: WebView) {
    web = webView
    if (app.scrappy.player.tv.Bridge.isOn(this)) native = try { app.scrappy.player.tv.Bridge(this, webView) } catch (e: Throwable) { android.util.Log.e("ScrappyNative", "start", e); null }
    // The page draws its own menus; the built-in press-and-hold menu stays out of the way.
    webView.setOnLongClickListener { true }
    // No scroll bar on a TV: the page moves with the highlight, and the bar only got in the way.
    webView.isVerticalScrollBarEnabled = false
    webView.isHorizontalScrollBarEnabled = false
    webView.overScrollMode = android.view.View.OVER_SCROLL_NEVER
    // Back: first ask the page (close a menu, leave the player, go back a screen).
    // If the page has nothing to go back to, leave the app.
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript("(window.__tvBack ? window.__tvBack() : false)") { handled ->
          if (handled != "true") {
            // The page walks its own history, so "nothing to go back to" means leave the app.
            moveTaskToBack(true)
          }
        }
      }
    })
    // The remote should work from the first press: give the page the focus right away.
    webView.isFocusable = true
    webView.isFocusableInTouchMode = true
    webView.requestFocus()
    // Tell the page when the TV keyboard opens or closes (Back closes it without the page noticing).
    var imeOpen = false
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { v, insets ->
      val open = insets.isVisible(WindowInsetsCompat.Type.ime())
      if (open != imeOpen) {
        imeOpen = open
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('tv-ime',{detail:$open}))", null)
      }
      ViewCompat.onApplyWindowInsets(v, insets)
    }
  }
}
