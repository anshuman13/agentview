package no.pradhan.agentview.nativeapp.sessions

import no.pradhan.agentview.nativeapp.chat.shortModel
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.protocolJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FoldersTest {
    private val repos = listOf(Repo("agentview", "/w/agentview"), Repo("shop", "/w/shop"))
    private val trees = listOf(Worktree("t1", "/w/shop", "/wt/shop-x", "x"))
    private fun live(id: String, cwd: String, sid: String? = id, running: Boolean = false, pending: Int = 0, active: Long = 1, title: String = id) =
        LiveChat(id, title = title, cwd = cwd, running = running, pending = pending, lastActive = active, sessionId = sid)
    private fun saved(id: String, cwd: String, at: Long = 1, title: String = id, first: String? = null) = SavedSession(id, title, cwd, null, at, first)

    @Test
    fun foldersResolveWorktreesAndNestedDirectories() {
        assertEquals("/w/shop", folderKey("/wt/shop-x/sub", repos, trees))
        assertEquals("/w/agentview", folderKey("/w/agentview/server", repos, trees))
        assertEquals("/else/where", folderKey("/else/where", repos, trees))
        assertEquals("agentview", folderName("/w/agentview"))
    }

    @Test
    fun groupsLiveAndSavedByRepoWithNeedsFirst() {
        val ws = Workspace(repos, trees, listOf(saved("s1", "/w/agentview", 50), saved("s2", "/w/shop", 10), saved("l1", "/w/agentview", 5)))
        val groups = groupByRepo(listOf(live("l1", "/w/agentview/server", active = 100), live("l2", "/wt/shop-x", pending = 1, active = 20)), ws)
        assertEquals(listOf("shop", "agentview"), groups.map { it.name })
        assertEquals(listOf("l1"), groups[1].open.map { it.id })
        assertEquals(listOf("s1"), groups[1].recent.map { it.sessionId })
        assertEquals(1, groups[0].waiting)
    }

    @Test
    fun searchMatchesTitleRepoAndSavedFirstPrompt() {
        val ws = Workspace(repos, trees, listOf(saved("s1", "/w/agentview", title = "Fix", first = "migrate the database")))
        val l = listOf(live("l1", "/w/shop", title = "Checkout flow", sid = null))
        assertEquals(listOf("shop"), groupByRepo(l, ws, "checkout").map { it.name })
        assertEquals(listOf("agentview"), groupByRepo(l, ws, "database migrate").map { it.name })
        assertEquals(listOf("agentview"), groupByRepo(l, ws, "agentview").map { it.name })
        assertEquals(emptyList<String>(), groupByRepo(l, ws, "nothing here").map { it.name })
        assertEquals(listOf("agentview", "shop"), groupByRepo(emptyList(), Workspace(repos)).map { it.name }.sorted())
    }

    @Test
    fun pinnedChatsStayInTheirGroup() {
        val ws = Workspace(repos, trees, listOf(saved("s1", "/w/agentview")), pins = listOf("s1", "l1"))
        val l = listOf(live("l1", "/w/shop"))
        assertEquals(listOf(1, 1), groupByRepo(l, ws).map { it.open.size + it.recent.size })
        assertEquals(listOf("l1", "s1"), pinnedRows(l, ws, "").map { it.key }.sortedBy { it != "l1" })
    }

    @Test
    fun recentRowsMergeOpenAndSavedNewestFirst() {
        val ws = Workspace(repos, trees, listOf(saved("s1", "/w/agentview", at = 5), saved("s2", "/w/agentview", at = 1)))
        val l = listOf(live("l1", "/w/shop", active = 9), live("l2", "/w/shop", active = 8, pending = 1))
        val groups = groupByRepo(l, ws)
        assertEquals(listOf("l1", "s1", "s2"), recentRows(groups, "").map { it.key })
        assertEquals(listOf("shop", "agentview", "agentview"), recentRows(groups, "").map { it.repo })
    }

    @Test
    fun chatStatesComeFromLiveAndSeenTimes() {
        assertEquals(ChatState.Needs, chatState(live("a", "/", pending = 1), null, emptyMap()))
        assertEquals(ChatState.Failed, chatState(LiveChat("a", failed = true), null, emptyMap()))
        assertEquals(ChatState.Running, chatState(live("a", "/", running = true), null, emptyMap()))
        assertNull(chatState(LiveChat("a", running = true, stalled = true), null, emptyMap()))
        assertEquals(ChatState.Done, chatState(null, saved("s", "/", at = 10), mapOf("s" to 5L)))
        assertNull(chatState(null, saved("s", "/", at = 10), mapOf("s" to 15L)))
        assertNull(chatState(null, saved("s", "/", at = 10), emptyMap()))
    }

    @Test
    fun glanceCountsStatesOfAClosedGroup() {
        val g = RepoGroup("k", "k").apply {
            open += live("a", "/", running = true)
            open += live("b", "/", pending = 1)
            recent += saved("s", "/", at = 10)
            last = 10
        }
        assertEquals(Glance(1, 1, 1), groupGlance(g, mapOf("s" to 1L)))
    }

    @Test
    fun sinceReadsLikeTheWeb() {
        val now = System.currentTimeMillis()
        assertEquals("just now", since(now - 10_000, now))
        assertEquals("5m ago", since(now - 5 * 60_000, now))
        assertEquals("3h ago", since(now - 3 * 3_600_000, now))
        assertEquals("2w ago", since(now - 15 * 86_400_000L, now))
    }

    @Test
    fun renameKeepsOnlyRealChanges() {
        assertEquals("New", renameTitle(" New ", "Old"))
        assertNull(renameTitle("Old", "Old"))
        assertNull(renameTitle("  ", "Old"))
    }

    @Test
    fun metaLineSkipsEmptyParts() {
        assertEquals("a · c", metaLine("a", null, "", "c"))
    }

    @Test
    fun statusFilterNarrowsRecentAndCounts() {
        val ws = Workspace(repos, trees, listOf(saved("s1", "/w/agentview", 50)), seen = mapOf("s1" to 10L))
        val groups = groupByRepo(listOf(live("r", "/w/agentview", running = true, active = 9), live("n", "/w/shop", pending = 1, active = 8)), ws)
        val bySession = ws.saved.associateBy { it.sessionId }
        fun ids(f: StatusFilter) = recentRows(groups, "", emptySet(), f, bySession, ws.seen).map { it.key }
        assertEquals(listOf("r"), ids(StatusFilter.Running))
        assertEquals(listOf("n"), ids(StatusFilter.Needs))
        assertEquals(listOf("s1"), ids(StatusFilter.Done))
        assertEquals(1, statusCount(groups, StatusFilter.Done, bySession, ws.seen))
    }

    @Test
    fun liveChatModelParsesAndShortens() {
        val c = protocolJson.decodeFromString<LiveChat>("""{"id":"a","model":"claude-opus-4-8"}""")
        assertEquals("Opus 4.8", shortModel(c.model!!))
    }
}
