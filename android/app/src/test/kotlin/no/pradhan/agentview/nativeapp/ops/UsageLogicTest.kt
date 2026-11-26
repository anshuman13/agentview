package no.pradhan.agentview.nativeapp.ops

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Test

class UsageLogicTest {
    private val fixture = Json.parseToJsonElement(File("../../shared/fixtures/usage.json").readText()).jsonObject

    @Test fun sharedFixture() {
        val now = fixture.getValue("now").jsonPrimitive.long
        val report = parseUsage(fixture.getValue("report").toString())
        val expected = fixture.getValue("expected").jsonArray.map { it.jsonObject }
        assertEquals(expected.map { it.getValue("account").jsonPrimitive.content }, report.accounts.map { it.account })
        for ((a, e) in report.accounts.zip(expected)) {
            val limits = e.getValue("limits").jsonArray.map { it.jsonObject.let { o -> LimitRow(o.str("label"), o.getValue("pct").jsonPrimitive.int, o.str("text")) } }
            assertEquals(a.account, limits, limitRows(a.latest, now))

            val lines = e.getValue("lines").jsonObject
            fun pts(k: String) = lines.getValue(k).jsonArray.map { it.jsonObject.let { o -> UsagePt(o.getValue("x").jsonPrimitive.double, o.getValue("y").jsonPrimitive.double) } }
            assertEquals(a.account, UsageLines(pts("fiveHour"), pts("week")), seriesLines(a.series, now))

            val bars = e.getValue("bars").jsonArray.map {
                it.jsonObject.let { o -> DayBar(o.str("day"), o.str("label"), o.getValue("total").jsonPrimitive.long, o.getValue("parts").jsonArray.map { p -> p.jsonPrimitive.double }) }
            }
            assertEquals(a.account, bars, dayBars(a.days))

            val totals = e.getValue("totals").jsonObject
            assertEquals(a.account, TOKEN_KINDS.associateWith { totals.str(it) }, tokenTotals(a.days).mapValues { tokens(it.value) })
        }
    }

    @Test fun resetTextShort() {
        assertEquals("resets in 5m", resetText(5 * 60_000L, 0))
        assertEquals("resets in 0m", resetText(0, 60_000))
        assertEquals("", resetText(null, 0))
    }

    private fun JsonObject.str(k: String) = getValue(k).jsonPrimitive.content
}
