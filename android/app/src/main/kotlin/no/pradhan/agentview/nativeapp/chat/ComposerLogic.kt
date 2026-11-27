package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.codex.Week
import no.pradhan.agentview.nativeapp.codex.meetings.Repeats
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.CommandInfo
import no.pradhan.agentview.nativeapp.net.ModelInfo
import no.pradhan.agentview.nativeapp.net.PlanUsage
import no.pradhan.agentview.nativeapp.net.SessionInfo
import no.pradhan.agentview.nativeapp.net.menuModes
import no.pradhan.agentview.nativeapp.ops.mcpSlug
import no.pradhan.agentview.nativeapp.sessions.SavedSession

// web/src/chat/composerLogic.ts and ChatSettings.tsx, the parts the phone composer uses.

const val MAX_ROWS = 8
const val MAX_SAVED_PROMPTS = 50

// The prompts kept for every chat, oldest first: a repeat moves to the end and a blank is ignored.
fun rememberPrompt(text: String, stored: List<String>, max: Int = MAX_SAVED_PROMPTS) =
    if (text.isBlank()) stored else (stored.filter { it != text } + text).takeLast(max)
const val COMPACT_AT = 200_000

val EFFORT_LEVELS = listOf("low", "medium", "high", "xhigh", "max")
// The labels are replaced by the ones in the server's settings file (Hub.refreshSettings).
val ACCOUNT_LABEL = mutableMapOf("main" to "Account 1", "alt" to "Account 2", "alt2" to "Account 3")
val ACCOUNT_NOTE = mapOf("alt2" to "Only picked by hand")
// The plan usage of the chat's account, as "Week 45% · 5-hour 12%".
fun usageText(u: PlanUsage?) = listOfNotNull(u?.week?.let { "Week ${it.pct.toInt()}%" }, u?.fiveHour?.let { "5-hour ${it.pct.toInt()}%" }).joinToString(" · ")

fun reviewLabel(running: Boolean, hasChanges: Boolean) =
    if (running) "Review changes · Agent is working" else if (hasChanges) "Review changes" else "Review changes · No changes"

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

private val COMMAND_AT = Regex("(?:^|\\s)([/@])(\\S*)$")

