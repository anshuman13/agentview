package no.pradhan.agentview.nativeapp

import android.app.Application
import android.net.ConnectivityManager
import android.net.Network
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.glance.appwidget.updateAll
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.util.UUID

// Same default as the Tauri phone app (web/src/app/api.ts MAC_URL).
const val DEFAULT_ORIGIN = "http://macmini.netbird.cloud:7777"
const val WORKSPACE_MIN_AGE_MS = 30_000L
private const val CHAT_KEY = "chat"
private const val FLUSH_RETRY_MS = 15_000L

class Undoable(val text: String, val undo: (() -> Unit)?)

@OptIn(ExperimentalCoroutinesApi::class)
class Hub(internal val app: Application, private val saved: SavedStateHandle) : AndroidViewModel(app) {
    internal val prefs = app.getSharedPreferences("agentview", 0)

    internal val cid = UUID.randomUUID().toString()

    val client = sharedHttp

    private val disk = TranscriptDisk(File(app.filesDir, "transcripts"))

    val drafts = Drafts(PrefsKeyValue(prefs))

    val outbox = Outbox(PrefsKeyValue(prefs))

    private val titles = ChatTitles(PrefsKeyValue(prefs))

    internal var flushing: Job? = null

    internal var flushFailedAt = 0L

    val store: ChatStore = ChatStore(
        persist = { id, e ->
            val title = store.state.value.live.firstOrNull { it.id == id }?.title
            viewModelScope.launch(Dispatchers.IO) {
                runCatching {
                    val name = title ?: titles.get(id)
                    if (disk.save(id, name, e)) titles.set(id, name)
                }
            }
        },
        restore = { id -> disk.load(id)?.let { RecentChats.Entry(it.events, it.earlier) } },
    ).also { s -> saved.get<String>(CHAT_KEY)?.takeIf { it.isNotEmpty() }?.let { showChat(s, it) } }

    val transcript = TranscriptFeed(store.state.map { it.shownId to it.events }.distinctUntilChanged { a, b -> a.first == b.first && a.second === b.second }, viewModelScope)

    val notifier = Notifier(app)

    val models = MutableStateFlow(parseModels(prefs.getString("models", null)))

    val voiceRequest = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    val origin = MutableStateFlow(prefs.getString("origin", null) ?: DEFAULT_ORIGIN)

    internal val _connected = MutableStateFlow(false)

    val connected: StateFlow<Boolean> = _connected

    val notice = MutableStateFlow<String?>(null)

    val link = MutableStateFlow<DeepLink?>(null)

    // Review findings by target, a PR number or "local"; null clears one.
    val findings = MutableStateFlow<Map<String, ReviewFindings>>(emptyMap())

    val workspace = MutableStateFlow(Workspace())

    val loadingEarlier = MutableStateFlow(false)

    // The Codex ask bar's draft and uploads live here, so a photo that finishes after the bar left (camera, page switch) still lands in it.
    val codexDraft = saved.getStateFlow("codexDraft", "")

    fun setCodexDraft(text: String) { saved["codexDraft"] = text }

    val codexUploads = MutableStateFlow(0)

    val api = Api({ origin.value }, client)

    val codex = CodexStore(viewModelScope, api::assistantChanges, api::assistantSync, { !readOnly }, { notice.value = it })

    val notifyOn = MutableStateFlow(prefs.getBoolean("notify", true))

    val shared = MutableStateFlow<SharedItem?>(null)

    val addTask = MutableStateFlow(false)

    // A job the Runs screen asks the Codex tab to open, by row key.
    val openJob = MutableStateFlow<String?>(null)

    val undoable = MutableSharedFlow<Undoable>(extraBufferCapacity = 1)

    val navHidden = MutableStateFlow(false)

    private val foregroundNow = MutableStateFlow(false)

    var foreground: Boolean
        get() = foregroundNow.value
        set(v) { foregroundNow.value = v }

    val resolvedQuestions = MutableStateFlow(parseResolved(prefs.getString("questionsResolved", null)))

    val handled = MutableStateFlow(
        prefs.getString("handledOrder", null)?.split("\n")?.filter { it.isNotEmpty() }?.toCollection(LinkedHashSet()) ?: emptySet(),
    )

