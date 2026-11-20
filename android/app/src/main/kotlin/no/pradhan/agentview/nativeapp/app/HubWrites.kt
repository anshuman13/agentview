package no.pradhan.agentview.nativeapp.app

import no.pradhan.agentview.nativeapp.net.ApiError
import no.pradhan.agentview.nativeapp.net.READ_ONLY_SENT
import no.pradhan.agentview.nativeapp.net.enc
import no.pradhan.agentview.nativeapp.net.loadErrorText
import no.pradhan.agentview.nativeapp.net.protocolJson
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import android.net.Uri
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import no.pradhan.agentview.nativeapp.chat.Transcript
import no.pradhan.agentview.nativeapp.codex.Row

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

// Saves a file of the page chat's folder (or a Markdown file in a work folder); null when saved, else why not.
suspend fun Hub.saveFile(path: String, text: String): String? {
    if (readOnly) return READ_ONLY_SENT
    return runCatching { api.put("/api/file?path=${enc(path)}", text, pageChat); null }.getOrElse { it.message ?: "Not saved" }
}

fun Hub.write(path: String, body: String, failure: String, done: (Boolean) -> Unit = {}) = write(path, body, failure, {}) { done(it != null) }

// A review action on a job run (/api/runs/<action>); a failure shows "<failure>: <server error>".
fun Hub.runReview(action: String, run: String, failure: String, body: String = "{}", done: (Boolean) -> Unit = {}) =
    writes.run(failure, { try { api.post("/api/runs/$action?run=${enc(run)}", body, pageChat) } catch (e: ApiError) { throw ApiError("$failure: ${e.message}", e.code) } }, done)

fun Hub.saveFile(path: String, content: String, failure: String = "Could not save ${path.substringAfterLast('/')}", done: (Boolean) -> Unit) = writes.run(failure, { api.put("/api/file?path=${enc(path)}", content, pageChat) }, done)

// Replaces the body of a memory file; `done` gets the body it had, or null when the save did not go through.
fun Hub.saveMemory(path: String, text: String, failure: String, done: (String?) -> Unit) =
    write("/api/memory/save", buildJsonObject { put("path", path); put("text", text) }.toString(), failure, { protocolJson.parseToJsonElement(it).jsonObject.getValue("previous").jsonPrimitive.content }, done)

// A guarded write whose response is parsed and handed to `done`, or null when it did not go through.
fun <T> Hub.write(path: String, body: String, failure: String, parse: (String) -> T, done: (T?) -> Unit) {
    var out: T? = null
    writes.run(failure, { out = parse(api.post(path, body, pageChat)) }) { done(if (it) out else null) }
}

private fun Hub.transcriptSync(done: (Boolean) -> Unit, block: suspend () -> Unit) {
    writes.run("Transcript sync failed", {
        try {
            block()
        } catch (e: Exception) {
            throw ApiError("Transcript sync failed: ${e.message}")
        }
    }, done)
}

fun Hub.readWithRoomMic(m: Row, done: (Boolean) -> Unit) = transcriptSync(done) {
    codex.update(m, mapOf("room_me" to 1))
    codex.sync()
    codex.state.value.error?.let { error("the room mic answer did not sync: $it") }
    api.readTranscript(m.profile, m.id)
    codex.sync()
    notice.value = "Read again with the room mic as you"
}

fun Hub.readNow(m: Row, done: (Boolean) -> Unit) = transcriptSync(done) {
    val saved = api.readTranscript(m.profile, m.id)
    codex.sync()
    notice.value = if (saved > 0) "Read the transcript" else "No transcript found yet"
}

internal fun Hub.write(failure: String, block: suspend () -> Unit) {
    if (readOnly) return
    viewModelScope.launch { runCatching { block() }.onFailure { notice.value = it.message?.let(::loadErrorText) ?: failure } }
}

// Uploads a picked file and returns the path to mention in the prompt.
suspend fun Hub.attach(name: String, mime: String, bytes: ByteArray): String? {
    if (readOnly) return null
    return runCatching { api.paste(name, mime, bytes) }.onFailure { notice.value = "Could not attach $name: ${it.message}" }.getOrNull()
}

suspend fun Hub.image(chat: String, path: String): ByteArray? = runCatching { api.image(chat, path) }.getOrNull()
