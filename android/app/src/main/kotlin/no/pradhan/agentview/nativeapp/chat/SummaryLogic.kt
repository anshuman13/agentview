package no.pradhan.agentview.nativeapp.chat

import java.util.concurrent.ConcurrentHashMap
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.ops.agentSummary
import no.pradhan.agentview.nativeapp.ops.plural

// Port of web/src/chat/transcript/summary.ts: one turn as status lines, searches and pages.
data class SummaryEntry(val kind: String, val id: String, val at: Long, val title: String, val meta: String, val url: String? = null, val failed: Boolean = false, val running: Boolean = false)

class TurnCut(val id: String, val events: List<ChatEvent>)

// A finished turn's events; latest marks the newest turn of the chat, which may still run.
class SummaryTurn(val events: List<ChatEvent>, val latest: Boolean)

private val WOKE_UP = Regex("^\\w+ woke up")
private val EXPLORE = setOf("Read", "Grep", "Glob", "LS")
private const val SEP = " · "

private fun startsTurn(e: ChatEvent?) = e != null && (e.kind == "user" || (e.kind == "system" && WOKE_UP.containsMatchIn(e.text)))

// Splits events into turns exactly like the web turnsFrom, so the ids match its Turn.id.
fun turnEvents(events: List<ChatEvent>): List<TurnCut> {
    val turns = mutableListOf<Pair<String, MutableList<ChatEvent>>>()
    val turnOf = HashMap<String, MutableList<ChatEvent>>()
    for (e in events) {
        if (startsTurn(e)) {
            turns += e.id to mutableListOf(e)
            continue
        }
        val parent = when (e.kind) { "tool_use" -> e.parent; "tool_result" -> e.toolUseId; else -> null }
        val turn = parent?.let { turnOf[it] } ?: (turns.lastOrNull() ?: ("start" to mutableListOf<ChatEvent>()).also { turns += it }).second
        turnOf[e.id] = turn
        turn += e
    }
    return turns.map { TurnCut(it.first, it.second) }
}

// The last top-level reply of a turn.
fun replyOf(events: List<ChatEvent>) = events.lastOrNull { it.kind == "assistant" && it.parent == null && stripRound(it.text).isNotBlank() }

private fun exploreEntry(steps: List<Item.Step>): SummaryEntry {
    val at = steps.first().use.at
    return SummaryEntry("explore", steps.first().id, at, "Explored ${exploreLabel(steps)}", clock(at))
}

private fun workEntry(items: List<Item>): SummaryEntry {
    val steps = items.filterIsInstance<Item.Step>()
    val commands = steps.filter { it.use.name == "Bash" }
    val files = items.filterIsInstance<Item.File>().map { it.path }.toSet()
    val others = steps.size - commands.size
    val failed = commands.count { it.result?.isError == true }
    val title = listOfNotNull(
        if (files.isNotEmpty()) "edited ${plural(files.size, "file")}" else null,
        if (commands.isNotEmpty()) "ran ${plural(commands.size, "command")}" else null,
        if (others > 0) plural(others, "other step") else null,
    ).joinToString(", ").replaceFirstChar(Char::uppercase)
    val first = items.first()
    val at = when (first) { is Item.File -> first.uses.first().at; is Item.Step -> first.use.at; else -> 0L }
    return SummaryEntry("work", first.id, at, title, listOfNotNull(clock(at), if (failed > 0) "$failed failed" else null).joinToString(SEP))
}

private class Built(val entries: List<SummaryEntry>, val steps: Int)

