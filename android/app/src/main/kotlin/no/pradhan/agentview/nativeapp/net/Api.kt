package no.pradhan.agentview.nativeapp.net

import no.pradhan.agentview.nativeapp.app.NoticeRemote
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.chat.ROW_WINDOW
import no.pradhan.agentview.nativeapp.codex.AssistantRemote
import no.pradhan.agentview.nativeapp.codex.TranscriptHit
import no.pradhan.agentview.nativeapp.sessions.BinnedSession
import no.pradhan.agentview.nativeapp.sessions.Repo
import no.pradhan.agentview.nativeapp.sessions.SavedSession
import no.pradhan.agentview.nativeapp.sessions.Worktree
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class ApiError(message: String, val code: Int = 0) : Exception(message)

fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

// The REST routes of server/src/http/routes.ts that the chat screens read and write.
// One client for the whole app, so its connections and threads are shared; callers that need other timeouts use newBuilder().
val sharedHttp: OkHttpClient by lazy { OkHttpClient() }

class Api(private val origin: () -> String, private val http: OkHttpClient = sharedHttp) : AssistantRemote, NoticeRemote {
    private val quick = http.newBuilder().readTimeout(20, java.util.concurrent.TimeUnit.SECONDS).build()
    private val slow = http.newBuilder().readTimeout(120, java.util.concurrent.TimeUnit.SECONDS).build()
    private val long = http.newBuilder().readTimeout(300, java.util.concurrent.TimeUnit.SECONDS).build()

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

    suspend fun setDefaultProvider(id: String) { call(url("/api/settings").post(buildJsonObject { put("defaultProvider", id) }.toString().toRequestBody(json))) }

    suspend fun setFeatureUse(on: Boolean) = protocolJson.decodeFromString(AppSettings.serializer(), call(url("/api/settings").post(buildJsonObject { put("featureUse", on) }.toString().toRequestBody(json))).decodeToString()).featureUse
    suspend fun trackFeature(id: String) = protocolJson.decodeFromString(TrackReply.serializer(), call(url("/api/feature-use").post(buildJsonObject { put("id", id) }.toString().toRequestBody(json))).decodeToString()).recorded
    suspend fun setHiddenFeatures(ids: List<String>) = protocolJson.decodeFromString(AppSettings.serializer(), call(url("/api/settings").post(buildJsonObject { put("hiddenFeatures", JsonArray(ids.map(::JsonPrimitive))) }.toString().toRequestBody(json))).decodeToString()).hiddenFeatures
    suspend fun featureUse() = protocolJson.decodeFromString(FeatureUseReply.serializer(), call(url("/api/feature-use")).decodeToString()).days

    suspend fun settings() = protocolJson.decodeFromString(AppSettings.serializer(), call(url("/api/settings")).decodeToString())
    suspend fun sessions() = list("/api/sessions", SavedSession.serializer())
    suspend fun repos() = list("/api/repos", Repo.serializer())
    suspend fun worktrees() = list("/api/worktrees", Worktree.serializer())
    suspend fun pins() = list("/api/sessions/pins", String.serializer())
    suspend fun seen(): Map<String, Long> = protocolJson.decodeFromString(MapSerializer(String.serializer(), Long.serializer()), call(url("/api/sessions/seen")).decodeToString())

    suspend fun resolvedQuestions() = list("/api/questions/resolved", String.serializer())
    suspend fun resolveQuestion(key: String) { call(url("/api/questions/resolved?key=${enc(key)}").post("".toRequestBody())) }

    suspend fun markSeen(sessionId: String, unread: Boolean = false) { call(url("/api/sessions/seen?id=${enc(sessionId)}${if (unread) "&unread=1" else ""}").post("".toRequestBody())) }
    suspend fun pin(sessionId: String, on: Boolean) {
        val req = url("/api/sessions/pins?id=${enc(sessionId)}")
        call(if (on) req.post("".toRequestBody()) else req.delete())
    }

    suspend fun rename(sessionId: String, title: String) {
        val body = buildJsonObject { put("title", title) }.toString().toRequestBody(json)
        call(url("/api/sessions/rename?id=${enc(sessionId)}").post(body))
    }

    suspend fun archive(sessionId: String) { call(url("/api/sessions?id=${enc(sessionId)}&archive").delete()) }

    suspend fun deleteChat(sessionId: String) { call(url("/api/sessions?id=${enc(sessionId)}&purge").delete()) }

    suspend fun restore(sessionId: String) { call(url("/api/sessions/restore?id=${enc(sessionId)}").post("".toRequestBody())) }

    suspend fun bin() = list("/api/sessions/bin", BinnedSession.serializer())

    suspend fun emptyBin() { call(url("/api/sessions/bin").delete()) }

