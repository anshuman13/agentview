package no.pradhan.agentview.nativeapp

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NoticeActionsTest {
    private class Fake(var open: List<Pending> = emptyList(), var fail: Boolean = false) : NoticeRemote {
        val sent = mutableListOf<Pair<String, String>>()
        override suspend fun pending(chat: String): List<Pending> { if (fail) error("down"); return open }
        override suspend fun send(chat: String, body: String) { sent += chat to body }
    }

    private val notice = Notice(NoticeKind.Approval, "c1", "Claude needs you", "Fix")
    private fun perm(id: String = "p1", tool: String = "Bash") = Pending.Permission(id, tool, "Run", "", JsonObject(emptyMap()), true, false)
    private fun ask(vararg q: String) = Pending.Question("q1", q.map { Ask(it, "", false, emptyList()) })
    private fun run(f: Fake, op: String, text: String = "", readOnly: Boolean = false, permissionId: String = "p1") = runBlocking { runNoticeAction(f, readOnly, op, "c1", text, permissionId) { "id1" } }

    @Test fun allowAndDenySendThePermissionCommand() {
        val f = Fake(listOf(perm()))
        assertEquals(ActionResult.Sent, run(f, NoticeOp.ALLOW))
        assertEquals(ActionResult.Sent, run(f, NoticeOp.DENY))
        assertEquals(listOf("c1" to permissionCmd("p1", true), "c1" to permissionCmd("p1", false)), f.sent)
    }

    @Test fun readOnlySendsNothing() {
        val f = Fake(listOf(perm()))
        assertEquals(ActionResult.ReadOnly, run(f, NoticeOp.ALLOW, readOnly = true))
        assertEquals(ActionResult.ReadOnly, run(f, NoticeOp.REPLY, "hi", readOnly = true))
        assertTrue(f.sent.isEmpty())
    }

    @Test fun anAnsweredRequestIsNotSentAgain() {
        val f = Fake()
        assertEquals(ActionResult.Failed("Already answered"), run(f, NoticeOp.ALLOW))
        assertTrue(f.sent.isEmpty())
    }

    @Test fun planApprovalNeedsTheChat() {
        val f = Fake(listOf(perm(tool = "ExitPlanMode")))
        assertTrue(run(f, NoticeOp.ALLOW) is ActionResult.Failed)
        assertEquals(NoticeAsk.None, runBlocking { noticeAsk(f, notice).ask })
    }

    @Test fun replyAnswersAQuestionOrPromptsAFinishedChat() {
        val q = Fake(listOf(ask("Which?")))
        assertEquals(ActionResult.Sent, run(q, NoticeOp.REPLY, " blue "))
        assertEquals(answerCmd("q1", mapOf("Which?" to "blue")), q.sent.single().second)
        val done = Fake()
        assertEquals(ActionResult.Sent, run(done, NoticeOp.REPLY, "go on"))
        assertEquals(promptCmd("go on", false, "id1"), done.sent.single().second)
    }

    @Test fun replyNeedsTextAndASingleQuestion() {
        assertTrue(run(Fake(), NoticeOp.REPLY, "  ") is ActionResult.Failed)
        assertTrue(run(Fake(listOf(ask("a", "b"))), NoticeOp.REPLY, "x") is ActionResult.Failed)
    }

    @Test fun aLostConnectionIsReportedNotThrown() {
        assertTrue(run(Fake(fail = true), NoticeOp.ALLOW) is ActionResult.Failed)
    }

    @Test fun askKindFollowsTheOpenRequest() {
        val p = runBlocking { noticeAsk(Fake(listOf(perm())), notice) }
        assertEquals(NoticeAsk.Permission, p.ask)
        assertEquals("p1", p.permissionId)
        assertEquals("Bash: Fix", p.body)
        assertEquals(NoticeAsk.Question, runBlocking { noticeAsk(Fake(listOf(ask("a"))), notice).ask })
        assertEquals(notice, runBlocking { noticeAsk(Fake(fail = true), notice) })
    }

    @Test fun aNewPermissionIsNotAnsweredByAnOldNotification() {
        val f = Fake(listOf(perm("p2")))
        assertEquals(ActionResult.Failed("Already answered"), run(f, NoticeOp.ALLOW, permissionId = "p1"))
        assertTrue(f.sent.isEmpty())
    }

    @Test fun waitingListsFiveLongestIdleFirst() {
        val live = (1..7).map { LiveChat(id = "c$it", title = "T$it", cwd = "/w/repo$it", pending = 1, lastActive = (100 - it).toLong()) } + LiveChat(id = "x", pending = 0)
        val snap = waitingSnapshot(live)
        assertEquals(7, snap.total)
        assertEquals(listOf("c7", "c6", "c5", "c4", "c3"), snap.lines.map { it.chatId })
        assertEquals("T7 · repo7", snap.lines[0].text())
        assertEquals(WaitingSnapshot(), waitingSnapshot(listOf(LiveChat(id = "x"))))
    }

    @Test fun failedChatNotifiesOnceAndNotAsFinished() {
        val was = LiveChat(id = "a", title = "T", cwd = "/w/repo", running = true)
        val n = notices(listOf(was), listOf(was.copy(running = false, failed = true)))
        assertEquals(listOf(NoticeKind.Failed), n.map { it.kind })
        assertTrue(notices(listOf(was.copy(running = false, failed = true)), listOf(was.copy(running = false, failed = true))).isEmpty())
    }

    private fun edit(tool: String, vararg kv: Pair<String, String>) = Pending.Permission("p1", tool, "Edit", "", JsonObject(kv.associate { it.first to kotlinx.serialization.json.JsonPrimitive(it.second) }), true, false)

    @Test fun anEditApprovalShowsTheFileAndChangedLines() {
        val p = edit("Edit", "file_path" to "/a/b/Main.kt", "old_string" to "x\nold\nz", "new_string" to "x\nnew\nmore\nz")
        assertEquals("Edit Main.kt +2 -1" to "-old\n+new\n+more", editPreview(p))
        val n = runBlocking { noticeAsk(Fake(listOf(p)), notice) }
        assertEquals("Edit Main.kt +2 -1", n.title)
        assertEquals("-old\n+new\n+more", n.detail)
    }

    @Test fun aWriteCountsEveryLineAndCapsThePreview() {
        val p = edit("Write", "file_path" to "n.txt", "content" to (1..12).joinToString("\n") { "l$it" })
        val (title, body) = editPreview(p)!!
        assertEquals("Write n.txt +12 -0", title)
        assertEquals(8, body.lines().size)
        assertEquals(null, editPreview(perm()))
    }
}
