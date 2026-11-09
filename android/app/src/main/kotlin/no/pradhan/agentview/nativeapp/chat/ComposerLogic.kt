package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.codex.Week
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.codex.meetings.Repeats
import no.pradhan.agentview.nativeapp.net.CommandInfo
import no.pradhan.agentview.nativeapp.net.PlanUsage
import no.pradhan.agentview.nativeapp.net.SessionInfo

// web/src/chat/composerLogic.ts and ChatSettings.tsx, the parts the phone composer uses.

const val MAX_ROWS = 8
const val COMPACT_AT = 200_000

val PERMISSION_MODES = listOf("default", "acceptEdits", "plan", "auto", "dontAsk")
val EFFORT_LEVELS = listOf("low", "medium", "high", "xhigh", "max")
val ACCOUNT_LABEL = mapOf("main" to "Personal", "alt" to "Work", "alt2" to "Work Enterprise")
val ACCOUNT_NOTE = mapOf("alt2" to "Documents only, not for coding")
// The plan usage of the chat's account, as "Week 45% · 5-hour 12%".
fun usageText(u: PlanUsage?) = listOfNotNull(u?.week?.let { "Week ${it.pct.toInt()}%" }, u?.fiveHour?.let { "5-hour ${it.pct.toInt()}%" }).joinToString(" · ")

fun usageHigh(u: PlanUsage?) = maxOf(u?.week?.pct ?: 0.0, u?.fiveHour?.pct ?: 0.0) >= 80

val EFFORT_LABEL = mapOf("low" to "Low", "medium" to "Medium", "high" to "High", "xhigh" to "Extra high", "max" to "Max")

class ModeInfo(val label: String, val detail: String)

val MODES = mapOf(
    "default" to ModeInfo("Default", "Ask before edits and risky commands"),
    "acceptEdits" to ModeInfo("Accept edits", "Edit files without asking, ask for the rest"),
    "plan" to ModeInfo("Plan", "Read and plan, no edits"),
    "auto" to ModeInfo("Auto", "Claude runs what is safe and asks only for risky actions"),
    "dontAsk" to ModeInfo("Don't ask", "Deny anything not pre-approved"),
)

val MODE_HINTS = mapOf(
    "auto" to "Auto mode asks only for risky actions",
    "default" to "Default mode asks before edits and commands",
    "acceptEdits" to "Accept edits mode asks before commands, not file edits",
    "plan" to "Plan mode asks before it starts building",
)

class Suggestion(val label: String, val detail: String, val insert: String)

data class Trigger(val start: Int, val query: String, val file: Boolean = false)

// The `/command` the caret is in, or null.
fun commandTrigger(text: String, caret: Int): Trigger? {
    val before = text.substring(0, minOf(caret, text.length))
    val m = Regex("(?:^|\\s)([/@])(\\S*)$").find(before) ?: return null
    val query = m.groupValues[2]
    return Trigger(before.length - 1 - query.length, query, m.groupValues[1] == "@")
}

// Higher is better; null when the query is not in the name. A match at the start beats one inside, which beats scattered letters.
fun matchScore(name: String, query: String): Double? {
    val needle = query.lowercase().filter { !it.isWhitespace() }
    if (needle.isEmpty()) return 0.0
    val lower = name.lowercase()
    val len = name.length / 100.0
    val at = lower.indexOf(needle)
    if (at == 0) return 1100 - len
    if (at > 0) return 1000 - len
    var i = 0
    var gaps = 0
    var last = -1
    for (c in needle) {
        i = lower.indexOf(c, i)
        if (i < 0) return null
        if (last >= 0 && i != last + 1) gaps++
        last = i
        i++
    }
    return 600 - gaps - len
}

fun rankCommands(commands: List<CommandInfo>, query: String, limit: Int = MAX_ROWS): List<CommandInfo> =
    commands.mapNotNull { c -> matchScore(c.name, query)?.let { c to it } }.sortedByDescending { it.second }.take(limit).map { it.first }

fun rankFiles(files: List<String>, query: String, limit: Int = MAX_ROWS): List<String> =
    files.mapNotNull { f -> matchScore(f, query)?.let { f to it } }.sortedByDescending { it.second }.take(limit).map { it.first }

fun acceptSuggestion(text: String, start: Int, caret: Int, insert: String): Pair<String, Int> =
    Pair("${text.substring(0, start)}$insert ${text.substring(caret)}", start + insert.length + 1)

// The field after a send that did not go through: the unsent text goes back in front of anything typed since.
fun restoreUnsent(current: String, sent: String) = if (current.isBlank()) sent else "$sent\n$current"

fun appendWord(text: String, add: String) = "$text${if (text.isNotEmpty() && !text.last().isWhitespace()) " " else ""}$add"

