package no.pradhan.agentview.nativeapp.codex.wiki

import no.pradhan.agentview.nativeapp.codex.CodexStore
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.toJson
import no.pradhan.agentview.nativeapp.ui.UNTITLED
import no.pradhan.agentview.nativeapp.ui.plural

// web/src/codex/data/wiki/wiki.ts approveChanges and rejectChanges and wiki/ReviewList.tsx: deciding proposed claims.
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

// A decided claim records when and, for a rejection, why; Undo clears both.
private val UNDECIDED = mapOf("state" to "proposed", "decided_at" to null, "reject_reason" to null)
private fun decided(state: String, at: Long, reason: String? = null) = mapOf("state" to state, "decided_at" to at, "reject_reason" to reason)

// Approving sets the claim live, its proposed page live, and supersedes the claim it replaces.
fun approveChanges(fact: Row, pages: List<Row>, facts: List<Row>, replaces: String? = fact.str("replaces"), at: Long = System.currentTimeMillis()): List<Change> {
    val page = pageOf(pages, fact)?.takeIf { it.str("state") == "proposed" }
    val old = replacedClaim(fact, facts, replaces)
    return listOfNotNull(
        Change(fact, decided("live", at), UNDECIDED),
        page?.let { Change(it, mapOf("state" to "live"), mapOf("state" to "proposed")) },
        old?.let { Change(it, mapOf("superseded_by" to fact.id), mapOf("superseded_by" to null)) },
    )
}

fun replaceChanges(fact: Row, old: Row, pages: List<Row>, facts: List<Row>, at: Long = System.currentTimeMillis()) =
    listOf(Change(fact, decided("live", at) + ("replaces" to old.id), UNDECIDED + ("replaces" to null))) + approveChanges(fact, pages, facts, old.id, at).drop(1)

fun approveAllChanges(list: List<Row>, pages: List<Row>, facts: List<Row>, at: Long = System.currentTimeMillis()): List<Change> {
    val seen = HashSet<String>()
    var now = facts
    return list.flatMap { fact ->
        val changes = approveChanges(fact, pages, now, at = at)
        now = now.map { r -> changes.firstOrNull { it.row.table == "facts" && it.row.key == r.key }?.let { c -> r.copy(f = r.f + c.patch.mapValues { toJson(it.value) }) } ?: r }
        changes.filter { it.row.table != "pages" || seen.add(it.row.key) }
    }
}

// Rejecting sets the claims rejected with the reason, and every proposed page whose proposals are all in the list.
fun rejectChanges(list: List<Row>, pages: List<Row>, facts: List<Row>, reason: String? = null, at: Long = System.currentTimeMillis()): List<Change> {
    val keys = list.map { it.key }.toSet()
    val left = proposals(facts).filter { it.key !in keys }.map { "${it.profile}:${it.str("page_id")}" }.toSet()
    val hit = list.map { "${it.profile}:${it.str("page_id")}" }.toSet()
    val gone = pages.filter { !it.deleted && it.str("state") == "proposed" && it.key in hit && it.key !in left }
    return list.map { Change(it, decided("rejected", at, reason), UNDECIDED) } + gone.map { Change(it, mapOf("state" to "rejected"), mapOf("state" to "proposed")) }
}

private val CHAT_ADDED_BY = Regex("^(?:claude|openrouter|codex):(.+)$")

// The chat a claim was proposed from, by id; web/src/codex/data/wiki/wiki.ts chatOf says the same.
fun chatOf(f: Row): String? = f.str("added_by")?.let { CHAT_ADDED_BY.find(it)?.groupValues?.get(1) }

data class ProposalSource(val key: String, val label: String)

private val NAMED_SOURCES = mapOf("corrections" to "Draft edits", "voice" to "Your voice", "people" to "People", "you" to "You")

// Where a proposed claim came from, checked by shared/fixtures/proposal-source.json; shared/proposalSource.ts says the same.
fun proposalSource(id: String, addedBy: String?): ProposalSource? {
    if (id.startsWith("learn:")) return ProposalSource("chat", "Chat learning")
    if (id.startsWith("upd:")) return ProposalSource("update", "Decision update")
    val by = addedBy ?: ""
    return when {
        by.isEmpty() -> null
        by.startsWith("faq:") -> ProposalSource(by, "Slack FAQ")
        by in NAMED_SOURCES -> ProposalSource(by, NAMED_SOURCES.getValue(by))
        by.startsWith("slack:") -> ProposalSource("slack", "Slack")
        by.startsWith("pr:") -> ProposalSource("pr", "Pull request")
        else -> ProposalSource("agent", "Agent proposal")
    }
}

val REJECT_REASONS = listOf("Too narrow", "Wrong", "Already known", "Not useful")

data class ReviewFilter(val key: String, val label: String, val count: Int)
class ReviewSection(val key: String, val title: String, val claims: List<Row>)
class ReviewList(val filters: List<ReviewFilter>, val filter: String, val sections: List<ReviewSection>)

// The Review claims list, checked by shared/fixtures/review-batch.json; web/src/codex/data/wiki/wiki.ts reviewList says the same.
fun reviewList(pages: List<Row>, facts: List<Row>, filter: String): ReviewList {
    val list = proposals(facts)
    val alive = pages.filter { !it.deleted }.associateBy { it.key }
    fun pageOf(f: Row) = f.str("page_id")?.ifEmpty { null }?.let { alive["${f.profile}:$it"] }
    fun sourceKey(f: Row) = proposalSource(f.id, f.str("added_by"))?.let { "source:${it.label}" }
    fun isMemory(f: Row) = pageOf(f) == null
    fun isNew(f: Row) = pageOf(f)?.str("state") == "proposed"
    val bySource = LinkedHashMap<String, Int>()
    for (f in list) sourceKey(f)?.let { bySource[it] = (bySource[it] ?: 0) + 1 }
    val chips = (listOf(ReviewFilter("all", "All", list.size)) + bySource.map { (key, n) -> ReviewFilter(key, key.removePrefix("source:"), n) } +
        ReviewFilter("memory", "Memory", list.count(::isMemory)) + ReviewFilter("new", "New pages", list.count(::isNew)))
        .filter { it.key == "all" || it.count > 0 }
    val shown = if (chips.any { it.key == filter }) filter else "all"
    val sections = LinkedHashMap<String, Pair<Row?, MutableList<Row>>>()
    for (f in list) {
        val page = pageOf(f)
        val keep = when (shown) { "all" -> true; "memory" -> isMemory(f); "new" -> isNew(f); else -> sourceKey(f) == shown }
        if (keep) sections.getOrPut(page?.key ?: "memory") { page to ArrayList() }.second.add(f)
    }
    return ReviewList(chips, shown, sections.map { (key, v) ->
        ReviewSection(key, v.first?.let { p -> (p.title?.ifEmpty { null } ?: UNTITLED) + if (p.str("state") == "proposed") " (new page)" else "" } ?: "Memory", v.second)
    }.sortedBy { it.key == "memory" })
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
    fun reject(list: List<Row>, reason: String? = null) { val s = store.state.value; run(rejectChanges(list, s.pages, s.facts, reason), "Rejected ${noun(list.size)}") }
}
