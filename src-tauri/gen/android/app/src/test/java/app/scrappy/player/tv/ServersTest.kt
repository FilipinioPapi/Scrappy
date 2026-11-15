package app.scrappy.player.tv

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread

/** Sign-in against a stand-in server on this machine that answers the way each real one does. */
@RunWith(RobolectricTestRunner::class)
class ServersTest {
  private lateinit var srv: ServerSocket
  private var base = ""
  private var lastAuth = ""

  /** What the stand-in answers for a path and what was sent to it. Emby lives under /emby, so the plain address has to fail first. */
  private fun answer(path: String, headers: Map<String, String>, q: String): Pair<Int, String> = when {
    path == "/emby/System/Info/Public" -> 200 to """{"Id":"abc","ServerName":"Home"}"""
    path == "/emby/Users/AuthenticateByName" -> {
      lastAuth = headers["x-emby-authorization"] ?: ""
      if (q.contains("\"Pw\":\"right\"")) 200 to """{"AccessToken":"tok","User":{"Id":"u1"}}""" else 401 to ""
    }
    path.startsWith("/rest/ping.view") -> 200 to """{"subsonic-response":{"status":"failed","type":"navidrome"}}"""
    path == "/auth/login" -> if (q.contains("right")) 200 to """{"username":"Jay","subsonicSalt":"salt","subsonicToken":"st","token":"jwt"}""" else 401 to ""
    path == "/status" -> 200 to """{"app":"audiobookshelf","isInit":true}"""
    path == "/login" -> if (q.contains("right")) 200 to """{"user":{"username":"jay","token":"abs"}}""" else 401 to ""
    else -> 404 to "{}"
  }

  @Before fun up() {
    srv = ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"))
    base = "127.0.0.1:${srv.localPort}"
    thread(isDaemon = true) {
      while (true) {
        val s = try { srv.accept() } catch (e: Exception) { break }
        try {
          val inp = s.getInputStream().buffered()
          fun line(): String { val sb = StringBuilder(); while (true) { val c = inp.read(); if (c < 0 || c == '\n'.code) break; if (c != '\r'.code) sb.append(c.toChar()) }; return sb.toString() }
          val path = line().split(" ").getOrElse(1) { "/" }
          val headers = HashMap<String, String>()
          while (true) { val l = line(); if (l.isEmpty()) break; headers[l.substringBefore(':').trim().lowercase()] = l.substringAfter(':').trim() }
          val n = headers["content-length"]?.toIntOrNull() ?: 0
          val body = ByteArray(n); var got = 0
          while (got < n) { val k = inp.read(body, got, n - got); if (k < 0) break; got += k }
          val (code, text) = answer(path, headers, String(body))
          val b = text.toByteArray()
          s.getOutputStream().write(("HTTP/1.1 $code X\r\nContent-Type: application/json\r\nContent-Length: ${b.size}\r\nConnection: close\r\n\r\n").toByteArray() + b)
          s.getOutputStream().flush()
        } catch (e: Exception) {} finally { try { s.close() } catch (e: Exception) {} }
      }
    }
  }
  @After fun down() { srv.close() }

  private fun why(f: () -> Unit): String = try { f(); "" } catch (e: Servers.Failed) { e.message ?: "?" }

  @Test fun addresses() {
    assertEquals("http://192.168.1.10:8096", Servers.normalize(" 192.168.1.10:8096/ "))
    assertEquals("https://movies.example.com", Servers.normalize("movies.example.com/web/index.html"))
    assertEquals("http://nas", Servers.normalize("nas"))
    assertEquals("http://tower.local", Servers.normalize("tower.local/web"))
    assertEquals("http://plain.example.com", Servers.normalize("http://plain.example.com/"))
  }

  @Test fun findsAndSignsIn() {
    val e = Servers.check("emby", base)
    assertEquals("http://$base/emby", e.address); assertEquals("Home", e.name)
    assertEquals("Navidrome", Servers.check("navidrome", base).name)
    assertEquals("Audiobookshelf", Servers.check("audiobookshelf", base).name)
    assertEquals("Enter your server address.", why { Servers.check("emby", "  ") })

    val c = Store()
    assertEquals("Wrong username or password.", why { Servers.login(c, "emby", base, "jay", "wrong", "TV", "1.0") })
    assertTrue(!c.embyIn)
    assertEquals("Enter your username.", why { Servers.login(c, "emby", base, " ", "right", "TV", "1.0") })
    Servers.login(c, "emby", base, " jay ", "right", "TV", "1.0")
    assertTrue(c.embyIn); assertEquals("tok", c["token"]); assertEquals("u1", c["userId"]); assertEquals("jay", c["userName"]); assertEquals("Home", c["serverName"])
    assertTrue(lastAuth.startsWith("Emby Client=\"Scrappy Media Center\", Device=\"TV\", DeviceId=\"${c["deviceId"]}\", Version=\"1.0\""))
    assertTrue(!lastAuth.contains("Token"))

    assertEquals("Wrong username or password.", why { Servers.login(c, "navidrome", base, "jay", "wrong", "TV", "1.0") })
    Servers.login(c, "navidrome", base, "jay", "right", "TV", "1.0")
    assertTrue(c.musicIn); assertEquals("Jay", c["ndUser"]); assertEquals("salt", c["ndSalt"]); assertEquals("st", c["ndToken"]); assertEquals("jwt", c["ndJwt"])
    Servers.login(c, "audiobookshelf", base, "jay", "right", "TV", "1.0")
    assertTrue(c.booksIn); assertEquals("abs", c["absToken"])

    // No password anywhere in what gets saved.
    assertTrue(!c.toString().contains("right"))

    Servers.logout(c, "emby", "TV", "1.0"); Servers.logout(c, "navidrome", "TV", "1.0"); Servers.logout(c, "audiobookshelf", "TV", "1.0")
    assertTrue(!c.embyIn && !c.musicIn && !c.booksIn)
    assertEquals("http://$base/emby", c["server"]); assertEquals("jay", c["userName"])
  }

  @Test fun nothingThere() {
    srv.close()
    assertEquals("Couldn't reach the server. Check the address and that the server is running.", why { Servers.check("emby", base) })
  }
}