    val codexFilter = MutableStateFlow(prefs.getString("codexFilter", null) ?: "all")

    val writes = Writes(viewModelScope, { readOnly }, { notice.value = it })

    val theme = MutableStateFlow(prefs.getString("theme", null) ?: "")

    // When this phone last showed each chat, for the New line.
    fun leftAt(chat: String) = prefs.getLong("seen:$chat", 0L)

    fun leftChat(chat: String) = prefs.edit().putLong("seen:$chat", System.currentTimeMillis()).apply()

    // Set by the launch intent to check the screens without changing anything on the server beyond viewing a chat.
    var readOnly: Boolean
        get() = AppState.readOnly
        set(v) { AppState.readOnly = v }

    internal var workspaceAt = 0L

    internal val stream = EventStream(
        viewModelScope,
        url = { last ->
            val chat = store.wanted
            "${origin.value}/api/events?cid=$cid&client=phone" + (if (chat.isNotEmpty()) "&chat=${enc(chat)}" else "") + (if (last.isNotEmpty()) "&last=$last" else "")
        },
        onConnected = { up ->
            _connected.value = up
            if (up) {
                viewModelScope.launch { refreshWorkspace(force = true) }
                flushOutbox()
            }
        },
        onData = { data -> runCatching { parseMessage(data) }.onSuccess { handle(it) } },
    )

    // A switch between Wi-Fi and mobile data leaves the old stream hanging, so it is reopened at once.
    private val netWatch = object : ConnectivityManager.NetworkCallback() {
        private var last: Network? = null
        override fun onAvailable(network: Network) {
            if (last != null && last != network && (foreground || wantsStream())) stream.start()
            last = network
        }
    }

    init { app.getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(netWatch) }

    override fun onCleared() {
        runCatching { app.getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(netWatch) }
        notifier.waiting(WaitingSnapshot(), 0)
        super.onCleared()
    }

    val granted = MutableStateFlow(notifier.granted())

    val wantsPermission = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    internal val liveLoaded = MutableStateFlow(false)

    init {
        viewModelScope.launch {
            val minute = foregroundNow.flatMapLatest { up -> if (up) flow { while (true) { emit(Unit); delay(60_000) } } else emptyFlow() }.onStart { emit(Unit) }
            val needs = combine(codex.state, minute, codexFilter, handled) { s, _, filter, hidden -> needsList(s, filter.takeIf { it != "all" }, System.currentTimeMillis(), hidden).size }.distinctUntilChanged()
            combine(store.state.map { waitingSnapshot(it.live) }.distinctUntilChanged(), liveLoaded, notifyOn, needs) { snap, loaded, on, badge -> Triple(snap, loaded, if (on) badge else -1) }.collect { (snap, loaded, badge) ->
                if (!loaded) return@collect
                WaitingStore.write(app, snap)
                WaitingWidget().updateAll(app)
                if (badge >= 0) notifier.waiting(snap, badge) else notifier.waiting(WaitingSnapshot(), 0)
            }
        }
    }

    fun refreshGranted() { granted.value = notifier.granted() }

    val muted = MutableStateFlow(prefs.getStringSet("muted", null)?.toSet() ?: emptySet())

    fun wantsStream() = notifyOn.value && notifier.granted()

    // A permission notification gets Allow and Deny, a question one Reply; the kind of request is read from the chat first.
    internal fun notify(n: Notice) {
        if (n.kind != NoticeKind.Approval) return notifier.post(n)
        viewModelScope.launch { notifier.post(withContext(Dispatchers.IO) { noticeAsk(api, n) }) }
    }

    private fun handle(m: ServerMessage) {
        if (m is ServerMessage.Live && !foreground && notifyOn.value) notices(store.state.value.live, m.chats, store.state.value.shownId, muted.value).forEach(::notify)
        if (m is ServerMessage.Error) notice.value = m.text
        if (m is ServerMessage.Findings) setFindings(m.review.target, m.review)
        store.handle(m)
        store.state.value.session?.models?.takeIf { it.isNotEmpty() && it != models.value }?.let { models.value = it; prefs.edit().putString("models", encodeModels(it)).apply() }
        if (m is ServerMessage.Live) {
            liveLoaded.value = true
            if (outbox.items.value.isNotEmpty() && System.currentTimeMillis() - flushFailedAt > FLUSH_RETRY_MS) flushOutbox()
        }
    }

