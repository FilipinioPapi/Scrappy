package app.scrappy.player.tv

/**
 * The profile PIN check, the same sum the Rust side (profiles.rs pin_hash) has always used, so PINs
 * saved in config.json keep working once Kotlin does the checking. It is Rust's DefaultHasher
 * (SipHash 1-3 with zero keys) over (salt, pin, round, "scrappy-pin") for rounds 0..3, each written
 * as 16 hex digits. A PIN only keeps housemates out of each other's profile on this device.
 */
object Pins {
  private val TAG = "scrappy-pin".toByteArray(Charsets.UTF_8)

  fun hash(salt: String, pin: String): String {
    val s = salt.toByteArray(Charsets.UTF_8)
    val p = pin.toByteArray(Charsets.UTF_8)
    val sb = StringBuilder(64)
    for (round in 0 until 4) {
      // Rust hashes a str as its bytes then 0xFF, and a u8 as one byte.
      val m = ByteArray(s.size + p.size + TAG.size + 4)
      var i = 0
      System.arraycopy(s, 0, m, i, s.size); i += s.size; m[i++] = 0xFF.toByte()
      System.arraycopy(p, 0, m, i, p.size); i += p.size; m[i++] = 0xFF.toByte()
      m[i++] = round.toByte()
      System.arraycopy(TAG, 0, m, i, TAG.size); i += TAG.size; m[i] = 0xFF.toByte()
      sb.append(String.format("%016x", sip13(m)))
    }
    return sb.toString()
  }

  fun matches(salt: String, pin: String, saved: String) = saved.isNotEmpty() && hash(salt, pin) == saved

  private fun sip13(m: ByteArray): Long {
    var v0 = 0x736f6d6570736575L
    var v1 = 0x646f72616e646f6dL
    var v2 = 0x6c7967656e657261L
    var v3 = 0x7465646279746573L
    fun round() {
      v0 += v1; v1 = java.lang.Long.rotateLeft(v1, 13); v1 = v1 xor v0; v0 = java.lang.Long.rotateLeft(v0, 32)
      v2 += v3; v3 = java.lang.Long.rotateLeft(v3, 16); v3 = v3 xor v2
      v0 += v3; v3 = java.lang.Long.rotateLeft(v3, 21); v3 = v3 xor v0
      v2 += v1; v1 = java.lang.Long.rotateLeft(v1, 17); v1 = v1 xor v2; v2 = java.lang.Long.rotateLeft(v2, 32)
    }
    fun word(at: Int, n: Int): Long {
      var w = 0L
      for (k in 0 until n) w = w or ((m[at + k].toLong() and 0xFF) shl (8 * k))
      return w
    }
    val full = m.size / 8 * 8
    var at = 0
    while (at < full) { val w = word(at, 8); v3 = v3 xor w; round(); v0 = v0 xor w; at += 8 }
    val last = word(full, m.size - full) or ((m.size.toLong() and 0xFF) shl 56)
    v3 = v3 xor last; round(); v0 = v0 xor last
    v2 = v2 xor 0xFF
    round(); round(); round()
    return v0 xor v1 xor v2 xor v3
  }
}
