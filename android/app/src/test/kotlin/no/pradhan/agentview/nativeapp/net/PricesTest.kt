package no.pradhan.agentview.nativeapp.net

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

class PricesTest {
    private val fx = Json.parseToJsonElement(File("../../shared/fixtures/prices.json").readText()).jsonObject

    @Test fun priceTableMatchesTheFixture() {
        val prices = fx.getValue("prices").jsonObject.mapValues { Json.decodeFromJsonElement<Price>(it.value) }
        assertEquals(prices, PRICES)
    }

    @Test fun costCases() {
        for (c in fx.getValue("cases").jsonArray.map { it.jsonObject }) {
            val name = c.getValue("name").jsonPrimitive.content
            val got = costOf(Json.decodeFromJsonElement<TurnTokens>(c.getValue("tokens")))
            val expected = c.getValue("expected")
            if (expected is JsonNull) assertNull(name, got) else assertEquals(name, expected.jsonPrimitive.double, got!!, 1e-9)
        }
    }
}
