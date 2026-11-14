package no.pradhan.agentview.nativeapp.app

import no.pradhan.agentview.nativeapp.net.LiveChat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ExtrasLogicTest {
    private fun chat(id: String, running: Boolean = false, pending: Int = 0, provider: String? = null) = LiveChat(id = id, title = "Fix tests", cwd = "/Users/me/agentview/", running = running, pending = pending, provider = provider)

    @Test fun runningNotesKeepRunningChatsAndTheirStart() {
        val live = listOf(chat("a", running = true), chat("b"), chat("c", running = true, pending = 1).copy(status = "Idle"))
        val notes = runningNotes(live, mapOf("a" to 5L), 100L)
        assertEquals(listOf(RunningNote("a", "Fix tests", "Working", 5L, 0), RunningNote("c", "Fix tests", "Working", 100L, 1)), notes)
    }

    @Test fun skipsTheChatOnScreen() {
        assertEquals(emptyList<Notice>(), notices(listOf(chat("a")), listOf(chat("a", pending = 1)), "a"))
    }

    @Test fun approvalWhenPendingGrows() {
        val n = notices(listOf(chat("a")), listOf(chat("a", pending = 1)))
        assertEquals(listOf(Notice(NoticeKind.Approval, "a", "Claude needs you in agentview", "Fix tests")), n)
    }

    @Test fun finishedWhenRunningStops() {
        val n = notices(listOf(chat("a", running = true)), listOf(chat("a")))
        assertEquals(listOf(Notice(NoticeKind.Finished, "a", "Claude finished in agentview", "Fix tests")), n)
    }

    @Test fun noticeNamesTheChatsProvider() {
        val n = notices(listOf(chat("a", running = true, provider = "codex")), listOf(chat("a", provider = "codex")))
        assertEquals(listOf(Notice(NoticeKind.Finished, "a", "Codex finished in agentview", "Fix tests")), n)
    }

    @Test fun mutedChatSkipsFinishedButNotApproval() {
        val muted = setOf("s1")
        assertEquals(emptyList<Notice>(), notices(listOf(chat("a", running = true).copy(sessionId = "s1")), listOf(chat("a").copy(sessionId = "s1")), muted = muted))
        assertEquals(NoticeKind.Approval, notices(listOf(chat("a").copy(sessionId = "s1")), listOf(chat("a", pending = 1).copy(sessionId = "s1")), muted = muted).single().kind)
    }

    @Test fun approvalWinsOverFinished() {
        assertEquals(NoticeKind.Approval, notices(listOf(chat("a", running = true)), listOf(chat("a", pending = 1))).single().kind)
    }

    @Test fun newChatsAndUnchangedChatsAreSilent() {
        assertEquals(emptyList<Notice>(), notices(emptyList(), listOf(chat("a", pending = 2))))
        assertEquals(emptyList<Notice>(), notices(listOf(chat("a", pending = 2)), listOf(chat("a", pending = 2))))
        assertEquals(emptyList<Notice>(), notices(listOf(chat("a", pending = 2)), listOf(chat("a", pending = 1))))
    }

    @Test fun chatLinkRoundTrips() {
        assertEquals("a b/1", parseDeepLink(chatLink("a b/1"))?.chat)
    }


    @Test fun sketchesLinkCarriesTheSlugAndBuildsPageIsIgnored() {
        assertEquals("login.html", parseDeepLink("agentview://open?page=sketches&slug=login.html")?.slug)
        assertNull(parseDeepLink("agentview://open?page=builds&slug=pink-door")?.page)
    }

    @Test fun shortcutActionsParse() {
        assertEquals(Shortcut.NEW_CHAT, parseDeepLink("agentview://open?action=new-chat")?.action)
        assertEquals(Shortcut.ADD_TASK, parseDeepLink("agentview://open?action=add-task")?.action)
        assertNull(parseDeepLink("agentview://open?action=other"))
        assertEquals(Tab.Chat.route, routeFor(DeepLink(action = Shortcut.NEW_CHAT)))
        assertEquals(Tab.Codex.route, routeFor(DeepLink(action = Shortcut.ADD_TASK)))
    }

    @Test fun linkOnlyShareBecomesATaskWithTheUrl() {
        assertEquals(ShareTask("https://a.dev/x", "", "https://a.dev/x"), shareTask(null, "https://a.dev/x"))
    }

    @Test fun subjectIsTheTitleAndTextTheBody() {
        assertEquals(ShareTask("Great post", "Read this\n", "https://a.dev/x").copy(body = "Read this"), shareTask("Great post", "Read this https://a.dev/x"))
    }

    @Test fun firstLineIsTheTitleWithoutSubject() {
        assertEquals(ShareTask("Buy milk", "and eggs", null), shareTask(null, "Buy milk\nand eggs"))
    }

    @Test fun chatTextJoinsSubjectAndText() {
        assertEquals("Great post\nhttps://a.dev", shareChatText("Great post", "https://a.dev"))
        assertEquals("https://a.dev", shareChatText("https://a.dev", "https://a.dev"))
    }
}
