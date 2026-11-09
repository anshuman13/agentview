package no.pradhan.agentview.nativeapp

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Port of web/src/chat/steps.ts: the transcript items built from the flat event list.
sealed interface Item {
    val id: String

    data class User(override val id: String, val text: String, val at: Long, val stopping: Boolean, val queued: Boolean) : Item
    data class Phase(override val id: String, val text: String) : Item
    data class Assistant(override val id: String, val text: String, val streaming: Boolean) : Item
    data class System(override val id: String, val text: String) : Item
    data class Step(override val id: String, val use: ChatEvent, val result: ChatEvent?) : Item
    data class File(override val id: String, val path: String, val add: Int, val del: Int, val uses: List<ChatEvent>, val error: String?, val denied: Boolean) : Item
    data class Agent(override val id: String, val use: ChatEvent, val result: ChatEvent?, val running: Boolean, val steps: List<Item>) : Item
    data class Blocked(override val id: String, val ev: ChatEvent) : Item
}

const val CMD_PREVIEW = 160

fun cmdPreview(cmd: String): String {
    val flat = cmd.trim().replace(Regex("\\s*\\n\\s*"), " \u23CE ")
    return "$ " + if (flat.length > CMD_PREVIEW) flat.take(CMD_PREVIEW).trimEnd() + "\u2026" else flat
}

data class Label(val verb: String, val obj: String, val mono: Boolean = false, val cmd: String? = null)

enum class Tone { Read, Edit, Run, Web, Mcp, Agent, Other }

private val AGENT_TOOLS = setOf("Agent", "Task")
private val DENIED = Regex("^(The user doesn't want to proceed|User denied this action|aborted\\b|Session closed|The user sent a new message instead|Claude exited before this was answered)")

