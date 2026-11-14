package app.scrappy.player

import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * The TV's own video player (Android Media3 / ExoPlayer).
 * Rust drives it with a few simple commands and asks for its state about four
 * times a second, so the rest of Scrappy works the same as with mpv on the PC.
 * The video sits behind the (see-through) web page, exactly like on the PC.
 */
@OptIn(UnstableApi::class)
@TauriPlugin
class ExoPlugin(private val activity: Activity) : Plugin(activity) {
  private val main = Handler(Looper.getMainLooper())
  private var webView: WebView? = null
  private var player: ExoPlayer? = null
  private var view: PlayerView? = null

  private var loadSeq = 0
  private var readySeq = 0
  private var ended = false
  private var error: String? = null
  private var muted = false
  private var volume = 100f
  // Getting going again by itself after a hiccup (network drop, the TV's decoder stumbling).
  private var retries = 0
  private var kicks = 0
  private var goodTicks = 0
  private var lastPos = -1L
  private var stuckSince = 0L
  private var watching = false
  private val watchdog = object : Runnable {
    override fun run() {
      try { checkStuck() } catch (e: Exception) { }
      main.postDelayed(this, 2000)
    }
  }

  /** Meant to be playing but the picture has not moved: nudge it, then reload it at the same spot. */
  private fun checkStuck() {
    val p = player ?: return
    if (p.currentMediaItem == null || !p.playWhenReady || error != null) { stuckSince = 0L; return }
    val now = SystemClock.elapsedRealtime()
    val pos = p.currentPosition
    val st = p.playbackState
    val moving = (st == Player.STATE_READY && pos != lastPos) || st == Player.STATE_ENDED
    lastPos = pos
    if (moving) {
      stuckSince = 0L
      // A minute of steady playing: the earlier trouble is over.
      if (++goodTicks > 30) { retries = 0; kicks = 0 }
      return
    }
    goodTicks = 0
    if (stuckSince == 0L) { stuckSince = now; return }
    if (now - stuckSince < 15_000) return
    stuckSince = now
    kicks++
    when {
      st == Player.STATE_IDLE -> p.prepare()
      // (A film that never got going at all is loaded again straight away.)
      kicks == 1 && readySeq == loadSeq -> p.seekTo(pos)
      kicks <= 3 -> { p.stop(); p.prepare() }
      // Nothing helped: say so and leave the player, so it is never a dead end. Resume picks it up.
      else -> error = "Playback stopped responding. Choose Resume to carry on from the same spot."
    }
  }
  // mpv-style track numbers (1, 2, 3… per type) -> where the track lives in Media3.
  private val trackMap = HashMap<String, Pair<Int, Int>>()

  override fun load(webView: WebView) {
    this.webView = webView
  }

  private fun ui(invoke: Invoke, block: () -> JSObject?) {
    main.post {
      try {
        val r = block()
        if (r != null) invoke.resolve(r) else invoke.resolve()
      } catch (e: Exception) {
        invoke.reject(e.message ?: e.toString())
      }
    }
  }

