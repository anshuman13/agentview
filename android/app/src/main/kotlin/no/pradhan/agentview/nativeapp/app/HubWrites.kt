package no.pradhan.agentview.nativeapp.app

import no.pradhan.agentview.nativeapp.net.ApiError
import no.pradhan.agentview.nativeapp.net.READ_ONLY_SENT
import no.pradhan.agentview.nativeapp.net.enc
import no.pradhan.agentview.nativeapp.net.loadErrorText
import no.pradhan.agentview.nativeapp.net.protocolJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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
import no.pradhan.agentview.nativeapp.chat.MemoryFile
import no.pradhan.agentview.nativeapp.chat.Transcript
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.meetings.SUMMARY_TEMPLATES
import no.pradhan.agentview.nativeapp.codex.meetings.encodeNotesPicks
import no.pradhan.agentview.nativeapp.codex.meetings.notesPickKey
import no.pradhan.agentview.nativeapp.codex.meetings.parseNotesPicks
import no.pradhan.agentview.nativeapp.travel.Receipt
import no.pradhan.agentview.nativeapp.travel.parseTravel

internal suspend fun Hub.attachUri(uri: String): String? {
    val r = app.contentResolver
    val mime = r.getType(Uri.parse(uri)) ?: "image/jpeg"
    val bytes = withContext(Dispatchers.IO) { runCatching { r.openInputStream(Uri.parse(uri))?.use { it.readBytes() } }.getOrNull() } ?: return null
    return attach("shared.${mime.substringAfter('/', "jpg").substringBefore('+')}", mime, bytes)
}

// Files each shared image or PDF as a trip receipt (the server picks the trip by date) and opens Travel; no chat needed.
fun Hub.shareToTravel(item: SharedItem) {
    if (readOnly) { notice.value = READ_ONLY_SENT; return }
    viewModelScope.launch {
        val r = app.contentResolver
        var added = 0
        var trip = ""
        for (uri in item.images) {
            val mime = r.getType(Uri.parse(uri)) ?: "image/jpeg"
            val bytes = withContext(Dispatchers.IO) { runCatching { r.openInputStream(Uri.parse(uri))?.use { it.readBytes() } }.getOrNull() }
            if (bytes == null) { notice.value = "Could not read the shared file"; continue }
            val name = "receipt.${mime.substringAfter('/', "jpg").substringBefore('+')}"
            runCatching { api.postBytes("/api/travel/receipt?name=${enc(name)}", mime, bytes, slow = true) }
                .onSuccess { trip = protocolJson.decodeFromString(Receipt.serializer(), it).tripId; added++ }
                .onFailure { notice.value = "Receipt not added: ${it.message}" }
        }
        if (added == 0) return@launch
        val name = runCatching { parseTravel(api.get("/api/travel")).trips.firstOrNull { it.id == trip }?.name }.getOrNull() ?: "a trip"
        notice.value = if (added == 1) "Receipt added to $name" else "$added receipts added to $name"
        link.value = DeepLink(page = "travel")
    }
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
    writes.run(failure, { try { api.post("/api/runs/$action?run=${enc(run)}", body, pageChat) } catch (e: ApiError) { throw ApiError("$failure: ${loadErrorText(e.message.orEmpty())}", e.code) } }, done)

fun Hub.saveFile(path: String, content: String, failure: String = "Could not save ${path.substringAfterLast('/')}", done: (Boolean) -> Unit) = writes.run(failure, { api.put("/api/file?path=${enc(path)}", content, pageChat) }, done)

// web fileApi.ts renameSketch and deleteSketch: change a file in the chat's .claude/sketches; the notice carries the server's reason.
private fun Hub.sketchWrite(failure: String, done: (Boolean) -> Unit, call: suspend () -> String) =
    writes.run(failure, {
        try { call() }
        catch (e: ApiError) { throw ApiError("$failure: ${loadErrorText(e.message.orEmpty())}", e.code) }
        catch (e: java.io.IOException) { throw ApiError("$failure: ${loadErrorText(e.message.orEmpty())}") }
    }, done)
fun Hub.renameSketch(name: String, to: String, done: (Boolean) -> Unit) = sketchWrite("Not renamed", done) { api.post("/api/sketches/rename?name=${enc(name)}&to=${enc(to)}", "", pageChat) }
fun Hub.deleteSketch(name: String, done: (Boolean) -> Unit) = sketchWrite("Not deleted", done) { api.delete("/api/sketches?name=${enc(name)}", pageChat) }

// Replaces the body of a memory file; `done` gets the body it had, or null when the save did not go through.
fun Hub.saveMemory(path: String, text: String, failure: String, done: (String?) -> Unit) =
    write("/api/memory/save", buildJsonObject { put("path", path); put("text", text) }.toString(), failure, { protocolJson.parseToJsonElement(it).jsonObject.getValue("previous").jsonPrimitive.content }, done)

// web chatActions.ts forgetMemory: deletes a memory file and its MEMORY.md lines; Undo puts them back, then runs `restored`. `done` gets true once the file is gone.
fun Hub.forgetMemory(file: MemoryFile, restored: () -> Unit, done: (Boolean) -> Unit) =
    write("/api/memory/remove", buildJsonObject { put("path", file.path) }.toString(), "Could not forget the memory", { protocolJson.parseToJsonElement(it).jsonObject }) { removed ->
        if (removed != null) undoable.tryEmit(Undoable("Memory forgotten") {
            write("/api/memory/restore", JsonObject(removed + ("path" to JsonPrimitive(file.path))).toString(), "Could not restore the memory") { if (it) restored() }
        })
        done(removed != null)
    }

// A guarded write whose response is parsed and handed to `done`, or null when it did not go through.
fun <T> Hub.write(path: String, body: String, failure: String, parse: (String) -> T, done: (T?) -> Unit) {
    var out: T? = null
    writes.run(failure, { out = parse(api.post(path, body, pageChat)) }) { done(if (it) out else null) }
}

private fun Hub.transcriptSync(done: (Boolean) -> Unit, failure: String = "Transcript sync failed", block: suspend () -> Unit) {
    writes.run(failure, {
        try {
            block()
        } catch (e: Exception) {
            throw ApiError("$failure: ${e.message}")
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

private const val SUMMARY_PICKS_KEY = "codex.summaryPicks"

fun Hub.summaryPicks() = parseNotesPicks(prefs.getString(SUMMARY_PICKS_KEY, null))

// Reads the transcript again with the template's instructions and remembers the pick for the meeting's series.
fun Hub.rewriteSummary(m: Row, key: String, done: (Boolean) -> Unit) = transcriptSync(done, "Summary failed") {
    val t = SUMMARY_TEMPLATES.getValue(key)
    api.readTranscript(m.profile, m.id, t.instructions)
    codex.sync()
    prefs.edit().putString(SUMMARY_PICKS_KEY, encodeNotesPicks(summaryPicks() + (notesPickKey(m) to key))).apply()
    notice.value = "Summary rewritten as ${t.label}"
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
