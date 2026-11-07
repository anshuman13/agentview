package no.pradhan.agentview.nativeapp

// web/src/chat/composerLogic.ts and ChatSettings.tsx, the parts the phone composer uses.

const val MAX_ROWS = 8
const val COMPACT_AT = 200_000

val PERMISSION_MODES = listOf("default", "acceptEdits", "plan", "auto", "dontAsk")
val EFFORT_LEVELS = listOf("low", "medium", "high", "xhigh", "max")
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

data class Trigger(val start: Int, val query: String)

// The `/command` the caret is in, or null.
fun commandTrigger(text: String, caret: Int): Trigger? {
    val before = text.substring(0, minOf(caret, text.length))
    val m = Regex("(?:^|\\s)/(\\S*)$").find(before) ?: return null
    val query = m.groupValues[1]
    return Trigger(before.length - 1 - query.length, query)
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