  private fun ensure(): ExoPlayer {
    player?.let { return it }
    val renderers = DefaultRenderersFactory(activity)
      .setEnableDecoderFallback(true)
    val p = ExoPlayer.Builder(activity, renderers)
      .setSeekBackIncrementMs(10_000)
      .setSeekForwardIncrementMs(30_000)
      .build()
    // Jumps land on the nearest clean frame of the film: near instant on a TV chip, where an
    // exact landing can take seconds of catching up (and a few in a row jam the decoder).
    p.setSeekParameters(androidx.media3.exoplayer.SeekParameters.CLOSEST_SYNC)
    p.addListener(object : Player.Listener {
      override fun onPlaybackStateChanged(state: Int) {
        if (state == Player.STATE_READY && readySeq != loadSeq) readySeq = loadSeq
        if (state == Player.STATE_ENDED) ended = true
      }
      override fun onPlayerError(e: PlaybackException) {
        // Most errors in the middle of a film are a passing hiccup: carry on from the same spot
        // a few times before giving up. (A file the TV can't play at all fails before it is ready.)
        if (readySeq == loadSeq && retries < 3 && p.currentMediaItem != null) {
          retries++
          main.postDelayed({
            if (player === p && error == null && p.currentMediaItem != null && p.playbackState == Player.STATE_IDLE) p.prepare()
          }, 800L * retries)
          return
        }
        error = "The TV couldn't play this (${e.errorCodeName})."
      }
    })
    val v = PlayerView(activity)
    v.useController = false
    v.setShutterBackgroundColor(Color.BLACK)
    v.setKeepContentOnPlayerReset(false)
    v.isFocusable = false
    v.isFocusableInTouchMode = false
    v.subtitleView?.setStyle(
      CaptionStyleCompat(Color.WHITE, Color.TRANSPARENT, Color.TRANSPARENT, CaptionStyleCompat.EDGE_TYPE_OUTLINE, Color.BLACK, null)
    )
    v.player = p
    // Some fan releases (One Pace) carry a line in their styled subtitles that only shows on
    // players without full styling support: "Your media player does not support the subtitle
    // format...". The TV's player shows the dialogue fine, so that notice is dropped. Added after
    // the view's own listener, so this one has the last word on what is shown.
    p.addListener(object : Player.Listener {
      override fun onCues(cueGroup: androidx.media3.common.text.CueGroup) {
        val keep = cueGroup.cues.filter { c ->
          val t = c.text?.toString() ?: ""
          !(t.contains("media player does not support", true) || t.contains("recommended video players", true))
        }
        if (keep.size != cueGroup.cues.size) v.subtitleView?.setCues(keep)
      }
    })
    // Put the video behind the web page.
    val wv = webView
    val parent = (wv?.parent as? ViewGroup) ?: activity.findViewById<ViewGroup>(android.R.id.content)
    parent.addView(v, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    wv?.setBackgroundColor(Color.TRANSPARENT)
    player = p
    view = v
    if (!watching) { watching = true; main.postDelayed(watchdog, 2000) }
    return p
  }

  @Command
  fun open(invoke: Invoke) {
    val a = invoke.getArgs()
    val url = a.getString("url")
    val start = a.optDouble("start", 0.0)
    val subs = a.optJSONArray("subs")
    ui(invoke) {
      val p = ensure()
      val configs = ArrayList<MediaItem.SubtitleConfiguration>()
      if (subs != null) {
        for (i in 0 until subs.length()) {
          val s = subs.getJSONObject(i)
          val su = s.optString("url")
          val mime = when {
            su.contains(".vtt", true) -> MimeTypes.TEXT_VTT
            su.contains(".ass", true) || su.contains(".ssa", true) -> MimeTypes.TEXT_SSA
            else -> MimeTypes.APPLICATION_SUBRIP
          }
          configs.add(
            MediaItem.SubtitleConfiguration.Builder(Uri.parse(su))
              .setMimeType(mime)
              .setLanguage(s.optString("lang").ifEmpty { null })
              .setLabel(s.optString("title").ifEmpty { null })
              .setId("ext$i")
              .build()
          )
        }
      }
      val item = MediaItem.Builder().setUri(url).setSubtitleConfigurations(configs).build()
      loadSeq++
      ended = false
      error = null
      retries = 0; kicks = 0; goodTicks = 0; stuckSince = 0L; lastPos = -1L
      trackMap.clear()
      // Start with no text track picked; Scrappy picks subtitles itself.
      p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
        .clearOverrides()
        .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
        .setPreferredTextLanguage(null)
        .setSelectUndeterminedTextLanguage(false)
        .build()
      p.setMediaItem(item, (start * 1000).toLong())
      p.prepare()
      p.playWhenReady = true
      view?.visibility = android.view.View.VISIBLE
      JSObject().put("seq", loadSeq)
    }
  }

  @Command
  fun control(invoke: Invoke) {
    val a = invoke.getArgs()
    val what = a.getString("what")
    ui(invoke) {
      val p = player ?: return@ui null
      when (what) {
        "pause" -> { p.playWhenReady = !a.optBoolean("on", true); wake(p) }
        "toggle" -> { p.playWhenReady = !p.playWhenReady; wake(p) }
        "seek" -> {
          val t = a.optDouble("value", 0.0)
          val target = if (a.optBoolean("relative", false)) p.currentPosition + (t * 1000).toLong() else (t * 1000).toLong()
          p.seekTo(target.coerceAtLeast(0))
          wake(p)
        }
        "speed" -> p.playbackParameters = PlaybackParameters(a.optDouble("value", 1.0).toFloat())
        "volume" -> { volume = a.optDouble("value", 100.0).toFloat(); p.volume = if (muted) 0f else (volume / 100f).coerceIn(0f, 1f) }
        "mute" -> { muted = a.optBoolean("on", false); p.volume = if (muted) 0f else (volume / 100f).coerceIn(0f, 1f) }
        "aspect" -> view?.resizeMode = when (a.optString("value")) {
          "fill" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
          "stretch" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
          else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
        "subScale" -> view?.subtitleView?.setFractionalTextSize(0.0533f * a.optDouble("value", 1.0).toFloat())
        "track" -> selectTrack(p, a.optString("type"), a.optString("id"))
        "stop" -> {
          p.stop()
          p.clearMediaItems()
          view?.visibility = android.view.View.GONE
        }
        // "Reload video": throw the TV's player away, so the next film starts on a brand new one.
        "reset" -> {
          val v = view
          player = null
          view = null
          try { p.release() } catch (e: Exception) { }
          if (v != null) { v.player = null; (v.parent as? ViewGroup)?.removeView(v) }
        }
      }
      null
    }
  }

  /** Asked to play while the player has dropped its file (after an error): load it again there. */
  private fun wake(p: ExoPlayer) {
    if (p.playWhenReady && p.playbackState == Player.STATE_IDLE && p.currentMediaItem != null && error == null) p.prepare()
  }

  private fun selectTrack(p: ExoPlayer, type: String, id: String) {
    val cType = if (type == "audio") C.TRACK_TYPE_AUDIO else C.TRACK_TYPE_TEXT
    val b = p.trackSelectionParameters.buildUpon().clearOverridesOfType(cType)
    if (id == "auto") {
      // Back to the TV player's own pick (a new video starts fresh).
      b.setTrackTypeDisabled(cType, false)
    } else if (id == "no" || id.isEmpty()) {
      if (cType == C.TRACK_TYPE_TEXT) b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
    } else {
      val loc = trackMap["$type:$id"] ?: return
      val group = p.currentTracks.groups.getOrNull(loc.first) ?: return
      b.setTrackTypeDisabled(cType, false)
      b.addOverride(TrackSelectionOverride(group.mediaTrackGroup, loc.second))
    }
    p.trackSelectionParameters = b.build()
  }

  @Command
  fun state(invoke: Invoke) {
    ui(invoke) {
      val o = JSObject()
      val p = player
      o.put("seq", loadSeq)
      o.put("ready", readySeq)
      o.put("ended", ended)
      if (error != null) o.put("error", error)
      if (p == null) return@ui o
      val dur = p.duration
      o.put("pos", p.currentPosition / 1000.0)
      o.put("dur", if (dur == C.TIME_UNSET) 0.0 else dur / 1000.0)
      o.put("cached", p.bufferedPosition / 1000.0)
      o.put("paused", !p.playWhenReady)
      o.put("buffering", p.playbackState == Player.STATE_BUFFERING)
      o.put("speed", p.playbackParameters.speed.toDouble())
      o.put("volume", volume.toDouble())
      o.put("mute", muted)
      o.put("video", p.videoSize.width > 0)
      o.put("tracks", tracks(p.currentTracks))
      o
    }
  }

  private fun tracks(t: Tracks): JSArray {
    val out = JSArray()
    trackMap.clear()
    val counters = HashMap<String, Int>()
    t.groups.forEachIndexed { gi, g ->
      val type = when (g.type) {
        C.TRACK_TYPE_AUDIO -> "audio"
        C.TRACK_TYPE_TEXT -> "sub"
        C.TRACK_TYPE_VIDEO -> "video"
        else -> return@forEachIndexed
      }
      for (ti in 0 until g.length) {
        if (!g.isTrackSupported(ti, true) && type != "sub") continue
        val f = g.getTrackFormat(ti)
        val n = (counters[type] ?: 0) + 1
        counters[type] = n
        trackMap["$type:$n"] = Pair(gi, ti)
        val o = JSObject()
        val ext = f.id?.contains("ext") == true
        o.put("id", n)
        o.put("type", type)
        o.put("selected", g.isTrackSelected(ti))
        f.language?.let { o.put("lang", it) }
        f.label?.let { o.put("title", it) }
        o.put("external", ext)
        o.put("default", (f.selectionFlags and C.SELECTION_FLAG_DEFAULT) != 0)
        o.put("forced", (f.selectionFlags and C.SELECTION_FLAG_FORCED) != 0)
        val codec = (f.sampleMimeType ?: f.codecs ?: "").substringAfter('/').lowercase()
        o.put("codec", codec)
        if (f.channelCount > 0) o.put("demux-channel-count", f.channelCount)
        // The stream's number inside the file, counted from 0 like Emby does.
        if (!ext) f.id?.substringAfterLast(':')?.toIntOrNull()?.let { o.put("ff-index", it - 1) }
        out.put(o)
      }
    }
    return out
  }

  /** What this TV can play by itself, so Emby only converts what it must. */
  @Command
  fun caps(invoke: Invoke) {
    val o = JSObject()
    val list = android.media.MediaCodecList(android.media.MediaCodecList.REGULAR_CODECS)
    val types = HashSet<String>()
    for (info in list.codecInfos) if (!info.isEncoder) info.supportedTypes.forEach { types.add(it.lowercase()) }
    val video = JSArray()
    mapOf(
      "h264" to "video/avc", "hevc" to "video/hevc", "vp9" to "video/x-vnd.on2.vp9", "av1" to "video/av01",
      "mpeg2video" to "video/mpeg2", "vp8" to "video/x-vnd.on2.vp8", "mpeg4" to "video/mp4v-es"
    ).forEach { (name, mime) -> if (types.contains(mime)) video.put(name) }
    val audio = JSArray()
    // Media3 decodes these itself on any TV.
    listOf("aac", "mp3", "flac", "opus", "vorbis", "pcm_s16le", "pcm_s24le", "alac").forEach { audio.put(it) }
    val caps = androidx.media3.exoplayer.audio.AudioCapabilities.getCapabilities(
      activity, androidx.media3.common.AudioAttributes.DEFAULT, null
    )
    fun can(mime: String, enc: Int) = types.contains(mime) || caps.supportsEncoding(enc)
    if (can("audio/ac3", C.ENCODING_AC3)) audio.put("ac3")
    if (can("audio/eac3", C.ENCODING_E_AC3)) audio.put("eac3")
    if (can("audio/vnd.dts", C.ENCODING_DTS)) audio.put("dts")
    if (caps.supportsEncoding(C.ENCODING_DTS_HD)) audio.put("dtshd")
    if (can("audio/true-hd", C.ENCODING_DOLBY_TRUEHD)) audio.put("truehd")
    o.put("video", video)
    o.put("audio", audio)
    invoke.resolve(o)
  }

  override fun onDestroy() {
    main.removeCallbacks(watchdog)
    player?.release()
    player = null
  }
}
