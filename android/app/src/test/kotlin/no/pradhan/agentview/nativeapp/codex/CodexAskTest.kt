package no.pradhan.agentview.nativeapp.codex

import no.pradhan.agentview.nativeapp.chat.ChatStore
import no.pradhan.agentview.nativeapp.chat.Dictation
import no.pradhan.agentview.nativeapp.chat.restoreUnsent
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.ServerMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CodexAskTest {
    private val mac = "http://mac:7777"
    private fun init(chat: String) = ServerMessage.Init(chat, listOf(ChatEvent("e", "assistant", text = "x")), 0)

    @Test
    fun newChatInitIsAdoptedWhenExpected() {
        val s = ChatStore()
        s.show("a")
        s.handle(init("a"))
        s.expectSwitch()
        s.handle(init("b"))
        assertEquals("b", s.wanted)
        assertEquals("b", s.state.value.shownId)
        assertEquals(true, s.state.value.settled)
        s.handle(init("a"))
        assertEquals("b", s.state.value.shownId)
    }

    @Test
    fun strayInitIsDroppedWithoutASwitch() {
        val s = ChatStore()
        s.show("a")
        s.handle(init("b"))
        assertEquals("a", s.wanted)
        assertEquals(false, s.state.value.settled)
    }

    @Test
    fun cancelledSwitchDropsTheLateInit() {
        val s = ChatStore()
        s.show("a")
        s.expectSwitch()
        s.cancelSwitch()
        s.handle(init("b"))
        assertEquals("a", s.wanted)
    }

    @Test
    fun dailyChatIsReusedOnlyForTheSameDayAndMac() {
        val d = DailyChat("2026-11-07", mac, "c1", "s1")
        assertEquals(d, reusableDaily(d, "2026-11-07", mac))
        assertNull(reusableDaily(d, "2026-11-08", mac))
        assertNull(reusableDaily(d, "2026-11-07", "http://other:7777"))
        assertNull(reusableDaily(d, "2026-11-07", mac, fresh = true))
        assertNull(reusableDaily(null, "2026-11-07", mac))
    }

    @Test
    fun dailyChatFindsItsOpenChatByIdOrSession() {
        val live = listOf(LiveChat("x", sessionId = "s1"), LiveChat("y"))
        assertEquals("x", openDaily(DailyChat("d", mac, "gone", "s1"), live)?.id)
        assertEquals("y", openDaily(DailyChat("d", mac, "y", null), live)?.id)
        assertNull(openDaily(DailyChat("d", mac, "gone", null), live))
    }

    @Test
    fun dailyChatRoundTrips() {
        val d = DailyChat("2026-11-07", mac, "c1", null)
        assertEquals(d, parseDaily(encodeDaily(d)))
        assertNull(parseDaily("nope"))
    }

    @Test
    fun unsentTextComesBackInFrontOfNewTyping() {
        assertEquals("hi", restoreUnsent("", "hi"))
        assertEquals("hi", restoreUnsent("  ", "hi"))
        assertEquals("hi\nmore", restoreUnsent("more", "hi"))
    }

    @Test
    fun dictationInsertsAtTheCaretAndReplacesItsPartial() {
        val d = Dictation()
        assertEquals("hello wor" to 9, d.apply("hello ", 6, "wor", false))
        assertEquals("hello world" to 11, d.apply("hello wor", 9, "world", true))
        assertEquals("a b" to 3, d.apply("a", 1, "b", true))
    }

    @Test
    fun dictationKeepsTextAfterTheCaret() {
        val d = Dictation()
        assertEquals("one two three" to 7, d.apply("one  three", 4, "two", false))
        assertEquals("one two three" to 7, d.apply("one two three", 7, "two", true))
    }

    @Test
    fun dictationLeavesAnEditedFieldAlone() {
        val d = Dictation()
        d.apply("", 0, "hel", false)
        assertNull(d.apply("hel!", 4, "hello", false))
        assertNull(d.apply("hel!", 4, "hello", true))
        assertEquals("hel! next" to 9, d.apply("hel!", 4, "next", true))
    }

    private fun meetingRow(title: String, profile: String, start: Long): Row {
        val f = SYNCED_FIELDS.getValue("meetings").associateWith { kotlinx.serialization.json.JsonNull as kotlinx.serialization.json.JsonElement }.toMutableMap()
        f["title"] = toJson(title); f["starts_at"] = toJson(start)
        return Row("meetings", title, profile, f = f)
    }

    @Test
    fun guessesPersonalForTravelAndPersonalEventsWorkForWorkWords() {
        val now = 1_800_000_000_000
        assertEquals(PERSONAL, guessProfile("Eurostar tomorrow worth upgrading", emptyList(), WORK, now))
        assertEquals(PERSONAL, guessProfile("what time is the louvre visit", listOf(meetingRow("Louvre visit", PERSONAL, now + DAY_MS)), WORK, now))
        assertEquals(WORK, guessProfile("summarise the slack thread on oncall", emptyList(), PERSONAL, now))
        assertEquals(WORK, guessProfile("prep for the rollout", listOf(meetingRow("Claude rollout", WORK, now + DAY_MS)), PERSONAL, now))
        assertEquals(PERSONAL, guessProfile("what next", emptyList(), PERSONAL, now))
    }
}
