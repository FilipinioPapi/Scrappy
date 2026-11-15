package app.scrappy.player.tv

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL

/**
 * Finding and signing in to the three servers (Emby, Navidrome, Audiobookshelf), the same steps and
 * the same wording as the Rust side (emby.rs, servers.rs, lib.rs server_check / server_login).
 * Everything here blocks: call it from a background thread. Passwords are sent once and never kept;
 * only the token a server hands back is saved.
 */
object Servers {
  class Failed(msg: String) : Exception(msg)
  class Found(val address: String, val name: String)

  const val CLIENT = "Scrappy Media Center"
  private const val SUBSONIC = "1.16.1"
  private val HOME_ENDS = listOf(".local", ".lan", ".home", ".internal", ".localdomain")

  /** Turns whatever was typed ("192.168.1.10:8096", "https://emby.me/") into a clean base address. */
  fun normalize(input: String): String {
    var s = input.trim().trimEnd('/')
    if (!s.startsWith("http://") && !s.startsWith("https://")) {
      // A bare public name gets a secure connection, so a sign-in never crosses the internet in the
      // clear. Home addresses (numbers, a port, .local and friends) stay on plain http.
      val host = s.substringBefore('/').lowercase()
      val home = host.contains(':') || !host.contains('.') || host.all { it.isDigit() || it == '.' } || HOME_ENDS.any { host.endsWith(it) }
      s = (if (home) "http" else "https") + "://" + s
    }
    // The web app's address was pasted: drop the web part.
    for (suffix in listOf("/web/index.html", "/web")) if (s.endsWith(suffix)) s = s.removeSuffix(suffix)
    return s
  }

  private class Reply(val code: Int, val text: String) {
    val ok get() = code in 200..299
    val json: JSONObject? get() = try { JSONObject(text) } catch (e: Exception) { null }
  }

  private fun friendly(e: Exception): String = when (e) {
    is SocketTimeoutException -> "The server took too long to answer."
    is java.net.ConnectException, is java.net.UnknownHostException, is java.net.NoRouteToHostException ->
      "Couldn't reach the server. Check the address and that the server is running."
    else -> "Network error: ${e.message ?: e.javaClass.simpleName}"
  }

