package no.pradhan.agentview.nativeapp.net

import android.app.Application
import android.net.ConnectivityManager
import android.net.Network
import androidx.glance.appwidget.updateAll
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import no.pradhan.agentview.nativeapp.WaitingStore
import no.pradhan.agentview.nativeapp.WaitingWidget
import no.pradhan.agentview.nativeapp.app.AppState
import no.pradhan.agentview.nativeapp.app.DeepLink
import no.pradhan.agentview.nativeapp.app.Notice
import no.pradhan.agentview.nativeapp.app.NoticeKind
import no.pradhan.agentview.nativeapp.app.Notifier
import no.pradhan.agentview.nativeapp.app.SharedItem
import no.pradhan.agentview.nativeapp.app.RunningNote
import no.pradhan.agentview.nativeapp.app.AppCounts
import no.pradhan.agentview.nativeapp.app.WaitingSnapshot
import no.pradhan.agentview.nativeapp.app.appCounts
import no.pradhan.agentview.nativeapp.app.countChat
import no.pradhan.agentview.nativeapp.app.noticeAsk
import no.pradhan.agentview.nativeapp.app.notices
import no.pradhan.agentview.nativeapp.app.runningNotes
import no.pradhan.agentview.nativeapp.app.waitingSnapshot
import no.pradhan.agentview.nativeapp.chat.ChatStore
import no.pradhan.agentview.nativeapp.chat.RecentChats
import no.pradhan.agentview.nativeapp.chat.TranscriptFeed
import no.pradhan.agentview.nativeapp.chat.encodeModels
import no.pradhan.agentview.nativeapp.chat.modelGroup
import no.pradhan.agentview.nativeapp.chat.modelsKey
import no.pradhan.agentview.nativeapp.chat.parseModels
import no.pradhan.agentview.nativeapp.codex.CodexStore
import no.pradhan.agentview.nativeapp.codex.WORK
import no.pradhan.agentview.nativeapp.codex.meetings.parseResolved
import no.pradhan.agentview.nativeapp.codex.autopilot.GoalPreset
import no.pradhan.agentview.nativeapp.codex.autopilot.GoalSheet
import no.pradhan.agentview.nativeapp.codex.autopilot.encodePresets
import no.pradhan.agentview.nativeapp.codex.autopilot.parsePresets
import no.pradhan.agentview.nativeapp.codex.needsView
import no.pradhan.agentview.nativeapp.ops.Findings
import no.pradhan.agentview.nativeapp.ops.ReviewFindings
import no.pradhan.agentview.nativeapp.sessions.Workspace
import no.pradhan.agentview.nativeapp.sessions.advisorOf
import no.pradhan.agentview.nativeapp.sessions.state
import no.pradhan.agentview.nativeapp.workspace.appendPrompt

