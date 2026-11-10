package app.scrappy.player

import android.os.Bundle
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

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
            if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
          }
        }
      }
    })
  }
}
