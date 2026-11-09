package no.pradhan.agentview.nativeapp

import android.app.Application
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.glance.appwidget.updateAll
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.builtins.serializer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.UUID

// Same default as the Tauri phone app (web/src/app/api.ts MAC_URL).
const val DEFAULT_ORIGIN = "http://macmini.netbird.cloud:7777"
const val WORKSPACE_MIN_AGE_MS = 30_000L
private const val CHAT_KEY = "chat"
private const val FLUSH_RETRY_MS = 15_000L

class Undoable(val text: String, val undo: (() -> Unit)?)

class Hub(private val app: Application, private val saved: SavedStateHandle) : AndroidViewModel(app) {
    private val prefs = app.getSharedPreferences("agentview", 0)
    private val cid = UUID.randomUUID().toString()
    val client = OkHttpClient()
    private val disk = TranscriptDisk(File(app.filesDir, "transcripts"))
    val drafts = Drafts(PrefsKeyValue(prefs))
    val outbox = Outbox(PrefsKeyValue(prefs))
    private val titles = ChatTitles(PrefsKeyValue(prefs))
    private var flushing: Job? = null
    private var flushFailedAt = 0L
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
    ).also { s -> saved.get<String>(CHAT_KEY)?.takeIf { it.isNotEmpty() }?.let(s::show) }
    val notifier = Notifier(app)

    val models = MutableStateFlow(parseModels(prefs.getString("models", null)))
    val voiceRequest = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val origin = MutableStateFlow(prefs.getString("origin", null) ?: DEFAULT_ORIGIN)
    private val _connected = MutableStateFlow(false)
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
    @Volatile var foreground = false
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
    private var workspaceAt = 0L

    private val stream = EventStream(
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
    private val liveLoaded = MutableStateFlow(false)

    init {
        viewModelScope.launch {
            val minute = flow { while (true) { emit(Unit); delay(60_000) } }
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

    fun hideNeed(key: String) {
        if (readOnly) { notice.value = READ_ONLY_SENT; return }
        val live = codex.state.value.chats.filter { !it.deleted }.map(::waitKey).toSet()
        val all = (handled.value - key) + key
        handled.value = (all.filter { !it.startsWith("wait:") || it in live || it == key } .filter { !it.startsWith("slack:") } + all.filter { it.startsWith("slack:") }.takeLast(50)).toCollection(LinkedHashSet())
        prefs.edit().putString("handledOrder", handled.value.joinToString("\n")).apply()
    }

    val muted = MutableStateFlow(prefs.getStringSet("muted", null)?.toSet() ?: emptySet())
    fun setMuted(sessionId: String, on: Boolean) {
        muted.value = if (on) muted.value + sessionId else muted.value - sessionId
        prefs.edit().putStringSet("muted", muted.value).apply()
    }

    fun setNotify(on: Boolean) {
        notifyOn.value = on
        prefs.edit().putBoolean("notify", on).apply()
        if (on && !notifier.granted()) wantsPermission.tryEmit(Unit)
    }

    fun wantsStream() = notifyOn.value && notifier.granted()

    // A permission notification gets Allow and Deny, a question one Reply; the kind of request is read from the chat first.
    private fun notify(n: Notice) {
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

    fun draft(chat: String) = drafts.get(chat)
    fun setDraft(chat: String, text: String) = drafts.set(chat, text)

    // The title a chat had when it was last saved to disk, for showing it offline.
    fun savedTitle(chat: String) = titles.get(chat)

    fun savedChats() = titles.list()

    fun cancelQueued(id: String) = outbox.cancel(id)

    private fun flushOutbox() {
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

    fun saveOrigin(value: String) {
        val v = value.trim().trimEnd('/').let { if (it.isEmpty() || "://" in it) it else "http://$it" }
        if (v.isEmpty()) return
        prefs.edit().putString("origin", v).apply()
        origin.value = v
        liveLoaded.value = false
        store.reset()
        codex.reset()
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

    fun markRead(sessionIds: List<String>) = sessionIds.forEach(::markSeen)

    // Seen time 0, so the chat shows Done until it is opened again.
    fun markUnread(sessionId: String) {
        workspace.value = workspace.value.let { it.copy(seen = it.seen + (sessionId to 0L)) }
        if (!readOnly) viewModelScope.launch { runCatching { api.markSeen(sessionId, unread = true) } }
    }

    fun open(id: String) {
        saved[CHAT_KEY] = id
        notifier.clear(id)
        store.show(id)
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
    private suspend fun switchTo(body: String): String? {
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

    fun resolveQuestion(q: Question, meetings: List<Row>, now: Long) {
        val next = withResolved(resolvedQuestions.value, q, meetings, now)
        resolvedQuestions.value = next
        prefs.edit().putString("questionsResolved", encodeResolved(next)).apply()
    }

    val chatSegment = MutableStateFlow(prefs.getString("chatSegment", null) ?: WORK)

    fun setChatSegment(value: String) {
        chatSegment.value = value
        prefs.edit().putString("chatSegment", value).apply()
    }

    fun setCodexFilter(value: String) {
        codexFilter.value = value
        prefs.edit().putString("codexFilter", value).apply()
    }

    // The profile a new task or question goes to when the filter shows both.
    var codexProfile: String
        get() = prefs.getString("codexProfile", WORK) ?: WORK
        set(v) { prefs.edit().putString("codexProfile", v).apply() }

    private var asking = false

    // Sends the question to today's Codex chat for the profile on this Mac; the first question of the day opens a new chat.
    fun askCodex(question: String, profile: String) {
        if (readOnly) { notice.value = "Read-only check, nothing was sent"; return }
        if (asking) return
        asking = true
        viewModelScope.launch {
            try {
                val id = sendCodex(question, profile)?.first
                if (id == null) notice.value = "The Codex chat did not open, the question was not sent" else link.value = DeepLink(chat = id)
            } finally {
                asking = false
            }
        }
    }

    // The finished answer to a question put to the Codex chat, or a failure that says why there is none.
    suspend fun askAnswer(question: String, profile: String): Result<String> {
        if (readOnly) { notice.value = "Read-only check, nothing was sent"; return Result.failure(Exception("Read-only check, nothing was sent")) }
        if (asking) return Result.failure(Exception("A Codex question is already running"))
        asking = true
        try {
            val (id, before) = sendCodex(voicePrompt(question, store.state.value.live), profile, question) ?: return Result.failure(Exception("The Codex chat did not open"))
            return withTimeoutOrNull(120_000) {
                store.state.mapNotNull { s ->
                    if (s.shownId != id) return@mapNotNull Result.failure<String>(Exception("The answer is in the Codex chat"))
                    val chat = s.live.firstOrNull { it.id == id }
                    voiceAnswer(s.events, question, before, busy = chat != null && (chat.running || chat.pending > 0))?.let { Result.success(it) }
                }.first()
            } ?: Result.failure(Exception("No answer yet, it may be in the Codex chat"))
        } finally {
            asking = false
        }
    }

    private suspend fun sendCodex(question: String, profile: String, match: String = ""): Pair<String, Int>? {
        val key = "codex-chat-$profile"
        val mac = origin.value
        val daily = reusableDaily(parseDaily(prefs.getString(key, null)), today(), mac)
        val live = openDaily(daily, store.state.value.live)
        val id = when {
            live != null -> showChat(live.id)
            daily?.sessionId != null -> switchTo(openSessionCmd(daily.sessionId))
            else -> switchTo(newSessionCmd(profile))
        } ?: return null
        val before = store.state.value.events.count { it.kind == "user" && it.text.startsWith(match) }
        submit(question, false) { notice.value = "The question was not sent" }
        val sessionId = store.state.value.session?.sessionId ?: live?.sessionId ?: daily?.sessionId
        prefs.edit().putString(key, encodeDaily(DailyChat(today(), mac, id, sessionId))).apply()
        if (sessionId == null) viewModelScope.launch { rememberSession(key, mac, id) }
        return id to before
    }

    private suspend fun showChat(id: String): String? {
        if (store.wanted != id) open(id)
        return withTimeoutOrNull(15_000) { store.state.first { it.settled && it.shownId == id } }?.shownId
    }

    // A new chat gets its Claude session id after the first prompt; keep it so a closed chat can be reopened.
    private suspend fun rememberSession(key: String, mac: String, chat: String) {
        val sessionId = withTimeoutOrNull(60_000) { store.state.first { s -> s.live.any { it.id == chat && it.sessionId != null } } }?.live?.first { it.id == chat }?.sessionId ?: return
        prefs.edit().putString(key, encodeDaily(DailyChat(today(), mac, chat, sessionId))).apply()
    }

    var lastModel: String?
        get() = prefs.getString("lastModel", null)
        set(v) { prefs.edit().putString("lastModel", v).apply() }

    fun newChat(cwd: String? = null, model: String? = null, fork: String? = null, mode: String? = null) {
        if (readOnly) { notice.value = READ_ONLY_SENT; return }
        if (model != null) lastModel = model
        viewModelScope.launch {
            val id = switchTo(newSessionCmd(cwd = cwd, model = model ?: lastModel?.takeIf { fork == null }, fork = fork))
            if (id == null) notice.value = "The chat did not open" else {
                if (mode != null) post(setModeCmd(mode), id)
                link.value = DeepLink(chat = id)
            }
        }
    }

    private suspend fun attachUri(uri: String): String? {
        val r = app.contentResolver
        val mime = r.getType(Uri.parse(uri)) ?: "image/jpeg"
        val bytes = withContext(Dispatchers.IO) { runCatching { r.openInputStream(Uri.parse(uri))?.use { it.readBytes() } }.getOrNull() } ?: return null
        return attach("shared.${mime.substringAfter('/', "jpg").substringBefore('+')}", mime, bytes)
    }

    // Sends shared text and images to a chat and shows the chat.
    fun shareToChat(chat: String, item: SharedItem) {
        if (readOnly) { notice.value = READ_ONLY_SENT; return }
        viewModelScope.launch {
            open(chat)
            val paths = item.images.mapNotNull { attachUri(it) }
            val text = (listOf(shareChatText(item.subject, item.text)) + paths.map { "[Image: $it]" }).filter { it.isNotEmpty() }.joinToString("\n")
            submit(text, false) { notice.value = "That did not reach the chat" }
            link.value = DeepLink(chat = chat)
        }
    }

    // Adds shared text as an open Codex task; true once it is saved.
    fun shareToTask(item: SharedItem, profile: String): Boolean {
        val t = shareTask(item.subject, item.text)
        val extra = buildMap<String, Any?> { if (t.url != null) put("source_url", t.url); put("source", "share") }
        return codex.capture(if (t.body.isNotEmpty()) "${t.title}\n${t.body}" else t.title, "open", profile, null, extra) != null
    }

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

    fun setTheme(value: String) {
        theme.value = value
        prefs.edit().putString("theme", value).apply()
    }

    // The chat the workspace pages act on: the one on screen, else the server's last viewed chat.
    val pageChat: String get() = store.state.value.shownId

    suspend fun read(path: String): String = api.get(path, pageChat)

    fun write(path: String, body: String, failure: String, done: (Boolean) -> Unit = {}) = write(path, body, failure, {}) { done(it != null) }

    fun saveFile(path: String, content: String, done: (Boolean) -> Unit) = writes.run("Could not save ${path.substringAfterLast('/')}", { api.put("/api/file?path=${enc(path)}", content, pageChat) }, done)

    // A guarded write whose response is parsed and handed to `done`, or null when it did not go through.
    fun <T> write(path: String, body: String, failure: String, parse: (String) -> T, done: (T?) -> Unit) {
        var out: T? = null
        writes.run(failure, { out = parse(api.post(path, body, pageChat)) }) { done(if (it) out else null) }
    }

    fun readWithRoomMic(m: Row, done: (Boolean) -> Unit) {
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

    fun command(body: String) = post(body, store.wanted)

    // A command a page sends on its own, skipped without a notice in a read-only check.
    fun quietCommand(body: String) { if (!readOnly) post(body, store.wanted) }

    fun closeChat(id: String) = post(closeCmd(id), id)

    fun resume(chat: String) = post(promptCmd("continue", false, UUID.randomUUID().toString()), chat)

    // A message while Claude runs queues for its next step, or with `steer` stops it and sends now.
    fun submit(text: String, steer: Boolean, onLost: () -> Unit) {
        val t = text.trim()
        if (t.isEmpty()) return
        val chat = store.wanted
        val running = store.state.value.let { s -> s.session?.running ?: s.live.firstOrNull { it.id == chat }?.running } == true
        val id = UUID.randomUUID().toString()
        if (!readOnly && (!_connected.value || outbox.items.value.isNotEmpty())) {
            if (!outbox.add(Queued(id, chat, t, steer, System.currentTimeMillis()))) { notice.value = "Too many unsent messages"; onLost() }
            else if (_connected.value) flushOutbox()
            return
        }
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
    fun runControl(run: ChatRun, op: String) {
        post(runCmd(run.id, op), store.wanted)
        if (op == "stop" && !readOnly) undoable.tryEmit(Undoable(stoppedText(run), if (run.kind == "cycle" || run.kind == "tries") null else ({ post(runCmd(run.id, "restore"), store.wanted) })))
    }
    fun triesKeep(run: ChatRun, n: Int) = post(triesKeepCmd(run.id, n), store.wanted)
    fun answer(id: String, answers: Map<String, String>) = post(answerCmd(id, answers), store.wanted)
    fun permission(id: String, allow: Boolean, always: Boolean = false) = post(permissionCmd(id, allow, always), store.wanted)
    fun allowBlocked(id: String) = post(allowBlockedCmd(id), store.wanted)
    fun sendNow(id: String) = post(sendNowCmd(id), store.wanted)
    fun remindChat(title: String, sessionId: String, cwd: String, at: Long) {
        val extra = mapOf("source" to "chat", "source_url" to "${origin.value}/?session=$sessionId")
        if (codex.capture("Check ${title.ifBlank { "chat" }}", "open", segmentOf(cwd), at, extra) != null) notice.value = "Reminder set"
    }
    // Types the command into the chat's last terminal, or a new one, and opens the Terminal page.
    fun runInTerminal(cmd: String): Boolean {
        if (!writes.allowed()) return false
        write("Terminal unavailable") { typeInTerminal(cmd) }
        return true
    }
    private suspend fun typeInTerminal(cmd: String) {
        val chat = pageChat
        val id = parseTerms(api.get("/api/terms", chat)).lastOrNull()?.id ?: protocolJson.decodeFromString<TermTab>(api.post("/api/terms", "", chat)).id
        client.newWebSocket(Request.Builder().url("${wsOrigin(origin.value)}/ws?term=${enc(id)}").build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { webSocket.send(termInput("$cmd\r")); webSocket.close(1000, null) }
        })
        link.value = DeepLink(page = "terminal")
    }
    fun rewind(id: String) = post(rewindCmd(id), store.wanted)
    fun stopTask(toolUseId: String) = post(stopTaskCmd(toolUseId), store.wanted)
    fun setModel(model: String) { if (model != "team") lastModel = model; post(setModelCmd(model), store.wanted) }
    fun setEffort(effort: String) = post(setEffortCmd(effort), store.wanted)
    fun setAccount(account: String) = post(setAccountCmd(account), store.wanted)
    fun refreshUsage() = post(usageCmd(), store.wanted)
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

    fun rename(sessionId: String, title: String) = write("Could not rename the chat. The old title is kept.") {
        api.rename(sessionId, title)
        workspace.value = workspace.value.let { w -> w.copy(saved = w.saved.map { if (it.sessionId == sessionId) it.copy(title = title) else it }) }
    }

    fun archive(sessionId: String) = write("Could not archive the chat. It is still in the list.") {
        api.archive(sessionId)
        workspace.value = workspace.value.let { w -> w.copy(saved = w.saved.filter { it.sessionId != sessionId }) }
    }

    fun pin(sessionId: String, on: Boolean) = write("Could not ${if (on) "pin" else "unpin"} the chat. Try again.") {
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

    private suspend fun send(body: String, chat: String): String? = withContext(Dispatchers.IO) {
        val url = "${origin.value}/api/cmd?cid=$cid&client=phone&chat=${enc(chat)}"
        try {
            client.newCall(Request.Builder().url(url).post(body.toRequestBody("application/json".toMediaType())).build()).execute().use { if (it.isSuccessful) null else "Server said ${it.code}" }
        } catch (e: Exception) {
            "Not connected, that did not reach the server"
        }
    }

    private fun post(body: String, chat: String, viewing: Boolean = false, done: ((Boolean) -> Unit)? = null) {
        if (readOnly && !viewing) { notice.value = READ_ONLY_SENT; done?.invoke(true); return }
        viewModelScope.launch {
            val err = send(body, chat)
            if (err != null) notice.value = err
            done?.invoke(err == null)
        }
    }
}
