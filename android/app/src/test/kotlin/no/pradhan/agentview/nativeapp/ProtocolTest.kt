package no.pradhan.agentview.nativeapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {
    @Test
    fun parsesInitWithTailAndUnknownKeys() {
        val m = parseMessage(
            """{"type":"init","boot":1,"state":{"session":{"id":"c1","model":"x"},"status":"Idle","earlier":12,"extra":true,
            "events":[{"id":"e1","kind":"user","text":"hi","at":1,"future":1},{"id":"e2","kind":"tool_use","name":"Bash","input":{"a":1},"summary":"ls","at":2}]}}""",
        ) as ServerMessage.Init
        assertEquals("c1", m.chatId)
        assertEquals(12, m.earlier)
        assertEquals(listOf("user", "tool_use"), m.events.map { it.kind })
        assertEquals("ls", m.events[1].summary)
    }

    @Test
    fun parsesLiveList() {
        val m = parseMessage("""{"type":"live","chats":[{"id":"a","title":"T","running":true,"pending":0,"status":"Working","lastActive":5,"last":"done","cwd":"/x/y","other":1}]}""") as ServerMessage.Live
        assertEquals("T", m.chats[0].title)
        assertTrue(m.chats[0].running)
        assertEquals("done", m.chats[0].last)
    }

    @Test
    fun parsesEventAppendAndOther() {
        val e = parseMessage("""{"type":"event","event":{"id":"e","kind":"assistant","text":"a","streaming":true,"at":1}}""") as ServerMessage.Event
        assertTrue(e.event.streaming)
        val a = parseMessage("""{"type":"append","id":"e","offset":1,"text":"bc"}""") as ServerMessage.Append
        assertEquals(1, a.offset)
        assertEquals("attention", (parseMessage("""{"type":"attention","items":[]}""") as ServerMessage.Other).type)
    }

    @Test
    fun appendAddsOnlyTheNewTail() {
        val ev = ChatEvent("e", "assistant", text = "hello", streaming = true)
        assertEquals("hello world", appendTo(ev, 5, " world")?.text)
        assertEquals("hello world", appendTo(ev, 3, "lo world")?.text)
        assertNull(appendTo(ev, 9, "x"))
        assertNull(appendTo(ev, 0, "hel"))
        assertNull(appendTo(ChatEvent("u", "user", text = "a"), 1, "b"))
    }

    @Test
    fun composerCommandsMatchTheWeb() {
        assertEquals("""{"type":"prompt","text":"a \"q\"","id":"i"}""", promptCmd("a \"q\"", false, "i"))
        assertEquals("""{"type":"queue","text":"b","id":"i"}""", promptCmd("b", true, "i"))
        assertEquals("""{"type":"view","id":"c"}""", viewCmd("c"))
    }

    @Test
    fun sseParserSkipsPingAndJoinsData() {
        val ids = mutableListOf<String>()
        val got = mutableListOf<String>()
        val p = SseParser({ ids += it }, { got += it })
        listOf("event: ping", "data:", "", "id: 7", "data: {\"a\":1}", "", "id: 8", "data: x", "data: y", "").forEach(p::line)
        assertEquals(listOf("{\"a\":1}", "x\ny"), got)
        assertEquals(listOf("7", "8"), ids)
    }

    @Test
    fun backoffCapsAtFifteenSeconds() {
        assertEquals(listOf(1000L, 2000L, 4000L, 8000L, 15000L, 15000L), (0..5).map(::backoffMs))
    }
}
