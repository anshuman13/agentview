package no.pradhan.agentview.nativeapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class ChatStoreTest {
    private fun ev(id: String, text: String = "") = ChatEvent(id, "assistant", text = text)
    private fun init(chat: String, vararg events: ChatEvent) = ServerMessage.Init(chat, events.toList(), 0)

    @Test
    fun cacheKeepsEightMostRecentChats() {
        val c = RecentChats()
        for (i in 1..10) c.put("c$i", listOf(ev("e$i")), 0)
        assertEquals((3..10).map { "c$it" }, c.ids)
        assertNull(c.get("c1"))
        c.put("c3", listOf(ev("n")), 0)
        assertEquals("c3", c.ids.last())
    }

    @Test
    fun cacheTrimsToWindowAndCountsEarlier() {
        val c = RecentChats()
        c.put("a", (1..200).map { ev("e$it") }, 5)
        assertEquals(ROW_WINDOW, c.get("a")!!.events.size)
        assertEquals(55, c.get("a")!!.earlier)
        assertEquals("e51", c.get("a")!!.events.first().id)
    }

    @Test
    fun cacheDropsClosedChats() {
        val c = RecentChats()
        c.put("a", listOf(ev("1")), 0)
        c.put("b", listOf(ev("2")), 0)
        c.retainOnly(setOf("b"))
        assertEquals(listOf("b"), c.ids)
    }

    @Test
    fun switchingBackShowsCachedRowsAtOnce() {
        val s = ChatStore()
        s.show("a")
        s.handle(init("a", ev("1", "one")))
        s.show("b")
        assertEquals(emptyList<ChatEvent>(), s.state.value.events)
        s.handle(init("b", ev("2", "two")))
        s.show("a")
        assertEquals("one", s.state.value.events.single().text)
        assertEquals(false, s.state.value.settled)
    }

    @Test
    fun appendsUpdateTheLastRowAndWaitForInit() {
        val s = ChatStore()
        s.show("a")
        s.handle(ServerMessage.Event(ev("1", "early")))
        assertEquals(0, s.state.value.events.size)
        s.handle(init("a", ev("1", "he")))
        s.handle(ServerMessage.Append("1", 2, "llo"))
        assertEquals("hello", s.state.value.events.last().text)
        s.handle(ServerMessage.Event(ev("1", "hello!")))
        s.handle(ServerMessage.Event(ev("2", "next")))
        assertEquals(listOf("hello!", "next"), s.state.value.events.map { it.text })
    }

    @Test
    fun initForAnotherChatIsIgnoredAfterAView() {
        val s = ChatStore()
        s.show("a")
        s.handle(init("z", ev("9")))
        assertEquals(0, s.state.value.events.size)
        s.handle(init("a", ev("1")))
        assertNotNull(s.state.value.events.firstOrNull())
    }

    @Test
    fun liveMessageEvictsClosedChatsFromCache() {
        val s = ChatStore()
        s.show("a")
        s.handle(init("a", ev("1")))
        s.show("b")
        s.handle(ServerMessage.Live(listOf(LiveChat("b"))))
        assertNull(s.cache.get("a"))
        assertEquals(listOf("b"), s.state.value.live.map { it.id })
    }
}
