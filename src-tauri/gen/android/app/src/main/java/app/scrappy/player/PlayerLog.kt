package app.scrappy.player

import android.os.SystemClock

/**
 * A short diary of what the TV's video player has been doing (the last 40 things), plus how it
 * is right now. Shown by "Player details" in the player's settings, so a frozen film can be
 * photographed and understood. Nothing here leaves the TV.
 */
object PlayerLog {
  private val lines = ArrayDeque<String>()
  private val t0 = SystemClock.elapsedRealtime()
  @Volatile var live: String = ""

  @Synchronized
  fun add(what: String) {
    val s = (SystemClock.elapsedRealtime() - t0) / 1000
    lines.addLast("%d:%02d  %s".format(s / 60, s % 60, what.take(160)))
    while (lines.size > 40) lines.removeFirst()
  }

  @Synchronized
  fun text(): String = live + "\n\n" + lines.reversed().joinToString("\n")
}
