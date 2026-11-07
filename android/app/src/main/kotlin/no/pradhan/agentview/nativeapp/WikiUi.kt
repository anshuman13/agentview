package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle

private fun pageRoute(r: Row) = "${r.profile}:${r.id}"

@Composable
fun WikiIndexPage(st: CodexState, profile: String?, now: Long, onOpen: (Row) -> Unit, onClaim: (Row) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    val pages = remember(st.pages, profile) { st.pages.filter { matchesProfile(profile, it) } }
    val facts = remember(st.facts, profile) { st.facts.filter { matchesProfile(profile, it) } }
    val overview = remember(pages) { liveRows(pages).firstOrNull { it.str("section") == "overview" } }
    val sections = remember(pages) { wikiSections(pages) }
    val stats = remember(facts) { statsByPage(facts) }
    val hits = remember(pages, facts, query) { searchWiki(pages, facts, query) }
    val titles = remember(pages) { pages.associate { it.id to it.title } }
    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = Sp.s6), placeholder = { Text("Search the wiki") }, singleLine = true,
                trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Filled.Close, "Clear") } })
        }
        if (query.isNotBlank()) {
            if (hits.pages.isEmpty() && hits.claims.isEmpty()) item { Empty("Nothing in the wiki matches “$query”") }
            if (hits.pages.isNotEmpty()) {
                item { SectionHeader("Pages", hits.pages.size.toString()) }
                item { Group { hits.pages.forEachIndexed { i, p -> if (i > 0) Hairline(); PlainRow(p.title ?: "", p.str("summary")?.let { firstLine(it) }, onClick = { onOpen(p) }) } } }
            }
            if (hits.claims.isNotEmpty()) {
                item { SectionHeader("Claims", hits.claims.size.toString()) }
                item { Group { hits.claims.take(30).forEachIndexed { i, f -> if (i > 0) Hairline(); PlainRow(f.str("text") ?: "", f.str("page_id")?.let { titles[it] } ?: "Memory", onClick = { onClaim(f) }) } } }
            }
            return@LazyColumn
        }
        overview?.let { o ->
            item { Group(Modifier.padding(top = Sp.s6)) { PlainRow(o.title ?: "Overview", o.str("summary")?.let { firstLine(it) }, onClick = { onOpen(o) }) } }
        }
        if (sections.isEmpty() && overview == null) item { Empty("No pages yet") }
        sections.forEach { s ->
            item { SectionHeader(s.name, s.pages.size.toString()) }
            item {
                Group {
                    s.pages.forEachIndexed { i, p ->
                        if (i > 0) Hairline()
                        val n = stats[p.id]?.claims ?: 0
                        PlainRow(p.title ?: "Untitled", "$n ${if (n == 1) "claim" else "claims"}" + if (profile == null) " · ${profileLabel(p.profile)}" else "", onClick = { onOpen(p) },
                            trailing = { if (pageNeedsReview(p, facts)) Text("Needs you", style = MaterialTheme.typography.labelSmall, color = av.warn, modifier = Modifier.padding(end = Sp.s4)) })
                    }
                }
            }
        }
        item { Spacer(Modifier.padding(bottom = Sp.s16)) }
    }
}

@Composable
private fun ClaimRow(c: Claim, now: Long, stale: Boolean = false) {
    val f = c.fact
    val contest = contestOf(f)
    val meta: AnnotatedString = buildAnnotatedString {
        val bits = ArrayList<String>()
        if (f.str("state") == "proposed") bits.add("Proposed")
        if (contest != null) bits.add("Contested by ${contest.by} - ${agoText(contest.at, now)}")
        sourcesOf(f).forEach { bits.add(it.label) }
        if (stale) bits.add("Still true?")
        f.long("at")?.let { bits.add(shortDate(it, now)) }
        append(bits.joinToString(" · "))
    }
    Column {
        PlainRow(f.str("text") ?: "", meta)
        contest?.note?.takeIf { it.isNotEmpty() }?.let { Text(it, Modifier.padding(start = Sp.s8, end = Sp.s4, bottom = Sp.s3), style = MaterialTheme.typography.labelMedium, color = av.warn) }
        c.old.forEach { o ->
            Text(buildAnnotatedString {
                withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(o.str("text") ?: "") }
                o.long("at")?.let { append("  Replaced ${shortDate(it, now)}") }
            }, Modifier.padding(start = Sp.s8, end = Sp.s4, bottom = Sp.s3), style = MaterialTheme.typography.labelMedium, color = av.fgFaint)
        }
    }
}

@Composable
fun WikiPageView(st: CodexState, page: Row, now: Long) {
    val facts = remember(st.facts, page.profile) { st.facts.filter { it.profile == page.profile } }
    val groups = remember(facts, page.id, now / 60_000) { pageClaims(facts, page.id, now) }
    val older = remember(facts, page.id, now / 60_000) { olderClaims(facts, page.id, now) }
    val stat = remember(facts) { statsByPage(facts)[page.id] }
    var showOlder by rememberSaveable(page.key) { mutableStateOf(false) }
    val staleIds = older.filter { it.str("state") != "retired" }.map { it.id }.toSet()
    val section = page.str("section")?.takeIf { it.isNotEmpty() && it != "overview" }
    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            Text(page.title ?: "Untitled", Modifier.padding(start = Sp.s8, end = Sp.s4, top = Sp.s4), style = MaterialTheme.typography.titleLarge)
            val n = stat?.claims ?: 0
            val chips = listOfNotNull(
                section, "$n ${if (n == 1) "claim" else "claims"}",
                stat?.updated?.takeIf { it > 0 }?.let { "Updated ${shortDate(maxOf(page.updatedAt, it), now)}" },
                stat?.contested?.takeIf { it > 0 }?.let { "$it contested" },
            )
            Text(chips.joinToString(" · "), Modifier.padding(horizontal = Sp.s8, vertical = Sp.s2), style = MaterialTheme.typography.labelMedium, color = av.fgMuted)
            page.str("summary")?.takeIf { it.isNotEmpty() }?.let { Text(it, Modifier.padding(horizontal = Sp.s8, vertical = Sp.s2), style = MaterialTheme.typography.bodyMedium, color = av.fg) }
        }
        groups.forEach { g ->
            item { SectionHeader(g.heading, g.claims.size.toString()) }
            item { Group { g.claims.forEachIndexed { i, c -> if (i > 0) Hairline(); ClaimRow(c, now) } } }
        }
        if (older.isNotEmpty()) {
            item { SectionHeader("Older", older.size.toString(), action = { TextButton(onClick = { showOlder = !showOlder }) { Text(if (showOlder) "Hide" else "Show") } }) }
            if (showOlder) {
                item { Text("Retired or over 90 days old. Claude does not use these.", Modifier.padding(horizontal = Sp.s8, vertical = Sp.s2), style = MaterialTheme.typography.labelMedium, color = av.fgFaint) }
                item { Group { older.forEachIndexed { i, f -> if (i > 0) Hairline(); ClaimRow(Claim(f, emptyList()), now, stale = f.id in staleIds) } } }
            }
        }
        if (groups.isEmpty() && older.isEmpty()) item { Empty("No claims yet", "They appear here as meetings, Slack threads and issues mention ${page.title}") }
        item { Spacer(Modifier.padding(bottom = Sp.s16)) }
    }
}
