package app.scrappy.player.tv

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Scores and order checked against numbers worked out with the page's own search.js. */
@RunWith(RobolectricTestRunner::class)
class FinderTest {
  private fun item(id: String, name: String, type: String) = JSONObject().put("Id", id).put("Name", name).put("Type", type)
  private fun list(vararg o: JSONObject) = JSONObject().put("Items", JSONArray(o.toList()))

  @Test fun scoring() {
    assertEquals(1.0, Finder.score("alien", "Alien"), 1e-9)
    assertEquals(0.95, Finder.score("alien", "Aliens"), 1e-9)
    assertEquals(0.85, Finder.score("lien", "Alien"), 1e-9)
    assertEquals(0.5, Finder.score("", "x"), 1e-9)
    assertEquals(SCORES["intersteller|Interstellar"]!!, Finder.score("intersteller", "Interstellar"), 1e-9)
    assertEquals(SCORES["the amatur|The Amateur"]!!, Finder.score("the amatur", "The Amateur"), 1e-9)
    assertEquals(SCORES["heavy wieghts|Heavyweights"]!!, Finder.score("heavy wieghts", "Heavyweights"), 1e-9)
    assertEquals(SCORES["one peice|One Piece (1999)"]!!, Finder.score("one peice", "One Piece (1999)"), 1e-9)
    assertEquals(listOf("interste"), Finder.pieces("intersteller"))
    assertEquals(listOf("the", "ama"), Finder.pieces("the amat"))
  }

  @Test fun filters() {
    val f = Finder.parse("alien type:movies genre:\"science fiction\" year:1979-1986 fav:yes is:unplayed in:tv")
    assertEquals("alien", f.text); assertEquals("movie", f.type); assertEquals("science fiction", f.genre)
    assertEquals(1979, f.y1); assertEquals(1986, f.y2); assertTrue(f.fav && f.unplayed); assertEquals("video", f.where)
    val g = Finder.parse("year:2001 the  thing"); assertEquals(2001, g.y1); assertEquals(2001, g.y2); assertEquals("the thing", g.text)
  }

  @Test fun sectionsAndOrder() {
    val asked = ArrayList<String>()
    val find = Finder { path ->
      asked.add(path)
      when {
        path.startsWith("/Persons") -> list(item("p1", "Rami Malek", "Person"), item("p2", "Rami Malekson", "Person"), item("p3", "Ramy Youssef", "Person"))
        path.contains("PersonIds=p1") -> list(item("m9", "Bohemian Rhapsody", "Movie"), item("m1", "The Amateur", "Movie"))
        path.contains("IncludeItemTypes=Episode") -> list(item("e1", "Rami Malek Returns", "Episode"))
        path.contains("SearchTerm=rami%20malek") -> list(item("m5", "Rami Malek: A Portrait", "Movie"))
        else -> list()
      }
    }
    val r = find.search("rami malek")
    val secs = r.getJSONArray("sections")
    val titles = List(secs.length()) { secs.getJSONObject(it).optString("title") }
    assertEquals(listOf("Best match", "Movies & Shows", "People", "Episodes"), titles)
    assertEquals("people", secs.getJSONObject(0).optString("kind"))
    assertEquals("p1", secs.getJSONObject(0).getJSONArray("items").getJSONObject(0).optString("Id"))
    val tops = secs.getJSONObject(1).getJSONArray("items")
    assertEquals(listOf("m5", "m9", "m1"), List(tops.length()) { tops.getJSONObject(it).optString("Id") })
    // Only one hit by title: the shorter pieces were tried too.
    assertTrue(asked.any { it.contains("SearchTerm=ram&") || it.endsWith("SearchTerm=ram") || it.contains("SearchTerm=ram%") || it.contains("SearchTerm=mal") })
    assertTrue(asked.all { !it.contains("{userId}") || it.startsWith("/Users/{userId}/Items?") || it.startsWith("/Persons?UserId={userId}") })

    // A music-only search gives Movies & TV nothing to do.
    assertEquals(0, Finder { _ -> throw IllegalStateException("not asked") }.search("type:album abbey").getJSONArray("sections").length())
  }

  companion object {
    val SCORES = mapOf(
      "intersteller|Interstellar" to 0.7333333333333334, "the amatur|The Amateur" to 0.7333333333333334,
      "heavy wieghts|Heavyweights" to 0.4, "one peice|One Piece (1999)" to 0.6400000000000001,
    )
  }
}
