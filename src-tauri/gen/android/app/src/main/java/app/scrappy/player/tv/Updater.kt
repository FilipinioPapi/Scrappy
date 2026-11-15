package app.scrappy.player.tv

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * App updates on the TV, done by the app itself (the same steps as tvupdate.js and
 * updates_android.rs). Every TV build publishes a small tv.json next to its Scrappy-TV.apk on GitHub
 * Releases. If it names a newer version, a card asks "Update now / Later"; Update now downloads the
 * new app into Scrappy's own cache folder with a progress bar, and the TV's installer takes over.
 * Android refuses any file not signed with the same key as the installed app.
 */
class Updater(private val io: Io) {
  interface Io {
    /** Where this build's updates come from, e.g. https://github.com/.../releases/download/tv-native */
    val base: String
    val current: String
    val cacheDir: File
    fun ui(work: () -> Unit)
    /** Shows one card on the update prompt ({step:""} closes it). */
    fun card(o: JSONObject)
    fun toast(msg: String, bad: Boolean)
    fun playing(): Boolean
    /** Hands the downloaded file to the TV's installer. Throws with a reason when it can't. */
    fun install(apk: File)
  }

  companion object {
    /** "0.3.15" -> [0, 3, 15], so versions compare as numbers. */
    fun nums(v: String) = v.split('.').map { it.trim().toLongOrNull() ?: 0L }
    fun newer(version: String, current: String): Boolean {
      if (version.isEmpty()) return false
      val a = nums(version); val b = nums(current)
      for (i in 0 until maxOf(a.size, b.size)) {
        // A shorter list that matches so far is the smaller one, as lists compare in Rust.
        if (i >= a.size) return false; if (i >= b.size) return true
        if (a[i] != b[i]) return a[i] > b[i]
      }
      return false
    }
    fun notes(v: Any?): List<String> {
      val lines = if (v is JSONArray) List(v.length()) { v.optString(it) } else (v?.takeIf { it != JSONObject.NULL }?.toString() ?: "").split('\n')
      return lines.map { it.replace(Regex("^\\s*[-*•]\\s*"), "").trim() }.filter { it.isNotEmpty() }.take(5)
    }
    fun mb(n: Long) = maxOf(1L, Math.round(n / 1048576.0))
    fun left(got: Long, total: Long, secs: Double): String {
      val l = if (total > 0 && got > 0 && secs > 1) Math.round((total - got).toDouble() / got * secs) else 0L
      return if (l > 60) "about ${Math.round(l / 60.0)} min left" else if (l > 2) "about $l seconds left" else ""
    }
  }

  private var found: JSONObject? = null
  private var open = false
  @Volatile private var cancel = false
  @Volatile private var busy = false

  private fun apk(): File = File(File(io.cacheDir, "updates").apply { mkdirs() }, "Scrappy-TV.apk")
  private fun show(o: JSONObject) { open = o.optString("step").isNotEmpty(); io.card(o) }
  private fun bg(work: () -> Unit) = Thread({ try { work() } catch (e: Throwable) {} }, "update").apply { isDaemon = true }.start()

  private fun http(url: String, timeout: Int): HttpURLConnection {
    val c = URL(url).openConnection() as HttpURLConnection
    c.connectTimeout = 10000; c.readTimeout = timeout
    return c
  }

  private fun latest(): JSONObject {
    val c = http(io.base + "/tv.json", 15000)
    try {
      val code = c.responseCode
      if (code !in 200..299) throw IllegalStateException("The update list answered $code.")
      return JSONObject(c.inputStream.bufferedReader().use { it.readText() })
    } finally { c.disconnect() }
  }

