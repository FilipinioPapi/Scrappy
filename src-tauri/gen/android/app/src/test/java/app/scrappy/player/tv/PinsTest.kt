package app.scrappy.player.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The expected sums were printed by the Rust pin_hash itself, so a PIN set before still opens. */
class PinsTest {
  @Test fun sameAsRust() {
    val want = listOf(
      Triple("0123456789abcdef0123456789abcdef", "1234", "518086b85ef999fa4de0b04d1d4ee902d661d59d415ee1159a65ad803a8c114d"),
      Triple("", "0000", "fce2947d847306949cfcd5a7fa6a4d4e42a1eabf6c4c92455c554cea179f322b"),
      Triple("a1b2c3d4e5f60718293a4b5c6d7e8f90", "9876", "996449001fca99ddabb1aa06e5102e8eda39b421bd82d30ee6cb0cc0975353ce"),
      Triple("sälté", "4321", "038560db7f7cac442f6ac7b012a74db92802220db96e16b6794f6d5bed8791b8"),
    )
    for ((salt, pin, sum) in want) assertEquals(sum, Pins.hash(salt, pin))
    assertTrue(Pins.matches("", "0000", want[1].third))
    assertFalse(Pins.matches("", "0001", want[1].third))
    assertFalse(Pins.matches("", "0000", ""))
  }
}