private fun build(events: List<ChatEvent>): Built {
    val items = buildTranscript(events)
    val order = events.withIndex().associateTo(HashMap()) { (i, e) -> e.id to i }
    // A sub-agent whose Agent call is on an earlier page sorts at its first step.
    events.forEachIndexed { i, e -> if (e.parent != null) order.putIfAbsent(e.parent, i) }
    val statuses = events.filter { it.kind == "tool_use" && it.parent == null && it.name.endsWith("__set_status") }
    val seq = (items.map { it.id to (it as Any) } + statuses.map { it.id to (it as Any) }).sortedBy { order.getValue(it.first) }.map { it.second }
    val entries = mutableListOf<SummaryEntry>()
    var kind = ""
    var run = mutableListOf<Item>()
    fun close() {
        if (run.isEmpty()) return
        entries += if (kind == "explore") exploreEntry(run.filterIsInstance<Item.Step>()) else workEntry(run)
        run = mutableListOf()
    }
    fun add(k: String, item: Item) {
        if (kind != k) close()
        kind = k
        run += item
    }
    var last = ""
    for (e in seq) when {
        e is ChatEvent -> {
            close()
            val key = "${e.input.s("text")}\n${e.input.s("done")}"
            if (key != last) entries += SummaryEntry("status", e.id, e.at, e.input.s("text"), listOf(clock(e.at), e.input.s("done")).filter { it.isNotEmpty() }.joinToString(SEP))
            last = key
        }
        e is Item.Agent -> {
            close()
            entries += SummaryEntry("agent", e.id, e.use.at, e.use.input.s("description").ifEmpty { "Sub-agent" }, listOf(clock(e.use.at), agentSummary(e)).joinToString(SEP), running = e.running, failed = !e.running && e.result?.isError == true)
        }
        e is Item.Step && e.use.name == "WebSearch" -> {
            close()
            entries += SummaryEntry("search", e.id, e.use.at, stepLabel(e.use.name, e.use.input).obj, listOf(clock(e.use.at), "Web search").joinToString(SEP))
        }
        e is Item.Step && e.use.name == "WebFetch" -> {
            close()
            entries += SummaryEntry("page", e.id, e.use.at, stepLabel(e.use.name, e.use.input).obj, clock(e.use.at), url = e.use.input.s("url"), failed = e.result?.isError == true)
        }
        e is Item.Step && e.use.name in EXPLORE -> add("explore", e)
        e is Item.Step || e is Item.File -> add("work", e as Item)
    }
    close()
    val startId = events.firstOrNull()?.takeIf { startsTurn(it) }?.id
    val replyId = replyOf(events)?.id
    return Built(entries, items.count { it.id != startId && it.id != replyId })
}

private class Cached(val n: Int, val last: ChatEvent?, val built: Built)

private val cache = ConcurrentHashMap<String, Cached>()

// A turn whose event count and last event are unchanged returns the same entries.
private fun built(events: List<ChatEvent>): Built {
    val key = events.firstOrNull()?.id ?: ""
    val last = events.lastOrNull()
    cache[key]?.takeIf { it.n == events.size && it.last === last }?.let { return it.built }
    return build(events).also { cache[key] = Cached(events.size, last, it) }
}

fun turnSummary(events: List<ChatEvent>) = built(events).entries

// The turn's items less its prompt and reply, the number the web Turn.steps holds.
fun summarySteps(events: List<ChatEvent>) = built(events).steps

fun summaryCounts(entries: List<SummaryEntry>, steps: Int): List<String> {
    val searches = entries.count { it.kind == "search" }
    return listOfNotNull(
        if (searches > 0) "$searches ${if (searches == 1) "search" else "searches"}" else null,
        entries.count { it.kind == "page" }.takeIf { it > 0 }?.let { plural(it, "page") },
        if (steps > 0) plural(steps, "step") else null,
    )
}

// The finished reply of each turn that has a status, search or page entry, keyed by the reply's id.
fun summaryTurns(events: List<ChatEvent>): Map<String, SummaryTurn> {
    val cuts = turnEvents(events)
    val out = HashMap<String, SummaryTurn>()
    for (cut in cuts) {
        val reply = replyOf(cut.events)?.takeIf { !it.streaming } ?: continue
        if (turnSummary(cut.events).any { it.kind == "status" || it.kind == "search" || it.kind == "page" }) out[reply.id] = SummaryTurn(cut.events, cut === cuts.last())
    }
    return out
}
