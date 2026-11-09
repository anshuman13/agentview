package no.pradhan.agentview.nativeapp

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TranscriptFeedTest {
    private fun user(id: String) = ChatEvent(id, "user", text = "hi $id")
    private fun reply(id: String, text: String, streaming: Boolean = true) = ChatEvent(id, "assistant", text = text, streaming = streaming)

    @Test
    fun aStreamedTokenPatchesOnlyTheStreamingItem() {
        val events = listOf(user("1"), reply("2", "done", false), user("3"), reply("4", "he"))
        val first = buildView("a", events, 0L, null)
        val next = nextView(first, "a", events.toMutableList().also { it[3] = appendTo(events[3], 2, "llo")!! }, 0L)
        assertSame(first.items[0], next.items[0])
        assertSame(first.items[1], next.items[1])
        assertSame(first.items[2], next.items[2])
        assertEquals("hello", (next.items[3] as Item.Assistant).text)
        assertSame(first.agents, next.agents)
        assertSame(first.rewinds, next.rewinds)
        assertEquals(listOf("4", "3", "2", "1"), next.rows.map { it.id })
    }

    @Test
    fun aFullRebuildKeepsTheItemsThatDidNotChange() {
        val events = listOf(user("1"), reply("2", "one", false), user("3"))
        val first = buildView("a", events, 0L, null)
        val next = nextView(first, "a", events + reply("4", "two"), 0L)
        assertSame(first.items[0], next.items[0])
        assertSame(first.items[1], next.items[1])
        assertEquals(4, next.items.size)
    }

    @Test
    fun anotherChatStartsFromScratch() {
        val first = buildView("a", listOf(user("1")), 0L, null)
        val next = nextView(first, "b", listOf(user("1")), 0L)
        assertNotSame(first.items[0], next.items[0])
        assertEquals("b", next.chat)
    }

    @Test
    fun tokensOfOneChatAreBatched() = runTest {
        val source = MutableStateFlow("a" to listOf(user("1"), reply("2", "")))
        val feed = TranscriptFeed(source, backgroundScope, UnconfinedTestDispatcher(testScheduler), batchMs = 32)
        var seen = 0
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { feed.view.collect { seen++ } }
        advanceTimeBy(1)
        val before = seen
        var text = ""
        repeat(20) {
            text += "x"
            source.value = "a" to listOf(user("1"), reply("2", text))
            advanceTimeBy(5)
        }
        advanceTimeBy(40)
        assertEquals(text, (feed.view.value.items.last() as Item.Assistant).text)
        assertTrue(seen - before in 1..5)
    }
}