  /** One request. Throws Failed with words fit for the screen when the server can't be reached. */
  private fun call(method: String, url: String, body: JSONObject? = null, headers: Map<String, String> = emptyMap()): Reply {
    val c = try { URL(url).openConnection() as HttpURLConnection } catch (e: Exception) { throw Failed(friendly(e)) }
    try {
      c.connectTimeout = 8000; c.readTimeout = 30000
      c.requestMethod = method
      c.setRequestProperty("Accept", "application/json")
      for ((k, v) in headers) c.setRequestProperty(k, v)
      if (body != null) {
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        c.outputStream.use { it.write(body.toString().toByteArray()) }
      }
      val code = c.responseCode
      val text = try { (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: "" } catch (e: Exception) { "" }
      return Reply(code, text)
    } catch (e: Failed) { throw e } catch (e: Exception) { throw Failed(friendly(e)) } finally { c.disconnect() }
  }

  /** Tries each address in turn; the first that `looks` right wins, else the last reason is given. */
  private fun find(candidates: List<String>, path: String, looks: (Reply, String) -> Found?, not: String, anyStatus: Boolean = false): Found {
    var last = ""
    for (base in candidates) {
      val r = try { call("GET", base + path) } catch (e: Failed) { last = e.message ?: ""; continue }
      if (!r.ok && !anyStatus) { last = "The server answered with an error (${r.code})."; continue }
      looks(r, base)?.let { return it }
      last = not
    }
    throw Failed(last)
  }

  /** Emby: the address as typed, then with "/emby" added (some setups need it). */
  fun findEmby(input: String): Found {
    val base = normalize(input)
    return find(listOf(base, "$base/emby"), "/System/Info/Public", { r, at ->
      val v = r.json
      if (v != null && (v.has("Id") || v.has("ServerName"))) Found(at, v.optString("ServerName").ifEmpty { "Emby" }) else null
    }, "That address answered, but it doesn't look like an Emby server.")
  }

  /** Navidrome: Subsonic answers ping even without a login. */
  fun findMusic(input: String): Found {
    val base = normalize(input)
    return find(listOf(base, "$base/navidrome", "$base/music"), "/rest/ping.view?f=json&v=$SUBSONIC&c=Scrappy", { r, at ->
      val sr = r.json?.optJSONObject("subsonic-response") ?: return@find null
      val type = if (sr.has("type") && !sr.isNull("type")) sr.optString("type") else "navidrome"
      Found(at, if (type == "navidrome") "Navidrome" else type)
    }, "That address answered, but it doesn't look like Navidrome.", anyStatus = true)
  }

  fun findBooks(input: String): Found {
    val base = normalize(input)
    return find(listOf(base, "$base/audiobookshelf"), "/status", { r, at ->
      val v = r.json ?: return@find null
      if (!(v.has("isInit") || v.optString("app") == "audiobookshelf")) return@find null
      if (v.has("isInit") && !v.optBoolean("isInit", true)) throw Failed("Audiobookshelf is there, but it hasn't been set up yet. Open it in a browser first.")
      Found(at, "Audiobookshelf")
    }, "That address answered, but it doesn't look like Audiobookshelf.")
  }

  /** Step 1 of signing in: is there really a server of that kind there? */
  fun check(kind: String, address: String): Found {
    if (address.isBlank()) throw Failed("Enter your server address.")
    return when (kind) {
      "emby" -> findEmby(address)
      "navidrome" -> findMusic(address)
      "audiobookshelf" -> findBooks(address)
      else -> throw Failed("Unknown server type.")
    }
  }

  /** The header Emby uses to tell which app and device this is (and who, once signed in). */
  fun embyAuth(deviceId: String, device: String, version: String, userId: String = "", token: String = ""): String {
    val h = StringBuilder("Emby Client=\"$CLIENT\", Device=\"${device.replace("\"", "")}\", DeviceId=\"$deviceId\", Version=\"$version\"")
    if (userId.isNotEmpty()) h.append(", UserId=\"$userId\"")
    if (token.isNotEmpty()) h.append(", Token=\"$token\"")
    return h.toString()
  }

  private fun rejected(r: Reply, word: String) {
    if (r.code == 401) throw Failed("Wrong username or password.")
    if (!r.ok) throw Failed("$word failed (${r.code}).")
  }

  /**
   * Step 2: sign in with the address typed, and put what the server hands back into the store's
   * current sign-ins. The caller saves the store. The password goes no further than this call.
   */
  fun login(store: Store, kind: String, address: String, username: String, password: String, device: String, version: String) {
    if (kind == "emby" && address.isBlank()) throw Failed("Enter your server address.")
    val user = username.trim()
    if (user.isEmpty()) throw Failed("Enter your username.")
    when (kind) {
      "emby" -> {
        val at = findEmby(address)
        if (store["deviceId"].isEmpty()) store["deviceId"] = Store.newId()
        val r = call("POST", at.address + "/Users/AuthenticateByName", JSONObject().put("Username", user).put("Pw", password),
          mapOf("X-Emby-Authorization" to embyAuth(store["deviceId"], device, version)))
        rejected(r, "Login")
        val v = r.json ?: throw Failed("Emby didn't return a login token.")
        val token = v.optString("AccessToken"); val id = v.optJSONObject("User")?.optString("Id") ?: ""
        if (token.isEmpty() || id.isEmpty()) throw Failed("Emby didn't return a login token.")
        store["server"] = at.address; store["serverName"] = at.name; store["userName"] = user; store["token"] = token; store["userId"] = id
      }
      "navidrome" -> {
        val at = findMusic(address)
        val r = call("POST", at.address + "/auth/login", JSONObject().put("username", user).put("password", password))
        rejected(r, "Sign-in")
        val v = r.json ?: throw Failed("Navidrome didn't return a login token.")
        val salt = v.optString("subsonicSalt"); val token = v.optString("subsonicToken")
        if (salt.isEmpty() || token.isEmpty()) throw Failed("Navidrome didn't return a login token.")
        store["ndJwt"] = v.optString("token"); store["ndServer"] = at.address; store["ndName"] = at.name
        store["ndUser"] = v.optString("username").ifEmpty { user }; store["ndSalt"] = salt; store["ndToken"] = token
      }
      "audiobookshelf" -> {
        val at = findBooks(address)
        val r = call("POST", at.address + "/login", JSONObject().put("username", user).put("password", password))
        rejected(r, "Sign-in")
        val u = r.json?.optJSONObject("user") ?: throw Failed("Audiobookshelf didn't return a login token.")
        // The long-lived token; newer servers also send short-lived ones that aren't needed.
        val token = u.optString("token").ifEmpty { u.optString("accessToken") }
        if (token.isEmpty()) throw Failed("Audiobookshelf didn't return a login token.")
        store["absServer"] = at.address; store["absName"] = at.name; store["absUser"] = u.optString("username").ifEmpty { user }; store["absToken"] = token
      }
      else -> throw Failed("Unknown server type.")
    }
  }

  /** Tells Emby to forget a token. Failures are ignored (the server may be off). */
  fun forgetEmby(server: String, userId: String, token: String, deviceId: String, device: String, version: String) {
    if (server.isEmpty() || token.isEmpty()) return
    try { call("POST", "$server/Sessions/Logout", null, mapOf("X-Emby-Authorization" to embyAuth(deviceId, device, version, userId, token), "X-Emby-Token" to token)) } catch (e: Failed) {}
  }

  /** Sign out of one server. The address and username stay filled in for next time. The caller saves the store. */
  fun logout(store: Store, kind: String, device: String, version: String) {
    when (kind) {
      "emby" -> {
        if (store.embyIn) forgetEmby(store["server"], store["userId"], store["token"], store["deviceId"], device, version)
        store["token"] = ""; store["userId"] = ""
      }
      "navidrome" -> { store["ndToken"] = ""; store["ndSalt"] = ""; store["ndJwt"] = "" }
      "audiobookshelf" -> {
        if (store.booksIn) try { call("POST", store["absServer"] + "/logout", null, mapOf("Authorization" to "Bearer " + store["absToken"])) } catch (e: Failed) {}
        store["absToken"] = ""
      }
      else -> throw Failed("Unknown server type.")
    }
  }
}
