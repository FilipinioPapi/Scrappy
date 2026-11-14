package app.scrappy.player.tv

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.os.SystemClock
import android.util.LruCache
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.LinkedBlockingDeque
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** A loaded picture, ready to draw with rounded corners. */
class Pic(val bmp: Bitmap, val at: Long) {
  val shader = BitmapShader(bmp, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
  val bytes get() = bmp.allocationByteCount
}

/** Pictures for the native screens: newest request first (what you are looking at), a copy on disk,
 *  and a memory cache sized for a TV with little memory to spare. */
object Img {
  private lateinit var dir: File
  private var mem = cache(26)
  private fun cache(mb: Int) = object : LruCache<String, Pic>(mb * 1024 * 1024) {
    override fun sizeOf(key: String, value: Pic) = value.bytes
    override fun entryRemoved(evicted: Boolean, key: String, old: Pic, new: Pic?) { dropped(old.bytes) }
  }
  // A picture let go only gives its memory back (and its copy on the graphics chip) once Java's
  // garbage collector runs, which on a TV with a quiet Java side can be minutes. After a batch of
  // pictures has been let go, ask for a collection so the memory really comes back.
  private var droppedBytes = 0L
  private var gcSoon = false
  private fun dropped(b: Int) {
    droppedBytes += b
    if (droppedBytes > 8L * 1024 * 1024 && !gcSoon) {
      gcSoon = true
      Net.main.postDelayed({ gcSoon = false; droppedBytes = 0; Runtime.getRuntime().gc() }, 400)
    }
  }
  /** A box with little memory (a cheap stick or a busy TV): smaller cache and smaller backdrops. */
  var lowMemory = false; private set
  /** url -> last time it was asked for (ms). Jobs no longer wanted are skipped. */
  private val wanted = HashMap<String, Long>()
  private val queued = HashSet<String>()
  private val failed = HashMap<String, Long>()
  // Last in, first out: the pictures for where the highlight is now come before ones you flew past.
  private val pool = ThreadPoolExecutor(3, 3, 20, TimeUnit.SECONDS, object : LinkedBlockingDeque<Runnable>() {
    override fun offer(e: Runnable): Boolean { offerFirst(e); return true }
  }).apply { allowCoreThreadTimeOut(true) }
  var onLoaded: (() -> Unit)? = null
  /** Off for screen previews (no network there). */
  var enabled = true

  fun init(ctx: Context) {
    if (::dir.isInitialized) return
    dir = File(ctx.cacheDir, "native-img").apply { mkdirs() }
    try {
      val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
      lowMemory = am.isLowRamDevice || am.memoryClass < 160
      // A tenth of what Android gives the app, between 10 and 20 MB.
      mem = cache((am.memoryClass / 10).coerceIn(10, 20))
    } catch (_: Throwable) {}
    Net.bg { trim() }
  }

  /** The picture if it is ready; otherwise starts loading it and returns null. */
  fun get(url: String?, alpha: Boolean = false): Pic? {
    if (url == null) return null
    mem.get(url)?.let { return it }
    if (!enabled) return null
    val now = SystemClock.uptimeMillis()
    synchronized(wanted) { wanted[url] = now }
    if (url in queued) return null
    val f = failed[url]; if (f != null && now - f < 60_000) return null
    queued.add(url)
    pool.execute { load(url, alpha) }
    return null
  }

  fun failed(url: String): Boolean = failed.containsKey(url)
  fun peek(url: String?): Pic? = if (url == null) null else mem.get(url)
  fun clearMemory() { mem.evictAll() }
  /** Android is short of memory: keep only half (or nothing when the app is in the background). */
  fun trim(level: Int) { if (level >= android.content.ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) mem.evictAll() else if (level >= android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) mem.trimToSize(mem.maxSize() / 2) }

  private fun file(url: String): File {
    val md = MessageDigest.getInstance("MD5").digest(url.toByteArray())
    return File(dir, md.joinToString("") { "%02x".format(it) })
  }

