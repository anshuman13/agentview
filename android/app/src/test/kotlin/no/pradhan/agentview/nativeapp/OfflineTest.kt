package no.pradhan.agentview.nativeapp

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class FakeKv : KeyValue {
    val map = HashMap<String, String>()
    override fun get(key: String) = map[key]
    override fun put(key: String, value: String?) { if (value == null) map.remove(key) else map[key] = value }
}

class OfflineTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun q(id: String, chat: String = "c1") = Queued(id, chat, "text $id")

    @Test fun draftSnippetTakesFirstLineClipped() {
        assertNull(draftSnippet(" \n  "))
        assertEquals("fix the build", draftSnippet("\n  fix the build\nand more"))
        assertEquals("abcdefghi…", draftSnippet("abcdefghijklmnop", 10))
    }
    private fun ev(id: String, text: String = "") = ChatEvent(id, "assistant", text = text)

    @Test
    fun draftsSurviveARestartAndClearOnEmpty() {
        val kv = FakeKv()
        Drafts(kv).set("a", "hello")
        assertEquals("hello", Drafts(kv).get("a"))
        Drafts(kv).set("a", "")
        assertEquals("", Drafts(kv).get("a"))
    }

    @Test
    fun draftsKeepTheNewestThirty() {
        val d = Drafts(FakeKv())
        for (i in 1..35) d.set("c$i", "t$i")
        assertEquals("", d.get("c5"))
        assertEquals("t35", d.get("c35"))
    }

    @Test
    fun outboxSurvivesARestart() {
        val kv = FakeKv()
        Outbox(kv).add(q("1"))
        assertEquals(listOf("1"), Outbox(kv).items.value.map { it.id })
    }

    @Test
    fun flushSendsInOrderAndEmpties() = runBlocking {
        val o = Outbox(FakeKv())
        o.add(q("1")); o.add(q("2", "c2")); o.add(q("3"))
        val sent = ArrayList<String>()
        o.flush { sent += it.id; null }
        assertEquals(listOf("1", "2", "3"), sent)
        assertTrue(o.items.value.isEmpty())
    }

    @Test
    fun failureKeepsTheFailedAndLaterOnes() = runBlocking {
        val kv = FakeKv()
        val o = Outbox(kv)
        o.add(q("1")); o.add(q("2")); o.add(q("3"))
        assertEquals("boom", o.flush { if (it.id == "2") "boom" else null })
        assertEquals(listOf("2", "3"), Outbox(kv).items.value.map { it.id })
        val sent = ArrayList<String>()
        o.flush { sent += it.id; null }
        assertEquals(listOf("2", "3"), sent)
    }

    @Test
    fun cancelRemovesOne() {
        val o = Outbox(FakeKv())
        o.add(q("1")); o.add(q("2", "c2")); o.add(q("3"))
        o.cancel("3")
        assertEquals(listOf("1", "2"), o.items.value.map { it.id })
    }

    @Test
    fun outboxRefusesPastTheCap() {
        val o = Outbox(FakeKv())
        repeat(MAX_OUTBOX) { assertTrue(o.add(q("$it"))) }
        assertTrue(!o.add(q("x")))
    }

    @Test
    fun diskKeepsTheEightNewestChats() {
        val d = TranscriptDisk(tmp.newFolder("t"))
        for (i in 1..10) d.save("c$i", "T$i", RecentChats.Entry(listOf(ev("e$i")), 0))
        assertNull(d.load("c2"))
        assertEquals("T10", d.load("c10")?.title)
        assertEquals("e3", d.load("c3")?.events?.first()?.id)
    }

    @Test
    fun diskCapsSizePerChatKeepingNewestRows() {
        val d = TranscriptDisk(tmp.newFolder("t"), maxBytes = 5000)
        d.save("a", "A", RecentChats.Entry((1..100).map { ev("e$it", "x".repeat(100)) }, 2))
        val got = d.load("a")!!
        assertEquals("e100", got.events.last().id)
        assertTrue(got.events.size < 100)
        assertEquals(2 + 100 - got.events.size, got.earlier)
    }

    @Test
    fun storeRestoresFromDiskAndPersistsOnLeaving() {
        val saved = HashMap<String, RecentChats.Entry>()
        val store = ChatStore(persist = { id, e -> saved[id] = e }, restore = { saved[it] })
        store.show("a")
        store.handle(ServerMessage.Init("a", listOf(ev("1")), 0))
        store.show("b")
        assertNotNull(saved["a"])
        val fresh = ChatStore(persist = { _, _ -> }, restore = { saved[it] })
        fresh.show("a")
        assertEquals(emptyList<ChatEvent>(), fresh.state.value.events)
        runBlocking { fresh.fill("a") }
        assertEquals(listOf("1"), fresh.state.value.events.map { it.id })
        assertTrue(!fresh.state.value.settled)
    }
}

class TranscriptListTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test
    fun titlesListNewestFirstAndKeepTheLimit() {
        val d = TranscriptDisk(tmp.newFolder("t"))
        val e = RecentChats.Entry(listOf(ChatEvent("e", "assistant", text = "x")), 0)
        val t = ChatTitles(FakeKv(), keep = 2)
        t.set("a", "First"); t.set("b", "Second"); t.set("c", "Third"); t.set("b", "Second")
        assertEquals(listOf("b" to "Second", "c" to "Third"), t.list())
        assertEquals("", t.get("a"))
        assertTrue(d.save("a", "First", e))
    }
}
