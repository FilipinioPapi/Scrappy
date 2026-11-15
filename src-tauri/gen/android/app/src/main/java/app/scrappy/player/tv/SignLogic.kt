package app.scrappy.player.tv

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * What the sign-in screen (Signin.kt) asks for: checks an address, signs in, skips a server, and runs
 * the phone page while the screen is open. The last username and password used here are kept in
 * memory only, for "Same username and password", and are dropped when the screen closes. Only the
 * tokens the servers hand back are ever saved.
 */
class SignLogic(private val io: Io) {
  interface Io {
    /** The saved sign-ins (config.json). */
    val file: File
    val device: String
    val version: String
    /** Addresses typed earlier, kept so a half-finished sign-in can carry on: kind -> { address, ok }. */
    fun savedAddrs(): JSONObject
    fun saveAddrs(o: JSONObject)
    /** The phone page, or "" when there is none. */
    fun phonePage(): String
    fun ui(work: () -> Unit)
    /** The saved sign-ins changed: anything else holding a copy catches up, then `then` runs. */
    fun changed(then: () -> Unit)
    /** Something happened away from the remote (the phone): the sign-in screen catches up. */
    fun push(model: JSONObject)
    /** Leave the sign-in screen for the first section that is signed in. */
    fun open()
  }

  private class Kind(val kind: String, val name: String, val what: String, val eg: String)
  private val kinds = listOf(
    Kind("emby", "Emby", "Movies & TV", "192.168.1.20:8096"),
    Kind("navidrome", "Navidrome", "Music", "192.168.1.20:4533"),
    Kind("audiobookshelf", "Audiobookshelf", "Audiobooks", "192.168.1.20:13378"),
  )
  private class Shared(val user: String, val pass: String, val from: String, val kind: String)

  // One thing at a time, in order, off the main thread.
  private val work = Executors.newSingleThreadExecutor { r -> Thread(r, "signin").apply { isDaemon = true } }
  private var shared: Shared? = null
  private val results = HashMap<String, JSONObject>()
  private val skipped = HashSet<String>()
  private val checked = HashMap<String, String>()
  private var qr: JSONArray? = null
  private var on = false
  private var pair: PhonePage? = null

  private fun store() = Store.load(io.file)
  private fun signedIn(c: Store, kind: String) = when (kind) { "emby" -> c.embyIn; "navidrome" -> c.musicIn; else -> c.booksIn }
  private fun userOf(c: Store, kind: String) = c[when (kind) { "emby" -> "userName"; "navidrome" -> "ndUser"; else -> "absUser" }]
  private fun addrOf(c: Store, kind: String) = c[when (kind) { "emby" -> "server"; "navidrome" -> "ndServer"; else -> "absServer" }]

  private fun remember(kind: String, v: JSONObject?) {
    val s = io.savedAddrs()
    if (v != null) s.put(kind, v) else s.remove(kind)
    io.saveAddrs(s)
  }

  private fun model(): JSONObject {
    val c = store()
    val saved = io.savedAddrs()
    val servers = JSONArray()
    for (k in kinds) {
      val inn = signedIn(c, k.kind)
      servers.put(
        JSONObject().put("kind", k.kind).put("name", k.name).put("what", k.what).put("eg", k.eg).put("signedIn", inn).put("user", userOf(c, k.kind))
          .put("address", addrOf(c, k.kind)).put("saved", if (!inn) saved.optJSONObject(k.kind) ?: JSONObject.NULL else JSONObject.NULL).put("skipped", k.kind in skipped),
      )
    }
    val sh = shared
    val pic = if (sh?.kind == "emby" && c["userId"].isNotEmpty() && c["server"].isNotEmpty())
      c["server"] + "/Users/" + java.net.URLEncoder.encode(c["userId"], "UTF-8") + "/Images/Primary?maxWidth=160&quality=90" else ""
    return JSONObject().put("servers", servers)
      .put("shared", if (sh != null) JSONObject().put("from", sh.from).put("user", sh.user).put("pic", pic) else JSONObject.NULL)
      .put("qr", qr ?: JSONObject.NULL)
  }

  /** The phone page's view of things. */
  private fun pushPhone(m: JSONObject) {
    val servers = JSONArray()
    val a = m.getJSONArray("servers")
    for (i in 0 until a.length()) {
      val x = a.getJSONObject(i); val kind = x.optString("kind")
      val address = checked[kind] ?: x.optJSONObject("saved")?.optString("address")?.ifEmpty { null } ?: x.optString("address")
      servers.put(
        JSONObject().put("kind", kind).put("name", x.optString("name")).put("what", x.optString("what")).put("signedIn", x.optBoolean("signedIn"))
          .put("user", x.optString("user")).put("skipped", x.optBoolean("skipped")).put("address", address).put("checked", kind in checked),
      )
    }
    val res = JSONObject(); for ((k, v) in results) res.put(k, v)
    pair?.state = JSONObject().put("v", 2).put("servers", servers).put("results", res).put("same", shared != null).toString()
  }

  private fun push(ev: JSONObject? = null): JSONObject {
    val m = model()
    pushPhone(m)
    if (ev != null) { val out = JSONObject(m.toString()).put("ev", ev); io.ui { io.push(out) } }
    return m
  }

