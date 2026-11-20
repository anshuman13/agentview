package no.pradhan.agentview.nativeapp.codex

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Test

fun fixtureRow(table: String, e: JsonElement): Row {
    val o = e.jsonObject
    return Row(table, o.getValue("id").jsonPrimitive.content, o["profile"]?.jsonPrimitive?.content ?: WORK, updatedAt = o["updated_at"]?.jsonPrimitive?.long ?: 0, deleted = o["deleted"]?.jsonPrimitive?.int == 1, f = o)
}

class TaskRelatedTest {
    @Test fun sharedCases() {
        for (c in Json.parseToJsonElement(File("../../shared/fixtures/related-to-task.json").readText()).jsonArray.map { it.jsonObject }) {
            val items = c.getValue("items").jsonArray.map { fixtureRow("items", it) }
            val meetings = c.getValue("meetings").jsonArray.map { fixtureRow("meetings", it) }
            val got = relatedToTask(items, meetings, fixtureRow("items", c.getValue("task")), c.getValue("now").jsonPrimitive.long).map { it.id }
            assertEquals(c.getValue("name").jsonPrimitive.content, c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, got)
        }
    }
}