// The `/command` the caret is in, or null.
fun commandTrigger(text: String, caret: Int): Trigger? {
    val before = text.substring(0, minOf(caret, text.length))
    val m = COMMAND_AT.find(before) ?: return null
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

// "@chat:" lists other chats by title; picking one inserts @chat:<session id>, which the server expands to its transcript.
fun chatQuery(t: Trigger?): String? = t?.takeIf { it.file && it.query.startsWith("chat:") }?.query?.removePrefix("chat:")

fun rankChats(chats: List<SavedSession>, query: String, limit: Int = MAX_ROWS): List<SavedSession> =
    chats.filter { it.title.isNotEmpty() }.mapNotNull { c -> matchScore(c.title, query)?.let { c to it } }.sortedByDescending { it.second }.take(limit).map { it.first }

fun acceptSuggestion(text: String, start: Int, caret: Int, insert: String): Pair<String, Int> =
    Pair("${text.substring(0, start)}$insert ${text.substring(caret)}", start + insert.length + 1)

// The field after a send that did not go through: the unsent text goes back in front of anything typed since.
fun restoreUnsent(current: String, sent: String) = if (current.isBlank()) sent else "$sent\n$current"

fun appendWord(text: String, add: String) = "$text${if (text.isNotEmpty() && !text.last().isWhitespace()) " " else ""}$add"

// 80% of the model's window, or COMPACT_AT when the agent does not report it (shared/protocol.ts compactAt).
fun compactAt(contextWindow: Long?): Long = contextWindow?.takeIf { it > 0 }?.let { Math.round(it * 0.8) } ?: COMPACT_AT.toLong()

fun contextPercent(context: Long?, contextWindow: Long?): Int? = context?.let { minOf(100, Math.round(it.toDouble() / compactAt(contextWindow) * 100).toInt()) }

fun shortModel(name: String): String {
    val plain = name.replace(Regex("\\s*\\(.*\\)$"), "")
    return Regex("^claude-([a-z]+)-(\\d+)-(\\d+).*$").replace(plain) { m -> "${m.groupValues[1].replaceFirstChar { it.uppercase() }} ${m.groupValues[2]}.${m.groupValues[3]}" }
}

// shared/providers.ts modelRow: the list row of the chat's model, which reports a full id ("claude-opus-5-5") where the list has its alias ("opus", "Opus 5.5").
fun modelRow(shown: List<ModelInfo>, model: String?): String? {
    if (model.isNullOrEmpty()) return null
    val name = shortModel(model)
    return (shown.firstOrNull { it.value == model } ?: shown.firstOrNull { shortModel(it.displayName) == name })?.value
}

// shared/providers.ts settingsLabel: "Opus 5.5 · Medium · Auto"; the effort only when set and the provider offers it.
fun settingsLabel(model: String, effort: String?, canEffort: Boolean, provider: String?, mode: String, review: Boolean) =
    "${shortModel(model)}${if (effort != null && canEffort) " · ${EFFORT_LABEL[effort] ?: effort}" else ""} · ${menuModes(provider, mode, review).label}"

fun modelName(s: SessionInfo?): String {
    if (s == null) return "Model"
    val row = modelRow(s.models, s.model ?: "default")
    return s.models.firstOrNull { it.value == row }?.displayName ?: s.model ?: "Default"
}

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

private const val MARK = "\\[(?:Image|File): [^\\]]+]"
private val ANY_MARK = Regex(" ?$MARK ?")
private val TRAILING_MARKS = Regex(" ?(?:$MARK ?)+$")

// An attachment is the "[Image: path]" or "[File: path]" marker in the prompt text. The composer edits the body and shows the markers as chips (web splitMarks).
class Marks(val body: String, val marks: List<String>)

fun splitMarks(text: String) = Marks(
    text.replace(TRAILING_MARKS, "").replace(ANY_MARK, " "),
    Regex(MARK).findAll(text).map { it.value }.toList(),
)

fun joinMarks(body: String, marks: List<String>) = "$body${if (body.isNotEmpty() && marks.isNotEmpty()) " " else ""}${marks.joinToString("") { "$it " }}"

// web shared/attachMark.ts: the marker an upload adds to a prompt, by its mime type.
fun attachMark(mime: String, path: String) = "[${if (mime.startsWith("image/")) "Image" else "File"}: $path]"

// The chip label of a marker: its kind and file name.
fun markLabel(mark: String): String {
    val kind = mark.substring(1, mark.indexOf(':'))
    val path = mark.substring(mark.indexOf(' ') + 1, mark.length - 1)
    return "$kind ${path.substringAfterLast('/').ifEmpty { path }}"
}

// An MCP server, or one of its tools, the user asked the agent to use (web composerLogic.ts Use).
data class Use(val server: String, val tool: String? = null)

fun toolId(server: String, tool: String) = "mcp__${mcpSlug(server)}__$tool"

// A tool replaces a server-wide pick of its server; a server-wide pick replaces that server's tools.
fun addUse(uses: List<Use>, u: Use): List<Use> =
    uses.filter { x -> x.server != u.server || (u.tool != null && x.tool != null && x.tool != u.tool) } + u

fun useLabel(u: Use) = if (u.tool != null) toolId(u.server, u.tool) else u.server

// The prompt with "Use the ... for this." appended; a /command stays as typed.
fun withUses(text: String, uses: List<Use>): String {
    if (uses.isEmpty() || text.startsWith("/")) return text
    val names = uses.map { if (it.tool != null) "the ${toolId(it.server, it.tool)} tool" else "the ${it.server} MCP server" }
    val list = if (names.size > 1) "${names.dropLast(1).joinToString(", ")} and ${names.last()}" else names[0]
    return "$text\n\nUse $list for this."
}

// This chat's sent prompts newest first, then the saved ones newest first, without repeats (web buildHistory).
fun buildHistory(events: List<ChatEvent>, stored: List<String>) =
    (events.filter { it.kind == "user" }.map { it.text.trim() }.reversed() + stored.reversed()).filter { it.isNotEmpty() }.distinct()

// The rest of the first earlier prompt that starts with the typed text, or "" (web ghostFor).
fun ghostFor(text: String, history: List<String>): String {
    if (text.length < 3) return ""
    return history.firstNotNullOfOrNull { h -> splitMarks(h).body.takeIf { it.length > text.length && it.startsWith(text) } }?.substring(text.length) ?: ""
}

// shared/composerText.ts composerPlaceholder for the phone; state is waiting, compacting, running, uses or idle.
fun composerPlaceholder(label: String, state: String, talk: Boolean = true) = when (state) {
    "waiting" -> "Answer above, or message $label to stop and send"
    "compacting" -> "Sends when compacting is done"
    "running" -> "$label reads this at its next step"
    "uses" -> "What should $label do with it?"
    else -> if (talk) "Reply to $label or hold to talk" else "Ask anything · / commands · @ files · @chat: chats"
}

// A prompt starting with "!" is a shell command for the chat's terminal, as on the web; null when it is a prompt or empty.
fun shellCommand(text: String): String? = text.trim().takeIf { it.startsWith("!") }?.drop(1)?.trim()?.ifEmpty { null }

// web composerLogic.ts draftKey: a draft lives under the chat's Claude session id, which outlives the live chat id, and under the live id until the chat has one.
fun draftKey(chat: String, sessionId: String?) = sessionId?.ifEmpty { null } ?: chat



// shared/quickReplies.ts: Duet's tap-to-answer replies, offered while the chat's last word is a finished question from the agent.
val QUICK_REPLIES = listOf("Yes, do that", "No, leave it", "Tell me more")

private const val CHOICE_MAX = 48
private val CHOICE_MARKS = Regex("\\*\\*|__|`")
private val CHOICE_TAIL = Regex("[?.!,;:\\s]+$")
private val CHOICE_HEAD = Regex("^[\\s,]+")
private val CHOICE_BOLD = Regex("^\\*\\*(.+?)\\*\\*")
private val CHOICE_SPLIT = Regex(":\\s|\\s[-–]\\s")
private val CHOICE_ITEM = Regex("^\\s*(?:[-*•]|\\d+[.)])\\s+(.+)$")
private val SENTENCE_END = Regex("(?<=[.!?])\\s+")
private val CHOICE_OR = Regex(",?\\s+or\\s+", RegexOption.IGNORE_CASE)
private val CHOICE_LEAD = Regex("^(should i|shall i|do you want me to|want me to|would you like me to|can i|could i|or should i|or)\\s+", RegexOption.IGNORE_CASE)

private fun tidyChoice(s: String): String {
    val t = s.replace(CHOICE_MARKS, "").replace(CHOICE_TAIL, "").replace(CHOICE_HEAD, "").replace(CHOICE_LEAD, "").trim()
    return t.replaceFirstChar { it.uppercase() }
}

private fun fitsChoices(xs: List<String>) = xs.size in 2..4 && xs.all { it.isNotEmpty() && it.length <= CHOICE_MAX } && xs.toSet().size == xs.size

private fun itemLabel(item: String): String {
    val bold = CHOICE_BOLD.find(item)
    return tidyChoice(bold?.groupValues?.get(1) ?: item.split(CHOICE_SPLIT)[0])
}

// shared/quickReplies.ts questionChoices: the list right above the question, or the parts of an "A or B?" question.
fun questionChoices(text: String): List<String> {
    val lines = text.trim().split("\n")
    val ask = lines.last().trim()
    if (!ask.endsWith("?")) return emptyList()
    val items = mutableListOf<String>()
    for (i in lines.size - 2 downTo 0) {
        val m = CHOICE_ITEM.find(lines[i])
        if (m != null) items.add(0, m.groupValues[1])
        else if (lines[i].isNotBlank() || items.isNotEmpty()) break
    }
    if (items.isNotEmpty()) {
        val labels = items.map(::itemLabel)
        if (fitsChoices(labels)) return labels
    }
    val sentence = ask.split(SENTENCE_END).last()
    val parts = sentence.split(CHOICE_OR).map(::tidyChoice)
    return if (fitsChoices(parts)) parts else emptyList()
}

fun quickReplies(events: List<ChatEvent>): List<String> {
    for (e in events.asReversed()) {
        if (e.kind == "user") return emptyList()
        if (e.kind == "assistant" && e.parent == null) {
            if (e.streaming || !e.text.trim().endsWith("?")) return emptyList()
            return questionChoices(e.text).ifEmpty { QUICK_REPLIES }
        }
    }
    return emptyList()
}

internal fun placeholderState(waiting: Boolean, compacting: Boolean, running: Boolean, hasUses: Boolean) = when {
    waiting -> "waiting"
    compacting -> "compacting"
    running -> "running"
    hasUses -> "uses"
    else -> "idle"
}
