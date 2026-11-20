package no.pradhan.agentview.nativeapp.codex.wiki

import no.pradhan.agentview.nativeapp.codex.CodexStore
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.toJson
import no.pradhan.agentview.nativeapp.ui.plural

// web/src/codex/data/wiki.ts approveChanges and wiki/ReviewMode.tsx: deciding proposed claims one at a time.
class Change(val row: Row, val patch: Map<String, Any?>, val undo: Map<String, Any?>)

private fun pageOf(pages: List<Row>, fact: Row) = pages.firstOrNull { it.id == fact.str("page_id") && it.profile == fact.profile }

// shared/claimActions.ts replaceTarget, checked by shared/fixtures/replace-target.json: the current claim at the end of id's superseded_by chain.
fun replaceTarget(facts: List<Row>, id: String, profile: String): Row? {
    fun alive(at: String) = facts.firstOrNull { it.id == at && it.profile == profile }?.takeIf { !it.deleted && (it.str("state") ?: "live") == "live" }
    val seen = HashSet<String>()
    var f = alive(id)
    while (f != null && seen.add(f.id)) {
        f = f.str("superseded_by")?.ifEmpty { null }?.let { alive(it) } ?: return f
    }
    return null
}

fun replacedClaim(fact: Row, facts: List<Row>, replaces: String? = fact.str("replaces")) = replaces?.let { replaceTarget(facts, it, fact.profile) }

// Approving sets the claim live, its proposed page live, and supersedes the claim it replaces.
fun approveChanges(fact: Row, pages: List<Row>, facts: List<Row>, replaces: String? = fact.str("replaces")): List<Change> {
    val page = pageOf(pages, fact)?.takeIf { it.str("state") == "proposed" }
    val old = replacedClaim(fact, facts, replaces)
    return listOfNotNull(
        Change(fact, mapOf("state" to "live"), mapOf("state" to "proposed")),
        page?.let { Change(it, mapOf("state" to "live"), mapOf("state" to "proposed")) },
        old?.let { Change(it, mapOf("superseded_by" to fact.id), mapOf("superseded_by" to null)) },
    )
}

fun replaceChanges(fact: Row, old: Row, pages: List<Row>, facts: List<Row>) =
    listOf(Change(fact, mapOf("state" to "live", "replaces" to old.id), mapOf("state" to "proposed", "replaces" to null))) + approveChanges(fact, pages, facts, old.id).drop(1)

fun approveAllChanges(list: List<Row>, pages: List<Row>, facts: List<Row>): List<Change> {
    val seen = HashSet<String>()
    var now = facts
    return list.flatMap { fact ->
        val changes = approveChanges(fact, pages, now)
        now = now.map { r -> changes.firstOrNull { it.row.table == "facts" && it.row.key == r.key }?.let { c -> r.copy(f = r.f + c.patch.mapValues { toJson(it.value) }) } ?: r }
        changes.filter { it.row.table != "pages" || seen.add(it.row.key) }
    }
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

    private fun noun(n: Int) = plural(n, "claim")
    fun approve(list: List<Row>) { val s = store.state.value; run(approveAllChanges(list, s.pages, s.facts), "Approved ${noun(list.size)}") }
    fun replace(fact: Row, old: Row) { val s = store.state.value; run(replaceChanges(fact, old, s.pages, s.facts), "Approved 1 claim, replacing the old one") }
    fun edit(fact: Row, text: String) {
        val next = editedClaimText(fact.str("text"), text) ?: return
        run(listOf(Change(fact, mapOf("text" to next), mapOf("text" to fact.str("text")))), "Claim updated")
    }
    fun reject(list: List<Row>) { val s = store.state.value; run(rejectChanges(list, s.pages, s.facts), "Rejected ${noun(list.size)}") }
}
