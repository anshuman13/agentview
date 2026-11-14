package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.codex.autopilot.nextRoundText
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.SessionInfo

// The chat header line (web runLogic headerState), checked by shared/fixtures/chat-state.json.
data class StatusLine(val text: String, val tone: ChatTone)
enum class ChatTone { Running, Needs, Failed, Warn, Idle }

fun statusLine(live: LiveChat, session: SessionInfo?): StatusLine = when {
    live.pending > 0 -> StatusLine("Needs you", ChatTone.Needs)
    live.failed -> StatusLine("Failed", ChatTone.Failed)
    live.stalled -> StatusLine("No activity for 15 min", ChatTone.Failed)
    (session?.running ?: live.running) -> StatusLine(runningText(live), ChatTone.Running)
    live.agentList.isNotEmpty() -> StatusLine("Running · ${live.agentList.size} ${if (live.agentList.size == 1) "agent" else "agents"}", ChatTone.Running)
    live.run?.state == "paused" -> StatusLine(live.run.why?.takeIf { it.isNotEmpty() }?.let { "Paused · $it" } ?: "Paused", ChatTone.Warn)
    live.run != null -> StatusLine(nextRoundText(live.run.nextAt), ChatTone.Idle)
    else -> StatusLine("Idle", ChatTone.Idle)
}

// What a running chat is doing: its status, or Working while it has none.
fun runningText(live: LiveChat) = live.status.takeIf { it != "Idle" }.orEmpty().ifBlank { "Working" }
