package app.scrappy.player.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import java.io.File

/** Writes each code as rows of 1 and 0 next to the previews, where a real QR reader checks them. */
class QrTest {
  @Test fun codes() {
    val out = File(System.getenv("PREVIEW_OUT") ?: "build/previews", "qr").apply { mkdirs() }
    val texts = listOf(
      "http://192.168.1.14:45678/0a1b2c3d4e", "A", "http://10.0.0.5:8/x",
      "http://192.168.100.200:65535/0123456789abcdef0123456789abcdef-and-some-more-to-reach-a-bigger-size",
      "x".repeat(150), "y".repeat(213),
    )
    texts.forEachIndexed { i, t ->
      val m = Qr.encode(t); assertNotNull(m)
      assertEquals(m!!.size, m[0].size)
      File(out, "$i.txt").writeText(t + "\n" + m.joinToString("\n") { row -> row.joinToString("") { if (it) "1" else "0" } })
    }
    assertEquals(null, Qr.encode("z".repeat(214)))
    assertEquals(29, Qr.encode(texts[0])!!.size)
  }
}
