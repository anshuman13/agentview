package no.pradhan.agentview.nativeapp.codex.wiki

import java.time.Instant
import java.util.UUID
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.codex.DAY_MS
import no.pradhan.agentview.nativeapp.codex.PERSONAL
import no.pradhan.agentview.nativeapp.codex.WORK
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.SYNCED_FIELDS
import no.pradhan.agentview.nativeapp.codex.edited
import no.pradhan.agentview.nativeapp.codex.dayLabel
import no.pradhan.agentview.nativeapp.codex.liveRows
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.sessions.matchesWords
import no.pradhan.agentview.nativeapp.sessions.queryWords
import no.pradhan.agentview.nativeapp.ui.UNTITLED
import no.pradhan.agentview.nativeapp.ui.agoShort

// The wiki index and page of web/src/codex/data/wiki.ts and wiki/WikiIndex.tsx.

val SECTION_ORDER = listOf("Teams", "Projects", "People", "Practices")
// RETIRE_AFTER, USED_WITHIN and isOld mirror shared/claimAge.ts, checked by shared/fixtures/claim-age.json.
const val RETIRE_AFTER = 90 * DAY_MS
const val USED_WITHIN = 30 * DAY_MS

class WikiSection(val name: String, val pages: List<Row>)

fun wikiSections(pages: List<Row>): List<WikiSection> {
    val rest = liveRows(pages).filter { it.str("section") != "overview" }
    val names = rest.map { it.str("section")?.ifEmpty { null } ?: "Pages" }.distinct().sortedWith(
        compareBy<String> { SECTION_ORDER.indexOf(it).let { i -> if (i < 0) 99 else i } }.thenBy { it },
    )
    return names.map { n -> WikiSection(n, rest.filter { (it.str("section")?.ifEmpty { null } ?: "Pages") == n }.sortedBy { it.long("sort") ?: 0L }) }
}

// A claim is current unless a live claim supersedes it.
fun currentClaims(facts: List<Row>): (Row) -> Boolean {
    val alive = liveRows(facts).map { it.key }.toSet()
    return { f -> f.str("superseded_by").isNullOrEmpty() || "${f.profile}:${f.str("superseded_by")}" !in alive }
}

// STOP, SIMILAR, keyWords, overlap and similarClaim mirror shared/claimMatch.ts, checked by shared/fixtures/similar-claim.json.
private val STOP = setOf("about", "after", "also", "from", "have", "into", "just", "more", "next", "only", "over", "should", "some", "than", "that", "their", "them", "then", "there", "they", "this", "until", "week", "when", "will", "with", "would")
private val WORD = Regex("[\\p{L}\\p{N}]{4,}")
private const val SIMILAR = 0.6

private fun keyWords(t: String) = WORD.findAll(t.lowercase()).map { it.value }.filter { it !in STOP }.toSet()

private fun overlap(a: Set<String>, b: Set<String>): Double {
    val (short, long) = if (a.size <= b.size) a to b else b to a
    return if (short.isEmpty()) 0.0 else short.count { it in long }.toDouble() / short.size
}

// The claim that overlaps the text most, when it reaches SIMILAR.
fun <T> similarClaim(text: String, claims: List<T>, textOf: (T) -> String): T? {
    val words = keyWords(text)
    var best: T? = null
    var top = SIMILAR
    for (c in claims) {
        val score = overlap(words, keyWords(textOf(c)))
        if (score >= top && (best == null || score > top)) { best = c; top = score }
    }
    return best
}

// The current live claim of the proposal's profile that it repeats, when it names no claim to replace.
fun similarLive(fact: Row, facts: List<Row>): Row? {
    if (!fact.str("replaces").isNullOrEmpty()) return null
    val current = currentClaims(facts)
    return similarClaim(fact.str("text") ?: "", liveRows(facts).filter { it.profile == fact.profile && current(it) }) { it.str("text") ?: "" }
}

