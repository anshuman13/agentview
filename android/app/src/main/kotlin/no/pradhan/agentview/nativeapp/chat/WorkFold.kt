package no.pradhan.agentview.nativeapp.chat

import java.util.Locale
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.ui.plural
import no.pradhan.agentview.nativeapp.workspace.isSketchPath

// Web chat/transcript/workFold.ts: each turn's work folded into one row above its last reply.
data class Work(val tools: Int, val files: Int, val agents: Int, val failed: Int, val ms: Long, val cost: Double, val note: String = "")

// What a fold without tool work holds: the one note's first line, else their count.
private fun noteOf(it: Item) = when (it) {
    is Item.System -> firstLine(it.text)
    is Item.Assistant -> firstLine(it.text)
    is Item.User -> firstLine(it.text)
    else -> ""
}

private fun notes(items: List<Item>) = (if (items.size == 1) noteOf(items[0]) else "").ifEmpty { if (items.isEmpty()) "" else plural(items.size, "note") }

data class StatusStep(val id: String, val title: String, val done: Boolean)

private class Tasks(val done: MutableList<StatusStep> = mutableListOf(), var next: List<StatusStep> = emptyList(), var now: String = "") {
    fun list() = done + next.filter { n -> done.none { it.title == n.title } }
}

// web workFold.ts stepsByTurn: the finished tasks (a repeated title keeps its first place), then the latest call's next list that is not done yet, and the latest status text.
private fun stepsByTurn(events: List<ChatEvent>): Map<String, Tasks> {
    val out = HashMap<String, Tasks>()
    var key = ""
    for (e in events) {
        if (e.kind == "user") key = e.id
        if (e.kind != "tool_use" || e.parent != null || !e.name.endsWith("__set_status")) continue
        val t = out.getOrPut(key) { Tasks() }
        val title = e.input.s("done").trim()
        if (title.isNotEmpty() && t.done.none { it.title == title }) t.done += StatusStep(e.id, title, true)
        (e.input["next"] as? JsonArray)?.let { arr ->
            t.next = arr.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content?.trim()?.ifEmpty { null } }.mapIndexed { i, s -> StatusStep("${e.id}:$i", s, false) }
        }
        t.now = e.input.s("text").trim()
    }
    return out
}

sealed interface FoldRow {
    val key: String

    data class Row(val it: Item) : FoldRow {
        override val key get() = it.id
    }

    data class Fold(val id: String, val hidden: List<Item>, val work: Work, val last: Boolean, val steps: List<StatusStep> = emptyList(), val now: String = "", val claims: List<Claim> = emptyList(), val proposed: List<Proposal> = emptyList()) : FoldRow {
        override val key get() = "work:$id"
    }
}

data class Claim(val id: String, val text: String, val where: String)

private val wikiRead = Regex("(^|__)wiki_(search|page)$")
private val claimLine = Regex("^- \\[([^\\]]+)\\] \\([^)]*\\) (.*)$")
private val claimWhere = Regex("^(.*) \\(on (.+)\\)$")

// web workFold.ts claimsOf: the claims a turn read, the `- [id] (...) text` lines of its wiki_search and wiki_page results, each id once. `- page [id]` lines do not match.
fun claimsOf(items: List<Item>): List<Claim> {
    val out = LinkedHashMap<String, Claim>()
    for (it in items) {
        if (it !is Item.Step || !wikiRead.containsMatchIn(it.use.name) || it.result == null || it.result.isError) continue
        for (line in it.result.text.lines()) {
            val m = claimLine.matchEntire(line) ?: continue
            val id = m.groupValues[1]
            if (id in out) continue
            val w = claimWhere.matchEntire(m.groupValues[2])
            out[id] = Claim(id, w?.groupValues?.get(1) ?: m.groupValues[2], w?.groupValues?.get(2) ?: "")
        }
    }
    return out.values.toList()
}

data class Proposal(val id: String, val text: String)

private val wikiPropose = Regex("(^|__)wiki_propose$")
private val proposedLine = Regex("^Proposed \\[([^\\]]+)\\]")

// web workFold.ts proposedOf: the claims a turn proposed, its successful wiki_propose steps whose result starts "Proposed [id]", with the step's text, each id once.
fun proposedOf(items: List<Item>): List<Proposal> {
    val out = LinkedHashMap<String, Proposal>()
    for (it in items) {
        if (it !is Item.Step || !wikiPropose.containsMatchIn(it.use.name) || it.result == null || it.result.isError) continue
        val id = proposedLine.find(it.result.text)?.groupValues?.get(1) ?: continue
        if (id !in out) out[id] = Proposal(id, it.use.input.s("text").trim())
    }
    return out.values.toList()
}

