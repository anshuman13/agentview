package no.pradhan.agentview.nativeapp.app

import no.pradhan.agentview.nativeapp.net.newSessionCmd
import no.pradhan.agentview.nativeapp.net.openSessionCmd
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import no.pradhan.agentview.nativeapp.chat.voiceAnswer
import no.pradhan.agentview.nativeapp.chat.voicePrompt
import no.pradhan.agentview.nativeapp.codex.DailyChat
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.WORK
import no.pradhan.agentview.nativeapp.codex.encodeDaily
import no.pradhan.agentview.nativeapp.codex.meetings.Question
import no.pradhan.agentview.nativeapp.codex.meetings.encodeResolved
import no.pradhan.agentview.nativeapp.codex.meetings.withResolved
import no.pradhan.agentview.nativeapp.codex.openDaily
import no.pradhan.agentview.nativeapp.codex.parseDaily
import no.pradhan.agentview.nativeapp.codex.reusableDaily
import no.pradhan.agentview.nativeapp.codex.today
import no.pradhan.agentview.nativeapp.codex.Need
import no.pradhan.agentview.nativeapp.codex.withDismissal
import no.pradhan.agentview.nativeapp.sessions.segmentOf

// A dismissed DM stops waiting and a dismissed bullet is stored on its brief, so every device hides them.
fun Hub.hideNeed(n: Need): Boolean = when (n) {
    is Need.Dm -> codex.update(n.chat, mapOf("waiting" to 0))
    is Need.Slack -> codex.update(n.brief, mapOf("dismissed" to withDismissal(codex.current(n.brief).str("dismissed"), n.bullet.key, true, System.currentTimeMillis())))
    else -> false
}

fun Hub.restoreNeed(n: Need) {
    when (n) {
        is Need.Dm -> codex.update(n.chat, mapOf("waiting" to 1))
        is Need.Slack -> codex.update(n.brief, mapOf("dismissed" to withDismissal(codex.current(n.brief).str("dismissed"), n.bullet.key, false, System.currentTimeMillis())))
        else -> {}
    }
}

fun Hub.resolveQuestion(q: Question, meetings: List<Row>, now: Long) {
    val next = withResolved(resolvedQuestions.value, q, meetings, now)
    resolvedQuestions.value = next
    prefs.edit().putString("questionsResolved", encodeResolved(next)).apply()
}

// The profile a new task or question goes to when the filter shows both.
var Hub.codexProfile: String
    get() = prefs.getString("codexProfile", WORK) ?: WORK
    set(v) { prefs.edit().putString("codexProfile", v).apply() }

// Sends the question to today's Codex chat for the profile on this Mac; the first question of the day opens a new chat.
fun Hub.askCodex(question: String, profile: String) {
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
suspend fun Hub.askAnswer(question: String, profile: String): Result<String> {
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

internal suspend fun Hub.sendCodex(question: String, profile: String, match: String = ""): Pair<String, Int>? {
    val key = "codex-chat-$profile"
    val mac = origin.value
    val daily = reusableDaily(parseDaily(prefs.getString(key, null)), today(), mac)
    val live = openDaily(daily, store.state.value.live)
    val id = when {
        live != null -> showChat(live.id)
        daily?.sessionId != null -> switchTo(openSessionCmd(daily.sessionId))
        else -> switchTo(newSessionCmd(profile, provider = "claude"))
    } ?: return null
    val before = store.state.value.events.count { it.kind == "user" && it.text.startsWith(match) }
    submit(question, false) { notice.value = "The question was not sent" }
    val sessionId = store.state.value.session?.sessionId ?: live?.sessionId ?: daily?.sessionId
    prefs.edit().putString(key, encodeDaily(DailyChat(today(), mac, id, sessionId))).apply()
    if (sessionId == null) viewModelScope.launch { rememberSession(key, mac, id) }
    return id to before
}

internal suspend fun Hub.showChat(id: String): String? {
    if (store.wanted != id) open(id)
    return withTimeoutOrNull(15_000) { store.state.first { it.settled && it.shownId == id } }?.shownId
}

// A new chat gets its Claude session id after the first prompt; keep it so a closed chat can be reopened.
internal suspend fun Hub.rememberSession(key: String, mac: String, chat: String) {
    val sessionId = withTimeoutOrNull(60_000) { store.state.first { s -> s.live.any { it.id == chat && it.sessionId != null } } }?.live?.first { it.id == chat }?.sessionId ?: return
    prefs.edit().putString(key, encodeDaily(DailyChat(today(), mac, chat, sessionId))).apply()
}

// Adds shared text as an open Codex task; true once it is saved.
fun Hub.shareToTask(item: SharedItem, profile: String): Boolean {
    val t = shareTask(item.subject, item.text)
    val extra = buildMap<String, Any?> { if (t.url != null) put("source_url", t.url); put("source", "share") }
    return codex.capture(if (t.body.isNotEmpty()) "${t.title}\n${t.body}" else t.title, "open", profile, null, extra) != null
}

fun Hub.remindChat(title: String, sessionId: String, cwd: String, at: Long) {
    val extra = mapOf("source" to "chat", "source_url" to "${origin.value}/?session=$sessionId")
    if (codex.capture("Check ${title.ifBlank { "chat" }}", "open", segmentOf(cwd), at, extra) != null) notice.value = "Reminder set"
}

