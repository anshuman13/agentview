package no.pradhan.agentview.nativeapp.net

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.chat.ACCOUNT_LABEL
import no.pradhan.agentview.nativeapp.sessions.Workspace
import no.pradhan.agentview.nativeapp.sessions.personalRoot

suspend fun Hub.refreshSettings() {
    val s = runCatching { api.settings() }.getOrNull() ?: return
    ACCOUNT_LABEL.putAll(s.accountLabels)
    personalRoot = s.personalRoot
    deploy.value = s.deploy
    providers.value = s.providers
    defaultProvider.value = s.defaultProvider
}

fun Hub.setDefaultProvider(id: String) {
    defaultProvider.value = id
    viewModelScope.launch { runCatching { api.setDefaultProvider(id) } }
}

fun Hub.setMuted(sessionId: String, on: Boolean) {
    muted.value = if (on) muted.value + sessionId else muted.value - sessionId
    prefs.edit().putStringSet("muted", muted.value).apply()
}

fun Hub.setNotify(on: Boolean) {
    notifyOn.value = on
    prefs.edit().putBoolean("notify", on).apply()
    if (on && !notifier.granted()) wantsPermission.tryEmit(Unit)
}

fun Hub.saveOrigin(value: String) {
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

fun Hub.setChatSegment(value: String) {
    chatSegment.value = value
    prefs.edit().putString("chatSegment", value).apply()
}

fun Hub.setCodexFilter(value: String) {
    codexFilter.value = value
    prefs.edit().putString("codexFilter", value).apply()
}

fun Hub.setTheme(value: String) {
    theme.value = value
    prefs.edit().putString("theme", value).apply()
}
