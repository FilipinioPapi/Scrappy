package app.scrappy.player

import android.app.Activity
import android.content.Intent
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

/**
 * Hands a downloaded Scrappy update to the TV's own installer.
 * The TV shows its "Update this app?" screen; the first time it also asks once to
 * allow Scrappy to install updates. Android only accepts a file signed with the same
 * key as the installed app, and nothing is lost: sign-in and settings stay.
 */
@TauriPlugin
class UpdatePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun install(invoke: Invoke) {
    try {
      val path = invoke.getArgs().getString("path")
      val file = File(path)
      // Only files from Scrappy's own cache folder.
      val cache = activity.cacheDir.canonicalFile
      if (!file.exists() || !file.canonicalFile.startsWith(cache)) {
        invoke.reject("The update file is missing.")
        return
      }
      val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", file)
      val intent = Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      activity.startActivity(intent)
      invoke.resolve(JSObject().put("started", true))
    } catch (e: Exception) {
      invoke.reject(e.message ?: e.toString())
    }
  }
}