fun contextPercent(context: Long?): Int? = context?.let { minOf(100, Math.round(it.toDouble() / COMPACT_AT * 100).toInt()) }

fun shortModel(name: String): String {
    val plain = name.replace(Regex("\\s*\\(.*\\)$"), "")
    return Regex("^claude-([a-z]+)-(\\d+)-(\\d+).*$").replace(plain) { m -> "${m.groupValues[1].replaceFirstChar { it.uppercase() }} ${m.groupValues[2]}.${m.groupValues[3]}" }
}

class GoalChoice(val value: String, val label: String, val chip: String, val detail: String, val command: String)

private const val GOAL_HOUR_MS = 3_600_000L
private const val GOAL_MORNING = "07:00"

// The Goal options; the timed ones end at a clock time counted from now (web/src/chat/composerLogic.ts goalChoices).
fun goalChoices(now: Long): List<GoalChoice> {
    fun until(hours: Int) = clock(now + hours * GOAL_HOUR_MS)
    return listOf(
        GoalChoice("off", "Off", "", "Your next message runs once", ""),
        GoalChoice("done", "Until done", "Until done", "Treats your next message as a goal and keeps checking until it is met", "/goal"),
        GoalChoice("morning", "Until morning", "Until $GOAL_MORNING", "Repeats it back to back until $GOAL_MORNING", "/loop until $GOAL_MORNING"),
        GoalChoice("1h", "For 1 hour", "Until ${until(1)}", "Repeats it back to back until ${until(1)}", "/loop until ${until(1)}"),
        GoalChoice("4h", "For 4 hours", "Until ${until(4)}", "Repeats it back to back until ${until(4)}", "/loop until ${until(4)}"),
        GoalChoice("hourly", "Every hour, up to 28 days", "Every hour", "Works toward your next message as a goal every hour, up to 28 days", "/goal every 1h"),
    )
}

fun goalInfo(value: String, now: Long) = goalChoices(now).let { l -> l.firstOrNull { it.value == value } ?: l.first() }

fun goalText(value: String, text: String, now: Long) = if (value == "off" || text.startsWith("/")) text else "${goalInfo(value, now).command} $text"

const val GOAL_PLACEHOLDER = "What is the goal?"

// The settings chip text: the short model name, plus the mode when it is not Default.
fun settingsLabel(model: String, mode: String) = if (mode == "default") shortModel(model) else "${shortModel(model)} · ${MODES[mode]?.label ?: mode}"

fun modelName(s: SessionInfo?): String {
    if (s == null) return "Model"
    if (s.team) return "Team"
    return s.models.firstOrNull { it.value == (s.model ?: "default") }?.displayName ?: s.model ?: "Default"
}

// Which button a message goes with while Claude runs: queue it for the next step, or stop and send now.
enum class SendKind { Prompt, Queue, Steer }

fun sendKind(running: Boolean, steer: Boolean) = if (!running) SendKind.Prompt else if (steer) SendKind.Steer else SendKind.Queue

val IMAGE_MARK = Regex("\\[Image: ([^\\]]+)]")

// A user message split into text and the pasted images it names.
sealed interface Part {
    data class Text(val text: String) : Part
    data class Image(val path: String) : Part
}

fun userParts(text: String): List<Part> {
    val out = mutableListOf<Part>()
    var at = 0
    for (m in IMAGE_MARK.findAll(text)) {
        if (m.range.first > at) out += Part.Text(text.substring(at, m.range.first).trim())
        out += Part.Image(m.groupValues[1].trim())
        at = m.range.last + 1
    }
    if (at < text.length) out += Part.Text(text.substring(at).trim())
    return out.filter { it !is Part.Text || it.text.isNotEmpty() }
}

// A prompt starting with "!" is a shell command for the chat's terminal, as on the web; null when it is a prompt or empty.
fun shellCommand(text: String): String? = text.trim().takeIf { it.startsWith("!") }?.drop(1)?.trim()?.ifEmpty { null }

// A shell line that continues this chat in the Claude CLI on the same account; web composerLogic.ts resumeCommand says the same.
fun resumeCommand(cwd: String, sessionId: String, account: String?): String {
    val dir = mapOf("alt" to "~/.claude-alt", "alt2" to "~/.claude-alt2")[account]
    val q = if (Regex("^[\\w./~-]+$").matches(cwd)) cwd else "'" + cwd.replace("'", "'\\''") + "'"
    return "cd $q && " + (if (dir != null) "CLAUDE_CONFIG_DIR=$dir " else "") + "claude --resume $sessionId"
}

// web composerLogic.ts handoffText: Fork chat's new chat reads the old one's transcript (via @chat) and summarises it.
fun handoffText(sessionId: String) =
    "Summarise @chat:$sessionId so we can continue its work in this chat: the goal, decisions made, what is done, what is still open, and the files and commands that matter. At most 15 lines. Then wait for my next message."
