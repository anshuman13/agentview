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

    private fun perm(id: String) = Pending.Permission(id, "Bash", "Run", "", kotlinx.serialization.json.JsonObject(emptyMap()), false, false)

    @Test
    fun pendingRequestsArriveAndResolve() {
        val s = ChatStore()
        s.show("a")
        s.handle(ServerMessage.PendingAdded(perm("early")))
        assertEquals(0, s.state.value.pending.size)
        s.handle(ServerMessage.Init("a", listOf(ev("1")), 0, SessionInfo(id = "a", running = true), listOf(perm("p1"))))
        s.handle(ServerMessage.PendingAdded(perm("p2")))
        s.handle(ServerMessage.PendingAdded(perm("p2")))
        assertEquals(listOf("p1", "p2"), s.state.value.pending.map { it.id })
        s.handle(ServerMessage.Resolved("p1"))
        assertEquals(listOf("p2"), s.state.value.pending.map { it.id })
        assertEquals(true, s.state.value.session?.running)
    }

    @Test
    fun sessionUpdatesOnlyApplyToTheShownChat() {
        val s = ChatStore()
        s.show("a")
        s.handle(ServerMessage.Init("a", listOf(ev("1")), 0, SessionInfo(id = "a", model = "x")))
        s.handle(ServerMessage.SessionUpdate(SessionInfo(id = "other", model = "y")))
        assertEquals("x", s.state.value.session?.model)
        s.handle(ServerMessage.SessionUpdate(SessionInfo(id = "a", model = "z")))
        assertEquals("z", s.state.value.session?.model)
    }

    @Test
    fun switchingChatsClearsSessionAndPending() {
        val s = ChatStore()
        s.show("a")
        s.handle(ServerMessage.Init("a", listOf(ev("1")), 0, SessionInfo(id = "a"), listOf(perm("p"))))
        s.show("b")
        assertNull(s.state.value.session)
        assertEquals(0, s.state.value.pending.size)
    }

    @Test
    fun earlierRowsGoInFrontWithoutDuplicates() {
        val s = ChatStore()
        s.show("a")
        s.handle(ServerMessage.Init("a", listOf(ev("3"), ev("4")), 5))
        s.prepend("a", listOf(ev("1"), ev("2"), ev("3")), 2)
        assertEquals(listOf("1", "2", "3", "4"), s.state.value.events.map { it.id })
        assertEquals(2, s.state.value.earlier)
        s.prepend("zzz", listOf(ev("0")), 0)
        assertEquals(4, s.state.value.events.size)
    }

    @Test
    fun localSteerRowIsReplacedByTheServerEchoOrDropped() {
        val s = ChatStore()
        s.show("a")
        s.handle(ServerMessage.Init("a", listOf(ev("1")), 0))
        s.addLocal("a", ChatEvent("m", "user", text = "now", stopping = true))
        assertEquals(true, s.state.value.events.last().stopping)
        s.handle(ServerMessage.Event(ChatEvent("m", "user", text = "now")))
        assertEquals(false, s.state.value.events.last().stopping)
        s.addLocal("a", ChatEvent("n", "user", text = "x"))
        s.dropLocal("a", "n")
        assertEquals(listOf("1", "m"), s.state.value.events.map { it.id })
    }

    @Test
    fun concurrentHandleAndAddLocalKeepBothChanges() {
        val s = ChatStore()
        s.show("a")
        s.handle(init("a", ev("0")))
        val n = 500
        val streamed = Thread { for (i in 1..n) s.handle(ServerMessage.Event(ev("s$i"))) }
        val local = Thread { for (i in 1..n) s.addLocal("a", ev("l$i")) }
        streamed.start(); local.start(); streamed.join(); local.join()
        assertEquals(2 * n + 1, s.state.value.events.size)
    }
}
