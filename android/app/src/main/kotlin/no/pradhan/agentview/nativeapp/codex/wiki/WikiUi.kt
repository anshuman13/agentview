package no.pradhan.agentview.nativeapp.codex.wiki

import no.pradhan.agentview.nativeapp.ui.UNTITLED
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row as LayoutRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.delay
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import no.pradhan.agentview.nativeapp.codex.DAY_MS
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.TaskActions
import no.pradhan.agentview.nativeapp.codex.dayLabel
import no.pradhan.agentview.nativeapp.codex.firstLine
import no.pradhan.agentview.nativeapp.codex.matchesProfile
import no.pradhan.agentview.nativeapp.codex.liveRows
import no.pradhan.agentview.nativeapp.codex.profileLabel
import no.pradhan.agentview.nativeapp.codex.split
import no.pradhan.agentview.nativeapp.codex.splitTitle
import no.pradhan.agentview.nativeapp.sessions.matchesWords
import no.pradhan.agentview.nativeapp.sessions.queryWords
import no.pradhan.agentview.nativeapp.codex.meetings.safeHref
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
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
import no.pradhan.agentview.nativeapp.ui.SerifTitle
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.TextDialog
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.agoShort
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.lazyGroup
import kotlin.math.abs
import no.pradhan.agentview.nativeapp.ui.plural

