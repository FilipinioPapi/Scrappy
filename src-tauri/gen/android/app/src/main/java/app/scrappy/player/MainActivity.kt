package app.scrappy.player

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
    super.onCreate(savedInstanceState)
    // Don't let the TV dim or start the screensaver while Scrappy is open.
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  private var web: WebView? = null
  private var holdSent = false

  // Holding OK on the remote: tell the page once per press, so the quick menu opens on every remote
  // (some TVs don't pass the "still held" presses on to the page).
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
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
    // The page draws its own menus; the built-in press-and-hold menu stays out of the way.
    webView.setOnLongClickListener { true }
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
