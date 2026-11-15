package app.scrappy.player.tv

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/**
 * Search for Movies & TV, done by the app itself: the same questions to Emby, the same typo help and
 * the same order as the page's search (search.js: parseQuery, searchVideo, tvSearchData). Blocking:
 * call it from a background thread. `get` fetches one Emby path and returns its JSON.
 */
class Finder(private val get: (String) -> JSONObject?) {
  class Query {
    var text = ""; var where: String? = null; var type: String? = null; var genre: String? = null
    var y1 = 0; var y2 = 0; var fav = false; var unplayed = false
  }

  companion object {
    private val TYPES = mapOf(
      "song" to "song", "songs" to "song", "album" to "album", "albums" to "album", "artist" to "artist", "artists" to "artist", "playlist" to "playlist",
      "movie" to "movie", "movies" to "movie", "show" to "show", "shows" to "show", "series" to "show", "tv" to "show", "episode" to "episode",
      "book" to "book", "books" to "book", "audiobook" to "book", "audiobooks" to "book",
      "person" to "person", "people" to "person", "actor" to "person", "actors" to "person", "director" to "person", "author" to "author", "authors" to "author",
    )
    private val INS = mapOf("music" to "music", "movies" to "video", "movie" to "video", "tv" to "video", "video" to "video", "emby" to "video", "audiobooks" to "audiobooks", "books" to "audiobooks", "abs" to "audiobooks")
    private val EMBY = mapOf("movie" to "Movie", "show" to "Series", "episode" to "Episode")
    private val TOKEN = Regex("(\\w+:\"[^\"]*\"|\\S+)")
    private val FILTER = Regex("^(in|type|genre|year|fav|is):(.+)$", RegexOption.IGNORE_CASE)
    private val SPACE = Regex("\\s+")
    private val SPLIT = Regex("[\\s\\-/,.()]+")

    /** Words plus filters such as type:movie, genre:horror, year:1990-1999, fav:yes, is:unplayed. */
    fun parse(raw: String): Query {
      val f = Query(); val words = ArrayList<String>()
      for (m in TOKEN.findAll(raw)) {
        val w = m.value
        val hit = FILTER.find(w)
        if (hit == null) { words.add(w); continue }
        val k = hit.groupValues[1].lowercase(); val v = hit.groupValues[2].removePrefix("\"").removeSuffix("\"").lowercase()
        when (k) {
          "in" -> f.where = INS[v]
          "type" -> f.type = TYPES[v]
          "genre" -> f.genre = v
          "year" -> { val p = v.split('-', '–').map { it.toIntOrNull() ?: 0 }; f.y1 = p.getOrElse(0) { 0 }; f.y2 = p.getOrElse(1) { 0 }.takeIf { it != 0 } ?: f.y1 }
          "fav" -> f.fav = v in setOf("yes", "y", "true", "1")
          "is" -> if (v == "unplayed") f.unplayed = true
        }
      }
      f.text = words.joinToString(" ").trim()
      return f
    }

    private fun lev(a: String, b: String): Int {
      val m = a.length; val n = b.length
      if (m == 0) return n; if (n == 0) return m
      var p = IntArray(n + 1) { it }
      for (i in 1..m) {
        val c = IntArray(n + 1); c[0] = i
        for (j in 1..n) c[j] = minOf(p[j] + 1, c[j - 1] + 1, p[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
        p = c
      }
      return p[n]
    }

    /** Typo-forgiving score: 1 = exact, about 0 = unrelated. */
    fun score(query: String, name: String?): Double {
      val q = query.lowercase(); val s = (name ?: "").lowercase()
      if (q.isEmpty()) return 0.5
      if (s == q) return 1.0; if (s.startsWith(q)) return 0.95; if (s.contains(q)) return 0.85
      val qw = q.split(SPACE); var tot = 0.0
      for (w in qw) {
        var best = 0.0
        for (t in s.split(SPLIT)) {
          if (t.isEmpty()) continue
          if (t.startsWith(w)) { best = 1.0; break }
          val d = lev(w, t.take(w.length + 1))
          best = maxOf(best, 1.0 - d.toDouble() / maxOf(w.length, 3))
        }
        tot += best
      }
      return tot / qw.size * 0.8
    }

    /** Typo help: shorter pieces of each word (so "intersteller" still finds "Interstellar"). */
    fun pieces(text: String): List<String> =
      text.split(SPACE).filter { it.length >= 3 }.map { it.take(maxOf(3, Math.ceil(it.length * 0.6).toInt())) }.distinct()

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
    private fun items(o: JSONObject?): List<JSONObject> { val a = o?.optJSONArray("Items") ?: return emptyList(); return List(a.length()) { a.optJSONObject(it) }.filterNotNull() }
    private fun dedupe(l: List<JSONObject>): List<JSONObject> { val seen = HashSet<String>(); return l.filter { seen.add(it.optString("Id")) } }
  }

  private fun params(f: Query, extra: Map<String, String>): LinkedHashMap<String, String> {
    val p = linkedMapOf("Recursive" to "true", "Fields" to "PrimaryImageAspectRatio,ProductionYear,Genres", "ImageTypeLimit" to "1", "EnableImageTypes" to "Primary,Thumb,Backdrop")
    p.putAll(extra)
    f.genre?.let { g -> p["Genres"] = Regex("\\b\\w").replace(g) { it.value.uppercase() } }
    if (f.y1 != 0) p["Years"] = (0 until minOf(60, f.y2 - f.y1 + 1)).joinToString(",") { (f.y1 + it).toString() }
    if (f.fav) p["IsFavorite"] = "true"
    if (f.unplayed) p["IsPlayed"] = "false"
    return p
  }
  private fun ask(p: Map<String, String>) = items(get("/Users/{userId}/Items?" + p.entries.joinToString("&") { enc(it.key) + "=" + enc(it.value) }))

  /** Movies and shows, and episodes on their own, so episodes can't crowd out the show. */
  private fun query(f: Query, term: String): List<JSONObject> {
    val out = ArrayList<JSONObject>()
    val top = if (f.type != null) (if (f.type == "episode" || f.type == "person") "" else EMBY[f.type] ?: "") else "Movie,Series"
    if (top.isNotEmpty()) { val p = params(f, mapOf("Limit" to "80", "IncludeItemTypes" to top)); if (term.isNotEmpty()) p["SearchTerm"] = term else p["SortBy"] = "SortName"; out.addAll(ask(p)) }
    if ((f.type == null || f.type == "episode") && (term.isNotEmpty() || f.type == "episode")) {
      val p = params(f, mapOf("Limit" to "60", "IncludeItemTypes" to "Episode")); if (term.isNotEmpty()) p["SearchTerm"] = term else p["SortBy"] = "SortName"; out.addAll(ask(p))
    }
    return out
  }

  private fun rank(text: String, l: List<JSONObject>) = l.map { it to score(text, it.optString("Name")) }.filter { it.second > 0.45 }.sortedByDescending { it.second }.map { it.first }

  /** The sections for the search screen, in the page's own shape: { failed, sections }. Throws when Emby can't be reached. */
  fun search(raw: String): JSONObject {
    val f = parse(raw)
    val secs = JSONArray()
    val out = JSONObject().put("failed", JSONArray()).put("sections", secs)
    if (f.where != null && f.where != "video") return out
    if (f.type != null && f.type !in EMBY && f.type != "person") return out

    var found = query(f, f.text)
    // People (actors, directors) only when there are words and no filters that people don't have.
    val wantPeople = f.text.isNotEmpty() && (f.type == null || f.type == "person") && f.genre == null && f.y1 == 0 && !f.unplayed
    var persons = if (!wantPeople) emptyList() else try {
      items(get("/Persons?UserId={userId}&SearchTerm=" + enc(f.text) + "&Limit=30&Fields=PrimaryImageAspectRatio&ImageTypeLimit=1&EnableImageTypes=Primary" + if (f.fav) "&IsFavorite=true" else ""))
    } catch (e: Exception) { emptyList() }
    // Few hits? Try shorter pieces of each word, then keep only close matches.
    if (f.text.isNotEmpty() && found.size < 3) {
      val more = pieces(f.text).flatMap { p -> try { query(f, p) } catch (e: Exception) { emptyList() } }
      found = dedupe(found + more)
    }
    if (f.text.isNotEmpty()) { found = rank(f.text, found); persons = rank(f.text, persons) }
    // A close match on a person also brings in what they're in.
    var withPerson = emptyList<JSONObject>()
    val star = persons.firstOrNull()
    if (star != null && score(f.text, star.optString("Name")) >= 0.85 && f.type != "person") {
      val p = params(f, mapOf("Limit" to "60", "IncludeItemTypes" to (if (f.type != null) EMBY[f.type] ?: "Movie,Series" else "Movie,Series"), "PersonIds" to star.optString("Id"), "SortBy" to "CommunityRating,SortName", "SortOrder" to "Descending"))
      withPerson = try { ask(p) } catch (e: Exception) { emptyList() }
    }
    // Movies and shows first (title matches, then the person's), episodes last.
    found = dedupe(found.filter { it.optString("Type") != "Episode" } + withPerson + found.filter { it.optString("Type") == "Episode" })
    if (f.type == "person") found = emptyList()
    found = found.take(120); persons = persons.take(30)

    val tops = found.filter { it.optString("Type") != "Episode" }; val eps = found.filter { it.optString("Type") == "Episode" }
    var best: JSONObject? = null; var bestS = 0.84
    for (it in tops) { val s = score(raw, it.optString("Name")); if (s > bestS) { best = it; bestS = s } }
    for (p in persons) { val s = score(raw, p.optString("Name")); if (s > bestS) { best = p; bestS = s } }
    val isPerson = best != null && persons.any { it === best }
    fun sec(title: String, kind: String, l: List<JSONObject>) = JSONObject().put("title", title).put("kind", kind).put("items", JSONArray(l))
    if (best != null) secs.put(sec("Best match", if (isPerson) "people" else "cards", listOf(best)).put("noCount", true))
    val restTops = tops.filter { it !== best }; val restPeople = persons.filter { it !== best }
    if (restTops.isNotEmpty()) secs.put(sec("Movies & Shows", "cards", restTops))
    if (restPeople.isNotEmpty()) secs.put(sec("People", "people", restPeople))
    if (eps.isNotEmpty()) secs.put(sec("Episodes", "wide", eps))
    return out
  }
}
