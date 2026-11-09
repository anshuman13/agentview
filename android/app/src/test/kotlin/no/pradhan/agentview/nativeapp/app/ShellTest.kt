package no.pradhan.agentview.nativeapp.app

import no.pradhan.agentview.nativeapp.chat.Item
import no.pradhan.agentview.nativeapp.codex.meetings.Pending
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.OfflineEvent
import no.pradhan.agentview.nativeapp.net.OfflineState
import no.pradhan.agentview.nativeapp.net.Pending
import no.pradhan.agentview.nativeapp.net.offlineBanner
import no.pradhan.agentview.nativeapp.ops.Agent
import no.pradhan.agentview.nativeapp.ops.agentBadge
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ShellTest {
    @Test fun offlineBannerWaitsBeforeShowing() {
        assertEquals(OfflineState.Pending, offlineBanner(OfflineState.Hidden, OfflineEvent.Down))
        assertEquals(OfflineState.Shown, offlineBanner(OfflineState.Pending, OfflineEvent.Elapsed))
        assertEquals(OfflineState.Hidden, offlineBanner(OfflineState.Hidden, OfflineEvent.Elapsed))
        assertEquals(OfflineState.Shown, offlineBanner(OfflineState.Shown, OfflineEvent.Down))
        assertEquals(OfflineState.Hidden, offlineBanner(OfflineState.Shown, OfflineEvent.Up))
        assertEquals(OfflineState.Hidden, offlineBanner(OfflineState.Pending, OfflineEvent.Up))
    }

    @Test fun parsesDeepLinks() {
        assertEquals(DeepLink(view = "github"), parseDeepLink("agentview://open?view=github"))
        assertEquals(DeepLink(chat = "a b"), parseDeepLink("agentview://open?chat=a%20b&beside=x"))
        assertEquals(DeepLink(session = "s1", page = "observe"), parseDeepLink("http://h:7777/?session=s1&page=observe"))
        assertNull(parseDeepLink("agentview://open?page=nope"))
        assertNull(parseDeepLink("agentview://open"))
        assertNull(parseDeepLink(null))
    }

    @Test fun routesDeepLinks() {
        assertEquals("chat", routeFor(DeepLink(chat = "c")))
        assertEquals("more/mcp", routeFor(DeepLink(page = "mcp")))
        assertEquals("sessions", routeFor(DeepLink(view = "chats")))
        assertEquals("more/github", routeFor(DeepLink(view = "github")))
        assertEquals("chat", routeFor(DeepLink(view = "agents")))
        assertNull(routeFor(DeepLink(view = "zzz")))
    }

    @Test fun agentBadgeCountsRunningElseTotal() {
        val use = ChatEvent(id = "u", kind = "tool_use")
        fun agent(status: String) = Agent("a", Item.Agent("a", use, null, false, emptyList()), null, "", "", null, "", status, 0, null, "", 0)
        val five = listOf("running", "running", "done", "done", "failed").map(::agent)
        assertEquals(2 to true, agentBadge(five))
        assertEquals(5 to false, agentBadge(five.map { it.copy(status = "done") }))
    }
}