  /** Waits until everything else has caught up with the saved sign-ins. */
  private fun settle() {
    val gate = java.util.concurrent.CountDownLatch(1)
    io.ui { io.changed { gate.countDown() } }
    gate.await(6, java.util.concurrent.TimeUnit.SECONDS)
  }

  private fun signIn(kind: String, address: String, user: String, pass: String) {
    val k = kinds.first { it.kind == kind }
    val c = store()
    Servers.login(c, kind, address, user, pass, io.device, io.version)
    c.stash()
    c.save(io.file)
    settle()
    shared = Shared(user, pass, k.name, kind)
    remember(kind, null)
    skipped.remove(kind)
  }

  private fun check(kind: String, address: String): String {
    val r = Servers.check(kind, address.trim())
    checked[kind] = r.address
    remember(kind, JSONObject().put("address", r.address).put("ok", true))
    return r.address
  }

  private fun phone(what: String, p: JSONObject) = work.execute {
    if (!on) return@execute
    val kind = kinds.firstOrNull { it.kind == p.optString("kind") }?.kind
    val n = p.opt("n")
    if (what == "login") {
      if (kind == null) return@execute
      try {
        // A sign-in that the phone typed. Same as the remote, and "same" reuses the last one.
        val sh = shared
        val same = p.optBoolean("same") && sh != null
        signIn(kind, p.optString("address"), if (same) sh!!.user else p.optString("user"), if (same) sh!!.pass else p.optString("pass"))
        results[kind] = JSONObject().put("ok", true).put("n", n).put("phase", "login")
        push(JSONObject().put("kind", kind).put("what", "login").put("ok", true))
      } catch (e: Exception) {
        val err = e.message ?: "Something went wrong. Try again."
        results[kind] = JSONObject().put("ok", false).put("error", err).put("n", n).put("phase", "login")
        push(JSONObject().put("kind", kind).put("what", "login").put("ok", false).put("err", err))
      }
      return@execute
    }
    when (p.optString("act")) {
      "open" -> io.ui { io.open() }
      "check" -> if (kind != null) try {
        val at = check(kind, p.optString("address"))
        results[kind] = JSONObject().put("ok", true).put("n", n).put("phase", "check").put("address", at)
        push(JSONObject().put("kind", kind).put("what", "check").put("ok", true).put("address", at))
      } catch (e: Exception) {
        val err = e.message ?: "Something went wrong. Try again."
        results[kind] = JSONObject().put("ok", false).put("error", err).put("n", n).put("phase", "check")
        push(JSONObject().put("kind", kind).put("what", "check").put("ok", false).put("err", err))
      }
      "skip", "unskip" -> if (kind != null) { if (p.optString("act") == "skip") skipped.add(kind) else skipped.remove(kind); push(JSONObject().put("kind", kind).put("what", "skip")) }
      "change" -> if (kind != null) { checked.remove(kind); push(JSONObject().put("kind", kind).put("what", "change")) }
    }
  }

  private fun clear() { shared = null; results.clear(); skipped.clear(); checked.clear(); qr = null }

  /** One request from the sign-in screen. The answer comes back on the main thread. */
  fun act(a: String, x: JSONObject, done: (JSONObject) -> Unit) = work.execute {
    val r = try {
      val kind = x.optString("kind")
      when (a) {
        "start" -> {
          if (!on) {
            on = true; clear()
            val page = io.phonePage()
            if (page.isNotEmpty()) {
              val p = PhonePage(page) { what, body -> phone(what, body) }
              val url = p.start()
              if (url != null) { pair = p; qr = Qr.encode(url)?.let { m -> JSONArray().also { arr -> for (row in m) arr.put(row.joinToString("") { if (it) "1" else "0" }) } } }
            }
          }
          push()
        }
        "stop" -> { on = false; clear(); pair?.stop(); pair = null; JSONObject().put("ok", true) }
        "model" -> model()
        "check" -> { val at = check(kind, x.optString("address")); push(); JSONObject().put("ok", true).put("address", at) }
        "addr" -> { remember(kind, if (x.optString("address").isNotBlank()) JSONObject().put("address", x.optString("address")) else null); JSONObject().put("ok", true) }
        "login" -> { signIn(kind, x.optString("address"), x.optString("user").trim(), x.optString("pass")); JSONObject().put("ok", true).put("model", push()) }
        "same" -> {
          val sh = shared ?: throw Servers.Failed("Type the username and password for this one.")
          signIn(kind, x.optString("address"), sh.user, sh.pass)
          JSONObject().put("ok", true).put("model", push())
        }
        "logout" -> {
          val c = store()
          Servers.logout(c, kind, io.device, io.version)
          c.stash(); c.save(io.file); settle()
          JSONObject().put("ok", true).put("model", push())
        }
        "skip" -> { if (x.optBoolean("on")) skipped.add(kind) else skipped.remove(kind); push(); JSONObject().put("ok", true) }
        "open" -> { io.ui { io.open() }; JSONObject().put("ok", true) }
        else -> JSONObject().put("ok", false).put("err", "Unknown: $a")
      }
    } catch (e: Exception) { JSONObject().put("ok", false).put("err", e.message ?: "Something went wrong. Try again.") }
    io.ui { done(r) }
  }
}