// A coloured tile for a page, the colour fixed by its id and the icon by its section.
@Composable
private fun PageTile(p: Row) {
    val hues = listOf(av.hueTeal, av.hueViolet, av.hueBlue, av.hueAmber, av.hueMagenta, av.hueSky)
    val hue = hues[(abs(p.id.hashCode().toLong()) % hues.size).toInt()]
    val glyph = when (p.str("section")) { "Company" -> "organization"; "Directory" -> "person"; "Domain" -> "symbol-namespace"; else -> "file" }
    Box(Modifier.size(Tokens.leadWidth + Tokens.sp2).clip(RoundedCornerShape(Tokens.shapeMd)).background(hue.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
        AvIcon(glyph, null, tint = hue)
    }
}

@Composable
fun WikiIndexPage(st: CodexState, profile: String?, now: Long, actions: TaskActions, readOnly: Boolean, onOpen: (Row) -> Unit, onClaim: (Row) -> Unit, onReview: () -> Unit, onMemory: () -> Unit, onAsk: ((String) -> Unit)?) {
    var query by rememberSaveable { mutableStateOf("") }
    val pages = remember(st.pages, profile) { st.pages.filter { matchesProfile(profile, it) } }
    val facts = remember(st.facts, profile) { st.facts.filter { matchesProfile(profile, it) } }
    val overview = remember(pages) { liveRows(pages).firstOrNull { it.str("section") == "overview" } }
    val sections = remember(pages) { wikiSections(pages) }
    val stats = remember(facts) { statsByPage(facts) }
    val hits = remember(pages, facts, query) { searchWiki(pages, facts, query) }
    val titles = remember(pages) { pages.associate { it.id to it.title } }
    val meetings = remember(st.meetings, profile) { st.meetings.filter { matchesProfile(profile, it) } }
    val stale = remember(pages, facts, meetings, now / 60_000) { staleFacts(facts, pages, meetings, now) }
    val drift = remember(pages, facts, meetings, now / 60_000) { driftFacts(facts, pages, meetings, now) }
    var lookOpen by remember { mutableStateOf(false) }
    var allStale by rememberSaveable { mutableStateOf(false) }
    var allDrift by rememberSaveable { mutableStateOf(false) }
    var asking by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var feedOpen by remember { mutableStateOf(false) }
    val archived = remember(pages) { archivedPages(pages) }
    var archivedOpen by remember { mutableStateOf(false) }
    LaunchedEffect(archived.isEmpty()) { if (archived.isEmpty()) archivedOpen = false }
    var claimsShown by rememberSaveable(query) { mutableStateOf(CLAIMS_SHOWN) }
    var notesOpen by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<Row?>(null) }
    val notes = remember(st.items, profile) { split(st.items, profile, now).notes }
    val noteHits = remember(notes, query) { queryWords(query).let { w -> notes.filter { matchesWords(w, it.title, it.text) } } }
    val waiting = remember(facts) { proposals(facts).size }
    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            LayoutRow(Modifier.padding(top = Tokens.sp4, end = Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
                SearchField(query, { query = it }, "Search the wiki", Modifier.weight(1f))
                IconBtn("history", "Feed", { feedOpen = true })
                IconBtn("note", "Notes", { notesOpen = true })
                if (onAsk != null) IconBtn("sparkle", "Ask", { asking = true })
            }
        }
        if (query.isNotBlank()) {
            if (hits.pages.isEmpty() && hits.claims.isEmpty()) item {
                EmptyState("Nothing in the wiki matches “$query”", onAsk?.let { "Ask sends it to today's Codex chat with every claim" }, icon = "search",
                    action = onAsk?.let { ask -> { Button("Ask the wiki", { ask(wikiAskText(query.trim(), pages, facts, null, now)) }, size = ButtonSize.Sm) } })
            }
            if (hits.pages.isNotEmpty()) {
                item { SectionHeader("Pages", hits.pages.size.toString()) }
                item { Group { hits.pages.forEachIndexed { i, p -> if (i > 0) Hairline(); ListRow(p.title ?: "", p.str("summary")?.let { firstLine(it) }, onClick = { onOpen(p) }) } } }
            }
            if (hits.claims.isNotEmpty()) {
                item { SectionHeader("Claims", hits.claims.size.toString()) }
                item { Group { hits.claims.take(claimsShown).forEachIndexed { i, f -> if (i > 0) Hairline(); ListRow(f.str("text") ?: "", f.str("page_id")?.let { titles[it] } ?: "Memory", onClick = { onClaim(f) }) } } }
                val left = hits.claims.size - claimsShown
                if (left > 0) item { Button("Show more ($left)", { claimsShown += CLAIMS_SHOWN }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm) }
            }
            if (noteHits.isNotEmpty()) {
                item { SectionHeader("Notes", noteHits.size.toString()) }
                lazyGroup(noteHits, key = { "note:${it.key}" }) { NoteRow(it, now, actions, readOnly) { r -> note = r } }
            }
            return@LazyColumn
        }
        if (!readOnly) item {
            LayoutRow(Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                ProposeClaim(null, profile, actions)
                Button("New page", { creating = true }, variant = ButtonVariant.Plain, icon = "add")
            }
        }
        if (waiting > 0) item { Group(Modifier.padding(top = Tokens.sp4)) { ListRow("${plural(waiting, "claim")} to review", onClick = onReview, trailing = { Chevron() }) } }
        item { Group(Modifier.padding(top = Tokens.sp4)) { ListRow("Memory", plural(stats[null]?.claims ?: 0, "claim"), onClick = onMemory, trailing = { Chevron() }) } }
        if (stale.isNotEmpty() || drift.isNotEmpty()) item { SectionHeader("Needs a look", (stale.size + drift.size).toString(), lookOpen, { lookOpen = !lookOpen }) }
        if (lookOpen && stale.isNotEmpty()) {
            item { SectionHeader("Stale", stale.size.toString()) }
            lazyGroup(if (allStale) stale else stale.take(3), key = { "stale:${it.key}" }) { f ->
                val months = ((now - (f.long("at") ?: 0L)) / (30 * DAY_MS)).toInt()
                val used = f.long("used_count")?.takeIf { it > 0 }
                ListRow(f.str("text") ?: "", "${titles[f.str("page_id")]} · ${plural(months, "month")}" + (used?.let { " · Used on ${plural(it.toInt(), "day")}" } ?: ""), onClick = { onClaim(f) },
                    trailing = { Button("Confirm", { actions.confirmClaim(f) }, variant = ButtonVariant.Tinted, size = ButtonSize.Sm) },
                    menu = { dismiss -> MenuItem("Retire", "archive", { dismiss(); actions.retireClaim(f) }, danger = true) })
            }
            if (!allStale && stale.size > 3) item { Button("Show all ${stale.size}", { allStale = true }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm) }
        }
        if (lookOpen && drift.isNotEmpty()) {
            item { SectionHeader("Maybe changed", drift.size.toString()) }
            lazyGroup(if (allDrift) drift else drift.take(3), key = { "drift:${it.fact.key}" }) { r ->
                val f = r.fact
                val d = r.decision
                ListRow(f.str("text") ?: "", "${titles[f.str("page_id")]} · ${d.meeting.title ?: "Meeting"}, ${shortDate(d.at, now)}: ${d.text}", onClick = { onClaim(f) })
            }
            if (!allDrift && drift.size > 3) item { Button("Show all ${drift.size}", { allDrift = true }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm) }
        }
        overview?.let { o ->
            item { Group(Modifier.padding(top = Tokens.sp4)) { ListRow(o.title ?: "Overview", o.str("summary")?.let { firstLine(it) }, onClick = { onOpen(o) }) } }
        }
        if (sections.isEmpty() && overview == null) item {
            EmptyState("No pages yet", icon = "book", action = if (readOnly) null else ({ Button("New page", { creating = true }, variant = ButtonVariant.Tinted) }))
        }
        sections.forEach { s ->
            item { SectionHeader(s.name, s.pages.size.toString()) }
            item {
                Group {
                    s.pages.forEachIndexed { i, p ->
                        if (i > 0) Hairline()
                        ListRow(p.title ?: UNTITLED, leading = { PageTile(p) }, onClick = { onOpen(p) },
                            state = if (pageNeedsReview(p, facts)) ({ Badge("Needs you", BadgeTone.Waiting) }) else null,
                            menu = { dismiss ->
                                MenuItem("Open", "file", { dismiss(); onOpen(p) })
                                MenuSeparator()
                                MenuItem("Archive", "archive", { dismiss(); actions.change(p, mapOf("state" to "retired"), "Archived ${p.title}") }, danger = true)
                            })
                    }
                }
            }
        }
        if (archived.isNotEmpty()) item { Group(Modifier.padding(top = Tokens.sp4)) { ListRow("Archived pages", trailing = { Chevron("${archived.size}") }, onClick = { archivedOpen = true }) } }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
    if (creating) TextDialog("New page", "", "Create", { title ->
        val sort = (sections.firstOrNull { it.name == "Pages" }?.pages.orEmpty().maxOfOrNull { it.long("sort") ?: 0L } ?: 0L).coerceAtLeast(0L) + 1
        newPage(title, "Pages", sort, proposalProfile(null, profile), System.currentTimeMillis())?.let { actions.create(it, "Page created"); onOpen(it) }
    }, { creating = false }, maxLength = 120)
    if (feedOpen) FeedSheet(facts, pages, now, { feedOpen = false }) { feedOpen = false; onClaim(it) }
    if (archivedOpen) ArchivedSheet(archived, now, actions, readOnly) { archivedOpen = false }
    if (notesOpen) NotesSheet(notes, now, actions, proposalProfile(null, profile), readOnly, { notesOpen = false }) { note = it }
    note?.let { NoteSheet(it, actions) { note = null } }
    if (asking && onAsk != null) ClaimTextSheet("Ask", "", "Ask", { asking = false }, "Ask the wiki") { q -> onAsk(wikiAskText(q, pages, facts, null, now)) }
}