    // web/src/codex/data/remote.ts: the assistant hub's rows are pulled by version and pushed as per-column changes.
    suspend fun assistantChanges(since: Long, full: Boolean): String = call(url("/api/assistant/changes?since=$since" + if (full) "&full=1" else "")).decodeToString()
    suspend fun assistantSync(body: String): String = call(url("/api/assistant/sync").post(body.toRequestBody(json))).decodeToString()
    suspend fun parseTask(body: String): String = call(url("/api/assistant/parse").post(body.toRequestBody(json)), quick).decodeToString()

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

    // Meetings of the profile, or of both when null, whose stored transcript holds the query, with a snippet of the match.
    suspend fun searchTranscripts(query: String, profile: String?): List<TranscriptHit> {
        val hits = protocolJson.parseToJsonElement(call(url("/api/assistant/transcripts/search?q=${enc(query)}${profile?.let { "&profile=${enc(it)}" } ?: ""}")).decodeToString()).jsonObject["hits"] as? JsonArray ?: return emptyList()
        return hits.mapNotNull { h ->
            val o = h as? JsonObject ?: return@mapNotNull null
            fun s(k: String) = (o[k] as? JsonPrimitive)?.contentOrNull
            TranscriptHit(s("profile") ?: return@mapNotNull null, s("id") ?: return@mapNotNull null, s("snippet").orEmpty())
        }
    }

    suspend fun readTranscript(profile: String, id: String, instructions: String? = null): Int {
        val body = buildJsonObject { put("profile", profile); put("id", id); if (instructions != null) put("instructions", instructions) }.toString().toRequestBody(json)
        val saved = protocolJson.parseToJsonElement(call(url("/api/assistant/transcripts").post(body), long).decodeToString()).jsonObject["saved"]
        return saved?.jsonPrimitive?.intOrNull ?: 0
    }

    suspend fun earlier(chat: String, before: String, limit: Int = ROW_WINDOW): Pair<List<ChatEvent>, Int> =
        parseEarlier(call(url("/api/chat/events?chat=${enc(chat)}&before=${enc(before)}&limit=$limit")).decodeToString())

    suspend fun spawnedBuilds(session: String) = list("/api/chat/spawned?session=${enc(session)}", SpawnedBuild.serializer())
    suspend fun subChats(session: String) = list("/api/chat/subchats?session=${enc(session)}", SubChat.serializer())
    suspend fun subChatEvents(session: String, before: String = "", limit: Int = 150): Pair<List<ChatEvent>, Int> =
        parseEarlier(call(url("/api/chat/subchat-events?session=${enc(session)}&before=${enc(before)}&limit=$limit")).decodeToString())

    suspend fun paste(name: String, mime: String, bytes: ByteArray): String {
        val body = call(url("/api/paste?name=${enc(name)}").post(bytes.toRequestBody(mime.toMediaType())))
        return protocolJson.parseToJsonElement(body.decodeToString()).jsonObject["path"]!!.jsonPrimitive.content
    }

    suspend fun bytes(path: String): ByteArray = call(url(path))
    suspend fun postBytes(path: String, mime: String, bytes: ByteArray, slow: Boolean = false): String = call(url(path).post(bytes.toRequestBody(mime.toMediaType())), if (slow) this.slow else http).decodeToString()
    fun link(path: String) = origin() + path

    suspend fun image(chat: String, path: String): ByteArray = call(url("/api/image?chat=${enc(chat)}&path=${enc(path)}"))

    // Chat-scoped routes run in the chat's folder; without a chat the server uses the last viewed one.
    private fun scoped(path: String, chat: String) = if (chat.isEmpty()) path else path + (if ('?' in path) "&" else "?") + "chat=${enc(chat)}"
    suspend fun get(path: String, chat: String = ""): String = call(url(scoped(path, chat))).decodeToString()
    suspend fun post(path: String, body: String, chat: String = ""): String = call(url(scoped(path, chat)).post(body.toRequestBody(json))).decodeToString()
    suspend fun delete(path: String, chat: String = ""): String = call(url(scoped(path, chat)).delete()).decodeToString()
    suspend fun put(path: String, body: String, chat: String = ""): String = call(url(scoped(path, chat)).put(body.toRequestBody("text/plain".toMediaType()))).decodeToString()

    override suspend fun pending(chat: String): List<Pending> =
        (protocolJson.parseToJsonElement(get("/api/state?limit=0", chat)).jsonObject["pending"] as? kotlinx.serialization.json.JsonArray)?.mapNotNull { parsePending(it) } ?: emptyList()

    override suspend fun send(chat: String, body: String) { post("/api/cmd?cid=${enc(java.util.UUID.randomUUID().toString())}&client=phone", body, chat) }
}
