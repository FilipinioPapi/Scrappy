package app.scrappy.player.tv

import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * "Your watching" for the Stats screen, added up by the app itself: the same sums, order and wording
 * as the page's stats.js (tvModel_load, tvModel_build, tvNativeStats). All time only, built from what
 * Emby keeps per person, so it works for every account.
 */
object StatsModel {
  private const val DAY = 86400000L
  private const val FIELDS = "Genres,UserData,RunTimeTicks,SeriesId,SeriesName,ImageTags,ParentIndexNumber,IndexNumber"

  /** Asks Emby for everything watched and adds it up. Blocking; throws when Emby can't be reached. */
  fun load(get: (String) -> JSONObject?): JSONObject {
    fun q(types: String, extra: String) = items(get("/Users/{userId}/Items?Recursive=true&IncludeItemTypes=$types&Fields=$FIELDS$extra"))
    val eps = q("Episode", "&Filters=IsPlayed&SortBy=DatePlayed&SortOrder=Descending&Limit=8000")
    val movies = q("Movie", ",ProductionYear,People&Filters=IsPlayed&SortBy=DatePlayed&SortOrder=Descending&Limit=3000")
    val series = q("Series", ",Status,ProductionYear,People&Limit=3000")
    return build(eps, movies, series, System.currentTimeMillis())
  }

  private fun items(o: JSONObject?): List<JSONObject> { val a = o?.optJSONArray("Items") ?: return emptyList(); return List(a.length()) { a.optJSONObject(it) }.filterNotNull() }
  private fun str(o: JSONObject?, k: String): String = if (o == null || o.isNull(k)) "" else o.optString(k)
  private fun arr(o: JSONObject?, k: String): List<Any> { val a = o?.optJSONArray(k) ?: return emptyList(); return List(a.length()) { a.opt(it) }.filterNotNull() }
  private fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")

  private val ISO = Regex("^(\\d{4})-(\\d{2})-(\\d{2})[T ](\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d+))?)?(Z|[+-]\\d{2}:?\\d{2})?$")
  /** A date as Emby writes it ("2025-03-01T12:34:56.0000000Z"), in milliseconds; 0 when there is none. */
  fun time(s: String): Long {
    val m = ISO.find(s.trim()) ?: return 0
    val g = m.groupValues
    val zone = g[8]
    val c = Calendar.getInstance(if (zone.isEmpty()) TimeZone.getDefault() else TimeZone.getTimeZone("UTC"))
    c.clear()
    c.set(g[1].toInt(), g[2].toInt() - 1, g[3].toInt(), g[4].toInt(), g[5].toInt(), g[6].toIntOrNull() ?: 0)
    var t = c.timeInMillis + (g[7].padEnd(3, '0').take(3).toIntOrNull() ?: 0)
    if (zone.length > 1) { val sign = if (zone[0] == '-') 1 else -1; val d = zone.drop(1).replace(":", ""); t += sign * (d.take(2).toInt() * 3600000L + d.drop(2).toInt() * 60000L) }
    return t
  }

  private fun n0(n: Double): String = NumberFormat.getIntegerInstance(Locale.getDefault()).format(Math.round(n))
  private fun n0(n: Int) = n0(n.toDouble())
  private fun plural(n: Int, w: String) = "${n0(n)} $w${if (n == 1) "" else "s"}"
  /** seconds -> "3h 12m" */
  fun hm(secs: Double): String { val s = maxOf(0L, Math.round(secs)); val h = s / 3600; val m = (s % 3600) / 60; return if (h > 0) "${h}h ${m}m" else "${m}m" }
  /** The colour a name gets when it has no picture: the same sum as the page. */
  fun hue(s: String): Int {
    var a = 7L; var i = 0
    while (i < s.length) { val cp = s.codePointAt(i); a = (a * 31 + s[i].code) and 0xFFFFFFFFL; i += Character.charCount(cp) }
    return (a % 360).toInt()
  }
  fun genreKey(g: String) = g.lowercase().replace("&", "and").replace(Regex("[^a-z0-9]"), "")

  private class Show(val id: String, val name: String) { var n = 0; var secs = 0.0; var last = 0L; var it: JSONObject? = null; var tot = 0; var st = "" }
  private class Face(val id: String, val name: String, val tag: String) { var w = 0; var mv = 0; var sh = 0 }

