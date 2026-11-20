package no.pradhan.agentview.nativeapp.codex.meetings

import java.io.File
import java.time.ZoneId
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import no.pradhan.agentview.nativeapp.codex.codexZone
import no.pradhan.agentview.nativeapp.codex.fixtureRow
import org.junit.Assert.assertEquals
import org.junit.Test

class SeriesValueTest {
    @Test fun sharedCases() {
        val zone = codexZone
        try { cases() } finally { codexZone = zone }
    }

    private fun cases() {
        for (c in Json.parseToJsonElement(File("../../shared/fixtures/series-audit.json").readText()).jsonArray.map { it.jsonObject }) {
            codexZone = ZoneId.of(c.getValue("zone").jsonPrimitive.content)
            val meetings = c.getValue("meetings").jsonArray.map { fixtureRow("meetings", it) }
            val items = c.getValue("items").jsonArray.map { fixtureRow("items", it) }
            val got = seriesAudit(meetings, items, c.getValue("now").jsonPrimitive.long).map { listOf(it.title, it.quiet, it.count, it.hours, it.recentHours, it.decisions, it.actions, it.latest.id).joinToString() }
            val want = c.getValue("expected").jsonArray.map { e ->
                val o = e.jsonObject
                listOf("title", "quiet", "count", "hours", "recentHours", "decisions", "actions", "latest").joinToString { k ->
                    val p = o.getValue(k).jsonPrimitive
                    if (k == "hours" || k == "recentHours") p.content.toDouble().toString() else p.content
                }
            }
            assertEquals(c.getValue("name").jsonPrimitive.content, want, got)
        }
    }
}
