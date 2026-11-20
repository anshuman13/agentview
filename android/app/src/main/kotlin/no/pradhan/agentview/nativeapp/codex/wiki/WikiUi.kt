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
import no.pradhan.agentview.nativeapp.codex.firstLine
import no.pradhan.agentview.nativeapp.codex.matchesProfile
import no.pradhan.agentview.nativeapp.codex.liveRows
import no.pradhan.agentview.nativeapp.codex.meetings.safeHref
import no.pradhan.agentview.nativeapp.codex.profileLabel
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.IconBtn
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
import no.pradhan.agentview.nativeapp.ui.TextDialog
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
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

private class ReviewRow(val key: String, val title: String, val meta: String, val claims: List<Row>, val group: Boolean, val open: () -> Unit)

@Composable
fun WikiIndexPage(st: CodexState, profile: String?, now: Long, actions: TaskActions, review: ReviewOps, readOnly: Boolean, onOpen: (Row) -> Unit, onClaim: (Row) -> Unit, onReview: () -> Unit, onMemory: () -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    val pages = remember(st.pages, profile) { st.pages.filter { matchesProfile(profile, it) } }
    val facts = remember(st.facts, profile) { st.facts.filter { matchesProfile(profile, it) } }
    val overview = remember(pages) { liveRows(pages).firstOrNull { it.str("section") == "overview" } }
    val sections = remember(pages) { wikiSections(pages) }
    val stats = remember(facts) { statsByPage(facts) }
    val hits = remember(pages, facts, query) { searchWiki(pages, facts, query) }
    val titles = remember(pages) { pages.associate { it.id to it.title } }
    val stale = remember(pages, facts, st.meetings, profile, now / 60_000) { staleFacts(facts, pages, st.meetings.filter { matchesProfile(profile, it) }, now) }
    var allStale by rememberSaveable { mutableStateOf(false) }
    var allLoose by rememberSaveable { mutableStateOf(false) }
    val waiting = remember(facts) { proposals(facts).size }
    val grouped = remember(pages, facts) { reviewGroups(pages, facts) }
    val reviewRows = grouped.byPage.map { g ->
        ReviewRow("page:${g.page.key}", g.page.title ?: UNTITLED, (if (g.page.str("state") == "proposed") "New page in ${g.page.str("section")}" else "Additions") + " · ${plural(g.claims.size, "claim")}", g.claims, true) { onOpen(g.page) }
    } + grouped.chats.map { list ->
        val label = sourcesOf(list[0]).firstOrNull { it.kind == "chat" }?.label?.ifEmpty { null } ?: UNTITLED
        ReviewRow("chat:${list[0].profile}:${chatOf(list[0])}", "From chat $label", "Memory · ${plural(list.size, "claim")}", list, true, onReview)
    } + (if (allLoose) grouped.loose else grouped.loose.take(3)).map { f ->
        ReviewRow("claim:${f.key}", f.str("text") ?: "", f.str("page_id")?.let { titles[it] } ?: "Memory", listOf(f), false) { onClaim(f) }
    }
    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            SearchField(query, { query = it }, "Search the wiki", Modifier.padding(top = Tokens.sp4))
        }
        if (query.isNotBlank()) {
            if (hits.pages.isEmpty() && hits.claims.isEmpty()) item { EmptyState("Nothing in the wiki matches “$query”", icon = "search") }
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
        item { Box(Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp4)) { ProposeClaim(null, profile, actions) } }
        if (waiting > 0) {
            item { SectionHeader("To review", waiting.toString(), action = { Button("One at a time", onReview, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) }
            lazyGroup(reviewRows, key = { it.key }) { r ->
                ListRow(r.title, r.meta, onClick = r.open, trailing = if (readOnly) null else ({
                    IconBtn("close", if (r.group) "Reject all" else "Reject", { review.reject(r.claims) })
                    IconBtn("check", if (r.group) "Approve all" else "Approve", { review.approve(r.claims) })
                }))
            }
            if (!allLoose && grouped.loose.size > 3) item { Button("Show all ${grouped.loose.size}", { allLoose = true }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm) }
        }
        item { Group(Modifier.padding(top = Tokens.sp4)) { ListRow("Memory", plural(stats[null]?.claims ?: 0, "claim"), onClick = onMemory, trailing = { Chevron() }) } }
        if (stale.isNotEmpty()) {
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
        overview?.let { o ->
            item { Group(Modifier.padding(top = Tokens.sp4)) { ListRow(o.title ?: "Overview", o.str("summary")?.let { firstLine(it) }, onClick = { onOpen(o) }) } }
        }
        if (sections.isEmpty() && overview == null) item { EmptyState("No pages yet", icon = "book") }
        sections.forEach { s ->
            item { SectionHeader(s.name, s.pages.size.toString()) }
            item {
                Group {
                    s.pages.forEachIndexed { i, p ->
                        if (i > 0) Hairline()
                        val n = stats[p.id]?.claims ?: 0
                        ListRow(p.title ?: UNTITLED, plural(n, "claim") + if (profile == null) " · ${profileLabel(p.profile)}" else "", leading = { PageTile(p) }, onClick = { onOpen(p) },
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
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
}

@Composable
internal fun ClaimTextSheet(title: String, initial: String, save: String, onDismiss: () -> Unit, placeholder: String = "What is true?", maxLength: Int = Int.MAX_VALUE, onSave: (String) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    Sheet(onDismiss, title, full = false) {
        TextField(text, { if (it.length <= maxLength) text = it }, Modifier.padding(vertical = Tokens.sp4), placeholder = placeholder, minLines = 2)
        LayoutRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4, Alignment.End)) {
            Button("Cancel", onDismiss, variant = ButtonVariant.Plain)
            Button(save, { onDismiss(); onSave(text) }, variant = ButtonVariant.Filled, enabled = text.isNotBlank())
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
    if (open) ClaimTextSheet("Remember", "", "Save", { open = false }, "What to remember", 400, onRemember)
}

@Composable
private fun ClaimRow(c: Claim, now: Long, actions: TaskActions, review: ReviewOps, page: String, stale: Boolean = false, ungiven: Boolean = false, flash: Boolean = false) {
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
            if (ungiven) bits.add("Not given to chats")
            if (proposed) bits.add("Proposed")
            else {
                if (stale) bits.add("Still true?")
                sourcesOf(f).firstOrNull()?.let { bits.add(it.label) }
                f.long("at")?.let { bits.add(shortDate(it, now)) }
            }
            append(bits.joinToString(" · "))
        }
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
        f.long("at")?.let { MenuSeparator(); MenuItem("${if (stale) "Still true? " else ""}Updated ${shortDate(it, now)}", "history", {}, enabled = false) }
        if ("retire" in acts.menu || "restore" in acts.menu) MenuItem(if (retired) "Restore" else "Retire", if (retired) "history" else "archive", pick { if (retired) actions.change(f, mapOf("state" to null), "Claim restored") else actions.retireClaim(f) }, danger = !retired)
    }
    Column {
        ListRow(f.str("text") ?: "", meta, lines = if (expanded) Int.MAX_VALUE else 3, metaLines = if (contest != null) 2 else 1, selected = flash, onClick = { expanded = !expanded }, onLongClick = if (acts.menu.isEmpty()) null else ({ menu.value = true }),
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

private const val FLASH_MS = 1600L

@Composable
fun WikiPageView(st: CodexState, page: Row, profile: String?, now: Long, actions: TaskActions, review: ReviewOps, onReview: () -> Unit, onBack: () -> Unit, anchor: String? = null, onRemember: ((String) -> Unit)? = null) {
    val memory = page.id == MEMORY
    val pid = if (memory) null else page.id
    val facts = remember(st.facts, page.profile, profile, memory) { st.facts.filter { if (memory) matchesProfile(profile, it) else it.profile == page.profile } }
    val groups = remember(facts, pid, now / 60_000) { pageClaims(facts, pid, now) }
    val older = remember(facts, pid, now / 60_000) { olderClaims(facts, pid, now) }
    val stat = remember(facts) { statsByPage(facts)[pid] }
    var showOlder by rememberSaveable(page.key) { mutableStateOf(false) }
    val ungiven = remember(facts, memory, now / 60_000) { if (memory) ungivenPreferences(facts, now) else emptySet() }
    val staleIds = older.filter { it.str("state") != "retired" }.map { it.id }.toSet()
    var summaryOpen by rememberSaveable(page.key) { mutableStateOf(false) }
    var renaming by rememberSaveable(page.key) { mutableStateOf(false) }
    val pending = groups.any { g -> g.claims.any { it.fact.str("state") == "proposed" } }
    val clip = LocalClipboardManager.current
    if (renaming) TextDialog("Rename page", page.title ?: "", "Save", { t -> editedClaimText(page.title, t)?.let { actions.change(page, mapOf("title" to it), "Renamed") } }, { renaming = false }, maxLength = 120)
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
                Text(page.title ?: UNTITLED, style = Type.title)
                val n = stat?.claims ?: 0
                val meta = listOfNotNull(
                    plural(n, "claim"),
                    stat?.updated?.takeIf { it > 0 }?.let { "Updated ${shortDate(maxOf(page.updatedAt, it), now)}" },
                )
                Text(meta.joinToString(" · "), style = Type.subheadline, color = av.fgMuted, maxLines = 1)
                page.str("summary")?.takeIf { it.isNotEmpty() }?.let {
                    Text(it, Modifier.heightIn(min = Tokens.touchSm).clickable { summaryOpen = !summaryOpen }, style = Type.body, color = av.fg, maxLines = if (summaryOpen) Int.MAX_VALUE else 3, overflow = TextOverflow.Ellipsis)
                }
                LayoutRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
                    if (!memory) ProposeClaim(page, profile, actions)
                    else if (onRemember != null) RememberClaim(onRemember)
                    MoreButton { dismiss ->
                        val pick = { act: () -> Unit -> { dismiss(); act() } }
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
            }
        }
        groups.forEach { g ->
            item { SectionHeader(g.heading, g.claims.size.toString()) }
            lazyGroup(g.claims, key = { it.fact.key }) { ClaimRow(it, now, actions, review, page.title ?: "", ungiven = it.fact.key in ungiven, flash = it.fact.id == flash) }
        }
        if (older.isNotEmpty()) {
            item { SectionHeader("Not used by Claude", older.size.toString(), open = showOlder, onToggle = { showOlder = !showOlder }) }
            if (showOlder) lazyGroup(older, key = { "old:${it.key}" }) { ClaimRow(Claim(it, emptyList()), now, actions, review, page.title ?: "", stale = it.id in staleIds, flash = it.id == flash) }
        }
        if (groups.isEmpty() && older.isEmpty()) item {
            if (memory) EmptyState("Nothing remembered yet", "Use Remember here or in a chat", icon = "book")
            else EmptyState("No claims yet", "They appear here as meetings, Slack threads and issues mention ${page.title}", icon = "book")
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
}
