package no.pradhan.agentview.nativeapp.travel

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import org.junit.Assert.assertEquals
import org.junit.Test

class TravelLogicTest {
    private val fx = Json.parseToJsonElement(File("../../shared/fixtures/travel.json").readText()).jsonObject
    private fun str(o: Any?) = (o as kotlinx.serialization.json.JsonElement).jsonPrimitive.content

    @Test fun totalsMatchTheSharedCases() {
        fx["totals"]!!.jsonArray.forEach { c ->
            val o = c.jsonObject
            val receipts = o["receipts"]!!.jsonArray.mapIndexed { i, r ->
                val ro = r.jsonObject
                Receipt("$i", "t", amount = ro["amount"]!!.jsonPrimitive.doubleOrNull, currency = str(ro["currency"]))
            }
            assertEquals(str(o["name"]), str(o["expected"]), totalsText(receipts))
        }
    }

    @Test fun tripsSortLikeWeb() {
        fx["sortTrips"]!!.jsonArray.forEach { c ->
            val o = c.jsonObject
            val trips = o["trips"]!!.jsonArray.map { t -> val to = t.jsonObject; Trip(str(to["id"]), "", str(to["from"]), str(to["to"])) }
            assertEquals(o["expected"]!!.jsonArray.map { str(it) }, sortTrips(trips, str(o["today"])).map { it.id })
        }
    }

    private fun field(o: kotlinx.serialization.json.JsonObject, k: String) = o[k]?.jsonPrimitive?.content ?: ""
    private fun trip(e: JsonElement) = e.jsonObject.let { Trip(field(it, "id"), "", field(it, "from"), field(it, "to")) }
    private fun item(e: JsonElement) = e.jsonObject.let { PlanItem(field(it, "id"), field(it, "day"), field(it, "start"), field(it, "end"), title = "") }

    @Test fun tripStateMatchesTheSharedCases() {
        fx["tripState"]!!.jsonArray.forEach { c ->
            val o = c.jsonObject
            val t = trip(o["trip"]!!)
            assertEquals(str(o["name"]), str(o["state"]), tripState(t, str(o["today"])))
            assertEquals(str(o["name"]), str(o["text"]), tripStateText(t, str(o["today"])))
        }
    }

    @Test fun planHelpersMatchTheSharedCases() {
        fx["groupPlan"]!!.jsonArray.forEach { c ->
            val o = c.jsonObject
            val got = groupPlan(o["plan"]!!.jsonArray.map(::item)).map { g -> g.day + ":" + g.items.joinToString(",") { it.id } }
            val want = o["expected"]!!.jsonArray.map { e -> str(e.jsonObject["day"]) + ":" + e.jsonObject["ids"]!!.jsonArray.joinToString(",") { str(it) } }
            assertEquals(str(o["name"]), want, got)
        }
        fx["nextItem"]!!.jsonArray.forEach { c ->
            val o = c.jsonObject
            val want = o["expected"]!!.let { if (it is JsonNull) null else str(it) }
            assertEquals(str(o["name"]), want, nextItem(o["plan"]!!.jsonArray.map(::item), str(o["now"]))?.id)
        }
        fx["kindIcons"]!!.jsonObject.forEach { (k, v) -> assertEquals(k, str(v), KIND_ICONS[k]) }
        assertEquals(PLAN_KINDS.toSet(), KIND_ICONS.keys)
    }

    @Test fun receiptsFileLikeTheServer() {
        fx["fileTrip"]!!.jsonArray.forEach { c ->
            val o = c.jsonObject
            val trips = o["trips"]!!.jsonArray.map(::trip)
            val want = o["expected"]!!.let { if (it is JsonNull) null else str(it) }
            assertEquals(str(o["name"]), want, fileTrip(trips, str(o["date"]), str(o["today"]))?.id)
        }
    }

    @Test fun parsesTheServerReply() {
        val d = parseTravel("""{"trips":[{"id":"a","name":"Oslo","from":"2026-11-24","to":"2026-11-26","notes":"","createdAt":1}],"receipts":[{"id":"r","tripId":"a","amount":null,"read":"pending","extra":1}]}""")
        assertEquals("Oslo", d.trips.single().name)
        assertEquals("Reading…", receiptMeta(d.receipts.single()))
    }
}