private const val CLAIMS_SHOWN = 50

// Retired pages, newest first, each with Restore (web wiki/WikiIndex.tsx Archived).
@Composable
private fun ArchivedSheet(pages: List<Row>, now: Long, actions: TaskActions, readOnly: Boolean, onDismiss: () -> Unit) {
    Sheet(onDismiss, "Archived pages", padded = false, count = pages.size.toString()) {
        Group {
            pages.forEachIndexed { i, p ->
                if (i > 0) Hairline()
                ListRow(p.title ?: UNTITLED, "${p.str("section")?.ifEmpty { null } ?: "Pages"} · Archived ${agoShort(p.updatedAt, now)}", leading = { PageTile(p) },
                    trailing = if (readOnly) null else ({ Button("Restore", { actions.change(p, mapOf("state" to null), "Restored ${p.title}") }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }))
            }
        }
    }
}

private const val NOTES_SHOWN = 20

// Loose notes (web wiki/Notes.tsx): New note, then the notes newest first.
@Composable
private fun NotesSheet(notes: List<Row>, now: Long, actions: TaskActions, profile: String, readOnly: Boolean, onDismiss: () -> Unit, onNote: (Row) -> Unit) {
    var adding by remember { mutableStateOf(false) }
    var all by remember { mutableStateOf(false) }
    Sheet(onDismiss, "Notes", padded = false, count = notes.size.toString()) {
        if (!readOnly) Group { ListRow("New note", leading = { AvIcon("add") }, onClick = { adding = true }) }
        if (notes.isEmpty()) EmptyState("No notes yet", "Notes you save and asks marked Nothing asked show here", icon = "note")
        else Group(Modifier.padding(top = Tokens.sp4)) {
            (if (all) notes else notes.take(NOTES_SHOWN)).forEachIndexed { i, r -> if (i > 0) Hairline(); NoteRow(r, now, actions, readOnly, onNote) }
        }
        if (!all && notes.size > NOTES_SHOWN) Button("Show all ${notes.size}", { all = true }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
    }
    if (adding) ClaimTextSheet("New note", "", "Save", { adding = false }, "First line is the title") { actions.addNote(it, profile) }
}

@Composable
private fun NoteRow(r: Row, now: Long, actions: TaskActions, readOnly: Boolean, onOpen: (Row) -> Unit) {
    ListRow(r.title?.ifEmpty { null } ?: UNTITLED, "${agoText(r.updatedAt, now)} · ${profileLabel(r.profile)}", onClick = if (readOnly) null else ({ onOpen(r) }),
        menu = if (readOnly) null else ({ dismiss ->
            MenuItem("Make task", "add", { dismiss(); actions.toTask(r) })
            MenuItem("Delete", "trash", { dismiss(); actions.deleteNote(r) }, danger = true)
        }))
}

// Saves the edited note: unchanged text saves nothing and empty text deletes it.
@Composable
private fun NoteSheet(r: Row, actions: TaskActions, onDismiss: () -> Unit) {
    val full = listOfNotNull(r.title, r.text).filter { it.isNotEmpty() }.joinToString("\n")
    ClaimTextSheet("Note", full, "Save", onDismiss, "First line is the title", allowBlank = true) { text ->
        val t = text.trim()
        if (t.isEmpty()) actions.deleteNote(r)
        else if (t != full) splitTitle(t).let { (title, body) -> actions.edit(r, mapOf("title" to title, "text" to body)) }
    }
}

// Recently updated (web wiki/Feed.tsx): the 5 newest current claims with their page, source or contester and age.
@Composable
private fun FeedSheet(facts: List<Row>, pages: List<Row>, now: Long, onDismiss: () -> Unit, onClaim: (Row) -> Unit) {
    val entries = remember(facts) { wikiFeed(facts) }
    val titles = remember(pages) { pages.associate { it.key to it.title } }
    Sheet(onDismiss, "Recently updated", padded = false, count = entries.size.toString()) {
        if (entries.isEmpty()) EmptyState("No claims yet", "New and changed claims show here", icon = "book")
        else Group {
            entries.take(5).forEachIndexed { i, e ->
                if (i > 0) Hairline()
                val f = e.fact
                val contested = e.kind == FeedKind.Contested
                val page = f.str("page_id")?.ifEmpty { null }?.let { titles["${f.profile}:$it"] ?: UNTITLED } ?: "Memory"
                val by = contestOf(f)?.takeIf { contested }?.let { "by ${it.by}" } ?: sourcesOf(f).firstOrNull()?.label
                ListRow(f.str("text") ?: "", listOfNotNull(page, by, agoText(e.at, now)).joinToString(" · "), onClick = { onClaim(f) },
                    state = if (contested) ({ Badge("Contested", BadgeTone.Waiting) }) else null)
            }
        }
    }
}

@Composable
internal fun ClaimTextSheet(title: String, initial: String, save: String, onDismiss: () -> Unit, placeholder: String = "What is true?", maxLength: Int = Int.MAX_VALUE, allowBlank: Boolean = false, onSave: (String) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    Sheet(onDismiss, title, full = false) {
        TextField(text, { text = it.take(maxLength) }, Modifier.padding(vertical = Tokens.sp4), placeholder = placeholder, minLines = 2)
        LayoutRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4, Alignment.End)) {
            Button("Cancel", onDismiss, variant = ButtonVariant.Plain)
            Button(save, { onDismiss(); onSave(text) }, variant = ButtonVariant.Filled, enabled = allowBlank || text.isNotBlank())
        }
    }
}