const val DEFAULT_ORIGIN = "http://localhost:7777"
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

    val codexModels = MutableStateFlow(parseModels(prefs.getString("models:codex", null)))

    val voiceRequest = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    val fileChanged = MutableSharedFlow<String>(extraBufferCapacity = 8)

    // The integrations the server's settings file turns on (shared/protocol.ts PublicSettings).
    val deploy = MutableStateFlow(false)

    val providers = MutableStateFlow<List<ProviderOption>>(emptyList())

    val defaultProvider = MutableStateFlow("claude")

    val featureUse = MutableStateFlow(false)

    val hiddenFeatures = MutableStateFlow<List<String>>(emptyList())

    val origin = MutableStateFlow(prefs.getString("origin", null) ?: DEFAULT_ORIGIN)

    internal val _connected = MutableStateFlow(false)

    val connected: StateFlow<Boolean> = _connected

    val notice = MutableStateFlow<String?>(null)

    val link = MutableStateFlow<DeepLink?>(null)
    val sketchSlug = MutableStateFlow<String?>(null)
    val specSlug = MutableStateFlow<String?>(null)

    // Review findings by target, a PR number or "local"; null clears one.
    val findings = MutableStateFlow<Map<String, ReviewFindings>>(emptyMap())

    val workspace = MutableStateFlow(Workspace())

    // The services hidden on the MCP page (/api/mcp/groups); the counts leave them out.
    val mcpGroups = MutableStateFlow<Map<String, String>>(emptyMap())

    // Every badge number (app/CountsLogic.kt), from the chats, the MCP servers and the Codex row totals.
    val counts = MutableStateFlow(AppCounts())

    val loadingEarlier = MutableStateFlow(false)

    // The Codex ask bar's draft and uploads live here, so a photo that finishes after the bar left (camera, page switch) still lands in it.
    val codexDraft = saved.getStateFlow("codexDraft", "")

    fun setCodexDraft(text: String) { saved["codexDraft"] = text }

    val codexUploads = MutableStateFlow(0)

    val api = Api({ origin.value }, client)

    val codex = CodexStore(viewModelScope, api::assistantChanges, api::assistantSync, { !readOnly }, { notice.value = it }, cache = File(app.filesDir, "codex-rows.json"))

    init { viewModelScope.launch { codex.restore() } }

    val notifyOn = MutableStateFlow(prefs.getBoolean("notify", true))

    val shared = MutableStateFlow<SharedItem?>(null)

    val addTask = MutableStateFlow(false)

    // A job the Runs screen asks the Codex tab to open, by row key.
    val openJob = MutableStateFlow<String?>(null)

    val undoable = MutableSharedFlow<Undoable>(extraBufferCapacity = 1)

    val navHidden = MutableStateFlow(false)
    val composing = MutableStateFlow(false)
    val showTurn = MutableStateFlow<String?>(null)

    val goalSheet = MutableStateFlow<GoalSheet?>(null)

    init { viewModelScope.launch { goalSheet.filterNotNull().collect { track("sheet:goal") } } }

    private val foregroundNow = MutableStateFlow(false)

    var foreground: Boolean
        get() = foregroundNow.value
        set(v) { foregroundNow.value = v }

    val resolvedQuestions = MutableStateFlow(parseResolved(prefs.getString("questionsResolved", null)))

    val goalPresets = MutableStateFlow(parsePresets(prefs.getString("goalPresets", null)))

    fun saveGoalPresets(list: List<GoalPreset>) {
        goalPresets.value = list
        prefs.edit().putString("goalPresets", encodePresets(list)).apply()
    }

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
                viewModelScope.launch { refreshSettings() }
                viewModelScope.launch { refreshWorkspace(force = true) }
                refreshMcpGroups()
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
        notifier.running(emptyList())
        super.onCleared()
    }

    val granted = MutableStateFlow(notifier.granted())

    val wantsPermission = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    internal val liveLoaded = MutableStateFlow(false)

    init {
        viewModelScope.launch(Dispatchers.Default) {
            val minute = foregroundNow.flatMapLatest { up -> if (up) flow { while (true) { emit(Unit); delay(60_000) } } else emptyFlow() }.onStart { emit(Unit) }
            val rows = combine(codex.state, minute, codexFilter) { s, _, filter -> needsView(s, filter.takeIf { it != "all" }, System.currentTimeMillis()).let { it.list.size to it.queue.size } }.distinctUntilChanged()
            val needs = rows.map { it.first }.distinctUntilChanged()
            launch {
                val chats = store.state.map { Triple(it.live, it.shownId, it.session?.mcp.orEmpty()) }.distinctUntilChanged()
                combine(chats, workspace.map { it.seen }.distinctUntilChanged(), mcpGroups, rows) { (live, shownId, mcp), seen, groups, (needsRows, replyRows) ->
                    appCounts(live.map { countChat(it, seen) }, shownId, 0, mcp, groups, needsRows, replyRows)
                }.collect { counts.value = it }
            }
            combine(store.state.map { waitingSnapshot(it.live) }.distinctUntilChanged(), liveLoaded, notifyOn, needs) { snap, loaded, on, badge -> Triple(snap, loaded, if (on) badge else -1) }.collect { (snap, loaded, badge) ->
                if (!loaded) return@collect
                WaitingStore.write(app, snap)
                WaitingWidget().updateAll(app)
                if (badge >= 0) notifier.waiting(snap, badge) else notifier.waiting(WaitingSnapshot(), 0)
            }
        }
    }

    init {
        viewModelScope.launch(Dispatchers.Default) {
            var since = emptyMap<String, Long>()
            var shown = emptyList<RunningNote>()
            combine(store.state.map { it.live }.distinctUntilChanged(), liveLoaded, notifyOn, granted) { live, loaded, on, ok -> if (loaded && on && ok) live else null }.collectLatest { live ->
                val notes = if (live == null) emptyList() else runningNotes(live, since, System.currentTimeMillis())
                since = notes.associate { it.chatId to it.since }
                if (notes == shown) return@collectLatest
                notifier.running(notes.map { if (it.pending) it.withPermission() else it })
                shown = notes
            }
        }
    }

    private suspend fun RunningNote.withPermission(): RunningNote {
        val ask = withContext(Dispatchers.IO) { noticeAsk(api, Notice(NoticeKind.Approval, chatId, title, text)) }
        return copy(permissionId = ask.permissionId)
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
        if (m is ServerMessage.Approval && !foreground && notifyOn.value) notifier.post(Notice(NoticeKind.Approval, m.chat, m.title, "Spec waiting for your approval", slug = m.slug))
        if (m is ServerMessage.Error) notice.value = m.text
        if (m is ServerMessage.Findings) setFindings(m.review.target, m.review)
        if (m is ServerMessage.FileChanged) fileChanged.tryEmit(m.path)
        store.handle(m)
        store.state.value.session?.let { s ->
            val group = modelGroup(s.provider)
            val list = modelsOf(group)
            s.models.takeIf { it.isNotEmpty() && it != list.value }?.let { list.value = it; prefs.edit().putString(modelsKey(group), encodeModels(it)).apply() }
        }
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
        specSlug.value = null
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

    suspend fun openAdvisor(id: String, fresh: Boolean): Boolean {
        val chat = if (fresh) null else store.state.value.live.firstOrNull { advisorOf(it.cwd)?.id == id }
        if (chat != null) { open(chat.id); return true }
        if (readOnly) { notice.value = READ_ONLY_OPEN; return false }
        return switchTo(openAdvisorCmd(id, fresh)) != null
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
    val showWork = MutableStateFlow(prefs.getBoolean("showWork", false))

    internal var asking = false

    fun close() = store.close()

    fun setFindings(target: String, review: ReviewFindings?) {
        findings.value = if (review == null) findings.value - target else findings.value + (target to review)
    }

    // Sends a prompt to the chat on screen and shows the chat (web ui/util.ts askChat).
    fun askChat(text: String) {
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
