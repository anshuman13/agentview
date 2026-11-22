package no.pradhan.agentview.nativeapp.codex.meetings

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import no.pradhan.agentview.nativeapp.codex.Row
import org.junit.Assert.assertEquals
import org.junit.Test

// The cases in shared/fixtures/summary-template.json also run in web/src/sharedCases.test.ts.
class SummaryFormatTest {
    private val fixture = Json.parseToJsonElement(File("../../shared/fixtures/summary-template.json").readText()).jsonObject

    private fun JsonObject.str(k: String) = getValue(k).jsonPrimitive.content

    private fun meeting(title: JsonPrimitive?, people: JsonPrimitive?) = Row("meetings", "cal:1", "work", f = mapOf("title" to (title ?: JsonNull), "people" to (people ?: JsonNull)))

    @Test fun templates() {
        val texts = fixture.getValue("templates").jsonArray.map { it.jsonObject.let { t -> listOf(t.str("key"), t.str("label"), t.str("instructions")) } }
        assertEquals(texts, SUMMARY_TEMPLATES.map { (k, t) -> listOf(k, t.label, t.instructions) })
    }

    @Test fun suggestions() {
        for (c in fixture.getValue("cases").jsonArray.map { it.jsonObject }) {
            val title = c["title"] as? JsonPrimitive
            val m = meeting(title, c["people"] as? JsonPrimitive)
            val series = (c["series"] as? JsonPrimitive)?.let { listOf(meeting(title, it)) } ?: emptyList()
            val picks = c.getValue("picks").jsonObject.mapValues { it.value.jsonPrimitive.content }
            assertEquals(c.str("name"), c.str("expected"), templateFor(m, series, picks))
        }
    }
}
