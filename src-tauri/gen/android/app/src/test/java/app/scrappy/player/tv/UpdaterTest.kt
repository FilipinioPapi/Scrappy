package app.scrappy.player.tv

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** The update steps against a stand-in release page on this machine. */
@RunWith(RobolectricTestRunner::class)
class UpdaterTest {
  @Test fun small() {
    assertTrue(Updater.newer("0.3.100", "0.3.99")); assertFalse(Updater.newer("0.3.99", "0.3.99")); assertFalse(Updater.newer("0.3.9", "0.3.10"))
    assertTrue(Updater.newer("0.4", "0.3.99")); assertFalse(Updater.newer("", "0.1")); assertTrue(Updater.newer("0.3.1.1", "0.3.1"))
    assertEquals(listOf("One", "Two"), Updater.notes("- One\n\n * Two\n"))
    assertEquals(listOf("a", "b", "c", "d", "e"), Updater.notes(JSONArray(listOf("• a", "b", "c", "d", "e", "f"))))
    assertEquals(emptyList<String>(), Updater.notes(JSONObject.NULL))
    assertEquals("about 2 min left", Updater.left(10, 100, 12.0)); assertEquals("about 30 seconds left", Updater.left(50, 100, 30.0)); assertEquals("", Updater.left(99, 100, 30.0))
    assertEquals(1L, Updater.mb(10)); assertEquals(38L, Updater.mb(39_500_000))
  }

  private fun serve(files: Map<String, ByteArray>): ServerSocket {
    val srv = ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"))
    thread(isDaemon = true) {
      while (true) {
        val s = try { srv.accept() } catch (e: Exception) { break }
        try {
          val inp = s.getInputStream().buffered()
          fun line(): String { val sb = StringBuilder(); while (true) { val c = inp.read(); if (c < 0 || c == '\n'.code) break; if (c != '\r'.code) sb.append(c.toChar()) }; return sb.toString() }
          val path = line().split(" ").getOrElse(1) { "/" }
          while (line().isNotEmpty()) {}
          val b = files[path]
          val out = s.getOutputStream()
          if (b == null) out.write("HTTP/1.1 404 X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
          else { out.write("HTTP/1.1 200 OK\r\nContent-Length: ${b.size}\r\nConnection: close\r\n\r\n".toByteArray()); out.write(b) }
          out.flush()
        } catch (e: Exception) {} finally { try { s.close() } catch (e: Exception) {} }
      }
    }
    return srv
  }

  private class Fake(override val base: String, override val current: String, override val cacheDir: File) : Updater.Io {
    val cards = ArrayList<JSONObject>(); val toasts = ArrayList<String>(); var installed: File? = null; var isPlaying = false
    var gate = CountDownLatch(1); var until = ""
    override fun ui(work: () -> Unit) = synchronized(this) { work() }
    override fun card(o: JSONObject) { cards.add(o); if (o.optString("step") == until) gate.countDown() }
    override fun toast(msg: String, bad: Boolean) { toasts.add(msg); if (until == "toast") gate.countDown() }
    override fun playing() = isPlaying
    override fun install(apk: File) { installed = apk }
    fun waitFor(step: String, go: () -> Unit) { until = step; gate = CountDownLatch(1); go(); assertTrue("waiting for $step", gate.await(15, TimeUnit.SECONDS)) }
  }

  @Test fun checkDownloadInstall() {
    val apk = ByteArray(300_000) { (it % 251).toByte() }
    val dir = File.createTempFile("cache", "").apply { delete(); mkdirs() }
    var srv = serve(mapOf("/dl/tv-native/tv.json" to """{"version":"0.3.101","size":${apk.size},"notes":"- Faster start\n- Fixes"}""".toByteArray(), "/dl/tv-native/Scrappy-TV.apk" to apk))
    var io = Fake("http://127.0.0.1:${srv.localPort}/dl/tv-native", "0.3.100", dir)
    var u = Updater(io)
    io.waitFor("ask") { u.check(false) }
    val ask = io.cards.last()
    assertEquals("0.3.101", ask.optString("version")); assertEquals("0.3.100", ask.optString("current")); assertEquals("Faster start", ask.getJSONArray("notes").getString(0))
    io.waitFor("ready") { u.act("go") }
    assertEquals(apk.size.toLong(), io.installed!!.length())
    assertTrue(io.installed!!.readBytes().contentEquals(apk))
    assertTrue(io.cards.any { it.optString("step") == "get" && it.optString("gotText") == "Starting…" })
    u.act("later"); assertEquals("", io.cards.last().optString("step"))
    srv.close()

    // Up to date: a manual check says so and the old download is cleared; an automatic one stays quiet.
    srv = serve(mapOf("/dl/tv-native/tv.json" to """{"version":"0.3.100","size":1}""".toByteArray()))
    io = Fake("http://127.0.0.1:${srv.localPort}/dl/tv-native", "0.3.100", dir); u = Updater(io)
    io.waitFor("toast") { u.check(true) }
    assertEquals("You're up to date.", io.toasts.last()); assertFalse(File(dir, "updates/Scrappy-TV.apk").exists())
    srv.close()

    // A file of the wrong size is refused, and one from somewhere else is never fetched.
    srv = serve(mapOf("/dl/tv-native/tv.json" to """{"version":"0.4.0","size":${apk.size + 5}}""".toByteArray(), "/dl/tv-native/Scrappy-TV.apk" to apk))
    io = Fake("http://127.0.0.1:${srv.localPort}/dl/tv-native", "0.3.100", dir); u = Updater(io)
    io.waitFor("ask") { u.check(true) }
    io.waitFor("fail") { u.act("go") }
    assertEquals("The download came through incomplete. Try again.", io.cards.last().optString("err")); assertEquals(null, io.installed)
    srv.close()
    srv = serve(mapOf("/dl/tv-native/tv.json" to """{"version":"0.4.0","size":3,"url":"http://example.invalid/evil.apk"}""".toByteArray()))
    io = Fake("http://127.0.0.1:${srv.localPort}/dl/tv-native", "0.3.100", dir); u = Updater(io)
    io.waitFor("ask") { u.check(true) }
    io.waitFor("fail") { u.act("go") }
    assertEquals("The update list points somewhere unexpected.", io.cards.last().optString("err"))
    srv.close()

    // While a film plays, an automatic check does not interrupt.
    srv = serve(mapOf("/dl/tv-native/tv.json" to """{"version":"0.4.0","size":3}""".toByteArray()))
    io = Fake("http://127.0.0.1:${srv.localPort}/dl/tv-native", "0.3.100", dir); io.isPlaying = true; u = Updater(io)
    u.check(false); Thread.sleep(800); assertEquals(0, io.cards.size)
    srv.close(); dir.deleteRecursively()
  }
}