// The current live Memory claim (no page) of the profile that the remembered text overlaps; web wiki.ts restatedClaim says the same, checked by shared/fixtures/remember.json.
fun restatedClaim(text: String, facts: List<Row>, profile: String): Row? {
    val current = currentClaims(facts)
    return similarClaim(text, liveRows(facts).filter { it.profile == profile && it.str("page_id").isNullOrEmpty() && current(it) }) { it.str("text") ?: "" }
}

const val MEMORY = "memory"

// The Memory page of web/src/codex/wiki/shared.ts memoryPage: it holds the claims with no page.
fun memoryPage(facts: List<Row>): Row = Row(
    "pages", MEMORY, WORK,
    updatedAt = liveRows(facts).filter { it.str("page_id").isNullOrEmpty() }.maxOfOrNull(::factTime) ?: 0L,
    f = mapOf("title" to JsonPrimitive("Memory"), "summary" to JsonPrimitive("What Claude remembers about you and your work outside the wiki pages.")),
)

class PageStats(val claims: Int, val contested: Int, val updated: Long)

fun statsByPage(facts: List<Row>): Map<String?, PageStats> {
    val current = currentClaims(facts)
    val out = LinkedHashMap<String?, PageStats>()
    for (f in liveRows(facts)) {
        if (!current(f)) continue
        val k = f.str("page_id")?.ifEmpty { null }
        val s = out[k]
        out[k] = PageStats((s?.claims ?: 0) + 1, (s?.contested ?: 0) + if (f.str("contested") != null) 1 else 0, maxOf(s?.updated ?: 0L, factTime(f)))
    }
    return out
}

class Source(val kind: String, val label: String, val url: String?) {
    val icon get() = when (kind) { "slack", "chat" -> "comment-discussion"; "linear" -> "issues"; "pr" -> "git-pull-request"; "doc" -> "file"; else -> "calendar" }
    val kindLabel get() = when (kind) { "slack" -> "Slack"; "linear" -> "Linear"; "pr" -> "PR"; "doc" -> "Doc"; "meeting" -> "Meeting"; "chat" -> "Chat"; else -> kind }
}

