package no.pradhan.agentview.nativeapp.codex.wiki

import no.pradhan.agentview.nativeapp.codex.CodexStore
import no.pradhan.agentview.nativeapp.codex.Row

// web/src/codex/data/wiki.ts approveChanges and wiki/ReviewMode.tsx: deciding proposed claims one at a time.
class Change(val row: Row, val patch: Map<String, Any?>, val undo: Map<String, Any?>)

private fun pageOf(pages: List<Row>, fact: Row) = pages.firstOrNull { it.id == fact.str("page_id") && it.profile == fact.profile }

// Approving sets the claim live, its proposed page live, and supersedes the claim it replaces.
fun approveChanges(fact: Row, pages: List<Row>, facts: List<Row>): List<Change> {
    val page = pageOf(pages, fact)?.takeIf { it.str("state") == "proposed" }
    val current = currentClaims(facts)
    val old = facts.firstOrNull { it.id == fact.str("replaces") && it.profile == fact.profile && !it.deleted && current(it) }
    return listOfNotNull(
        Change(fact, mapOf("state" to "live"), mapOf("state" to "proposed")),
        page?.let { Change(it, mapOf("state" to "live"), mapOf("state" to "proposed")) },
        old?.let { Change(it, mapOf("superseded_by" to fact.id), mapOf("superseded_by" to null)) },
    )
}

fun approveAllChanges(list: List<Row>, pages: List<Row>, facts: List<Row>): List<Change> {
    val seen = HashSet<String>()
    return list.flatMap { approveChanges(it, pages, facts) }.filter { seen.add("${it.row.table}:${it.row.key}") }
}

fun rejectChanges(list: List<Row>, pages: List<Row>, facts: List<Row>): List<Change> {
    val page = list.firstOrNull()?.let { pageOf(pages, it) }?.takeIf { it.str("state") == "proposed" }
    val keys = list.map { it.key }.toSet()
    val rest = page != null && proposals(facts).all { it.str("page_id") != page.id || it.key in keys }
    return list.map { Change(it, mapOf("state" to "rejected"), mapOf("state" to "proposed")) } + listOfNotNull(if (rest) Change(page!!, mapOf("state" to "rejected"), mapOf("state" to "proposed")) else null)
}

// The order is fixed when the screen opens; a skipped claim goes to the back, a decided one stays counted.
fun extendOrder(order: List<String>, open: Collection<String>) = order + open.filter { it !in order }

fun reviewQueue(order: List<String>, skipped: List<String>, open: Set<String>): List<String> {
    val left = order.filter { it in open }
    return left.filter { it !in skipped } + skipped.filter { it in open }
}

class ReviewOps(private val store: CodexStore, private val snack: (String, (() -> Unit)?) -> Unit) {
    private fun run(changes: List<Change>, text: String) {
        var any = false
        for (c in changes) any = store.update(c.row, c.patch) || any
        if (any) snack(text) { changes.reversed().forEach { store.update(it.row, it.undo) } }
    }

    private fun noun(n: Int) = "$n ${if (n == 1) "claim" else "claims"}"
    fun approve(list: List<Row>) { val s = store.state.value; run(approveAllChanges(list, s.pages, s.facts), "Approved ${noun(list.size)}") }
    fun reject(list: List<Row>) { val s = store.state.value; run(rejectChanges(list, s.pages, s.facts), "Rejected ${noun(list.size)}") }
}
