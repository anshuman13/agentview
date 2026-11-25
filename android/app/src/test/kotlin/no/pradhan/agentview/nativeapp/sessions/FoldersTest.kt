package no.pradhan.agentview.nativeapp.sessions

import no.pradhan.agentview.nativeapp.chat.RepoChoice
import no.pradhan.agentview.nativeapp.chat.shortModel
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.protocolJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
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
    fun restoredChatGoesFirstAndKeepsItsPin() {
        val ws = Workspace(repos, trees, listOf(saved("s1", "/w/shop")), listOf("s1"))
        val back = withRestored(ws, saved("s2", "/w/agentview"), true)
        assertEquals(listOf("s2", "s1"), back.saved.map { it.sessionId })
        assertEquals(listOf("s1", "s2"), back.pins)
        assertEquals(listOf("s1"), withRestored(ws, saved("s1", "/w/shop"), false).saved.map { it.sessionId })
        assertEquals(listOf("s1"), withRestored(ws, saved("s2", "/w/agentview"), false).pins)
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
    fun repoDetailNamesRootAndBranch() {
        assertEquals("workspace · main", repoDetail(Repo("shop", "/w/shop", "workspace", branch = "main")))
        assertEquals("workspace · empty", repoDetail(Repo("shop", "/w/shop", "workspace", kind = "new", branch = "main")))
        assertEquals("workspace · no git", repoDetail(Repo("shop", "/w/shop", "workspace")))
    }

    @Test
    fun waitingRowsFollowTheSearch() {
        val ws = Workspace(repos, trees)
        val l = listOf(live("a", "/w/shop", pending = 1, active = 1), live("b", "/w/agentview", pending = 1, active = 2), live("c", "/w/shop"))
        assertEquals(listOf("b", "a"), waitingRows(l, ws, "").map { it.id })
        assertEquals(listOf("a"), waitingRows(l, ws, "shop").map { it.id })
        assertEquals(emptyList<String>(), waitingRows(l, ws, "nothing").map { it.id })
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
    fun heldOrderKeepsRowsInPlaceAndShowsNewChatsFirst() {
        val ws = Workspace(repos, trees)
        val held = holdOrder(groupByRepo(listOf(live("a", "/w/shop", active = 2, running = true), live("b", "/w/shop", active = 1, running = true)), ws))
        val l = listOf(live("a", "/w/shop", active = 3, running = true), live("b", "/w/shop", active = 9, running = true), live("n", "/w/shop", active = 0))
        val groups = groupByRepo(l, ws, held = held)
        assertEquals(listOf("n", "a", "b"), groups.first { it.name == "shop" }.open.map { it.id })
        assertEquals(listOf("n", "a", "b"), recentRows(groups, "", held = held).map { it.key })
    }

    @Test
    fun doneChatsListLiveAndSavedChatsNewerThanTheirSeenTime() {
        val seen = mapOf("a" to 0L, "b" to 0L, "c" to 0L, "e" to 5L, "f" to 50L)
        val lives = listOf(live("a", "/w", active = 10), live("b", "/w", active = 10, running = true), live("c", "/w", active = 10, pending = 1))
        assertEquals(listOf("a", "e"), doneChats(lives, listOf(saved("e", "/w", at = 10), saved("f", "/w", at = 10), saved("g", "/w", at = 10)), seen, emptyMap()))
    }

    @Test
    fun subChatsFoldIntoTheirRootRowEverywhere() {
        val sub = SavedSession("k2", "task", "/w/agentview", null, 30, parentId = "k1", via = "build")
        val ws = Workspace(repos, trees, groupChats(listOf(saved("k1", "/w/agentview", 10, "build chat"), sub)), listOf("k2"))
        assertEquals(listOf("k1"), ws.saved.map { it.sessionId })
        assertEquals("1 task", ws.saved[0].subs)
        assertEquals(30L, ws.saved[0].lastModified)
        val open = live("c", "/w/agentview", sid = "k2", active = 40, pending = 1)
        val groups = groupByRepo(listOf(open), ws)
        assertEquals(listOf("c"), groups[0].open.map { it.id })
        assertEquals(listOf("c"), groupByRepo(listOf(live("old", "/w/agentview", sid = "k1", active = 50), open), ws)[0].open.map { it.id })
        assertEquals(emptyList<String>(), groups[0].recent.map { it.sessionId })
        assertEquals(listOf("k1"), rowPins(ws))
        assertEquals("c", pinnedRows(listOf(open), ws, "").single().live?.id)
        assertEquals(setOf("k1", "k2"), mutedIds(setOf("k1"), ws.saved))
        val row = ws.saved[0]
        assertEquals(ChatState.Done, chatState(null, row, mapOf("k2" to 5L)))
        assertNull(chatState(null, row, mapOf("k1" to 5L, "k2" to 35L)))
        assertEquals(ChatState.Done, chatState(null, row, mapOf("k1" to 0L, "k2" to 35L)))
        assertEquals(listOf("k1"), doneChats(listOf(open.copy(pending = 0)), emptyList(), mapOf("k1" to 0L), rowsById(ws.saved)))
    }

    @Test
    fun doneChatsCountsALiveChatByItsSavedCopy() {
        val quiet = live("h", "/w", active = 1)
        val copy = saved("h", "/w", at = 10)
        assertEquals(emptyList<String>(), doneChats(listOf(quiet), emptyList(), mapOf("h" to 5L), emptyMap()))
        assertEquals(listOf("h"), doneChats(listOf(quiet), emptyList(), mapOf("h" to 5L), mapOf("h" to copy)))
    }

    @Test
    fun extendHoldsNewGroupsAndRowsOnceAndKeepsTheInstanceWhenNothingIsNew() {
        val ws = Workspace(repos, trees)
        val held = holdOrder(groupByRepo(listOf(live("a", "/w/shop", active = 2, running = true)), ws))
        val l = listOf(live("a", "/w/shop", active = 2, running = true), live("n", "/w/shop", active = 0))
        val added = held.extend(groupByRepo(l, ws))
        assertEquals(listOf("n", "a"), added.rows)
        assertEquals(listOf("n", "a"), added.recent)
        assertSame(added, added.extend(groupByRepo(l, ws)))
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

    @Test
    fun shownChoicesFoldsAfterFiveAndKeepsThePicked() {
        val twelve = (1..12).map { RepoChoice("k$it", "r$it") }
        assertEquals(twelve.take(3), shownChoices(twelve.take(3), null, false))
        assertEquals(twelve.take(5), shownChoices(twelve.take(5), null, false))
        assertEquals(twelve.take(5), shownChoices(twelve, "k1", false))
        assertEquals(twelve.take(5) + twelve[8], shownChoices(twelve, "k9", false))
        assertEquals(twelve, shownChoices(twelve, null, true))
    }
}
