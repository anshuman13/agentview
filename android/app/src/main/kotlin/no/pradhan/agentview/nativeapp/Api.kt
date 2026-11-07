package no.pradhan.agentview.nativeapp

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder

class ApiError(message: String, val code: Int = 0) : Exception(message)

fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

// The REST routes of server/src/http/routes.ts that the chat screens read and write.
class Api(private val origin: () -> String, private val http: OkHttpClient = OkHttpClient()) : AssistantRemote {
    private val slow = http.newBuilder().readTimeout(120, java.util.concurrent.TimeUnit.SECONDS).build()

    private suspend fun call(req: Request.Builder, client: OkHttpClient = http): ByteArray = withContext(Dispatchers.IO) {
        client.newCall(req.build()).execute().use { r ->
            val body = r.body.bytes()
            if (!r.isSuccessful) {
                val msg = runCatching { protocolJson.parseToJsonElement(body.decodeToString()).jsonObject["error"]?.jsonPrimitive?.contentOrNull }.getOrNull()
                throw ApiError(msg ?: "Server said ${r.code}", r.code)
            }
            body
        }
    }

    private fun url(path: String) = Request.Builder().url(origin() + path)
    private val json = "application/json".toMediaType()

    private suspend fun <T> list(path: String, ser: KSerializer<T>) = protocolJson.decodeFromString(ListSerializer(ser), call(url(path)).decodeToString())

    suspend fun sessions() = list("/api/sessions", SavedSession.serializer())
    suspend fun repos() = list("/api/repos", Repo.serializer())
    suspend fun worktrees() = list("/api/worktrees", Worktree.serializer())
    suspend fun pins() = list("/api/sessions/pins", String.serializer())
    suspend fun seen(): Map<String, Long> = protocolJson.decodeFromString(MapSerializer(String.serializer(), Long.serializer()), call(url("/api/sessions/seen")).decodeToString())

    suspend fun markSeen(sessionId: String) { call(url("/api/sessions/seen?id=${enc(sessionId)}").post("".toRequestBody())) }
    suspend fun pin(sessionId: String, on: Boolean) {
        val req = url("/api/sessions/pins?id=${enc(sessionId)}")
        call(if (on) req.post("".toRequestBody()) else req.delete())
    }

    suspend fun rename(sessionId: String, title: String) {
        val body = buildJsonObject { put("title", title) }.toString().toRequestBody(json)
        call(url("/api/sessions/rename?id=${enc(sessionId)}").post(body))
    }

    suspend fun archive(sessionId: String) { call(url("/api/sessions?id=${enc(sessionId)}&archive").delete()) }

    // web/src/codex/data/remote.ts: the assistant hub's rows are pulled by version and pushed as per-column changes.
    suspend fun assistantChanges(since: Long, full: Boolean): String = call(url("/api/assistant/changes?since=$since" + if (full) "&full=1" else "")).decodeToString()
    suspend fun assistantSync(body: String): String = call(url("/api/assistant/sync").post(body.toRequestBody(json))).decodeToString()

    override suspend fun autopilot(patch: String?): String = call(url("/api/assistant/autopilot").let { if (patch == null) it else it.post(patch.toRequestBody(json)) }).decodeToString()
    override suspend fun replyHistory(who: String): String = call(url("/api/assistant/history?who=${enc(who)}")).decodeToString()

    override suspend fun sendReply(id: String, edited: Boolean, text: String?): String {
        val body = buildJsonObject { if (text != null) put("text", text) }.toString().toRequestBody(json)
        return call(url("/api/assistant/slack/reply?id=${enc(id)}" + if (edited) "&edited=1" else "").post(body), slow).decodeToString()
    }

    override suspend fun skipAsk(id: String) { call(url("/api/assistant/slack/skip?id=${enc(id)}").post("".toRequestBody())) }

    // The transcript text of a meeting stays on the hub; a meeting without stored text answers 404.
    suspend fun transcript(profile: String, id: String): String? = try {
        protocolJson.parseToJsonElement(call(url("/api/assistant/transcript?profile=${enc(profile)}&id=${enc(id)}")).decodeToString()).jsonObject["text"]?.jsonPrimitive?.contentOrNull
    } catch (e: ApiError) {
        if (e.code == 404) null else throw e
    }

    suspend fun earlier(chat: String, before: String, limit: Int = ROW_WINDOW): Pair<List<ChatEvent>, Int> =
        parseEarlier(call(url("/api/chat/events?chat=${enc(chat)}&before=${enc(before)}&limit=$limit")).decodeToString())

    suspend fun paste(name: String, mime: String, bytes: ByteArray): String {
        val body = call(url("/api/paste?name=${enc(name)}").post(bytes.toRequestBody(mime.toMediaType())))
        return protocolJson.parseToJsonElement(body.decodeToString()).jsonObject["path"]!!.jsonPrimitive.content
    }

    suspend fun image(chat: String, path: String): ByteArray = call(url("/api/image?chat=${enc(chat)}&path=${enc(path)}"))

    // Chat-scoped routes run in the chat's folder; without a chat the server uses the last viewed one.
    private fun scoped(path: String, chat: String) = if (chat.isEmpty()) path else path + (if ('?' in path) "&" else "?") + "chat=${enc(chat)}"
    suspend fun get(path: String, chat: String = ""): String = call(url(scoped(path, chat))).decodeToString()
    suspend fun post(path: String, body: String, chat: String = ""): String = call(url(scoped(path, chat)).post(body.toRequestBody(json))).decodeToString()
}
