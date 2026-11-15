package app.scrappy.player.tv

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.Locale
import java.util.TimeZone

/**
 * The stats are compared, field by field, with what the page's own stats.js gave for the same made-up
 * library (stats-ref.json, written by running stats.js itself).
 */
@RunWith(RobolectricTestRunner::class)
class StatsModelTest {
  private fun same(path: String, want: Any?, got: Any?) {
    when {
      want is JSONObject -> {
        if (got !is JSONObject) fail("$path: wanted an object, got $got")
        val a = want.keys().asSequence().toSortedSet(); val b = (got as JSONObject).keys().asSequence().toSortedSet()
        assertEquals("$path keys", a, b)
        for (k in a) same("$path.$k", want.opt(k), got.opt(k))
      }
      want is JSONArray -> {
        if (got !is JSONArray) fail("$path: wanted a list, got $got")
        assertEquals("$path length", want.length(), (got as JSONArray).length())
        for (i in 0 until want.length()) same("$path[$i]", want.opt(i), got.opt(i))
      }
      want is Number -> { if (got !is Number) fail("$path: wanted $want, got $got"); assertEquals(path, want.toDouble(), (got as Number).toDouble(), Math.abs(want.toDouble()) * 1e-9 + 1e-9) }
      want == JSONObject.NULL -> assertEquals(path, JSONObject.NULL, got)
      else -> assertEquals(path, want, got)
    }
  }
  private fun list(o: JSONObject, k: String): List<JSONObject> { val a = o.getJSONArray(k); return List(a.length()) { a.getJSONObject(it) } }

  @Test fun sameAsThePage() {
    Locale.setDefault(Locale.US); TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
    val ref = JSONObject(javaClass.classLoader!!.getResource("stats-ref.json")!!.readText())
    val sets = ref.getJSONObject("sets")
    for (name in sets.keys()) {
      val raw = sets.getJSONObject(name).getJSONObject("raw")
      val got = StatsModel.build(list(raw, "eps"), list(raw, "movies"), list(raw, "series"), ref.getLong("now"))
      same(name, sets.getJSONObject(name).getJSONObject("want"), JSONObject(got.toString()))
    }
  }

  @Test fun dates() {
    assertEquals(1740832496000L, StatsModel.time("2025-03-01T12:34:56.0000000Z"))
    assertEquals(1740832496123L, StatsModel.time("2025-03-01T12:34:56.1239999Z"))
    assertEquals(1740832496000L, StatsModel.time("2025-03-01T14:34:56+02:00"))
    assertEquals(0L, StatsModel.time(""))
  }
}
