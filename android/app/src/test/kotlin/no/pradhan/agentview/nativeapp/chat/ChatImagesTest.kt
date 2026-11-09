package no.pradhan.agentview.nativeapp.chat

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.net.ChatEvent
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatImagesTest {
    private fun tool(id: String, name: String, path: String) = ChatEvent(id, "tool_use", name = name, input = buildJsonObject { put("file_path", JsonPrimitive(path)) })

    @Test fun listsImagesNewestFirstOnce() {
        val events = listOf(
            ChatEvent("u", "user", text = "look [Image: /tmp/paste.png]"),
            tool("a", "Read", "/tmp/shot.png"),
            tool("b", "Read", "src/main.kt"),
            tool("c", "Write", "docs/chart.svg"),
            tool("d", "Bash", "/tmp/x.png"),
            tool("e", "Read", "/tmp/shot.png"),
        )
        assertEquals(listOf("/tmp/shot.png", "docs/chart.svg", "/tmp/paste.png"), chatImages(events))
    }
}