  fun build(eps: List<JSONObject>, movies: List<JSONObject>, series: List<JSONObject>, now: Long): JSONObject {
    fun ud(it: JSONObject) = it.optJSONObject("UserData")
    fun whenOf(it: JSONObject) = time(str(ud(it), "LastPlayedDate"))
    fun plays(it: JSONObject) = maxOf(1, ud(it)?.optInt("PlayCount") ?: 0)
    fun secsOf(it: JSONObject) = it.optDouble("RunTimeTicks", 0.0).let { if (it.isNaN()) 0.0 else it } / 1e7
    fun year(it: JSONObject?) = it?.optInt("ProductionYear") ?: 0
    fun picOf(it: JSONObject, w: Int): Any { val tag = str(it.optJSONObject("ImageTags"), "Primary"); return if (tag.isEmpty()) JSONObject.NULL else JSONObject().put("id", str(it, "Id")).put("type", "Primary").put("tag", tag).put("w", w) }
    val byId = HashMap<String, JSONObject>(); for (s in series) byId[str(s, "Id")] = s
    var total = 0.0
    for (it in eps + movies) total += secsOf(it) * plays(it)

    // Your shows: every show with a watched episode, with a status.
    val shows = LinkedHashMap<String, Show>()
    for (e in eps) {
      val sid = str(e, "SeriesId"); val sname = str(e, "SeriesName")
      val o = shows.getOrPut(sid.ifEmpty { sname }) { Show(sid, sname) }
      o.n++; o.secs += secsOf(e) * plays(e); o.last = maxOf(o.last, whenOf(e))
    }
    val stale = 90 * DAY
    for (o in shows.values) {
      val it = if (o.id.isEmpty()) null else byId[o.id]
      val u = it?.optJSONObject("UserData")
      val left = if (u != null && u.has("UnplayedItemCount") && !u.isNull("UnplayedItemCount")) u.optInt("UnplayedItemCount") else null
      o.it = it; o.tot = if (left == null) 0 else o.n + left
      o.st = if (left == 0) (if (str(it, "Status") == "Continuing") "up" else "fin") else if (now - o.last < stale) "on" else "off"
    }
    val showRows = shows.values.sortedByDescending { it.secs }
    fun cnt(k: String) = showRows.count { it.st == k }
    val stName = mapOf("fin" to "Finished", "up" to "Up to date", "on" to "Watching", "off" to "Stopped")

    // Movies by rewatches, episodes rewatched.
    val topMov = movies.sortedWith(compareByDescending<JSONObject> { plays(it) }.thenByDescending { whenOf(it) }).take(6)
    val rewMovies = movies.count { plays(it) > 1 }
    val rewEps = eps.filter { plays(it) > 1 }.sortedWith(compareByDescending<JSONObject> { plays(it) }.thenByDescending { if (ud(it)?.optBoolean("IsFavorite") == true) 1 else 0 }.thenByDescending { whenOf(it) })
    fun epTag(e: JSONObject) = listOf(str(e, "SeriesName"), if (e.has("ParentIndexNumber") && !e.isNull("ParentIndexNumber") && e.has("IndexNumber") && !e.isNull("IndexNumber")) "S${e.optInt("ParentIndexNumber")} E${e.optInt("IndexNumber")}" else "").filter { it.isNotEmpty() }.joinToString(" · ")

    // Genres by time. Tags like "Hip-Hop", "Hip Hop" and "hiphop" count as one; the most used spelling is shown.
    val gen = LinkedHashMap<String, Double>()
    fun addG(gs: List<Any>, w: Double) { for (g in gs) { val k = g.toString(); gen[k] = (gen[k] ?: 0.0) + w } }
    for (e in eps) { val sg = byId[str(e, "SeriesId")]?.optJSONArray("Genres"); addG(if (sg != null) arr(byId[str(e, "SeriesId")], "Genres") else arr(e, "Genres"), secsOf(e) * plays(e)) }
    for (m in movies) addG(arr(m, "Genres"), secsOf(m) * plays(m))
    class G(var name: String) { var best = -1.0; var t = 0.0 }
    val by = LinkedHashMap<String, G>()
    for ((name, v) in gen) { val k = genreKey(name); if (k.isEmpty()) continue; val o = by.getOrPut(k) { G(name) }; if (v > o.best) { o.name = name; o.best = v }; o.t += v }
    val merged = LinkedHashMap<String, Double>(); for (o in by.values) merged[o.name] = o.t
    val gList = merged.entries.sortedByDescending { it.value }.take(6)
    val gTot = merged.values.sum().let { if (it == 0.0) 1.0 else it }

    // Decades by release year, weighted by time.
    val dec = HashMap<Int, Double>()
    fun addD(y: Int, w: Double) { if (y > 1900) { val d = y / 10 * 10; dec[d] = (dec[d] ?: 0.0) + w } }
    for (e in eps) addD(year(byId[str(e, "SeriesId")]), secsOf(e) * plays(e))
    for (m in movies) addD(year(m), secsOf(m) * plays(m))
    val dk = dec.keys.sorted()
    val decs = if (dk.isEmpty()) emptyList() else (dk.first()..dk.last() step 10).toList()
    val dMax = maxOf(1.0, dec.values.maxOrNull() ?: 0.0)

    // Faces: actors across watched movies and shows (a show counts once per watched episode).
    val ppl = LinkedHashMap<String, Face>()
    fun addP(it: JSONObject?, w: Int, show: Boolean) {
      for (x in arr(it, "People").filterIsInstance<JSONObject>().filter { str(it, "Type") == "Actor" }.take(12)) {
        val o = ppl.getOrPut(str(x, "Id")) { Face(str(x, "Id"), str(x, "Name"), str(x, "PrimaryImageTag")) }
        o.w += w; if (show) o.sh++ else o.mv++
      }
    }
    for (m in movies) addP(m, 1, false)
    for (r in showRows) addP(r.it, r.n, true)
    val faces = ppl.values.sortedByDescending { it.w }.take(6)

    val longest = movies.sortedByDescending { secsOf(it) }.firstOrNull()
    val oldest = (movies + showRows.mapNotNull { it.it }).filter { year(it) > 1900 }.sortedBy { year(it) }.firstOrNull()
    val topRew = movies.filter { plays(it) > 1 }.sortedByDescending { plays(it) }.firstOrNull()
    val fav = rewEps.firstOrNull()
    val d = Math.floor(total / 86400).toLong(); val h = Math.round((total % 86400) / 3600)
    val tv = if (d > 0) d.toString() else hm(total); val tu = if (d > 0) " day${if (d == 1L) "" else "s"} $h h" else ""
    val month = SimpleDateFormat("MMM yyyy", Locale.getDefault())
    fun card(k: String, v: String, t: String, g: String) = JSONObject().put("k", k).put("v", v).put("d", JSONObject().put("t", t).put("c", "n")).put("g", g)
    fun fact(k: String, v: String, s: String) = JSONObject().put("k", k).put("v", v).put("s", s)
    fun wide(it: JSONObject?): Any {
      if (it == null) return JSONObject.NULL
      val tags = it.optJSONObject("ImageTags"); val id = str(it, "Id")
      val thumb = str(tags, "Thumb"); val back = it.optJSONArray("BackdropImageTags")?.optString(0).orEmpty(); val prim = str(tags, "Primary")
      return when {
        thumb.isNotEmpty() -> JSONObject().put("id", id).put("type", "Thumb").put("tag", thumb).put("w", 560)
        back.isNotEmpty() -> JSONObject().put("id", id).put("type", "Backdrop").put("tag", back).put("w", 560)
        prim.isNotEmpty() -> JSONObject().put("id", id).put("type", "Primary").put("tag", prim).put("w", 300)
        else -> JSONObject.NULL
      }
    }
    fun list(l: List<JSONObject>) = JSONArray(l)

    return JSONObject()
      .put("layout", "tv")
      .put("sub", "All time · everything you’ve watched on Emby")
      .put("cards", list(listOf(
        card("TIME WATCHED", tv, "That's ${n0(Math.round(total / 3600).toDouble())} hours of Movies & TV", "📺").put("hot", true).put("u", tu),
        card("EPISODES", n0(eps.size), "across ${plural(shows.size, "show")}", "🎞"),
        card("MOVIES", n0(movies.size), if (rewMovies > 0) "${n0(rewMovies)} watched more than once" else "watched", "🎬"),
        card("SHOWS FINISHED", n0(cnt("fin")), if (cnt("up") > 0) "and ${n0(cnt("up"))} you're up to date on" else "", "✔"),
      )))
      .put("shows", JSONObject()
        .put("counts", JSONObject().put("all", showRows.size).put("on", cnt("on")).put("up", cnt("up")).put("fin", cnt("fin")).put("off", cnt("off")))
        .put("items", list(showRows.map { r ->
          JSONObject().put("st", r.st).put("stl", stName[r.st]).put("name", r.name).put("href", if (r.id.isNotEmpty()) "#/item/${enc(r.id)}" else "")
            .put("hue", hue(r.name)).put("f", if (r.tot > 0) minOf(1.0, r.n.toDouble() / r.tot) else 1.0)
            .put("m", "${if (r.tot > 0) "${n0(r.n)} of ${n0(r.tot)}" else n0(r.n)} episodes · ${if (r.st == "off" && r.last > 0) "last watched " + month.format(Date(r.last)) else hm(r.secs)}")
            .put("pic", wide(r.it))
        })))
      .put("top2", JSONObject().put("title", "Top movies").put("none", "No movies watched yet.").put("items", list(topMov.map { m ->
        JSONObject().put("a", str(m, "Name")).put("b", listOf(arr(m, "Genres").firstOrNull()?.toString().orEmpty(), if (secsOf(m) > 0) hm(secsOf(m)) else "").filter { it.isNotEmpty() }.joinToString(" · "))
          .put("shape", "po").put("hue", hue(str(m, "Name"))).put("v", "×${plays(m)}").put("href", "#/item/${enc(str(m, "Id"))}").put("pic", picOf(m, 300))
      })))
      .put("eps", JSONObject().put("title", "Episodes you rewatch").put("sub", "Emby counts every time you finish an episode").put("none", "No episode watched more than once yet.").put("items", list(rewEps.take(8).map { e ->
        JSONObject().put("a", str(e, "Name")).put("b", epTag(e)).put("shape", "ps").put("hue", hue(str(e, "SeriesName").ifEmpty { str(e, "Name") })).put("v", "×${plays(e)}")
          .put("href", "#/item/${enc(str(e, "Id"))}").put("pic", picOf(e, 480))
      })))
      .put("genres", JSONObject().put("sub", "share of your time").put("items", list(gList.map { (g, t) ->
        JSONObject().put("n", g).put("w", t / (gList[0].value.let { if (it == 0.0) 1.0 else it })).put("v", "${Math.round(t / gTot * 100)}%")
      })))
      .put("decades", list(decs.takeLast(8).map { dd ->
        val v = dec[dd] ?: 0.0
        JSONObject().put("v", v).put("h", v / dMax * 100).put("tip", "${dd}s: ${hm(v)}").put("axis", "${dd.toString().drop(2)}s")
      }))
      .put("faces", JSONObject().put("title", "Faces you see most").put("sub", "top actors").put("items", list(faces.map { f ->
        JSONObject().put("href", if (f.id.isNotEmpty()) "#/person/${enc(f.id)}" else "").put("a", f.name)
          .put("b", listOf(if (f.sh > 0) plural(f.sh, "show") else "", if (f.mv > 0) plural(f.mv, "movie") else "").filter { it.isNotEmpty() }.joinToString(", "))
          .put("shape", "rd").put("ini", f.name.ifEmpty { "?" }.split(" ").joinToString("") { w -> w.take(1) }.take(2)).put("hue", hue(f.name))
          .put("w", f.w.toDouble() / faces[0].w.let { if (it == 0) 1 else it }).put("v", "")
          .put("pic", if (f.tag.isNotEmpty()) JSONObject().put("id", f.id).put("type", "Primary").put("tag", f.tag).put("w", 240) else JSONObject.NULL)
      })))
      .put("facts", list(listOf(
        fact("Favorite episode", fav?.let { str(it, "Name") } ?: "", fav?.let { "${epTag(it)}, watched ${plays(it)} times" } ?: ""),
        fact("Nonstop", if (total > 0) String.format(Locale.US, if (total > 864000) "%.0f days" else "%.1f days", total / 86400) else "", "if you watched it all back to back"),
        fact("Rewatched most", topRew?.let { str(it, "Name") } ?: "", topRew?.let { "${plays(it)} times" } ?: ""),
        fact("Longest movie", longest?.let { str(it, "Name") } ?: "", longest?.let { hm(secsOf(it)) } ?: ""),
        fact("Oldest watch", oldest?.let { "${str(it, "Name")} (${year(it)})" } ?: "", "the earliest release you’ve seen"),
      )))
  }
}
