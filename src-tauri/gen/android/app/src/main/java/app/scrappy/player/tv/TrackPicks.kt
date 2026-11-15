package app.scrappy.player.tv

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Which sound and subtitles a video starts with, and remembering what you pick: the same rules as
 * the page's player (player.js pickTracks / holdSubs / toggleSubs and the lists for the menus).
 *
 * Order for subtitles: your own last pick for this show, then Settings ("Off unless I turn them
 * on", "Always my language"), then what Emby itself would start with, then the subtitles the video
 * marks as default, otherwise off. The choice is held (the TV player can switch by itself, e.g. to
 * forced subtitles) until you change it yourself. Subtitle files on the server can show up a few
 * seconds late, so picking keeps trying until stopPicking().
 *
 * Tracks are the TV player's own list (Exo.state "tracks"): id, type, lang, title, codec,
 * demux-channel-count, default, forced, external, selected, ff-index.
 */
class TrackPicks(private val io: Io) {
  interface Io {
    /** A setting (Settings page), "" when not set and without a default. */
    fun pref(key: String): String
    fun load(key: String): String?
    fun save(key: String, value: String)
    /** Tell the player: "aid" / "sid" with a track id, or "no". */
    fun set(name: String, value: String)
    fun toast(msg: String) {}
    fun note(msg: String) {}
  }

  var tracks: List<JSONObject> = emptyList(); private set
  var aid: Int? = null; private set
  var sid: Int? = null; private set
  var lastSid: Int? = null; private set
  /** What Emby would pick: {audio, sub, subKnown}. Not known yet until `defaultsKnown`. */
  var defaults: JSONObject? = null; private set
  var defaultsKnown = false; private set
  var playMethod = ""
  /** The show (or film) the picks are remembered for. */
  var key: String? = null
  var pickAudio = false; private set
  var pickSub = false; private set
  var picking = false; private set
  var wantAid: Int? = null; private set
  /** The subtitles being held on: a track id, "no", or null when nothing is held. */
  var subTarget: String? = null; private set
  var subWhy = ""; private set

  /** A new video starts: forget everything about the last one. */
  fun reset(key: String?) {
    this.key = key
    tracks = emptyList(); aid = null; sid = null
    defaults = null; defaultsKnown = false; playMethod = ""
    picking = true; pickAudio = true; pickSub = true
    wantAid = null; subTarget = null
  }

  fun setDefaults(d: JSONObject?, method: String) { defaults = d; defaultsKnown = true; playMethod = method; pickTracks() }

  // ---------- remembered picks ----------

  private fun trackKey() = key?.let { "tracks:$it" }
  fun saved(): JSONObject = trackKey()?.let { k -> io.load(k)?.let { try { JSONObject(it) } catch (_: Throwable) { null } } } ?: JSONObject()
  private fun savePick(name: String, value: Any?) { val k = trackKey() ?: return; io.save(k, saved().put(name, value ?: JSONObject.NULL).toString()) }
  private fun refOf(t: JSONObject?): JSONObject? = t?.let { JSONObject().put("lang", str(it, "lang")).put("title", str(it, "title")).put("forced", it.optBoolean("forced")) }

  // ---------- finding a track ----------

  private fun str(o: JSONObject, k: String): String = if (o.isNull(k)) "" else o.optString(k)
  private fun of(type: String) = tracks.filter { it.optString("type") == type }
  private fun subLangPref() = langOf(io.pref("subLang")).ifEmpty { "en" }
  private fun sameLang(a: String, b: String) = a.isEmpty() || b.isEmpty() || langOf(a) == langOf(b)
  /** A subtitle track's language, from its language tag or else the first word of its title. */
  private fun subLang(t: JSONObject) = langOf(str(t, "lang")).ifEmpty { langOf(Regex("[A-Za-z]+").find(str(t, "title"))?.value ?: "") }

  private fun findTrack(type: String, ref: JSONObject): JSONObject? {
    val list = of(type)
    val l = langOf(str(ref, "lang"))
    val title = if (ref.has("title") && !ref.isNull("title")) ref.optString("title") else null
    val forced = ref.optBoolean("forced")
    return list.firstOrNull { langOf(str(it, "lang")) == l && str(it, "title") == title && it.optBoolean("forced") == forced }
      ?: list.firstOrNull { langOf(str(it, "lang")) == l && it.optBoolean("forced") == forced }
      ?: list.firstOrNull { langOf(str(it, "lang")) == l }
  }

  private fun matchTrack(type: String, ref: JSONObject): JSONObject? {
    val list = of(type)
    if (ref.has("index") && !ref.isNull("index")) {
      // Emby's stream number is the same as the file's, so it's exact unless Emby is converting the video.
      if (ref.optBoolean("external")) {
        val ext = list.filter { it.optBoolean("external") }
        val shown = if (ref.has("displayTitle") && !ref.isNull("displayTitle")) ref.optString("displayTitle") else null
        return ext.firstOrNull { str(it, "title") == shown } ?: ext.firstOrNull { sameLang(str(it, "lang"), str(ref, "lang")) && str(it, "lang").isNotEmpty() }
      }
      if (playMethod != "Transcode") {
        // Only trust the number when the language (or, without one, the name) agrees too.
        val idx = ref.optInt("index")
        val t = list.firstOrNull { !it.optBoolean("external") && it.has("ff-index") && it.optInt("ff-index") == idx }
        if (t != null) {
          val ok = if (str(t, "lang").isNotEmpty() && str(ref, "lang").isNotEmpty()) langOf(str(t, "lang")) == langOf(str(ref, "lang")) else str(t, "title") == str(ref, "title")
          if (ok) return t
        }
      }
    }
    return findTrack(type, ref)
  }

  // ---------- picking ----------

  private fun setAid(t: JSONObject) { val id = t.optInt("id"); if (id != aid) io.set("aid", id.toString()); wantAid = id; pickAudio = false }
  private fun use(t: JSONObject) { val id = t.optInt("id"); subTarget = id.toString(); lastSid = id; holdSubs(); io.note("subtitles start from ${subWhy.ifEmpty { "Settings" }}: ${str(t, "lang").ifEmpty { "?" }} #$id") }
  private fun off() { subTarget = "no"; holdSubs() }

  fun pickTracks() {
    if (!picking || !defaultsKnown || tracks.isEmpty()) return
    val tp = saved()
    val d = defaults ?: JSONObject()
    val savedAudio = tp.optJSONObject("audio")
    val wAudio = savedAudio ?: d.optJSONObject("audio")
    // "off", a saved pick or Emby's pick; null when nothing is known.
    val savedSub: Any? = tp.opt("sub").takeIf { it != null && it != JSONObject.NULL && it != "" && it != false }
    val wSub: Any? = savedSub ?: if (d.optBoolean("subKnown")) (d.optJSONObject("sub") ?: "off") else null
    val audioLang = io.pref("audioLang")
    if (pickAudio && savedAudio == null && audioLang.isNotEmpty()) {
      // Settings: a preferred audio language, when the video has it (else Emby's pick below).
      val l = langOf(audioLang)
      of("audio").firstOrNull { langOf(str(it, "lang")) == l }?.let { setAid(it) }
    }
    if (pickAudio) {
      if (wAudio == null) pickAudio = false
      else matchTrack("audio", wAudio)?.let { setAid(it) }
    }
    if (!pickSub) return
    if (savedSub != null) {
      // Your own pick for this show wins. "Off" is held off for the whole lookout.
      subWhy = "your last pick for this show"
      if (savedSub == "off") { off(); return }
      val t = (savedSub as? JSONObject)?.let { matchTrack("sub", it) }
      if (t != null) { use(t); pickSub = false }
      return
    }
    // Settings: "Always my language" or "Off unless I turn them on".
    val mode = io.pref("subStart")
    if (mode == "off") { subWhy = "your Settings (off)"; off(); return }
    if (mode == "mine") {
      val t = of("sub").firstOrNull { !it.optBoolean("forced") && subLang(it) == subLangPref() }
      if (t != null) { subWhy = "your Settings (your language)"; use(t); pickSub = false; return }
    }
    // Otherwise the show's own default: the subtitles Emby itself would start with, then the
    // subtitles the file marks as default, otherwise off.
    if (wSub is JSONObject) {
      subWhy = "Emby's default"
      val t = matchTrack("sub", wSub) // an external file can arrive a few seconds late
      if (t != null) { use(t); pickSub = false; return }
      // Subtitles inside the video are all there from the start: fall back to the video's own
      // default now rather than leaving the choice to the player.
      if (wSub.optBoolean("external")) return
    }
    val subs = of("sub")
    val fileDefault = if (wSub == "off") null else subs.firstOrNull { it.optBoolean("default") && !it.optBoolean("forced") } ?: subs.firstOrNull { it.optBoolean("default") }
    if (fileDefault != null) { use(fileDefault); subWhy = "the video's default"; pickSub = false; return }
    subWhy = if (wSub == "off") "Emby's default (off)" else "the video's default (none)"
    off()
  }

  fun stopPicking() { picking = false; pickAudio = false; pickSub = false }

  /** Keep the subtitles the app chose for this video, until you change them yourself. */
  fun holdSubs() {
    val target = subTarget ?: return
    val want = if (target == "no") null else target
    if (sid?.toString() != want) io.set("sid", target)
  }

  private fun letGo() { subTarget = null; pickSub = false }

  /** The player's list of tracks changed (or arrived). */
  fun onTracks(list: List<JSONObject>) {
    tracks = list
    aid = list.firstOrNull { it.optString("type") == "audio" && it.optBoolean("selected") }?.optInt("id")
    sid = list.firstOrNull { it.optString("type") == "sub" && it.optBoolean("selected") }?.optInt("id")
    if (sid != null) lastSid = sid
    pickTracks()
    holdSubs()
  }

  /** The end of the lookout for late subtitle files: one last try, then the choice just stays held. */
  fun finish() { pickTracks(); stopPicking(); holdSubs() }

  // ---------- your own choices ----------

  /** Subtitles on/off with one button. Turning on: your last pick, then your language, then Emby's pick. */
  fun toggleSubs() {
    letGo()
    if (sid != null) { io.set("sid", "no"); savePick("sub", "off"); return }
    val subs = of("sub")
    if (subs.isEmpty()) { io.toast("This video has no subtitles."); return }
    val p = saved().optJSONObject("sub")
    val full = subs.filter { !it.optBoolean("forced") }
    val t = p?.let { matchTrack("sub", it) }
      ?: full.firstOrNull { langOf(str(it, "lang")) == subLangPref() }
      ?: (defaults?.optJSONObject("sub"))?.let { matchTrack("sub", it) }
      ?: full.firstOrNull() ?: subs[0]
    io.set("sid", t.optInt("id").toString())
    savePick("sub", refOf(t))
  }

  /** You chose subtitles in the menu: a track id, or "no" for off. */
  fun chooseSub(v: String) {
    letGo()
    io.set("sid", v)
    savePick("sub", if (v == "no") "off" else refOf(of("sub").firstOrNull { it.optInt("id").toString() == v }))
  }

  fun chooseAudio(v: String) {
    pickAudio = false
    wantAid = null
    io.set("aid", v)
    savePick("audio", refOf(of("audio").firstOrNull { it.optInt("id").toString() == v }))
  }

  /** Subtitles just downloaded and turned on: remembered as your pick. */
  fun downloaded(lang: String, title: String) { letGo(); savePick("sub", JSONObject().put("lang", lang).put("title", title).put("forced", false)) }

  // ---------- the lists for the menus ----------

  private fun trackName(t: JSONObject): String {
    val l = if (t.optString("type") == "sub") subLang(t) else langOf(str(t, "lang"))
    return l.takeIf { it.isNotEmpty() }?.let { langName(it) }?.takeIf { it.isNotEmpty() }
      ?: str(t, "lang").takeIf { it.isNotEmpty() }?.let { langName(it) }?.takeIf { it.isNotEmpty() } ?: "Unknown"
  }

  /** English and Spanish first (the languages people here speak); the rest sit behind "Other languages" (g = 1). */
  fun subsList(): JSONArray {
    val subs = of("sub")
    fun note(t: JSONObject): String {
      val n = trackName(t); val title = str(t, "title")
      val bits = ArrayList<String>()
      if (title.isNotEmpty() && title.trim().lowercase() != n.lowercase()) bits.add(title.trim())
      if (t.optBoolean("forced") && !Regex("forced", RegexOption.IGNORE_CASE).containsMatchIn(title)) bits.add("Forced")
      return bits.joinToString(" · ")
    }
    fun rank(t: JSONObject) = when (subLang(t)) { "en" -> 0; "es" -> 1; else -> 9 }
    val coll = java.text.Collator.getInstance(Locale.ENGLISH)
    val main = subs.filter { rank(it) < 9 }.sortedWith(compareBy({ rank(it) }, { it.optInt("id") }))
    val other = subs.filter { rank(it) == 9 }.sortedWith { a, b -> coll.compare(trackName(a), trackName(b)).takeIf { it != 0 } ?: (a.optInt("id") - b.optInt("id")) }
    val out = JSONArray()
    for ((g, list) in listOf(main, other).withIndex()) for (t in list)
      out.put(JSONObject().put("id", t.optInt("id").toString()).put("label", trackName(t)).put("note", note(t)).put("on", t.optInt("id") == sid).put("g", g))
    return out
  }

  fun audioList(): JSONArray {
    val out = JSONArray()
    for (t in of("audio")) {
      val n = trackName(t); val title = str(t, "title").trim()
      val codec = str(t, "codec")
      val tech = listOf(CODEC[codec] ?: codec.uppercase(), channels(t.optInt("demux-channel-count"))).filter { it.isNotEmpty() }.joinToString(" ")
      val bits = ArrayList<String>()
      if (title.isNotEmpty() && title.lowercase() != n.lowercase() && !Regex("^(stereo|mono|surround|5\\.1|7\\.1)$", RegexOption.IGNORE_CASE).matches(title)) bits.add(title)
      if (tech.isNotEmpty()) bits.add(tech)
      out.put(JSONObject().put("id", t.optInt("id").toString()).put("label", n).put("note", bits.joinToString(" · ")).put("on", t.optInt("id") == aid))
    }
    return out
  }

  companion object {
    private val LANGS = mapOf("eng" to "en", "english" to "en", "ger" to "de", "deu" to "de", "german" to "de", "fre" to "fr", "fra" to "fr", "french" to "fr",
      "spa" to "es", "spanish" to "es", "ita" to "it", "italian" to "it", "jpn" to "ja", "japanese" to "ja", "por" to "pt", "portuguese" to "pt",
      "dut" to "nl", "nld" to "nl", "dutch" to "nl", "swe" to "sv", "swedish" to "sv", "nor" to "no", "nob" to "no", "norwegian" to "no",
      "dan" to "da", "danish" to "da", "fin" to "fi", "finnish" to "fi", "pol" to "pl", "polish" to "pl", "rus" to "ru", "russian" to "ru",
      "kor" to "ko", "korean" to "ko", "chi" to "zh", "zho" to "zh", "chinese" to "zh", "ara" to "ar", "arabic" to "ar", "hin" to "hi", "hindi" to "hi",
      "tur" to "tr", "turkish" to "tr")
    /** Languages come as "en", "eng", "English" or with a region like "en-US": this makes them comparable. */
    fun langOf(l: String?): String {
      val k = (l ?: "").lowercase().trim().split('-', '_')[0]
      return LANGS[k] ?: k
    }
    /** A language's English name ("es" -> "Spanish"); the code itself when it isn't a language. */
    fun langName(code: String): String {
      if (code.isEmpty()) return ""
      if (!Regex("[A-Za-z]{2,3}|[A-Za-z]{5,8}").matches(code.split('-', '_')[0])) return code
      return try { Locale.forLanguageTag(code.replace('_', '-')).getDisplayLanguage(Locale.ENGLISH).ifEmpty { code } } catch (_: Throwable) { code }
    }
    private val CODEC = mapOf("ac3" to "Dolby", "eac3" to "Dolby", "truehd" to "Dolby TrueHD", "dts" to "DTS", "dts-hd" to "DTS-HD", "aac" to "AAC", "mp3" to "MP3", "flac" to "FLAC", "opus" to "Opus", "pcm" to "PCM")
    fun channels(n: Int) = when (n) { 1 -> "Mono"; 2 -> "Stereo"; 6 -> "5.1"; 7 -> "6.1"; 8 -> "7.1"; 0 -> ""; else -> "${n}ch" }
  }
}