  /** Look for a newer TV build. `manual` = asked for from Settings (always answers). */
  fun check(manual: Boolean) {
    if (open) return
    bg {
      try {
        val j = latest()
        val version = j.optString("version")
        val isNew = newer(version, io.current)
        // Up to date: an old download is no longer needed.
        if (!isNew) apk().delete()
        io.ui {
          found = if (isNew) JSONObject().put("version", version).put("current", io.current).put("notes", j.opt("notes")).put("size", j.optLong("size")) else null
          if (found != null && (manual || !io.playing())) ask()
          else if (manual) io.toast("You're up to date.", false)
        }
      } catch (e: Throwable) {
        if (manual) io.ui { io.toast("Couldn't check for updates: " + (e.message ?: "no answer"), true) }
      }
    }
  }

  private fun ask() {
    val f = found ?: return
    show(JSONObject().put("step", "ask").put("version", f.optString("version")).put("current", f.optString("current")).put("notes", JSONArray(notes(f.opt("notes")))))
  }

  private fun failed(why: String) = show(JSONObject().put("step", "fail").put("err", why))

  private fun install() {
    val f = found ?: return
    show(JSONObject().put("step", "ready").put("version", f.optString("version")))
    tryInstall()
  }
  private fun tryInstall() {
    val file = apk()
    if (!file.exists()) { failed("The update isn't downloaded yet."); return }
    try { io.install(file) } catch (e: Throwable) { failed(e.message ?: "The TV's installer isn't ready.") }
  }

  private fun download() {
    val f = found ?: return
    val version = f.optString("version")
    if (busy) { failed("Already downloading."); return }
    busy = true; cancel = false
    val t0 = System.currentTimeMillis()
    show(JSONObject().put("step", "get").put("version", version).put("got", 0).put("total", 0).put("gotText", "Starting…").put("left", ""))
    fun tell(got: Long, total: Long) = io.ui {
      if (open) show(JSONObject().put("step", "get").put("version", version).put("got", got).put("total", total)
        .put("gotText", if (total > 0) "${mb(got)} of ${mb(total)} MB" else "${mb(got)} MB").put("left", left(got, total, (System.currentTimeMillis() - t0) / 1000.0)))
    }
    bg {
      val file = apk(); val part = File(file.parentFile, "Scrappy-TV.part")
      val err: String? = try {
        val j = latest()
        val want = j.optLong("size")
        val url = j.optString("url").ifEmpty { io.base + "/Scrappy-TV.apk" }
        // Only ever fetch Scrappy's own release files.
        if (!url.startsWith(io.base.substringBeforeLast('/') + "/")) throw IllegalStateException("The update list points somewhere unexpected.")
        val c = http(url, 30000)
        try {
          val code = c.responseCode
          if (code !in 200..299) throw IllegalStateException("The download answered $code.")
          val total = c.contentLengthLong.takeIf { it > 0 } ?: want
          var got = 0L; var told = System.currentTimeMillis()
          tell(0, total)
          var stopped = false
          c.inputStream.use { inp -> part.outputStream().use { out ->
            val buf = ByteArray(65536)
            while (true) {
              if (cancel) { stopped = true; break }
              val n = inp.read(buf); if (n < 0) break
              out.write(buf, 0, n); got += n
              val now = System.currentTimeMillis()
              if (now - told >= 200) { told = now; tell(got, total) }
            }
          } }
          if (stopped) { part.delete(); "cancelled" }
          else if (want > 0 && got != want) { part.delete(); "The download came through incomplete. Try again." }
          else { file.delete(); if (!part.renameTo(file)) throw IllegalStateException("Couldn't save the update."); tell(got, got); null }
        } finally { c.disconnect() }
      } catch (e: Throwable) { part.delete(); file.delete(); e.message ?: "The download didn't work." }
      busy = false
      io.ui {
        if (err == "cancelled") return@ui
        if (err != null) { failed(err); return@ui }
        if (!open) return@ui          // cancelled meanwhile
        install()
      }
    }
  }

  /** A button on the card: go (Update now), again (Try again), install, cancel, later. */
  fun act(a: String) {
    when (a) {
      "go", "again" -> download()
      "install" -> tryInstall()
      "cancel" -> { cancel = true; if (open) show(JSONObject().put("step", "")) }
      else -> if (open) show(JSONObject().put("step", ""))
    }
  }
}