// web workFold.ts proposalState: what the hub mirror says of a proposed claim.
fun proposalState(fact: Row?) = if (fact == null) "Not synced yet" else if (fact.deleted) "Deleted" else when (fact.str("state")) {
    "proposed" -> "Waiting"
    "rejected" -> "Rejected"
    else -> "Approved"
}

data class WorkTitle(val text: String, val failed: String, val detail: String)

private class Span(val at: Long) {
    var end = 0L
    var cost = 0.0
}

// Each prompt's time, the time of its last result and the cost its results add over the result before them (the first loaded result has none); rows before the first prompt belong to "".
private fun spans(events: List<ChatEvent>): Map<String, Span> {
    val out = HashMap<String, Span>()
    var cur = Span(events.firstOrNull()?.at ?: 0L).also { out[""] = it }
    var last: Double? = null
    for (e in events) {
        if (e.kind == "user") cur = Span(e.at).also { out[e.id] = it }
        else if (e.kind == "result") {
            cur.end = e.at
            if (e.costUsd > 0) { last?.let { cur.cost += costRise(e.costUsd, it) }; last = e.costUsd }
        }
    }
    return out
}

private fun workOf(items: List<Item>, span: Span): Work {
    var tools = 0
    var agents = 0
    var failed = 0
    val paths = HashSet<String>()
    for (it in items) when (it) {
        is Item.Step -> { tools++; if (it.result?.isError == true && !isDenied(it.result)) failed++ }
        is Item.File -> {
            tools += it.uses.size
            if (it.error != null) { if (!it.denied) failed++ } else paths.add(it.path)
        }
        is Item.Agent -> {
            tools++
            agents++
            if (it.result?.isError == true && !isDenied(it.result)) failed++
        }
        else -> {}
    }
    return Work(tools, paths.size, agents, failed, if (span.end > span.at) span.end - span.at else 0L, span.cost, if (tools == 0) notes(items) else "")
}

// Splits the rows into turns, one per prompt, and moves the work of each into one fold placed above its last reply, or at its end while there is no reply.
fun foldTurns(items: List<Item>, events: List<ChatEvent>): List<FoldRow> {
    val prompts = events.filter { it.kind == "user" }.mapTo(HashSet()) { it.id }
    val span = spans(events)
    val steps = stepsByTurn(events)
    val cards = specCardIds(items) + docCardIds(items)
    val groups = mutableListOf<MutableList<Item>>()
    for (it in items) {
        if (it.id in prompts || groups.isEmpty()) groups.add(mutableListOf())
        groups.last() += it
    }
    val out = mutableListOf<FoldRow>()
    groups.forEachIndexed { g, group ->
        val first = group.first()
        val key = if (first.id in prompts) first.id else ""
        val reply = group.indexOfLast { it is Item.Assistant }
        val hidden = mutableListOf<Item>()
        val rows = mutableListOf<FoldRow>()
        group.forEachIndexed { i, it ->
            val shown = it.id in prompts || i == reply || it is Item.Blocked || it is Item.Review ||
                (it is Item.System && it.error) ||
                (it is Item.File && it.error == null && (isSketchPath(it.path) || it.id in cards)) ||
                (it is Item.Agent && it.id in cards)
            if (!shown || it is Item.Agent) hidden += it
            if (shown) rows += FoldRow.Row(it)
        }
        val tasks = steps[key]
        if (hidden.isNotEmpty() || tasks != null) {
            val at = if (reply < 0) rows.size else rows.indexOfFirst { it is FoldRow.Row && it.it === group[reply] }
            rows.add(at, FoldRow.Fold(key.ifEmpty { first.id }, hidden, workOf(hidden, span[key] ?: span.getValue("")), g == groups.lastIndex, tasks?.list().orEmpty(), tasks?.now.orEmpty(), claimsOf(hidden), proposedOf(hidden)))
        }
        out += rows
    }
    return out
}

fun workTitle(work: Work, live: Boolean, billing: String): WorkTitle {
    val failed = if (work.failed > 0) "${work.failed} failed" else ""
    if (work.tools == 0 && work.note.isNotEmpty()) return WorkTitle(work.note, failed, "")
    val text = listOfNotNull(
        plural(work.tools, "tool").takeIf { work.tools > 0 },
        plural(work.files, "file").takeIf { work.files > 0 },
    ).joinToString(" \u00B7 ")
    val detail = listOfNotNull(
        plural(work.agents, "agent").takeIf { work.agents > 0 },
        duration(work.ms).takeIf { !live && it.isNotEmpty() },
        ("$" + String.format(Locale.US, "%.2f", work.cost)).takeIf { billing == "usd" && work.cost > 0 },
    ).joinToString(" \u00B7 ")
    return WorkTitle(text.ifEmpty { if (failed.isEmpty()) "Work" else "" }, failed, detail)
}
