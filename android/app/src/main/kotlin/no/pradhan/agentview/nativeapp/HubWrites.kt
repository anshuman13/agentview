package no.pradhan.agentview.nativeapp

import android.net.Uri
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal suspend fun Hub.attachUri(uri: String): String? {
    val r = app.contentResolver
    val mime = r.getType(Uri.parse(uri)) ?: "image/jpeg"
    val bytes = withContext(Dispatchers.IO) { runCatching { r.openInputStream(Uri.parse(uri))?.use { it.readBytes() } }.getOrNull() } ?: return null
    return attach("shared.${mime.substringAfter('/', "jpg").substringBefore('+')}", mime, bytes)
}

// Sends shared text and images to a chat and shows the chat.
fun Hub.shareToChat(chat: String, item: SharedItem) {
    if (readOnly) { notice.value = READ_ONLY_SENT; return }
    viewModelScope.launch {
        open(chat)
        val paths = item.images.mapNotNull { attachUri(it) }
        val text = (listOf(shareChatText(item.subject, item.text)) + paths.map { "[Image: $it]" }).filter { it.isNotEmpty() }.joinToString("\n")
        submit(text, false) { notice.value = "That did not reach the chat" }
        link.value = DeepLink(chat = chat)
    }
}

suspend fun Hub.read(path: String): String = api.get(path, pageChat)

fun Hub.write(path: String, body: String, failure: String, done: (Boolean) -> Unit = {}) = write(path, body, failure, {}) { done(it != null) }

fun Hub.saveFile(path: String, content: String, done: (Boolean) -> Unit) = writes.run("Could not save ${path.substringAfterLast('/')}", { api.put("/api/file?path=${enc(path)}", content, pageChat) }, done)

// A guarded write whose response is parsed and handed to `done`, or null when it did not go through.
fun <T> Hub.write(path: String, body: String, failure: String, parse: (String) -> T, done: (T?) -> Unit) {
    var out: T? = null
    writes.run(failure, { out = parse(api.post(path, body, pageChat)) }) { done(if (it) out else null) }
}

fun Hub.readWithRoomMic(m: Row, done: (Boolean) -> Unit) {
    writes.run("Transcript sync failed", {
        try {
            codex.update(m, mapOf("room_me" to 1))
            codex.sync()
            codex.state.value.error?.let { error("the room mic answer did not sync: $it") }
            api.readTranscript(m.profile, m.id)
            codex.sync()
            notice.value = "Read again with the room mic as you"
        } catch (e: Exception) {
            throw ApiError("Transcript sync failed: ${e.message}")
        }
    }, done)
}

internal fun Hub.write(failure: String, block: suspend () -> Unit) {
    if (readOnly) return
    viewModelScope.launch { runCatching { block() }.onFailure { notice.value = it.message ?: failure } }
}

// Uploads a picked file and returns the path to mention in the prompt.
suspend fun Hub.attach(name: String, mime: String, bytes: ByteArray): String? {
    if (readOnly) return null
    return runCatching { api.paste(name, mime, bytes) }.onFailure { notice.value = "Could not attach $name: ${it.message}" }.getOrNull()
}

suspend fun Hub.image(chat: String, path: String): ByteArray? = runCatching { api.image(chat, path) }.getOrNull()
