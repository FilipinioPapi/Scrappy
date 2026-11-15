package app.scrappy.player.tv

/**
 * A small QR code maker for the "sign in with your phone" link: plain bytes, medium error
 * correction, sizes 1 to 10 (up to 213 characters), which is plenty for a home network address.
 * Returns rows of dark (true) and light squares, without the quiet border.
 */
object Qr {
  // Per size, at medium error correction: all codewords, error codewords per block, number of blocks.
  private val TOTAL = intArrayOf(0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346)
  private val ECC = intArrayOf(0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26)
  private val BLOCKS = intArrayOf(0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5)
  private val ALIGN = arrayOf(
    intArrayOf(), intArrayOf(), intArrayOf(6, 18), intArrayOf(6, 22), intArrayOf(6, 26), intArrayOf(6, 30), intArrayOf(6, 34),
    intArrayOf(6, 22, 38), intArrayOf(6, 24, 42), intArrayOf(6, 26, 46), intArrayOf(6, 28, 50),
  )

  private fun dataWords(v: Int) = TOTAL[v] - ECC[v] * BLOCKS[v]
  private fun room(v: Int) = dataWords(v) - if (v < 10) 2 else 3

  fun encode(text: String): Array<BooleanArray>? {
    val bytes = text.toByteArray(Charsets.UTF_8)
    val v = (1..10).firstOrNull { bytes.size <= room(it) } ?: return null
    // The message: "bytes follow", how many, the bytes, an end mark, then filler.
    val bits = ArrayList<Boolean>(dataWords(v) * 8)
    fun put(value: Int, n: Int) { for (i in n - 1 downTo 0) bits.add((value ushr i) and 1 == 1) }
    put(4, 4); put(bytes.size, if (v < 10) 8 else 16)
    for (b in bytes) put(b.toInt() and 0xFF, 8)
    val cap = dataWords(v) * 8
    put(0, minOf(4, cap - bits.size))
    while (bits.size % 8 != 0) bits.add(false)
    var pad = 0xEC
    while (bits.size < cap) { put(pad, 8); pad = pad xor 0xEC xor 0x11 }
    val data = IntArray(cap / 8) { i -> var w = 0; for (k in 0 until 8) w = (w shl 1) or (if (bits[i * 8 + k]) 1 else 0); w }
    val words = interleave(data, v)

    val n = v * 4 + 17
    val m = Array(n) { BooleanArray(n) }
    val fixed = Array(n) { BooleanArray(n) }
    fun set(x: Int, y: Int, dark: Boolean) { m[y][x] = dark; fixed[y][x] = true }

    for (i in 0 until n) { set(6, i, i % 2 == 0); set(i, 6, i % 2 == 0) }
    for ((cx, cy) in listOf(3 to 3, n - 4 to 3, 3 to n - 4))
      for (dy in -4..4) for (dx in -4..4) {
        val x = cx + dx; val y = cy + dy
        if (x in 0 until n && y in 0 until n) { val d = maxOf(Math.abs(dx), Math.abs(dy)); set(x, y, d != 2 && d != 4) }
      }
    val al = ALIGN[v]
    for (i in al.indices) for (j in al.indices) {
      if ((i == 0 && j == 0) || (i == 0 && j == al.size - 1) || (i == al.size - 1 && j == 0)) continue
      for (dy in -2..2) for (dx in -2..2) set(al[i] + dx, al[j] + dy, maxOf(Math.abs(dx), Math.abs(dy)) != 1)
    }
    fun format(mask: Int) {
      val d = mask                                   // medium error correction is 00 in the top two bits
      var rem = d
      repeat(10) { rem = (rem shl 1) xor ((rem ushr 9) * 0x537) }
      val f = ((d shl 10) or rem) xor 0x5412
      fun bit(i: Int) = (f ushr i) and 1 == 1
      for (i in 0..5) set(8, i, bit(i))
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8))
      for (i in 9..14) set(14 - i, 8, bit(i))
      for (i in 0..7) set(n - 1 - i, 8, bit(i))
      for (i in 8..14) set(8, n - 15 + i, bit(i))
      set(8, n - 8, true)
    }
    format(0)
    if (v >= 7) {
      var rem = v
      repeat(12) { rem = (rem shl 1) xor ((rem ushr 11) * 0x1F25) }
      val f = (v shl 12) or rem
      for (i in 0 until 18) { val dark = (f ushr i) and 1 == 1; val a = n - 11 + i % 3; val b = i / 3; set(a, b, dark); set(b, a, dark) }
    }

    // The message goes in two-wide columns from the right, snaking up and down, skipping fixed squares.
    var i = 0
    var right = n - 1
    while (right >= 1) {
      if (right == 6) right = 5
      for (vert in 0 until n) for (j in 0..1) {
        val x = right - j
        val up = ((right + 1) and 2) == 0
        val y = if (up) n - 1 - vert else vert
        if (!fixed[y][x] && i < words.size * 8) { m[y][x] = (words[i ushr 3] ushr (7 - (i and 7))) and 1 == 1; i++ }
      }
      right -= 2
    }

    fun mask(k: Int) {
      for (y in 0 until n) for (x in 0 until n) {
        if (fixed[y][x]) continue
        val flip = when (k) {
          0 -> (x + y) % 2 == 0
          1 -> y % 2 == 0
          2 -> x % 3 == 0
          3 -> (x + y) % 3 == 0
          4 -> (x / 3 + y / 2) % 2 == 0
          5 -> x * y % 2 + x * y % 3 == 0
          6 -> (x * y % 2 + x * y % 3) % 2 == 0
          else -> ((x + y) % 2 + x * y % 3) % 2 == 0
        }
        if (flip) m[y][x] = !m[y][x]
      }
    }
    // Try all eight patterns and keep the one a camera reads most easily.
    var best = 0; var low = Int.MAX_VALUE
    for (k in 0 until 8) {
      mask(k); format(k)
      val p = penalty(m, n)
      if (p < low) { low = p; best = k }
      mask(k)
    }
    mask(best); format(best)
    return m
  }

  private fun interleave(data: IntArray, v: Int): IntArray {
    val blocks = BLOCKS[v]; val ecc = ECC[v]; val total = TOTAL[v]
    val short = blocks - total % blocks
    val shortLen = total / blocks
    val div = divisor(ecc)
    val parts = ArrayList<IntArray>()
    var k = 0
    for (b in 0 until blocks) {
      val len = shortLen - ecc + if (b < short) 0 else 1
      val dat = data.copyOfRange(k, k + len); k += len
      val block = IntArray(shortLen + 1)
      System.arraycopy(dat, 0, block, 0, len)
      System.arraycopy(remainder(dat, div), 0, block, shortLen + 1 - ecc, ecc)
      parts.add(block)
    }
    val out = IntArray(total); var o = 0
    for (i in 0..shortLen) for (b in 0 until blocks) if (i != shortLen - ecc || b >= short) out[o++] = parts[b][i]
    return out
  }

  private fun mul(x: Int, y: Int): Int {
    var z = 0
    for (i in 7 downTo 0) { z = (z shl 1) xor ((z ushr 7) * 0x11D); z = z xor (((y ushr i) and 1) * x) }
    return z
  }
  private fun divisor(degree: Int): IntArray {
    val r = IntArray(degree); r[degree - 1] = 1
    var root = 1
    repeat(degree) {
      for (j in r.indices) { r[j] = mul(r[j], root); if (j + 1 < r.size) r[j] = r[j] xor r[j + 1] }
      root = mul(root, 2)
    }
    return r
  }
  private fun remainder(data: IntArray, div: IntArray): IntArray {
    val r = IntArray(div.size)
    for (b in data) {
      val f = b xor r[0]
      System.arraycopy(r, 1, r, 0, r.size - 1); r[r.size - 1] = 0
      for (i in r.indices) r[i] = r[i] xor mul(div[i], f)
    }
    return r
  }

  private fun penalty(m: Array<BooleanArray>, n: Int): Int {
    var p = 0
    var dark = 0
    for (pass in 0..1) for (a in 0 until n) {
      var run = 0; var last = false
      var hist = 0
      for (b in 0 until n) {
        val c = if (pass == 0) m[a][b] else m[b][a]
        if (pass == 0 && c) dark++
        if (b > 0 && c == last) { run++; if (run == 5) p += 3 else if (run > 5) p++ } else { run = 1; last = c }
        // 1011101 with four light squares on either side looks like a corner marker.
        hist = ((hist shl 1) or (if (c) 1 else 0)) and 0x7FF
        if (b >= 10 && (hist == 0x5D0 || hist == 0x05D)) p += 40
      }
    }
    for (y in 0 until n - 1) for (x in 0 until n - 1) {
      val c = m[y][x]
      if (c == m[y][x + 1] && c == m[y + 1][x] && c == m[y + 1][x + 1]) p += 3
    }
    p += Math.abs(dark * 20 / (n * n) - 10) * 10
    return p
  }
}
