package app.scrappy.player.tv

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** The whole sign-in flow against a stand-in Emby, by the remote and by the phone page. */
@RunWith(RobolectricTestRunner::class)
class SignLogicTest {
  private fun emby(): ServerSocket {
    val srv = ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"))
    thread(isDaemon = true) {
      while (true) {
        val s = try { srv.accept() } catch (e: Exception) { break }
        try {
          val inp = s.getInputStream().buffered()
          fun line(): String { val sb = StringBuilder(); while (true) { val c = inp.read(); if (c < 0 || c == '\n'.code) break; if (c != '\r'.code) sb.append(c.toChar()) }; return sb.toString() }
          val path = line().split(" ").getOrElse(1) { "/" }
          var n = 0
          while (true) { val l = line(); if (l.isEmpty()) break; if (l.lowercase().startsWith("content-length:")) n = l.substringAfter(':').trim().toInt() }
          val body = ByteArray(n); var got = 0
          while (got < n) { val k = inp.read(body, got, n - got); if (k < 0) break; got += k }
          val q = String(body)
          val (code, text) = when {
            path == "/System/Info/Public" -> 200 to """{"Id":"abc","ServerName":"Home"}"""
            path == "/Users/AuthenticateByName" -> if (q.contains("\"Pw\":\"right\"")) 200 to """{"AccessToken":"tok","User":{"Id":"u1"}}""" else 401 to ""
            path == "/Sessions/Logout" -> 204 to ""
            else -> 404 to "{}"
          }
          val b = text.toByteArray()
          s.getOutputStream().write(("HTTP/1.1 $code X\r\nContent-Type: application/json\r\nContent-Length: ${b.size}\r\nConnection: close\r\n\r\n").toByteArray() + b)
          s.getOutputStream().flush()
        } catch (e: Exception) {} finally { try { s.close() } catch (e: Exception) {} }
      }
    }
    return srv
  }

  private fun http(method: String, url: String, body: String? = null): String {
    val c = URL(url).openConnection() as HttpURLConnection
    c.requestMethod = method
    if (body != null) { c.doOutput = true; c.outputStream.use { it.write(body.toByteArray()) } }
    val code = c.responseCode
    return (if (code in 200..299) c.inputStream else c.errorStream).bufferedReader().readText()
  }

  @Test fun remoteAndPhone() {
    val srv = emby(); val base = "127.0.0.1:${srv.localPort}"
    val f = File.createTempFile("config", ".json").apply { writeText("{\"deviceId\":\"dev\"}") }
    var addrs = JSONObject(); var changes = 0; var opened = 0
    val pushes = ArrayList<JSONObject>()
    var wait = CountDownLatch(0)
    val logic = SignLogic(object : SignLogic.Io {
      override val file = f
      override val device = "TV"; override val version = "1.0"
      override fun savedAddrs() = JSONObject(addrs.toString())
      override fun saveAddrs(o: JSONObject) { addrs = o }
      override fun phonePage() = "<html>phone page</html>"
      override fun ui(work: () -> Unit) = work()
      override fun changed(then: () -> Unit) { changes++; then() }
      override fun push(model: JSONObject) { pushes.add(model); wait.countDown() }
      override fun open() { opened++ }
    })
    fun ask(a: String, x: JSONObject = JSONObject()): JSONObject {
      val gate = CountDownLatch(1); var out = JSONObject()
      logic.act(a, x) { out = it; gate.countDown() }
      assertTrue(gate.await(20, TimeUnit.SECONDS)); return out
    }

    val m = ask("start")
    assertEquals(3, m.getJSONArray("servers").length())
    assertTrue(m.isNull("shared"))
    // The stand-in machine may have no network address; the phone part is checked only when it has one.
    val qr = m.optJSONArray("qr")

    // By the remote: address, wrong password, right password.
    assertEquals("http://$base", ask("check", JSONObject().put("kind", "emby").put("address", base)).optString("address"))
    assertTrue(addrs.getJSONObject("emby").optBoolean("ok"))
    val bad = ask("login", JSONObject().put("kind", "emby").put("address", base).put("user", "jay").put("pass", "wrong"))
    assertEquals("Wrong username or password.", bad.optString("err")); assertEquals(0, changes)
    val ok = ask("login", JSONObject().put("kind", "emby").put("address", base).put("user", "jay").put("pass", "right"))
    assertTrue(ok.optBoolean("ok")); assertEquals(1, changes)
    val e = ok.getJSONObject("model").getJSONArray("servers").getJSONObject(0)
    assertTrue(e.optBoolean("signedIn")); assertEquals("jay", e.optString("user"))
    assertEquals("Emby", ok.getJSONObject("model").getJSONObject("shared").optString("from"))
    assertTrue(!addrs.has("emby"))
    val saved = f.readText()
    assertTrue(saved.contains("\"tok\"") && !saved.contains("right") && saved.contains("\"dev\""))
    assertEquals(1, Store.load(f).count)

    // "Same username and password" on a server that is not there says so, and nothing changes.
    assertTrue(ask("same", JSONObject().put("kind", "navidrome").put("address", base)).optString("err").isNotEmpty())

    // Sign out: the address and name stay, the token goes.
    val out = ask("logout", JSONObject().put("kind", "emby"))
    assertTrue(!out.getJSONObject("model").getJSONArray("servers").getJSONObject(0).optBoolean("signedIn"))
    assertTrue(!f.readText().contains("\"tok\""))

    // By the phone.
    if (qr != null) assertEquals(qr.length(), qr.getString(0).length)
    val pair = PhonePage("<html>phone page</html>") { _, _ -> }
    val link = pair.start("127.0.0.1")!!
    assertEquals("<html>phone page</html>", http("GET", link))
    assertEquals("{}", http("GET", "$link/state"))
    assertEquals("This sign-in link is no longer active.", http("GET", link + "x"))
    pair.stop()

    assertEquals(0, opened)
    ask("open"); assertEquals(1, opened)
    assertTrue(ask("stop").optBoolean("ok"))
    srv.close(); f.delete()
  }

  /** The phone page's requests reach the logic and their results come back in its state. */
  @Test fun phonePosts() {
    val got = ArrayList<String>(); val gate = CountDownLatch(2)
    val pair = PhonePage("page") { what, body -> got.add(what + ":" + body.optString("kind")); gate.countDown() }
    val link = pair.start("127.0.0.1")!!
    pair.state = "{\"v\":2}"
    assertEquals("{\"ok\":true}", http("POST", "$link/act", "{\"kind\":\"emby\",\"act\":\"check\"}"))
    assertEquals("{\"ok\":true}", http("POST", "$link/login", "{\"kind\":\"navidrome\"}"))
    assertEquals("bad request", http("POST", "$link/login", "not json"))
    assertTrue(gate.await(5, TimeUnit.SECONDS))
    assertEquals(listOf("act:emby", "login:navidrome"), got)
    assertEquals("{\"v\":2}", http("GET", "$link/state"))
    pair.stop()
  }
}
