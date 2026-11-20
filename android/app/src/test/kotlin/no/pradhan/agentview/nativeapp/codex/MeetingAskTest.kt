package no.pradhan.agentview.nativeapp.codex

import java.io.File
import java.time.ZoneId
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class MeetingAskTest {
    @Test fun sharedCases() {
        codexZone = ZoneId.of("UTC")
        for (c in Json.parseToJsonElement(File("../../shared/fixtures/meeting-ask-text.json").readText()).jsonArray.map { it.jsonObject }) {
            val m = Row("meetings", "m", WORK, f = c.getValue("meeting").jsonObject)
            val actions = c.getValue("actions").jsonArray.map { Row("items", "i", WORK, f = it.jsonObject) }
            val name = c.getValue("name").jsonPrimitive.content
            assertEquals(name, c.getValue("expected").jsonPrimitive.content, meetingAskText(c.getValue("question").jsonPrimitive.content, m, actions))
        }
    }
}