fun sourcesOf(f: Row): List<Source> = runCatching {
    (protocolJson.parseToJsonElement(f.str("sources") ?: "[]") as JsonArray).mapNotNull {
        val o = it as? JsonObject ?: return@mapNotNull null
        val label = (o["label"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
        Source((o["kind"] as? JsonPrimitive)?.contentOrNull ?: "", label, (o["url"] as? JsonPrimitive)?.contentOrNull)
    }
}.getOrDefault(emptyList())

// The sources column of a claim saved from a chat: web/src/codex/data/wiki/wiki.ts chatSource.
fun chatSource(title: String, cwd: String): String =
    buildJsonArray { add(buildJsonObject { put("kind", "chat"); put("label", "${title.ifBlank { "chat" }} · ${cwd.trimEnd('/').substringAfterLast('/')}") }) }.toString()

// A new claim of web/src/codex/data/wiki/wiki.ts newFact; null for blank text, so nothing is saved.
fun newFact(text: String, pageId: String?, profile: String, now: Long, state: String = "proposed", sources: String? = null, id: String = UUID.randomUUID().toString()): Row? {
    val body = text.trim().ifEmpty { return null }
    val values = mutableMapOf<String, Any?>("text" to body, "page_id" to pageId, "at" to now, "state" to state, "added_by" to "you")
    if (sources != null) values["sources"] = sources
    val blank = Row("facts", id, profile, updatedAt = now, f = SYNCED_FIELDS.getValue("facts").associateWith { JsonNull })
    return edited(blank, values, now).let { r -> r.copy(times = r.times.mapValues { now }) }
}

// A live Memory claim saved on the Memory page: trimmed, at most 400 characters, no source; null when blank (web wiki.ts memoryClaim).
fun memoryClaim(text: String, profile: String, now: Long): Row? = newFact(text.trim().take(400), null, profile, now, "live")

// The text an edited claim saves: trimmed, null when blank or unchanged (shared/claimEdit.ts, checked by shared/fixtures/claim-edit.json).
fun editedClaimText(old: String?, next: String): String? = next.trim().takeIf { it.isNotEmpty() && it != old }

// A proposal's profile: the page's, else the filter's (web usePageEdits propose).
fun proposalProfile(page: Row?, filter: String?): String = page?.profile ?: if (filter == PERSONAL) PERSONAL else WORK

class Contest(val by: String, val at: Long, val note: String)

fun contestOf(f: Row): Contest? = runCatching {
    val o = protocolJson.parseToJsonElement(f.str("contested") ?: return null) as JsonObject
    Contest((o["by"] as? JsonPrimitive)?.contentOrNull ?: "", (o["at"] as? JsonPrimitive)?.content?.toDouble()?.toLong() ?: 0L, (o["note"] as? JsonPrimitive)?.contentOrNull ?: "")
}.getOrNull()

class ClaimActions(val buttons: List<String>, val menu: List<String>)

// At most two controls per claim row (shared/claimActions.ts, checked by shared/fixtures/claim-actions.json).
fun claimActions(f: Row, stale: Boolean): ClaimActions {
    val menu = buildList {
        add("edit")
        add("cite")
        add(if (contestOf(f) == null) "contest" else "resolve")
        add(if (f.str("state") == "retired") "restore" else "retire")
    }
    return when {
        stale -> ClaimActions(listOf("confirm", "more"), menu)
        f.str("state") == "proposed" -> ClaimActions(listOf("reject", "approve"), emptyList())
        else -> ClaimActions(listOf("more"), menu)
    }
}

fun factTime(f: Row) = maxOf(f.long("at") ?: 0L, contestOf(f)?.at ?: 0L, f.updatedAt)

fun isOld(f: Row, now: Long): Boolean {
    val at = f.long("at")
    val usedAt = f.long("used_at")
    return f.str("state") == "retired" || (f.str("state") != "proposed" && at != null && at > 0 && now - at > RETIRE_AFTER && !(usedAt != null && usedAt > 0 && now - usedAt <= USED_WITHIN))
}

const val PREFERENCES = 15
const val PREFERENCE_CHARS = 1500

// The profile's Memory claims that chats get; mirrors shared/preferences.ts givenPreferences, checked by shared/fixtures/preferences.json.
fun givenPreferences(facts: List<Row>, profile: String, now: Long): List<Row> {
    val live = liveRows(facts).filter { it.profile == profile && it.str("page_id").isNullOrEmpty() && it.str("superseded_by").isNullOrEmpty() && it.str("contested").isNullOrEmpty() && !isOld(it, now) && it.str("text") != null }
    val given = ArrayList<Row>()
    var chars = 0
    for (f in live.sortedByDescending { it.long("at") ?: 0L }.take(PREFERENCES)) {
        val length = "- ${f.str("text")!!.replace(Regex("\\s+"), " ").trim()}".length
        if (chars + length > PREFERENCE_CHARS) break
        given.add(f)
        chars += length
    }
    return given
}

// The Memory claims on the page's main list that chats do not get, by key.
fun ungivenPreferences(facts: List<Row>, now: Long): Set<String> {
    val given = facts.map { it.profile }.distinct().flatMap { p -> givenPreferences(facts, p, now).map { it.key } }.toSet()
    val current = currentClaims(facts)
    return liveRows(facts).filter { it.str("page_id").isNullOrEmpty() && current(it) && it.str("contested").isNullOrEmpty() && !isOld(it, now) && it.key !in given }.map { it.key }.toSet()
}

class Claim(val fact: Row, val old: List<Row>)
class ClaimGroup(val heading: String, val claims: List<Claim>)

fun proposals(facts: List<Row>) = facts.filter { !it.deleted && it.str("state") == "proposed" }.sortedByDescending { it.long("at") ?: 0L }

// Current claims newest first under each heading, headings with the newest claim first, each claim with the claims it replaced.
fun pageClaims(facts: List<Row>, pageId: String?, now: Long): List<ClaimGroup> {
    val all = liveRows(facts)
    val current = currentClaims(facts)
    val byKey = all.associateBy { it.key }
    val mine = all.filter { it.str("page_id")?.ifEmpty { null } == pageId }
    val replaced = HashMap<String, MutableList<Row>>()
    for (f in mine) {
        if (current(f)) continue
        var top: Row? = f
        val seen = HashSet<String>()
        while (top != null && !current(top) && seen.add(top.key)) top = byKey["${top.profile}:${top.str("superseded_by")}"]
        if (top != null && current(top)) replaced.getOrPut(top.key) { ArrayList() }.add(f)
    }
    val groups = LinkedHashMap<String, MutableList<Claim>>()
    fun add(f: Row, old: List<Row>) { groups.getOrPut(f.str("heading")?.ifEmpty { null } ?: "Notes") { ArrayList() }.add(Claim(f, old)) }
    for (f in mine.filter { current(it) && !isOld(it, now) }) add(f, (replaced[f.key] ?: emptyList<Row>()).sortedByDescending { it.long("at") ?: 0L })
    for (f in proposals(facts).filter { it.str("page_id")?.ifEmpty { null } == pageId }) add(f, emptyList())
    fun newest(g: List<Claim>) = g.maxOf { it.fact.long("at") ?: 0L }
    return groups.map { (h, cs) -> ClaimGroup(h, cs.sortedByDescending { it.fact.long("at") ?: 0L }) }.sortedByDescending { newest(it.claims) }
}

fun hasLiveClaims(groups: List<ClaimGroup>) = groups.any { g -> g.claims.any { it.fact.str("state") != "proposed" } }

// The page as Markdown: web/src/codex/data/wiki/wikiMarkdown.ts, checked by shared/fixtures/wiki-markdown.json.
fun wikiMarkdown(title: String?, groups: List<ClaimGroup>): String {
    val out = mutableListOf("# ${title?.ifEmpty { null } ?: UNTITLED}")
    for (g in groups) {
        val live = g.claims.filter { it.fact.str("state") != "proposed" }
        if (live.isEmpty()) continue
        val lines = live.map { c ->
            val labels = sourcesOf(c.fact).map { it.label }.distinct()
            "- ${c.fact.str("text") ?: ""}" + if (labels.isNotEmpty()) "\n  Sources: ${labels.joinToString(", ")}" else ""
        }
        out.add("## ${g.heading}\n\n${lines.joinToString("\n")}")
    }
    return out.joinToString("\n\n") + "\n"
}

// The prompt Ask on a wiki page sends: web/src/codex/data/ask/ask.ts wikiAskText, checked by shared/fixtures/wiki-ask.json.
fun wikiAskText(question: String, pages: List<Row>, facts: List<Row>, pageId: String?, now: Long): String {
    val title = pages.associate { it.id to (it.str("title") ?: "") }
    val current = currentClaims(facts)
    val claims = liveRows(facts)
        .filter { current(it) && !isOld(it, now) && (pageId.isNullOrEmpty() || it.str("page_id") == pageId) }
        .sortedByDescending { factTime(it) }
        .take(200)
        .map { f ->
            val at = f.long("at")?.takeIf { it != 0L }?.let { " ${Instant.ofEpochMilli(it).toString().take(10)}:" } ?: ""
            val labels = sourcesOf(f).map { it.label }
            "- [${title[f.str("page_id") ?: ""]?.ifEmpty { null } ?: "Memory"}]$at ${f.str("text") ?: ""}" +
                (if (labels.isNotEmpty()) " (${labels.joinToString(", ")})" else "") +
                if (f.str("contested").isNullOrEmpty()) "" else " (contested)"
        }
    val heading = if (pageId.isNullOrEmpty()) "Claims in my team wiki" else "Claims on the wiki page \"${title[pageId]}\""
    return listOf(
        question,
        "\n$heading:\n${claims.joinToString("\n")}",
        "\nAnswer from these claims first and name the claims you used; use my Slack, Linear and Calendar connectors when they are not enough.",
    ).joinToString("\n")
}

class ClaimSpot(val index: Int, val openOlder: Boolean)

// The WikiPageView LazyColumn index of a claim (the title item, then each group's header and claims, then the Not used by Claude header and its claims), and whether Older must open to show it; null when the page has no such claim.
fun claimItemIndex(groups: List<ClaimGroup>, older: List<Row>, showOlder: Boolean, id: String): ClaimSpot? {
    var at = 1
    for (g in groups) {
        val i = g.claims.indexOfFirst { it.fact.id == id }
        if (i >= 0) return ClaimSpot(at + 1 + i, false)
        at += 1 + g.claims.size
    }
    val i = older.indexOfFirst { it.id == id }
    return if (i >= 0) ClaimSpot(at + 1 + i, !showOlder) else null
}

// Retired claims and current ones past RETIRE_AFTER, newest first.
fun olderClaims(facts: List<Row>, pageId: String?, now: Long): List<Row> {
    val current = currentClaims(facts)
    return facts.filter { f ->
        !f.deleted && f.str("page_id")?.ifEmpty { null } == pageId &&
            (f.str("state") == "retired" || ((f.str("state") ?: "live") == "live" && current(f))) && isOld(f, now)
    }.sortedByDescending { it.long("at") ?: 0L }
}

// Current claims on a live page that are old and that no live meeting of the last RETIRE_AFTER about the page's title touches, oldest first (web wiki.ts staleFacts, checked by shared/fixtures/stale-claims.json).
fun staleFacts(facts: List<Row>, pages: List<Row>, meetings: List<Row>, now: Long): List<Row> {
    val current = currentClaims(facts)
    val titles = liveRows(pages).associate { it.key to it.title }
    val recent = liveRows(meetings).filter { (it.long("starts_at") ?: 0L) > now - RETIRE_AFTER }
    val touched = HashMap<String, Boolean>()
    fun mentioned(key: String) = touched.getOrPut(key) {
        val words = queryWords(titles[key] ?: "")
        recent.any { matchesWords(words, it.title, it.str("summary"), it.str("decisions")) }
    }
    return liveRows(facts).filter { f ->
        val key = "${f.profile}:${f.str("page_id")}"
        !f.str("page_id").isNullOrEmpty() && key in titles && current(f) && isOld(f, now) && !mentioned(key)
    }.sortedBy { it.long("at") ?: 0L }
}

class WikiHits(val pages: List<Row>, val claims: List<Row>)

fun searchWiki(pages: List<Row>, facts: List<Row>, query: String): WikiHits {
    val w = queryWords(query)
    if (w.isEmpty()) return WikiHits(emptyList(), emptyList())
    val current = currentClaims(facts)
    return WikiHits(
        liveRows(pages).filter { matchesWords(w, it.title, it.str("summary")) },
        facts.filter { f -> !f.deleted && (f.str("state") == "retired" || ((f.str("state") ?: "live") == "live" && current(f))) && matchesWords(w, f.str("text"), *sourcesOf(f).map { it.label }.toTypedArray()) },
    )
}

fun pageNeedsReview(page: Row, facts: List<Row>) = page.str("state") == "proposed" || facts.any { !it.deleted && it.str("state") == "proposed" && it.str("page_id") == page.id }

fun agoText(t: Long, now: Long): String = agoShort(t, now, " ago")

fun shortDate(t: Long, now: Long): String = when {
    now - t < DAY_MS -> agoText(t, now)
    now - t < 2 * DAY_MS -> "yesterday"
    else -> dayLabel(t)
}
