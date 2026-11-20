package no.pradhan.agentview.nativeapp.codex.wiki

import no.pradhan.agentview.nativeapp.app.claimRoute
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.WORK
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WikiAnchorTest {
    private fun fact(id: String, page: String? = "p") = Row("facts", id, WORK, f = if (page == null) emptyMap() else mapOf("page_id" to JsonPrimitive(page)))

    private val groups = listOf(
        ClaimGroup("A", listOf(Claim(fact("a1"), emptyList()), Claim(fact("a2"), emptyList()))),
        ClaimGroup("B", listOf(Claim(fact("b1"), emptyList()))),
    )
    private val older = listOf(fact("o1"), fact("o2"))

    @Test fun mainList() {
        assertEquals(2, claimItemIndex(groups, older, false, "a1")?.index)
        assertEquals(3, claimItemIndex(groups, older, false, "a2")?.index)
        assertEquals(5, claimItemIndex(groups, older, false, "b1")?.index)
        assertFalse(claimItemIndex(groups, older, false, "b1")!!.openOlder)
    }

    @Test fun olderOpensOnlyWhenFolded() {
        val folded = claimItemIndex(groups, older, false, "o2")!!
        assertEquals(8, folded.index)
        assertTrue(folded.openOlder)
        assertFalse(claimItemIndex(groups, older, true, "o2")!!.openOlder)
    }

    @Test fun memoryPageHasNoGroupsAbove() {
        assertEquals(3, claimItemIndex(emptyList(), older, false, "o2")?.index)
    }

    @Test fun missingId() {
        assertNull(claimItemIndex(groups, older, true, "zz"))
    }

    @Test fun routeCarriesClaimId() {
        assertEquals("wiki:work:p#a1", claimRoute(fact("a1")))
        assertEquals("wiki:memory#a1", claimRoute(fact("a1", null)))
    }
}
