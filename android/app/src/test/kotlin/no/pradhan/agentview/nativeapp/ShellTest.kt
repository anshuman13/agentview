package no.pradhan.agentview.nativeapp

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
        assertNull(routeFor(DeepLink(view = "zzz")))
    }
}
