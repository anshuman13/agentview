package no.pradhan.agentview.nativeapp

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID

// Same default as the Tauri phone app (web/src/app/api.ts MAC_URL).
const val DEFAULT_ORIGIN = "http://macmini.netbird.cloud:7777"
const val WORKSPACE_MIN_AGE_MS = 30_000L

private val collapsedSer = MapSerializer(String.serializer(), Boolean.serializer())

class Hub(app: Application) : AndroidViewModel(app) {
    private val prefs = app.getSharedPreferences("agentview", 0)
    private val cid = UUID.randomUUID().toString()
    private val http = OkHttpClient()
    val store = ChatStore()

    val origin = MutableStateFlow(prefs.getString("origin", null) ?: DEFAULT_ORIGIN)
    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected
    val notice = MutableStateFlow<String?>(null)
    val link = MutableStateFlow<DeepLink?>(null)
    val workspace = MutableStateFlow(Workspace())
    val loadingEarlier = MutableStateFlow(false)
    val api = Api({ origin.value }, http)

    // Set by the launch intent to check the screens without changing anything on the server beyond viewing a chat.
    @Volatile var readOnly = false
    private var workspaceAt = 0L

    private val stream = EventStream(
        viewModelScope,
        url = { last ->
            val chat = store.wanted
            "${origin.value}/api/events?cid=$cid" + (if (chat.isNotEmpty()) "&chat=${enc(chat)}" else "") + (if (last.isNotEmpty()) "&last=$last" else "")
        },
        onConnected = { up ->
            _connected.value = up
            if (up) viewModelScope.launch { refreshWorkspace(force = true) }
        },
        onData = { data -> runCatching { parseMessage(data) }.onSuccess { handle(it) } },
    )

    private fun handle(m: ServerMessage) {
        if (m is ServerMessage.Error) notice.value = m.text
        store.handle(m)
    }

    val collapsed = MutableStateFlow(
        runCatching { protocolJson.decodeFromString(collapsedSer, prefs.getString("collapsed", "{}")!!) }.getOrDefault(emptyMap()),
    )

    fun setCollapsed(key: String, value: Boolean) {
        collapsed.value = collapsed.value + (key to value)
        prefs.edit().putString("collapsed", protocolJson.encodeToString(collapsedSer, collapsed.value)).apply()
    }

    private val drafts = HashMap<String, String>()
    fun draft(chat: String) = drafts[chat] ?: ""
    fun setDraft(chat: String, text: String) { if (text.isEmpty()) drafts.remove(chat) else drafts[chat] = text }

    fun connect() = stream.start()
    fun disconnect() = stream.stop()
    fun retry() = stream.start()

    fun saveOrigin(value: String) {
        val v = value.trim().trimEnd('/').let { if (it.isEmpty() || "://" in it) it else "http://$it" }
        if (v.isEmpty()) return
        prefs.edit().putString("origin", v).apply()
        origin.value = v
        store.reset()
        workspace.value = Workspace()
        workspaceAt = 0
        stream.resetResume()
        stream.start()
    }

