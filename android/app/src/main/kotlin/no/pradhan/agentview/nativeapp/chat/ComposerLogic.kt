package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.codex.Week
import no.pradhan.agentview.nativeapp.codex.meetings.Repeats
import no.pradhan.agentview.nativeapp.net.CommandInfo
import no.pradhan.agentview.nativeapp.net.PlanUsage
import no.pradhan.agentview.nativeapp.net.READ_ONLY_SENT
import no.pradhan.agentview.nativeapp.net.SessionInfo
import no.pradhan.agentview.nativeapp.net.menuModes

// web/src/chat/composerLogic.ts and ChatSettings.tsx, the parts the phone composer uses.

const val MAX_ROWS = 8
const val COMPACT_AT = 200_000

val EFFORT_LEVELS = listOf("low", "medium", "high", "xhigh", "max")
// The labels are replaced by the ones in the server's settings file (Hub.refreshSettings).
val ACCOUNT_LABEL = mutableMapOf("main" to "Account 1", "alt" to "Account 2", "alt2" to "Account 3")
val ACCOUNT_NOTE = mapOf("alt2" to "Only picked by hand")
// The plan usage of the chat's account, as "Week 45% · 5-hour 12%".
fun usageText(u: PlanUsage?) = listOfNotNull(u?.week?.let { "Week ${it.pct.toInt()}%" }, u?.fiveHour?.let { "5-hour ${it.pct.toInt()}%" }).joinToString(" · ")

fun usageHigh(u: PlanUsage?) = maxOf(u?.week?.pct ?: 0.0, u?.fiveHour?.pct ?: 0.0) >= 80

val EFFORT_LABEL = mapOf("low" to "Low", "medium" to "Medium", "high" to "High", "xhigh" to "Extra high", "max" to "Max")

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

// What Build does with the composer: a notice that keeps the text, or the trimmed brief to send.
sealed interface BuildStep {
    data class Notice(val text: String) : BuildStep
    data class Send(val brief: String) : BuildStep
}

fun buildStep(text: String, uploading: Int, readOnly: Boolean): BuildStep = when {
    readOnly -> BuildStep.Notice(READ_ONLY_SENT)
    text.isBlank() -> BuildStep.Notice("Type the brief in the composer first")
    uploading > 0 -> BuildStep.Notice("Wait for the upload to finish")
    else -> BuildStep.Send(text.trim())
}

fun appendWord(text: String, add: String) = "$text${if (text.isNotEmpty() && !text.last().isWhitespace()) " " else ""}$add"

// 80% of the model's window, or COMPACT_AT when the agent does not report it (shared/protocol.ts compactAt).
fun compactAt(contextWindow: Long?): Long = contextWindow?.takeIf { it > 0 }?.let { Math.round(it * 0.8) } ?: COMPACT_AT.toLong()

fun contextPercent(context: Long?, contextWindow: Long?): Int? = context?.let { minOf(100, Math.round(it.toDouble() / compactAt(contextWindow) * 100).toInt()) }

fun shortModel(name: String): String {
    val plain = name.replace(Regex("\\s*\\(.*\\)$"), "")
    return Regex("^claude-([a-z]+)-(\\d+)-(\\d+).*$").replace(plain) { m -> "${m.groupValues[1].replaceFirstChar { it.uppercase() }} ${m.groupValues[2]}.${m.groupValues[3]}" }
}

// The settings chip text: the short model name, plus the mode label unless it is plain Default.
fun settingsLabel(model: String, mode: String, review: Boolean, provider: String?) = if (mode == "default" && !review) shortModel(model) else "${shortModel(model)} · ${menuModes(provider, mode, review).label}"

fun modelName(s: SessionInfo?): String {
    if (s == null) return "Model"
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

// web composerLogic.ts handoffText: Fork chat's new chat reads the old one's transcript (via @chat) and summarises it.
fun handoffText(sessionId: String) =
    "Summarise @chat:$sessionId so we can continue its work in this chat: the goal, decisions made, what is done, what is still open, and the files and commands that matter. At most 15 lines. Then wait for my next message."
