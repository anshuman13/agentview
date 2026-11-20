package no.pradhan.agentview.nativeapp.chat

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.protocolJson
import org.junit.Assert.assertEquals
import org.junit.Test

// The cases in shared/fixtures/chat-images.json also run in web/src/sharedCases.test.ts.
class ChatImagesTest {
    @Test fun listsImagesNewestFirstOnce() {
        for (c in Json.parseToJsonElement(File("../../shared/fixtures/chat-images.json").readText()).jsonArray.map { it.jsonObject }) {
            val events = c.getValue("events").jsonArray.map { protocolJson.decodeFromJsonElement<ChatEvent>(it) }
            val expected = c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }
            assertEquals(c.getValue("name").jsonPrimitive.content, expected, chatImages(events))
        }
    }
}