private fun TaskActions.confirmClaim(f: Row) = change(f, mapOf("at" to System.currentTimeMillis()), "Claim confirmed")

private fun TaskActions.retireClaim(f: Row) = change(f, mapOf("state" to "retired"), "Claim retired")

// Saves a proposed claim on the page, or in Memory when the page is null, for Review.
@Composable
private fun ProposeClaim(page: Row?, filter: String?, actions: TaskActions) {
    var open by remember { mutableStateOf(false) }
    Button("Propose claim", { open = true }, variant = ButtonVariant.Filled, icon = "add")
    if (open) ClaimTextSheet("Propose claim", "", "Propose", { open = false }) { text ->
        newFact(text, page?.id, proposalProfile(page, filter), System.currentTimeMillis())?.let { actions.create(it, "Claim proposed") }
    }
}

// Saves a live Memory claim at once, as Remember in a chat does.
@Composable
private fun RememberClaim(onRemember: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Button("Remember", { open = true }, variant = ButtonVariant.Filled, icon = "add")
    if (open) ClaimTextSheet("Remember", "", "Save", { open = false }, "What to remember", 400, onSave = onRemember)
}

@Composable
private fun ClaimRow(c: Claim, now: Long, actions: TaskActions, review: ReviewOps, page: String, onOpenChat: (String) -> Unit, stale: Boolean = false, ungiven: Boolean = false, flash: Boolean = false,
    mentions: List<Row> = emptyList(), onTask: (Row) -> Unit = {}, onMeeting: (Row) -> Unit = {}) {
    val f = c.fact
    val menu = remember(f.key) { mutableStateOf(false) }
    var note by remember(f.key) { mutableStateOf("") }
    val clip = LocalClipboardManager.current
    val uri = LocalUriHandler.current
    val contest = contestOf(f)
    val proposed = f.str("state") == "proposed"
    var expanded by remember(f.key) { mutableStateOf(false) }
    val warn = SpanStyle(color = av.warn)
    val meta: AnnotatedString = buildAnnotatedString {
        fun part(text: String, style: SpanStyle? = null) {
            if (length > 0) append(" · ")
            if (style != null) withStyle(style) { append(text) } else append(text)
        }
        if (ungiven) part("Not given to chats")
        if (proposed) part("Proposed")
        contest?.let { part("Contested by ${it.by} - ${agoText(it.at, now)}", warn) }
        sourcesOf(f).firstOrNull()?.let { part(it.label) }
    }
    var contesting by remember(f.key) { mutableStateOf(false) }
    var editing by remember(f.key) { mutableStateOf(false) }
    val retired = f.str("state") == "retired"
    val acts = claimActions(f, stale)
    val links = sourcesOf(f).drop(1).mapNotNull { s -> safeHref(s.url)?.let { s to it } }
    val menuContent: @Composable ColumnScope.(() -> Unit) -> Unit = { dismiss ->
        val pick = { act: () -> Unit -> { dismiss(); act() } }
        if ("edit" in acts.menu) MenuItem("Edit", "edit", pick { editing = true })
        if ("cite" in acts.menu) MenuItem("Cite", "link", pick {
            val srcs = sourcesOf(f).map { it.label }
            val at = f.long("at")?.let { ", ${shortDate(it, now)}" } ?: ""
            clip.setText(AnnotatedString("$page: ${f.str("text") ?: ""}" + if (srcs.isNotEmpty()) " (${srcs.joinToString(", ")}$at)" else ""))
            actions.say("Claim copied")
        })
        if ("contest" in acts.menu) MenuItem("Contest", "report", pick { contesting = true })
        if ("resolve" in acts.menu) MenuItem("Resolve", "check", pick { actions.change(f, mapOf("contested" to null), "Marked as resolved") })
        if (links.isNotEmpty()) MenuSeparator()
        links.forEach { (s, href) -> MenuItem("${s.kindLabel}: ${s.label}", s.icon, pick { uri.openUri(href) }) }
        c.old.forEach { o -> MenuItem("Replaced ${o.long("at")?.let { shortDate(it, now) } ?: ""}".trim(), "history", {}, enabled = false) }
        if (mentions.isNotEmpty()) MenuSeparator()
        mentions.forEach { r ->
            if (r.table == "meetings") MenuItem((r.title?.ifEmpty { null } ?: "Meeting") + (r.long("starts_at")?.let { " ${dayLabel(it)}" } ?: ""), "calendar", pick { onMeeting(r) })
            else MenuItem(r.title?.ifEmpty { null } ?: r.text?.ifEmpty { null } ?: UNTITLED, "checklist", pick { onTask(r) })
        }
        chatOf(f)?.let { id -> MenuSeparator(); MenuItem("Open chat", "sparkle", pick { onOpenChat(id) }) }
        f.long("at")?.let { MenuSeparator(); MenuItem("${if (stale) "Still true? " else ""}Updated ${shortDate(it, now)}", "history", {}, enabled = false) }
        if ("retire" in acts.menu || "restore" in acts.menu) MenuItem(if (retired) "Restore" else "Retire", if (retired) "history" else "archive", pick { if (retired) actions.change(f, mapOf("state" to null), "Claim restored") else actions.retireClaim(f) }, danger = !retired)
    }
    Column {
        ListRow(f.str("text") ?: "", meta, lines = if (expanded) Int.MAX_VALUE else 3, metaLines = 1, selected = flash, onClick = { expanded = !expanded }, onLongClick = if (acts.menu.isEmpty()) null else ({ menu.value = true }),
            trailing = {
                acts.buttons.forEach { b ->
                    when (b) {
                        "reject" -> IconBtn("close", "Reject", { review.reject(listOf(f)) })
                        "approve" -> IconBtn("check", "Approve", { review.approve(listOf(f)) })
                        "confirm" -> Button("Confirm", { actions.confirmClaim(f) }, variant = ButtonVariant.Tinted, size = ButtonSize.Sm)
                        else -> MoreButton(expanded = menu, content = menuContent)
                    }
                }
            })
        contest?.note?.ifEmpty { null }?.let { Text(it, Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, bottom = Tokens.sp4), style = Type.footnote, color = av.fgMuted) }
        if (editing) ClaimTextSheet("Edit claim", f.str("text") ?: "", "Save", { editing = false }) { text -> review.edit(f, text) }
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

// The page's proposed claims with Reject all and Approve all, then what was decided until the page is left (web PendingBanner).
@Composable
private fun PendingBanner(page: Row, proposed: List<Row>, decided: String?, readOnly: Boolean, onReject: () -> Unit, onApprove: () -> Unit) {
    if (proposed.isEmpty()) {
        if (decided != null) LayoutRow(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            AvIcon("check", null, tint = av.fgMuted)
            Text(decided, style = Type.subheadline, color = av.fgMuted)
        }
        return
    }
    LayoutRow(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        Text((if (page.str("state") == "proposed") "New page with " else "") + plural(proposed.size, "proposed claim"), Modifier.weight(1f), style = Type.subheadline, color = av.fg)
        if (!readOnly) {
            Button("Reject all", onReject, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            Button("Approve all", onApprove, variant = ButtonVariant.Tinted, size = ButtonSize.Sm)
        }
    }
}

private const val FLASH_MS = 1600L

@Composable
fun WikiPageView(st: CodexState, page: Row, profile: String?, now: Long, actions: TaskActions, review: ReviewOps, onReview: () -> Unit, onBack: () -> Unit, onOpenChat: (String) -> Unit, anchor: String? = null, onRemember: ((String) -> Unit)? = null, onAsk: ((String) -> Unit)? = null, readOnly: Boolean = false,
    onTask: (Row) -> Unit = {}, onMeeting: (Row) -> Unit = {}) {
    val memory = page.id == MEMORY
    val pid = if (memory) null else page.id
    val facts = remember(st.facts, page.profile, profile, memory) { st.facts.filter { if (memory) matchesProfile(profile, it) else it.profile == page.profile } }
    val groups = remember(facts, pid, now / 60_000) { pageClaims(facts, pid, now) }
    val mentionable = remember(st.items, st.meetings) { mentionables(st.items, st.meetings) }
    val mentions = remember(groups, mentionable, page.title) {
        if (memory) emptyMap() else groups.flatMap { g -> g.claims.map { it.fact } }.filter { it.str("state") != "proposed" }.associate { it.key to mentionsOf(mentionable, it, page.title) }
    }
    val older = remember(facts, pid, now / 60_000) { olderClaims(facts, pid, now) }
    val stat = remember(facts) { statsByPage(facts)[pid] }
    var showOlder by rememberSaveable(page.key) { mutableStateOf(false) }
    val ungiven = remember(facts, memory, now / 60_000) { if (memory) ungivenPreferences(facts, now) else emptySet() }
    val staleIds = older.filter { it.str("state") != "retired" }.map { it.id }.toSet()
    var summaryOpen by rememberSaveable(page.key) { mutableStateOf(false) }
    var renaming by rememberSaveable(page.key) { mutableStateOf(false) }
    var asking by rememberSaveable(page.key) { mutableStateOf(false) }
    val proposed = remember(facts, pid) { pageProposals(facts, pid) }
    val pending = proposed.isNotEmpty()
    var decided by remember(page.key) { mutableStateOf<String?>(null) }
    var rejecting by remember(page.key) { mutableStateOf(false) }
    val clip = LocalClipboardManager.current
    if (renaming) TextDialog("Rename page", page.title ?: "", "Save", { t -> editedClaimText(page.title, t)?.let { actions.change(page, mapOf("title" to it), "Renamed") } }, { renaming = false }, maxLength = 120)
    if (rejecting) ConfirmDialog("Reject ${plural(proposed.size, "claim")}?", page.title ?: "", "Reject all", { review.reject(proposed); decided = "Rejected ${plural(proposed.size, "claim")}" }) { rejecting = false }
    if (asking && onAsk != null) ClaimTextSheet("Ask", "", "Ask", { asking = false }, "Ask about ${page.title ?: UNTITLED}") { q -> onAsk(wikiAskText(q, st.pages, facts, page.id, now)) }
    val listState = rememberLazyListState()
    var seek by remember(page.key, anchor) { mutableStateOf(anchor) }
    var flash by remember(page.key, anchor) { mutableStateOf<String?>(null) }
    // Opens Older when the claim is in it, then scrolls to the claim; an anchor that names no claim on the page leaves it at the top.
    LaunchedEffect(seek, showOlder) {
        val id = seek ?: return@LaunchedEffect
        val spot = claimItemIndex(groups, older, showOlder, id)
        if (spot?.openOlder == true) { showOlder = true; return@LaunchedEffect }
        seek = null
        if (spot == null) return@LaunchedEffect
        flash = id
        listState.scrollToItem(spot.index)
    }
    LaunchedEffect(flash) { if (flash != null) { delay(FLASH_MS); flash = null } }
    LazyColumn(Modifier.fillMaxWidth(), listState) {
        item {
            Column(Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, top = Tokens.sp8, bottom = Tokens.sp8), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                LayoutRow(verticalAlignment = Alignment.CenterVertically) {
                    Text(page.title ?: UNTITLED, Modifier.weight(1f), style = SerifTitle)
                    MoreButton { dismiss ->
                        val pick = { act: () -> Unit -> { dismiss(); act() } }
                        if (!memory && onAsk != null) MenuItem("Ask", "sparkle", pick { asking = true })
                        if (!memory) MenuItem("Rename", "edit", pick { renaming = true })
                        if (pending) MenuItem("Review", "checklist", pick(onReview))
                        if (hasLiveClaims(groups)) MenuItem("Copy as Markdown", "copy", pick {
                            clip.setText(AnnotatedString(wikiMarkdown(page.title, groups)))
                            actions.say("Page copied")
                        })
                        if (!memory) {
                            MenuSeparator()
                            MenuItem("Archive", "archive", pick { actions.change(page, mapOf("state" to "retired"), "Archived ${page.title}"); onBack() }, danger = true)
                        }
                    }
                }
                val n = stat?.claims ?: 0
                val meta = listOfNotNull(
                    plural(n, "claim"),
                    stat?.updated?.takeIf { it > 0 }?.let { "Updated ${shortDate(maxOf(page.updatedAt, it), now)}" },
                )
                Text(meta.joinToString(" · "), style = Type.subheadline, color = av.fgMuted, maxLines = 1)
                page.str("summary")?.takeIf { it.isNotEmpty() }?.let {
                    Text(it, Modifier.heightIn(min = Tokens.touchSm).clickable { summaryOpen = !summaryOpen }, style = Type.body, color = av.fg, maxLines = if (summaryOpen) Int.MAX_VALUE else 3, overflow = TextOverflow.Ellipsis)
                }
                if (!memory && !readOnly) ProposeClaim(page, profile, actions)
                else if (onRemember != null) RememberClaim(onRemember)
                PendingBanner(page, proposed, decided, readOnly, { rejecting = true }) { review.approve(proposed); decided = "Approved ${plural(proposed.size, "claim")}" }
            }
        }
        groups.forEach { g ->
            val open = g.claims.map { it.fact }.filter { it.str("state") == "proposed" }
            item { SectionHeader(g.heading, g.claims.size.toString(), serif = true, action = if (readOnly || open.size < 2) null else ({ Button("Approve ${open.size}", { review.approve(open) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) })) }
            lazyGroup(g.claims, key = { it.fact.key }) { ClaimRow(it, now, actions, review, page.title ?: "", onOpenChat, ungiven = it.fact.key in ungiven, flash = it.fact.id == flash,
                mentions = mentions[it.fact.key].orEmpty(), onTask = onTask, onMeeting = onMeeting) }
        }
        if (older.isNotEmpty()) {
            item {
                Column {
                    SectionHeader("Not used by Claude" + if (staleIds.isNotEmpty()) " · ${staleIds.size} to confirm" else "", older.size.toString(), open = showOlder, onToggle = { showOlder = !showOlder })
                    if (showOlder) Text("Retired or over 90 days old. The agent does not use these.", Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, bottom = Tokens.sp4), style = Type.footnote, color = av.fgMuted)
                }
            }
            if (showOlder) lazyGroup(older, key = { "old:${it.key}" }) { ClaimRow(Claim(it, emptyList()), now, actions, review, page.title ?: "", onOpenChat, stale = it.id in staleIds, flash = it.id == flash) }
        }
        if (groups.isEmpty() && older.isEmpty()) item {
            if (memory) EmptyState("Nothing remembered yet", "Use Remember here or in a chat", icon = "book")
            else EmptyState("No claims yet", "They appear here as meetings, Slack threads and issues mention ${page.title}", icon = "book")
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
}
