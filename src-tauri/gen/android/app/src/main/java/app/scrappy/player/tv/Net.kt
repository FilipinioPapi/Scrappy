package app.scrappy.player.tv

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingDeque
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Who is signed in, read from the app's own saved settings (the same file the Rust side writes). */
data class Session(val server: String, val userId: String, val token: String, val userName: String) {
  val ok get() = server.isNotEmpty() && userId.isNotEmpty() && token.isNotEmpty()
  val key get() = "$server|$userId"
}

/** Talking to Emby from the native screens: JSON with a saved copy on disk (for instant drawing next
 *  time), on a small pool of background threads. Results come back on the main thread. */
object Net {
  val main = Handler(Looper.getMainLooper())
  // Two workers for data: the TV has four slow cores and pictures need some too.
  private val pool = ThreadPoolExecutor(2, 2, 30, TimeUnit.SECONDS, LinkedBlockingDeque()).apply { allowCoreThreadTimeOut(true) }
  private lateinit var dir: File
  private lateinit var cfgFile: File
  private var cfgStamp = -1L
  @Volatile var session = Session("", "", "", ""); private set

  fun init(ctx: Context) {
    if (::dir.isInitialized) return
    dir = File(ctx.cacheDir, "native-meta").apply { mkdirs() }
    cfgFile = File(ctx.dataDir, "config.json")
    reload()
  }

  /** Read the saved sign-in again if the file changed (after signing in or switching person). Returns true if it changed. */
  fun reload(): Boolean {
    val st = if (cfgFile.exists()) cfgFile.lastModified() xor cfgFile.length() else 0L
    if (st == cfgStamp) return false
    cfgStamp = st
    val old = session
    session = try {
      val j = JSONObject(cfgFile.readText())
      Session(j.optString("server").trimEnd('/'), j.optString("userId"), j.optString("token"), j.optString("userName"))
    } catch (e: Throwable) { Session("", "", "", "") }
    return old != session
  }

  fun url(path: String): String = session.server + path.replace("{userId}", session.userId)

  private fun cacheFile(path: String): File {
    val md = MessageDigest.getInstance("MD5").digest((session.key + "|" + path).toByteArray())
    return File(dir, md.joinToString("") { "%02x".format(it) } + ".json")
  }

  /** Blocking GET; also saves the answer. Throws on failure. */
  fun getNow(path: String): Any {
    val s = session
    if (!s.ok) throw IllegalStateException("Not signed in")
    val c = URL(url(path)).openConnection() as HttpURLConnection
    c.connectTimeout = 8000; c.readTimeout = 30000
    c.setRequestProperty("X-Emby-Token", s.token)
    c.setRequestProperty("Accept", "application/json")
    try {
      val code = c.responseCode
      if (code == 401) throw IllegalStateException("SESSION_EXPIRED")
      if (code !in 200..299) throw IllegalStateException("HTTP $code")
      val text = c.inputStream.bufferedReader().use { it.readText() }
      try { cacheFile(path).writeText(text) } catch (_: Throwable) {}
      return parse(text)
    } finally { c.disconnect() }
  }

  /** The last saved copy, or null. */
  fun cachedNow(path: String): Any? = try {
    val f = cacheFile(path); if (f.exists()) parse(f.readText()) else null
  } catch (_: Throwable) { null }

  private fun parse(t: String): Any { val s = t.trim(); return if (s.startsWith("[")) JSONArray(s) else if (s.isEmpty()) JSONObject() else JSONObject(s) }

  /** Fetch fresh. `done` gets the answer (or null on failure) on the main thread. */
  fun get(path: String, done: (Any?) -> Unit) { pool.execute { val v = try { getNow(path) } catch (e: Throwable) { null }; main.post { done(v) } } }

  /** Saved copy first (if there is one), then fresh. `each` may be called twice; `fresh` tells which. */
  fun load(path: String, each: (Any, Boolean) -> Unit) {
    pool.execute {
      val c = cachedNow(path)
      if (c != null) main.post { each(c, false) }
      val v = try { getNow(path) } catch (e: Throwable) { null }
      if (v != null && (c == null || v.toString() != c.toString())) main.post { each(v, true) }
    }
  }

  /** Run some blocking work on a data worker. */
  fun bg(work: () -> Unit) = pool.execute { try { work() } catch (_: Throwable) {} }

  /** "Items" of an answer (or the answer itself when it is a list). */
  fun items(v: Any?): List<JSONObject> {
    val a = when (v) { is JSONArray -> v; is JSONObject -> v.optJSONArray("Items"); else -> null } ?: return emptyList()
    return List(a.length()) { a.getJSONObject(it) }
  }

  fun image(id: String, type: String, tag: String?, maxW: Int, quality: Int = 90): String =
    "${session.server}/Items/$id/Images/$type?maxWidth=$maxW&quality=$quality" + (if (tag.isNullOrEmpty()) "" else "&tag=$tag")
}