  private fun load(url: String, alpha: Boolean) {
    val stillWanted = synchronized(wanted) { (wanted[url] ?: 0L) }
    // Asked for more than 1.5 s ago and not since: you've moved on, skip it (it is asked again if it comes back).
    if (SystemClock.uptimeMillis() - stillWanted > 1500) { Net.main.post { queued.remove(url) }; return }
    var bmp: Bitmap? = null
    try {
      val f = file(url)
      var bytes: ByteArray? = if (f.exists()) try { f.readBytes() } catch (_: Throwable) { null } else null
      if (bytes == null) {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 8000; c.readTimeout = 20000
        try {
          if (c.responseCode in 200..299) {
            bytes = c.inputStream.use { it.readBytes() }
            try { val tmp = File(f.path + ".t"); tmp.writeBytes(bytes); tmp.renameTo(f) } catch (_: Throwable) {}
          }
        } finally { c.disconnect() }
      } else f.setLastModified(System.currentTimeMillis())
      if (bytes != null) {
        val o = BitmapFactory.Options().apply { inPreferredConfig = if (alpha) Bitmap.Config.ARGB_8888 else Bitmap.Config.RGB_565 }
        bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
        bmp?.prepareToDraw()
      }
    } catch (_: Throwable) {}
    val b = bmp
    Net.main.post {
      queued.remove(url)
      if (b == null) failed[url] = SystemClock.uptimeMillis()
      else { mem.put(url, Pic(b, SystemClock.uptimeMillis())); onLoaded?.invoke() }
    }
  }

  /** Blocking: the picture's real size (downloading it to the disk copy if needed). Null if it can't be had. */
  fun sizeNow(url: String): Pair<Int, Int>? {
    val f = file(url)
    if (!f.exists()) {
      val c = URL(url).openConnection() as HttpURLConnection
      c.connectTimeout = 8000; c.readTimeout = 12000
      try {
        if (c.responseCode !in 200..299) return null
        val bytes = c.inputStream.use { it.readBytes() }
        val tmp = File(f.path + ".t"); tmp.writeBytes(bytes); tmp.renameTo(f)
      } catch (_: Throwable) { return null } finally { c.disconnect() }
    }
    val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(f.path, o)
    return if (o.outWidth > 0) o.outWidth to o.outHeight else null
  }

  /** Keep the disk copy under ~160 MB, oldest used first out. */
  private fun trim() {
    val files = dir.listFiles() ?: return
    var total = files.sumOf { it.length() }
    if (total < 160L * 1024 * 1024) return
    for (f in files.sortedBy { it.lastModified() }) { total -= f.length(); f.delete(); if (total < 120L * 1024 * 1024) break }
  }

  private val m = Matrix()
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

  /** Draw `p` covering the box (cropped like CSS object-fit: cover), with rounded corners.
   *  `fy`: 0 = keep the top, 0.5 = centre. */
  fun draw(c: Canvas, p: Pic, box: RectF, radius: Float, alpha: Float = 1f, fy: Float = 0.5f) {
    val bw = p.bmp.width.toFloat(); val bh = p.bmp.height.toFloat()
    val s = maxOf(box.width() / bw, box.height() / bh)
    val dx = box.left + (box.width() - bw * s) / 2f
    val dy = box.top + (box.height() - bh * s) * fy
    m.setScale(s, s); m.postTranslate(dx, dy)
    p.shader.setLocalMatrix(m)
    paint.shader = p.shader
    paint.alpha = (alpha * 255).toInt().coerceIn(0, 255)
    if (radius > 0f) c.drawRoundRect(box, radius, radius, paint) else c.drawRect(box, paint)
    paint.shader = null
  }

  /** Draw `p` fitted inside the box (CSS object-fit: contain), anchored bottom-left. */
  fun drawContain(c: Canvas, p: Pic, box: RectF, alpha: Float = 1f) {
    val bw = p.bmp.width.toFloat(); val bh = p.bmp.height.toFloat()
    val s = minOf(box.width() / bw, box.height() / bh)
    m.setScale(s, s); m.postTranslate(box.left, box.bottom - bh * s)
    p.shader.setLocalMatrix(m)
    paint.shader = p.shader
    paint.alpha = (alpha * 255).toInt().coerceIn(0, 255)
    c.drawRect(box.left, box.bottom - bh * s, box.left + bw * s, box.bottom, paint)
    paint.shader = null
  }

  /** 0..1: how far a picture has faded in (260 ms, like the web screens). */
  fun fade(p: Pic, now: Long, fast: Boolean): Float = if (fast) 1f else ((now - p.at) / 260f).coerceIn(0f, 1f)
}
