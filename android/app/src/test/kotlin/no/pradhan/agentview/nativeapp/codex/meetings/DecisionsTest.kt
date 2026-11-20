package no.pradhan.agentview.nativeapp.codex.meetings

import java.io.File
import java.time.ZoneId
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.SYNCED_FIELDS
import no.pradhan.agentview.nativeapp.codex.WORK
import no.pradhan.agentview.nativeapp.codex.codexZone
import org.junit.Assert.assertEquals
import org.junit.Test

class DecisionsTest {
    @Test fun sharedCases() {
        codexZone = ZoneId.of("UTC")
        val c = Json.parseToJsonElement(File("../../shared/fixtures/decisions-markdown.json").readText()).jsonObject
        val meetings = c.getValue("meetings").jsonArray.map { it.jsonObject }.map { o ->
            val f = SYNCED_FIELDS.getValue("meetings").associateWith { JsonNull as JsonElement }.toMutableMap()
            for (k in listOf("title", "starts_at", "people")) f[k] = o.getValue(k)
            f["decisions"] = JsonPrimitive(o.getValue("decisions").toString())
            Row("meetings", o.getValue("id").jsonPrimitive.content, WORK, updatedAt = o.getValue("updated_at").jsonPrimitive.long, f = f)
        }
        val log = decisionLog(meetings)
        for (k in c.getValue("cases").jsonArray.map { it.jsonObject }) {
            assertEquals(k.getValue("name").jsonPrimitive.content, k.getValue("markdown").jsonPrimitive.content, decisionsMarkdown(decisionsWith(log, k.getValue("person").jsonPrimitive.content)))
        }
    }
}
