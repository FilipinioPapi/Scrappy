package app.scrappy.player.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/** The same walk-through as the Rust test in profiles.rs (add_switch_pin_remove), plus the file. */
@RunWith(RobolectricTestRunner::class)
class StoreTest {
  private fun signed(c: Store, user: String) {
    c["server"] = "https://emby"; c["userId"] = "id-$user"; c["userName"] = user; c["token"] = "tok-$user"
  }
  private fun fails(f: () -> Unit): Boolean = try { f(); false } catch (e: Store.Wrong) { true }

  @Test fun addSwitchPinRemove() {
    val c = Store()
    signed(c, "jay")
    c["ndToken"] = "nd-jay"; c["ndServer"] = "https://nd"
    assertEquals(1, c.peopleJson().getJSONArray("people").length())
    val jay = c.active

    // Add a second person: sign-ins are cleared, addresses stay.
    c.addPerson()
    assertTrue(!c.embyIn && c["server"] == "https://emby" && c["ndToken"].isEmpty())
    signed(c, "kid")
    assertEquals(2, c.peopleJson().getJSONArray("people").length())
    val kid = c.active
    assertNotEquals(jay, kid)

    // Switch back: everything of the first person returns.
    c.switchTo(jay, "")
    assertEquals("tok-jay", c["token"]); assertEquals("nd-jay", c["ndToken"])

    // PIN on the second person.
    assertTrue(fails { c.setPin(kid, "", "12") })
    c.setPin(kid, "", "1234")
    assertTrue(fails { c.switchTo(kid, "0000") })
    assertEquals("tok-jay", c["token"])
    c.switchTo(kid, "1234")
    assertEquals("tok-kid", c["token"])
    assertTrue(c["ndToken"].isEmpty())
    assertTrue(fails { c.setPin(kid, "9999", "") })
    c.setPin(kid, "1234", "")

    // Abandoning "add person" (never signed in) leaves no empty entry behind.
    c.addPerson()
    c.switchTo(jay, "")
    assertEquals(2, c.peopleJson().getJSONArray("people").length())

    // Signing in as someone already listed reuses their entry.
    c.addPerson()
    signed(c, "kid")
    c.peopleJson()
    assertEquals(kid, c.active); assertEquals(2, c.count)

    // Removing the active person falls back to the other.
    c.remove(kid, "")
    assertEquals("tok-jay", c["token"]); assertEquals(1, c.count)

    // Nothing sensitive in the list.
    val s = c.peopleJson().toString()
    assertFalse(s.contains("tok-") || s.contains("nd-jay"))
  }

  /** A file written by the Rust side (its field names, a PIN it made) reads back and round-trips. */
  @Test fun readsTheOldFile() {
    val f = File.createTempFile("config", ".json")
    f.writeText(
      """{"server":"https://emby","userId":"u1","userName":"jay","token":"t1","deviceId":"dev","serverName":"Home",
        "ndServer":"","ndName":"","ndUser":"","ndSalt":"","ndToken":"","ndJwt":"","absServer":"","absName":"","absUser":"","absToken":"",
        "requestsUrl":"https://req","activeProfile":"p1","profiles":[
        {"id":"p1","pinSalt":"","pinHash":"","server":"https://emby","serverName":"Home","userId":"u1","userName":"jay","token":"t1"},
        {"id":"p2","pinSalt":"0123456789abcdef0123456789abcdef","pinHash":"518086b85ef999fa4de0b04d1d4ee902d661d59d415ee1159a65ad803a8c114d",
         "server":"https://emby","serverName":"Home","userId":"u2","userName":"dad","token":"t2"}]}""",
    )
    val c = Store.load(f)
    assertTrue(c.embyIn)
    assertTrue(fails { c.switchTo("p2", "0000") })
    c.switchTo("p2", "1234")
    assertEquals("t2", c["token"]); assertEquals("dad", c["userName"])
    c.save(f)
    val d = Store.load(f)
    assertEquals("p2", d.active); assertEquals("dev", d["deviceId"]); assertEquals("https://req", d["requestsUrl"]); assertEquals(2, d.count)
    d.switchTo("p1", "")
    assertEquals("t1", d["token"])
    f.delete()
  }
}
