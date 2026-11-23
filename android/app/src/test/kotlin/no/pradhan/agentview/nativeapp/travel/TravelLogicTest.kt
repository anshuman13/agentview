package no.pradhan.agentview.nativeapp.travel

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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

    @Test fun parsesTheServerReply() {
        val d = parseTravel("""{"trips":[{"id":"a","name":"Oslo","from":"2026-11-24","to":"2026-11-26","notes":"","createdAt":1}],"receipts":[{"id":"r","tripId":"a","amount":null,"read":"pending","extra":1}]}""")
        assertEquals("Oslo", d.trips.single().name)
        assertEquals("Reading…", receiptMeta(d.receipts.single()))
    }
}
