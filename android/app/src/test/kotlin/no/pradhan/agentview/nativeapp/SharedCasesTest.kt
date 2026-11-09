package no.pradhan.agentview.nativeapp

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Test

// The cases in shared/fixtures also run in shared/cases.test.ts, so a case added there is checked against both implementations.
class SharedCasesTest {
    private fun cases(file: String): List<JsonObject> =
        Json.parseToJsonElement(File("../../shared/fixtures/$file.json").readText()).jsonArray.map { it.jsonObject }

    private fun JsonObject.str(k: String) = getValue(k).jsonPrimitive.content

    private fun meetingRow(m: JsonObject, now: Long): Row {
        val f = SYNCED_FIELDS.getValue("meetings").associateWith { JsonNull as JsonElement }.toMutableMap()
        f["title"] = toJson(m.str("title"))
        f["starts_at"] = toJson(now + m.getValue("startsInHours").jsonPrimitive.long * 3_600_000)
        return Row("meetings", m.str("title"), m.str("profile"), deleted = m["deleted"]?.jsonPrimitive?.booleanOrNull == true, f = f)
    }

    @Test fun guessProfile() {
        val now = 1_800_000_000_000
        for (c in cases("guess-profile")) {
            val meetings = c.getValue("meetings").jsonArray.map { meetingRow(it.jsonObject, now) }
            assertEquals(c.str("name"), c.str("expected"), guessProfile(c.str("question"), meetings, c.str("fallback"), now))
        }
    }

    @Test fun editCount() {
        for (c in cases("edit-count")) {
            val expected = c["expected"]?.takeIf { it !is JsonNull }?.jsonObject?.let { it.getValue("add").jsonPrimitive.long.toInt() to it.getValue("del").jsonPrimitive.long.toInt() }
            assertEquals(c.str("name"), expected, editCount(c.str("tool"), c.getValue("input").jsonObject))
        }
    }

    @Test fun stripRound() {
        for (c in cases("strip-round")) assertEquals(c.str("name"), c.str("expected"), stripRound(c.str("text")))
    }

    @Test fun ago() {
        val now = 1_800_000_000_000
        for (c in cases("ago")) assertEquals(c.str("name"), c.str("expected"), agoShort(now - c.getValue("ageMs").jsonPrimitive.long, now, c.str("suffix")))
    }

    @Test fun checklist() {
        for (c in cases("checklist")) {
            val items = c.getValue("items").jsonArray.map { ChecklistItem(it.jsonObject.str("content"), it.jsonObject.str("activeForm"), it.jsonObject.str("status")) }
            assertEquals(c.str("name"), c.str("progress"), checklistProgress(items))
            assertEquals(c.str("name"), c.str("current"), checklistCurrent(items))
        }
    }
}
