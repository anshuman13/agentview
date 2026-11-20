package no.pradhan.agentview.nativeapp.codex

import java.io.File
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class TaskLogTest {
    @Before fun zone() { codexZone = ZoneId.of("UTC") }

    private fun t(month: Int, day: Int, h: Int, m: Int = 0) = ZonedDateTime.of(2026, month, day, h, m, 0, 0, codexZone).toInstant().toEpochMilli()
    private fun row(times: Map<String, Long>, vararg f: Pair<String, Any>) = Row("items", "a", WORK, times = times, f = f.associate { (k, v) -> k to toJson(v) })

    @Test fun sharedCases() {
        for (c in Json.parseToJsonElement(File("../../shared/fixtures/time-log.json").readText()).jsonArray.map { it.jsonObject }) {
            val name = c.getValue("name").jsonPrimitive.content
            val log = c.getValue("log").jsonPrimitive.contentOrNull
            val sessions = c.getValue("sessions").jsonArray.map { it.jsonObject.let { s -> Triple(s.str("id"), s.num("at"), s.num("min")) } }
            assertEquals(name, sessions, parseLog(log).map { Triple(it.id, it.at, it.min) })
            val id = c["remove"]?.jsonPrimitive?.content ?: continue
            val expected = c.getValue("expected").jsonObject
            val patch = removeSession(log, c.getValue("spent").jsonPrimitive.longOrNull, id)
            assertEquals(name, expected.getValue("time_log").jsonPrimitive.contentOrNull, patch["time_log"])
            assertEquals(name, expected.getValue("spent").jsonPrimitive.longOrNull, patch["spent"])
        }
    }

    private fun JsonObject.str(k: String) = getValue(k).jsonPrimitive.content
    private fun JsonObject.num(k: String) = getValue(k).jsonPrimitive.longOrNull

    @Test fun historyNewestFirst() {
        val h = historyOf(row(mapOf("status" to 10L, "at" to 30L, "assignee" to 20L, "title" to 40L), "status" to "done", "assignee" to "Sam"))
        assertEquals(listOf("at", "assignee", "status"), h.map { it.field })
        assertEquals(listOf("Due date cleared", "Assigned to Sam", "Status: Done"), h.map { it.title })
    }

    @Test fun historyUnassignedAndUnknownStatus() {
        assertEquals(listOf("Unassigned", "Status: Parked"), historyOf(row(mapOf("assignee" to 5L, "status" to 4L), "status" to "parked")).map { it.title })
    }

    @Test fun historyDueWithClock() {
        assertEquals(listOf("Due: Fri, 6 Nov 14:20"), historyOf(row(mapOf("at" to 1L), "at" to t(11, 6, 14, 20))).map { it.title })
        assertEquals(listOf("Due: Fri, 6 Nov"), historyOf(row(mapOf("at" to 1L), "at" to t(11, 6, 0))).map { it.title })
    }

    @Test fun historyIgnoresZeroAndNegativeTimes() {
        assertEquals(emptyList<HistoryEntry>(), historyOf(row(mapOf("status" to 0L, "at" to -5L))))
        assertEquals(emptyList<HistoryEntry>(), historyOf(row(emptyMap())))
    }

    @Test fun historyTimeByAge() {
        val now = t(11, 6, 15)
        assertEquals("14:20", historyTime(t(11, 6, 14, 20), now))
        assertEquals("Tue", historyTime(t(11, 3, 9), now))
        assertEquals("20 Oct", historyTime(t(10, 20, 9), now))
    }
}