fun firstLine(text: String) = text.trim().lineSequence().firstOrNull() ?: ""
fun JsonObject.s(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""

fun isDenied(result: ChatEvent?) = result != null && result.isError && DENIED.containsMatchIn(result.text.trim())

fun relPath(p: String, cwd: String): String = when {
    cwd.isEmpty() -> p
    p == cwd -> "."
    p.startsWith("$cwd/") -> p.substring(cwd.length + 1)
    else -> p
}

fun duration(ms: Long): String = when {
    ms < 1000 -> ""
    ms < 60_000 -> "${Math.round(ms / 1000.0)}s"
    ms < 3_600_000 -> "${Math.round(ms / 60_000.0)}m"
    else -> "${Math.round(ms / 3_600_000.0)}h"
}

fun stepLabel(name: String, input: JsonObject, cwd: String = ""): Label {
    fun rel(k: String) = relPath(input.s(k), cwd)
    val inDir = if (input.s("path").isNotEmpty() && rel("path") != ".") rel("path") else ""
    when (name) {
        "Read" -> return Label("Read", rel("file_path"))
        "Edit", "MultiEdit" -> return Label("Edited", rel("file_path"))
        "NotebookEdit" -> return Label("Edited", rel("notebook_path"))
        "Write" -> return Label("Wrote", rel("file_path"))
        "Grep" -> return Label("Searched", "\"${input.s("pattern")}\" in ${inDir.ifEmpty { "the project" }}")
        "Glob" -> return Label("Listed", if (inDir.isNotEmpty()) "$inDir/${input.s("pattern")}" else input.s("pattern"))
        "LS" -> return Label("Listed", "${inDir.ifEmpty { "." }}/")
        "Bash" -> return if (input.s("description").isNotEmpty()) Label("", input.s("description"), cmd = input.s("command")) else Label("Ran", firstLine(input.s("command")), mono = true)
        "WebFetch" -> return Label("Fetched", input.s("url").replace(Regex("^https?://"), "").removeSuffix("/"))
        "WebSearch" -> return Label("Searched the web for", "\"${input.s("query")}\"")
        "Agent", "Task" -> return Label("Delegated", input.s("description"))
        "SendMessage" -> return Label("Messaged agent", input.s("summary").ifEmpty { input.s("to") })
        "TodoWrite" -> return Label("Updated", "the to-do list")
        "AskUserQuestion" -> return Label("Asked", "you a question")
        "Skill" -> return Label("Loaded", "the ${input.s("skill")} skill")
        "ToolSearch" -> return Label("Looked up", "tools for \"${input.s("query")}\"")
        "Advisor" -> return Label("Consulted", "the advisor")
        "ExitPlanMode" -> return Label("Proposed", "a plan")
        "EnterPlanMode" -> return Label("Entered", "plan mode")
    }
    if (name.startsWith("mcp__")) {
        val parts = name.split("__")
        return Label("Called", "${parts.drop(2).joinToString("__")} (${parts.getOrElse(1) { "" }})")
    }
    return Label("Used", name)
}

private val TONES = mapOf(
    "Read" to Tone.Read, "Grep" to Tone.Read, "Glob" to Tone.Read, "LS" to Tone.Read, "ToolSearch" to Tone.Read,
    "Edit" to Tone.Edit, "MultiEdit" to Tone.Edit, "Write" to Tone.Edit, "NotebookEdit" to Tone.Edit,
    "Bash" to Tone.Run, "WebFetch" to Tone.Web, "WebSearch" to Tone.Web, "SendMessage" to Tone.Agent,
)

fun stepTone(name: String): Tone = TONES[name] ?: if (name.startsWith("mcp__")) Tone.Mcp else Tone.Other

private val MORE = Regex("\\n… (\\d+) more lines$")

private fun lines(v: String): Int {
    if (v.isEmpty()) return 0
    val m = MORE.find(v)
    return v.split('\n').size - (if (v.endsWith("\n")) 1 else 0) + (if (m != null) m.groupValues[1].toInt() - 1 else 0)
}

// shared/edits.ts editCount: added and removed lines of an edit tool call, or null for other tools.
fun editCount(name: String, input: JsonObject): Pair<Int, Int>? = when (name) {
    "Write" -> lines(input.s("content")) to 0
    "Edit" -> lines(input.s("new_string")) to lines(input.s("old_string"))
    "MultiEdit" -> {
        val edits = (input["edits"] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()
        edits.sumOf { lines(it.s("new_string")) } to edits.sumOf { lines(it.s("old_string")) }
    }
    else -> null
}

fun chatCost(events: List<ChatEvent>): Double {
    var last = 0.0
    var total = 0.0
    for (e in events) {
        if (e.kind != "result" || e.costUsd <= 0) continue
        total += if (e.costUsd >= last) e.costUsd - last else e.costUsd
        last = e.costUsd
    }
    return total
}

fun buildTranscript(events: List<ChatEvent>): List<Item> {
    val results = HashMap<String, ChatEvent>()
    val children = HashMap<String, MutableList<ChatEvent>>()
    val resumed = HashMap<String, Long>()
    for (e in events) {
        if (e.kind == "tool_result") results[e.toolUseId] = e
        if (e.kind == "tool_use" && e.agent != null) resumed[e.agent] = e.at
        val parent = if (e.kind == "tool_use" || e.kind == "tool_result" || e.kind == "assistant") e.parent else null
        if (parent != null) children.getOrPut(parent) { mutableListOf() }.add(e)
    }
    return itemsFrom(events.filter { it.parent == null }, results, children, resumed)
}

private fun itemsFrom(events: List<ChatEvent>, results: Map<String, ChatEvent>, children: Map<String, List<ChatEvent>>, resumed: Map<String, Long>): List<Item> {
    val items = mutableListOf<Item>()
    for (e in events) {
        when {
            e.kind == "user" -> items += if (e.phase != null) Item.Phase(e.id, e.text) else Item.User(e.id, e.text, e.at, e.stopping, e.queued)
            e.kind == "assistant" -> if (e.text.isNotBlank()) items += Item.Assistant(e.id, e.text, e.streaming)
            e.kind == "system" -> items += Item.System(e.id, e.text)
            e.kind == "blocked" -> items += Item.Blocked(e.id, e)
            e.kind == "plan" -> items += Item.System(e.id, if (e.next.isNotEmpty()) "You changed the next steps (${e.next.size})" else "You cleared the next steps")
            e.kind == "tool_use" && !e.name.endsWith("__set_status") -> {
                val result = results[e.id]
                val count = editCount(e.name, e.input)
                val path = e.input.s("file_path")
                if (e.name in AGENT_TOOLS) {
                    val running = result == null || (resumed[e.id] ?: 0) > result.at
                    items += Item.Agent(e.id, e, result, running, itemsFrom(children[e.id] ?: emptyList(), results, children, resumed))
                } else if (count == null || path.isEmpty()) {
                    items += Item.Step(e.id, e, result)
                } else {
                    val error = if (result?.isError == true) (if (isDenied(result)) "Denied" else firstLine(result.text)) else null
                    val prev = items.lastOrNull()
                    if (error == null && prev is Item.File && prev.path == path && prev.error == null) {
                        items[items.lastIndex] = prev.copy(uses = prev.uses + e, add = prev.add + count.first, del = prev.del + count.second)
                    } else {
                        items += Item.File(e.id, path, if (error != null) 0 else count.first, if (error != null) 0 else count.second, listOf(e), error, isDenied(result))
                    }
                }
            }
        }
    }
    return items
}

// Slack-style day dividers: the label to draw above each prompt that starts a new day. A chat that stays within today gets none.
fun dayDividers(items: List<Item>, now: Long, zone: java.time.ZoneId = codexZone): Map<String, String> {
    val today = java.time.Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    val out = HashMap<String, String>()
    var prev: java.time.LocalDate? = null
    for (it in items) {
        if (it !is Item.User || it.at <= 0) continue
        val day = java.time.Instant.ofEpochMilli(it.at).atZone(zone).toLocalDate()
        if (day != prev && (prev != null || day != today)) out[it.id] = when {
            day == today -> "Today"
            day == today.minusDays(1) -> "Yesterday"
            day.year == today.year -> java.time.format.DateTimeFormatter.ofPattern("EEEE, d MMMM", java.util.Locale.ENGLISH).format(day)
            else -> java.time.format.DateTimeFormatter.ofPattern("d MMMM yyyy", java.util.Locale.ENGLISH).format(day)
        }
        prev = day
    }
    return out
}

// The day label each row falls under, for the date pill shown while scrolling. Rows before the first divider have none.
fun dayOfRows(items: List<Item>, days: Map<String, String>): Map<String, String> {
    val out = HashMap<String, String>()
    var label: String? = null
    for (it in items) {
        days[it.id]?.let { d -> label = d }
        label?.let { l -> out[it.id] = l }
    }
    return out
}

// Prompts whose turn changed files, which the server can put back from its checkpoint.
fun rewindable(items: List<Item>): Set<String> {
    val out = HashSet<String>()
    var prompt: String? = null
    for (it in items) when {
        it is Item.User -> prompt = it.id
        it is Item.File && it.error == null && !it.denied -> prompt?.let { p -> out.add(p) }
    }
    return out
}

// Replies that arrived after the reader scrolled up, for the Jump to latest button.
fun newReplies(items: List<Item>, lastSeenId: String): Int {
    val i = items.indexOfFirst { it.id == lastSeenId }
    return if (i < 0) 0 else items.drop(i + 1).count { it is Item.Assistant && !it.streaming }
}

// Slack-style New line: the first reply or step that arrived after this phone last showed the chat and before it was opened.
fun newMarker(items: List<Item>, ats: Map<String, Long>, seen: Long, openedAt: Long): String? {
    if (seen <= 0) return null
    return items.firstOrNull { it !is Item.User && (ats[it.id] ?: 0L).let { at -> at > seen && at <= openedAt } }?.id
}

// The prompts and replies of the loaded transcript as Markdown, for the share sheet. Tools and system lines are left out.
// Slack's "Remind me about this": when a reminder task for a chat falls due.
fun remindChoices(now: Long, zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): List<Pair<String, Long>> {
    val tomorrow = java.time.Instant.ofEpochMilli(now).atZone(zone).toLocalDate().plusDays(1).atTime(9, 0).atZone(zone).toInstant().toEpochMilli()
    return listOf("In 1 hour" to now + 3_600_000, "In 3 hours" to now + 3 * 3_600_000, "Tomorrow at 9:00" to tomorrow)
}

fun chatMarkdown(title: String, events: List<ChatEvent>): String = buildString {
    if (title.isNotBlank()) append("# ").append(title.trim()).append("\n\n")
    for (e in events) {
        if (e.text.isBlank() || e.queued) continue
        when (e.kind) {
            "user" -> append("**You:** ").append(e.text.trim()).append("\n\n")
            "assistant" -> append(e.text.trim()).append("\n\n")
        }
    }
}.trimEnd() + "\n"

private val EXPLORE = setOf("Read", "Grep", "Glob")

// Runs of at least min finished Read, Grep and Glob steps in a row, keyed by the first step's id, so the
// transcript folds each into one Explored row like Slack's compact message groups.
fun exploreRuns(items: List<Item>, min: Int = 3): Map<String, List<Item.Step>> {
    val runs = mutableMapOf<String, List<Item.Step>>()
    var run = mutableListOf<Item.Step>()
    fun close() { if (run.size >= min) runs[run.first().id] = run; run = mutableListOf() }
    for (it in items) {
        if (it is Item.Step && it.use.name in EXPLORE && it.result != null && !it.result.isError) run += it else close()
    }
    close()
    return runs
}

fun exploreLabel(steps: List<Item.Step>): String {
    val reads = steps.count { it.use.name == "Read" }
    val searches = steps.size - reads
    return listOfNotNull(
        if (reads > 0) "$reads ${if (reads == 1) "file" else "files"}" else null,
        if (searches > 0) "$searches ${if (searches == 1) "search" else "searches"}" else null,
    ).joinToString(", ")
}
