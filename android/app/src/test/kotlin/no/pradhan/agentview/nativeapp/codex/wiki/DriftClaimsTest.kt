package no.pradhan.agentview.nativeapp.codex.wiki

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import no.pradhan.agentview.nativeapp.codex.DAY_MS
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.SYNCED_FIELDS
import no.pradhan.agentview.nativeapp.codex.WORK
import org.junit.Assert.assertEquals
import org.junit.Test

class DriftClaimsTest {
    @Test fun sharedCases() {
        val c = Json.parseToJsonElement(File("../../shared/fixtures/drift-claims.json").readText()).jsonObject
        val now = c.getValue("now").jsonPrimitive.long
        fun rows(table: String, fill: (JsonObject, MutableMap<String, JsonElement>) -> Unit) = c.getValue(table).jsonArray.map { it.jsonObject }.map { o ->
            val f = SYNCED_FIELDS.getValue(table).associateWith { JsonNull as JsonElement }.toMutableMap()
            fill(o, f)
            o["agoDays"]?.let { f[if (table == "meetings") "starts_at" else "at"] = JsonPrimitive(now - it.jsonPrimitive.long * DAY_MS) }
            Row(table, o.getValue("id").jsonPrimitive.content, WORK, f = f)
        }
        val pages = rows("pages") { o, f -> f["title"] = o.getValue("title") }
        val meetings = rows("meetings") { o, f -> f["title"] = o.getValue("title"); f["decisions"] = JsonPrimitive(o.getValue("decisions").toString()) }
        val facts = rows("facts") { o, f -> for (k in listOf("page_id", "text", "state", "replaces")) o[k]?.let { f[k] = it } }
        val expected = c.getValue("expected").jsonArray.map { e -> e.jsonArray.map { it.jsonPrimitive.content } }
        assertEquals(expected, driftFacts(facts, pages, meetings, now).map { listOf(it.fact.id, it.decision.text) })
    }
}
