package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.codex.autopilot.nextRoundText
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.codex.dayLabel
import no.pradhan.agentview.nativeapp.codex.dayStart
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.LiveAgent
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.ops.Agent
import no.pradhan.agentview.nativeapp.net.SessionInfo
import no.pradhan.agentview.nativeapp.ui.agoShort
import no.pradhan.agentview.nativeapp.ui.plural

// The chat header line (web runLogic headerState), checked by shared/fixtures/chat-state.json.
data class StatusLine(val text: String, val tone: ChatTone)
enum class ChatTone { Running, Needs, Failed, Warn, Idle }

fun statusLine(live: LiveChat, session: SessionInfo?): StatusLine = when {
    live.pending > 0 -> StatusLine("Needs you", ChatTone.Needs)
    live.failed -> StatusLine("Failed", ChatTone.Failed)
    live.stalled -> StatusLine("No activity for 15 min", ChatTone.Failed)
    (session?.running ?: live.running) -> StatusLine(runningText(live), ChatTone.Running)
    live.agentList.isNotEmpty() -> StatusLine("Running · ${plural(live.agentList.size, "agent")}", ChatTone.Running)
    live.run?.state == "paused" -> StatusLine(live.run.why?.takeIf { it.isNotEmpty() }?.let { "Paused · $it" } ?: "Paused", ChatTone.Warn)
    live.run != null -> StatusLine(nextRoundText(live.run.nextAt), ChatTone.Idle)
    else -> StatusLine("Idle", ChatTone.Idle)
}

// The agents chip beside the status line (web runLogic agentChipCount): while agents run, the running count the line shows; else every agent in the chat.
fun agentChipCount(all: Int, running: Int) = if (running > 0) running else all

// The time of the last reply beside "Idle" (web brief/time.ts): under an hour "5m", today "14:20", else "3 Nov 14:20".
fun replyTime(at: Long, now: Long): String = when {
    now - at < 3_600_000 -> agoShort(at, now)
    dayStart(at) == dayStart(now) -> clock(at)
    else -> "${dayLabel(at)} ${clock(at)}"
}

// Running agents whose Agent call is not loaded yet (web AgentsPane unseen).
fun unseenAgents(running: List<LiveAgent>, agents: List<Agent>) = running.filter { r -> agents.none { it.id == r.id } }

private val LIMIT_NOTES =listOf("Compact", "Loop ", "Goal", "Usage limit", "Logged out")
private val WOKE_UP = Regex("^\\w+ woke up")

data class LimitResume(val prompt: String, val reset: Long)

// The last prompt and when its usage limit resets (shared/limitResume.ts), checked by shared/fixtures/limit-resume.json.
fun limitResume(events: List<ChatEvent>): LimitResume? {
    var prompt: String? = null
    var reset: Long? = null
    for (e in events) {
        if (e.kind == "user") { prompt = e.text; reset = null }
        else if (e.kind == "system") {
            if (WOKE_UP.containsMatchIn(e.text)) prompt = null
            else if (LIMIT_NOTES.any { e.text.startsWith(it) }) reset = e.reset
        }
    }
    return if (prompt != null && reset != null && reset != 0L) LimitResume(prompt, reset) else null
}

// What a screen reader hears when a turn ends (web composerLogic turnEnd), checked by shared/fixtures/turn-end.json.
fun turnEnd(events: List<ChatEvent>, label: String): String {
    for (e in events.asReversed()) {
        if (e.kind == "user") break
        if (e.kind == "assistant" && e.parent == null && e.text.isNotBlank()) return "$label: ${e.text}"
        if (e.kind == "result" && e.isError) return "$label stopped: ${e.text}"
    }
    return "$label finished"
}

// The line under a failed chat's transcript (web failedLine): the turnEnd text cut to its first line, null when the turn did not end in an error.
fun failedLine(events: List<ChatEvent>, label: String): String? {
    val end = turnEnd(events, label)
    val prefix = "$label stopped:"
    return if (end.startsWith(prefix)) "$prefix ${firstLine(end.removePrefix(prefix))}".trimEnd() else null
}

// What a running chat is doing: its status, or Working while it has none.
fun runningText(live: LiveChat) = live.status.takeIf { it != "Idle" }.orEmpty().ifBlank { "Working" }
