package app.scrappy.player.tv

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * The app's saved sign-ins and people ("Who's watching"), in the same config.json the app has always
 * kept, so nobody has to sign in again. Tokens only, never passwords.
 *
 * The person using the app right now is always the sign-ins at the top; everyone who has signed in on
 * this TV also has a saved copy in `profiles`, and switching swaps which copy sits at the top.
 *
 * While the web part is still running it owns the file (it keeps its own copy in memory and rewrites
 * it), so until that is gone this class may read the file but must not save it.
 */
class Store(private val top: JSONObject = JSONObject()) {
  class Wrong(msg: String) : Exception(msg)

  companion object {
    /** What makes up one person's sign-ins: Emby, Navidrome, Audiobookshelf. */
    val SIGNIN = listOf(
      "server", "serverName", "userId", "userName", "token",
      "ndServer", "ndName", "ndUser", "ndSalt", "ndToken", "ndJwt",
      "absServer", "absName", "absUser", "absToken",
    )
    /** Cleared when adding a person: who they are, not where the servers are (a household shares those). */
    private val WHO = listOf("userId", "userName", "token", "ndUser", "ndSalt", "ndToken", "ndJwt", "absUser", "absToken")

    fun newId(): String = UUID.randomUUID().toString().replace("-", "")

    fun load(f: File): Store {
      val o = try { JSONObject(f.readText()) } catch (e: Exception) { JSONObject() }
      return Store(o)
    }
  }

  operator fun get(k: String): String = top.optString(k)
  operator fun set(k: String, v: String) { top.put(k, v) }

  var active: String
    get() = this["activeProfile"]
    set(v) { this["activeProfile"] = v }

  private fun people(): MutableList<JSONObject> {
    val a = top.optJSONArray("profiles") ?: JSONArray()
    return (0 until a.length()).mapNotNull { a.optJSONObject(it) }.toMutableList()
  }
  private fun keep(list: List<JSONObject>) { top.put("profiles", JSONArray(list)) }
  val count get() = people().size

  val embyIn get() = this["server"].isNotEmpty() && this["token"].isNotEmpty() && this["userId"].isNotEmpty()
  val musicIn get() = this["ndServer"].isNotEmpty() && this["ndToken"].isNotEmpty()
  val booksIn get() = this["absServer"].isNotEmpty() && this["absToken"].isNotEmpty()

  private fun signedIn(p: JSONObject) =
    (p.optString("token").isNotEmpty() && p.optString("userId").isNotEmpty()) || p.optString("ndToken").isNotEmpty() || p.optString("absToken").isNotEmpty()
  private fun nameOf(p: JSONObject) = listOf("userName", "ndUser", "absUser").map { p.optString(it) }.firstOrNull { it.isNotEmpty() } ?: ""
  private fun pinOk(p: JSONObject, pin: String) = p.optString("pinHash").isEmpty() || Pins.matches(p.optString("pinSalt"), pin, p.optString("pinHash"))

  /** Copies the current sign-ins into the current person's saved copy (made if needed). A person with no sign-ins left is dropped. */
  fun stash() {
    var list = people()
    if (!(embyIn || musicIn || booksIn)) { keep(list.filter { it.optString("id") != active }); return }
    // Signing in again as someone already on the list (same Emby user) reuses their entry.
    if (embyIn) {
      val me = active
      val other = list.firstOrNull { it.optString("id") != me && it.optString("userId") == this["userId"] && it.optString("server") == this["server"] }
      if (other != null) { list = list.filter { it.optString("id") != me }.toMutableList(); active = other.optString("id") }
    }
    if (active.isEmpty()) active = newId()
    val id = active
    val p = list.firstOrNull { it.optString("id") == id } ?: JSONObject().put("id", id).put("pinSalt", "").put("pinHash", "").also { list.add(it) }
    for (k in SIGNIN) p.put(k, this[k])
    keep(list)
  }

  private fun apply(p: JSONObject) {
    active = p.optString("id")
    for (k in SIGNIN) this[k] = p.optString(k)
  }

  /** The list for the Who's watching screen. No tokens, no PINs. */
  fun peopleJson(): JSONObject {
    stash()
    val out = JSONArray()
    for (p in people()) {
      if (!signedIn(p)) continue
      val emby = p.optString("token").isNotEmpty()
      out.put(
        JSONObject().put("id", p.optString("id")).put("name", nameOf(p)).put("hasPin", p.optString("pinHash").isNotEmpty())
          .put("embyServer", if (emby) p.optString("server") else "").put("embyUserId", p.optString("userId"))
          .put("emby", emby).put("navidrome", p.optString("ndToken").isNotEmpty()).put("audiobookshelf", p.optString("absToken").isNotEmpty()),
      )
    }
    return JSONObject().put("active", active).put("people", out)
  }

  /** Switch to a saved person. A person with a PIN needs it, unless they are already the one watching. */
  fun switchTo(id: String, pin: String) {
    stash()
    val p = people().firstOrNull { it.optString("id") == id } ?: throw Wrong("That person is no longer on this device.")
    if (id != active && !pinOk(p, pin)) throw Wrong("Wrong PIN.")
    apply(p)
  }

  /** Start adding a person: everyone stays saved, and the sign-in screens start empty-handed (addresses stay). */
  fun addPerson() {
    stash()
    active = newId()
    for (k in WHO) this[k] = ""
  }

  /** Take a person off this TV. Returns their saved copy so the servers can be told to forget the tokens. */
  fun remove(id: String, pin: String): JSONObject? {
    stash()
    val list = people()
    val p = list.firstOrNull { it.optString("id") == id } ?: return null
    if (!pinOk(p, pin)) throw Wrong("Wrong PIN.")
    list.remove(p)
    keep(list)
    if (active == id) {
      val next = list.firstOrNull { signedIn(it) && it.optString("pinHash").isEmpty() } ?: list.firstOrNull()
      if (next != null) apply(next)
      else { active = ""; for (k in listOf("userId", "token", "ndSalt", "ndToken", "ndJwt", "absToken")) this[k] = "" }
    }
    return p
  }

  /** Set, change or remove (empty `pin`) a person's PIN. Changing or removing needs the old one. */
  fun setPin(id: String, current: String, pin: String) {
    stash()
    val list = people()
    val p = list.firstOrNull { it.optString("id") == id } ?: throw Wrong("That person is no longer on this device.")
    if (!pinOk(p, current)) throw Wrong("Wrong PIN.")
    if (pin.isEmpty()) { p.put("pinSalt", "").put("pinHash", "") }
    else {
      if (pin.length != 4 || !pin.all { it in '0'..'9' }) throw Wrong("A PIN is 4 digits.")
      val salt = newId()
      p.put("pinSalt", salt).put("pinHash", Pins.hash(salt, pin))
    }
    keep(list)
  }

  /** Written to a side file first, then swapped in, so a power cut never leaves half a file. */
  fun save(f: File) {
    if (this["deviceId"].isEmpty()) this["deviceId"] = newId()
    val tmp = File(f.parentFile, f.name + ".new")
    tmp.writeText(top.toString(2))
    if (!tmp.renameTo(f)) { f.writeText(top.toString(2)); tmp.delete() }
  }

  override fun toString(): String = top.toString()
}
