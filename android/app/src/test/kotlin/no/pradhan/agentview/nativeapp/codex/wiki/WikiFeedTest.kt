package no.pradhan.agentview.nativeapp.codex.wiki

import kotlinx.serialization.json.JsonPrimitive
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.WORK
import org.junit.Assert.assertEquals
import org.junit.Test

class WikiFeedTest {
    private fun fact(id: String, at: Long, vararg fields: Pair<String, String>) =
        Row("facts", id, WORK, f = (mapOf("at" to JsonPrimitive(at)) + fields.associate { (k, v) -> k to JsonPrimitive(v) }))

    @Test fun feedKindsAndOrder() {
        val facts = listOf(
            fact("added", 100),
            fact("old", 50, "superseded_by" to "new"),
            fact("new", 300),
            fact("disputed", 200, "contested" to """{"by":"you","at":250,"note":""}"""),
            fact("retired", 400, "state" to "retired"),
            fact("proposed", 500, "state" to "proposed"),
        )
        val feed = wikiFeed(facts)
        assertEquals(listOf("new", "disputed", "added"), feed.map { it.fact.id })
        assertEquals(listOf(FeedKind.Updated, FeedKind.Contested, FeedKind.Added), feed.map { it.kind })
        assertEquals(250L, feed[1].at)
    }

    @Test fun pageProposalsByPage() {
        val facts = listOf(
            fact("a", 1, "state" to "proposed", "page_id" to "p"),
            fact("b", 2, "state" to "proposed", "page_id" to "q"),
            fact("c", 3, "state" to "proposed"),
            fact("d", 4, "page_id" to "p"),
        )
        assertEquals(listOf("a"), pageProposals(facts, "p").map { it.id })
        assertEquals(listOf("c"), pageProposals(facts, null).map { it.id })
    }
}
