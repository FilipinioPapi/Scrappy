package app.scrappy.player

import android.os.Bundle
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

  override fun onWebViewCreate(webView: WebView) {
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
