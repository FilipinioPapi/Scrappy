package app.scrappy.player.tv

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Sound and subtitle picks are compared with what the page's own player.js chose for the same
 * made-up videos (pick-ref.json, written by scratch script pickref.mjs running player.js itself):
 * 250 videos, each with the track list arriving, late subtitle files, the end of the lookout and a
 * few of your own choices, checking every order sent to the player and what is remembered.
 */
@RunWith(RobolectricTestRunner::class)
class TrackPicksTest {
  private fun same(path: String, want: Any?, got: Any?) {
    when {
      want is JSONObject -> {
        if (got !is JSONObject) fail("$path: wanted an object $want, got $got")
        val a = want.keys().asSequence().toSortedSet(); val b = (got as JSONObject).keys().asSequence().toSortedSet()
        assertEquals("$path keys", a, b)
        for (k in a) same("$path.$k", want.opt(k), got.opt(k))
      }
      want is JSONArray -> {
        if (got !is JSONArray) fail("$path: wanted a list, got $got")
        assertEquals("$path length (wanted $want, got $got)", want.length(), (got as JSONArray).length())
        for (i in 0 until want.length()) same("$path[$i]", want.opt(i), got.opt(i))
      }
      want is Number -> { if (got !is Number) fail("$path: wanted $want, got $got"); assertEquals(path, want.toDouble(), (got as Number).toDouble(), 1e-9) }
      else -> assertEquals(path, want, got)
    }
  }
  private fun list(a: JSONArray): List<JSONObject> = List(a.length()) { a.getJSONObject(it) }

  @Test fun sameAsThePage() {
    val all = JSONArray(javaClass.getResource("/pick-ref.json")!!.readText())
    val defaultsOf = mapOf("subStart" to "default", "subLang" to "eng", "audioLang" to "")
    for (n in 0 until all.length()) {
      val sc = all.getJSONObject(n)
      val store = HashMap<String, String>()
      sc.getJSONObject("saved").let { s -> for (k in s.keys()) store[k] = s.getString(k) }
      val prefs = sc.getJSONObject("prefs")
      val sets = JSONArray()
      val p = TrackPicks(object : TrackPicks.Io {
        override fun pref(key: String) = if (prefs.has(key)) prefs.getString(key) else defaultsOf[key] ?: ""
        override fun load(key: String) = store[key]
        override fun save(key: String, value: String) { store[key] = value }
        override fun set(name: String, value: String) { sets.put(JSONArray().put(name).put(value)) }
        override fun toast(msg: String) { sets.put(JSONArray().put("toast").put(msg)) }
      })
      p.reset(sc.getString("key"))
      val d = sc.opt("defaults")
      if (d != "unset") p.setDefaults(d as? JSONObject, sc.getString("playMethod"))
      fun take(): JSONArray { val c = JSONArray(sets.toString()); while (sets.length() > 0) sets.remove(0); return c }
      var cur: List<JSONObject> = emptyList()
      fun apply(s: JSONArray): Boolean {
        var changed = false
        for (i in 0 until s.length()) {
          val name = s.getJSONArray(i).getString(0); val v = s.getJSONArray(i).getString(1)
          val type = when (name) { "aid" -> "audio"; "sid" -> "sub"; else -> continue }
          for (t in cur) if (t.optString("type") == type) { val on = t.optInt("id").toString() == v; if (t.optBoolean("selected") != on) { t.put("selected", on); changed = true } }
        }
        return changed
      }
      fun copy() = cur.map { JSONObject(it.toString()) }
      val steps = sc.getJSONArray("steps")
      for (i in 0 until steps.length()) {
        val st = steps.getJSONObject(i)
        val at = "video $n step $i (${st.getString("op")})"
        when (st.getString("op")) {
          "tracks" -> { cur = list(st.getJSONArray("list")).map { JSONObject(it.toString()) }; p.onTracks(copy()) }
          "stop" -> p.finish()
          "toggle" -> p.toggleSubs()
          "sub" -> p.chooseSub(st.getString("v"))
          "audio" -> p.chooseAudio(st.getString("v"))
        }
        val out = st.getJSONObject("out")
        var s2 = take()
        same("$at orders", out.getJSONArray("sets"), s2)
        val rounds = st.getJSONArray("rounds")
        var r = 0
        while (r < 4 && apply(s2)) { p.onTracks(copy()); s2 = take(); same("$at answer $r", rounds.optJSONArray(r) ?: JSONArray().put("missing"), s2); r++ }
        assertEquals("$at answers", rounds.length(), r)
        assertEquals("$at why", out.getString("subWhy"), p.subWhy)
        assertEquals("$at held", out.opt("subTarget").let { if (it == JSONObject.NULL) null else it.toString() }, p.subTarget)
        assertEquals("$at wantAid", out.opt("wantAid").let { if (it == JSONObject.NULL) null else (it as Number).toInt() }, p.wantAid)
        assertEquals("$at aid", out.opt("aid").let { if (it == JSONObject.NULL) null else (it as Number).toInt() }, p.aid)
        assertEquals("$at sid", out.opt("sid").let { if (it == JSONObject.NULL) null else (it as Number).toInt() }, p.sid)
        assertEquals("$at lastSid", out.opt("lastSid").let { if (it == JSONObject.NULL) null else (it as Number).toInt() }, p.lastSid)
        val pk = out.optJSONObject("pick")
        assertEquals("$at still looking", pk != null, p.picking)
        if (pk != null) { assertEquals("$at pick audio", pk.getBoolean("audio"), p.pickAudio); assertEquals("$at pick sub", pk.getBoolean("sub"), p.pickSub) }
        val kept = out.opt("store")
        same("$at remembered", if (kept == JSONObject.NULL || kept == null) JSONObject() else JSONObject(kept as String), p.saved())
        same("$at subtitle list", out.getJSONArray("subs"), p.subsList())
        same("$at sound list", out.getJSONArray("audio"), p.audioList())
      }
    }
  }

  @Test fun languages() {
    assertEquals("en", TrackPicks.langOf("en-US"))
    assertEquals("en", TrackPicks.langOf("English"))
    assertEquals("de", TrackPicks.langOf("deu"))
    assertEquals("", TrackPicks.langOf(null))
    assertEquals("Spanish", TrackPicks.langName("es"))
    assertEquals("espa", TrackPicks.langName("espa"))
  }
}