    fun refreshWorkspace(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - workspaceAt < WORKSPACE_MIN_AGE_MS) return
        workspaceAt = now
        viewModelScope.launch {
            val from = origin.value
            runCatching {
                coroutineScope {
                    val was = workspace.value
                    val saved = async { runCatching { api.sessions() }.getOrDefault(was.saved) }
                    val repos = async { runCatching { api.repos() }.getOrDefault(was.repos) }
                    val trees = async { runCatching { api.worktrees() }.getOrDefault(was.trees) }
                    val pins = async { runCatching { api.pins() }.getOrDefault(was.pins) }
                    val seen = async { runCatching { api.seen() }.getOrDefault(was.seen) }
                    Workspace(repos.await(), trees.await(), saved.await(), pins.await(), seen.await())
                }
            }.onSuccess { if (from == origin.value) workspace.value = it }.onFailure { workspaceAt = 0 }
        }
    }

    private fun markSeen(sessionId: String?) {
        if (sessionId == null) return
        workspace.value = workspace.value.let { it.copy(seen = it.seen + (sessionId to System.currentTimeMillis())) }
        if (!readOnly) viewModelScope.launch { runCatching { api.markSeen(sessionId) } }
    }

    fun open(id: String) {
        store.show(id)
        markSeen(store.state.value.live.firstOrNull { it.id == id }?.sessionId)
        post(viewCmd(id), id, viewing = true)
    }

    // Opens a saved session; true once its live chat exists and is shown.
    suspend fun openSaved(sessionId: String): Boolean {
        if (readOnly) return false
        markSeen(sessionId)
        post(openSessionCmd(sessionId), store.wanted)
        val chat = withTimeoutOrNull(20_000) { store.state.first { s -> s.live.any { it.sessionId == sessionId } } }?.live?.first { it.sessionId == sessionId } ?: return false
        open(chat.id)
        return true
    }

    fun close() = store.close()

    fun closeChat(id: String) = post(closeCmd(id), id)

    // A message while Claude runs queues for its next step, or with `steer` stops it and sends now.
    fun submit(text: String, steer: Boolean, onLost: () -> Unit) {
        val t = text.trim()
        if (t.isEmpty()) return
        val chat = store.wanted
        val running = store.state.value.let { s -> s.session?.running ?: s.live.firstOrNull { it.id == chat }?.running } == true
        val id = UUID.randomUUID().toString()
        val body = when {
            running && steer -> {
                store.addLocal(chat, ChatEvent(id, "user", text = t, at = System.currentTimeMillis(), stopping = true))
                steerCmd(t, id)
            }
            else -> promptCmd(t, running, id)
        }
        post(body, chat) { ok ->
            if (!ok) {
                if (steer && running) store.dropLocal(chat, id)
                onLost()
            }
        }
    }

    fun interrupt() = post(interruptCmd(), store.wanted)
    fun answer(id: String, answers: Map<String, String>) = post(answerCmd(id, answers), store.wanted)
    fun permission(id: String, allow: Boolean, always: Boolean = false) = post(permissionCmd(id, allow, always), store.wanted)
    fun allowBlocked(id: String) = post(allowBlockedCmd(id), store.wanted)
    fun sendNow(id: String) = post(sendNowCmd(id), store.wanted)
    fun stopTask(toolUseId: String) = post(stopTaskCmd(toolUseId), store.wanted)
    fun setModel(model: String) = post(setModelCmd(model), store.wanted)
    fun setEffort(effort: String) = post(setEffortCmd(effort), store.wanted)
    fun setMode(mode: String) = post(setModeCmd(mode), store.wanted)

    fun loadEarlier() {
        val s = store.state.value
        val first = s.events.firstOrNull()?.id ?: return
        if (loadingEarlier.value) return
        val chat = s.shownId
        loadingEarlier.value = true
        viewModelScope.launch {
            runCatching { api.earlier(chat, first) }
                .onSuccess { (older, earlier) -> store.prepend(chat, older, earlier) }
                .onFailure { notice.value = "Could not load earlier messages: ${it.message}" }
            loadingEarlier.value = false
        }
    }

    fun rename(sessionId: String, title: String) = write("Could not rename the chat") {
        api.rename(sessionId, title)
        workspace.value = workspace.value.let { w -> w.copy(saved = w.saved.map { if (it.sessionId == sessionId) it.copy(title = title) else it }) }
    }

    fun archive(sessionId: String) = write("Could not archive the chat") {
        api.archive(sessionId)
        workspace.value = workspace.value.let { w -> w.copy(saved = w.saved.filter { it.sessionId != sessionId }) }
    }

    fun pin(sessionId: String, on: Boolean) = write("Could not ${if (on) "pin" else "unpin"} the chat") {
        api.pin(sessionId, on)
        workspace.value = workspace.value.let { w -> w.copy(pins = if (on) w.pins + sessionId else w.pins - sessionId) }
    }

    private fun write(failure: String, block: suspend () -> Unit) {
        if (readOnly) return
        viewModelScope.launch { runCatching { block() }.onFailure { notice.value = it.message ?: failure } }
    }

    // Uploads a picked file and returns the path to mention in the prompt.
    suspend fun attach(name: String, mime: String, bytes: ByteArray): String? {
        if (readOnly) return null
        return runCatching { api.paste(name, mime, bytes) }.onFailure { notice.value = "Could not attach $name: ${it.message}" }.getOrNull()
    }

    suspend fun image(chat: String, path: String): ByteArray? = runCatching { api.image(chat, path) }.getOrNull()

    private fun post(body: String, chat: String, viewing: Boolean = false, done: ((Boolean) -> Unit)? = null) {
        if (readOnly && !viewing) { notice.value = "Read-only check, nothing was sent"; done?.invoke(true); return }
        viewModelScope.launch(Dispatchers.IO) {
            val url = "${origin.value}/api/cmd?cid=$cid&chat=${enc(chat)}"
            val err = try {
                http.newCall(Request.Builder().url(url).post(body.toRequestBody("application/json".toMediaType())).build()).execute().use { if (it.isSuccessful) null else "Server said ${it.code}" }
            } catch (e: Exception) {
                "Not connected, that did not reach the server"
            }
            if (err != null) notice.value = err
            withContext(Dispatchers.Main) { done?.invoke(err == null) }
        }
    }
}
