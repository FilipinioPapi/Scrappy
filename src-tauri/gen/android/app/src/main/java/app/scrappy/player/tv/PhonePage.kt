package app.scrappy.player.tv

import org.json.JSONObject
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import kotlin.concurrent.thread

/**
 * Sign in with your phone. While the sign-in screen is open the app serves one small page on the
 * home network; the TV shows a QR code that links to it with a one-time code. What is typed on the
 * phone is handed to the sign-in logic, which signs in exactly like the remote would. Nothing
 * leaves the house, and the page stops the moment the sign-in screen closes.
 */
class PhonePage(private val page: String, private val fromPhone: (what: String, body: JSONObject) -> Unit) {
  /** What the phone page shows: which servers are signed in, and the result of its last try. */
  @Volatile var state = "{}"
  var url = ""; private set
  private var server: ServerSocket? = null
  private var code = ""

  /** The address this TV has on the home network. No packet is sent: this only asks which one it would use. */
  private fun localIp(): String? = try {
    DatagramSocket().use { s ->
      s.connect(InetAddress.getByName("192.0.2.1"), 9)
      val ip = s.localAddress
      if (ip.isLoopbackAddress || ip.isAnyLocalAddress) null else ip.hostAddress
    }
  } catch (e: Exception) { null }

  /** Starts the page and returns its link, or null when the TV is not on a network. */
  fun start(ip: String? = localIp()): String? {
    stop()
    if (ip == null) return null
    val s = try { ServerSocket(0) } catch (e: Exception) { return null }
    server = s
    code = UUID.randomUUID().toString().replace("-", "").take(10)
    url = "http://$ip:${s.localPort}/$code"
    val mine = code
    thread(isDaemon = true, name = "pair") {
      while (!s.isClosed) {
        val c = try { s.accept() } catch (e: Exception) { break }
        try { handle(c, mine) } catch (e: Exception) {} finally { try { c.close() } catch (e: Exception) {} }
      }
    }
    return url
  }

  fun stop() {
    try { server?.close() } catch (e: Exception) {}
    server = null; url = ""; state = "{}"
  }

  private fun reply(c: Socket, status: String, type: String, body: String) {
    val b = body.toByteArray()
    val out = c.getOutputStream()
    out.write("HTTP/1.1 $status\r\nContent-Type: $type\r\nContent-Length: ${b.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".toByteArray())
    out.write(b); out.flush()
  }

  private fun handle(c: Socket, code: String) {
    c.soTimeout = 4000
    val inp = c.getInputStream()
    val buf = java.io.ByteArrayOutputStream()
    val tmp = ByteArray(2048)
    var headEnd = -1
    while (headEnd < 0 && buf.size() < 16384) {
      val n = inp.read(tmp); if (n <= 0) break
      buf.write(tmp, 0, n)
      headEnd = String(buf.toByteArray(), Charsets.ISO_8859_1).indexOf("\r\n\r\n")
    }
    if (headEnd < 0) return
    val all = buf.toByteArray()
    val head = String(all, 0, headEnd, Charsets.ISO_8859_1)
    val first = head.lineSequence().firstOrNull().orEmpty().split(' ')
    val method = first.getOrElse(0) { "" }; val path = first.getOrElse(1) { "" }
    val len = (head.lineSequence().firstOrNull { it.lowercase().startsWith("content-length:") }?.substringAfter(':')?.trim()?.toIntOrNull() ?: 0).coerceIn(0, 8192)
    val body = java.io.ByteArrayOutputStream().apply { write(all, headEnd + 4, all.size - headEnd - 4) }
    while (body.size() < len) { val n = inp.read(tmp); if (n <= 0) break; body.write(tmp, 0, n) }
    val base = "/$code"
    when {
      method == "GET" && path == base -> reply(c, "200 OK", "text/html; charset=utf-8", page)
      method == "GET" && path == "$base/state" -> reply(c, "200 OK", "application/json", state.ifEmpty { "{}" })
      method == "POST" && (path == "$base/login" || path == "$base/act") -> {
        val v = try { JSONObject(String(body.toByteArray(), Charsets.UTF_8)) } catch (e: Exception) { null }
        if (v == null) reply(c, "400 Bad Request", "text/plain", "bad request")
        else { reply(c, "200 OK", "application/json", "{\"ok\":true}"); fromPhone(if (path.endsWith("/act")) "act" else "login", v) }
      }
      else -> reply(c, "404 Not Found", "text/plain", "This sign-in link is no longer active.")
    }
  }
}
