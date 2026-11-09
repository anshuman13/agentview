package no.pradhan.agentview.nativeapp.codex.wiki

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row as LayoutRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.app.icon
import no.pradhan.agentview.nativeapp.chat.firstLine
import no.pradhan.agentview.nativeapp.codex.CodexState
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.TaskActions
import no.pradhan.agentview.nativeapp.codex.firstLine
import no.pradhan.agentview.nativeapp.codex.matchesProfile
import no.pradhan.agentview.nativeapp.codex.meetings.liveRows
import no.pradhan.agentview.nativeapp.codex.meetings.safeHref
import no.pradhan.agentview.nativeapp.codex.profileLabel
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.FieldLabel
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MenuSeparator
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SearchField
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.lazyGroup

@Composable
fun WikiIndexPage(st: CodexState, profile: String?, now: Long, onOpen: (Row) -> Unit, onClaim: (Row) -> Unit, onReview: () -> Unit) {
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
            SearchField(query, { query = it }, "Search the wiki", Modifier.padding(top = Tokens.sp4))
        }
        if (query.isNotBlank()) {
            if (hits.pages.isEmpty() && hits.claims.isEmpty()) item { EmptyState("Nothing in the wiki matches “$query”") }
            if (hits.pages.isNotEmpty()) {
                item { SectionHeader("Pages", hits.pages.size.toString()) }
                item { Group { hits.pages.forEachIndexed { i, p -> if (i > 0) Hairline(); ListRow(p.title ?: "", p.str("summary")?.let { firstLine(it) }, onClick = { onOpen(p) }) } } }
            }
            if (hits.claims.isNotEmpty()) {
                item { SectionHeader("Claims", hits.claims.size.toString()) }
                item { Group { hits.claims.take(30).forEachIndexed { i, f -> if (i > 0) Hairline(); ListRow(f.str("text") ?: "", f.str("page_id")?.let { titles[it] } ?: "Memory", onClick = { onClaim(f) }) } } }
            }
            return@LazyColumn
        }
        val waiting = proposals(facts).size
        if (waiting > 0) {
            item { Group { ListRow("Review claims", onClick = onReview, trailing = { Badge("$waiting", BadgeTone.Quiet); Chevron() }) } }
        }
        overview?.let { o ->
            item { Group(Modifier.padding(top = Tokens.sp4)) { ListRow(o.title ?: "Overview", o.str("summary")?.let { firstLine(it) }, onClick = { onOpen(o) }) } }
        }
        if (sections.isEmpty() && overview == null) item { EmptyState("No pages yet") }
        sections.forEach { s ->
            item { SectionHeader(s.name, s.pages.size.toString()) }
            item {
                Group {
                    s.pages.forEachIndexed { i, p ->
                        if (i > 0) Hairline()
                        val n = stats[p.id]?.claims ?: 0
                        ListRow(p.title ?: "Untitled", "$n ${if (n == 1) "claim" else "claims"}" + if (profile == null) " · ${profileLabel(p.profile)}" else "", onClick = { onOpen(p) },
                            trailing = { if (pageNeedsReview(p, facts)) Badge("Needs you", BadgeTone.Waiting) })
                    }
                }
            }
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
}