    private fun showChat(s: ChatStore, id: String) {
        s.show(id)
        viewModelScope.launch { s.fill(id) }
    }

    fun draft(chat: String) = drafts.get(chat)

    fun setDraft(chat: String, text: String) = drafts.set(chat, text)

    // The title a chat had when it was last saved to disk, for showing it offline.
    fun savedTitle(chat: String) = titles.get(chat)

    fun savedChats() = titles.list()

    fun cancelQueued(id: String) = outbox.cancel(id)

    internal fun flushOutbox() {
        if (readOnly || flushing?.isActive == true) return
        flushing = viewModelScope.launch {
            liveLoaded.first { it }
            val err = outbox.flush { q ->
                val running = store.state.value.let { s -> (if (s.shownId == q.chat) s.session?.running else null) ?: s.live.firstOrNull { it.id == q.chat }?.running } == true
                val body = if (running && q.steer) steerCmd(q.text, q.id) else promptCmd(q.text, running, q.id)
                send(body, q.chat)
            }
            if (err != null) { notice.value = err; flushFailedAt = System.currentTimeMillis() }
        }
    }

    // Keeps a stream that had a ping in the last 25 s when the app comes back, so it does not download everything again.
    fun connect() { if (!_connected.value || System.currentTimeMillis() - stream.lastSeen > 25_000) stream.start() }

    fun disconnect() { liveLoaded.value = false; stream.stop() }

    fun retry() = stream.start()

    fun open(id: String) {
        saved[CHAT_KEY] = id
        notifier.clear(id)
        showChat(store, id)
        markSeen(store.state.value.live.firstOrNull { it.id == id }?.sessionId)
        if (_connected.value) post(viewCmd(id), id, viewing = true)
    }

    // Opens a saved session; true once its chat is shown.
    suspend fun openSaved(sessionId: String): Boolean {
        if (readOnly) { notice.value = READ_ONLY_OPEN; return false }
        markSeen(sessionId)
        val chat = store.state.value.live.firstOrNull { it.sessionId == sessionId }
        if (chat != null) { open(chat.id); return true }
        return switchTo(openSessionCmd(sessionId)) != null
    }

    // Sends a command that makes the server show another chat and waits for that chat's init.
    internal suspend fun switchTo(body: String): String? {
        if (withTimeoutOrNull(10_000) { liveLoaded.first { it } } == null) return null
        val from = store.wanted
        store.expectSwitch()
        post(body, from)
        val s = withTimeoutOrNull(15_000) { store.state.first { s -> store.wanted != from && s.settled && s.shownId == store.wanted } }
        if (s == null) { store.cancelSwitch(); return null }
        saved[CHAT_KEY] = s.shownId
        notifier.clear(s.shownId)
        markSeen(s.session?.sessionId)
        return s.shownId
    }

    val chatSegment = MutableStateFlow(prefs.getString("chatSegment", null) ?: WORK)

    internal var asking = false

    fun close() = store.close()

    fun setFindings(target: String, review: ReviewFindings?) {
        findings.value = if (review == null) findings.value - target else findings.value + (target to review)
    }

    // Sends a prompt to the chat on screen and shows the chat (web ui/util.ts askClaude).
    fun askClaude(text: String) {
        val chat = store.wanted
        submit(text, false) { notice.value = "That did not reach the chat" }
        if (!readOnly) link.value = DeepLink(chat = chat)
    }

    // Puts a prompt in the composer of the chat on screen and shows the chat, without sending it.
    fun draftPrompt(text: String) {
        val chat = store.wanted
        setDraft(chat, appendPrompt(draft(chat), text))
        link.value = DeepLink(chat = chat)
    }

    // The chat the workspace pages act on: the one on screen, else the server's last viewed chat.
    val pageChat: String get() = store.state.value.shownId
}
