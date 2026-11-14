package no.pradhan.agentview.nativeapp.net

import no.pradhan.agentview.nativeapp.app.answer
import no.pradhan.agentview.nativeapp.app.command
import no.pradhan.agentview.nativeapp.app.interrupt
import no.pradhan.agentview.nativeapp.app.permission
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.codex.meetings.Pending
import no.pradhan.agentview.nativeapp.codex.meetings.Question
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
        val p = parseMessage("""{"type":"approval","chat":"c1","slug":"foo","title":"Foo"}""") as ServerMessage.Approval
        assertEquals(ServerMessage.Approval("c1", "foo", "Foo"), p)
        assertEquals("attention", (parseMessage("""{"type":"attention","items":[]}""") as ServerMessage.Other).type)
    }

    @Test
    fun parsesRunsAndTheRunOnALiveChat() {
        val m = parseMessage("""{"type":"runs","runs":[{"id":"r","kind":"goal","chatId":"c","state":"paused","why":"usage limit until 18:00","nextAt":null,"extra":1,"rounds":[{"n":1,"at":5,"outcome":"quiet","line":"ok","costUsd":0.5}]}]}""") as ServerMessage.Runs
        assertEquals("paused", m.runs[0].state)
        assertEquals("ok", m.runs[0].rounds[0].line)
        val live = parseMessage("""{"type":"live","chats":[{"id":"a","run":{"id":"r","kind":"loop","state":"running","nextAt":9,"round":2,"outcome":"blocked"}}]}""") as ServerMessage.Live
        assertEquals("blocked", live.chats[0].run?.outcome)
        assertEquals("""{"type":"run","run":"r","op":"stop"}""", runCmd("r", "stop"))
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

    @Test
    fun parsesInitSessionAndPendingRequests() {
        val m = parseMessage(
            """{"type":"init","state":{"session":{"id":"c1","running":true,"permissionMode":"auto","cwd":"/x","models":[{"value":"opus","displayName":"Opus"}],"commands":[{"name":"compact","description":"d"}],"context":1234},
            "events":[],"pending":[
              {"id":"p1","kind":"permission","toolName":"Bash","title":"Run ls","input":{"command":"ls"},"canAlwaysAllow":true},
              {"id":"p2","kind":"question","questions":[{"question":"Which?","header":"H","multiSelect":true,"options":[{"label":"A","description":"a"},{"label":"B","description":"","preview":"x"}]}]}]}}""",
        ) as ServerMessage.Init
        assertEquals(true, m.session?.running)
        assertEquals("auto", m.session?.permissionMode)
        assertEquals("compact", m.session?.commands?.single()?.name)
        assertEquals(1234L, m.session?.context)
        val perm = m.pending[0] as Pending.Permission
        assertEquals("ls", perm.input.s("command"))
        assertTrue(perm.canAlwaysAllow)
        assertEquals(false, perm.confirmFirst)
        val q = m.pending[1] as Pending.Question
        assertTrue(q.questions.single().multiSelect)
        assertEquals("x", q.questions.single().options[1].preview)
        assertNull(q.questions.single().options[0].preview)
    }

    @Test
    fun parsesPendingResolvedAndSessionMessages() {
        val p = parseMessage("""{"type":"pending","request":{"id":"p","kind":"permission","toolName":"Edit","title":"t","input":{}}}""") as ServerMessage.PendingAdded
        assertEquals("p", p.request.id)
        assertEquals("p", (parseMessage("""{"type":"resolved","id":"p"}""") as ServerMessage.Resolved).id)
        assertEquals("s", (parseMessage("""{"type":"session","session":{"id":"s"}}""") as ServerMessage.SessionUpdate).session.id)
        assertEquals("boom", (parseMessage("""{"type":"error","text":"boom"}""") as ServerMessage.Error).text)
    }

    @Test
    fun parsesToolEventsWithInputsAndParents() {
        val m = parseMessage("""{"type":"event","event":{"id":"t","kind":"tool_use","name":"Edit","input":{"file_path":"/a","n":3},"summary":"s","at":1,"parent":"ag"}}""") as ServerMessage.Event
        assertEquals("/a", m.event.input.s("file_path"))
        assertEquals("ag", m.event.parent)
        val r = parseMessage("""{"type":"event","event":{"id":"r","kind":"result","text":"ok","costUsd":0.25,"isError":false,"at":1}}""") as ServerMessage.Event
        assertEquals(0.25, r.event.costUsd, 1e-9)
    }

    @Test
    fun parsesEarlierBody() {
        val (events, left) = parseEarlier("""{"events":[{"id":"a","kind":"user","text":"x","at":1}],"earlier":7}""")
        assertEquals(listOf("a"), events.map { it.id })
        assertEquals(7, left)
    }

    @Test
    fun commandsMatchTheWebProtocol() {
        assertEquals("""{"type":"steer","text":"go","id":"i"}""", steerCmd("go", "i"))
        assertEquals("""{"type":"permission","id":"p","allow":true,"always":true}""", permissionCmd("p", true, true))
        assertEquals("""{"type":"permission","id":"p","allow":false}""", permissionCmd("p", false))
        assertEquals("""{"type":"answer","id":"q","answers":{"Which?":"A, B"}}""", answerCmd("q", mapOf("Which?" to "A, B")))
        assertEquals("""{"type":"interrupt"}""", interruptCmd())
        assertEquals("""{"type":"set_permission_mode","mode":"plan"}""", setModeCmd("plan"))
        assertEquals("""{"type":"open_session","sessionId":"s"}""", openSessionCmd("s"))
    }
}

class LiveSampleTest {
    @org.junit.Test
    fun parsesRealLiveMessage() {
        val m = parseMessage("""{"type":"live","chats":[{"id":"19b","sessionId":"d52","cwd":"/a","title":"T","running":true,"agents":0,"pending":0,"status":"s","lastActive":1794050304965,"mcpFailed":16,"cost":263.5148876000001,"spend":{"today":{"x":1.0},"week":{"x":1.0}},"stalled":false,"last":"It","edits":{"add":44,"del":0}}]}""") as ServerMessage.Live
        org.junit.Assert.assertEquals(44, m.chats[0].edits?.add)
    }
}
