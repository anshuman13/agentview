package no.pradhan.agentview.nativeapp.net

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import no.pradhan.agentview.nativeapp.sessions.Workspace

fun Hub.refreshWorkspace(force: Boolean = false) {
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

fun Hub.refreshMcpGroups() {
    viewModelScope.launch {
        runCatching { protocolJson.decodeFromString(MapSerializer(String.serializer(), String.serializer()), read("/api/mcp/groups")) }.onSuccess { mcpGroups.value = it }
    }
}

internal fun Hub.markSeen(sessionId: String?) {
    if (sessionId == null) return
    workspace.value = workspace.value.let { it.copy(seen = it.seen + (sessionId to System.currentTimeMillis())) }
    if (!readOnly) viewModelScope.launch { runCatching { api.markSeen(sessionId) } }
}

fun Hub.markRead(sessionIds: List<String>) = sessionIds.forEach(::markSeen)

// Seen time 0, so the chat shows Done until it is opened again.
fun Hub.markUnread(sessionId: String) {
    workspace.value = workspace.value.let { it.copy(seen = it.seen + (sessionId to 0L)) }
    if (!readOnly) viewModelScope.launch { runCatching { api.markSeen(sessionId, unread = true) } }
}

fun Hub.loadEarlier() {
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

fun Hub.rename(sessionId: String, title: String) = write("Could not rename the chat. The old title is kept.") {
    api.rename(sessionId, title)
    workspace.value = workspace.value.let { w -> w.copy(saved = w.saved.map { if (it.sessionId == sessionId) it.copy(title = title) else it }) }
}

fun Hub.archive(sessionId: String) = write("Could not archive the chat. It is still in the list.") {
    api.archive(sessionId)
    workspace.value = workspace.value.let { w -> w.copy(saved = w.saved.filter { it.sessionId != sessionId }) }
}

fun Hub.pin(sessionId: String, on: Boolean) = write("Could not ${if (on) "pin" else "unpin"} the chat. Try again.") {
    api.pin(sessionId, on)
    workspace.value = workspace.value.let { w -> w.copy(pins = if (on) w.pins + sessionId else w.pins - sessionId) }
}