@Composable
private fun ClaimRow(c: Claim, now: Long, actions: TaskActions, page: String, stale: Boolean = false) {
    val f = c.fact
    val menu = remember(f.key) { mutableStateOf(false) }
    var note by remember(f.key) { mutableStateOf("") }
    val clip = LocalClipboardManager.current
    val uri = LocalUriHandler.current
    val contest = contestOf(f)
    val proposed = f.str("state") == "proposed"
    var expanded by remember(f.key) { mutableStateOf(false) }
    val meta: AnnotatedString = buildAnnotatedString {
        if (contest != null) {
            withStyle(SpanStyle(color = av.warn)) { append(contest.note.takeIf { it.isNotEmpty() } ?: "Contested by ${contest.by} - ${agoText(contest.at, now)}") }
        } else {
            val bits = ArrayList<String>()
            if (!proposed) {
                if (stale) bits.add("Still true?")
                sourcesOf(f).firstOrNull()?.let { bits.add(it.label) }
                f.long("at")?.let { bits.add(shortDate(it, now)) }
            }
            append(bits.joinToString(" · "))
        }
    }
    var contesting by remember(f.key) { mutableStateOf(false) }
    val retired = f.str("state") == "retired"
    val links = sourcesOf(f).drop(1).mapNotNull { s -> safeHref(s.url)?.let { s to it } }
    val menuContent: @Composable ColumnScope.(() -> Unit) -> Unit = { dismiss ->
        val pick = { act: () -> Unit -> { dismiss(); act() } }
        MenuItem("Cite", "link", pick {
            val srcs = sourcesOf(f).map { it.label }
            val at = f.long("at")?.let { ", ${shortDate(it, now)}" } ?: ""
            clip.setText(AnnotatedString("$page: ${f.str("text") ?: ""}" + if (srcs.isNotEmpty()) " (${srcs.joinToString(", ")}$at)" else ""))
            actions.say("Claim copied")
        })
        if (contest == null) MenuItem("Contest", "report", pick { contesting = true })
        else MenuItem("Resolve", "check", pick { actions.change(f, mapOf("contested" to null), "Marked as resolved") })
        if (links.isNotEmpty()) MenuSeparator()
        links.forEach { (s, href) -> MenuItem("${s.kindLabel}: ${s.label}", s.icon, pick { uri.openUri(href) }) }
        c.old.forEach { o -> MenuItem("Replaced ${o.long("at")?.let { shortDate(it, now) } ?: ""}".trim(), "history", {}, enabled = false) }
        f.long("at")?.let { MenuSeparator(); MenuItem("${if (stale) "Still true? " else ""}Updated ${shortDate(it, now)}", "history", {}, enabled = false) }
        MenuItem(if (retired) "Restore" else "Retire", if (retired) "history" else "archive", pick { actions.change(f, mapOf("state" to if (retired) null else "retired"), if (retired) "Claim restored" else "Claim retired") }, danger = !retired)
    }
    Column {
        ListRow(f.str("text") ?: "", meta, lines = if (expanded) Int.MAX_VALUE else 3, metaLines = if (contest != null) 2 else 1, onClick = { expanded = !expanded }, onLongClick = if (proposed) null else ({ menu.value = true }),
            trailing = if (proposed) ({ Badge("New", BadgeTone.New) }) else ({ MoreButton(expanded = menu, content = menuContent) }))
        if (contesting) Sheet({ contesting = false }, "Contest claim", full = false) {
            FieldLabel("Why is this claim wrong?")
            TextField(note, { note = it }, Modifier.padding(vertical = Tokens.sp4), placeholder = "What is wrong or out of date? Link a source if you have one.", minLines = 2)
            LayoutRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4, Alignment.End)) {
                Button("Cancel", { contesting = false; note = "" }, variant = ButtonVariant.Plain)
                Button("Contest", {
                    contesting = false
                    actions.change(f, mapOf("contested" to protocolJson.encodeToString(JsonObject.serializer(), buildJsonObject { put("by", "you"); put("at", now); put("note", note.trim()) })), "Claim contested")
                    note = ""
                }, variant = ButtonVariant.Filled)
            }
        }
    }
}

@Composable
fun WikiPageView(st: CodexState, page: Row, now: Long, actions: TaskActions) {
    val facts = remember(st.facts, page.profile) { st.facts.filter { it.profile == page.profile } }
    val groups = remember(facts, page.id, now / 60_000) { pageClaims(facts, page.id, now) }
    val older = remember(facts, page.id, now / 60_000) { olderClaims(facts, page.id, now) }
    val stat = remember(facts) { statsByPage(facts)[page.id] }
    var showOlder by rememberSaveable(page.key) { mutableStateOf(false) }
    val staleIds = older.filter { it.str("state") != "retired" }.map { it.id }.toSet()
    var summaryOpen by rememberSaveable(page.key) { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            Column(Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, top = Tokens.sp8, bottom = Tokens.sp8), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                Text(page.title ?: "Untitled", style = Type.title)
                val n = stat?.claims ?: 0
                val meta = listOfNotNull(
                    "$n ${if (n == 1) "claim" else "claims"}",
                    stat?.updated?.takeIf { it > 0 }?.let { "Updated ${shortDate(maxOf(page.updatedAt, it), now)}" },
                )
                Text(meta.joinToString(" · "), style = Type.subheadline, color = av.fgMuted, maxLines = 1)
                page.str("summary")?.takeIf { it.isNotEmpty() }?.let {
                    Text(it, Modifier.clickable { summaryOpen = !summaryOpen }, style = Type.body, color = av.fg, maxLines = if (summaryOpen) Int.MAX_VALUE else 3, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        groups.forEach { g ->
            item { SectionHeader(g.heading, g.claims.size.toString()) }
            lazyGroup(g.claims, key = { it.fact.key }) { ClaimRow(it, now, actions, page.title ?: "") }
        }
        if (older.isNotEmpty()) {
            item { SectionHeader("Not used by the agent", older.size.toString(), open = showOlder, onToggle = { showOlder = !showOlder }) }
            if (showOlder) lazyGroup(older, key = { "old:${it.key}" }) { ClaimRow(Claim(it, emptyList()), now, actions, page.title ?: "", stale = it.id in staleIds) }
        }
        if (groups.isEmpty() && older.isEmpty()) item { EmptyState("No claims yet", "Claims come from meetings and threads", icon = "book") }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
}
