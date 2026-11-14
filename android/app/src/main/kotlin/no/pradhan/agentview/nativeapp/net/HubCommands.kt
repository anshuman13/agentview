package no.pradhan.agentview.nativeapp.net

import androidx.lifecycle.viewModelScope
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import no.pradhan.agentview.nativeapp.app.DeepLink
import no.pradhan.agentview.nativeapp.chat.handoffText
import no.pradhan.agentview.nativeapp.chat.lastModelKey
import no.pradhan.agentview.nativeapp.chat.modelGroup
import no.pradhan.agentview.nativeapp.codex.autopilot.stoppedText
import no.pradhan.agentview.nativeapp.workspace.TermTab
import no.pradhan.agentview.nativeapp.workspace.parseTerms
import no.pradhan.agentview.nativeapp.workspace.termInput
import no.pradhan.agentview.nativeapp.workspace.wsOrigin
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

fun Hub.modelsOf(group: String) = if (group == "codex") codexModels else models

fun Hub.lastModel(group: String) = prefs.getString(lastModelKey(group), null)

fun Hub.setLastModel(group: String, model: String) { prefs.edit().putString(lastModelKey(group), model).apply() }

// A model is sent only when the provider's own list has it, so a Codex id never reaches a Claude chat or the reverse.
fun Hub.newChat(cwd: String? = null, model: String? = null, fork: String? = null, mode: String? = null, draft: String? = null, provider: String? = null, text: String? = null, onOpened: () -> Unit = {}) {
    if (readOnly) { notice.value = READ_ONLY_SENT; return }
    val group = modelGroup(provider ?: defaultProvider.value)
    if (model != null) setLastModel(group, model)
    val sent = (model ?: lastModel(group).takeIf { fork == null })?.takeIf { m -> modelsOf(group).value.any { it.value == m } }
    viewModelScope.launch {
        val id = switchTo(newSessionCmd(cwd = cwd, model = sent, fork = fork, provider = provider, text = text))
        if (id == null) notice.value = "The chat did not open" else {
            onOpened()
            if (mode != null) post(setModeCmd(mode), id)
            if (draft != null) setDraft(id, draft)
            link.value = DeepLink(chat = id)
        }
    }
}

// Fork chat: a new chat in the same folder and model that starts by summarising this one.
fun Hub.forkChat(cwd: String?, sessionId: String, model: String?, provider: String?) {
    if (readOnly) { notice.value = READ_ONLY_SENT; return }
    viewModelScope.launch {
        val id = switchTo(newSessionCmd(cwd = cwd, model = model, provider = provider))
        if (id == null) notice.value = "The chat did not open" else {
            submit(handoffText(sessionId), false) { notice.value = "The summary was not requested. Try Fork chat again." }
            link.value = DeepLink(chat = id)
        }
    }
}

fun Hub.command(body: String) = post(body, store.wanted)

// A command a page sends on its own, skipped without a notice in a read-only check.
fun Hub.quietCommand(body: String) { if (!readOnly) post(body, store.wanted) }

fun Hub.closeChat(id: String) = post(closeCmd(id), id)

fun Hub.resume(chat: String) = post(promptCmd("continue", false, UUID.randomUUID().toString()), chat)

// A message while Claude runs queues for its next step, or with `steer` stops it and sends now.
fun Hub.submit(text: String, steer: Boolean, onLost: () -> Unit) {
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

fun Hub.interrupt() = post(interruptCmd(), store.wanted)

fun Hub.runControl(run: ChatRun, op: String) {
    post(runCmd(run.id, op), store.wanted)
    val running = store.state.value.live.firstOrNull { it.id == run.chatId }?.running == true
    if (op == "stop" && !readOnly) undoable.tryEmit(Undoable(stoppedText(run, running), if (run.kind == "cycle" || run.kind == "tries") null else ({ post(runCmd(run.id, "restore"), store.wanted) })))
}

fun Hub.runEdit(run: ChatRun, edit: Map<String, Long?>) = post(runEditCmd(run.id, edit), store.wanted)

fun Hub.triesKeep(run: ChatRun, n: Int) = post(triesKeepCmd(run.id, n), store.wanted)

fun Hub.answer(id: String, answers: Map<String, String>) = post(answerCmd(id, answers), store.wanted)

fun Hub.permission(id: String, allow: Boolean, always: Boolean = false) = post(permissionCmd(id, allow, always), store.wanted)

fun Hub.allowBlocked(id: String) = post(allowBlockedCmd(id), store.wanted)

fun Hub.runHook(name: String) = post(runHookCmd(name), store.wanted)

fun Hub.sendNow(id: String) = post(sendNowCmd(id), store.wanted)

// Types the command into the chat's last terminal, or a new one, and opens the Terminal page.
fun Hub.runInTerminal(cmd: String): Boolean {
    if (!writes.allowed()) return false
    write("Terminal unavailable") { typeInTerminal(cmd) }
    return true
}

internal suspend fun Hub.typeInTerminal(cmd: String) {
    val chat = pageChat
    val id = parseTerms(api.get("/api/terms", chat)).lastOrNull()?.id ?: protocolJson.decodeFromString<TermTab>(api.post("/api/terms", "", chat)).id
    client.newWebSocket(Request.Builder().url("${wsOrigin(origin.value)}/ws?term=${enc(id)}").build(), object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) { webSocket.send(termInput("$cmd\r")); webSocket.close(1000, null) }
    })
    link.value = DeepLink(page = "terminal")
}

fun Hub.rewind(id: String) = post(rewindCmd(id), store.wanted)

fun Hub.stopTask(toolUseId: String) = post(stopTaskCmd(toolUseId), store.wanted)

fun Hub.setModel(model: String) { setLastModel(modelGroup(store.state.value.session?.provider), model); post(setModelCmd(model), store.wanted) }

fun Hub.setEffort(effort: String) = post(setEffortCmd(effort), store.wanted)

fun Hub.setAccount(account: String) = post(setAccountCmd(account), store.wanted)

fun Hub.refreshUsage() = post(usageCmd(), store.wanted)

fun Hub.setMode(mode: String) = post(setModeCmd(mode), store.wanted)

fun Hub.setReview(on: Boolean) = post(setReviewCmd(on), store.wanted)

fun Hub.setLoop(on: Boolean, max: Int? = null) = post(setLoopCmd(on, max), store.wanted)

fun Hub.review(id: String, action: String, file: String? = null, hunk: Int? = null) = post(reviewCmd(id, action, file, hunk), store.wanted)

internal suspend fun Hub.send(body: String, chat: String): String? = withContext(Dispatchers.IO) {
    val url = "${origin.value}/api/cmd?cid=$cid&client=phone&chat=${enc(chat)}"
    try {
        client.newCall(Request.Builder().url(url).post(body.toRequestBody("application/json".toMediaType())).build()).execute().use { if (it.isSuccessful) null else "Server said ${it.code}" }
    } catch (e: Exception) {
        "Not connected, that did not reach the server"
    }
}

internal fun Hub.post(body: String, chat: String, viewing: Boolean = false, done: ((Boolean) -> Unit)? = null) {
    if (readOnly && !viewing) { notice.value = READ_ONLY_SENT; done?.invoke(true); return }
    viewModelScope.launch {
        val err = send(body, chat)
        if (err != null) notice.value = err
        done?.invoke(err == null)
    }
}
