package no.pradhan.agentview.nativeapp.codex.wiki

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.WORK
import org.junit.Assert.assertEquals
import org.junit.Test

class ClaimMentionsTest {
    private fun rows(table: String, list: List<JsonObject>, status: Boolean) = list.map { o ->
        val f = o.filterKeys { it !in setOf("id", "profile", "deleted") }.toMutableMap()
        if (status && "status" !in f) f["status"] = JsonPrimitive("open")
        Row(table, o.getValue("id").jsonPrimitive.content, o["profile"]?.jsonPrimitive?.content ?: WORK, deleted = o["deleted"]?.jsonPrimitive?.boolean == true, f = f)
    }

    @Test fun sharedCases() {
        val cases = Json.parseToJsonElement(File("../../shared/fixtures/claim-mentions.json").readText()).jsonArray.map { it.jsonObject }
        for (c in cases) {
            val items = rows("items", c.getValue("items").jsonArray.map { it.jsonObject }, true)
            val meetings = rows("meetings", c.getValue("meetings").jsonArray.map { it.jsonObject }, false)
            val claim = Row("facts", "c", WORK, f = mapOf("text" to c.getValue("claim")))
            val expected = c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }
            assertEquals(c.getValue("name").jsonPrimitive.content, expected, mentionsOf(mentionables(items, meetings), claim, c.getValue("title").jsonPrimitive.content).map { it.id })
        }
    }
}
