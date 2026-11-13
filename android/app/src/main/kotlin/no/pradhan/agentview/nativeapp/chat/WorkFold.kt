package no.pradhan.agentview.nativeapp.chat

import java.util.Locale
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.ops.plural
import no.pradhan.agentview.nativeapp.workspace.isSketchPath

// Web chat/transcript/workFold.ts: each turn's work folded into one row above its last reply.
data class Work(val tools: Int, val files: Int, val agents: Int, val failed: Int, val ms: Long, val cost: Double)

sealed interface FoldRow {
    val key: String

    data class Row(val it: Item) : FoldRow {
        override val key get() = it.id
    }

    data class Fold(val id: String, val hidden: List<Item>, val work: Work, val last: Boolean) : FoldRow {
        override val key get() = "work:$id"
    }
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
    return Work(tools, paths.size, agents, failed, if (span.end > span.at) span.end - span.at else 0L, span.cost)
}

// Splits the rows into turns, one per prompt, and moves the work of each into one fold placed above its last reply, or at its end while there is no reply.
fun foldTurns(items: List<Item>, events: List<ChatEvent>): List<FoldRow> {
    val prompts = events.filter { it.kind == "user" }.mapTo(HashSet()) { it.id }
    val span = spans(events)
    val cards = specCardIds(items)
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
        if (hidden.isNotEmpty()) {
            val at = if (reply < 0) rows.size else rows.indexOfFirst { it is FoldRow.Row && it.it === group[reply] }
            rows.add(at, FoldRow.Fold(key.ifEmpty { first.id }, hidden, workOf(hidden, span[key] ?: span.getValue("")), g == groups.lastIndex))
        }
        out += rows
    }
    return out
}

fun workTitle(work: Work, live: Boolean, billing: String): WorkTitle {
    val text = listOfNotNull(
        plural(work.tools, "tool").takeIf { work.tools > 0 },
        plural(work.files, "file").takeIf { work.files > 0 },
    ).joinToString(" \u00B7 ")
    val detail = listOfNotNull(
        plural(work.agents, "agent").takeIf { work.agents > 0 },
        duration(work.ms).takeIf { !live && it.isNotEmpty() },
        ("$" + String.format(Locale.US, "%.2f", work.cost)).takeIf { billing == "usd" && work.cost > 0 },
    ).joinToString(" \u00B7 ")
    val failed = if (work.failed > 0) "${work.failed} failed" else ""
    return WorkTitle(text.ifEmpty { if (failed.isEmpty()) "Work" else "" }, failed, detail)
}
