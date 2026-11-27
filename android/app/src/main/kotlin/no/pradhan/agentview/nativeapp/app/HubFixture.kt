package no.pradhan.agentview.nativeapp.app

import androidx.lifecycle.viewModelScope
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.ServerMessage
import no.pradhan.agentview.nativeapp.net.parseMessage
import no.pradhan.agentview.nativeapp.net.protocolJson

// A file holds one server message or a JSON array of them.
fun fixtureMessages(text: String): List<ServerMessage> {
    val root = protocolJson.parseToJsonElement(text)
    val items = if (root is JsonArray) root.toList() else listOf(root)
    return items.mapNotNull { runCatching { parseMessage(it.toString()) }.getOrNull() }
}

fun withFixture(m: ServerMessage, chat: LiveChat?): ServerMessage =
    if (m is ServerMessage.Live && chat != null && m.chats.none { it.id == chat.id }) ServerMessage.Live(m.chats + chat) else m

// Readonly checks only: shows a chat from files pushed to the app's external files folder, then feeds the stream file every chunkMs.
internal fun Hub.loadFixture(chat: String, stream: String?, chunkMs: Long) {
    if (!readOnly) return
    val dir = app.getExternalFilesDir(null) ?: return
    fun read(name: String) = runCatching { fixtureMessages(File(dir, File(name).name).readText()) }.getOrDefault(emptyList())
    viewModelScope.launch {
        val init = withContext(Dispatchers.IO) { read(chat) }.firstOrNull() as? ServerMessage.Init
        if (init == null) { notice.value = "No fixture chat in $chat"; return@launch }
        fixtureChat = LiveChat(init.chatId, "Fixture chat", init.session?.cwd.orEmpty(), running = true, sessionId = init.chatId)
        store.handle(withFixture(ServerMessage.Live(store.state.value.live), fixtureChat))
        store.show(init.chatId)
        store.handle(init)
        link.value = DeepLink(view = "agents")
        val chunks = stream?.let { withContext(Dispatchers.IO) { read(it) } }.orEmpty()
        for (m in chunks) {
            delay(chunkMs)
            if (store.wanted != init.chatId) break
            store.handle(m)
        }
    }
}
