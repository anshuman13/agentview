package no.pradhan.agentview.nativeapp

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

val protocolJson = Json { ignoreUnknownKeys = true; isLenient = true }

// shared/protocol.ts ChatEvent: one flat class covering the kinds this client reads (user, assistant, tool_use, agent, result, system).
// Fields not present on a kind keep their defaults. For tool_use, `summary` is the one-line description; for agent it is `description`.
@Serializable
data class ChatEvent(
    val id: String,
    val kind: String,
    val text: String = "",
    val streaming: Boolean = false,
    val name: String = "",
    val summary: String = "",
    val description: String = "",
    val isError: Boolean = false,
    val queued: Boolean = false,
    val at: Long = 0,
)

// shared/protocol.ts LiveChat, the entries of the 'live' message.
@Serializable
data class LiveChat(
    val id: String,
    val title: String = "",
    val cwd: String = "",
    val running: Boolean = false,
    val pending: Int = 0,
    val status: String = "",
    val lastActive: Long = 0,
    val last: String? = null,
    val failed: Boolean = false,
)

// shared/protocol.ts ServerMessage, only the variants this client acts on.
sealed interface ServerMessage {
    // 'init': state.session.id, state.events (a tail of ROW_WINDOW), state.earlier
    data class Init(val chatId: String, val events: List<ChatEvent>, val earlier: Int) : ServerMessage
    data class Event(val event: ChatEvent) : ServerMessage
    data class Append(val id: String, val offset: Int, val text: String) : ServerMessage
    data class Live(val chats: List<LiveChat>) : ServerMessage
    data class Other(val type: String) : ServerMessage
}

fun parseMessage(data: String): ServerMessage {
    val o = protocolJson.parseToJsonElement(data).jsonObject
    return when (val type = o["type"]?.jsonPrimitive?.contentOrNull ?: "") {
        "init" -> {
            val state = o["state"]!!.jsonObject
            val chatId = state["session"]?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull ?: ""
            ServerMessage.Init(chatId, events(state), state["earlier"]?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 0)
        }
        "event" -> ServerMessage.Event(protocolJson.decodeFromJsonElement(ChatEvent.serializer(), o["event"]!!))
        "append" -> ServerMessage.Append(
            o["id"]!!.jsonPrimitive.content,
            o["offset"]!!.jsonPrimitive.content.toInt(),
            o["text"]!!.jsonPrimitive.content,
        )
        "live" -> ServerMessage.Live(
            o["chats"]!!.let { protocolJson.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(LiveChat.serializer()), it) },
        )
        else -> ServerMessage.Other(type)
    }
}

private fun events(state: JsonObject): List<ChatEvent> =
    state["events"]?.let { protocolJson.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(ChatEvent.serializer()), it) } ?: emptyList()

// shared/protocol.ts appendTo: the event with streamed text added, or null when the append does not fit it.
fun appendTo(ev: ChatEvent, offset: Int, text: String): ChatEvent? {
    if (ev.kind != "assistant" || offset > ev.text.length) return null
    val add = text.substring(minOf(text.length, ev.text.length - offset))
    return if (add.isEmpty()) null else ev.copy(text = ev.text + add)
}

// shared/protocol.ts ClientMessage 'prompt' | 'queue' | 'view' as the JSON the web store posts to /api/cmd.
fun viewCmd(id: String) = """{"type":"view","id":${quote(id)}}"""

// web/src/chat/Composer.tsx: a message sent while Claude runs is queued for its next step, otherwise it is a prompt.
fun promptCmd(text: String, running: Boolean, id: String) =
    """{"type":"${if (running) "queue" else "prompt"}","text":${quote(text)},"id":${quote(id)}}"""

private fun quote(s: String) = kotlinx.serialization.json.JsonPrimitive(s).toString()
