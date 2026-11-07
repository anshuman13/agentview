package no.pradhan.agentview.nativeapp

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
    }

    @Test
    fun pinnedChatsLeaveTheirGroup() {
        val ws = Workspace(repos, trees, listOf(saved("s1", "/w/agentview")), pins = listOf("s1", "l1"))
        val l = listOf(live("l1", "/w/shop"))
        assertEquals(emptyList<RepoGroup>(), groupByRepo(l, ws))
        assertEquals(listOf("l1", "s1"), pinnedRows(l, ws, "").map { it.first?.id ?: it.second?.sessionId }.sortedBy { it != "l1" })
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
        assertEquals(Glance(1, 1, 1, 10), groupGlance(g, mapOf("s" to 1L)))
    }

    @Test
    fun sinceReadsLikeTheWeb() {
        val now = System.currentTimeMillis()
        assertEquals("just now", since(now - 10_000, now))
        assertEquals("5 min ago", since(now - 5 * 60_000, now))
        assertEquals("3 h ago", since(now - 3 * 3_600_000, now))
        assertEquals("2 w ago", since(now - 15 * 86_400_000L, now))
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
}
